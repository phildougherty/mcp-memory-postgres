#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PoolClient } from 'pg';
import { DatabaseConnection } from './database.js';
import { Command } from 'commander';
import { createServer } from 'http';

// Interface definitions
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// Database-backed Knowledge Graph Manager
class DatabaseKnowledgeGraphManager {
  private db: DatabaseConnection;

  constructor() {
    this.db = DatabaseConnection.getInstance();
  }

  private async getEntityByName(client: PoolClient, name: string): Promise<{ id: number; name: string; entity_type: string } | null> {
    const result = await client.query('SELECT id, name, entity_type FROM entities WHERE name = $1', [name]);
    return result.rows[0] || null;
  }

  private async getEntityObservations(client: PoolClient, entityId: number): Promise<string[]> {
    const result = await client.query(
      'SELECT content FROM observations WHERE entity_id = $1 ORDER BY created_at',
      [entityId]
    );
    return result.rows.map(row => row.content);
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    const client = await this.db.getClient();
    const newEntities: Entity[] = [];

    try {
      await client.query('BEGIN');

      for (const entity of entities) {
        const existingEntity = await this.getEntityByName(client, entity.name);
        
        if (!existingEntity) {
          const insertResult = await client.query(
            'INSERT INTO entities (name, entity_type) VALUES ($1, $2) RETURNING id',
            [entity.name, entity.entityType]
          );
          
          const entityId = insertResult.rows[0].id;

          for (const observation of entity.observations) {
            await client.query(
              'INSERT INTO observations (entity_id, content) VALUES ($1, $2)',
              [entityId, observation]
            );
          }

          newEntities.push(entity);
        }
      }

      await client.query('COMMIT');
      return newEntities;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    const client = await this.db.getClient();
    const newRelations: Relation[] = [];

    try {
      await client.query('BEGIN');

      for (const relation of relations) {
        const fromEntity = await this.getEntityByName(client, relation.from);
        const toEntity = await this.getEntityByName(client, relation.to);

        if (!fromEntity || !toEntity) {
          console.warn(`Skipping relation ${relation.from} -> ${relation.to}: entity not found`);
          continue;
        }

        const existingRelation = await client.query(
          'SELECT id FROM relations WHERE from_entity_id = $1 AND to_entity_id = $2 AND relation_type = $3',
          [fromEntity.id, toEntity.id, relation.relationType]
        );

        if (existingRelation.rows.length === 0) {
          await client.query(
            'INSERT INTO relations (from_entity_id, to_entity_id, relation_type) VALUES ($1, $2, $3)',
            [fromEntity.id, toEntity.id, relation.relationType]
          );
          newRelations.push(relation);
        }
      }

      await client.query('COMMIT');
      return newRelations;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async addObservations(observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const client = await this.db.getClient();
    const results: { entityName: string; addedObservations: string[] }[] = [];

    try {
      await client.query('BEGIN');

      for (const obs of observations) {
        const entity = await this.getEntityByName(client, obs.entityName);
        
        if (!entity) {
          throw new Error(`Entity with name ${obs.entityName} not found`);
        }

        const existingObservations = await this.getEntityObservations(client, entity.id);
        const newObservations = obs.contents.filter(content => !existingObservations.includes(content));

        for (const content of newObservations) {
          await client.query(
            'INSERT INTO observations (entity_id, content) VALUES ($1, $2)',
            [entity.id, content]
          );
        }

        results.push({ entityName: obs.entityName, addedObservations: newObservations });
      }

      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      for (const name of entityNames) {
        await client.query('DELETE FROM entities WHERE name = $1', [name]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      for (const deletion of deletions) {
        const entity = await this.getEntityByName(client, deletion.entityName);
        
        if (entity) {
          for (const observation of deletion.observations) {
            await client.query(
              'DELETE FROM observations WHERE entity_id = $1 AND content = $2',
              [entity.id, observation]
            );
          }
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      for (const relation of relations) {
        const fromEntity = await this.getEntityByName(client, relation.from);
        const toEntity = await this.getEntityByName(client, relation.to);

        if (fromEntity && toEntity) {
          await client.query(
            'DELETE FROM relations WHERE from_entity_id = $1 AND to_entity_id = $2 AND relation_type = $3',
            [fromEntity.id, toEntity.id, relation.relationType]
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async readGraph(): Promise<KnowledgeGraph> {
    const client = await this.db.getClient();

    try {
      const entitiesResult = await client.query(`
        SELECT e.name, e.entity_type,
               COALESCE(array_agg(o.content ORDER BY o.created_at) FILTER (WHERE o.content IS NOT NULL), ARRAY[]::text[]) as observations
        FROM entities e
        LEFT JOIN observations o ON e.id = o.entity_id
        GROUP BY e.id, e.name, e.entity_type
        ORDER BY e.name
      `);

      const entities: Entity[] = entitiesResult.rows.map(row => ({
        name: row.name,
        entityType: row.entity_type,
        observations: row.observations || []
      }));

      const relationsResult = await client.query(`
        SELECT ef.name as from_name, et.name as to_name, r.relation_type
        FROM relations r
        JOIN entities ef ON r.from_entity_id = ef.id
        JOIN entities et ON r.to_entity_id = et.id
        ORDER BY ef.name, et.name
      `);

      const relations: Relation[] = relationsResult.rows.map(row => ({
        from: row.from_name,
        to: row.to_name,
        relationType: row.relation_type
      }));

      return { entities, relations };
    } finally {
      client.release();
    }
  }

  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const client = await this.db.getClient();

    try {
      const entitiesResult = await client.query(`
        SELECT DISTINCT e.name, e.entity_type,
               COALESCE(array_agg(o.content ORDER BY o.created_at) FILTER (WHERE o.content IS NOT NULL), ARRAY[]::text[]) as observations
        FROM entities e
        LEFT JOIN observations o ON e.id = o.entity_id
        WHERE e.name ILIKE $1
           OR e.entity_type ILIKE $1
           OR to_tsvector('english', e.name) @@ plainto_tsquery('english', $2)
           OR EXISTS (
             SELECT 1 FROM observations obs 
             WHERE obs.entity_id = e.id 
             AND (obs.content ILIKE $1 OR to_tsvector('english', obs.content) @@ plainto_tsquery('english', $2))
           )
        GROUP BY e.id, e.name, e.entity_type
        ORDER BY e.name
      `, [`%${query}%`, query]);

      const entities: Entity[] = entitiesResult.rows.map(row => ({
        name: row.name,
        entityType: row.entity_type,
        observations: row.observations || []
      }));

      const entityNames = entities.map(e => e.name);
      if (entityNames.length === 0) {
        return { entities: [], relations: [] };
      }

      const relationsResult = await client.query(`
        SELECT ef.name as from_name, et.name as to_name, r.relation_type
        FROM relations r
        JOIN entities ef ON r.from_entity_id = ef.id
        JOIN entities et ON r.to_entity_id = et.id
        WHERE ef.name = ANY($1) AND et.name = ANY($1)
        ORDER BY ef.name, et.name
      `, [entityNames]);

      const relations: Relation[] = relationsResult.rows.map(row => ({
        from: row.from_name,
        to: row.to_name,
        relationType: row.relation_type
      }));

      return { entities, relations };
    } finally {
      client.release();
    }
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    if (names.length === 0) {
      return { entities: [], relations: [] };
    }

    const client = await this.db.getClient();

    try {
      const entitiesResult = await client.query(`
        SELECT e.name, e.entity_type,
               COALESCE(array_agg(o.content ORDER BY o.created_at) FILTER (WHERE o.content IS NOT NULL), ARRAY[]::text[]) as observations
        FROM entities e
        LEFT JOIN observations o ON e.id = o.entity_id
        WHERE e.name = ANY($1)
        GROUP BY e.id, e.name, e.entity_type
        ORDER BY e.name
      `, [names]);

      const entities: Entity[] = entitiesResult.rows.map(row => ({
        name: row.name,
        entityType: row.entity_type,
        observations: row.observations || []
      }));

      const relationsResult = await client.query(`
        SELECT ef.name as from_name, et.name as to_name, r.relation_type
        FROM relations r
        JOIN entities ef ON r.from_entity_id = ef.id
        JOIN entities et ON r.to_entity_id = et.id
        WHERE ef.name = ANY($1) AND et.name = ANY($1)
        ORDER BY ef.name, et.name
      `, [names]);

      const relations: Relation[] = relationsResult.rows.map(row => ({
        from: row.from_name,
        to: row.to_name,
        relationType: row.relation_type
      }));

      return { entities, relations };
    } finally {
      client.release();
    }
  }
}

// Parse command line arguments
const program = new Command();
program
  .name('mcp-server-memory')
  .description('Memory MCP Server with PostgreSQL backend')
  .version('0.6.3')
  .option('--transport <type>', 'transport type (stdio, http)', 'stdio')
  .option('--host <host>', 'host to bind to (http)', '0.0.0.0')
  .option('--port <port>', 'port to bind to (http)', '3001')
  .parse();

const opts = program.opts();
const transport = opts.transport;
const host = opts.host;
const port = parseInt(opts.port);

// Initialize database and create manager instance
const db = DatabaseConnection.getInstance();
const knowledgeGraphManager = new DatabaseKnowledgeGraphManager();

// Initialize the server
const server = new Server({
  name: "memory-server",
  version: "0.6.3",
}, {
  capabilities: {
    tools: {},
  },
});

// Tool definitions (same as before)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_entities",
        description: "Create multiple new entities in the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            entities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "The name of the entity" },
                  entityType: { type: "string", description: "The type of the entity" },
                  observations: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observation contents associated with the entity"
                  },
                },
                required: ["name", "entityType", "observations"],
              },
            },
          },
          required: ["entities"],
        },
      },
      {
        name: "create_relations",
        description: "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice",
        inputSchema: {
          type: "object",
          properties: {
            relations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "The name of the entity where the relation starts" },
                  to: { type: "string", description: "The name of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation" },
                },
                required: ["from", "to", "relationType"],
              },
            },
          },
          required: ["relations"],
        },
      },
      {
        name: "add_observations",
        description: "Add new observations to existing entities in the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            observations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity to add the observations to" },
                  contents: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observation contents to add"
                  },
                },
                required: ["entityName", "contents"],
              },
            },
          },
          required: ["observations"],
        },
      },
      {
        name: "delete_entities",
        description: "Delete multiple entities and their associated relations from the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            entityNames: {
              type: "array",
              items: { type: "string" },
              description: "An array of entity names to delete"
            },
          },
          required: ["entityNames"],
        },
      },
      {
        name: "delete_observations",
        description: "Delete specific observations from entities in the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            deletions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity containing the observations" },
                  observations: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observations to delete"
                  },
                },
                required: ["entityName", "observations"],
              },
            },
          },
          required: ["deletions"],
        },
      },
      {
        name: "delete_relations",
        description: "Delete multiple relations from the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            relations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "The name of the entity where the relation starts" },
                  to: { type: "string", description: "The name of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation" },
                },
                required: ["from", "to", "relationType"],
              },
              description: "An array of relations to delete"
            },
          },
          required: ["relations"],
        },
      },
      {
        name: "read_graph",
        description: "Read the entire knowledge graph",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "search_nodes",
        description: "Search for nodes in the knowledge graph based on a query",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query to match against entity names, types, and observation content" },
          },
          required: ["query"],
        },
      },
      {
        name: "open_nodes",
        description: "Open specific nodes in the knowledge graph by their names",
        inputSchema: {
          type: "object",
          properties: {
            names: {
              type: "array",
              items: { type: "string" },
              description: "An array of entity names to retrieve",
            },
          },
          required: ["names"],
        },
      },
    ],
  };
});

