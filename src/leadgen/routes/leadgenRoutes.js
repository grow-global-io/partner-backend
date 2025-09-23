const express = require("express");
const ExcelController = require("../controllers/ExcelController");
const ChatController = require("../controllers/ChatController");
const PlagiarismController = require("../controllers/PlagiarismController");
const UserWalletController = require("../controllers/UserWalletController");
const { body, validationResult } = require("express-validator");

const router = express.Router();

// Initialize controllers
const excelController = new ExcelController();
const chatController = new ChatController();
const plagiarismController = new PlagiarismController();
const userWalletController = new UserWalletController();

/**
 * @swagger
 * components:
 *   schemas:
 *     ChatSession:
 *       type: object
 *       properties:
 *         chatId:
 *           type: string
 *           description: Unique chat session identifier
 *         messageCount:
 *           type: integer
 *           description: Number of question-answer pairs stored
 *         status:
 *           type: string
 *           enum: [new, gathering, active, idle]
 *           description: Current session status
 *         metadata:
 *           type: object
 *           properties:
 *             lastActivity:
 *               type: string
 *               format: date-time
 *             totalQuestions:
 *               type: integer
 *             sessionAge:
 *               type: integer
 *               description: Session age in milliseconds
 *
 *     LeadGenerationResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           description: Summary message about lead generation results
 *         leads:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               companyName:
 *                 type: string
 *               contactPerson:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               website:
 *                 type: string
 *               industry:
 *                 type: string
 *               region:
 *                 type: string
 *               score:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *               matchReason:
 *                 type: string
 *         metadata:
 *           type: object
 *           properties:
 *             totalFound:
 *               type: integer
 *             processingTime:
 *               type: integer
 *             searchCriteria:
 *               type: object
 *             chatId:
 *               type: string
 *             questionAnswerCount:
 *               type: integer
 *
 *     ExcelDocument:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Document ID
 *         fileKey:
 *           type: string
 *           description: S3 file key
 *         s3Url:
 *           type: string
 *           description: S3 public URL
 *         fileName:
 *           type: string
 *           description: Original filename
 *         fileSize:
 *           type: integer
 *           description: File size in bytes
 *         uploadedAt:
 *           type: string
 *           format: date-time
 *           description: Upload timestamp
 *         embeddedAt:
 *           type: string
 *           format: date-time
 *           description: Embedding generation timestamp
 *         rowCount:
 *           type: integer
 *           description: Number of processed rows
 *         status:
 *           type: string
 *           enum: [uploaded, processing, completed, failed]
 *           description: Processing status
 *         metadata:
 *           type: object
 *           description: Additional file metadata
 *
 *     ExcelRow:
 *       type: object
 *       properties:
 *         rowData:
 *           type: object
 *           description: Raw row data as key-value pairs
 *         fileKey:
 *           type: string
 *           description: Reference to Excel document
 *         rowIndex:
 *           type: integer
 *           description: Row index in the file
 *         score:
 *           type: number
 *           description: "Similarity score (for search results)"
 *         textContent:
 *           type: string
 *           description: Concatenated text content
 *         metadata:
 *           type: object
 *           description: Row metadata
 *
 *     UserWallet:
 *       type: object
 *       properties:
 *         walletAddress:
 *           type: string
 *           description: "Unique wallet address (any string format)"
 *           example: "wallet123"
 *         generationsCount:
 *           type: integer
 *           description: Number of AI text generations used by this wallet
 *           minimum: 0
 *           example: 7
 *         generationsAllowed:
 *           type: integer
 *           description: Maximum number of generations allowed for this wallet
 *           minimum: 1
 *           example: 10
 *         generationsRemaining:
 *           type: integer
 *           description: Number of generations remaining (computed field)
 *           minimum: 0
 *           example: 3
 *         usagePercentage:
 *           type: integer
 *           description: Usage percentage (computed field)
 *           minimum: 0
 *           maximum: 100
 *           example: 70
 *         isLimitReached:
 *           type: boolean
 *           description: Whether the wallet has reached its generation limit
 *           example: false
 *         needsUpgrade:
 *           type: boolean
 *           description: Whether the wallet needs an upgrade (low remaining generations)
 *           example: false
 *         planType:
 *           type: string
 *           enum: [free, basic, premium, enterprise]
 *           description: Current subscription plan type
 *           example: "free"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Wallet creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *         lastUpgrade:
 *           type: string
 *           format: date-time
 *           description: Last plan upgrade timestamp (optional)
 *         lastPurchase:
 *           type: string
 *           format: date-time
 *           description: Last generations purchase timestamp (optional)
 *
 *     UserWalletResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Wallet retrieved successfully"
 *         data:
 *           $ref: '#/components/schemas/UserWallet'
 *
 *     UserWalletListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Wallets retrieved successfully"
 *         data:
 *           type: object
 *           properties:
 *             wallets:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/UserWallet'
 *             pagination:
 *               type: object
 *               properties:
 *                 currentPage:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *                 totalCount:
 *                   type: integer
 *                 hasNext:
 *                   type: boolean
 *                 hasPrev:
 *                   type: boolean
 *
 *     UserWalletStatistics:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Statistics retrieved successfully"
 *         data:
 *           type: object
 *           properties:
 *             statistics:
 *               type: object
 *               properties:
 *                 totalWallets:
 *                   type: integer
 *                   description: Total number of wallets
 *                 totalGenerations:
 *                   type: integer
 *                   description: Sum of all generations across wallets
 *                 averageGenerations:
 *                   type: number
 *                   description: Average generations per wallet
 *                 maxGenerations:
 *                   type: integer
 *                   description: Maximum generations by a single wallet
 *                 minGenerations:
 *                   type: integer
 *                   description: Minimum generations by a wallet
 *             timestamp:
 *               type: string
 *               format: date-time
 */

/**
 * @swagger
 * /api/leadgen/store-qa:
 *   post:
 *     summary: Store question-answer pair in chat session
 *     tags: [Chat System]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *               - answer
 *             properties:
 *               chatId:
 *                 type: string
 *                 description: "Chat session ID (optional, will create if not provided)"
 *                 example: "12345678-1234-4123-8123-123456789012"
 *               question:
 *                 type: string
 *                 description: Predefined question from frontend
 *                 maxLength: 500
 *                 example: "What industry are you in?"
 *               answer:
 *                 type: string
 *                 description: User's varied answer
 *                 maxLength: 2000
 *                 example: "I am in the textile manufacturing business"
 *     responses:
 *       200:
 *         description: Question-answer pair stored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ChatSession'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Validation error"
 *                 message:
 *                   type: string
 *                   example: "Both question and answer are required"
 *                 code:
 *                   type: string
 *                   example: "MISSING_REQUIRED_FIELDS"
 *       500:
 *         description: Server error
 */
