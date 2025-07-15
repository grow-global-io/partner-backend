const express = require("express");
const multer = require("multer");
const PDFChatController = require("../controllers/PDFChatController");
const WalletDocumentsController = require("../controllers/WalletDocumentsController");
const S3Service = require("../services/S3Service");

const router = express.Router();

// Multer configuration for PDF uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Configure multer for general file uploads
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Initialize controller
const pdfChatController = new PDFChatController();

/**
 * @swagger
 * components:
 *   schemas:
 *     PDFUploadRequest:
 *       type: object
 *       required:
 *         - pdf
 *         - walletId
 *       properties:
 *         pdf:
 *           type: string
 *           format: binary
 *           description: PDF file to upload (max 10MB)
 *         walletId:
 *           type: string
 *           description: User's wallet ID
 *         url:
 *           type: string
 *           format: uri
 *           description: Optional URL associated with the document
 *
 *     PDFUploadResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Operation success status
 *         message:
 *           type: string
 *           description: Success message
 *         data:
 *           type: object
 *           properties:
 *             documentId:
 *               type: string
 *               description: Unique document identifier
 *             fileName:
 *               type: string
 *               description: Original filename
 *             totalPages:
 *               type: integer
 *               description: Number of pages in PDF
 *             totalChunks:
 *               type: integer
 *               description: Number of text chunks extracted
 *             fileSize:
 *               type: integer
 *               description: File size in bytes
 *             s3Url:
 *               type: string
 *               description: S3 storage URL
 *             uploadedAt:
 *               type: string
 *               format: date-time
 *               description: Upload timestamp
 *             metadata:
 *               type: object
 *               description: Additional document metadata
 *             url:
 *               type: string
 *               format: uri
 *               description: Associated URL if provided during upload
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Operation success status (false for errors)
 *         error:
 *           type: string
 *           description: Error message
 *         details:
 *           type: string
 *           description: Detailed error information
 *         troubleshooting:
 *           type: object
 *           description: Optional troubleshooting information
 *
 *     DocumentWithConversation:
 *       type: object
 *       properties:
 *         documentId:
 *           type: string
 *           description: Unique document identifier
 *         fileName:
 *           type: string
 *           description: Original filename
 *         fileSize:
 *           type: integer
 *           description: File size in bytes
 *         totalPages:
 *           type: integer
 *           description: Number of pages in PDF
 *         totalChunks:
 *           type: integer
 *           description: Number of text chunks extracted
 *         uploadedAt:
 *           type: string
 *           format: date-time
 *           description: Upload timestamp
 *         url:
 *           type: string
 *           format: uri
 *           description: Associated URL if provided during upload
 *         conversation:
 *           type: object
 *           properties:
 *             totalMessages:
 *               type: integer
 *             userMessages:
 *               type: integer
 *             assistantMessages:
 *               type: integer
 *             firstMessageAt:
 *               type: string
 *               format: date-time
 *             lastMessageAt:
 *               type: string
 *               format: date-time
 *             hasConversation:
 *               type: boolean
 *
 *     DocumentMessage:
 *       type: object
 *       properties:
 *         messageId:
 *           type: string
 *           description: Unique message identifier
 *         message:
 *           type: string
 *           description: Message content
 *         sender:
 *           type: string
 *           enum: [user, assistant, system]
 *           description: Message sender
 *         messageType:
 *           type: string
 *           enum: [query, response, system, error]
 *           description: Type of message
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Message timestamp
 *         metadata:
 *           type: object
 *           description: Additional message metadata
 *         relevantSources:
 *           type: array
 *           items:
 *             type: object
 *             description: Relevant document sources
 *
 *     ChatResponse:
 *       type: object
 *       properties:
 *         answer:
 *           type: string
 *           description: AI-generated response
 *         documentId:
 *           type: string
 *           description: Document ID
 *         documentName:
 *           type: string
 *           description: Document filename
 *         conversationContext:
 *           type: integer
 *           description: Number of previous messages used for context
 *         relevantChunks:
 *           type: integer
 *           description: Number of relevant text chunks found
 *         sources:
 *           type: array
 *           items:
 *             type: object
 *             description: Relevant sources with similarity scores
 *         responseTime:
 *           type: integer
 *           description: Response time in milliseconds
 *         usage:
 *           type: object
 *           description: Token usage information
 *
 *     DocumentListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           type: object
 *           properties:
 *             walletId:
 *               type: string
 *             documents:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   documentId:
 *                     type: string
 *                   fileName:
 *                     type: string
 *                   fileSize:
 *                     type: integer
 *                   totalPages:
 *                     type: integer
 *                   totalChunks:
 *                     type: integer
 *                   uploadedAt:
 *                     type: string
 *                     format: date-time
 *                   lastChatAt:
 *                     type: string
 *                     format: date-time
 *                   url:
 *                     type: string
 *                     format: uri
 *                     description: Associated URL if provided during upload
 *             totalDocuments:
 *               type: integer
 *             documentsWithConversations:
 *               type: integer
 *
 *     DocumentConversationSummary:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           type: object
 *           properties:
 *             documentId:
 *               type: string
 *             totalMessages:
 *               type: integer
 *             userMessages:
 *               type: integer
 *             assistantMessages:
 *               type: integer
 *             firstMessageAt:
 *               type: string
 *               format: date-time
 *             lastMessageAt:
 *               type: string
 *               format: date-time
 *             hasConversation:
 *               type: boolean
 *             document:
 *               type: object
 *               properties:
 *                 fileName:
 *                   type: string
 *                 uploadedAt:
 *                   type: string
 *                   format: date-time
 *                 fileSize:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *                 url:
 *                   type: string
 *                   format: uri
 *                   description: Associated URL if provided during upload
 *
 *     FileUploadResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Operation success status
 *         data:
 *           type: object
 *           properties:
 *             fileUrl:
 *               type: string
 *               format: uri
 *               description: Public S3 URL of the uploaded file
 *             fileName:
 *               type: string
 *               description: Original file name
 *             fileSize:
 *               type: integer
 *               description: File size in bytes
 *             mimeType:
 *               type: string
 *               description: File MIME type
 *             uploadedAt:
 *               type: string
 *               format: date-time
 *               description: Upload timestamp
 */

