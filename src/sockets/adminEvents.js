const PlayerManager = require('../managers/PlayerManager');
const QuestionGameHandler = require('../handlers/QuestionGameHandler');
const LotteryGameHandler = require('../handlers/LotteryGameHandler');
const config = require('../config/env');

/**
 * Registra los eventos de Socket.IO para administradores
 * @param {Object} io - Instancia de Socket.IO
 * @param {Object} sessionManager - Instancia de GameSessionManager
 */
function registerAdminEvents(io, sessionManager) {
    io.on('connection', (socket) => {

        /**
         * Evento: Admin inicializa el juego
         */
        socket.on('ADMIN_INIT_GAME', async (data) => {
            const { token, gameId } = data;
            if (token !== config.ADMIN_TOKEN) return;

            socket.join(`game_${gameId}`);

            try {
                const session = await sessionManager.loadGameData(gameId);

                // Siempre enviar sincronización, independientemente del tipo de juego
                socket.emit('GAME_STATE_SYNC', {
                    status: session.status,
                    currentQIndex: session.currentQuestionIdx,
                    questions: session.questions || [],
                    playerCount: PlayerManager.getPlayerCount(session),
                    players: Object.values(session.players), // Enviar lista completa de jugadores
                    currentQuestion: (session.questions && session.currentQuestionIdx >= 0)
                        ? session.questions[session.currentQuestionIdx]
                        : null,
                    lastRoundResult: session.lastRoundResult,
                    gameSettings: session.gameSettings
                });

                // Notificar a todos el estado
                io.to(`game_${gameId}`).emit('GAME_STATUS', { status: session.status });

            } catch (err) {
                console.error('Error cargando juego:', err);
                socket.emit('ADMIN_ERROR', { message: err.message });
            }
        });

        /**
         * Evento: Admin inicia una pregunta
         */
        socket.on('ADMIN_START_QUESTION', (data) => {
            const { token, gameId, qIndex } = data;
            if (token !== config.ADMIN_TOKEN) return;

            const session = sessionManager.getSession(gameId);
            if (!session) return;

            try {
                QuestionGameHandler.startQuestion(session, qIndex, io, gameId);
            } catch (err) {
                console.error('Error iniciando pregunta:', err);
                socket.emit('ADMIN_ERROR', { message: err.message });
            }
        });

        /**
         * Evento: Admin cierra una pregunta
         */
        socket.on('ADMIN_CLOSE_QUESTION', async (data) => {
            const { token, gameId } = data;
            if (token !== config.ADMIN_TOKEN) return;

            const session = sessionManager.getSession(gameId);
            if (!session) return;

            try {
                await QuestionGameHandler.closeQuestion(session, io, gameId);
            } catch (err) {
                console.error('Error cerrando pregunta:', err);
                socket.emit('ADMIN_ERROR', { message: err.message });
            }
        });

        /**
         * Evento: Admin inicia sorteo (lottery)
         */
        socket.on('ADMIN_START_LOTTERY', async (data) => {
            const { token, gameId } = data;
            if (token !== config.ADMIN_TOKEN) return;

            const session = sessionManager.getSession(gameId);
            if (!session) return;

            try {
                await LotteryGameHandler.executeLottery(session, io, gameId);
            } catch (err) {
                console.error('Error ejecutando lottery:', err);
                socket.emit('ADMIN_ERROR', { message: err.message });
            }
        });
    });
}

module.exports = registerAdminEvents;