router.post(
  "/store-qa",
  [
    body("question")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Question is required")
      .isLength({ max: 500 })
      .withMessage("Question must be less than 500 characters"),
    body("answer")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Answer is required")
      .isLength({ max: 2000 })
      .withMessage("Answer must be less than 2000 characters"),
    body("chatId")
      .optional()
      .isUUID(4)
      .withMessage("ChatId must be a valid UUID v4"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        message: "Invalid input parameters",
        details: errors.array(),
        code: "VALIDATION_ERROR",
      });
    }
    await chatController.storeQuestionAnswer(req, res);
  }
);

/**
 * @swagger
 * /api/leadgen/generate-leads:
 *   post:
 *     summary: Generate leads from chat history using LLM analysis
 *     tags: [Chat System]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - chatId
 *             properties:
 *               chatId:
 *                 type: string
 *                 description: Chat session ID
 *                 example: "12345678-1234-4123-8123-123456789012"
 *     responses:
 *       200:
 *         description: Leads generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/LeadGenerationResponse'
 *       400:
 *         description: Validation error or insufficient data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Validation error"
 *                 message:
 *                   type: string
 *                   example: "chatId is required"
 *                 code:
 *                   type: string
 *                   example: "MISSING_CHAT_ID"
 *       404:
 *         description: Chat session not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Chat not found"
 *                 message:
 *                   type: string
 *                   example: "Chat session not found or has expired"
 *                 code:
 *                   type: string
 *                   example: "CHAT_NOT_FOUND"
 *       500:
 *         description: Lead generation failed
 */
router.post(
  "/generate-leads",
  [body("chatId").isUUID(4).withMessage("ChatId must be a valid UUID v4")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        message: "Invalid chatId format",
        details: errors.array(),
        code: "VALIDATION_ERROR",
      });
    }
    await chatController.generateLeads(req, res);
  }
);

/**
 * @swagger
 * /api/leadgen/chat/{chatId}:
 *   get:
 *     summary: Get chat session information
 *     tags: [Chat System]
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Chat session ID
 *     responses:
 *       200:
 *         description: Chat information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     chatId:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     lastActivity:
 *                       type: string
 *                       format: date-time
 *                     questionCount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     questionAnswers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           timestamp:
 *                             type: string
 *                             format: date-time
 *                           question:
 *                             type: string
 *                           answer:
 *                             type: string
 *                           questionType:
 *                             type: string
 *       404:
 *         description: Chat session not found
 *       400:
 *         description: Invalid chatId format
 */
router.get("/chat/:chatId", async (req, res) => {
  await chatController.getChatInfo(req, res);
});

/**
 * @swagger
 * /api/leadgen/chat-health:
 *   get:
 *     summary: Get chat system health status and statistics
 *     tags: [Chat System]
 *     responses:
 *       200:
 *         description: Health status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [healthy, warning, error]
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     cache:
 *                       type: object
 *                       properties:
 *                         totalSessions:
 *                           type: integer
 *                         activeSessions:
 *                           type: integer
 *                         memoryUsage:
 *                           type: object
 *                         status:
 *                           type: string
 *                     leadGeneration:
 *                       type: object
 *                       properties:
 *                         totalGenerations:
 *                           type: integer
 *                         successfulGenerations:
 *                           type: integer
 *                         successRate:
 *                           type: integer
 *                         status:
 *                           type: string
 *                     system:
 *                       type: object
 *                       properties:
 *                         uptime:
 *                           type: number
 *                         memoryUsage:
 *                           type: object
 *                         nodeVersion:
 *                           type: string
 *       500:
 *         description: Health check failed
 */
router.get("/chat-health", async (req, res) => {
  await chatController.getHealthStatus(req, res);
});

/**
 * @swagger
 * /api/leadgen/clear-expired:
 *   post:
 *     summary: Manually clear expired chat sessions (maintenance endpoint)
 *     tags: [Chat System]
 *     responses:
 *       200:
 *         description: Expired sessions cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Cleared 5 expired sessions"
 *                 data:
 *                   type: object
 *                   properties:
 *                     clearedSessions:
 *                       type: integer
 *                     remainingSessions:
 *                       type: integer
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       500:
 *         description: Cleanup failed
 */
router.post("/clear-expired", async (req, res) => {
  await chatController.clearExpiredSessions(req, res);
});

/**
 * @swagger
 * /api/leadgen/upload:
 *   post:
 *     summary: Upload Excel file and generate embeddings
 *     tags: [Excel Processing]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - excel
 *             properties:
 *               excel:
 *                 type: string
 *                 format: binary
 *                 description: "Excel file (.xlsx or .xls)"
 *     responses:
 *       201:
 *         description: File uploaded and processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     fileKey:
 *                       type: string
 *                     s3Url:
 *                       type: string
 *                     rowCount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     embeddedAt:
 *                       type: string
 *                       format: date-time
 *                     metadata:
 *                       type: object
 *       400:
 *         description: Invalid file or validation error
 *       500:
 *         description: Server error
 */
router.post("/upload", excelController.getUploadMiddleware(), (req, res) =>
  excelController.uploadExcel(req, res)
);

/**
 * @swagger
 * /api/leadgen/search:
 *   post:
 *     summary: Search Excel data using vector similarity
 *     tags: [Excel Processing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: Search query
 *               fileKey:
 *                 type: string
 *                 description: Optional file key to filter by
 *               topK:
 *                 type: integer
 *                 default: 5
 *                 description: Number of top results to return
 *     responses:
 *       200:
 *         description: Search completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     query:
 *                       type: string
 *                     results:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ExcelRow'
 *                     totalResults:
 *                       type: integer
 *                     fileKey:
 *                       type: string
 *                     topK:
 *                       type: integer
 *       400:
 *         description: Missing required query parameter
 *       500:
 *         description: Server error
 */
router.post("/search", (req, res) => excelController.searchExcel(req, res));

/**
 * @swagger
 * /api/leadgen/llm:
 *   post:
 *     tags: [LLM Query]
 *     summary: Query Excel data using natural language
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LLMQueryRequest'
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LLMQueryResponse'
 */
router.post(
  "/llm",
  [
    body("query")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Query is required")
      .isLength({ max: 1000 })
      .withMessage("Query must be less than 1000 characters"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        details: errors.array(),
      });
    }
    await excelController.llmQuery(req, res);
  }
);

/**
 * @swagger
 * /api/leadgen/files:
 *   get:
 *     summary: Get list of ingested Excel files
 *     tags: [Excel Processing]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of files to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of files to skip for pagination
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [uploaded, processing, completed, failed]
 *         description: Filter by processing status
 *     responses:
 *       200:
 *         description: Files retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     files:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ExcelDocument'
 *                     count:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *       500:
 *         description: Server error
 */
