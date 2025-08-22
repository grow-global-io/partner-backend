const express = require("express");
const ExcelController = require("../controllers/ExcelController");
const ChatController = require("../controllers/ChatController");
const { body, validationResult } = require("express-validator");

const router = express.Router();

// Initialize controllers
const excelController = new ExcelController();
const chatController = new ChatController();

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
 *           description: Similarity score (for search results)
 *         textContent:
 *           type: string
 *           description: Concatenated text content
 *         metadata:
 *           type: object
 *           description: Row metadata
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
 *                 description: Chat session ID (optional, will create if not provided)
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
 *                 description: Excel file (.xlsx or .xls)
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
 *                 description: Region or Country (optional)
 *                 example: "India"
 *               keywords:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Keywords array (optional)
 *                 example: ["Sari", "Lehenga", "Fashion"]
 *               limit:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum number of results
 *               minScore:
 *                 type: integer
 *                 default: 55
 *                 description: Minimum score threshold (0-100). Leads with score < 55% will be filtered out
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
 *                             description: Final weighted score (0-100)
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
 *         description: Missing required parameters (product, industry)
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
 *                           description: Locations for each subcategory (max 4)
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

module.exports = router;
