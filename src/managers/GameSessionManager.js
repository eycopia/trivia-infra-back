const db = require('../../db');

/**
 * Gestiona las sesiones de juego en memoria
 */
class GameSessionManager {
    constructor() {
        this.sessions = {};
    }

    /**
     * Obtiene o crea una sesión de juego
     * @param {string|number} gameId - ID del juego
     * @returns {Object} La sesión del juego
     */
    getOrCreateSession(gameId) {
        if (!this.sessions[gameId]) {
            this.sessions[gameId] = {
                status: 'WAITING', // WAITING, QUESTION, RESULT
                currentQuestionIdx: -1,
                questionStartTime: 0,
                players: {},
                currentAnswers: [],
                questions: [],
                gameSettings: {}
            };
        }
        return this.sessions[gameId];
    }

    /**
     * Carga la configuración y preguntas del juego desde la DB
     * @param {string|number} gameId - ID del juego
     * @returns {Promise<Object>} La sesión cargada
     */
    async loadGameData(gameId) {
        const session = this.getOrCreateSession(gameId);

        // Si ya hay preguntas cargadas, retornar sesión existente
        if (session.questions && session.questions.length > 0) {
            return session;
        }

        // Cargar juego y preguntas de la DB
        const [gameResult, questionsResult] = await Promise.all([
            db.query("SELECT * FROM games WHERE id = $1", [gameId]),
            db.query("SELECT * FROM questions WHERE game_id = $1 ORDER BY id ASC", [gameId])
        ]);

        if (gameResult.rows.length === 0) {
            throw new Error(`Juego con id ${gameId} no encontrado`);
        }

        const game = gameResult.rows[0];
        session.gameSettings = {
            avoid_winners: game.avoid_winners,
            total_winners: game.total_winners,
            winners: game.winners,
            game_kind: game.game_kind
        };

        session.questions = questionsResult.rows.map(r => ({
            id: r.id,
            t: r.text,
            options: JSON.parse(r.options),
            ans: r.answer_idx
        }));

        // Resetear estado
        session.status = 'WAITING';
        session.currentQuestionIdx = -1;

        return session;
    }

    /**
     * Cambia el estado de una sesión
     * @param {string|number} gameId - ID del juego
     * @param {string} status - Nuevo estado
     */
    setStatus(gameId, status) {
        const session = this.sessions[gameId];
        if (session) {
            session.status = status;
        }
    }

    /**
     * Obtiene una sesión existente
     * @param {string|number} gameId - ID del juego
     * @returns {Object|null} La sesión o null si no existe
     */
    getSession(gameId) {
        return this.sessions[gameId] || null;
    }
}

module.exports = GameSessionManager;
