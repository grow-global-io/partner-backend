const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Storefront API Documentation",
      version: "1.0.0",
      description: "API documentation for the Storefront feature",
      contact: {
        name: "GrowLimitless",
        url: "https://growlimitless.com",
      },
    },
    servers: [
      {
        url: process.env.API_URL || "http://localhost:8000",
        description: "Development server",
      },
    ],
    tags: [
      {
        name: "Stores",
        description: "Store management endpoints",
      },
      {
        name: "Products",
        description: "Product management endpoints",
      },
    ],
  },
  apis: ["./src/storefront/routes/*.js"], // Path to the API routes
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