router.get("/files", (req, res) => excelController.getFiles(req, res));

/**
 * @swagger
 * /api/leadgen/reprocess:
 *   post:
 *     summary: Reprocess Excel file (re-parse and optionally re-embed)
 *     tags: [Excel Processing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fileKey
 *             properties:
 *               fileKey:
 *                 type: string
 *                 description: File key to reprocess
 *               reembed:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to regenerate embeddings
 *     responses:
 *       200:
 *         description: File reprocessed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     fileKey:
 *                       type: string
 *                     status:
 *                       type: string
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *                     rowCount:
 *                       type: integer
 *                     reembedded:
 *                       type: boolean
 *       400:
 *         description: Missing fileKey parameter
 *       404:
 *         description: File not found
 *       500:
 *         description: Server error
 */
router.post("/reprocess", (req, res) =>
  excelController.reprocessFile(req, res)
);

/**
 * @swagger
 * /api/leadgen/categories:
 *   get:
 *     summary: Get available categories and statistics
 *     tags: [Lead Matching]
 *     responses:
 *       200:
 *         description: Categories retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalCategories:
 *                       type: integer
 *                     totalLocations:
 *                       type: integer
 *                     topCategories:
 *                       type: object
 *                     topLocations:
 *                       type: object
 *       500:
 *         description: Server error
 */
router.get("/categories", async (req, res) => {
  await excelController.getCategoryStats(req, res);
});

/**
 * @swagger
 * /api/leadgen/delete:
 *   post:
 *     summary: Delete Excel file and its embeddings
 *     tags: [Excel Processing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fileKey
 *             properties:
 *               fileKey:
 *                 type: string
 *                 description: File key to delete
 *               deleteFromS3:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to delete from S3 storage
 *     responses:
 *       200:
 *         description: File deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     fileKey:
 *                       type: string
 *                     fileName:
 *                       type: string
 *                     deletedFromDatabase:
 *                       type: boolean
 *                     deletedFromS3:
 *                       type: boolean
 *                     s3DeletionResult:
 *                       type: object
 *                     deletedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Missing fileKey parameter
 *       404:
 *         description: File not found
 *       500:
 *         description: Server error
 */
router.post("/delete", (req, res) => excelController.deleteFile(req, res));

/**
 * @swagger
 * /api/leadgen/find-leads-filtered:
 *   post:
 *     summary: Find leads with proper category and subcategory filtering
 *     tags: [Lead Matching]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - category
 *               - subcategory
 *             properties:
 *               category:
 *                 type: string
 *                 description: "Main category (e.g., \"Apparel & Clothing\")"
 *                 example: "Apparel & Clothing"
 *               subcategory:
 *                 type: string
 *                 description: "Subcategory (e.g., \"Pet Apparel\")"
 *                 example: "Pet Apparel"
 *               location:
 *                 type: string
 *                 description: "Location filter (optional)"
 *                 example: "Pune"
 *               limit:
 *                 type: integer
 *                 default: 50
 *                 description: Maximum number of results
 *               minScore:
 *                 type: integer
 *                 default: 60
 *                 description: "Minimum score threshold (0-100)"
 *               strictFiltering:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to apply strict category/subcategory filtering
 *     responses:
 *       200:
 *         description: Leads found and scored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     searchCriteria:
 *                       type: object
 *                     totalMatches:
 *                       type: integer
 *                     qualifiedLeads:
 *                       type: integer
 *                     leads:
 *                       type: array
 *                       items:
 *                         type: object
 *                     filteringSummary:
 *                       type: object
 *       400:
 *         description: "Missing required parameters (category, subcategory)"
 *       404:
 *         description: No relevant leads found
 *       500:
 *         description: Server error
 */
router.post(
  "/find-leads-filtered",
  [
    body("category")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Category is required")
      .isLength({ max: 100 })
      .withMessage("Category must be less than 100 characters"),
    body("subcategory")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Subcategory is required")
      .isLength({ max: 100 })
      .withMessage("Subcategory must be less than 100 characters"),
    body("location")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage("Location must be less than 100 characters"),
    body("limit")
      .optional()
      .isInt({ min: 1, max: 200 })
      .withMessage("Limit must be between 1 and 200"),
    body("minScore")
      .optional()
      .isInt({ min: 0, max: 100 })
      .withMessage("MinScore must be between 0 and 100"),
    body("strictFiltering")
      .optional()
      .isBoolean()
      .withMessage("StrictFiltering must be a boolean"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        message: "Invalid input parameters",
        details: errors.array(),
        code: "VALIDATION_ERROR",
      });
    }
    await excelController.findLeadsWithCategoryFilter(req, res);
  }
);

/**
 * @swagger
 * components:
 *   schemas:
 *     PlagiarismReport:
 *       type: object
 *       properties:
 *         reportId:
 *           type: string
 *           description: Unique report identifier
 *         inputType:
 *           type: string
 *           enum: [text, url]
 *           description: Type of input checked
 *         plagiarismScore:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *           description: Overall plagiarism score percentage
 *         status:
 *           type: string
 *           enum: [pending, processing, completed, failed]
 *           description: Processing status
 *         summary:
 *           type: object
 *           properties:
 *             totalMatches:
 *               type: integer
 *             highSimilarityMatches:
 *               type: integer
 *             mediumSimilarityMatches:
 *               type: integer
 *             lowSimilarityMatches:
 *               type: integer
 *             overallRisk:
 *               type: string
 *               enum: [minimal, low, medium, high]
 *         matches:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *               title:
 *                 type: string
 *               similarityScore:
 *                 type: number
 *               matchType:
 *                 type: string
 *                 enum: [exact, near-exact, partial, paraphrase]
 *               matchedText:
 *                 type: string
 *               contextBefore:
 *                 type: string
 *               contextAfter:
 *                 type: string
 *         metadata:
 *           type: object
 *           properties:
 *             processingTime:
 *               type: integer
 *             wordsChecked:
 *               type: integer
 *             createdAt:
 *               type: string
 *               format: date-time
 */

