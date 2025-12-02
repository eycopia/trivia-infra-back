const WinnerManager = require('../managers/WinnerManager');

/**
 * Maneja la lógica de juegos tipo "questions"
 */
class QuestionGameHandler {
    /**
     * Inicia una nueva pregunta
     * @param {Object} session - Sesión del juego
     * @param {number} qIndex - Índice de la pregunta
     * @param {Object} io - Instancia de Socket.IO
     * @param {string|number} gameId - ID del juego
     */
    static startQuestion(session, qIndex, io, gameId) {
        if (!session.questions[qIndex]) {
            throw new Error(`Pregunta con índice ${qIndex} no encontrada`);
        }

        session.status = 'QUESTION';
        session.currentQuestionIdx = qIndex;
        session.questionStartTime = Date.now();
        session.currentAnswers = [];
        // console.log("dentro de question! ", session)
        // Limpiar flag de respuesta
        Object.values(session.players).forEach(p => p.hasAnsweredThisRound = false);
        //console.log("start question: ", qIndex);
        // Enviar pregunta a todos los jugadores
        io.to(`game_${gameId}`).emit('NEW_QUESTION', {
            t: session.questions[qIndex].t,
            options: session.questions[qIndex].options
        });
    }

    /**
     * Procesa la respuesta de un jugador
     * @param {Object} session - Sesión del juego
     * @param {string} socketId - ID del socket del jugador
     * @param {number} answerIdx - Índice de la respuesta
     * @returns {boolean} true si la respuesta fue procesada
     */
    static submitAnswer(session, socketId, answerIdx) {
        if (session.status !== 'QUESTION') {
            return false;
        }

        const player = session.players[socketId];
        if (!player || player.hasAnsweredThisRound) {
            return false;
        }

        player.hasAnsweredThisRound = true;

        session.currentAnswers.push({
            socketId: socketId,
            answerIdx: answerIdx,
            timeDelta: Date.now() - session.questionStartTime,
            player: player
        });

        return true;
    }

    /**
     * Cierra la pregunta actual y determina ganadores
     * @param {Object} session - Sesión del juego
     * @param {Object} io - Instancia de Socket.IO
     * @param {string|number} gameId - ID del juego
     * @returns {Promise<Object>} Resultado de la ronda
     */
    static async closeQuestion(session, io, gameId) {
        session.status = 'RESULT';
        const currentQ = session.questions[session.currentQuestionIdx];
        const correctAnswer = currentQ.ans;

        // Filtrar respuestas correctas y ordenar por velocidad
        const correctOnes = session.currentAnswers
            .filter(a => a.answerIdx === correctAnswer)
            .sort((a, b) => a.timeDelta - b.timeDelta);

        // Seleccionar ganadores usando WinnerManager
        const roundWinners = await WinnerManager.selectQuestionWinners(
            correctOnes,
            session.gameSettings,
            gameId,
            session.currentQuestionIdx
        );

        // Preparar y enviar resultados
        const resultPayload = {
            correctIdx: correctAnswer,
            roundWinners: roundWinners
        };
        session.lastRoundResult = resultPayload;
        io.to(`game_${gameId}`).emit('ROUND_RESULTS', resultPayload);

        // Enviar leaderboard (top 5 por velocidad en esta ronda)
        const leaderboard = correctOnes
            .slice(0, 5)
            .map(a => ({
                ...a.player,
                timeDelta: a.timeDelta
            }));

        io.to(`game_${gameId}`).emit('LEADERBOARD_UPDATE', leaderboard);

        return resultPayload;
    }
}

module.exports = QuestionGameHandler;
