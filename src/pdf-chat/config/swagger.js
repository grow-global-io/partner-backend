const swaggerJSDoc = require("swagger-jsdoc");
const path = require("path");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "PDF Chat API",
      version: "2.0.0",
      description:
        "A comprehensive PDF chat system that allows users to upload PDF documents, extract and store vector embeddings, and chat with their documents using OpenAI with document-centric conversations and chain of thought functionality.",
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
    ],
    components: {
      schemas: {
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
              nullable: true,
              example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            },
            documentName: {
              type: "string",
              nullable: true,
              example: "document.pdf",
            },
            message: {
              type: "string",
              example: "What is machine learning?",
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
              properties: {
                tokenUsage: {
                  type: "object",
                  nullable: true,
                  properties: {
                    prompt_tokens: { type: "integer" },
                    completion_tokens: { type: "integer" },
                    total_tokens: { type: "integer" },
                  },
                },
                relevantSources: {
                  type: "array",
                  items: { type: "object" },
                },
                similarity: { type: "number", nullable: true },
                model: { type: "string", nullable: true },
                responseTime: { type: "integer", nullable: true },
                userAgent: { type: "string", nullable: true },
                ipAddress: { type: "string", nullable: true },
              },
            },
          },
        },
        MessagesResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            data: {
              type: "object",
              properties: {
                messages: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/DocumentMessage",
                  },
                },
                documentId: {
                  type: "string",
                  example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                },
                document: {
                  type: "object",
                  properties: {
                    documentId: { type: "string" },
                    fileName: { type: "string" },
                    uploadedAt: { type: "string", format: "date-time" },
                  },
                },
                pagination: {
                  type: "object",
                  properties: {
                    currentPage: { type: "integer", example: 1 },
                    totalPages: { type: "integer", example: 5 },
                    totalMessages: { type: "integer", example: 100 },
                    hasNextPage: { type: "boolean", example: true },
                    hasPreviousPage: { type: "boolean", example: false },
                    limit: { type: "integer", example: 50 },
                  },
                },
              },
            },
          },
        },
        Conversation: {
          type: "object",
          properties: {
            conversationId: {
              type: "string",
              example: "conversation_uuid",
            },
            title: {
              type: "string",
              example: "What is machine learning",
            },
            lastMessage: {
              type: "string",
              example:
                "Machine learning is a subset of artificial intelligence...",
            },
            lastSender: {
              type: "string",
              enum: ["user", "assistant", "system"],
              example: "assistant",
            },
            lastTimestamp: {
              type: "string",
              format: "date-time",
            },
            messageCount: {
              type: "integer",
              example: 8,
            },
            documentId: {
              type: "string",
              nullable: true,
              example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            },
            documentName: {
              type: "string",
              nullable: true,
              example: "AI_Handbook.pdf",
            },
            firstTimestamp: {
              type: "string",
              format: "date-time",
            },
          },
        },
        ConversationsResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            data: {
              type: "object",
              properties: {
                conversations: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/Conversation",
                  },
                },
                pagination: {
                  type: "object",
                  properties: {
                    currentPage: { type: "integer", example: 1 },
                    totalPages: { type: "integer", example: 3 },
                    totalConversations: { type: "integer", example: 15 },
                    hasNextPage: { type: "boolean", example: true },
                    hasPreviousPage: { type: "boolean", example: false },
                    conversationsPerPage: { type: "integer", example: 20 },
                  },
                },
              },
            },
          },
        },
        ConversationMessagesResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            data: {
              type: "object",
              properties: {
                conversationId: {
                  type: "string",
                  example: "conversation_uuid",
                },
                messages: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/Message",
                  },
                },
                messageCount: {
                  type: "integer",
                  example: 8,
                },
              },
            },
          },
        },
        SearchMessagesResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            data: {
              type: "object",
              properties: {
                messages: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/Message",
                  },
                },
                searchQuery: {
                  type: "string",
                  example: "machine learning",
                },
                pagination: {
                  type: "object",
                  properties: {
                    currentPage: { type: "integer", example: 1 },
                    totalPages: { type: "integer", example: 2 },
                    totalResults: { type: "integer", example: 25 },
                    hasNextPage: { type: "boolean", example: true },
                    hasPreviousPage: { type: "boolean", example: false },
                    resultsPerPage: { type: "integer", example: 20 },
                  },
                },
              },
            },
          },
        },
        MessageStatisticsResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            data: {
              type: "object",
              properties: {
                totalMessages: { type: "integer", example: 150 },
                totalConversations: { type: "integer", example: 12 },
                totalDocuments: { type: "integer", example: 5 },
                userMessages: { type: "integer", example: 75 },
                assistantMessages: { type: "integer", example: 75 },
                firstMessageDate: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
                lastMessageDate: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
                totalTokens: { type: "integer", example: 50000 },
              },
            },
          },
        },
        DocumentListResponse: {
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
                  example: "user_wallet_123",
                },
                documents: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/DocumentWithConversation",
                  },
                },
                totalDocuments: {
                  type: "integer",
                  example: 1,
                },
                documentsWithConversations: {
                  type: "integer",
                  example: 1,
                },
              },
            },
          },
        },
        DocumentDetailsResponse: {
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
                fileName: {
                  type: "string",
                  example: "document.pdf",
                },
                fileSize: {
                  type: "integer",
                  example: 1024000,
                },
                totalPages: {
                  type: "integer",
                  example: 10,
                },
                totalChunks: {
                  type: "integer",
                  example: 25,
                },
                uploadedAt: {
                  type: "string",
                  format: "date-time",
                },
                lastChatAt: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
                downloadUrl: {
                  type: "string",
                  example: "https://presigned-url...",
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
              example: "Error message",
            },
            details: {
              type: "string",
              example: "Additional error details",
            },
          },
        },
        HealthResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            message: {
              type: "string",
              example: "PDF Chat API is running",
            },
            timestamp: {
              type: "string",
              format: "date-time",
            },
            version: {
              type: "string",
              example: "1.0.0",
            },
          },
        },
        DocumentWithConversation: {
          type: "object",
          properties: {
            documentId: {
              type: "string",
              description: "Unique document identifier",
              example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            },
            fileName: {
              type: "string",
              description: "Original filename",
              example: "document.pdf",
            },
            fileSize: {
              type: "integer",
              description: "File size in bytes",
              example: 1024000,
            },
            totalPages: {
              type: "integer",
              description: "Number of pages in PDF",
              example: 10,
            },
            totalChunks: {
              type: "integer",
              description: "Number of text chunks extracted",
              example: 25,
            },
            uploadedAt: {
              type: "string",
              format: "date-time",
              description: "Upload timestamp",
            },
            conversation: {
              type: "object",
              properties: {
                totalMessages: {
                  type: "integer",
                  description: "Total messages in document conversation",
                  example: 8,
                },
                userMessages: {
                  type: "integer",
                  description: "Number of user messages",
                  example: 4,
                },
                assistantMessages: {
                  type: "integer",
                  description: "Number of assistant messages",
                  example: 4,
                },
                firstMessageAt: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                  description: "Timestamp of first message",
                },
                lastMessageAt: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                  description: "Timestamp of last message",
                },
                hasConversation: {
                  type: "boolean",
                  description:
                    "Whether the document has any conversation history",
                  example: true,
                },
              },
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
      },
    },
    tags: [
      {
        name: "Health",
        description: "API health and status",
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
    ],
  },
  apis: [
    path.join(__dirname, "../routes/*.js"),
    "./src/pdf-chat/routes/*.js",
    "./src/pdf-chat/routes/pdfChatRoutes.js",
    path.resolve(__dirname, "../routes/pdfChatRoutes.js"),
  ], // Multiple path options to ensure routes are found
};

const specs = swaggerJSDoc(options);

module.exports = specs;
