-- Script de inicialización de base de datos PostgreSQL para Trivia App
-- Ejecutar este script en tu base de datos de Neon una sola vez
CREATE TYPE game_kind_enum AS ENUM ('questions', 'lottery');
-- Tabla de Juegos
CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    title TEXT,
    description TEXT,
    winners SMALLINT,
    game_kind game_kind_enum,
    avoid_winners boolean default true,
    total_winners SMALLINT default 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Preguntas
CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    text TEXT,
    options TEXT, -- JSON string
    answer_idx INTEGER
);

-- Tabla de Jugadores
CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT,
    extra TEXT,
    avatar TEXT,
    score INTEGER DEFAULT 0
);

-- Tabla de Ganadores Inmediatos
CREATE TABLE IF NOT EXISTS winners (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    player_id TEXT,
    player_name TEXT,
    question_idx INTEGER,
    claimed BOOLEAN DEFAULT FALSE
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_questions_game_id ON questions(game_id);
CREATE INDEX IF NOT EXISTS idx_winners_game_id ON winners(game_id);
CREATE INDEX IF NOT EXISTS idx_winners_claimed ON winners(claimed);
