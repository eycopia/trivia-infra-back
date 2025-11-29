const express = require('express');
const db = require('../../db');

const router = express.Router();

/**
 * Obtener todos los ganadores
 */
router.get('/', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM winners ORDER BY id DESC");
        res.json(result.rows);
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
