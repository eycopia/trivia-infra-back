const express = require('express');
const db = require('../../db');

const router = express.Router();

/**
 * Obtener todos los ganadores con paginación y búsqueda
 */
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;

        // Base query parts
        let whereClause = '';
        const params = [];
        let paramIdx = 1;

        if (search) {
            whereClause = `WHERE p.extra ILIKE $${paramIdx}`;
            params.push(`%${search}%`);
            paramIdx++;
        }

        // Count query
        const countQuery = `
            SELECT COUNT(*) 
            FROM winners w
            LEFT JOIN players p ON w.player_id = p.id
            ${whereClause}
        `;

        // Data query
        const dataQuery = `
            WITH q_ordered AS (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY id ASC) - 1 as idx 
                FROM questions
            )
            SELECT 
                w.*, 
                g.title as game_title, 
                q.text as question_text,
                p.extra as player_extra
            FROM winners w
            LEFT JOIN games g ON w.game_id = g.id
            LEFT JOIN q_ordered q ON w.game_id = q.game_id AND w.question_idx = q.idx
            LEFT JOIN players p ON w.player_id = p.id
            ${whereClause}
            ORDER BY w.claimed ASC, w.id DESC
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `;

        params.push(limit, offset);

        const [countResult, dataResult] = await Promise.all([
            db.query(countQuery, search ? [`%${search}%`] : []),
            db.query(dataQuery, params)
        ]);

        res.json({
            items: dataResult.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit,
            totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Marcar un ganador como reclamado
 */
router.post('/:id/claim', async (req, res) => {
    try {
        await db.query("UPDATE winners SET claimed = TRUE WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
