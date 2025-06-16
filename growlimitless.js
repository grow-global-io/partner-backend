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
const paymentRoutes = require("./src/routes/paymentRoutes");
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
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://growlimitless.com",
      "https://partner.growlimitless.app",
      "https://gll.one",
    ], // Allow only specific localhost ports
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

// Unified Swagger Documentation - Both PDF Chat & Payment APIs
app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpecs, {
    customSiteTitle: "GrowLimitless Partner Backend API Documentation",
    customCss: ".swagger-ui .topbar { display: none }",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: "none",
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      tryItOutEnabled: true,
      tagsSorter: "alpha",
      operationsSorter: "alpha",
    },
  })
);

// Legacy PDF Chat documentation route (for backward compatibility)
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
    <h1>Welcome to GrowLimitless Partner Backend API</h1>
    <p>🚀 Server is running successfully!</p>
    <h2>Available APIs:</h2>
    <ul>
      <li><a href="/api/users">/api/users</a> - User management</li>
      <li><a href="/api/bot">/api/bot</a> - Telegram bot</li>
      <li><a href="/api/payments">/api/payments</a> - Payment processing & wallet management</li>
      <li><a href="/api/api-routes/pdf-chat">/api/api-routes/pdf-chat</a> - PDF Chat system</li>
    </ul>
    <h2>📖 API Documentation:</h2>
    <ul>
      <li><a href="/api/docs" style="font-weight: bold; color: #007bff;">📄 Complete API Documentation (Swagger)</a> - Payment & PDF Chat APIs</li>
      <li><a href="/api/api-routes/pdf-chat/docs">/api/api-routes/pdf-chat/docs</a> - PDF Chat API Documentation (Legacy)</li>
    </ul>
    <h2>🔧 Features:</h2>
    <ul>
      <li>✅ Payment processing with custom gateway integration</li>
      <li>✅ Wallet management and document limits</li>
      <li>✅ PDF upload and AI-powered chat system</li>
      <li>✅ User management and authentication</li>
      <li>✅ Telegram bot integration</li>
      <li>✅ Comprehensive API documentation</li>
    </ul>
  `);
});

// API Routes
app.use("/api/users", userRoutes);
app.use("/api/bot", botRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/api-routes/pdf-chat", pdfChatRoutes);

// Error handling middleware (should be last)
app.use(errorHandler);

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("🤖 Telegram bot is active and listening for messages...");
  console.log("💳 Payment API is available at /api/payments");
  console.log("📄 PDF Chat API is available at /api/api-routes/pdf-chat");
  console.log(
    "📖 Complete API Documentation: http://localhost:" + PORT + "/api/docs"
  );
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