/**
 * @swagger
 * /api/leadgen/plagiarism/check-text:
 *   post:
 *     summary: Check text content for plagiarism
 *     tags: [Plagiarism Detection]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 description: Text content to check for plagiarism
 *                 maxLength: 10000
 *                 example: "This is the text content I want to check for plagiarism."
 *               options:
 *                 type: object
 *                 properties:
 *                   maxQueries:
 *                     type: integer
 *                     default: 5
 *                     description: Maximum search queries to generate
 *                   minPhraseLength:
 *                     type: integer
 *                     default: 4
 *                     description: Minimum phrase length for searching
 *                   excludeUrls:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: URLs to exclude from plagiarism check
 *     responses:
 *       200:
 *         description: Plagiarism check completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PlagiarismReport'
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     cached:
 *                       type: boolean
 *                     processingTime:
 *                       type: integer
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post(
  "/plagiarism/check-text",
  [
    body("text")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Text is required")
      .isLength({ max: 10000 })
      .withMessage("Text must be less than 10,000 characters"),
    body("options.maxQueries")
      .optional()
      .isInt({ min: 1, max: 10 })
      .withMessage("maxQueries must be between 1 and 10"),
    body("options.minPhraseLength")
      .optional()
      .isInt({ min: 2, max: 10 })
      .withMessage("minPhraseLength must be between 2 and 10"),
    body("options.excludeUrls")
      .optional()
      .isArray()
      .withMessage("excludeUrls must be an array"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        message: "Invalid input parameters",
        details: errors.array(),
        code: "VALIDATION_ERROR",
      });
    }
    await plagiarismController.checkText(req, res);
  }
);

/**
 * @swagger
 * /api/leadgen/plagiarism/check-url:
 *   post:
 *     summary: Check URL content for plagiarism
 *     tags: [Plagiarism Detection]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: URL to check for plagiarism
 *                 example: "https://example.com/article"
 *               options:
 *                 type: object
 *                 properties:
 *                   maxQueries:
 *                     type: integer
 *                     default: 5
 *                   minPhraseLength:
 *                     type: integer
 *                     default: 4
 *                   excludeUrls:
 *                     type: array
 *                     items:
 *                       type: string
 *     responses:
 *       200:
 *         description: URL plagiarism check completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/PlagiarismReport'
 *                     - type: object
 *                       properties:
 *                         sourceUrl:
 *                           type: string
 *                         extractedMetadata:
 *                           type: object
 *       400:
 *         description: Invalid URL or validation error
 *       500:
 *         description: Server error
 */
router.post(
  "/plagiarism/check-url",
  [
    body("url").isURL().withMessage("Valid URL is required"),
    body("options.maxQueries")
      .optional()
      .isInt({ min: 1, max: 10 })
      .withMessage("maxQueries must be between 1 and 10"),
    body("options.excludeUrls")
      .optional()
      .isArray()
      .withMessage("excludeUrls must be an array"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        message: "Invalid input parameters",
        details: errors.array(),
        code: "VALIDATION_ERROR",
      });
    }
    await plagiarismController.checkUrl(req, res);
  }
);

/**
 * @swagger
 * /api/leadgen/plagiarism/report/{reportId}:
 *   get:
 *     summary: Get plagiarism report by ID
 *     tags: [Plagiarism Detection]
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema:
 *           type: string
 *         description: Plagiarism report ID
 *     responses:
 *       200:
 *         description: Report retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PlagiarismReport'
 *       404:
 *         description: Report not found
 *       500:
 *         description: Server error
 */
router.get("/plagiarism/report/:reportId", async (req, res) => {
  await plagiarismController.getReport(req, res);
});

/**
 * @swagger
 * /api/leadgen/plagiarism/health:
 *   get:
 *     summary: Check plagiarism detection service health
 *     tags: [Plagiarism Detection]
 *     responses:
 *       200:
 *         description: Health check completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [healthy, unhealthy]
 *                     plagiarismDetection:
 *                       type: object
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       503:
 *         description: Service unhealthy
 */
router.get("/plagiarism/health", async (req, res) => {
  await plagiarismController.getHealthStatus(req, res);
});

/**
 * @swagger
 * /api/leadgen/plagiarism/stats:
 *   get:
 *     summary: Get plagiarism detection usage statistics
 *     tags: [Plagiarism Detection]
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     usage:
 *                       type: object
 *                     performance:
 *                       type: object
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       500:
 *         description: Server error
 */
router.get("/plagiarism/stats", async (req, res) => {
  await plagiarismController.getUsageStats(req, res);
});

module.exports = router;

/**
 * @swagger
 * /api/leadgen/find-leads:
 *   post:
 *     summary: Find and score leads based on matchmaking criteria
 *     tags: [Lead Matching]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - product
 *               - industry
 *             properties:
 *               product:
 *                 type: string
 *                 description: Product or Service name
 *                 example: "Women garments"
 *               industry:
 *                 type: string
 *                 description: Industry name
 *                 example: "Textiles"
 *               region:
 *                 type: string
 *                 description: "Region or Country (optional)"
 *                 example: "India"
 *               keywords:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: "Keywords array (optional)"
 *                 example: ["Sari", "Lehenga", "Fashion"]
 *               limit:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum number of results
 *               minScore:
 *                 type: integer
 *                 default: 55
 *                 description: "Minimum score threshold (0-100). Leads with score < 55% will be filtered out"
 *     responses:
 *       200:
 *         description: Leads found and scored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     searchCriteria:
 *                       type: object
 *                       properties:
 *                         product:
 *                           type: string
 *                         industry:
 *                           type: string
 *                         region:
 *                           type: string
 *                         keywords:
 *                           type: array
 *                           items:
 *                             type: string
 *                         searchQuery:
 *                           type: string
 *                     totalMatches:
 *                       type: integer
 *                       description: Total matches found before filtering
 *                     qualifiedLeads:
 *                       type: integer
 *                       description: Number of leads meeting minimum score
 *                     leads:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           companyName:
 *                             type: string
 *                           country:
 *                             type: string
 *                           industry:
 *                             type: string
 *                           email:
 *                             type: string
 *                           phone:
 *                             type: string
 *                           website:
 *                             type: string
 *                           finalScore:
 *                             type: integer
 *                             description: "Final weighted score (0-100)"
 *                           scoreBreakdown:
 *                             type: object
 *                             properties:
 *                               industryMatch:
 *                                 type: integer
 *                               geographicMatch:
 *                                 type: integer
 *                               contactCompleteness:
 *                                 type: integer
 *                               leadActivity:
 *                                 type: integer
 *                               exportReadiness:
 *                                 type: integer
 *                               engagement:
 *                                 type: integer
 *                               dataFreshness:
 *                                 type: integer
 *                           vectorSimilarity:
 *                             type: number
 *                             description: Vector similarity score
 *                           fileName:
 *                             type: string
 *                           rowIndex:
 *                             type: integer
 *                           priority:
 *                             type: string
 *                             enum: [High, Medium, Low]
 *                     insights:
 *                       type: object
 *                       properties:
 *                         summary:
 *                           type: string
 *                         totalAnalyzed:
 *                           type: integer
 *                         averageScore:
 *                           type: integer
 *                         topCountries:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               country:
 *                                 type: string
 *                               count:
 *                                 type: integer
 *                         recommendedAction:
 *                           type: string
 *                     responseTime:
 *                       type: integer
 *                       description: Response time in milliseconds
 *                     minScore:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     model:
 *                       type: string
 *       400:
 *         description: "Missing required parameters (product, industry)"
 *       401:
 *         description: Invalid API key
 *       404:
 *         description: No relevant leads found
 *       500:
 *         description: Server error
 */
