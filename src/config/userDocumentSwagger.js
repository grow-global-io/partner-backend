/**
 * @fileoverview Swagger configuration for User Document Management API
 * @description Comprehensive OpenAPI documentation for user document management
 * @author AI Assistant
 */

const swaggerJSDoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "GrowLimitless User Document Management API",
      version: "1.0.0",
      description:
        "Complete API for managing user documents, wallet-based capacity tracking, subscription management, and usage analytics for the GrowLimitless platform. Includes CRUD operations, plan upgrades, and usage monitoring.",
      contact: {
        name: "GrowLimitless Team",
        email: "support@growlimitless.app",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: "http://localhost:8000",
        description: "Development server",
      },
      {
        url: "https://partner-backend-j2wt.onrender.com",
        description: "Production deployment server",
      },
      {
        url: "https://api.growlimitless.app",
        description: "Production server",
      },
    ],
    components: {
      schemas: {
        UserDocument: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique identifier for the user document",
              example: "507f1f77bcf86cd799439011",
            },
            walletId: {
              type: "string",
              description: "User's unique wallet identifier",
              example: "0x1234567890abcdef",
            },
            totalDocumentsCapacity: {
              type: "integer",
              description: "Total documents user can handle",
              example: 10,
            },
            documentsUsed: {
              type: "integer",
              description: "Number of documents currently used",
              example: 3,
            },
            currentPlanId: {
              type: "string",
              nullable: true,
              description: "Reference to current pricing plan",
              example: "507f1f77bcf86cd799439012",
            },
            isFreeTier: {
              type: "boolean",
              description: "Whether user is on free tier",
              example: false,
            },
            subscriptionStartDate: {
              type: "string",
              format: "date-time",
              nullable: true,
              description: "When paid subscription started",
            },
            subscriptionEndDate: {
              type: "string",
              format: "date-time",
              nullable: true,
              description: "When paid subscription ends",
            },
            createdAt: {
              type: "string",
              format: "date-time",
              description: "Document creation timestamp",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
              description: "Document last update timestamp",
            },
            currentPlan: {
              type: "object",
              nullable: true,
              description: "Current pricing plan details",
              properties: {
                id: { type: "string" },
                planName: { type: "string" },
                price: { type: "number" },
                pdfLimit: { type: "integer" },
                features: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        UserDocumentInput: {
          type: "object",
          required: ["walletId"],
          properties: {
            walletId: {
              type: "string",
              description: "User's unique wallet identifier",
              example: "0x1234567890abcdef",
            },
            totalDocumentsCapacity: {
              type: "integer",
              minimum: 0,
              description:
                "Total documents capacity (defaults to 3 for free tier)",
              example: 10,
            },
            documentsUsed: {
              type: "integer",
              minimum: 0,
              description: "Number of documents currently used (defaults to 0)",
              example: 2,
            },
            isFreeTier: {
              type: "boolean",
              description: "Whether user is on free tier (defaults to true)",
              example: false,
            },
            currentPlanId: {
              type: "string",
              nullable: true,
              description: "Reference to current pricing plan",
              example: "507f1f77bcf86cd799439012",
            },
          },
        },
        PlanUpgrade: {
          type: "object",
          required: ["planId"],
          properties: {
            planId: {
              type: "string",
              description: "ID of the plan to upgrade to",
              example: "507f1f77bcf86cd799439012",
            },
            subscriptionMonths: {
              type: "integer",
              minimum: 1,
              description: "Number of months for subscription (defaults to 1)",
              example: 3,
            },
          },
        },
        UsageIncrement: {
          type: "object",
          properties: {
            increment: {
              type: "integer",
              minimum: 1,
              description: "Number to increment usage by (defaults to 1)",
              example: 1,
            },
          },
        },
        UsageStats: {
          type: "object",
          properties: {
            walletId: {
              type: "string",
              example: "0x1234567890abcdef",
            },
            documentsUsed: {
              type: "integer",
              example: 3,
            },
            totalDocumentsCapacity: {
              type: "integer",
              example: 10,
            },
            remainingDocuments: {
              type: "integer",
              example: 7,
            },
            usagePercentage: {
              type: "integer",
              example: 30,
            },
            isFreeTier: {
              type: "boolean",
              example: false,
            },
            currentPlan: {
              type: "object",
              nullable: true,
              properties: {
                planName: { type: "string", example: "Basic" },
                price: { type: "number", example: 3.0 },
                pdfLimit: { type: "integer", example: 10 },
              },
            },
            subscriptionStatus: {
              type: "object",
              properties: {
                isExpired: {
                  type: "boolean",
                  example: false,
                },
                startDate: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
                endDate: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
              },
            },
          },
        },
        SuccessResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            message: {
              type: "string",
              example: "Operation completed successfully",
            },
            data: {
              type: "object",
              description: "Response data (varies by endpoint)",
            },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            error: {
              type: "string",
              example: "Error message describing what went wrong",
            },
          },
        },
        PaginatedResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            data: {
              type: "array",
              items: {
                $ref: "#/components/schemas/UserDocument",
              },
            },
            pagination: {
              type: "object",
              properties: {
                page: {
                  type: "integer",
                  example: 1,
                },
                limit: {
                  type: "integer",
                  example: 10,
                },
                total: {
                  type: "integer",
                  example: 25,
                },
                pages: {
                  type: "integer",
                  example: 3,
                },
              },
            },
          },
        },
      },
      parameters: {
        DocumentId: {
          name: "id",
          in: "path",
          required: true,
          description: "Unique identifier for the user document",
          schema: {
            type: "string",
            pattern: "^[0-9a-fA-F]{24}$",
            example: "507f1f77bcf86cd799439011",
          },
        },
        WalletId: {
          name: "walletId",
          in: "path",
          required: true,
          description: "User's wallet identifier",
          schema: {
            type: "string",
            example: "0x1234567890abcdef",
          },
        },
        Page: {
          name: "page",
          in: "query",
          description: "Page number for pagination",
          schema: {
            type: "integer",
            minimum: 1,
            default: 1,
          },
        },
        Limit: {
          name: "limit",
          in: "query",
          description: "Number of items per page",
          schema: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 10,
          },
        },
        IsFreeTier: {
          name: "isFreeTier",
          in: "query",
          description: "Filter by free tier status",
          schema: {
            type: "boolean",
          },
        },
        WalletIdQuery: {
          name: "walletId",
          in: "query",
          description: "Filter by wallet ID (partial match)",
          schema: {
            type: "string",
          },
        },
      },
    },
    paths: {
      "/api/user-documents": {
        post: {
          tags: ["User Documents"],
          summary: "Create a new user document",
          description:
            "Create a new user document record with wallet-based capacity tracking",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/UserDocumentInput",
                },
                examples: {
                  freeUser: {
                    summary: "Free Tier User",
                    value: {
                      walletId: "0x1234567890abcdef",
                      totalDocumentsCapacity: 3,
                      documentsUsed: 0,
                      isFreeTier: true,
                    },
                  },
                  paidUser: {
                    summary: "Paid Tier User",
                    value: {
                      walletId: "0xabcdef1234567890",
                      totalDocumentsCapacity: 10,
                      documentsUsed: 2,
                      isFreeTier: false,
                      currentPlanId: "507f1f77bcf86cd799439012",
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "User document created successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            $ref: "#/components/schemas/UserDocument",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            400: {
              description: "Invalid input data or wallet ID already exists",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                  examples: {
                    duplicateWallet: {
                      summary: "Duplicate wallet ID",
                      value: {
                        success: false,
                        error: "walletId already exists",
                      },
                    },
                    invalidInput: {
                      summary: "Invalid input",
                      value: {
                        success: false,
                        error: "walletId is required and must be a string",
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: "Internal server error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
        get: {
          tags: ["User Documents"],
          summary: "Get all user documents",
          description:
            "Retrieve all user documents with optional filtering and pagination",
          parameters: [
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/IsFreeTier" },
            { $ref: "#/components/parameters/WalletIdQuery" },
          ],
          responses: {
            200: {
              description: "User documents retrieved successfully",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PaginatedResponse",
                  },
                },
              },
            },
            500: {
              description: "Internal server error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/user-documents/{id}": {
        get: {
          tags: ["User Documents"],
          summary: "Get user document by ID",
          description:
            "Retrieve a specific user document by its unique identifier",
          parameters: [{ $ref: "#/components/parameters/DocumentId" }],
          responses: {
            200: {
              description: "User document retrieved successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            $ref: "#/components/schemas/UserDocument",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            400: {
              description: "Invalid ID format",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            404: {
              description: "User document not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            500: {
              description: "Internal server error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
        put: {
          tags: ["User Documents"],
          summary: "Update user document",
          description: "Update an existing user document by its ID",
          parameters: [{ $ref: "#/components/parameters/DocumentId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    totalDocumentsCapacity: {
                      type: "integer",
                      minimum: 0,
                      description: "Updated total documents capacity",
                    },
                    documentsUsed: {
                      type: "integer",
                      minimum: 0,
                      description: "Updated documents used count",
                    },
                    isFreeTier: {
                      type: "boolean",
                      description: "Updated free tier status",
                    },
                    currentPlanId: {
                      type: "string",
                      nullable: true,
                      description: "Updated current plan ID",
                    },
                  },
                },
                examples: {
                  updateCapacity: {
                    summary: "Update capacity",
                    value: {
                      totalDocumentsCapacity: 20,
                      documentsUsed: 5,
                      isFreeTier: false,
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "User document updated successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            $ref: "#/components/schemas/UserDocument",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            400: {
              description: "Invalid input data or ID format",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            404: {
              description: "User document not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            500: {
              description: "Internal server error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: ["User Documents"],
          summary: "Delete user document",
          description: "Delete a user document by its ID",
          parameters: [{ $ref: "#/components/parameters/DocumentId" }],
          responses: {
            200: {
              description: "User document deleted successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: {
                        type: "boolean",
                        example: true,
                      },
                      message: {
                        type: "string",
                        example: "User document deleted successfully",
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: "Invalid ID format",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            404: {
              description: "User document not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            500: {
              description: "Internal server error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/user-documents/wallet/{walletId}": {
        get: {
          tags: ["User Documents"],
          summary: "Get user document by wallet ID",
          description: "Retrieve a user document by wallet identifier",
          parameters: [{ $ref: "#/components/parameters/WalletId" }],
          responses: {
            200: {
              description: "User document retrieved successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            $ref: "#/components/schemas/UserDocument",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            404: {
              description: "User document not found for this wallet ID",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            500: {
              description: "Internal server error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/user-documents/{id}/upgrade-plan": {
        post: {
          tags: ["User Documents"],
          summary: "Upgrade user's plan",
          description:
            "Upgrade a user's subscription plan and update document capacity",
          parameters: [{ $ref: "#/components/parameters/DocumentId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PlanUpgrade",
                },
                examples: {
                  upgradeToBasic: {
                    summary: "Upgrade to Basic Plan",
                    value: {
                      planId: "507f1f77bcf86cd799439012",
                      subscriptionMonths: 1,
                    },
                  },
                  upgradeToAnnual: {
                    summary: "Upgrade to Annual Plan",
                    value: {
                      planId: "507f1f77bcf86cd799439013",
                      subscriptionMonths: 12,
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Plan upgraded successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            $ref: "#/components/schemas/UserDocument",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            400: {
              description: "Invalid input data, ID format, or inactive plan",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                  examples: {
                    invalidPlan: {
                      summary: "Invalid or inactive plan",
                      value: {
                        success: false,
                        error: "Invalid or inactive plan",
                      },
                    },
                    missingPlanId: {
                      summary: "Missing plan ID",
                      value: {
                        success: false,
                        error: "Valid planId is required",
                      },
                    },
                  },
                },
              },
            },
            404: {
              description: "User document not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            500: {
              description: "Internal server error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/user-documents/{walletId}/usage": {
        get: {
          tags: ["User Documents"],
          summary: "Get user document usage statistics",
          description:
            "Retrieve detailed usage statistics for a user including capacity, usage percentage, and subscription status",
          parameters: [{ $ref: "#/components/parameters/WalletId" }],
          responses: {
            200: {
              description: "Usage statistics retrieved successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            $ref: "#/components/schemas/UsageStats",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            404: {
              description: "User document not found for this wallet ID",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            500: {
              description: "Internal server error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/user-documents/{walletId}/increment-usage": {
        post: {
          tags: ["User Documents"],
          summary: "Increment document usage",
          description:
            "Increment the document usage count for a user with capacity validation",
          parameters: [{ $ref: "#/components/parameters/WalletId" }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/UsageIncrement",
                },
                examples: {
                  singleIncrement: {
                    summary: "Increment by 1 (default)",
                    value: {
                      increment: 1,
                    },
                  },
                  multipleIncrement: {
                    summary: "Increment by multiple",
                    value: {
                      increment: 3,
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Document usage updated successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            $ref: "#/components/schemas/UserDocument",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            400: {
              description:
                "Invalid increment value or capacity would be exceeded",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                  examples: {
                    capacityExceeded: {
                      summary: "Capacity exceeded",
                      value: {
                        success: false,
                        error:
                          "Document usage would exceed capacity. Please upgrade your plan.",
                        data: {
                          currentUsage: 2,
                          capacity: 3,
                          attemptedIncrement: 2,
                        },
                      },
                    },
                    invalidIncrement: {
                      summary: "Invalid increment",
                      value: {
                        success: false,
                        error: "Increment must be a positive integer",
                      },
                    },
                  },
                },
              },
            },
            404: {
              description: "User document not found for this wallet ID",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            500: {
              description: "Internal server error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
    },
    tags: [
      {
        name: "User Documents",
        description:
          "User document management operations including CRUD, capacity tracking, plan upgrades, and usage monitoring",
      },
    ],
  },
  apis: ["./src/routes/userDocumentRoutes.js"],
};

const swaggerSpecs = swaggerJSDoc(options);

module.exports = swaggerSpecs;
