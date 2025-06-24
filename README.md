# MCP Memory Server (PostgreSQL)

A Model Context Protocol (MCP) server that enables persistent memory capabilities for Claude through a knowledge graph stored in PostgreSQL. This server allows AI assistants to create, manage, and query a structured knowledge base of entities, observations, and relationships.

## Features

- **PostgreSQL Backend**: Robust, scalable database storage for knowledge graphs
- **Entity Management**: Create and manage entities with types and observations
- **Relationship Mapping**: Define and query relationships between entities
- **Full-text Search**: Advanced search capabilities across entities and observations
- **Multiple Transports**: Support for both stdio and HTTP transports
- **Auto-migration**: Automatic database schema setup and migration
- **Docker Support**: Containerized deployment with multi-stage builds

## Architecture

The server implements a knowledge graph structure with three main components:

- **Entities**: Named objects with types and associated observations
- **Observations**: Timestamped content associated with entities
- **Relations**: Typed connections between entities

## Installation

### Prerequisites

- Node.js 22 or higher
- PostgreSQL database
- npm or compatible package manager

### Local Development

```bash
# Clone the repository
git clone <repository-url>
cd mcp-memory-postgres

# Install dependencies
npm install

# Set up environment variables
export DATABASE_URL="postgresql://postgres:password@localhost:5432/memory_graph"

# Build the project
npm run build

# Run the server
npm start
```

### Docker Deployment

```bash
# Build the Docker image
docker build -t mcp-memory-postgres .

# Run with environment variables
docker run -e DATABASE_URL="postgresql://postgres:password@host:5432/memory_graph" \
           -p 3001:3001 \
           mcp-memory-postgres
```

## Configuration

### Environment Variables

- `DATABASE_URL`: PostgreSQL connection string (default: `postgresql://postgres:password@localhost:5432/memory_graph`)
- `NODE_ENV`: Environment mode (development/production)

### Database Setup

The server automatically creates the required database schema on first run, including:

- `entities` table for storing named entities
- `observations` table for timestamped content
- `relations` table for entity relationships
- Indexes for performance optimization
- Full-text search capabilities

## Usage

### Command Line Options

```bash
node dist/index.js [options]

Options:
  --transport <type>  Transport type (stdio, http) [default: stdio]
  --host <host>       Host to bind to (http mode) [default: 0.0.0.0]
  --port <port>       Port to bind to (http mode) [default: 3001]
```

### Transport Modes

#### STDIO Transport
Default mode for integration with MCP clients:
```bash
node dist/index.js --transport stdio
```

#### HTTP Transport
REST API mode with CORS support:
```bash
node dist/index.js --transport http --port 3001
```

## API Reference

The server provides the following MCP tools:

### Entity Management

#### `create_entities`
Create multiple new entities in the knowledge graph.

**Parameters:**
```json
{
  "entities": [
    {
      "name": "string",
      "entityType": "string", 
      "observations": ["string"]
    }
  ]
}
```

#### `delete_entities`
Delete entities and their associated relations.

**Parameters:**
```json
{
  "entityNames": ["string"]
}
```

### Observations

#### `add_observations`
Add new observations to existing entities.

**Parameters:**
```json
{
  "observations": [
    {
      "entityName": "string",
      "contents": ["string"]
    }
  ]
}
```

#### `delete_observations`
Delete specific observations from entities.

**Parameters:**
```json
{
  "deletions": [
    {
      "entityName": "string",
      "observations": ["string"]
    }
  ]
}
```

### Relationships

#### `create_relations`
Create relationships between entities (use active voice).

**Parameters:**
```json
{
  "relations": [
    {
      "from": "string",
      "to": "string",
      "relationType": "string"
    }
  ]
}
```

#### `delete_relations`
Delete specific relationships.

**Parameters:**
```json
{
  "relations": [
    {
      "from": "string",
      "to": "string", 
      "relationType": "string"
    }
  ]
}
```

### Query Operations

#### `read_graph`
Retrieve the entire knowledge graph.

#### `search_nodes`
Search for nodes based on a query string.

**Parameters:**
```json
{
  "query": "string"
}
```

#### `open_nodes`
Retrieve specific nodes by name.

**Parameters:**
```json
{
  "names": ["string"]
}
```

## Database Schema

### Tables

#### entities
- `id` (SERIAL PRIMARY KEY)
- `name` (TEXT UNIQUE NOT NULL)
- `entity_type` (TEXT NOT NULL)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

#### observations  
- `id` (SERIAL PRIMARY KEY)
- `entity_id` (INTEGER REFERENCES entities)
- `content` (TEXT NOT NULL)
- `created_at` (TIMESTAMP)

#### relations
- `id` (SERIAL PRIMARY KEY)
- `from_entity_id` (INTEGER REFERENCES entities)
- `to_entity_id` (INTEGER REFERENCES entities)
- `relation_type` (TEXT NOT NULL)
- `created_at` (TIMESTAMP)
- UNIQUE constraint on (from_entity_id, to_entity_id, relation_type)

## Development

### Build Commands

```bash
# Development build with watch mode
npm run dev
npm run watch

# Production build
npm run build

# Prepare for distribution
npm run prepare
```

### Migration Scripts

```bash
# Run database migrations
npm run migrate

# Migrate from JSON format
npm run migrate-from-json
```

## Production Deployment

### Docker Compose Example

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: memory_graph
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  mcp-memory:
    build: .
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/memory_graph
      NODE_ENV: production
    ports:
      - "3001:3001"
    depends_on:
      - postgres
    command: ["--transport", "http"]

volumes:
  postgres_data:
```

### Health Checking

The HTTP transport mode provides a health endpoint:
```bash
curl http://localhost:3001/health
```

## Error Handling

The server includes comprehensive error handling:

- Database connection retry logic with exponential backoff
- Graceful shutdown on SIGINT/SIGTERM
- Transaction rollback on errors
- Detailed error logging

## Performance Features

- Connection pooling for PostgreSQL
- Indexed searches for fast queries
- Full-text search using PostgreSQL's built-in capabilities
- Efficient batch operations for bulk data operations

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see package.json for details

## Support

For issues and questions, please refer to the project's issue tracker.

---

**Version**: 0.6.3  
**Author**: Anthropic, PBC  
**Homepage**: https://modelcontextprotocol.io