router.post("/find-leads", (req, res) =>
  excelController.findLeadsOptimized(req, res)
);

/**
 * @swagger
 * /api/leadgen/filter-options:
 *   get:
 *     summary: Get hierarchical categories with subcategories and locations for frontend filters
 *     tags: [Lead Generation]
 *     description: Returns hierarchically structured filter options with categories as keys, containing 3-4 subcategories each with 3-4 locations
 *     responses:
 *       200:
 *         description: Hierarchical filter options retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Hierarchical filter options retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     filterStructure:
 *                       type: object
 *                       description: Hierarchical structure with categories as keys
 *                       additionalProperties:
 *                         type: object
 *                         description: Subcategories for each category
 *                         additionalProperties:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: "Locations for each subcategory (max 4)"
 *                       example:
 *                         "Computer":
 *                           "Hardware": ["Mumbai", "Delhi", "Bangalore", "Pune"]
 *                           "Software": ["Hyderabad", "Chennai", "Noida", "Gurgaon"]
 *                           "Peripherals": ["Kolkata", "Ahmedabad", "Jaipur", "Lucknow"]
 *                         "Apparel":
 *                           "Garments": ["Ludhiana", "Tirupur", "Coimbatore", "Erode"]
 *                           "Textile": ["Surat", "Ichalkaranji", "Bhiwandi", "Panipat"]
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalCategories:
 *                           type: integer
 *                           description: Total number of main categories
 *                         totalSubcategories:
 *                           type: integer
 *                           description: Total number of subcategories across all categories
 *                         totalLocations:
 *                           type: integer
 *                           description: Total number of locations across all subcategories
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *                       description: Timestamp when data was last retrieved
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Failed to retrieve filter options"
 *                 details:
 *                   type: string
 *                   description: Detailed error message
 */
router.get("/filter-options", (req, res) =>
  excelController.getFilterOptions(req, res)
);

/**
 * @swagger
 * /api/leadgen/performance/metrics:
 *   get:
 *     summary: Get current performance metrics
 *     tags: [Performance Monitoring]
 *     responses:
 *       200:
 *         description: Performance metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     aggregated:
 *                       type: object
 *                       properties:
 *                         totalRequests:
 *                           type: integer
 *                         averageResponseTime:
 *                           type: integer
 *                         p50:
 *                           type: integer
 *                         p95:
 *                           type: integer
 *                         p99:
 *                           type: integer
 *                         errorRate:
 *                           type: number
 *                         cacheHitRate:
 *                           type: number
 *                         openaiApiCalls:
 *                           type: integer
 *                         dbQueries:
 *                           type: integer
 *                     activeRequests:
 *                       type: integer
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       500:
 *         description: Server error
 */
router.get("/performance/metrics", (req, res) => {
  try {
    const metrics = excelController.performanceMonitor.getMetrics();
    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to retrieve performance metrics",
      details: error.message,
    });
  }
});

/**
 * @swagger
 * /api/leadgen/performance/report:
 *   get:
 *     summary: Get detailed performance report with recommendations
 *     tags: [Performance Monitoring]
 *     responses:
 *       200:
 *         description: Performance report generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     summary:
 *                       type: object
 *                     stagePerformance:
 *                       type: object
 *                     recentRequests:
 *                       type: array
 *                     recommendations:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                             enum: [critical, warning, info]
 *                           category:
 *                             type: string
 *                           message:
 *                             type: string
 *                           priority:
 *                             type: integer
 *       500:
 *         description: Server error
 */
router.get("/performance/report", (req, res) => {
  try {
    const report = excelController.performanceMonitor.getPerformanceReport();
    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to generate performance report",
      details: error.message,
    });
  }
});

// ===========================
// AI-Text Wallet Routes
// ===========================

/**
 * @swagger
 * /api/leadgen/ai-text/wallet:
 *   post:
 *     summary: Create or initialize a user wallet for AI text generations
 *     tags: [AI-Text]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: "Unique wallet address (any string format)"
 *                 example: "0x742d35cc6634c0532925a3b8d1b9e7c1e"
 *               generationsCount:
 *                 type: integer
 *                 description: "Initial generations count (default: 0)"
 *                 minimum: 0
 *                 default: 0
 *                 example: 10
 *     responses:
 *       201:
 *         description: Wallet created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserWalletResponse'
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Validation error"
 *                 message:
 *                   type: string
 *                   example: "Invalid request data"
 *                 code:
 *                   type: string
 *                   example: "VALIDATION_ERROR"
 *       500:
 *         description: Server error
 */
router.post(
  "/ai-text/wallet",
  [
    body("walletAddress")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Wallet address is required"),
    body("generationsCount")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Generations count must be a non-negative integer"),
    body("generationsAllowed")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Generations allowed must be a positive integer"),
    body("planType")
      .optional()
      .isIn(["free", "basic", "premium", "enterprise"])
      .withMessage("Plan type must be free, basic, premium, or enterprise"),
  ],
  async (req, res) => {
    await userWalletController.createWallet(req, res);
  }
);

/**
 * @swagger
 * /api/leadgen/ai-text/wallet/{walletAddress}:
 *   get:
 *     summary: Get wallet information by address (auto-creates if not found)
 *     description: Retrieves wallet information. If the wallet doesn't exist, it will be automatically created with basic details and generationsAllowed set to 3 by default.
 *     tags: [AI-Text]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: "Wallet address (any string format)"
 *         example: "wallet123"
 *     responses:
 *       200:
 *         description: Wallet retrieved successfully (or created and retrieved if it didn't exist)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserWalletResponse'
 *       400:
 *         description: Missing wallet address
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Missing wallet address"
 *                 message:
 *                   type: string
 *                   example: "Wallet address is required"
 *                 code:
 *                   type: string
 *                   example: "MISSING_WALLET_ADDRESS"
 *       500:
 *         description: Server error
 */
router.get("/ai-text/wallet/:walletAddress", async (req, res) => {
  await userWalletController.getWallet(req, res);
});