// Request handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  switch (name) {
    case "create_entities":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.createEntities(args.entities as Entity[]), null, 2) }] };
    case "create_relations":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.createRelations(args.relations as Relation[]), null, 2) }] };
    case "add_observations":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.addObservations(args.observations as { entityName: string; contents: string[] }[]), null, 2) }] };
    case "delete_entities":
      await knowledgeGraphManager.deleteEntities(args.entityNames as string[]);
      return { content: [{ type: "text", text: "Entities deleted successfully" }] };
    case "delete_observations":
      await knowledgeGraphManager.deleteObservations(args.deletions as { entityName: string; observations: string[] }[]);
      return { content: [{ type: "text", text: "Observations deleted successfully" }] };
    case "delete_relations":
      await knowledgeGraphManager.deleteRelations(args.relations as Relation[]);
      return { content: [{ type: "text", text: "Relations deleted successfully" }] };
    case "read_graph":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.readGraph(), null, 2) }] };
    case "search_nodes":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.searchNodes(args.query as string), null, 2) }] };
    case "open_nodes":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.openNodes(args.names as string[]), null, 2) }] };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  try {
    // Add a small delay to ensure postgres is ready
    if (process.env.NODE_ENV === 'production') {
      console.error('Waiting 5 seconds for database to be ready...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    await db.initializeDatabase();
    
    if (transport === 'http') {
      // Create HTTP server for MCP over HTTP
      const httpServer = createServer(async (req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }
        
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK');
          return;
        }
        
        if (req.method === 'POST' && req.url === '/') {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          
          req.on('end', async () => {
            let request: any;
            try {
              console.error('Received HTTP request:', body);
              request = JSON.parse(body);
              
              let response;
              
              // Handle MCP JSON-RPC requests
              if (request.method === 'initialize') {
                response = {
                  id: request.id,
                  jsonrpc: "2.0",
                  result: {
                    protocolVersion: "2025-03-26",
                    capabilities: {
                      tools: {}
                    },
                    serverInfo: {
                      name: "memory-server",
                      version: "0.6.3"
                    }
                  }
                };
              } else if (request.method === 'tools/list') {
                const toolsResult = await server.request(
                  { method: 'tools/list', params: request.params || {} },
                  ListToolsRequestSchema
                );
                response = {
                  id: request.id,
                  jsonrpc: "2.0",
                  result: toolsResult
                };
              } else if (request.method === 'tools/call') {
                const callResult = await server.request({
                  method: 'tools/call',
                  params: request.params
                }, CallToolRequestSchema);
                response = {
                  id: request.id,
                  jsonrpc: "2.0",
                  result: callResult
                };
              } else {
                response = {
                  id: request.id,
                  jsonrpc: "2.0",
                  error: {
                    code: -32601,
                    message: `Unknown method: ${request.method}`
                  }
                };
              }
              
              res.setHeader('Content-Type', 'application/json');
              res.writeHead(200);
              res.end(JSON.stringify(response));
            } catch (error) {
              console.error('HTTP request error:', error);
              const errorResponse = {
                id: request?.id || null,
                jsonrpc: "2.0",
                error: {
                  code: -32603,
                  message: error instanceof Error ? error.message : String(error)
                }
              };
              res.writeHead(200);  // Use 200 for JSON-RPC errors
              res.end(JSON.stringify(errorResponse));
            }
          });
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });
      
      httpServer.listen(port, host, () => {
        console.error(`Memory MCP Server running on HTTP at http://${host}:${port}/`);
      });
      
    } else {
      // Use stdio transport
      const serverTransport = new StdioServerTransport();
      await server.connect(serverTransport);
      console.error("Memory MCP Server running on stdio");
    }
    
  } catch (error) {
    console.error("Failed to start server:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.error('Received SIGINT, shutting down gracefully...');
  await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Received SIGTERM, shutting down gracefully...');
  await db.close();
  process.exit(0);
});

main().catch(async (error) => {
  console.error("Fatal error in main():", error instanceof Error ? error.message : String(error));
  await db.close();
  process.exit(1);
});