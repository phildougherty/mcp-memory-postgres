import { Pool, PoolClient } from 'pg';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private pool: Pool;

  private constructor() {
    const connectionString = process.env.DATABASE_URL || 
      'postgresql://postgres:password@localhost:5432/memory_graph';
    
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection on startup
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  public getPool(): Pool {
    return this.pool;
  }

  public async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  public async query(text: string, params?: any[]) {
    return this.pool.query(text, params);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  // Add retry logic for database connection
  private async waitForDatabase(maxRetries: number = 30): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const client = await this.getClient();
        await client.query('SELECT 1');
        client.release();
        console.error('Database connection established');
        return;
      } catch (error) {
        console.error(`Database connection attempt ${i + 1}/${maxRetries} failed:`, error instanceof Error ? error.message : String(error));
        if (i === maxRetries - 1) {
          throw new Error('Failed to connect to database after maximum retries');
        }
        // Wait 2 seconds before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  public async initializeDatabase(): Promise<void> {
    // Wait for database to be available
    await this.waitForDatabase();

    const client = await this.getClient();
    try {
      // Check if entities table exists
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'entities'
        );
      `);

      if (!result.rows[0].exists) {
        console.error('Database not initialized. Running migrations...');
        await this.runMigrations();
      } else {
        console.error('Database already initialized');
      }
    } catch (error) {
      console.error('Error checking database state:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async runMigrations(): Promise<void> {
    const client = await this.getClient();
    try {
      const migrationPath = path.join(__dirname, '../migrations/001_initial_schema.sql');
      
      let migrationSQL: string;
      try {
        migrationSQL = await fs.readFile(migrationPath, 'utf-8');
      } catch (error) {
        // If migration file doesn't exist, create the schema inline
        console.error('Migration file not found, creating schema inline...');
        migrationSQL = `
          -- Create entities table
          CREATE TABLE IF NOT EXISTS entities (
              id SERIAL PRIMARY KEY,
              name TEXT UNIQUE NOT NULL,
              entity_type TEXT NOT NULL,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
          );

          -- Create observations table  
          CREATE TABLE IF NOT EXISTS observations (
              id SERIAL PRIMARY KEY,
              entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
              content TEXT NOT NULL,
              created_at TIMESTAMP DEFAULT NOW()
          );

          -- Create relations table
          CREATE TABLE IF NOT EXISTS relations (
              id SERIAL PRIMARY KEY,
              from_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
              to_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
              relation_type TEXT NOT NULL,
              created_at TIMESTAMP DEFAULT NOW(),
              UNIQUE(from_entity_id, to_entity_id, relation_type)
          );

          -- Create indexes for performance
          CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
          CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
          CREATE INDEX IF NOT EXISTS idx_observations_entity_id ON observations(entity_id);
          CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity_id);
          CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity_id);
          CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);

          -- Full-text search index for observations
          CREATE INDEX IF NOT EXISTS idx_observations_content_fts ON observations USING gin(to_tsvector('english', content));
          CREATE INDEX IF NOT EXISTS idx_entities_name_fts ON entities USING gin(to_tsvector('english', name));

          -- Function to update updated_at timestamp
          CREATE OR REPLACE FUNCTION update_updated_at_column()
          RETURNS TRIGGER AS $$
          BEGIN
              NEW.updated_at = NOW();
              RETURN NEW;
          END;
          $$ language 'plpgsql';

          -- Trigger to automatically update updated_at
          DROP TRIGGER IF EXISTS update_entities_updated_at ON entities;
          CREATE TRIGGER update_entities_updated_at BEFORE UPDATE ON entities
              FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `;
      }
      
      await client.query('BEGIN');
      await client.query(migrationSQL);
      await client.query('COMMIT');
      
      console.error('Database migrations completed successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error running migrations:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}