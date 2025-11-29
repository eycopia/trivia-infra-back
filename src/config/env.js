// Configuración centralizada de variables de entorno
module.exports = {
    PORT: process.env.PORT || 3000,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_TOKEN: process.env.ADMIN_TOKEN,
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
    DATABASE_URL: process.env.DATABASE_URL
};
