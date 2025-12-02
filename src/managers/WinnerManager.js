const db = require('../../db');

/**
 * Gestiona la selección y persistencia de ganadores
 */
class WinnerManager {
    /**
     * Selecciona ganadores de una pregunta basándose en velocidad
     * @param {Array} correctAnswers - Respuestas correctas ordenadas por tiempo
     * @param {Object} gameSettings - Configuración del juego
     * @param {string|number} gameId - ID del juego
     * @param {number} questionIdx - Índice de la pregunta
     * @returns {Promise<Array>} Lista de ganadores
     */
    static async selectQuestionWinners(correctAnswers, gameSettings, gameId, questionIdx) {
        const { winners = 1, avoid_winners = true } = gameSettings;
        console.log(`[WinnerManager] Selecting winners. Settings: winners=${winners}, avoid=${avoid_winners}`);
        console.log(`[WinnerManager] Correct answers candidates: ${correctAnswers.length}`);

        const roundWinners = [];
        let winnersCount = 0;

        for (const answer of correctAnswers) {
            if (winnersCount >= winners) break;

            const player = answer.player;
            if (!player) continue;

            // Si avoid_winners es true, verificar si el jugador ya ganó antes
            if (avoid_winners) {
                const hasWonBefore = await this.hasPlayerWonBefore(player.playerId || player.id);
                if (hasWonBefore) {
                    console.log(`[WinnerManager] Player ${player.name} skipped (already won)`);
                    continue; // Saltar este jugador
                }
            }

            roundWinners.push(player);

            // Guardar ganador en DB
            await this.saveWinner(gameId, player, questionIdx);

            winnersCount++;
        }

        console.log(`[WinnerManager] Selected ${roundWinners.length} winners`);
        return roundWinners;
    }

    /**
     * Selecciona ganadores aleatorios para juegos tipo lottery
     * @param {Array} allPlayers - Todos los jugadores conectados
     * @param {Object} gameSettings - Configuración del juego
     * @param {string|number} gameId - ID del juego
     * @returns {Promise<Array>} Lista de ganadores
     */
    static async selectLotteryWinners(allPlayers, gameSettings, gameId) {
        const { winners = 3, avoid_winners = true } = gameSettings;
        const roundWinners = [];

        // Crear copia del array de jugadores
        let availablePlayers = [...allPlayers];

        // Filtrar jugadores que ya ganaron si avoid_winners está activo
        if (avoid_winners) {
            const filteredPlayers = [];
            for (const player of availablePlayers) {
                const hasWon = await this.hasPlayerWonBefore(player.playerId || player.id);
                if (!hasWon) {
                    filteredPlayers.push(player);
                }
            }
            availablePlayers = filteredPlayers;
        }

        if (availablePlayers.length === 0) {
            throw new Error('No hay jugadores disponibles para el sorteo');
        }

        // Seleccionar ganadores aleatorios
        const numWinners = Math.min(winners, availablePlayers.length);

        for (let i = 0; i < numWinners; i++) {
            const randomIndex = Math.floor(Math.random() * availablePlayers.length);
            const winner = availablePlayers[randomIndex];

            roundWinners.push(winner);

            // Guardar ganador en DB (question_idx = NULL para lottery)
            await this.saveWinner(gameId, winner, null);

            // Remover del array para no seleccionarlo de nuevo
            availablePlayers.splice(randomIndex, 1);
        }

        return roundWinners;
    }

    /**
     * Verifica si un jugador ya ganó en cualquier juego anterior
     * @param {string} playerId - ID del jugador
     * @returns {Promise<boolean>} true si ya ganó antes
     */
    static async hasPlayerWonBefore(playerId) {
        const result = await db.query(
            "SELECT COUNT(*) as count FROM winners WHERE player_id = $1",
            [playerId]
        );
        return parseInt(result.rows[0].count) > 0;
    }

    /**
     * Guarda un ganador en la base de datos
     * @param {string|number} gameId - ID del juego
     * @param {Object} player - Datos del jugador
     * @param {number|null} questionIdx - Índice de la pregunta (null para lottery)
     */
    static async saveWinner(gameId, player, questionIdx) {
        await db.query(
            "INSERT INTO winners (game_id, player_id, player_name, question_idx) VALUES ($1, $2, $3, $4)",
            [gameId, player.playerId || player.id, player.name, questionIdx]
        );
    }
}

module.exports = WinnerManager;
