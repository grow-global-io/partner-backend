require('dotenv').config();
/**
 * GrowLimitless API - Main Entry Point
 */
const express = require('express');
const cors = require('cors');
// Import routes
const userRoutes = require('./src/routes/userRoutes');
const errorHandler = require('./src/middleware/errorHandler');

// Create Express app
const app = express();

// Environment variables
const PORT = process.env.PORT || 8000;

// Database connection
const prisma = require('./src/config/db');

// Middleware
app.use(cors({
    origin: "*" // In production, specify actual origins
}));
app.use(express.json());

// Routes
app.get("/", (req, res) => {
    res.send("Welcome to GrowLimitless API");
});

// API Routes
app.use('/api/users', userRoutes);

// Error handling middleware (should be last)
app.use(errorHandler);

// Start the Express server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    process.exit(1);
});
