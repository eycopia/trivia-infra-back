const { Pool } = require('pg');

// Crear pool de conexiones a PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Necesario para Neon y otros proveedores cloud
    }
});

// Evento de error del pool
pool.on('error', (err, client) => {
    console.error('Error inesperado en el cliente de PostgreSQL:', err);
});

// Función helper para ejecutar queries
const query = (text, params) => {
    return pool.query(text, params);
};

// Función para obtener un cliente del pool (para transacciones)
const getClient = () => {
    return pool.connect();
};

// Verificar conexión al iniciar
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Error conectando a PostgreSQL:', err.message);
    } else {
        console.log('✅ Conectado a PostgreSQL exitosamente');
    }
});

module.exports = {
    query,
    getClient,
    pool
};
