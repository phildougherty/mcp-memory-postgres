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
      process.exit(-1);
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

  public async initializeDatabase(): Promise<void> {
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
        console.log('Database not initialized. Running migrations...');
        await this.runMigrations();
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
      const migrationPath = path.join(__dirname, '../../migrations/001_initial_schema.sql');
      const migrationSQL = await fs.readFile(migrationPath, 'utf-8');
      
      await client.query('BEGIN');
      await client.query(migrationSQL);
      await client.query('COMMIT');
      
      console.log('Database migrations completed successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error running migrations:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}
