require("dotenv").config();
/**
 * GrowLimitless API - Main Entry Point
 */
const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpecs = require("./src/pdf-chat/config/swagger");
// Import routes
const userRoutes = require("./src/routes/userRoutes");
const botRoutes = require("./src/routes/botRoutes");
const pdfChatRoutes = require("./src/pdf-chat/routes/pdfChatRoutes");
const errorHandler = require("./src/middleware/errorHandler");
const { MongoClient } = require("mongodb");

// Create Express app
const app = express();

// Environment variables
const PORT = process.env.PORT || 8000;

// Middleware
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"], // Allow only specific localhost ports
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    credentials: false, // Set to false since we're allowing all origins
    maxAge: 600, // Cache preflight request for 10 minutes
  })
);
app.use(express.json());

// Swagger Documentation
app.use(
  "/api/api-routes/pdf-chat/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpecs, {
    customSiteTitle: "PDF Chat API Documentation",
    customCss: ".swagger-ui .topbar { display: none }",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: "none",
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      tryItOutEnabled: true,
    },
  })
);

async function testConnection() {
  const client = new MongoClient(
    "mongodb+srv://operations:nIzoFig3d47La9Cz@cluster0.zz7u5.mongodb.net/Partners?retryWrites=true&w=majority&appName=Cluster0"
  );
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
  testConnection();
  res.send(`
    <h1>Welcome to GrowLimitless API</h1>
    <p>🚀 Server is running successfully!</p>
    <h2>Available APIs:</h2>
    <ul>
      <li><a href="/api/users">/api/users</a> - User management</li>
      <li><a href="/api/bot">/api/bot</a> - Telegram bot</li>
      <li><a href="/api/api-routes/pdf-chat">/api/api-routes/pdf-chat</a> - PDF Chat system</li>
      <li><a href="/api/api-routes/pdf-chat/docs">/api/api-routes/pdf-chat/docs</a> - 📄 PDF Chat API Documentation (Swagger)</li>
    </ul>
  `);
});

// API Routes
app.use("/api/users", userRoutes);
app.use("/api/bot", botRoutes);
app.use("/api/api-routes/pdf-chat", pdfChatRoutes);

// Error handling middleware (should be last)
app.use(errorHandler);

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("🤖 Telegram bot is active and listening for messages...");
  console.log("📄 PDF Chat API is available at /api/api-routes/pdf-chat");
  console.log(
    "📖 PDF Chat API Documentation: http://localhost:" +
      PORT +
      "/api/api-routes/pdf-chat/docs"
  );
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION! 💥 Shutting down...");
  console.error(err.name, err.message);
  process.exit(1);
});
