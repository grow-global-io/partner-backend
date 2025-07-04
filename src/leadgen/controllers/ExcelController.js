const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const ExcelModel = require("../models/ExcelModel");
const ExcelProcessingService = require("../services/ExcelProcessingService");
const OpenAIService = require("../../services/OpenAIService");
const path = require("path");
const fs = require("fs");

/**
 * @description Excel controller for managing Excel file processing and vector search
 * @class ExcelController
 */
class ExcelController {
  constructor() {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("DEEPSEEK_API_KEY environment variable is required");
    }

    this.excelModel = new ExcelModel();
    this.excelService = new ExcelProcessingService();
    this.openAIService = new OpenAIService();

    // Initialize error handlers
    this.handleDeepseekError = this.handleDeepseekError.bind(this);

    // Configure multer for file uploads
    this.storage = multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, "../../uploads");
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
      },
    });

    this.upload = multer({
      storage: this.storage,
      fileFilter: (req, file, cb) => {
        if (
          file.mimetype ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          file.mimetype === "application/vnd.ms-excel"
        ) {
          cb(null, true);
        } else {
          cb(new Error("Only Excel files are allowed"), false);
        }
      },
      limits: {
        fileSize: 20 * 1024 * 1024, // 20MB limit
      },
    });

    // Batch size for embedding generation
    this.embeddingBatchSize = 10;
  }

  /**
   * @description Handle Deepseek API errors
   * @param {Error} error - Error object
   * @param {Object} res - Express response object
   * @private
   */
  handleDeepseekError(error, res) {
    console.error("DeepseekService error:", error);

    // Check if API key is invalid
    if (error.message.includes("API key")) {
      return res.status(401).json({
        success: false,
        error: "Failed to generate LLM response",
        details:
          "Invalid API key. Please check your DEEPSEEK_API_KEY environment variable.",
      });
    }

    // Check for rate limiting
    if (
      error.message.includes("rate limit") ||
      error.message.includes("too many requests")
    ) {
      return res.status(429).json({
        success: false,
        error: "Failed to generate LLM response",
        details: "Rate limit exceeded. Please try again later.",
      });
    }

    // Handle other API errors
    return res.status(500).json({
      success: false,
      error: "Failed to generate LLM response",
      details: error.message,
    });
  }

  /**
   * @description Upload and process Excel file
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async uploadExcel(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No file uploaded",
        });
      }

      const filePath = req.file.path;
      const fileStats = fs.statSync(filePath);

      // Validate file size (20MB limit)
      if (fileStats.size > 20 * 1024 * 1024) {
        fs.unlinkSync(filePath); // Clean up
        return res.status(400).json({
          success: false,
          error: "File size exceeds 20MB limit",
        });
      }

      // Validate Excel file
      if (!this.excelService.validateExcelFile(filePath, req.file.mimetype)) {
        fs.unlinkSync(filePath); // Clean up
        return res.status(400).json({
          success: false,
          error: "Invalid Excel file format",
        });
      }

      // Create document in DB to track progress
      const document = await this.excelModel.createDocument({
        fileName: req.file.originalname,
        fileKey: req.file.filename,
        status: "processing",
        progress: 0,
      });

      // Start processing in background
      this.processExcelFile(filePath, document.id).catch((error) => {
        console.error("Background processing failed:", error);
        this.excelModel.updateDocument(document.id, {
          status: "error",
          error: error.message,
        });
      });

      // Return immediate response with document ID
      return res.status(202).json({
        success: true,
        message: "File upload accepted, processing started",
        documentId: document.id,
      });
    } catch (error) {
      console.error("ExcelController: Error uploading file:", error);
      // Clean up file if it exists
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error("Failed to clean up file:", e);
        }
      }
      return res.status(500).json({
        success: false,
        error: "Internal server error during file upload",
      });
    }
  }

  /**
   * @description Process Excel file in background
   * @param {string} filePath - Path to uploaded file
   * @param {string} documentId - Document ID in database
   */
  async processExcelFile(filePath, documentId) {
    try {
      // Upload to S3
      const fileName = path.basename(filePath);
      const fileBuffer = fs.readFileSync(filePath);
      const s3Result = await this.excelService.uploadExcelToS3(
        fileBuffer,
        fileName
      );

      // Update document with S3 info
      await this.excelModel.updateDocument(documentId, {
        s3Url: s3Result.s3Url,
        status: "uploading",
        progress: 10,
      });

      // Process file using async generator
      const allRows = [];
      let totalBatches = 0;

      console.log("ExcelController: Starting file parsing...");

      for await (const batch of this.excelService.parseExcelFile(fileBuffer)) {
        // Skip metadata batch
        if (batch.isMetadata) {
          console.log("ExcelController: Processing metadata:", batch.metadata);
          continue;
        }

        if (Array.isArray(batch)) {
          allRows.push(...batch);
          totalBatches++;

          console.log(
            `ExcelController: Processed batch ${totalBatches}, total rows: ${allRows.length}`
          );

          // Update progress periodically
          if (totalBatches % 5 === 0) {
            await this.excelModel.updateDocument(documentId, {
              status: "processing",
              progress: Math.min(30 + totalBatches * 2, 50),
            });
          }
        } else {
          console.warn(
            "ExcelController: Unexpected batch format:",
            typeof batch
          );
        }
      }

      console.log(
        `ExcelController: Finished parsing, total rows: ${allRows.length}`
      );

      if (allRows.length === 0) {
        throw new Error("No data rows found in the Excel file");
      }

      // Update progress
      await this.excelModel.updateDocument(documentId, {
        status: "processing",
        progress: 50,
      });

      // Process embeddings in batches
      const batchSize = 10;
      let successfulEmbeddings = 0;

      console.log("ExcelController: Starting embedding generation...");

      for (let i = 0; i < allRows.length; i += batchSize) {
        const batch = allRows.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (row, index) => {
            try {
              const textContent = row.textContent || JSON.stringify(row.data);
              if (!textContent || textContent.trim() === "") {
                console.warn(
                  `ExcelController: Row ${i + index} has empty content`
                );
                return;
              }

              const embedding = await this.openAIService.generateEmbedding(
                textContent
              );
              if (embedding && Array.isArray(embedding)) {
                row.embedding = embedding;
                successfulEmbeddings++;
              } else {
                console.warn(
                  `ExcelController: Invalid embedding for row ${i + index}`
                );
              }
            } catch (error) {
              console.error(
                `ExcelController: Failed to create embedding for row ${
                  i + index
                }:`,
                error
              );
              // Continue processing other rows
            }
          })
        );

        // Update progress
        const progress = Math.min(
          50 + Math.floor(((i + batchSize) / allRows.length) * 50),
          100
        );
        await this.excelModel.updateDocument(documentId, {
          progress,
        });
      }

      console.log(
        `ExcelController: Generated ${successfulEmbeddings} embeddings out of ${allRows.length} rows`
      );

      // Filter out rows without embeddings
      const rowsWithEmbeddings = allRows.filter(
        (row) => row.embedding && Array.isArray(row.embedding)
      );

      if (rowsWithEmbeddings.length === 0) {
        throw new Error("No rows could be processed with embeddings");
      }

      // Transform rows to match database schema
      const transformedRows = rowsWithEmbeddings.map((row) => ({
        content: row.textContent || JSON.stringify(row.data),
        embedding: row.embedding,
        rowData: row.data,
        rowIndex: row.rowIndex,
        metadata: {
          worksheetName: row.worksheetName,
          worksheetId: row.worksheetId,
          originalRowNumber: row.originalRowNumber,
        },
      }));

      console.log(
        `ExcelController: Saving ${transformedRows.length} rows to database...`
      );

      // Save processed rows
      await this.excelModel.createRows(documentId, transformedRows);

      // Mark as complete
      await this.excelModel.updateDocument(documentId, {
        status: "completed",
        progress: 100,
      });

      console.log("ExcelController: File processing completed successfully");

      // Clean up local file
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error("ExcelController: Error processing file:", error);
      // Update document with error
      try {
        await this.excelModel.updateDocument(documentId, {
          status: "error",
          error: error.message,
        });
      } catch (updateError) {
        console.error(
          "ExcelController: Failed to update document with error:",
          updateError
        );
      }

      // Clean up local file
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error("ExcelController: Failed to clean up file:", e);
      }
      throw error;
    }
  }

  /**
   * @description Search Excel data using vector similarity
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async searchExcel(req, res) {
    try {
      const { query, fileKey, topK = 5 } = req.body;

      if (!query) {
        return res.status(400).json({
          success: false,
          error: "Query is required",
        });
      }

      // Validate API key before proceeding
      const isValidApiKey = await this.openAIService.validateApiKey();
      if (!isValidApiKey) {
        return res.status(401).json({
          success: false,
          error: "Failed to generate LLM response",
          details:
            "Invalid API key. Please check your DEEPSEEK_API_KEY environment variable.",
        });
      }

      // Generate query embedding
      let queryEmbedding;
      try {
        queryEmbedding = await this.openAIService.generateEmbedding(query);
      } catch (error) {
        return this.handleDeepseekError(error, res);
      }

      // Perform vector search
      const searchResults = await this.excelModel.vectorSearch(
        queryEmbedding,
        fileKey,
        parseInt(topK)
      );

      // Generate chat response if results found
      let chatResponse = null;
      if (searchResults.length > 0) {
        try {
          chatResponse = await this.openAIService.generateChatResponse(
            query,
            searchResults.map((result) => ({
              text: JSON.stringify(result.rowData),
              metadata: {
                rowIndex: result.rowIndex,
                fileKey: result.fileKey,
              },
            })),
            fileKey || "Excel document"
          );
        } catch (error) {
          return this.handleDeepseekError(error, res);
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          query,
          answer: chatResponse?.answer,
          results: searchResults.map((result) => ({
            rowData: result.rowData,
            fileKey: result.fileKey,
            rowIndex: result.rowIndex,
            score: result.score,
            metadata: result.metadata,
          })),
          totalResults: searchResults.length,
          fileKey: fileKey || null,
          topK: parseInt(topK),
          usage: chatResponse?.usage,
          model: chatResponse?.model,
        },
      });
    } catch (error) {
      console.error("ExcelController: Error searching Excel:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to search Excel data",
        details: error.message,
      });
    }
  }

  /**
   * @description Handle LLM query using Excel data as context
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async llmQuery(req, res) {
    const startTime = Date.now();

    try {
      const { query } = req.body;

      if (!query) {
        return res.status(400).json({
          success: false,
          error: "Query is required",
        });
      }

      // Generate query embedding
      let queryEmbedding;
      try {
        queryEmbedding = await this.openAIService.generateEmbedding(query);
      } catch (embeddingError) {
        console.error("Error generating query embedding:", embeddingError);
        return res.status(500).json(this.handleDeepseekError(embeddingError));
      }

      // Search for relevant rows across all documents
      let relevantRows;
      try {
        relevantRows = await this.excelModel.vectorSearch(
          queryEmbedding,
          null, // fileKey - search all files
          5, // limit - top 5 results
          0.2 // minimum similarity score
        );
      } catch (searchError) {
        console.error("Error searching vectors:", searchError);
        return res.status(500).json({
          success: false,
          error: "Failed to search Excel data",
          details: searchError.message,
        });
      }

      if (!relevantRows.length) {
        return res.status(404).json({
          success: false,
          error: "No relevant data found for query",
        });
      }

      // Generate LLM response with context
      let chatResponse;
      try {
        // Transform rows to the format expected by the service
        const formattedChunks = relevantRows.map((row) => ({
          text: row.content || JSON.stringify(row.rowData),
          metadata: {
            rowIndex: row.rowIndex,
            fileName: row.document?.fileName,
          },
          similarity: row.score,
        }));

        chatResponse = await this.openAIService.generateChatResponseWithContext(
          query,
          formattedChunks,
          "Excel Data", // Generic name since we're searching across all files
          [] // No conversation context for now
        );
      } catch (chatError) {
        console.error("Error generating chat response:", chatError);
        return res.status(500).json(this.handleDeepseekError(chatError));
      }

      const responseTime = Date.now() - startTime;

      return res.json({
        success: true,
        data: {
          answer: chatResponse.answer,
          sources: relevantRows.map((row) => ({
            fileName: row.fileName,
            rowIndex: row.rowIndex,
            rowData: row.rowData,
            score: row.score,
          })),
          responseTime,
          usage: chatResponse.usage,
          model: chatResponse.model,
        },
      });
    } catch (error) {
      console.error("ExcelController: Error in LLM query:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to generate LLM response",
        details: error.message,
      });
    }
  }

  /**
   * @description Get list of ingested Excel files
   * @param {Object} req - Express request object
   * @param {Object} req.query - Query parameters
   * @param {number} req.query.limit - Limit results (default: 50)
   * @param {number} req.query.offset - Offset for pagination (default: 0)
   * @param {string} req.query.status - Filter by status
   * @param {Object} res - Express response object
   * @returns {Object} Response with file list
   */
  async getFiles(req, res) {
    try {
      const { limit = 50, offset = 0, status } = req.query;

      const options = {
        limit: parseInt(limit),
        offset: parseInt(offset),
        status: status,
      };

      const files = await this.excelModel.getAllDocuments(options);

      return res.status(200).json({
        success: true,
        data: {
          files: files,
          count: files.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (error) {
      console.error("ExcelController: Error fetching files:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch files",
        details: error.message,
      });
    }
  }

  /**
   * @description Reprocess Excel file (download from S3, parse again, regenerate embeddings)
   * @param {Object} req - Express request object
   * @param {string} req.body.fileKey - File key to reprocess (required)
   * @param {boolean} req.body.reembed - Whether to regenerate embeddings (default: true)
   * @param {Object} res - Express response object
   * @returns {Object} Response with reprocessing status
   */
  async reprocessFile(req, res) {
    try {
      const { fileKey, reembed = true } = req.body;

      if (!fileKey) {
        return res.status(400).json({
          success: false,
          error: "fileKey is required",
        });
      }

      // Get existing document
      const document = await this.excelModel.getDocumentByFileKey(fileKey);
      if (!document) {
        return res.status(404).json({
          success: false,
          error: "File not found",
        });
      }

      // Update status to processing
      await this.excelModel.updateDocument(fileKey, {
        status: "processing",
        errorMessage: null,
      });

      // Download file from S3
      const fileBuffer = await this.excelService.downloadExcelFromS3(fileKey);

      // Parse Excel file
      const parsedData = await this.excelService.parseExcelFile(fileBuffer);
      const cleanedRows = this.excelService.cleanRowData(parsedData.rows);

      // Delete existing rows
      await this.excelModel.deleteDocument(fileKey);

      // Recreate document
      const documentData = {
        fileKey: document.fileKey,
        s3Url: document.s3Url,
        fileName: document.fileName,
        fileSize: document.fileSize,
        status: "processing",
      };

      await this.excelModel.createDocument(documentData);

      let embeddedRows = [];

      if (reembed) {
        // Generate new embeddings
        console.log(
          `Regenerating embeddings for ${cleanedRows.length} rows...`
        );

        for (let i = 0; i < cleanedRows.length; i++) {
          const row = cleanedRows[i];
          try {
            const embedding = await this.openAIService.generateEmbedding(
              row.textContent
            );

            embeddedRows.push({
              fileKey: fileKey,
              rowIndex: row.rowIndex,
              rowData: row.data,
              textContent: row.textContent,
              embedding: embedding,
              metadata: {
                worksheetName: row.worksheetName,
                worksheetId: row.worksheetId,
                originalRowNumber: row.originalRowNumber,
                wordCount: row.wordCount,
                characterCount: row.characterCount,
              },
            });
          } catch (embeddingError) {
            console.error(
              `Error generating embedding for row ${i}:`,
              embeddingError
            );
          }
        }
      } else {
        // Store rows without embeddings
        embeddedRows = cleanedRows.map((row) => ({
          fileKey: fileKey,
          rowIndex: row.rowIndex,
          rowData: row.data,
          textContent: row.textContent,
          embedding: null,
          metadata: {
            worksheetName: row.worksheetName,
            worksheetId: row.worksheetId,
            originalRowNumber: row.originalRowNumber,
            wordCount: row.wordCount,
            characterCount: row.characterCount,
          },
        }));
      }

      // Store rows in database
      if (embeddedRows.length > 0) {
        await this.excelModel.createRows(embeddedRows);
      }

      // Update document with completion status
      const updatedAt = new Date();
      await this.excelModel.updateDocument(fileKey, {
        status: "completed",
        rowCount: embeddedRows.length,
        embeddedAt: reembed ? updatedAt : document.embeddedAt,
        metadata: {
          ...parsedData.metadata,
          processedRows: embeddedRows.length,
          reprocessedAt: updatedAt,
          reembedded: reembed,
        },
      });

      return res.status(200).json({
        success: true,
        message: "File reprocessed successfully",
        data: {
          fileKey: fileKey,
          status: "completed",
          updatedAt: updatedAt,
          rowCount: embeddedRows.length,
          reembedded: reembed,
        },
      });
    } catch (error) {
      console.error("ExcelController: Error reprocessing file:", error);

      // Update document status to failed
      if (req.body.fileKey) {
        await this.excelModel.updateDocument(req.body.fileKey, {
          status: "failed",
          errorMessage: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to reprocess file",
        details: error.message,
      });
    }
  }

  /**
   * @description Get upload middleware
   * @returns {Function} Multer middleware
   */
  getUploadMiddleware() {
    return this.upload.single("excel");
  }
}

module.exports = ExcelController;
