const express = require("express");
const ExcelController = require("../controllers/ExcelController");
const { body, validationResult } = require("express-validator");

const router = express.Router();

// Initialize controller
const excelController = new ExcelController();

/**
 * @swagger
 * components:
 *   schemas:
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
 *                 default: 50
 *                 description: Minimum score threshold (0-100)
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
router.post("/find-leads", (req, res) => excelController.findLeads(req, res));

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