/**
 * @swagger
 * /api/api-routes/pdf-chat:
 *   get:
 *     tags: [Health]
 *     summary: API status and available endpoints
 *     description: Get information about the PDF Chat API and available endpoints
 *     responses:
 *       200:
 *         description: API status and endpoint information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 version:
 *                   type: string
 *                 endpoints:
 *                   type: object
 *                 documentation:
 *                   type: string
 */
router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "PDF Chat API is running",
    version: "2.0.0",
    features: [
      "Document-centric conversations",
      "Chain of thought AI responses",
      "Conversation history management",
      "Real-time message tracking",
      "Multi-document support",
    ],
    endpoints: {
      upload: "POST /upload - Upload PDF documents",
      documents:
        "GET /documents/{walletId} - Get all documents with conversation summaries",
      chat: "POST /chat/{documentId} - Chat with specific document",
      messages:
        "GET /documents/{walletId}/{documentId}/messages - Get conversation history",
      summary:
        "GET /documents/{walletId}/{documentId}/summary - Get conversation summary",
    },
    documentation: "/api/api-routes/pdf-chat/docs",
    testFile: "src/pdf-chat/test-endpoints.http",
  });
});

/**
 * @swagger
 * /api/api-routes/pdf-chat/upload:
 *   post:
 *     tags: [PDF Management]
 *     summary: Upload and process PDF document
 *     description: |
 *       Upload a PDF file and extract text content for chat functionality.
 *       You can optionally provide a URL associated with the document.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/PDFUploadRequest'
 *     responses:
 *       201:
 *         description: PDF uploaded and processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PDFUploadResponse'
 *       400:
 *         description: Bad request - missing parameters or invalid file
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error during upload or processing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/upload", upload.single("pdf"), (req, res) => {
  pdfChatController.uploadPDF(req, res);
});

/**
 * @swagger
 * /api/api-routes/pdf-chat/upload/file:
 *   post:
 *     tags: [File Management]
 *     summary: Upload a file to S3
 *     description: Upload any file to S3 and get back a public URL
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: File to upload
 *     responses:
 *       201:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FileUploadResponse'
 *       400:
 *         description: Bad request - no file uploaded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error during upload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/upload/file", fileUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    const mimeType = req.file.mimetype;

    // Initialize S3 service
    const s3Service = new S3Service();

    // Upload to S3
    const s3Result = await s3Service.uploadPDF(
      fileBuffer,
      fileName,
      "public", // Using 'public' as the folder name
      mimeType
    );

    res.status(201).json({
      success: true,
      data: {
        fileUrl: s3Result.s3Url,
        fileName: s3Result.fileName,
        fileSize: s3Result.fileSize,
        mimeType: s3Result.mimeType,
        uploadedAt: s3Result.uploadedAt,
      },
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).json({
      success: false,
      error: "Failed to upload file",
      details: error.message,
    });
  }
});

/**
 * @swagger
 * /api/api-routes/pdf-chat/documents/{walletId}:
 *   get:
 *     tags: [Document Management]
 *     summary: Get all documents with conversation summaries
 *     description: Retrieve all documents for a wallet with their conversation statistics
 *     parameters:
 *       - $ref: '#/components/parameters/WalletId'
 *     responses:
 *       200:
 *         description: Documents retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DocumentListResponse'
 *       404:
 *         description: No documents found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/documents/:walletId", (req, res) => {
  pdfChatController.getDocumentsWithConversations(req, res);
});

/**
 * @swagger
 * /api/api-routes/pdf-chat/documents/{walletId}/{documentId}/messages:
 *   get:
 *     tags: [Document Conversations]
 *     summary: Get all messages for a specific document
 *     description: Retrieve conversation history for a specific document
 *     parameters:
 *       - $ref: '#/components/parameters/WalletId'
 *       - $ref: '#/components/parameters/DocumentId'
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of messages per page
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *         description: Sort order (asc for chronological, desc for reverse)
 *     responses:
 *       200:
 *         description: Messages retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessagesResponse'
 *       404:
 *         description: Document not found or access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/documents/:walletId/:documentId/messages", (req, res) => {
  pdfChatController.getDocumentMessages(req, res);
});

/**
 * @swagger
 * /api/api-routes/pdf-chat/documents/{walletId}/{documentId}/summary:
 *   get:
 *     tags: [Document Conversations]
 *     summary: Get conversation summary for a document
 *     description: Get statistics and summary information for a document's conversation
 *     parameters:
 *       - $ref: '#/components/parameters/WalletId'
 *       - $ref: '#/components/parameters/DocumentId'
 *     responses:
 *       200:
 *         description: Conversation summary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DocumentConversationSummary'
 *       404:
 *         description: Document not found or access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/documents/:walletId/:documentId/summary", (req, res) => {
  pdfChatController.getDocumentConversationSummary(req, res);
});

/**
 * @swagger
 * /api/api-routes/pdf-chat/chat/{documentId}:
 *   post:
 *     tags: [Document Chat]
 *     summary: Chat with a specific document
 *     description: Send a query to chat with a specific document using OpenAI with conversation context (chain of thought). Requires walletId in request body for authentication and message tracking.
 *     parameters:
 *       - $ref: '#/components/parameters/DocumentId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *     responses:
 *       200:
 *         description: Chat response generated successfully using OpenAI
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatResponse'
 *       400:
 *         description: Bad request - missing required fields (documentId, query, or walletId)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Access denied - user doesn't have permission to chat with this document
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error during chat processing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/chat/:documentId", (req, res) => {
  pdfChatController.chatWithDocument(req, res);
});

// Legacy endpoints (deprecated but maintained for backward compatibility)
/**
 * @swagger
 * /api/api-routes/pdf-chat/documents/{walletId}/list:
 *   get:
 *     tags: [Legacy Endpoints]
 *     summary: Get documents for wallet (deprecated)
 *     description: Legacy endpoint - use /documents/{walletId} instead
 *     deprecated: true
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet ID
 *     responses:
 *       200:
 *         description: Documents retrieved (legacy format)
 */
