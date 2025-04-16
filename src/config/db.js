const { PrismaClient } = require('@prisma/client');

// Create a singleton instance of PrismaClient
const prisma = global.prisma || new PrismaClient();

// In development, save the connection to avoid multiple connections
if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}

module.exports = prisma;