/**
 * @swagger
 * /api/leadgen/ai-text/wallet/{walletAddress}:
 *   put:
 *     summary: Update wallet generations count (auto-creates if not found during increment)
 *     description: Updates the generations count for a wallet. If using 'increment' operation and wallet doesn't exist, it will be automatically created with generationsCount=0 and then incremented by the specified amount.
 *     tags: [AI-Text]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: "Wallet address (any string format)"
 *         example: "wallet123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - generationsCount
 *             properties:
 *               generationsCount:
 *                 type: integer
 *                 description: New generations count or increment amount
 *                 minimum: 0
 *                 example: 15
 *               operation:
 *                 type: string
 *                 enum: [set, increment]
 *                 default: set
 *                 description: "Operation type - 'set' to replace count, 'increment' to add to current count. When incrementing non-existent wallet, it starts from 0 and adds the specified amount."
 *                 example: "increment"
 *     responses:
 *       200:
 *         description: Wallet updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Wallet updated successfully"
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/UserWallet'
 *                     - type: object
 *                       properties:
 *                         operation:
 *                           type: string
 *                           example: "increment"
 *                         created:
 *                           type: boolean
 *                           description: "True if wallet was auto-created during increment operation"
 *                           example: false
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: "Wallet not found (only for 'set' operations - 'increment' operations auto-create)"
 *       500:
 *         description: Server error
 */
router.put(
  "/ai-text/wallet/:walletAddress",
  [
    body("generationsCount")
      .isInt({ min: 0 })
      .withMessage("Generations count must be a non-negative integer"),
    body("generationsAllowed")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Generations allowed must be a positive integer"),
    body("planType")
      .optional()
      .isIn(["free", "basic", "premium", "enterprise"])
      .withMessage("Plan type must be free, basic, premium, or enterprise"),
    body("operation")
      .optional()
      .isIn(["set", "increment"])
      .withMessage("Operation must be either 'set' or 'increment'"),
  ],
  async (req, res) => {
    await userWalletController.updateWallet(req, res);
  }
);

/**
 * @swagger
 * /api/leadgen/ai-text/wallet/{walletAddress}:
 *   delete:
 *     summary: Delete wallet by address
 *     tags: [AI-Text]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: "Wallet address (any string format)"
 *         example: "wallet123"
 *     responses:
 *       200:
 *         description: Wallet deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Wallet deleted successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     walletAddress:
 *                       type: string
 *                       example: "wallet123"
 *                     deletedAt:
 *                       type: string
 *                       format: date-time
 *       404:
 *         description: Wallet not found
 *       500:
 *         description: Server error
 */
router.delete("/ai-text/wallet/:walletAddress", async (req, res) => {
  await userWalletController.deleteWallet(req, res);
});

/**
 * @swagger
 * /api/leadgen/ai-text/wallets:
 *   get:
 *     summary: Get all wallets with pagination and sorting
 *     tags: [AI-Text]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           minimum: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           minimum: 1
 *           maximum: 100
 *         description: "Number of wallets per page (max 100)"
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [walletAddress, generationsCount, createdAt, updatedAt]
 *           default: updatedAt
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Wallets retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserWalletListResponse'
 *       500:
 *         description: Server error
 */
router.get("/ai-text/wallets", async (req, res) => {
  await userWalletController.getAllWallets(req, res);
});

/**
 * @swagger
 * /api/leadgen/ai-text/statistics:
 *   get:
 *     summary: Get AI text generation statistics across all wallets
 *     tags: [AI-Text]
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserWalletStatistics'
 *       500:
 *         description: Server error
 */
router.get("/ai-text/statistics", async (req, res) => {
  await userWalletController.getStatistics(req, res);
});

/**
 * @swagger
 * /api/leadgen/ai-text/health:
 *   get:
 *     summary: Check AI text wallet service health
 *     tags: [AI-Text]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Wallet service is healthy"
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [healthy, unhealthy]
 *                       example: "healthy"
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     databaseConnected:
 *                       type: boolean
 *                       example: true
 *                     totalWallets:
 *                       type: integer
 *                       example: 150
 *       503:
 *         description: Service is unhealthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Service unhealthy"
 *                 message:
 *                   type: string
 *                   example: "Wallet service is experiencing issues"
 *                 code:
 *                   type: string
 *                   example: "SERVICE_UNHEALTHY"
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: "unhealthy"
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     databaseConnected:
 *                       type: boolean
 *                       example: false
 */
router.get("/ai-text/health", async (req, res) => {
  await userWalletController.healthCheck(req, res);
});

/**
 * @swagger
 * /api/leadgen/ai-text/test:
 *   get:
 *     summary: Test endpoint - creates a sample wallet for testing
 *     tags: [AI-Text]
 *     responses:
 *       201:
 *         description: Test wallet created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Test wallet created successfully"
 *                 data:
 *                   $ref: '#/components/schemas/UserWallet'
 *       500:
 *         description: Server error
 */
