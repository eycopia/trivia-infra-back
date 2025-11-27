const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');

// --- CONFIGURACIÓN ---
const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // Permite conexiones desde cualquier IP (necesario para móviles)
});

// --- SEGURIDAD ADMIN ---
const ADMIN_PASSWORD = "admin123"; // ¡CAMBIA ESTO!
const ADMIN_TOKEN = "TOKEN_SECRETO_DEL_EVENTO_2024";

// --- BASE DE DATOS (SQLite) ---
const db = new sqlite3.Database('./trivia.db');

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

    // 3. ADMIN: Iniciar Juego (Cargar preguntas)
    socket.on('ADMIN_INIT_GAME', (data) => {
        const { token, gameId } = data;
        if (token !== ADMIN_TOKEN) return;

        socket.join(`game_${gameId}`); // <--- FIX: Unir al admin a la sala para recibir eventos

        // Cargar preguntas de la DB para este juego
        db.all("SELECT * FROM questions WHERE game_id = ?", [gameId], (err, rows) => {
            if (err) return;
            const session = getOrCreateGameSession(gameId);
            session.questions = rows.map(r => ({
                t: r.text,
                options: JSON.parse(r.options),
                ans: r.answer_idx
            }));
            // Resetear estado
            session.status = 'WAITING';
            session.currentQuestionIdx = -1;
            session.players = {}; // Ojo: esto desconecta lógicamente a jugadores si ya estaban, mejor no borrar si queremos persistencia de conexión
            // En realidad, mejor no borrar players si ya se unieron en el lobby
            // session.players = {}; 

            io.to(`game_${gameId}`).emit('GAME_STATUS', { status: 'WAITING' });
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
            if (session.players[a.socketId]) {
                session.players[a.socketId].score += points;
            }
        });

        // B. GANADORES INMEDIATOS (Top 3 de la ronda que no hayan ganado antes)
        let roundWinners = [];
        let winnersCount = 0;

        for (let a of correctOnes) {
            if (winnersCount >= 3) break;

            if (!a.player.hasWonInstant) {
                a.player.hasWonInstant = true;
                session.players[a.socketId].hasWonInstant = true;

                roundWinners.push(a.player);

                // Guardar premio en DB
                db.run("INSERT INTO winners (game_id, player_id, player_name, question_idx) VALUES (?, ?, ?, ?)",
                    [gameId, a.socketId, a.player.name, session.currentQuestionIdx]);

                winnersCount++;
            }
        }

        // Enviar resultados
        io.to(`game_${gameId}`).emit('ROUND_RESULTS', {
            correctIdx: correctAnswer,
            roundWinners: roundWinners
        });

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