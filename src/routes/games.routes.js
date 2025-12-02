const express = require('express');
const db = require('../../db');

const router = express.Router();


/**
 * Crear un nuevo juego
 */
router.post('/', async (req, res) => {
    const { title, description, winners, game_kind, avoid_winners } = req.body;
    try {
        const result = await db.query(
            `INSERT INTO games (title, description, winners, game_kind, avoid_winners) 
             VALUES ($1, $2, $3, $4, COALESCE($5, true)) 
             RETURNING *`,
            [title, description, winners, game_kind, avoid_winners]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Obtener preguntas de un juego
 */
router.get('/:id/questions', async (req, res) => {
    try {
        const result = await db.query(
            "SELECT * FROM questions WHERE game_id = $1 ORDER BY id ASC",
            [req.params.id]
        );
        const questions = result.rows.map(r => ({
            ...r,
            options: JSON.parse(r.options)
        }));
        res.json(questions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Crear una pregunta para un juego
 */
router.post('/:id/questions', async (req, res) => {
    const { text, options, answer_idx } = req.body;
    const gameId = req.params.id;
    try {
        const result = await db.query(
            "INSERT INTO questions (game_id, text, options, answer_idx) VALUES ($1, $2, $3, $4) RETURNING id",
            [gameId, text, JSON.stringify(options), answer_idx]
        );
        res.json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Actualizar un juego existente
 */
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { title, description, winners, game_kind, avoid_winners } = req.body;
    try {
        const result = await db.query(
            `UPDATE games 
             SET title = $1, description = $2, winners = $3, game_kind = $4, 
                 avoid_winners = $5
             WHERE id = $6
             RETURNING *`,
            [title, description, winners, game_kind, avoid_winners, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Juego no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Eliminar un juego
 */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query("DELETE FROM games WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Eliminar una pregunta
 */
router.delete('/questions/:questionId', async (req, res) => {
    const { questionId } = req.params;
    try {
        await db.query("DELETE FROM questions WHERE id = $1", [questionId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
