require('dotenv').config();
/**
 * GrowLimitless API - Main Entry Point
 */
const express = require('express');
const cors = require('cors');
// Import routes
const userRoutes = require('./src/routes/userRoutes');
const errorHandler = require('./src/middleware/errorHandler');
const { MongoClient } = require('mongodb');

// Create Express app
const app = express();

// Environment variables
const PORT = process.env.PORT || 8000;

// Database connection
const prisma = require('./src/config/db');

// Middleware
app.use(cors({
  origin: ['*'],                    // Allow all origins
  // methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  // allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  // exposedHeaders: ["Content-Range", "X-Content-Range"],
  // credentials: false,             // Set to false since we're allowing all origins
  // maxAge: 600                     // Cache preflight request for 10 minutes
}));
app.use(express.json());

async function testConnection() {
    const client = new MongoClient('mongodb+srv://operations:nIzoFig3d47La9Cz@cluster0.zz7u5.mongodb.net/Partners?retryWrites=true&w=majority&appName=Cluster0');
    try {
      await client.connect();
      console.log("✅ Connected successfully to server");
    } catch (err) {
      console.error("❌ Connection failed:", err);
    } finally {
      await client.close();
    }
  }
// Routes
app.get("/", (req, res) => {
    console.log("Welcome to GrowLimitless API");
    testConnection()
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
