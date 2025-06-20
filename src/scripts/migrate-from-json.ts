#!/usr/bin/env node
import { promises as fs } from 'fs';
import { DatabaseConnection } from '../src/database.js';
import { DatabaseKnowledgeGraphManager } from '../src/index.js';

interface JsonEntity {
  type: 'entity';
  name: string;
  entityType: string;
  observations: string[];
}

interface JsonRelation {
  type: 'relation';
  from: string;
  to: string;
  relationType: string;
}

async function migrateFromJson(jsonFilePath: string) {
  const db = DatabaseConnection.getInstance();
  const manager = new DatabaseKnowledgeGraphManager();

  try {
    // Initialize database
    await db.initializeDatabase();

    console.log(`Reading from ${jsonFilePath}...`);
    const data = await fs.readFile(jsonFilePath, 'utf-8');
    const lines = data.split('\n').filter(line => line.trim() !== '');

    const entities: JsonEntity[] = [];
    const relations: JsonRelation[] = [];

    // Parse JSON lines
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.type === 'entity') {
          entities.push(item as JsonEntity);
        } else if (item.type === 'relation') {
          relations.push(item as JsonRelation);
        }
      } catch (error) {
        console.warn(`Skipping invalid JSON line: ${line}`);
      }
    }

    console.log(`Found ${entities.length} entities and ${relations.length} relations`);

    // Migrate entities first
    if (entities.length > 0) {
      console.log('Migrating entities...');
      const entityData = entities.map(e => ({
        name: e.name,
        entityType: e.entityType,
        observations: e.observations
      }));
      
      await manager.createEntities(entityData);
      console.log(`Migrated ${entities.length} entities`);
    }

    // Then migrate relations
    if (relations.length > 0) {
      console.log('Migrating relations...');
      const relationData = relations.map(r => ({
        from: r.from,
        to: r.to,
        relationType: r.relationType
      }));
      
      await manager.createRelations(relationData);
      console.log(`Migrated ${relations.length} relations`);
    }

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Get JSON file path from command line args
const jsonFilePath = process.argv[2];
if (!jsonFilePath) {
  console.error('Usage: npm run migrate-from-json <path-to-memory.json>');
  process.exit(1);
}

migrateFromJson(jsonFilePath);
