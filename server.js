require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const bodyParser = require('body-parser');

const config = require('./src/config/env');
const GameSessionManager = require('./src/managers/GameSessionManager');
const { router: adminRouter, adminAuth } = require('./src/routes/admin.routes');
const gamesRouter = require('./src/routes/games.routes');
const winnersRouter = require('./src/routes/winners.routes');
const userRouter = require('./src/routes/user.routes');
const registerPlayerEvents = require('./src/sockets/playerEvents');
const registerAdminEvents = require('./src/sockets/adminEvents');

// --- CONFIGURACIÓN ---
const app = express();

app.use(cors({
    origin: config.ALLOWED_ORIGIN
}));
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: config.ALLOWED_ORIGIN }
});

// --- INICIALIZAR MANAGERS ---
const sessionManager = new GameSessionManager();

// --- RUTAS HTTP ---
app.use('/api', adminRouter);
app.use('/api/list-games', userRouter);
app.use('/api/games', adminAuth, gamesRouter);
app.use('/api/winners', adminAuth, winnersRouter);

// --- EVENTOS SOCKET.IO ---
registerPlayerEvents(io, sessionManager);
registerAdminEvents(io, sessionManager);

// '0.0.0.0'
server.listen(config.PORT, () => {
    console.log(`🚀 Backend corriendo en puerto ${config.PORT}`);
});

module.exports = { app, server, io, sessionManager };