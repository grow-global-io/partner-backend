const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Leadgen & Payment API Documentation",
      version: "1.0.0",
      description:
        "API documentation for Excel file processing, querying, and payment processing",
    },
    servers: [
      {
        url: "http://localhost:8000",
        description: "Development server",
      },
      {
        url: "https://backend.gll.one",
        description: "Production server",
      },
    ],
    components: {
      schemas: {
        LLMQueryRequest: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
              description: "The question to ask about the Excel data",
              example: "What is the total revenue for Q1 2024?",
            },
          },
        },
        LLMQueryResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            data: {
              type: "object",
              properties: {
                answer: {
                  type: "string",
                  description:
                    "LLM generated answer based on relevant Excel data",
                },
                sourceRows: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      rowData: {
                        type: "object",
                        description: "Original row data from Excel",
                      },
                      fileName: {
                        type: "string",
                        description: "Source Excel file name",
                      },
                      rowIndex: {
                        type: "integer",
                        description: "Row number in the Excel file",
                      },
                      score: {
                        type: "number",
                        description: "Relevance score (0-1)",
                      },
                    },
                  },
                },
                query: {
                  type: "string",
                  description: "Original query",
                },
              },
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            error: {
              type: "string",
            },
            details: {
              type: "string",
            },
          },
        },
        ApiKeyDebugResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            message: {
              type: "string",
              example: "API key debug information",
            },
            data: {
              type: "object",
              properties: {
                keyInfo: {
                  type: "object",
                  properties: {
                    masked: {
                      type: "string",
                      description:
                        "Masked API key showing first 4 and last 4 characters",
                      example: "sk-1***************************abc123",
                    },
                    length: {
                      type: "integer",
                      description: "Total length of the API key",
                      example: 51,
                    },
                    validFormat: {
                      type: "boolean",
                      description: "Whether the API key has valid format",
                      example: true,
                    },
                    startsWithSk: {
                      type: "boolean",
                      description: "Whether the API key starts with 'sk-'",
                      example: true,
                    },
                    error: {
                      type: "string",
                      nullable: true,
                      description: "Error message if key format is invalid",
                      example: null,
                    },
                  },
                },
                testResult: {
                  type: "object",
                  properties: {
                    isValid: {
                      type: "boolean",
                      description:
                        "Whether the API key is valid and functional",
                      example: true,
                    },
                    error: {
                      type: "string",
                      nullable: true,
                      description: "Error message if validation failed",
                      example: null,
                    },
                    details: {
                      type: "string",
                      nullable: true,
                      description: "Additional details about the validation",
                      example: null,
                    },
                    modelCount: {
                      type: "integer",
                      description: "Number of available models",
                      example: 45,
                    },
                    hasGPT4: {
                      type: "boolean",
                      description: "Whether GPT-4 models are available",
                      example: true,
                    },
                  },
                },
                healthStatus: {
                  type: "object",
                  properties: {
                    status: {
                      type: "string",
                      enum: ["healthy", "unhealthy", "error"],
                      description: "Overall health status",
                      example: "healthy",
                    },
                    apiKeyConfigured: {
                      type: "boolean",
                      description: "Whether API key is configured",
                      example: true,
                    },
                    validFormat: {
                      type: "boolean",
                      description: "Whether API key format is valid",
                      example: true,
                    },
                  },
                },
              },
            },
          },
        },
        PaymentSessionRequest: {
          type: "object",
          required: ["walletId", "mode", "line_items", "metadata", "noOfDocs"],
          properties: {
            walletId: {
              type: "string",
              description: "Unique identifier for the wallet",
              example: "wallet-123",
            },
            mode: {
              type: "string",
              description: "Payment mode",
              example: "payment",
            },
            line_items: {
              type: "array",
              description: "Array of items to purchase",
              items: {
                type: "object",
                properties: {
                  price_data: {
                    type: "object",
                    properties: {
                      currency: {
                        type: "string",
                        example: "USD",
                      },
                      product_data: {
                        type: "object",
                        properties: {
                          name: {
                            type: "string",
                            example: "Premium Document Plan",
                          },
                          description: {
                            type: "string",
                            example: "50 additional documents for your wallet",
                          },
                        },
                      },
                      unit_amount: {
                        type: "integer",
                        example: 2999,
                      },
                    },
                  },
                  quantity: {
                    type: "integer",
                    example: 1,
                  },
                },
              },
            },
            metadata: {
              type: "object",
              description: "Additional metadata for the payment",
              properties: {
                plan_type: {
                  type: "string",
                  example: "premium",
                },
                user_id: {
                  type: "string",
                  example: "user_456",
                },
                invoice_id: {
                  type: "string",
                  example: "INV-001",
                },
              },
            },
            noOfDocs: {
              type: "number",
              description: "Number of documents included in the plan",
              example: 50,
            },
          },
        },
        PaymentSessionResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            sessionId: {
              type: "string",
              description: "Payment session identifier",
              example: "cs_test_123456789",
            },
            url: {
              type: "string",
              description: "Payment URL to redirect user",
              example: "https://checkout.stripe.com/pay/cs_test_123456789",
            },
            message: {
              type: "string",
              example: "Payment session created successfully",
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
              description: "Error message",
            },
            details: {
              type: "string",
              description: "Additional error details",
            },
          },
        },
        WalletInfoResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            data: {
              type: "object",
              properties: {
                walletId: {
                  type: "string",
                  example: "wallet-123",
                },
                documentsCount: {
                  type: "integer",
                  example: 25,
                },
                documentsUsed: {
                  type: "integer",
                  example: 10,
                },
                documentsRemaining: {
                  type: "integer",
                  example: 15,
                },
                lastUpdated: {
                  type: "string",
                  format: "date-time",
                  example: "2024-01-15T10:30:00Z",
                },
              },
            },
          },
        },
        TokenBalanceResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            email: {
              type: "string",
              format: "email",
              example: "user@example.com",
            },
            balance: {
              type: "string",
              description: "GLL token balance in ether units",
              example: "1500.75",
            },
            message: {
              type: "string",
              example: "Token balance retrieved successfully",
            },
          },
        },
        WebhookRequest: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Type of webhook event",
              example: "checkout.session.completed",
            },
            data: {
              type: "object",
              properties: {
                object: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      description: "Session identifier",
                      example: "session_123",
                    },
                    metadata: {
                      type: "object",
                      properties: {
                        walletId: {
                          type: "string",
                          example: "wallet-123",
                        },
                        noOfDocs: {
                          type: "string",
                          example: "10",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    paths: {
      "/api/leadgen/llm": {
        post: {
          tags: ["LLM Query"],
          summary: "Query Excel data using natural language",
          description:
            "Ask questions about your Excel data using natural language. The system will search across all uploaded Excel files to find relevant information.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LLMQueryRequest",
                },
              },
            },
          },
          responses: {
            200: {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/LLMQueryResponse",
                  },
                },
              },
            },
            400: {
              description: "Bad request - Missing or invalid query",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            404: {
              description: "No relevant data found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            500: {
              description: "Server error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
      },
      "/api/leadgen/debug/api-key": {
        get: {
          tags: ["System Health"],
          summary: "Debug OpenAI API key status and configuration",
          description:
            "Returns masked API key information and validation results for debugging purposes. Shows first 4 and last 4 characters of the API key with validation status.",
          responses: {
            200: {
              description: "API key debug information retrieved successfully",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ApiKeyDebugResponse",
                  },
                },
              },
            },
            401: {
              description: "API key is invalid or missing",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: {
                        type: "boolean",
                        example: false,
                      },
                      error: {
                        type: "string",
                        example: "Failed to test API key",
                      },
                      details: {
                        type: "string",
                        example: "Invalid API key - check your key is correct",
                      },
                      keyInfo: {
                        type: "object",
                        properties: {
                          masked: {
                            type: "string",
                            example: "NOT_SET",
                          },
                          length: {
                            type: "integer",
                            example: 0,
                          },
                          validFormat: {
                            type: "boolean",
                            example: false,
                          },
                          startsWithSk: {
                            type: "boolean",
                            example: false,
                          },
                          error: {
                            type: "string",
                            example:
                              "OPENAI_API_KEY environment variable is not set",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: {
              description: "Server error during API key testing",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: ["./src/leadgen/routes/*.js", "./src/routes/paymentRoutes.js"],
};

module.exports = swaggerJsdoc(options);
