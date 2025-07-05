require("dotenv").config();
/**
 * GrowLimitless API - Main Entry Point
 */
const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpecs = require("./src/pdf-chat/config/swagger");
const storefrontSwaggerSpecs = require("./src/storefront/config/swagger");
// Import routes
const userRoutes = require("./src/routes/userRoutes");
const botRoutes = require("./src/routes/botRoutes");
const paymentRoutes = require("./src/routes/paymentRoutes");
const pdfChatRoutes = require("./src/pdf-chat/routes/pdfChatRoutes");
const storefrontRoutes = require("./src/storefront/routes/storefrontRoutes");
const hotelCheckinRoutes = require("./src/routes/hotelCheckinRoutes");
const errorHandler = require("./src/middleware/errorHandler");
const { MongoClient } = require("mongodb");
const leadgenRoutes = require("./src/leadgen/routes/leadgenRoutes");
const leadgenSwaggerSpecs = require("./src/leadgen/config/swagger");

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
      "https://dev.gll.one",
    ], // Allow only specific localhost ports
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Cache-Control",
      "Pragma",
      "Expires",
      "If-Modified-Since",
      "If-None-Match"
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    credentials: false, // Set to false since we're allowing all origins
    maxAge: 600, // Cache preflight request for 10 minutes
  })
);
app.use(express.json());

// Unified Swagger Documentation - All APIs
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
  swaggerUi.serveFiles(swaggerSpecs),
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

// Storefront Swagger Documentation
app.use(
  "/api/storefront/docs",
  swaggerUi.serveFiles(storefrontSwaggerSpecs),
  swaggerUi.setup(storefrontSwaggerSpecs, {
    customSiteTitle: "Storefront API Documentation",
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

// Leadgen Swagger Documentation
app.use(
  "/api/leadgen/docs",
  swaggerUi.serveFiles(leadgenSwaggerSpecs),
  swaggerUi.setup(leadgenSwaggerSpecs, {
    customSiteTitle: "Leadgen (Excel) API Documentation",
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
      <li><a href="/api/storefront">/api/storefront</a> - Storefront system</li>
      <li><a href="/api/leadgen">/api/leadgen</a> - Leadgen (Excel) system</li>
      <li><a href="/api/hotel-checkin">/api/hotel-checkin</a> - Hotel check-in system</li>
    </ul>
    <h2>📖 API Documentation:</h2>
    <ul>
      <li><a href="/api/docs" style="font-weight: bold; color: #007bff;">📄 Complete API Documentation (Swagger)</a> - Payment & PDF Chat APIs</li>
      <li><a href="/api/api-routes/pdf-chat/docs">/api/api-routes/pdf-chat/docs</a> - PDF Chat API Documentation (Legacy)</li>
      <li><a href="/api/storefront/docs">/api/storefront/docs</a> - 🛒 Storefront API Documentation (Swagger)</li>
      <li><a href="/api/leadgen/docs">/api/leadgen/docs</a> - 📊 Leadgen (Excel) API Documentation (Swagger)</li>
    </ul>
    <h2>🔧 Features:</h2>
    <ul>
      <li>✅ Payment processing with custom gateway integration</li>
      <li>✅ Wallet management and document limits</li>
      <li>✅ PDF upload and AI-powered chat system</li>
      <li>✅ User management and authentication</li>
      <li>✅ Telegram bot integration</li>
      <li>✅ Storefront management system</li>
      <li>✅ Excel processing with AI-powered search</li>
      <li>✅ Hotel check-in management</li>
      <li>✅ Comprehensive API documentation</li>
    </ul>
  `);
});

// API Routes
app.use("/api/users", userRoutes);
app.use("/api/bot", botRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/api-routes/pdf-chat", pdfChatRoutes);
app.use("/api/storefront", storefrontRoutes);
app.use("/api/leadgen", leadgenRoutes);
app.use("/api/hotel-checkin", hotelCheckinRoutes);

// Error handling middleware
app.use(errorHandler);

// 404 handler - must be last
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({
      success: false,
      error: 'API endpoint not found',
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(404).send(`
      <h1>404 - Page Not Found</h1>
      <p>The requested page ${req.path} was not found.</p>
      <a href="/">Go back to API home</a>
    `);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("🤖 Telegram bot is active and listening for messages...");
  console.log("📄 PDF Chat API is available at /api/api-routes/pdf-chat");
  console.log(
    "📖 PDF Chat API Documentation: http://localhost:8000/api/api-routes/pdf-chat/docs"
  );
  console.log("🛒 Storefront API is available at /api/storefront");
  console.log(
    "📖 Storefront API Documentation: http://localhost:8000/api/storefront/docs"
  );
  console.log("📊 Leadgen (Excel) API is available at /api/leadgen");
  console.log(
    "📖 Leadgen (Excel) API Documentation: http://localhost:8000/api/leadgen/docs"
  );
});

module.exports = app;
