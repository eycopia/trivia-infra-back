const express = require('express');
const db = require('../../db');

const router = express.Router();


router.get('/', async (req, res) => {
    const { exclude_status } = req.query;
    try {
        let query = "SELECT * FROM games";
        const params = [];

        if (exclude_status) {
            query += " WHERE status IS DISTINCT FROM $1";
            params.push(exclude_status);
        }

        query += " ORDER BY id DESC";
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;