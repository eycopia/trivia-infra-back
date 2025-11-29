const WinnerManager = require('../managers/WinnerManager');

/**
 * Maneja la lógica de juegos tipo "lottery"
 */
class LotteryGameHandler {
    /**
     * Ejecuta el sorteo de un juego tipo lottery
     * @param {Object} session - Sesión del juego
     * @param {Object} io - Instancia de Socket.IO
     * @param {string|number} gameId - ID del juego
     * @returns {Promise<Object>} Resultado del sorteo
     */
    static async executeLottery(session, io, gameId) {
        // Verificar que sea un juego tipo lottery
        if (session.gameSettings.game_kind !== 'lottery') {
            throw new Error('Este juego no es tipo lottery');
        }

        session.status = 'RESULT';

        // Obtener todos los jugadores conectados
        const allPlayers = Object.values(session.players);

        if (allPlayers.length === 0) {
            throw new Error('No hay jugadores conectados para el sorteo');
        }

        // Seleccionar ganadores usando WinnerManager
        const lotteryWinners = await WinnerManager.selectLotteryWinners(
            allPlayers,
            session.gameSettings,
            gameId
        );

        // Preparar y enviar resultados
        const resultPayload = {
            lotteryWinners: lotteryWinners,
            isLottery: true
        };
        session.lastRoundResult = resultPayload;
        io.to(`game_${gameId}`).emit('LOTTERY_RESULTS', resultPayload);

        return resultPayload;
    }
}

module.exports = LotteryGameHandler;
