-- Create entities table
CREATE TABLE entities (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    entity_type TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create observations table  
CREATE TABLE observations (
    id SERIAL PRIMARY KEY,
    entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create relations table
CREATE TABLE relations (
    id SERIAL PRIMARY KEY,
    from_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
    to_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(from_entity_id, to_entity_id, relation_type)
);

-- Create indexes for performance
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_observations_entity_id ON observations(entity_id);
CREATE INDEX idx_relations_from ON relations(from_entity_id);
CREATE INDEX idx_relations_to ON relations(to_entity_id);
CREATE INDEX idx_relations_type ON relations(relation_type);

-- Full-text search index for observations
CREATE INDEX idx_observations_content_fts ON observations USING gin(to_tsvector('english', content));
CREATE INDEX idx_entities_name_fts ON entities USING gin(to_tsvector('english', name));

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_entities_updated_at BEFORE UPDATE ON entities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