router.get("/documents/:walletId/list", (req, res) => {
  pdfChatController.getDocuments(req, res);
});

/**
 * @swagger
 * /api/api-routes/pdf-chat/chat:
 *   post:
 *     tags: [Legacy Endpoints]
 *     summary: Chat with documents (deprecated)
 *     description: Legacy chat endpoint - use /chat/{documentId} instead for better conversation management
 *     deprecated: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               walletId:
 *                 type: string
 *               query:
 *                 type: string
 *               documentId:
 *                 type: string
 *                 description: Optional document ID
 *     responses:
 *       200:
 *         description: Chat response (legacy format)
 */
router.post("/chat", (req, res) => {
  pdfChatController.chat(req, res);
});

// Wallet Documents Routes
/**
 * @swagger
 * /api/api-routes/pdf-chat/wallet-documents:
 *   post:
 *     tags: [Wallet Documents]
 *     summary: Create or update wallet document limit
 *     description: Set the maximum number of documents allowed for a specific wallet
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletId
 *               - noOfDocuments
 *             properties:
 *               walletId:
 *                 type: string
 *                 description: User's wallet ID
 *                 example: "user_wallet_123"
 *               noOfDocuments:
 *                 type: integer
 *                 description: Maximum number of documents allowed
 *                 example: 5
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Wallet document limit created/updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WalletDocumentsResponse'
 *       400:
 *         description: Bad request - missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/wallet-documents", WalletDocumentsController.createOrUpdate);

/**
 * @swagger
 * /api/api-routes/pdf-chat/wallet-documents:
 *   get:
 *     tags: [Wallet Documents]
 *     summary: Get wallet document limit
 *     description: Retrieve the document limit for a specific wallet. If no limit exists, creates one with default value of 3 documents.
 *     parameters:
 *       - in: query
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet ID to get document limit for
 *         example: "user_wallet_123"
 *     responses:
 *       200:
 *         description: Wallet document limit retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WalletDocumentsResponse'
 *       400:
 *         description: Bad request - missing walletId parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/wallet-documents", WalletDocumentsController.get);

/**
 * @swagger
 * /api/api-routes/pdf-chat/wallet-documents/{walletId}:
 *   put:
 *     tags: [Wallet Documents]
 *     summary: Update wallet document limit
 *     description: Update the maximum number of documents allowed for a specific wallet
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet ID to update document limit for
 *         example: "user_wallet_123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - noOfDocuments
 *             properties:
 *               noOfDocuments:
 *                 type: integer
 *                 description: New maximum number of documents allowed
 *                 example: 10
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Wallet document limit updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WalletDocumentsResponse'
 *       400:
 *         description: Bad request - missing required fields or invalid walletId
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Wallet not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put("/wallet-documents/:walletId", WalletDocumentsController.update);

module.exports = router;