router.get("/ai-text/test", async (req, res) => {
  try {
    const testWalletAddress = `test-wallet-${Date.now()}`;
    await userWalletController.createWallet(
      {
        body: {
          walletAddress: testWalletAddress,
          generationsCount: 5,
        },
      },
      res
    );
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create test wallet",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/leadgen/debug/api-key:
 *   get:
 *     summary: Debug OpenAI API key status and configuration
 *     tags: [System Health]
 *     description: Returns masked API key information and validation results for debugging purposes
 *     responses:
 *       200:
 *         description: API key debug information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "API key debug information"
 *                 data:
 *                   type: object
 *                   properties:
 *                     keyInfo:
 *                       type: object
 *                       properties:
 *                         masked:
 *                           type: string
 *                           description: "Masked API key showing first 4 and last 4 characters"
 *                           example: "sk-1***************************abc123"
 *                         length:
 *                           type: integer
 *                           description: "Total length of the API key"
 *                           example: 51
 *                         validFormat:
 *                           type: boolean
 *                           description: "Whether the API key has valid format"
 *                           example: true
 *                         startsWithSk:
 *                           type: boolean
 *                           description: "Whether the API key starts with 'sk-'"
 *                           example: true
 *                         error:
 *                           type: string
 *                           nullable: true
 *                           description: "Error message if key format is invalid"
 *                           example: null
 *                     testResult:
 *                       type: object
 *                       properties:
 *                         isValid:
 *                           type: boolean
 *                           description: "Whether the API key is valid and functional"
 *                           example: true
 *                         error:
 *                           type: string
 *                           nullable: true
 *                           description: "Error message if validation failed"
 *                           example: null
 *                         details:
 *                           type: string
 *                           nullable: true
 *                           description: "Additional details about the validation"
 *                           example: null
 *                         modelCount:
 *                           type: integer
 *                           description: "Number of available models"
 *                           example: 45
 *                         hasGPT4:
 *                           type: boolean
 *                           description: "Whether GPT-4 models are available"
 *                           example: true
 *                     healthStatus:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           enum: [healthy, unhealthy, error]
 *                           description: "Overall health status"
 *                           example: "healthy"
 *                         apiKeyConfigured:
 *                           type: boolean
 *                           description: "Whether API key is configured"
 *                           example: true
 *                         validFormat:
 *                           type: boolean
 *                           description: "Whether API key format is valid"
 *                           example: true
 *       401:
 *         description: API key is invalid or missing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Failed to test API key"
 *                 details:
 *                   type: string
 *                   example: "Invalid API key - check your key is correct"
 *                 keyInfo:
 *                   type: object
 *                   properties:
 *                     masked:
 *                       type: string
 *                       example: "NOT_SET"
 *                     length:
 *                       type: integer
 *                       example: 0
 *                     validFormat:
 *                       type: boolean
 *                       example: false
 *                     startsWithSk:
 *                       type: boolean
 *                       example: false
 *                     error:
 *                       type: string
 *                       example: "OPENAI_API_KEY environment variable is not set"
 *       500:
 *         description: Server error during API key testing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Failed to get API key information"
 *                 details:
 *                   type: string
 *                   example: "Unexpected error occurred"
 */
router.get("/debug/api-key", (req, res) =>
  excelController.debugApiKey(req, res)
);

/**
 * @swagger
 * /api/leadgen/health:
 *   get:
 *     summary: Check S3 connectivity and permissions
 *     tags: [System Health]
 *     responses:
 *       200:
 *         description: Health check completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     s3Connection:
 *                       type: boolean
 *                     bucketAccess:
 *                       type: boolean
 *                     uploadPermission:
 *                       type: boolean
 *                     deletePermission:
 *                       type: boolean
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: string
 *                     recommendations:
 *                       type: array
 *                       items:
 *                         type: string
 *       500:
 *         description: Health check failed
 */
router.get("/health", async (req, res) => {
  try {
    // Check S3 health
    const s3HealthResult = await excelController.excelService.healthCheck();

    // Check OpenAI health
    const openaiHealthResult = await excelController.getOpenAIHealthStatus();

    // Generate recommendations based on health check results
    const recommendations = [];

    // S3 recommendations
    if (!s3HealthResult.s3Connection) {
      recommendations.push("Check AWS credentials and region configuration");
    }

    if (!s3HealthResult.bucketAccess) {
      recommendations.push(
        "Verify bucket name and basic S3 access permissions"
      );
    }

    if (!s3HealthResult.uploadPermission) {
      recommendations.push(
        "Grant s3:PutObject permission for Excel file uploads"
      );
    }

    if (!s3HealthResult.deletePermission) {
      recommendations.push(
        "Grant s3:DeleteObject permission for file deletion feature"
      );
    }

    // OpenAI recommendations
    if (openaiHealthResult.status === "unhealthy") {
      recommendations.push("Check OPENAI_API_KEY environment variable");
    }

    if (openaiHealthResult.status === "error") {
      recommendations.push(`OpenAI error: ${openaiHealthResult.error}`);
    }

    // Determine overall service health
    const s3Healthy =
      s3HealthResult.s3Connection && s3HealthResult.bucketAccess;
    const openaiHealthy = openaiHealthResult.status === "healthy";
    const overallHealthy = s3Healthy && openaiHealthy;

    return res.status(overallHealthy ? 200 : 503).json({
      success: overallHealthy,
      message: `Health check completed - Service is ${
        overallHealthy ? "healthy" : "degraded"
      }`,
      data: {
        overall: {
          status: overallHealthy ? "healthy" : "degraded",
          services: {
            s3: s3Healthy ? "healthy" : "unhealthy",
            openai: openaiHealthy ? "healthy" : "unhealthy",
          },
        },
        s3: s3HealthResult,
        openai: openaiHealthResult,
        recommendations,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("ExcelController: Health check error:", error);
    return res.status(500).json({
      success: false,
      error: "Health check failed",
      details: error.message,
    });
  }
});

// ==================== SaaS-Specific AI-Text Wallet Endpoints ====================

/**
 * @swagger
 * /api/leadgen/ai-text/wallet/{walletAddress}/can-generate:
 *   get:
 *     summary: Check if wallet can perform generation (SaaS usage validation)
 *     description: Validates if the wallet has remaining generations within their plan limits
 *     tags: [AI-Text, SaaS]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: "Wallet address (any string format)"
 *         example: "wallet123"
 *     responses:
 *       200:
 *         description: Generation allowed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Usage within limits"
 *                 data:
 *                   type: object
 *                   properties:
 *                     allowed:
 *                       type: boolean
 *                       example: true
 *                     reason:
 *                       type: string
 *                       example: "Usage within limits"
 *                     currentUsage:
 *                       type: integer
 *                       example: 7
 *                     limit:
 *                       type: integer
 *                       example: 10
 *                     remaining:
 *                       type: integer
 *                       example: 3
 *                     needsUpgrade:
 *                       type: boolean
 *                       example: false
 *                     planType:
 *                       type: string
 *                       example: "free"
 *       403:
 *         description: Generation limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Generation limit exceeded"
 *                 data:
 *                   type: object
 *                   properties:
 *                     allowed:
 *                       type: boolean
 *                       example: false
 *                     needsUpgrade:
 *                       type: boolean
 *                       example: true
 */
router.get("/ai-text/wallet/:walletAddress/can-generate", async (req, res) => {
  await userWalletController.canGenerate(req, res);
});

/**
 * @swagger
 * /api/leadgen/ai-text/wallet/{walletAddress}/upgrade:
 *   post:
 *     summary: Upgrade wallet plan
 *     description: Upgrade a wallet to a higher plan with increased generation limits
 *     tags: [AI-Text, SaaS]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: "Wallet address (any string format)"
 *         example: "wallet123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - planType
 *               - generationsAllowed
 *             properties:
 *               planType:
 *                 type: string
 *                 enum: [basic, premium, enterprise]
 *                 description: "New plan type"
 *                 example: "premium"
 *               generationsAllowed:
 *                 type: integer
 *                 minimum: 1
 *                 description: "New generation limit for the plan"
 *                 example: 1000
 *     responses:
 *       200:
 *         description: Plan upgraded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserWalletResponse'
 */
router.post(
  "/ai-text/wallet/:walletAddress/upgrade",
  [
    body("planType")
      .isIn(["basic", "premium", "enterprise"])
      .withMessage("Plan type must be basic, premium, or enterprise"),
    body("generationsAllowed")
      .isInt({ min: 1 })
      .withMessage("Generations allowed must be a positive integer"),
  ],
  async (req, res) => {
    await userWalletController.upgradePlan(req, res);
  }
);

/**
 * @swagger
 * /api/leadgen/ai-text/wallet/{walletAddress}/add-generations:
 *   post:
 *     summary: Add generations to wallet (purchase more) with session tracking
 *     description: Add additional generations to a wallet's limit (for purchases/renewals). Includes session ID validation to prevent duplicate transactions.
 *     tags: [AI-Text, SaaS]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: "Wallet address (any string format)"
 *         example: "wallet123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - additionalGenerations
 *               - sessionId
 *             properties:
 *               additionalGenerations:
 *                 type: integer
 *                 minimum: 1
 *                 description: "Number of additional generations to add"
 *                 example: 500
 *               sessionId:
 *                 type: string
 *                 description: "Unique session identifier to prevent duplicate transactions"
 *                 example: "session_123_456_789"
 *               metadata:
 *                 type: object
 *                 description: "Additional metadata for the transaction (optional)"
 *                 properties:
 *                   source:
 *                     type: string
 *                     example: "stripe_payment"
 *                   planType:
 *                     type: string
 *                     example: "premium"
 *                   paymentAmount:
 *                     type: number
 *                     example: 29.99
 *     responses:
 *       200:
 *         description: Generations added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "500 generations added successfully"
 *                 data:
 *                   $ref: '#/components/schemas/UserWallet'
 *                 transaction:
 *                   type: object
 *                   properties:
 *                     sessionId:
 *                       type: string
 *                       example: "session_123_456_789"
 *                     additionalGenerations:
 *                       type: integer
 *                       example: 500
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       409:
 *         description: Duplicate session ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Duplicate transaction"
 *                 message:
 *                   type: string
 *                   example: "This session ID has already been used. Duplicate transactions are not allowed."
 *                 code:
 *                   type: string
 *                   example: "DUPLICATE_SESSION_ID"
 */
router.post(
  "/ai-text/wallet/:walletAddress/add-generations",
  [
    body("additionalGenerations")
      .isInt({ min: 1 })
      .withMessage("Additional generations must be a positive integer"),
    body("sessionId")
      .isString()
      .isLength({ min: 1 })
      .withMessage("Session ID is required and must be a non-empty string"),
    body("metadata")
      .optional()
      .isObject()
      .withMessage("Metadata must be an object if provided"),
  ],
  async (req, res) => {
    await userWalletController.addGenerations(req, res);
  }
);

/**
 * @swagger
 * /api/leadgen/ai-text/wallet/{walletAddress}/transactions:
 *   get:
 *     summary: Get transaction history for a wallet
 *     description: Retrieve the transaction history for a specific wallet with pagination
 *     tags: [AI-Text, SaaS]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: "Wallet address (any string format)"
 *         example: "wallet123"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: "Page number for pagination"
 *         example: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: "Number of transactions per page"
 *         example: 50
 *     responses:
 *       200:
 *         description: Transaction history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Transaction history retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           sessionId:
 *                             type: string
 *                             example: "session_123_456_789"
 *                           walletAddress:
 *                             type: string
 *                             example: "wallet123"
 *                           type:
 *                             type: string
 *                             example: "add_generations"
 *                           additionalGenerations:
 *                             type: integer
 *                             example: 500
 *                           metadata:
 *                             type: object
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           status:
 *                             type: string
 *                             example: "completed"
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                           example: 1
 *                         totalPages:
 *                           type: integer
 *                           example: 5
 *                         totalTransactions:
 *                           type: integer
 *                           example: 237
 *                         hasNextPage:
 *                           type: boolean
 *                           example: true
 *                         hasPrevPage:
 *                           type: boolean
 *                           example: false
 */
router.get("/ai-text/wallet/:walletAddress/transactions", async (req, res) => {
  await userWalletController.getTransactionHistory(req, res);
});

/**
 * @swagger
 * /api/leadgen/campaigns/{campaignId}/people:
 *   get:
 *     summary: Get people from leads-campaign collection by campaign ID
 *     tags: [Campaign Management]
 *     parameters:
 *       - in: path
 *         name: campaignId
 *         required: true
 *         schema:
 *           type: string
 *         description: Campaign ID to filter leads
 *         example: "cmp_12345"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Number of people per page
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt]
 *           default: createdAt
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: People retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Campaign people retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     people:
 *                       type: array
 *                       items:
 *                         type: object
 *                         description: Person object with flexible structure
 *                         example:
 *                           name: "John Doe"
 *                           email: "john@example.com"
 *                           phone: "+1234567890"
 *                           company: "Tech Corp"
 *                           position: "Software Engineer"
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                         totalPages:
 *                           type: integer
 *                         totalCount:
 *                           type: integer
 *                         hasNext:
 *                           type: boolean
 *                         hasPrev:
 *                           type: boolean
 *                     metadata:
 *                       type: object
 *                       properties:
 *                         campaignId:
 *                           type: string
 *                         totalPeople:
 *                           type: integer
 *                         filters:
 *                           type: object
 *       400:
 *         description: Invalid campaign ID or query parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Validation error"
 *                 message:
 *                   type: string
 *                   example: "Campaign ID is required"
 *                 code:
 *                   type: string
 *                   example: "INVALID_CAMPAIGN_ID"
 *       404:
 *         description: No people found for the campaign
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "No data found"
 *                 message:
 *                   type: string
 *                   example: "No people found for this campaign"
 *                 code:
 *                   type: string
 *                   example: "NO_PEOPLE_FOUND"
 *       500:
 *         description: Server error
 */
router.get("/campaigns/:campaignId/people", async (req, res) => {
  await excelController.getCampaignPeople(req, res);
});

/**
 * @swagger
 * /api/leadgen/campaigns/{campaignId}/all-people:
 *   get:
 *     summary: Get all people from a campaign (no pagination, filtering, or sorting)
 *     tags: [Campaign Management]
 *     parameters:
 *       - in: path
 *         name: campaignId
 *         required: true
 *         schema:
 *           type: string
 *         description: Campaign ID to get all people from
 *         example: "cmp_12345"
 *     responses:
 *       200:
 *         description: All people retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Campaign people retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     campaignId:
 *                       type: string
 *                       example: "cmp_12345"
 *                     people:
 *                       type: array
 *                       items:
 *                         type: object
 *                         description: Person object with flexible structure
 *                         example:
 *                           name: "John Doe"
 *                           email: "john@example.com"
 *                           phone: "+1234567890"
 *                           company: "Tech Corp"
 *                           position: "Software Engineer"
 *                     totalPeople:
 *                       type: integer
 *                       example: 150
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid campaign ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Validation error"
 *                 message:
 *                   type: string
 *                   example: "Campaign ID is required"
 *                 code:
 *                   type: string
 *                   example: "MISSING_CAMPAIGN_ID"
 *       404:
 *         description: No people found for the campaign
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "No people found"
 *                 message:
 *                   type: string
 *                   example: "No people found for campaign ID: cmp_12345"
 *                 code:
 *                   type: string
 *                   example: "NO_PEOPLE_FOUND"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Internal server error"
 *                 message:
 *                   type: string
 *                   example: "Failed to retrieve all campaign people"
 */
// Get all people from a campaign (no pagination, filtering, or sorting)
router.get("/campaigns/:campaignId/all-people", async (req, res) => {
  await excelController.getAllCampaignPeople(req, res);
});

module.exports = router;
