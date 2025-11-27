require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db');

// --- CONFIGURACIÓN ---
const app = express();

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

// --- BASE DE DATOS (PostgreSQL) ---
// La conexión se maneja en db.js
// Las tablas deben crearse ejecutando init-db.sql en Neon

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
app.get('/api/games', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM games ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/games', adminAuth, async (req, res) => {
    const { title, description } = req.body;
    try {
        const result = await db.query(
            "INSERT INTO games (title, description) VALUES ($1, $2) RETURNING id",
            [title, description]
        );
        res.json({ id: result.rows[0].id, title, description });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CRUD Preguntas
app.get('/api/games/:id/questions', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM questions WHERE game_id = $1", [req.params.id]);
        // Parse options JSON
        const questions = result.rows.map(r => ({
            ...r,
            options: JSON.parse(r.options)
        }));
        res.json(questions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/games/:id/questions', adminAuth, async (req, res) => {
    const { text, options, answer_idx } = req.body;
    const gameId = req.params.id;
    try {
        const result = await db.query(
            "INSERT INTO questions (game_id, text, options, answer_idx) VALUES ($1, $2, $3, $4) RETURNING id",
            [gameId, text, JSON.stringify(options), answer_idx]
        );

        // Si la sesión está activa, actualizar preguntas en memoria (opcional, pero bueno para consistencia)
        if (gameSessions[gameId]) {
            // Recargar preguntas es complejo si el juego corre, mejor solo para juegos nuevos/reiniciados
        }
        res.json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ganadores
app.get('/api/winners', adminAuth, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM winners ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/winners/:id/claim', adminAuth, async (req, res) => {
    try {
        await db.query("UPDATE winners SET claimed = TRUE WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
            db.query(
                "INSERT INTO players (id, name, extra, avatar) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = $2, extra = $3, avatar = $4",
                [playerId || socket.id, name, extra, avatar]
            ).catch(err => console.error('Error guardando jugador:', err));
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
        db.query("SELECT * FROM questions WHERE game_id = $1", [gameId])
            .then(result => {
                session.questions = result.rows.map(r => ({
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
            })
            .catch(err => console.error('Error cargando preguntas:', err));
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
                db.query(
                    "INSERT INTO winners (game_id, player_id, player_name, question_idx) VALUES ($1, $2, $3, $4)",
                    [gameId, a.player.playerId || a.socketId, a.player.name, session.currentQuestionIdx]
                ).catch(err => console.error('Error guardando ganador:', err));

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

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Backend corriendo en puerto ${PORT}`);
});