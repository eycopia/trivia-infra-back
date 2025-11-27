require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit'); // Added for rate limiting

// --- CONFIGURACIÓN ---
const app = express();

// Rate Limiting para prevenir ataques de fuerza bruta o abuso de API
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    message: "Too many requests from this IP, please try again after 15 minutes"
});

app.use(limiter);

app.use(cors({
    origin: process.env.ALLOWED_ORIGIN
}));
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: process.env.ALLOWED_ORIGIN }
});

// --- SEGURIDAD ADMIN ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

// --- BASE DE DATOS (SQLite) ---
const db = new sqlite3.Database('./trivia.db', (err) => {
    if (err) {
        console.error("Error opening database:", err.message);
    } else {
        console.log("Connected to the SQLite database. (File will be created if it doesn't exist)");
    }
});

db.serialize(() => {
    // Tabla Juegos
    db.run(`CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabla Preguntas
    db.run(`CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER,
        text TEXT,
        options TEXT, -- JSON string
        answer_idx INTEGER,
        FOREIGN KEY(game_id) REFERENCES games(id)
    )`);

    // Tabla Jugadores (Ahora vinculados a un juego, aunque por simplicidad socket room maneja el estado)
    db.run(`CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, 
        name TEXT, 
        extra TEXT, 
        avatar TEXT, 
        score INTEGER DEFAULT 0
    )`);

    // Tabla Ganadores Inmediatos
    db.run(`CREATE TABLE IF NOT EXISTS winners (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        game_id INTEGER,
        player_id TEXT, 
        player_name TEXT, 
        question_idx INTEGER, 
        claimed BOOLEAN DEFAULT 0
    )`);
});

// --- ESTADO DEL JUEGO (En Memoria) ---
// Ahora soportamos múltiples juegos. Key: gameId (string/int), Value: GameState
const gameSessions = {};

function getOrCreateGameSession(gameId) {
    if (!gameSessions[gameId]) {
        gameSessions[gameId] = {
            status: 'WAITING', // WAITING, QUESTION, RESULT
            currentQuestionIdx: -1,
            questionStartTime: 0,
            players: {}, // Cache rápido de jugadores conectados en este juego
            currentAnswers: [], // Respuestas de la ronda actual
            questions: [] // Las cargaremos de la DB al iniciar
        };
    }
    return gameSessions[gameId];
}

// --- ENDPOINTS HTTP ---

// Login Admin
app.post('/api/admin-login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        res.json({ success: true, token: ADMIN_TOKEN });
    } else {
        res.status(401).json({ success: false });
    }
});

// Middleware de Auth Admin
const adminAuth = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === ADMIN_TOKEN) next();
    else res.status(401).json({ error: 'Unauthorized' });
};

// CRUD Juegos
app.get('/api/games', (req, res) => {
    db.all("SELECT * FROM games ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/games', adminAuth, (req, res) => {
    const { title, description } = req.body;
    db.run("INSERT INTO games (title, description) VALUES (?, ?)", [title, description], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, title, description });
    });
});

// CRUD Preguntas
app.get('/api/games/:id/questions', (req, res) => {
    db.all("SELECT * FROM questions WHERE game_id = ?", [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Parse options JSON
        const questions = rows.map(r => ({
            ...r,
            options: JSON.parse(r.options)
        }));
        res.json(questions);
    });
});

app.post('/api/games/:id/questions', adminAuth, (req, res) => {
    const { text, options, answer_idx } = req.body;
    const gameId = req.params.id;
    db.run("INSERT INTO questions (game_id, text, options, answer_idx) VALUES (?, ?, ?, ?)",
        [gameId, text, JSON.stringify(options), answer_idx],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            // Si la sesión está activa, actualizar preguntas en memoria (opcional, pero bueno para consistencia)
            if (gameSessions[gameId]) {
                // Recargar preguntas es complejo si el juego corre, mejor solo para juegos nuevos/reiniciados
            }
            res.json({ id: this.lastID });
        });
});

// Ganadores
app.get('/api/winners', adminAuth, (req, res) => {
    db.all("SELECT * FROM winners ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/winners/:id/claim', adminAuth, (req, res) => {
    db.run("UPDATE winners SET claimed = 1 WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


// --- SOCKET.IO LOGICA ---
io.on('connection', (socket) => {

    // 1. JUGADOR: Entrar al juego
    socket.on('JOIN_GAME', (data) => {
        // data: { gameId, name, extra, avatar, playerId }
        const { gameId, name, extra, avatar, playerId } = data;

        if (!gameId) return;

        socket.join(`game_${gameId}`);

        const session = getOrCreateGameSession(gameId);

        // Verificar si ya existe este jugador (Reconexión)
        let existingPlayer = null;
        if (playerId) {
            // Buscar por playerId en los valores del objeto players
            existingPlayer = Object.values(session.players).find(p => p.playerId === playerId);
        }

        if (existingPlayer) {
            // RECONEXIÓN: Actualizar socketId pero mantener puntaje y estado
            // Borrar la entrada anterior del mapa (que tenía el socketId viejo)
            delete session.players[existingPlayer.id];

            // Actualizar ID de socket y volver a guardar
            existingPlayer.id = socket.id;
            session.players[socket.id] = existingPlayer;

            console.log(`Jugador ${name} reconectado (Socket: ${socket.id})`);
        } else {
            // NUEVO JUGADOR
            session.players[socket.id] = {
                id: socket.id,
                playerId: playerId || socket.id, // Si no viene UUID, usar socket.id (fallback)
                name,
                extra,
                avatar,
                score: 0,
                hasWonInstant: false
            };

            // Persistir jugador en DB
            db.run("INSERT OR REPLACE INTO players (id, name, extra, avatar) VALUES (?, ?, ?, ?)",
                [playerId || socket.id, name, extra, avatar]);
        }

        // Avisar a todos en la sala cuantos hay
        io.to(`game_${gameId}`).emit('PLAYERS_UPDATE', Object.keys(session.players).length);

        // Enviar estado actual al que acaba de entrar
        socket.emit('GAME_STATUS', { status: session.status });

        // Si el estado es RESULT, enviar también los resultados de la ronda para que vea si ganó
        if (session.status === 'RESULT' && session.lastRoundResult) {
            socket.emit('ROUND_RESULTS', session.lastRoundResult);
        }
    });

    // 2. JUGADOR: Enviar Respuesta
    socket.on('SUBMIT_ANSWER', (data) => {
        // data: { gameId, answerIdx }
        const { gameId, answerIdx } = data;
        const session = gameSessions[gameId];

        if (!session || session.status !== 'QUESTION') return;

        const player = session.players[socket.id];
        if (!player || player.hasAnsweredThisRound) return;

        player.hasAnsweredThisRound = true;

        session.currentAnswers.push({
            socketId: socket.id,
            answerIdx: answerIdx,
            timeDelta: Date.now() - session.questionStartTime,
            player: player
        });

        socket.emit('ANSWER_RECEIVED');
    });

    // 3. ADMIN: Iniciar Juego (Cargar preguntas) o Reconectar
    socket.on('ADMIN_INIT_GAME', (data) => {
        const { token, gameId } = data;
        if (token !== ADMIN_TOKEN) return;

        socket.join(`game_${gameId}`);

        const session = getOrCreateGameSession(gameId);

        // Si ya hay preguntas cargadas, asumimos que el juego está en curso o listo
        if (session.questions && session.questions.length > 0) {
            // RECONEXIÓN ADMIN
            socket.emit('GAME_STATE_SYNC', {
                status: session.status,
                currentQIndex: session.currentQuestionIdx,
                questions: session.questions,
                playerCount: Object.keys(session.players).length,
                currentQuestion: session.currentQuestionIdx >= 0 ? session.questions[session.currentQuestionIdx] : null,
                lastRoundResult: session.lastRoundResult
            });

            // Si estamos en medio de una pregunta, enviar también el tiempo restante o estado
            if (session.status === 'QUESTION') {
                // Podríamos enviar el tiempo restante si lo trackearamos en el server
            }

            return;
        }

        // INICIO NUEVO (Cargar preguntas de la DB)
        db.all("SELECT * FROM questions WHERE game_id = ?", [gameId], (err, rows) => {
            if (err) return;

            session.questions = rows.map(r => ({
                t: r.text,
                options: JSON.parse(r.options),
                ans: r.answer_idx
            }));
            // Resetear estado
            session.status = 'WAITING';
            session.currentQuestionIdx = -1;
            // session.players = {}; // NO borrar jugadores, podrían estar esperando en el lobby

            io.to(`game_${gameId}`).emit('GAME_STATUS', { status: 'WAITING' });

            // Enviar confirmación al admin
            socket.emit('GAME_STATE_SYNC', {
                status: 'WAITING',
                currentQIndex: 0,
                questions: session.questions,
                playerCount: Object.keys(session.players).length
            });
        });
    });

    // 4. ADMIN: Iniciar Pregunta
    socket.on('ADMIN_START_QUESTION', (data) => {
        const { token, gameId, qIndex } = data;
        if (token !== ADMIN_TOKEN) return;

        const session = gameSessions[gameId];
        if (!session || !session.questions[qIndex]) return;

        session.status = 'QUESTION';
        session.currentQuestionIdx = qIndex;
        session.questionStartTime = Date.now();
        session.currentAnswers = []; // Limpiar anteriores

        // Limpiar flag de respuesta
        Object.values(session.players).forEach(p => p.hasAnsweredThisRound = false);

        // Enviar pregunta
        io.to(`game_${gameId}`).emit('NEW_QUESTION', {
            t: session.questions[qIndex].t,
            options: session.questions[qIndex].options
        });
    });

    // 5. ADMIN: Cerrar Pregunta
    socket.on('ADMIN_CLOSE_QUESTION', (data) => {
        const { token, gameId } = data;
        if (token !== ADMIN_TOKEN) return;

        const session = gameSessions[gameId];
        if (!session) return;

        session.status = 'RESULT';
        const currentQ = session.questions[session.currentQuestionIdx];
        const correctAnswer = currentQ.ans;

        // Filtrar correctas
        const correctOnes = session.currentAnswers
            .filter(a => a.answerIdx === correctAnswer)
            .sort((a, b) => a.timeDelta - b.timeDelta);

        // A. PUNTOS
        correctOnes.forEach(a => {
            let points = Math.max(10, 1000 - Math.floor(a.timeDelta / 20));
            // Usar la referencia al objeto jugador para asegurar que si cambió de socket (reconectó) se actualice el score correcto
            if (a.player) {
                a.player.score += points;
            }
        });

        // B. GANADORES INMEDIATOS (Top 3 de la ronda que no hayan ganado antes)
        let roundWinners = [];
        let winnersCount = 0;

        for (let a of correctOnes) {
            if (winnersCount >= 3) break;

            if (!a.player.hasWonInstant) {
                a.player.hasWonInstant = true;
                // session.players[a.socketId] apunta al mismo objeto a.player, así que ya está actualizado

                roundWinners.push(a.player);

                // Guardar premio en DB - Usamos playerId (UUID) si existe, o socketId como fallback
                db.run("INSERT INTO winners (game_id, player_id, player_name, question_idx) VALUES (?, ?, ?, ?)",
                    [gameId, a.player.playerId || a.socketId, a.player.name, session.currentQuestionIdx]);

                winnersCount++;
            }
        }

        // Enviar resultados
        const resultPayload = {
            correctIdx: correctAnswer,
            roundWinners: roundWinners
        };
        session.lastRoundResult = resultPayload; // Guardar para reconexiones
        io.to(`game_${gameId}`).emit('ROUND_RESULTS', resultPayload);

        // Enviar Leaderboard
        const leaderboard = Object.values(session.players)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

        io.to(`game_${gameId}`).emit('LEADERBOARD_UPDATE', leaderboard);
    });
});

server.listen(3000, () => {
    console.log('🚀 Backend corriendo en puerto 3000');
});