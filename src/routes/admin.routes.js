const express = require('express');
const config = require('../config/env');
const db = require('../../db');
const router = express.Router();


/**
 * Obtener todos los juegos
 */
router.get('/games', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM games ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Login de administrador
 */
router.post('/admin-login', (req, res) => {
    if (req.body.password === config.ADMIN_PASSWORD) {
        res.json({ success: true, admin_token: config.ADMIN_TOKEN });
    } else {
        res.status(401).json({ success: false });
    }
});

/**
 * Middleware de autenticación de admin
 */
const adminAuth = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === config.ADMIN_TOKEN) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

module.exports = { router, adminAuth };
