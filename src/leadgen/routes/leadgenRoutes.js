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

module.exports = router;
