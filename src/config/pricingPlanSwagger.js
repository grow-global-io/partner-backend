/**
 * @fileoverview Swagger configuration for Pricing Plans API
 * @description Comprehensive OpenAPI documentation for pricing plan management
 * @author AI Assistant
 */

const swaggerJSDoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "GrowLimitless Pricing Plans API",
      version: "1.0.0",
      description:
        "Complete API for managing pricing plans, subscriptions, and user plan recommendations for the GrowLimitless platform. Includes CRUD operations, plan initialization, and intelligent recommendation engine.",
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
        PricingPlan: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique identifier for the pricing plan",
              example: "507f1f77bcf86cd799439011",
            },
            planName: {
              type: "string",
              description: "Name of the pricing plan",
              example: "Basic",
            },
            description: {
              type: "string",
              description: "Detailed description of the plan",
              example:
                "Basic plan with 10 PDF documents for $3 - ideal for personal use",
            },
            price: {
              type: "number",
              description: "Price in USD",
              example: 3.0,
            },
            pdfLimit: {
              type: "integer",
              description: "Number of PDF documents allowed",
              example: 10,
            },
            planType: {
              type: "string",
              enum: ["free", "paid"],
              description: "Type of the plan",
              example: "paid",
            },
            features: {
              type: "array",
              items: {
                type: "string",
              },
              description: "List of features included in the plan",
              example: [
                "10 PDF documents",
                "Email support",
                "Fast processing speed",
                "Enhanced document analysis",
                "Document history",
              ],
            },
            isActive: {
              type: "boolean",
              description: "Whether the plan is currently available",
              example: true,
            },
            createdAt: {
              type: "string",
              format: "date-time",
              description: "Plan creation timestamp",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
              description: "Plan last update timestamp",
            },
          },
        },
        PricingPlanInput: {
          type: "object",
          required: ["planName", "description", "price", "pdfLimit"],
          properties: {
            planName: {
              type: "string",
              description: "Name of the pricing plan",
              example: "Professional",
            },
            description: {
              type: "string",
              description: "Detailed description of the plan",
              example: "Professional plan with 25 PDF documents for $7",
            },
            price: {
              type: "number",
              minimum: 0,
              description: "Price in USD (non-negative)",
              example: 7.0,
            },
            pdfLimit: {
              type: "integer",
              minimum: 1,
              description: "Number of PDF documents allowed (must be > 0)",
              example: 25,
            },
            planType: {
              type: "string",
              enum: ["free", "paid"],
              description: "Type of the plan",
              example: "paid",
            },
            features: {
              type: "array",
              items: {
                type: "string",
              },
              description: "List of features included in the plan",
              example: [
                "25 PDF documents",
                "Priority support",
                "Advanced analytics",
              ],
            },
            isActive: {
              type: "boolean",
              description: "Whether the plan should be active",
              example: true,
            },
          },
        },
        PlanRecommendation: {
          type: "object",
          properties: {
            recommendedPlan: {
              $ref: "#/components/schemas/PricingPlan",
            },
            reason: {
              type: "string",
              description: "Reason for the recommendation",
              example:
                "You're approaching your free tier limit. Upgrade for more documents!",
            },
            currentUsage: {
              type: "object",
              nullable: true,
              properties: {
                documentsUsed: {
                  type: "integer",
                  example: 2,
                },
                totalCapacity: {
                  type: "integer",
                  example: 3,
                },
                usagePercentage: {
                  type: "integer",
                  example: 67,
                },
              },
            },
            allPlans: {
              type: "array",
              items: {
                $ref: "#/components/schemas/PricingPlan",
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
                $ref: "#/components/schemas/PricingPlan",
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
        InitializationResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            message: {
              type: "string",
              example: "Default pricing plans created successfully",
            },
            data: {
              type: "object",
              properties: {
                created: {
                  type: "integer",
                  example: 4,
                },
                existing: {
                  type: "integer",
                  example: 0,
                },
                createdPlans: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      planName: { type: "string" },
                      price: { type: "number" },
                    },
                  },
                },
                existingPlans: {
                  type: "array",
                  items: {
                    type: "string",
                  },
                },
              },
            },
          },
        },
      },
      parameters: {
        PlanId: {
          name: "id",
          in: "path",
          required: true,
          description: "Unique identifier for the pricing plan",
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
        Active: {
          name: "active",
          in: "query",
          description: "Filter by active status",
          schema: {
            type: "boolean",
          },
        },
        Type: {
          name: "type",
          in: "query",
          description: "Filter by plan type",
          schema: {
            type: "string",
            enum: ["free", "paid"],
          },
        },
        SortBy: {
          name: "sortBy",
          in: "query",
          description: "Field to sort by",
          schema: {
            type: "string",
            enum: ["price", "pdfLimit", "createdAt", "planName"],
            default: "price",
          },
        },
        Order: {
          name: "order",
          in: "query",
          description: "Sort order",
          schema: {
            type: "string",
            enum: ["asc", "desc"],
            default: "asc",
          },
        },
      },
    },
    paths: {
      "/api/pricing-plans": {
        post: {
          tags: ["Pricing Plans"],
          summary: "Create a new pricing plan",
          description:
            "Create a new pricing plan with specified features and pricing",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PricingPlanInput",
                },
                examples: {
                  basicPlan: {
                    summary: "Basic Plan Example",
                    value: {
                      planName: "Basic",
                      description: "Basic plan for personal use",
                      price: 3.0,
                      pdfLimit: 10,
                      planType: "paid",
                      features: [
                        "10 PDF documents",
                        "Email support",
                        "Basic analytics",
                      ],
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Pricing plan created successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            $ref: "#/components/schemas/PricingPlan",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            400: {
              description: "Invalid input data",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                  examples: {
                    duplicateName: {
                      summary: "Duplicate plan name",
                      value: {
                        success: false,
                        error: "Plan name already exists",
                      },
                    },
                    invalidPrice: {
                      summary: "Invalid price",
                      value: {
                        success: false,
                        error: "Price must be non-negative number",
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
          tags: ["Pricing Plans"],
          summary: "Get all pricing plans",
          description:
            "Retrieve all pricing plans with optional filtering and pagination",
          parameters: [
            { $ref: "#/components/parameters/Page" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Active" },
            { $ref: "#/components/parameters/Type" },
            { $ref: "#/components/parameters/SortBy" },
            { $ref: "#/components/parameters/Order" },
          ],
          responses: {
            200: {
              description: "Pricing plans retrieved successfully",
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
      "/api/pricing-plans/{id}": {
        get: {
          tags: ["Pricing Plans"],
          summary: "Get pricing plan by ID",
          description:
            "Retrieve a specific pricing plan by its unique identifier",
          parameters: [{ $ref: "#/components/parameters/PlanId" }],
          responses: {
            200: {
              description: "Pricing plan retrieved successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            allOf: [
                              { $ref: "#/components/schemas/PricingPlan" },
                              {
                                type: "object",
                                properties: {
                                  subscriberCount: {
                                    type: "integer",
                                    description:
                                      "Number of users subscribed to this plan",
                                    example: 25,
                                  },
                                },
                              },
                            ],
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
              description: "Pricing plan not found",
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
          tags: ["Pricing Plans"],
          summary: "Update pricing plan",
          description: "Update an existing pricing plan by its ID",
          parameters: [{ $ref: "#/components/parameters/PlanId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    planName: {
                      type: "string",
                      description: "Updated plan name",
                    },
                    description: {
                      type: "string",
                      description: "Updated description",
                    },
                    price: {
                      type: "number",
                      minimum: 0,
                      description: "Updated price",
                    },
                    pdfLimit: {
                      type: "integer",
                      minimum: 1,
                      description: "Updated PDF limit",
                    },
                    features: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                      description: "Updated features list",
                    },
                    isActive: {
                      type: "boolean",
                      description: "Updated active status",
                    },
                  },
                },
                examples: {
                  updatePrice: {
                    summary: "Update price and features",
                    value: {
                      price: 4.0,
                      features: [
                        "10 PDF documents",
                        "Priority email support",
                        "Advanced analytics",
                        "API access",
                      ],
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Pricing plan updated successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            $ref: "#/components/schemas/PricingPlan",
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
              description: "Pricing plan not found",
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
          tags: ["Pricing Plans"],
          summary: "Deactivate pricing plan",
          description:
            "Soft delete (deactivate) a pricing plan by setting isActive to false",
          parameters: [{ $ref: "#/components/parameters/PlanId" }],
          responses: {
            200: {
              description: "Pricing plan deactivated successfully",
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
                        example: "Pricing plan deactivated successfully",
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
              description: "Pricing plan not found",
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
      "/api/pricing-plans/initialize-default": {
        post: {
          tags: ["Pricing Plans"],
          summary: "Initialize default pricing plans",
          description:
            "Create the default pricing plans (Free, Basic, Standard, Premium) if they don't exist",
          responses: {
            201: {
              description: "Default pricing plans created successfully",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/InitializationResponse",
                  },
                },
              },
            },
            200: {
              description: "Default pricing plans already exist",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/InitializationResponse" },
                      {
                        type: "object",
                        properties: {
                          message: {
                            example: "All default pricing plans already exist",
                          },
                        },
                      },
                    ],
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
      "/api/pricing-plans/recommended/{walletId}": {
        get: {
          tags: ["Pricing Plans"],
          summary: "Get recommended pricing plan",
          description:
            "Get a personalized pricing plan recommendation based on user's usage patterns",
          parameters: [{ $ref: "#/components/parameters/WalletId" }],
          responses: {
            200: {
              description: "Plan recommendation retrieved successfully",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/SuccessResponse" },
                      {
                        type: "object",
                        properties: {
                          data: {
                            $ref: "#/components/schemas/PlanRecommendation",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            404: {
              description: "No active pricing plans available",
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
      "/api/pricing-plans/public/active": {
        get: {
          tags: ["Pricing Plans"],
          summary: "Get active pricing plans for public display",
          description:
            "Retrieve all active pricing plans with limited information for public consumption",
          responses: {
            200: {
              description: "Active pricing plans retrieved successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: {
                        type: "boolean",
                        example: true,
                      },
                      data: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            planName: { type: "string" },
                            description: { type: "string" },
                            price: { type: "number" },
                            pdfLimit: { type: "integer" },
                            planType: { type: "string" },
                            features: {
                              type: "array",
                              items: { type: "string" },
                            },
                          },
                        },
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
      },
    },
    tags: [
      {
        name: "Pricing Plans",
        description:
          "Pricing plan management operations including CRUD, recommendations, and initialization",
      },
    ],
  },
  apis: ["./src/routes/pricingPlanRoutes.js"],
};

const swaggerSpecs = swaggerJSDoc(options);

module.exports = swaggerSpecs;
