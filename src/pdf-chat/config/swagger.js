const swaggerJSDoc = require("swagger-jsdoc");
const path = require("path");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "GrowLimitless Partner Backend API",
      version: "2.1.0",
      description:
        "A comprehensive backend API for the GrowLimitless platform featuring PDF chat system, payment processing, user management, and document handling. This API allows users to upload PDF documents, extract and store vector embeddings, chat with their documents using OpenAI, process payments for plan purchases, and manage wallet document limits.",
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
        url: "https://api.growlimitless.app",
        description: "Production server",
      },
      {
        url: "https://partner-backend-j2wt.onrender.com",
        description: "Partner backend deployment server",
      },
    ],
    components: {
      schemas: {
        // Payment API Schemas
        PaymentSessionRequest: {
          type: "object",
          required: ["walletId", "mode", "line_items", "metadata", "noOfDocs"],
          properties: {
            walletId: {
              type: "string",
              description: "User's unique wallet ID",
              example: "wallet-123",
            },
            mode: {
              type: "string",
              description: "Payment mode",
              example: "payment",
              enum: ["payment", "subscription"],
            },
            line_items: {
              type: "array",
              description: "Items to be purchased",
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
                            example: "Document Plan - Premium",
                          },
                          description: {
                            type: "string",
                            example: "Premium document processing plan",
                          },
                        },
                      },
                      unit_amount: {
                        type: "integer",
                        description: "Amount in cents",
                        example: 5000,
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
                invoice_id: {
                  type: "string",
                  example: "456",
                },
                user_id: {
                  type: "string",
                  example: "123",
                },
              },
            },
            noOfDocs: {
              type: "integer",
              description: "Number of documents to add to wallet",
              example: 10,
              minimum: 1,
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
              example: "session_1234567890",
            },
            checkoutUrl: {
              type: "string",
              example: "https://checkout.example.com/session_1234567890",
            },
            message: {
              type: "string",
              example: "Payment session created successfully",
            },
          },
        },
        PaymentSuccessResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            message: {
              type: "string",
              example: "Payment successful! Documents updated successfully.",
            },
            walletId: {
              type: "string",
              example: "wallet-123",
            },
            updatedDocuments: {
              type: "integer",
              example: 15,
            },
          },
        },
        PaymentCancelResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            message: {
              type: "string",
              example: "Payment was cancelled by user",
            },
            sessionId: {
              type: "string",
              example: "session_123",
              nullable: true,
            },
          },
        },
        WebhookRequest: {
          type: "object",
          properties: {
            type: {
              type: "string",
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
        WalletInfoResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            walletId: {
              type: "string",
              example: "wallet-123",
            },
            noOfDocuments: {
              type: "integer",
              example: 15,
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
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
              example: "Missing required field: walletId",
            },
          },
        },
        // PDF Chat API Schemas (existing)
        PDFUploadRequest: {
          type: "object",
          required: ["pdf", "walletId"],
          properties: {
            pdf: {
              type: "string",
              format: "binary",
              description: "PDF file to upload (max 50MB)",
            },
            walletId: {
              type: "string",
              description: "User's unique wallet ID",
              example: "user_wallet_123",
            },
          },
        },
        PDFUploadResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            message: {
              type: "string",
              example: "PDF uploaded and processed successfully",
            },
            data: {
              type: "object",
              properties: {
                documentId: {
                  type: "string",
                  example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                },
                fileName: {
                  type: "string",
                  example: "document.pdf",
                },
                totalPages: {
                  type: "integer",
                  example: 10,
                },
                totalChunks: {
                  type: "integer",
                  example: 25,
                },
                fileSize: {
                  type: "integer",
                  example: 1024000,
                },
                s3Url: {
                  type: "string",
                  example: "https://bucket.s3.amazonaws.com/...",
                },
                uploadedAt: {
                  type: "string",
                  format: "date-time",
                },
                metadata: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    author: { type: "string" },
                    subject: { type: "string" },
                    creator: { type: "string" },
                    producer: { type: "string" },
                    creationDate: { type: "string", format: "date-time" },
                    modificationDate: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
        ChatRequest: {
          type: "object",
          required: ["query", "walletId"],
          properties: {
            query: {
              type: "string",
              description: "User's question about the document",
              example: "What is this document about?",
            },
            walletId: {
              type: "string",
              description:
                "User's wallet ID for authentication and message tracking",
              example: "user_wallet_123",
            },
          },
        },
        ChatResponse: {
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
                  example:
                    "This document is about artificial intelligence and machine learning concepts...",
                },
                documentId: {
                  type: "string",
                  example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                },
                documentName: {
                  type: "string",
                  example: "document.pdf",
                },
                conversationContext: {
                  type: "integer",
                  description: "Number of previous messages used for context",
                  example: 2,
                },
                relevantChunks: {
                  type: "integer",
                  description: "Number of relevant text chunks found",
                  example: 3,
                },
                sources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      chunkIndex: { type: "integer" },
                      similarity: { type: "number" },
                      preview: { type: "string" },
                    },
                  },
                },
                usage: {
                  type: "object",
                  properties: {
                    prompt_tokens: { type: "integer" },
                    completion_tokens: { type: "integer" },
                    total_tokens: { type: "integer" },
                  },
                },
                responseTime: {
                  type: "integer",
                  description: "Response time in milliseconds",
                  example: 1500,
                },
              },
            },
          },
        },
        Message: {
          type: "object",
          properties: {
            messageId: {
              type: "string",
              example: "msg_uuid",
            },
            walletId: {
              type: "string",
              example: "user_wallet_123",
            },
            documentId: {
              type: "string",
              example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            },
            message: {
              type: "string",
              example: "What is this document about?",
            },
            sender: {
              type: "string",
              enum: ["user", "assistant", "system"],
              example: "user",
            },
            messageType: {
              type: "string",
              enum: ["query", "response", "system", "error"],
              example: "query",
            },
            timestamp: {
              type: "string",
              format: "date-time",
            },
            metadata: {
              type: "object",
            },
            relevantSources: {
              type: "array",
              items: {
                type: "object",
              },
            },
          },
        },
        Document: {
          type: "object",
          properties: {
            documentId: {
              type: "string",
              example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            },
            fileName: {
              type: "string",
              example: "document.pdf",
            },
            uploadedAt: {
              type: "string",
              format: "date-time",
            },
            fileSize: {
              type: "integer",
              example: 1024000,
            },
            totalPages: {
              type: "integer",
              example: 10,
            },
            hasConversation: {
              type: "boolean",
              description: "Whether the document has any conversation history",
              example: true,
            },
          },
        },
        DocumentMessage: {
          type: "object",
          properties: {
            messageId: {
              type: "string",
              description: "Unique message identifier",
              example: "msg_uuid",
            },
            message: {
              type: "string",
              description: "Message content",
              example: "What is this document about?",
            },
            sender: {
              type: "string",
              enum: ["user", "assistant", "system"],
              description: "Message sender",
              example: "user",
            },
            messageType: {
              type: "string",
              enum: ["query", "response", "system", "error"],
              description: "Type of message",
              example: "query",
            },
            timestamp: {
              type: "string",
              format: "date-time",
              description: "Message timestamp",
            },
            metadata: {
              type: "object",
              description: "Additional message metadata",
            },
            relevantSources: {
              type: "array",
              items: {
                type: "object",
                description: "Relevant document sources",
              },
            },
          },
        },
        DocumentConversationSummary: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            data: {
              type: "object",
              properties: {
                documentId: {
                  type: "string",
                  example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                },
                totalMessages: {
                  type: "integer",
                  example: 8,
                },
                userMessages: {
                  type: "integer",
                  example: 4,
                },
                assistantMessages: {
                  type: "integer",
                  example: 4,
                },
                firstMessageAt: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
                lastMessageAt: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
                hasConversation: {
                  type: "boolean",
                  example: true,
                },
                document: {
                  type: "object",
                  properties: {
                    fileName: { type: "string" },
                    uploadedAt: { type: "string", format: "date-time" },
                    fileSize: { type: "integer" },
                    totalPages: { type: "integer" },
                  },
                },
              },
            },
          },
        },
        WalletDocuments: {
          type: "object",
          properties: {
            walletId: {
              type: "string",
              description: "User's wallet ID",
              example: "user_wallet_123",
            },
            noOfDocuments: {
              type: "integer",
              description: "Number of documents allowed for this wallet",
              example: 3,
            },
          },
        },
        WalletDocumentsResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            data: {
              $ref: "#/components/schemas/WalletDocuments",
            },
          },
        },
      },
      parameters: {
        WalletId: {
          name: "walletId",
          in: "path",
          required: true,
          description: "User's unique wallet ID",
          schema: {
            type: "string",
            example: "user_wallet_123",
          },
        },
        DocumentId: {
          name: "documentId",
          in: "path",
          required: true,
          description: "Document unique identifier",
          schema: {
            type: "string",
            example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          },
        },
        SessionId: {
          name: "session_id",
          in: "query",
          required: true,
          description: "Payment session ID",
          schema: {
            type: "string",
            example: "session_123",
          },
        },
        PaymentWalletId: {
          name: "walletId",
          in: "query",
          required: true,
          description: "Wallet ID for payment processing",
          schema: {
            type: "string",
            example: "wallet-123",
          },
        },
        NoOfDocs: {
          name: "noOfDocs",
          in: "query",
          required: true,
          description: "Number of documents purchased",
          schema: {
            type: "integer",
            example: 10,
          },
        },
      },
    },
    tags: [
      {
        name: "Health",
        description: "API health and status",
      },
      {
        name: "Payment Processing",
        description: "Payment gateway integration for plan purchases",
      },
      {
        name: "Wallet Management",
        description: "Wallet document limits and information",
      },
      {
        name: "PDF Management",
        description: "Upload and process PDF documents",
      },
      {
        name: "Document Management",
        description: "Manage uploaded documents and get document lists",
      },
      {
        name: "Document Chat",
        description: "Chat with specific documents using AI",
      },
      {
        name: "Document Conversations",
        description: "Manage document-specific conversation history",
      },
      {
        name: "Legacy Endpoints",
        description:
          "Deprecated endpoints maintained for backward compatibility",
      },
      {
        name: "Wallet Documents",
        description: "Manage wallet document limits",
      },
    ],
  },
  apis: [
    path.join(__dirname, "../routes/*.js"),
    "./src/pdf-chat/routes/*.js",
    "./src/pdf-chat/routes/pdfChatRoutes.js",
    "./src/routes/*.js",
    "./src/routes/paymentRoutes.js",
    path.resolve(__dirname, "../routes/pdfChatRoutes.js"),
    path.resolve(__dirname, "../../routes/paymentRoutes.js"),
  ], // Multiple path options to ensure routes are found
};

const specs = swaggerJSDoc(options);

module.exports = specs;
