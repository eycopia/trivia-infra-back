const PlayerManager = require('../managers/PlayerManager');
const QuestionGameHandler = require('../handlers/QuestionGameHandler');

/**
 * Registra los eventos de Socket.IO para jugadores
 * @param {Object} io - Instancia de Socket.IO
 * @param {Object} sessionManager - Instancia de GameSessionManager
 */
function registerPlayerEvents(io, sessionManager) {
    io.on('connection', (socket) => {

        /**
         * Evento: Jugador entra al juego
         */
        socket.on('JOIN_GAME', (data) => {
            const { gameId, name, extra, avatar, playerId } = data;

            if (!gameId) return;

            socket.join(`game_${gameId}`);

            const session = sessionManager.getOrCreateSession(gameId);

            // Agregar o reconectar jugador
            PlayerManager.addOrReconnectPlayer(session, socket.id, {
                name, extra, avatar, playerId
            });

            // Avisar a todos cuántos jugadores hay
            io.to(`game_${gameId}`).emit('PLAYERS_UPDATE', PlayerManager.getPlayerCount(session));

            // Enviar estado actual al que acaba de entrar
            socket.emit('GAME_STATUS', { status: session.status });

            // Si el estado es RESULT, enviar también los resultados
            if (session.status === 'RESULT' && session.lastRoundResult) {
                socket.emit('ROUND_RESULTS', session.lastRoundResult);
            }

            // Si el estado es QUESTION, enviar la pregunta actual
            if (session.status === 'QUESTION' && session.currentQuestionIdx >= 0) {
                const currentQ = session.questions[session.currentQuestionIdx];
                if (currentQ) {
                    socket.emit('NEW_QUESTION', {
                        t: currentQ.t,
                        options: currentQ.options
                    });
                }
            }
        });

        /**
         * Evento: Jugador envía respuesta
         */
        socket.on('SUBMIT_ANSWER', (data) => {
            const { gameId, answerIdx } = data;
            const session = sessionManager.getSession(gameId);

            if (!session) return;

            const success = QuestionGameHandler.submitAnswer(session, socket.id, answerIdx);

            if (success) {
                socket.emit('ANSWER_RECEIVED');
            }
        });

        /**
         * Evento: Desconexión
         */
        socket.on('disconnect', () => {
            const result = sessionManager.removePlayer(socket.id);
            if (result) {
                const { gameId, player } = result;
                const session = sessionManager.getSession(gameId);
                if (session) {
                    // Avisar a todos que el jugador salió (actualizando el conteo)
                    io.to(`game_${gameId}`).emit('PLAYERS_UPDATE', PlayerManager.getPlayerCount(session));
                }
            }
        });
    });
}

module.exports = registerPlayerEvents;
