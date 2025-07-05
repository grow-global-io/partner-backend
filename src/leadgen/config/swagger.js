const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Leadgen (Excel) API Documentation",
      version: "1.0.0",
      description: "API documentation for Excel file processing and querying",
    },
    servers: [
      {
        url: "http://localhost:8000",
        description: "Development server",
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
    },
  },
  apis: ["./src/leadgen/routes/*.js"],
};

module.exports = swaggerJsdoc(options);
