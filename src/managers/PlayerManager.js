const db = require('../../db');

/**
 * Gestiona jugadores en las sesiones de juego
 */
class PlayerManager {
    /**
     * Agrega un jugador a la sesión o reconecta uno existente
     * @param {Object} session - Sesión del juego
     * @param {string} socketId - ID del socket
     * @param {Object} playerData - Datos del jugador {name, extra, avatar, playerId}
     * @returns {Object} El jugador agregado o reconectado
     */
    static addOrReconnectPlayer(session, socketId, playerData) {
        const { name, extra, avatar, playerId } = playerData;

        // Verificar si ya existe este jugador (Reconexión)
        let existingPlayer = null;
        if (playerId) {
            existingPlayer = Object.values(session.players).find(p => p.playerId === playerId);
        }

        if (existingPlayer) {
            // RECONEXIÓN: Actualizar socketId pero mantener estado
            delete session.players[existingPlayer.id];
            existingPlayer.id = socketId;
            session.players[socketId] = existingPlayer;
            console.log(`Jugador ${name} reconectado (Socket: ${socketId})`);
            return existingPlayer;
        } else {
            // NUEVO JUGADOR
            const newPlayer = {
                id: socketId,
                playerId: playerId || socketId,
                name,
                extra,
                avatar
            };
            session.players[socketId] = newPlayer;

            // Persistir jugador en DB
            this.persistPlayer(newPlayer).catch(err =>
                console.error('Error guardando jugador:', err)
            );

            return newPlayer;
        }
    }

    /**
     * Persiste un jugador en la base de datos
     * @param {Object} player - Datos del jugador
     */
    static async persistPlayer(player) {
        await db.query(
            `INSERT INTO players (id, name, extra, avatar) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (id) DO UPDATE SET name = $2, extra = $3, avatar = $4`,
            [player.playerId, player.name, player.extra, player.avatar]
        );
    }

    /**
     * Obtiene el conteo de jugadores en una sesión
     * @param {Object} session - Sesión del juego
     * @returns {number} Número de jugadores
     */
    static getPlayerCount(session) {
        return Object.keys(session.players).length;
    }
}

module.exports = PlayerManager;
