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
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    this.excelModel = new ExcelModel();
    this.excelService = new ExcelProcessingService();
    this.openAIService = new OpenAIService();

    // Initialize error handlers
    this.handleOpenAIError = this.handleOpenAIError.bind(this);

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
   * @description Handle OpenAI API errors
   * @param {Error} error - Error object
   * @param {Object} res - Express response object
   * @private
   */
  handleOpenAIError(error, res) {
    console.error("OpenAIService error:", error);

    // Check if API key is invalid
    if (error.message.includes("API key")) {
      return res.status(401).json({
        success: false,
        error: "Failed to generate LLM response",
        details:
          "Invalid API key. Please check your OPENAI_API_KEY environment variable.",
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
            "Invalid API key. Please check your OPENAI_API_KEY environment variable.",
        });
      }

      // Generate query embedding
      let queryEmbedding;
      try {
        queryEmbedding = await this.openAIService.generateEmbedding(query);
      } catch (error) {
        return this.handleOpenAIError(error, res);
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
          return this.handleOpenAIError(error, res);
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
        return res.status(500).json(this.handleOpenAIError(embeddingError));
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
        return res.status(500).json(this.handleOpenAIError(chatError));
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
   * @description Find and score leads based on matchmaking criteria
   * @param {Object} req - Express request object
   * @param {string} req.body.product - Product/Service name (required)
   * @param {string} req.body.industry - Industry name (required)
   * @param {string} req.body.region - Region/Country (optional)
   * @param {Array<string>|string} req.body.keywords - Keywords array or comma-separated string (optional)
   * @param {number} req.body.limit - Maximum results (default: 10)
   * @param {number} req.body.minScore - Minimum score threshold (default: 30)
   * @param {Object} res - Express response object
   * @returns {Object} Response with scored leads
   */
  async findLeads(req, res) {
    const startTime = Date.now();

    try {
      const {
        product,
        industry,
        region,
        keywords: rawKeywords = [],
        limit = 10,
        minScore = 30, // Lowered default threshold
      } = req.body;

      // Validate required fields
      if (!product || !industry) {
        return res.status(400).json({
          success: false,
          error: "Product/Service and Industry are required fields",
        });
      }

      // Process keywords flexibly - handle both string and array inputs
      const keywords = this.processKeywords(rawKeywords);

      console.log(`ExcelController: Processing lead search:`, {
        product,
        industry,
        region,
        keywords,
        limit,
        minScore,
      });

      // DEBUG: Check if target records exist in database at all
      try {
        console.log(`\n=== DATABASE DEBUGGING ===`);

        // Try to find any record containing our target terms by doing a broad search
        const broadSearchEmbedding = await this.openAIService.generateEmbedding(
          "Godhra Gujarat Sunil Gandhi Dilip garments"
        );
        const broadResults = await this.excelModel.vectorSearch(
          broadSearchEmbedding,
          null, // all files
          200, // get many results
          0.0 // very low threshold
        );

        console.log(`Broad search found ${broadResults.length} total records`);

        // Direct text search through the results
        const targetTerms = ["godhra", "sunil", "gandhi", "dilip", "gujarat"];

        for (const term of targetTerms) {
          const textMatches = broadResults.filter((row) => {
            const content = (
              row.content || JSON.stringify(row.rowData || {})
            ).toLowerCase();
            return content.includes(term);
          });

          console.log(`Records containing "${term}": ${textMatches.length}`);

          if (textMatches.length > 0) {
            textMatches.slice(0, 2).forEach((match, idx) => {
              const company = this.extractCompanyNameEnhanced(match.rowData);
              const person =
                match.rowData?.Name || match.rowData?.name || "Unknown";
              const city =
                match.rowData?.City || match.rowData?.city || "Unknown";
              console.log(
                `  [${idx + 1}] Found: ${company} - ${person} - ${city}`
              );
            });
          }
        }

        console.log(`=== END DATABASE DEBUG ===\n`);
      } catch (dbError) {
        console.log(`Database debug error: ${dbError.message}`);
      }

      // Validate API key before proceeding
      const isValidApiKey = await this.openAIService.validateApiKey();
      if (!isValidApiKey) {
        return res.status(401).json({
          success: false,
          error: "Failed to generate LLM response",
          details:
            "Invalid API key. Please check your OPENAI_API_KEY environment variable.",
        });
      }

      // Build multiple search queries for better coverage
      const searchQueries = this.buildMultipleSearchQueries(
        product,
        industry,
        region,
        keywords
      );

      console.log(`ExcelController: Built search queries:`, searchQueries);

      // Try multiple search strategies
      let allRelevantRows = [];
      const searchResults = [];

      for (const query of searchQueries) {
        try {
          console.log(`ExcelController: Searching with query: "${query}"`);

          const queryEmbedding = await this.openAIService.generateEmbedding(
            query
          );

          console.log(`ExcelController: Generated embedding for "${query}"`);
          console.log(
            `  Embedding length: ${queryEmbedding?.length || "NULL"}`
          );
          console.log(`  Embedding type: ${typeof queryEmbedding}`);
          console.log(
            `  Embedding sample: [${
              queryEmbedding?.slice(0, 5).join(", ") || "NULL"
            }...]`
          );

          // Use very low threshold for maximum recall
          const rows = await this.excelModel.vectorSearch(
            queryEmbedding,
            null, // search all files
            Math.max(100, limit * 10), // Get many more results
            0.0 // Very low threshold - we'll filter with scoring later
          );

          console.log(
            `ExcelController: Query "${query}" found ${rows.length} rows`
          );

          // Debug: Log some sample results to see what we're getting
          if (rows.length > 0) {
            console.log(
              `ExcelController: Sample results for query "${query}":`
            );
            rows.slice(0, 3).forEach((row, idx) => {
              const sampleContent = (
                row.content || JSON.stringify(row.rowData)
              ).substring(0, 200);
              console.log(
                `  [${idx}] Score: ${row.score?.toFixed(
                  3
                )}, Content: ${sampleContent}...`
              );
            });
          } else {
            console.log(`ExcelController: ❌ NO RESULTS for query "${query}"`);
            console.log(`  This suggests either:`);
            console.log(`    1. No data in database`);
            console.log(`    2. All embeddings are null/invalid`);
            console.log(`    3. Similarity calculation is failing`);
            console.log(`    4. All similarity scores are 0.0`);
          }

          searchResults.push({
            query,
            resultsCount: rows.length,
          });

          allRelevantRows.push(...rows);
        } catch (embeddingError) {
          console.error(`Error with search query "${query}":`, embeddingError);
          // Continue with other queries
        }
      }

      // ADDITIONAL STRATEGY: Direct location-based search if region specified
      if (region) {
        try {
          console.log(
            `ExcelController: Performing direct location search for "${region}"`
          );

          // Create a pure location embedding
          const locationEmbedding = await this.openAIService.generateEmbedding(
            region
          );

          const locationRows = await this.excelModel.vectorSearch(
            locationEmbedding,
            null,
            50, // Get substantial results
            0.0 // Very low threshold
          );

          console.log(
            `ExcelController: Direct location search found ${locationRows.length} additional rows`
          );

          // Debug location-specific results
          if (locationRows.length > 0) {
            console.log(
              `ExcelController: Location-specific results for "${region}":`
            );
            locationRows.slice(0, 5).forEach((row, idx) => {
              const sampleContent = (
                row.content || JSON.stringify(row.rowData)
              ).substring(0, 200);
              console.log(
                `  [${idx}] Location Score: ${row.score?.toFixed(
                  3
                )}, Content: ${sampleContent}...`
              );
            });
          }

          allRelevantRows.push(...locationRows);

          searchResults.push({
            query: `Direct location: ${region}`,
            resultsCount: locationRows.length,
          });
        } catch (locationError) {
          console.error(
            `Error with direct location search for "${region}":`,
            locationError
          );
        }
      }

      // Remove duplicates based on row content/index
      const uniqueRows = this.deduplicateRows(allRelevantRows);

      console.log(
        `ExcelController: Found ${allRelevantRows.length} total rows, ${uniqueRows.length} unique rows`
      );

      // DEBUG: Let's see if we can find any records with "Sunil", "Gandhi", "Godhra", or "Dilip"
      console.log(`\n=== DEBUGGING: SEARCHING FOR SPECIFIC RECORDS ===`);
      const debugSearchTerms = [
        "sunil",
        "gandhi",
        "godhra",
        "dilip",
        "gujarat",
      ];

      for (const term of debugSearchTerms) {
        const matchingRows = uniqueRows.filter((row) => {
          const content = (
            row.content || JSON.stringify(row.rowData)
          ).toLowerCase();
          return content.includes(term);
        });

        console.log(`Records containing "${term}": ${matchingRows.length}`);
        if (matchingRows.length > 0) {
          matchingRows.slice(0, 3).forEach((row, idx) => {
            const companyName = this.extractCompanyNameEnhanced(row.rowData);
            const personName =
              row.rowData?.Name || row.rowData?.name || "Unknown";
            const location = this.extractCountryEnhanced(row.rowData);
            console.log(
              `  [${idx + 1}] ${companyName} - ${personName} - ${location}`
            );
          });
        }
      }

      // DEBUG: Show sample of what we DID find
      console.log(`\n=== SAMPLE OF FOUND RECORDS ===`);
      uniqueRows.slice(0, 5).forEach((row, idx) => {
        const companyName = this.extractCompanyNameEnhanced(row.rowData);
        const personName = row.rowData?.Name || row.rowData?.name || "Unknown";
        const location = this.extractCountryEnhanced(row.rowData);
        const content = (row.content || JSON.stringify(row.rowData)).substring(
          0,
          100
        );
        console.log(
          `[${
            idx + 1
          }] Company: ${companyName}, Person: ${personName}, Location: ${location}`
        );
        console.log(`    Content: ${content}...`);
        console.log(`    Vector Score: ${row.score?.toFixed(3)}`);
      });
      console.log(`=== END SAMPLE ===\n`);

      if (!uniqueRows.length) {
        // Try a final fallback search with just product name
        console.log(
          `ExcelController: No results found, trying fallback search with product only`
        );

        try {
          const fallbackEmbedding = await this.openAIService.generateEmbedding(
            product
          );
          const fallbackRows = await this.excelModel.vectorSearch(
            fallbackEmbedding,
            null,
            50,
            0.0 // Extremely low threshold
          );

          console.log(
            `ExcelController: Fallback search found ${fallbackRows.length} rows`
          );
          uniqueRows.push(...fallbackRows);
        } catch (fallbackError) {
          console.error("Fallback search failed:", fallbackError);
        }
      }

      if (!uniqueRows.length) {
        return res.status(404).json({
          success: false,
          error: "No relevant leads found for the specified criteria",
          data: {
            searchQueries,
            searchResults,
            totalResults: 0,
            leads: [],
            debugInfo: {
              message: "No rows found even with fallback searches",
              suggestion:
                "Check if data is properly embedded or try broader search terms",
            },
          },
        });
      }

      // Apply enhanced scoring logic
      const scoredLeads = await this.scoreLeadsEnhanced(
        uniqueRows,
        product,
        industry,
        region,
        keywords
      );

      // Final deduplication after scoring to ensure we keep highest-scoring duplicates
      const finalUniqueLeads = this.deduplicateScoredLeads(scoredLeads);

      console.log(
        `ExcelController: Scored ${scoredLeads.length} leads → ${finalUniqueLeads.length} unique leads after final deduplication, filtering by minScore: ${minScore}`
      );

      // Filter by minimum score and limit results
      const filteredLeads = finalUniqueLeads
        .filter((lead) => lead.finalScore >= minScore)
        .slice(0, parseInt(limit));

      console.log(
        `ExcelController: ${filteredLeads.length} leads passed score threshold`
      );

      // If no leads pass the threshold, return top results anyway with warning
      if (filteredLeads.length === 0 && finalUniqueLeads.length > 0) {
        const topLeads = finalUniqueLeads.slice(
          0,
          Math.min(5, parseInt(limit))
        );

        return res.json({
          success: true,
          warning: `No leads met the minimum score of ${minScore}. Showing top ${topLeads.length} results with lower scores.`,
          data: {
            searchCriteria: {
              product,
              industry,
              region,
              keywords,
              searchQueries,
            },
            totalMatches: uniqueRows.length,
            qualifiedLeads: 0,
            topLeads: topLeads.length,
            leads: this.formatLeadResults(topLeads),
            searchResults,
            responseTime: Date.now() - startTime,
            minScore,
            actualMinScore: Math.min(...topLeads.map((l) => l.finalScore)),
            limit: parseInt(limit),
            model: "enhanced-scoring-engine-v2",
          },
        });
      }

      // Generate AI insights about the lead matching
      let aiInsights = null;
      if (filteredLeads.length > 0) {
        try {
          aiInsights = await this.generateLeadInsights(
            searchQueries[0], // Use primary search query
            filteredLeads.slice(0, 5),
            product,
            industry,
            region
          );
        } catch (insightError) {
          console.error("Error generating AI insights:", insightError);
        }
      }

      const responseTime = Date.now() - startTime;

      return res.json({
        success: true,
        data: {
          searchCriteria: {
            product,
            industry,
            region,
            keywords,
            searchQueries,
          },
          totalMatches: uniqueRows.length,
          qualifiedLeads: filteredLeads.length,
          leads: this.formatLeadResults(filteredLeads),
          insights: aiInsights,
          searchResults,
          responseTime,
          minScore,
          limit: parseInt(limit),
          model: "enhanced-scoring-engine-v2",
        },
      });
    } catch (error) {
      console.error("ExcelController: Error in findLeads:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to find leads",
        details: error.message,
      });
    }
  }

  /**
   * @description Process keywords from various input formats
   * @param {Array<string>|string} rawKeywords - Keywords in various formats
   * @returns {Array<string>} Processed keywords array
   * @private
   */
  processKeywords(rawKeywords) {
    if (!rawKeywords) return [];

    if (Array.isArray(rawKeywords)) {
      return rawKeywords.filter((k) => k && k.trim().length > 0);
    }

    if (typeof rawKeywords === "string") {
      // Split by common delimiters and clean up
      return rawKeywords
        .split(/[,;\n\r]+/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
    }

    return [];
  }

  /**
   * @description Build multiple search queries for better coverage
   * @param {string} product - Product/Service name
   * @param {string} industry - Industry name
   * @param {string} region - Region/Country
   * @param {Array<string>} keywords - Keywords array
   * @returns {Array<string>} Array of search queries
   * @private
   */
  buildMultipleSearchQueries(product, industry, region, keywords) {
    const queries = [];

    // LOCATION-FIRST QUERIES (highest priority per user request)
    if (region) {
      // Primary: Location + Product + Industry (most comprehensive with location first)
      const primaryComponents = [region, product, industry];
      if (keywords.length > 0) primaryComponents.push(...keywords.slice(0, 2));
      queries.push(primaryComponents.join(" "));

      // Location + Product (strong geographic + product match)
      queries.push(`${region} ${product}`);

      // Location + Industry (geographic industry focus)
      queries.push(`${region} ${industry}`);

      // Pure location query (maximum geographic relevance)
      queries.push(region);

      // Location + Keywords (if keywords specified)
      if (keywords.length > 0) {
        queries.push(`${region} ${keywords.slice(0, 2).join(" ")}`);
      }
    }

    // SECONDARY QUERIES (lower priority)
    // Product + Industry only (fallback without location)
    queries.push(`${product} ${industry}`);

    // Product + Keywords (if keywords specified)
    if (keywords.length > 0) {
      queries.push(`${product} ${keywords.slice(0, 2).join(" ")}`);
    }

    // Just product (final fallback)
    queries.push(product);

    // Remove duplicates while preserving order (location-first queries stay at top)
    return [...new Set(queries)];
  }

  /**
   * @description Remove duplicate rows based on robust company/contact identification
   * @param {Array} rows - Array of row objects
   * @returns {Array} Deduplicated rows (keeping highest scoring duplicates)
   * @private
   */
  deduplicateRows(rows) {
    const companyMap = new Map();
    const contactMap = new Map();
    const seenFingerprints = new Set();

    console.log(`\n=== DEDUPLICATION: Processing ${rows.length} rows ===`);

    for (const row of rows) {
      // Extract key identifying information
      const companyName = this.extractCompanyNameEnhanced(row.rowData);
      const contactPerson =
        this.extractContactPersonEnhanced(row.rowData) ||
        row.rowData?.Name ||
        row.rowData?.name ||
        "";
      const email = this.extractEmailEnhanced(row.rowData) || "";
      const phone = this.extractPhoneEnhanced(row.rowData) || "";

      // Normalize for comparison (lowercase, trim, remove special chars)
      const normalizedCompany = this.normalizeForComparison(companyName);
      const normalizedContact = this.normalizeForComparison(contactPerson);
      const normalizedEmail = email.toLowerCase().trim();
      const normalizedPhone = phone.replace(/[^\d]/g, ""); // Keep only digits

      // Create multiple fingerprints for robust deduplication
      const fingerprints = [];

      // 1. Company + Contact Person (strongest match)
      if (normalizedCompany !== "unknown company" && normalizedContact) {
        fingerprints.push(
          `company_contact:${normalizedCompany}|${normalizedContact}`
        );
      }

      // 2. Company + Email (strong match)
      if (normalizedCompany !== "unknown company" && normalizedEmail) {
        fingerprints.push(
          `company_email:${normalizedCompany}|${normalizedEmail}`
        );
      }

      // 3. Company + Phone (strong match)
      if (
        normalizedCompany !== "unknown company" &&
        normalizedPhone.length >= 8
      ) {
        fingerprints.push(
          `company_phone:${normalizedCompany}|${normalizedPhone}`
        );
      }

      // 4. Email alone (for individual contacts)
      if (normalizedEmail && this.isValidEmail(normalizedEmail)) {
        fingerprints.push(`email:${normalizedEmail}`);
      }

      // 5. Phone alone (for individual contacts with same phone)
      if (normalizedPhone.length >= 10) {
        fingerprints.push(`phone:${normalizedPhone}`);
      }

      // 6. Contact + Email (for cases where company is NULL/unknown)
      if (normalizedContact && normalizedEmail) {
        fingerprints.push(
          `contact_email:${normalizedContact}|${normalizedEmail}`
        );
      }

      // Check if this is a duplicate
      let isDuplicate = false;
      let duplicateType = "";

      for (const fingerprint of fingerprints) {
        if (seenFingerprints.has(fingerprint)) {
          isDuplicate = true;
          duplicateType = fingerprint.split(":")[0];
          console.log(
            `  DUPLICATE FOUND: ${companyName} - ${contactPerson} (${duplicateType})`
          );
          break;
        }
      }

      if (!isDuplicate) {
        // Mark all fingerprints as seen
        fingerprints.forEach((fp) => seenFingerprints.add(fp));

        // Store the row with metadata
        const rowWithMeta = {
          ...row,
          _dedup_meta: {
            companyName,
            contactPerson,
            email,
            phone,
            fingerprints,
          },
        };

        console.log(`  UNIQUE: ${companyName} - ${contactPerson} - ${email}`);

        // Store in company and contact maps for further validation
        if (normalizedCompany !== "unknown company") {
          if (!companyMap.has(normalizedCompany)) {
            companyMap.set(normalizedCompany, []);
          }
          companyMap.get(normalizedCompany).push(rowWithMeta);
        }

        if (normalizedEmail) {
          contactMap.set(normalizedEmail, rowWithMeta);
        }
      } else {
        console.log(
          `  SKIPPED DUPLICATE: ${companyName} - ${contactPerson} (matched by ${duplicateType})`
        );
      }
    }

    // Collect all unique rows
    const uniqueRows = [];

    // Add company-based unique rows
    for (const [company, companyRows] of companyMap.entries()) {
      if (companyRows.length === 1) {
        uniqueRows.push(companyRows[0]);
      } else {
        // Multiple rows for same company - this shouldn't happen with our logic, but handle it
        console.warn(
          `  WARNING: Multiple rows found for company "${company}" after deduplication`
        );
        // Take the first one (could sort by score if available)
        uniqueRows.push(companyRows[0]);
      }
    }

    // Add contact-only rows (where company was NULL/unknown)
    for (const [email, contactRow] of contactMap.entries()) {
      const companyName = this.normalizeForComparison(
        this.extractCompanyNameEnhanced(contactRow.rowData)
      );
      if (companyName === "unknown company") {
        // Only add if not already added through company mapping
        if (!uniqueRows.find((r) => r.rowIndex === contactRow.rowIndex)) {
          uniqueRows.push(contactRow);
        }
      }
    }

    console.log(
      `=== DEDUPLICATION COMPLETE: ${rows.length} → ${uniqueRows.length} unique rows ===\n`
    );

    // Final validation - check for any remaining duplicates by company name
    const finalCompanyCheck = new Map();
    const trulyUniqueRows = [];

    for (const row of uniqueRows) {
      const companyName = this.extractCompanyNameEnhanced(row.rowData);
      const normalizedCompany = this.normalizeForComparison(companyName);

      if (normalizedCompany === "unknown company") {
        // For unknown companies, check by email/phone
        const email = this.extractEmailEnhanced(row.rowData);
        const phone = this.extractPhoneEnhanced(row.rowData);
        const contactKey = email || phone || `unknown_${row.rowIndex}`;

        if (!finalCompanyCheck.has(`contact_${contactKey}`)) {
          finalCompanyCheck.set(`contact_${contactKey}`, row);
          trulyUniqueRows.push(row);
        }
      } else {
        if (!finalCompanyCheck.has(normalizedCompany)) {
          finalCompanyCheck.set(normalizedCompany, row);
          trulyUniqueRows.push(row);
        } else {
          console.warn(
            `  FINAL CHECK: Duplicate company found: ${companyName}`
          );
        }
      }
    }

    console.log(
      `=== FINAL VALIDATION: ${uniqueRows.length} → ${trulyUniqueRows.length} truly unique rows ===\n`
    );

    return trulyUniqueRows;
  }

  /**
   * @description Normalize text for comparison (handles case, special chars, etc.)
   * @param {string} text - Text to normalize
   * @returns {string} Normalized text
   * @private
   */
  normalizeForComparison(text) {
    if (!text || typeof text !== "string") return "";

    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, "") // Remove special characters
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(
        /\b(ltd|limited|pvt|private|inc|corp|corporation|company|co)\b/g,
        ""
      ) // Remove company suffixes
      .trim();
  }

  /**
   * @description Final deduplication of scored leads, keeping highest-scoring duplicates
   * @param {Array} scoredLeads - Array of scored lead objects
   * @returns {Array} Deduplicated scored leads
   * @private
   */
  deduplicateScoredLeads(scoredLeads) {
    console.log(
      `\n=== FINAL SCORED DEDUPLICATION: Processing ${scoredLeads.length} scored leads ===`
    );

    const companyLeadMap = new Map();
    const contactLeadMap = new Map();

    for (const lead of scoredLeads) {
      const companyName = this.extractCompanyNameEnhanced(lead.rowData);
      const contactPerson =
        this.extractContactPersonEnhanced(lead.rowData) ||
        lead.rowData?.Name ||
        lead.rowData?.name ||
        "";
      const email = this.extractEmailEnhanced(lead.rowData) || "";
      const phone = this.extractPhoneEnhanced(lead.rowData) || "";

      const normalizedCompany = this.normalizeForComparison(companyName);
      const normalizedContact = this.normalizeForComparison(contactPerson);
      const normalizedEmail = email.toLowerCase().trim();

      // Create identification keys
      const companyKey =
        normalizedCompany !== "unknown company" ? normalizedCompany : null;
      const contactKey =
        normalizedEmail || phone || `${normalizedContact}_${companyName}`;

      console.log(
        `  Processing: ${companyName} (${contactPerson}) - Score: ${lead.finalScore}`
      );

      if (companyKey) {
        // Handle company-based deduplication
        if (companyLeadMap.has(companyKey)) {
          const existingLead = companyLeadMap.get(companyKey);
          if (lead.finalScore > existingLead.finalScore) {
            console.log(
              `    REPLACING: Better score (${lead.finalScore} > ${existingLead.finalScore}) for company "${companyName}"`
            );
            companyLeadMap.set(companyKey, lead);
          } else {
            console.log(
              `    SKIPPING: Lower score (${lead.finalScore} <= ${existingLead.finalScore}) for company "${companyName}"`
            );
          }
        } else {
          console.log(`    ADDING: New company "${companyName}"`);
          companyLeadMap.set(companyKey, lead);
        }
      } else {
        // Handle contact-based deduplication (for unknown companies)
        if (contactLeadMap.has(contactKey)) {
          const existingLead = contactLeadMap.get(contactKey);
          if (lead.finalScore > existingLead.finalScore) {
            console.log(
              `    REPLACING: Better score (${lead.finalScore} > ${existingLead.finalScore}) for contact "${contactPerson}"`
            );
            contactLeadMap.set(contactKey, lead);
          } else {
            console.log(
              `    SKIPPING: Lower score (${lead.finalScore} <= ${existingLead.finalScore}) for contact "${contactPerson}"`
            );
          }
        } else {
          console.log(
            `    ADDING: New contact "${contactPerson}" (unknown company)`
          );
          contactLeadMap.set(contactKey, lead);
        }
      }
    }

    // Combine results
    const uniqueLeads = [
      ...companyLeadMap.values(),
      ...contactLeadMap.values(),
    ];

    // Sort by score (highest first)
    uniqueLeads.sort((a, b) => b.finalScore - a.finalScore);

    console.log(
      `=== FINAL DEDUPLICATION COMPLETE: ${scoredLeads.length} → ${uniqueLeads.length} truly unique leads ===\n`
    );

    // Final safety check - log the final companies to verify no duplicates
    const finalCompanies = uniqueLeads.map((lead) =>
      this.extractCompanyNameEnhanced(lead.rowData)
    );
    const duplicateCheck = finalCompanies.filter(
      (company, index) =>
        finalCompanies.indexOf(company) !== index &&
        company !== "Unknown Company"
    );

    if (duplicateCheck.length > 0) {
      console.error(
        `⚠️  WARNING: Still found duplicate companies after final deduplication: ${duplicateCheck.join(
          ", "
        )}`
      );
    } else {
      console.log(
        `✅ VALIDATION PASSED: No duplicate companies in final results`
      );
    }

    return uniqueLeads;
  }

  /**
   * @description Build comprehensive search query from criteria (legacy method)
   * @param {string} product - Product/Service name
   * @param {string} industry - Industry name
   * @param {string} region - Region/Country
   * @param {Array<string>} keywords - Keywords array
   * @returns {string} Combined search query
   * @private
   */
  buildSearchQuery(product, industry, region, keywords) {
    const components = [product, industry];

    if (region) {
      components.push(region);
    }

    if (keywords && keywords.length > 0) {
      components.push(...keywords);
    }

    return components.join(" ");
  }

  /**
   * @description Apply enhanced scoring logic to leads with flexible field matching
   * @param {Array} leads - Array of lead objects
   * @param {string} product - Product/Service name
   * @param {string} industry - Industry name
   * @param {string} region - Region/Country
   * @param {Array<string>} keywords - Keywords array
   * @returns {Promise<Array>} Scored leads
   * @private
   */
  async scoreLeadsEnhanced(leads, product, industry, region, keywords) {
    console.log(
      `ExcelController: Scoring ${leads.length} leads for product: "${product}", industry: "${industry}", region: "${region}"`
    );

    return leads
      .map((lead, index) => {
        const rowData = lead.rowData;
        const content = lead.content || JSON.stringify(rowData);

        // Extract key info for debugging
        const companyName = this.extractCompanyNameEnhanced(rowData);
        const leadLocation = this.extractCountryEnhanced(rowData);

        console.log(`\n--- SCORING LEAD ${index + 1}: ${companyName} ---`);
        console.log(`Location: ${leadLocation}`);
        console.log(`Content preview: ${content.substring(0, 150)}...`);

        // Debug: Show all available fields in this record
        console.log(`Available fields in rowData:`, Object.keys(rowData || {}));
        if (rowData && typeof rowData === "object") {
          Object.entries(rowData).forEach(([key, value]) => {
            if (value && typeof value === "string" && value.trim().length > 0) {
              console.log(`  ${key}: "${value}"`);
            }
          });
        }

        // Enhanced Geographic Match (40% weight) - HIGHEST PRIORITY per user request
        const regionScore = this.calculateRegionMatchEnhanced(
          content,
          rowData,
          region
        );
        console.log(
          `Geographic Score: ${regionScore.toFixed(3)} (${(
            regionScore * 40
          ).toFixed(1)}% of total)`
        );

        // Enhanced Industry Match (25% weight) - second priority
        const industryScore = this.calculateIndustryMatchEnhanced(
          content,
          rowData,
          industry,
          keywords
        );
        console.log(
          `Industry Score: ${industryScore.toFixed(3)} (${(
            industryScore * 25
          ).toFixed(1)}% of total)`
        );

        // Enhanced Contact Completeness (20% weight) - third priority (email, phone, etc.)
        const completenessScore = this.calculateCompletenessEnhanced(rowData);
        console.log(
          `Contact Completeness Score: ${completenessScore.toFixed(3)} (${(
            completenessScore * 20
          ).toFixed(1)}% of total)`
        );

        // Lead Activity/Business Size (8% weight) - reduced
        const activityScore = this.calculateActivityScoreEnhanced(
          rowData,
          content
        );

        // Export/Business Readiness (5% weight) - reduced
        const exportScore = this.calculateExportReadinessEnhanced(
          content,
          rowData
        );

        // Engagement/Quality Score (1% weight) - minimal
        const engagementScore = this.calculateEngagementScoreEnhanced(
          rowData,
          content
        );

        // Data Quality/Freshness (1% weight) - minimal
        const freshnessScore = this.calculateFreshnessScoreEnhanced(
          lead,
          rowData
        );

        // Calculate final weighted score with location as highest priority
        const finalScore =
          (regionScore * 0.4 + // 40% - Location is TOP priority
            industryScore * 0.25 + // 25% - Industry second
            completenessScore * 0.2 + // 20% - Contact info third
            activityScore * 0.08 + // 8%  - Business size
            exportScore * 0.05 + // 5%  - Export readiness
            engagementScore * 0.01 + // 1%  - Engagement
            freshnessScore * 0.01) * // 1%  - Data quality
          100; // Convert to 0-100 scale

        console.log(`FINAL SCORE: ${finalScore.toFixed(1)}`);
        console.log(`--- END LEAD ${index + 1} ---\n`);

        return {
          ...lead,
          regionScore, // Now most important
          industryScore, // Second most important
          completenessScore, // Third most important
          activityScore,
          exportScore,
          engagementScore,
          freshnessScore,
          finalScore,
        };
      })
      .sort((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * @description Apply advanced scoring logic to leads (legacy method)
   * @param {Array} leads - Array of lead objects
   * @param {string} product - Product/Service name
   * @param {string} industry - Industry name
   * @param {string} region - Region/Country
   * @param {Array<string>} keywords - Keywords array
   * @returns {Promise<Array>} Scored leads
   * @private
   */
  async scoreLeads(leads, product, industry, region, keywords) {
    return leads
      .map((lead) => {
        const rowData = lead.rowData;
        const content = lead.content || JSON.stringify(rowData);

        // Industry Match (30% weight)
        const industryScore = this.calculateIndustryMatch(
          content,
          industry,
          keywords
        );

        // Geographic Match (15% weight)
        const regionScore = this.calculateRegionMatch(content, region);

        // Contact Completeness (10% weight)
        const completenessScore = this.calculateCompleteness(rowData);

        // Lead Activity Tier (15% weight)
        const activityScore = this.calculateActivityScore(rowData);

        // Export Readiness (10% weight)
        const exportScore = this.calculateExportReadiness(content);

        // Prior Engagement (10% weight)
        const engagementScore = this.calculateEngagementScore(rowData);

        // Data Freshness (10% weight)
        const freshnessScore = this.calculateFreshnessScore(lead);

        // Calculate final weighted score
        const finalScore =
          (industryScore * 0.3 +
            regionScore * 0.15 +
            completenessScore * 0.1 +
            activityScore * 0.15 +
            exportScore * 0.1 +
            engagementScore * 0.1 +
            freshnessScore * 0.1) *
          100; // Convert to 0-100 scale

        return {
          ...lead,
          industryScore,
          regionScore,
          completenessScore,
          activityScore,
          exportScore,
          engagementScore,
          freshnessScore,
          finalScore,
        };
      })
      .sort((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * @description Enhanced industry matching with flexible field detection
   * @param {string} content - Lead content
   * @param {Object} rowData - Row data object
   * @param {string} industry - Target industry
   * @param {Array<string>} keywords - Keywords
   * @returns {number} Score between 0-1
   * @private
   */
  calculateIndustryMatchEnhanced(content, rowData, industry, keywords) {
    const lowerContent = content.toLowerCase();
    const lowerIndustry = industry.toLowerCase();
    let score = 0;

    // Check specific industry-related fields first
    const industryFields = this.findAllFieldValues(rowData, [
      "industry",
      "sector",
      "category",
      "business",
      "type",
      "field",
      "domain",
    ]);

    for (const fieldValue of industryFields) {
      if (fieldValue && fieldValue.toLowerCase().includes(lowerIndustry)) {
        score += 0.8; // High score for direct field match
        break;
      }
    }

    // Direct industry match in content
    if (lowerContent.includes(lowerIndustry)) {
      score += 0.6;
    }

    // Enhanced keyword matching
    if (keywords && keywords.length > 0) {
      const keywordMatches = keywords.filter((keyword) =>
        lowerContent.includes(keyword.toLowerCase())
      ).length;
      score += (keywordMatches / keywords.length) * 0.5;
    }

    // Industry-related terms with better mapping
    const industryTerms = this.getIndustryTermsEnhanced(industry);
    const termMatches = industryTerms.filter((term) =>
      lowerContent.includes(term.toLowerCase())
    ).length;

    if (industryTerms.length > 0) {
      score += (termMatches / industryTerms.length) * 0.4;
    }

    // Partial industry matching (e.g., "fashion" matches "apparel")
    const partialMatches = this.getIndustryPartialMatches(industry);
    const partialScore = partialMatches.filter((term) =>
      lowerContent.includes(term.toLowerCase())
    ).length;

    if (partialMatches.length > 0) {
      score += (partialScore / partialMatches.length) * 0.3;
    }

    return Math.min(score, 1);
  }

  /**
   * @description Calculate industry matching score (legacy method)
   * @param {string} content - Lead content
   * @param {string} industry - Target industry
   * @param {Array<string>} keywords - Keywords
   * @returns {number} Score between 0-1
   * @private
   */
  calculateIndustryMatch(content, industry, keywords) {
    const lowerContent = content.toLowerCase();
    const lowerIndustry = industry.toLowerCase();

    let score = 0;

    // Direct industry match
    if (lowerContent.includes(lowerIndustry)) {
      score += 0.6;
    }

    // Keyword matches
    if (keywords && keywords.length > 0) {
      const keywordMatches = keywords.filter((keyword) =>
        lowerContent.includes(keyword.toLowerCase())
      ).length;
      score += (keywordMatches / keywords.length) * 0.4;
    }

    // Industry-related terms
    const industryTerms = this.getIndustryTerms(industry);
    const termMatches = industryTerms.filter((term) =>
      lowerContent.includes(term.toLowerCase())
    ).length;

    if (industryTerms.length > 0) {
      score += (termMatches / industryTerms.length) * 0.3;
    }

    return Math.min(score, 1);
  }

  /**
   * @description Enhanced geographic matching with field-specific detection
   * @param {string} content - Lead content
   * @param {Object} rowData - Row data object
   * @param {string} region - Target region
   * @returns {number} Score between 0-1
   * @private
   */
  calculateRegionMatchEnhanced(content, rowData, region) {
    if (!region) return 0.5; // Neutral score if no region specified

    const lowerContent = content.toLowerCase();
    const lowerRegion = region.toLowerCase();
    let score = 0;

    console.log(`    🌍 REGION MATCHING for "${region}"`);
    console.log(`    Content: ${content.substring(0, 100)}...`);

    // Check specific location fields first with HIGHEST priority
    // Prioritize city/regional fields over country fields
    const cityRegionFields = this.findAllFieldValues(rowData, [
      "city",
      "region",
      "location",
      "area",
      "zone",
      "place",
      "district",
      "locality",
      "town",
    ]);

    console.log(
      `    City/Region fields found: [${cityRegionFields.join(", ")}]`
    );

    const countryStateFields = this.findAllFieldValues(rowData, [
      "country",
      "state",
      "province",
      "territory",
    ]);

    console.log(
      `    Country/State fields found: [${countryStateFields.join(", ")}]`
    );

    const addressFields = this.findAllFieldValues(rowData, [
      "address",
      "full_address",
      "location_address",
    ]);

    console.log(`    Address fields found: [${addressFields.join(", ")}]`);

    // HIGHEST PRIORITY: City/Region field exact matches
    for (const fieldValue of cityRegionFields) {
      if (fieldValue) {
        const fieldLower = fieldValue.toLowerCase();
        console.log(
          `    Checking city/region field: "${fieldValue}" vs "${region}"`
        );

        // Perfect match in city/region field = maximum score
        if (fieldLower === lowerRegion || fieldLower.includes(lowerRegion)) {
          score = 1.0;
          console.log(
            `    ✅ PERFECT city/region match found in field: "${fieldValue}" matches "${region}"`
          );
          break;
        }
      }
    }

    // HIGH PRIORITY: Address field matches (often contain city names)
    if (score < 1.0) {
      for (const fieldValue of addressFields) {
        if (fieldValue) {
          const fieldLower = fieldValue.toLowerCase();
          console.log(
            `    Checking address field: "${fieldValue}" for "${region}"`
          );

          if (fieldLower.includes(lowerRegion)) {
            score = Math.max(score, 0.95);
            console.log(
              `    ✅ City/region match found in address: "${fieldValue}" contains "${region}"`
            );
            break;
          }
        }
      }
    }

    // MEDIUM PRIORITY: Country/State field matches (lower priority than city)
    if (score < 0.95) {
      for (const fieldValue of countryStateFields) {
        if (fieldValue) {
          const fieldLower = fieldValue.toLowerCase();
          console.log(
            `    Checking country/state field: "${fieldValue}" vs "${region}"`
          );

          if (fieldLower === lowerRegion || fieldLower.includes(lowerRegion)) {
            score = Math.max(score, 0.85); // Lower than city matches
            console.log(
              `    ✅ Country/state match found in field: "${fieldValue}" matches "${region}"`
            );
            break;
          }
        }
      }
    }

    // If no perfect match in fields, check content with city-priority approach
    if (score < 1.0) {
      console.log(`    Checking content for direct "${region}" match...`);

      // Direct exact region match in any content (high priority for city names)
      if (lowerContent.includes(lowerRegion)) {
        score = Math.max(score, 0.92); // High score for direct content match
        console.log(`    ✅ Direct city/region match in content: "${region}"`);
      }

      // Enhanced city and regional matching
      const cityIndicators = this.getCityAndRegionalIndicators(region);
      console.log(
        `    City indicators for "${region}": [${cityIndicators.join(", ")}]`
      );

      // Check for city and regional indicators (highest priority)
      for (const indicator of cityIndicators) {
        if (lowerContent.includes(indicator.toLowerCase())) {
          score = Math.max(score, 0.88); // High score for city indicators
          console.log(
            `    ✅ City/regional indicator match found: "${indicator}"`
          );
          break;
        }
      }

      // Check for country codes and broader location terms (lower priority)
      if (score < 0.88) {
        const countryCodes = this.getCountryCodesEnhanced(region);
        console.log(
          `    Country codes for "${region}": [${countryCodes.join(", ")}]`
        );

        for (const code of countryCodes) {
          if (lowerContent.includes(code.toLowerCase())) {
            score = Math.max(score, 0.75); // Lower score than city matches
            console.log(`    ✅ Country code match found: "${code}"`);
            break;
          }
        }
      }

      // Additional broader location indicators (lowest priority)
      if (score < 0.75) {
        const locationIndicators = this.getLocationIndicators(region);
        for (const indicator of locationIndicators) {
          if (lowerContent.includes(indicator.toLowerCase())) {
            score = Math.max(score, 0.65);
            console.log(
              `    ✅ General location indicator match found: "${indicator}"`
            );
            break;
          }
        }
      }
    }

    // If still no match, check for partial/fuzzy matches
    if (score === 0) {
      console.log(`    No direct matches found, checking partial matches...`);
      const partialMatches = this.getPartialLocationMatches(region);
      console.log(
        `    Partial matches for "${region}": [${partialMatches.join(", ")}]`
      );

      for (const partial of partialMatches) {
        if (lowerContent.includes(partial.toLowerCase())) {
          score = 0.3; // Lower score for partial matches
          console.log(`    ⚠️  Partial location match found: "${partial}"`);
          break;
        }
      }
    }

    // Minimum score for no location match (when location is specified)
    if (score === 0) {
      score = 0.05; // Very low score if no location match at all
      console.log(`    ❌ No location match found at all`);
    }

    console.log(
      `    🏁 Final location score for "${region}": ${score.toFixed(3)}`
    );
    return score;
  }

  /**
   * @description Calculate geographic matching score (legacy method)
   * @param {string} content - Lead content
   * @param {string} region - Target region
   * @returns {number} Score between 0-1
   * @private
   */
  calculateRegionMatch(content, region) {
    if (!region) return 0.5; // Neutral score if no region specified

    const lowerContent = content.toLowerCase();
    const lowerRegion = region.toLowerCase();

    // Direct region match
    if (lowerContent.includes(lowerRegion)) {
      return 1.0;
    }

    // Country code matches (if region is a country)
    const countryCodes = this.getCountryCodes(region);
    const hasCountryCode = countryCodes.some((code) =>
      lowerContent.includes(code.toLowerCase())
    );

    if (hasCountryCode) {
      return 0.8;
    }

    // Regional variations
    const regionalTerms = this.getRegionalTerms(region);
    const hasRegionalTerm = regionalTerms.some((term) =>
      lowerContent.includes(term.toLowerCase())
    );

    return hasRegionalTerm ? 0.6 : 0.2;
  }

  /**
   * @description Enhanced contact completeness with flexible field detection
   * @param {Object} rowData - Lead row data
   * @returns {number} Score between 0-1
   * @private
   */
  calculateCompletenessEnhanced(rowData) {
    // Define field groups with priorities
    const criticalFields = this.findAllFieldValues(rowData, [
      "email",
      "mail",
      "contact",
      "e-mail",
    ]);
    const phoneFields = this.findAllFieldValues(rowData, [
      "phone",
      "mobile",
      "tel",
      "whatsapp",
      "number",
    ]);
    const companyFields = this.findAllFieldValues(rowData, [
      "company",
      "business",
      "organization",
      "firm",
      "name",
    ]);
    const websiteFields = this.findAllFieldValues(rowData, [
      "website",
      "url",
      "web",
      "site",
      "domain",
    ]);
    const addressFields = this.findAllFieldValues(rowData, [
      "address",
      "location",
      "city",
      "country",
    ]);

    let score = 0;
    let maxScore = 0;

    // Email (critical - 30%)
    maxScore += 0.3;
    if (criticalFields.some((v) => v && this.isValidEmail(v))) {
      score += 0.3;
    }

    // Phone (important - 25%)
    maxScore += 0.25;
    if (phoneFields.some((v) => v && this.isValidPhone(v))) {
      score += 0.25;
    }

    // Company (important - 20%)
    maxScore += 0.2;
    if (companyFields.some((v) => v && v.trim().length > 2)) {
      score += 0.2;
    }

    // Website (useful - 15%)
    maxScore += 0.15;
    if (websiteFields.some((v) => v && this.isValidWebsite(v))) {
      score += 0.15;
    }

    // Address/Location (useful - 10%)
    maxScore += 0.1;
    if (addressFields.some((v) => v && v.trim().length > 2)) {
      score += 0.1;
    }

    return score / maxScore;
  }

  /**
   * @description Calculate contact completeness score (legacy method)
   * @param {Object} rowData - Lead row data
   * @returns {number} Score between 0-1
   * @private
   */
  calculateCompleteness(rowData) {
    const fields = ["email", "phone", "whatsapp", "website", "company", "name"];
    let completedFields = 0;

    fields.forEach((field) => {
      const value = this.findFieldValue(rowData, field);
      if (value && value.trim().length > 0) {
        completedFields++;
      }
    });

    return completedFields / fields.length;
  }

  /**
   * @description Calculate activity/tier score
   * @param {Object} rowData - Lead row data
   * @returns {number} Score between 0-1
   * @private
   */
  calculateActivityScore(rowData) {
    const tierField =
      this.findFieldValue(rowData, "tier") ||
      this.findFieldValue(rowData, "level") ||
      this.findFieldValue(rowData, "category");

    if (tierField) {
      const tier = tierField.toLowerCase();
      if (
        tier.includes("premium") ||
        tier.includes("gold") ||
        tier.includes("tier 1")
      ) {
        return 1.0;
      }
      if (tier.includes("silver") || tier.includes("tier 2")) {
        return 0.7;
      }
      if (tier.includes("bronze") || tier.includes("tier 3")) {
        return 0.4;
      }
    }

    // Default based on data quality
    const content = JSON.stringify(rowData).toLowerCase();
    if (content.includes("verified") || content.includes("certified")) {
      return 0.8;
    }

    return 0.5;
  }

  /**
   * @description Calculate export readiness score
   * @param {string} content - Lead content
   * @returns {number} Score between 0-1
   * @private
   */
  calculateExportReadiness(content) {
    const lowerContent = content.toLowerCase();
    const exportTerms = [
      "export",
      "international",
      "global",
      "worldwide",
      "overseas",
      "trade",
      "shipping",
      "customs",
      "fob",
      "cif",
      "export license",
    ];

    const matches = exportTerms.filter((term) =>
      lowerContent.includes(term)
    ).length;
    return Math.min(matches / 3, 1); // Normalize to 0-1
  }

  /**
   * @description Calculate engagement score
   * @param {Object} rowData - Lead row data
   * @returns {number} Score between 0-1
   * @private
   */
  calculateEngagementScore(rowData) {
    const engagementField =
      this.findFieldValue(rowData, "engagement") ||
      this.findFieldValue(rowData, "status") ||
      this.findFieldValue(rowData, "activity");

    if (engagementField) {
      const engagement = engagementField.toLowerCase();
      if (engagement.includes("active") || engagement.includes("high")) {
        return 1.0;
      }
      if (engagement.includes("medium") || engagement.includes("regular")) {
        return 0.6;
      }
      if (engagement.includes("low") || engagement.includes("inactive")) {
        return 0.2;
      }
    }

    return 0.5; // Default neutral score
  }

  /**
   * @description Calculate data freshness score
   * @param {Object} lead - Lead object with metadata
   * @returns {number} Score between 0-1
   * @private
   */
  calculateFreshnessScore(lead) {
    // For now, use document creation date as proxy for freshness
    if (lead.document && lead.document.createdAt) {
      const createdDate = new Date(lead.document.createdAt);
      const now = new Date();
      const daysDiff = (now - createdDate) / (1000 * 60 * 60 * 24);

      if (daysDiff <= 30) return 1.0; // Very fresh (last month)
      if (daysDiff <= 90) return 0.8; // Fresh (last 3 months)
      if (daysDiff <= 180) return 0.6; // Moderately fresh (last 6 months)
      if (daysDiff <= 365) return 0.4; // Older (last year)
      return 0.2; // Very old (over a year)
    }

    return 0.5; // Default if no date available
  }

  /**
   * @description Generate AI insights about lead matches
   * @param {string} searchQuery - Original search query
   * @param {Array} topLeads - Top scored leads
   * @param {string} product - Product name
   * @param {string} industry - Industry name
   * @param {string} region - Region name
   * @returns {Promise<Object>} AI insights
   * @private
   */
  async generateLeadInsights(searchQuery, topLeads, product, industry, region) {
    try {
      const leadsContext = topLeads
        .map(
          (lead, index) =>
            `Lead ${index + 1}: ${this.extractCompanyName(
              lead.rowData
            )} (Score: ${Math.round(
              lead.finalScore
            )}) - ${lead.content.substring(0, 200)}...`
        )
        .join("\n\n");

      const prompt = `Based on these lead matching results for "${product}" in "${industry}"${
        region ? ` in ${region}` : ""
      }:

${leadsContext}

Provide insights on:
1. Quality of matches found
2. Geographic distribution
3. Industry alignment
4. Recommendations for outreach strategy
5. Potential challenges or opportunities

Keep the response concise and actionable.`;

      const response = await this.openAIService.generateChatResponse(
        prompt,
        topLeads.map((lead) => ({
          text: lead.content,
          metadata: { score: lead.finalScore },
        })),
        "Lead Matching Analysis"
      );

      return {
        summary: response.answer,
        totalAnalyzed: topLeads.length,
        averageScore: Math.round(
          topLeads.reduce((sum, lead) => sum + lead.finalScore, 0) /
            topLeads.length
        ),
        topCountries: this.getTopCountries(topLeads),
        recommendedAction: this.getRecommendedAction(topLeads),
      };
    } catch (error) {
      console.error("Error generating lead insights:", error);
      return null;
    }
  }

  // Utility methods for data extraction and analysis

  /**
   * @description Extract company name from row data
   * @param {Object} rowData - Row data object
   * @returns {string} Company name
   * @private
   */
  extractCompanyName(rowData) {
    return (
      this.findFieldValue(rowData, "company") ||
      this.findFieldValue(rowData, "business") ||
      this.findFieldValue(rowData, "organization") ||
      this.findFieldValue(rowData, "firm") ||
      "Unknown Company"
    );
  }

  /**
   * @description Extract country from row data
   * @param {Object} rowData - Row data object
   * @returns {string} Country
   * @private
   */
  extractCountry(rowData) {
    return (
      this.findFieldValue(rowData, "country") ||
      this.findFieldValue(rowData, "location") ||
      this.findFieldValue(rowData, "region") ||
      "Unknown"
    );
  }

  /**
   * @description Extract industry from row data
   * @param {Object} rowData - Row data object
   * @returns {string} Industry
   * @private
   */
  extractIndustry(rowData) {
    return (
      this.findFieldValue(rowData, "industry") ||
      this.findFieldValue(rowData, "sector") ||
      this.findFieldValue(rowData, "category") ||
      "Unknown"
    );
  }

  /**
   * @description Extract email from row data
   * @param {Object} rowData - Row data object
   * @returns {string} Email
   * @private
   */
  extractEmail(rowData) {
    return (
      this.findFieldValue(rowData, "email") ||
      this.findFieldValue(rowData, "contact") ||
      null
    );
  }

  /**
   * @description Extract phone from row data
   * @param {Object} rowData - Row data object
   * @returns {string} Phone
   * @private
   */
  extractPhone(rowData) {
    return (
      this.findFieldValue(rowData, "phone") ||
      this.findFieldValue(rowData, "mobile") ||
      this.findFieldValue(rowData, "whatsapp") ||
      this.findFieldValue(rowData, "contact") ||
      null
    );
  }

  /**
   * @description Extract website from row data
   * @param {Object} rowData - Row data object
   * @returns {string} Website
   * @private
   */
  extractWebsite(rowData) {
    return (
      this.findFieldValue(rowData, "website") ||
      this.findFieldValue(rowData, "url") ||
      this.findFieldValue(rowData, "web") ||
      null
    );
  }

  /**
   * @description Find field value by partial name matching
   * @param {Object} rowData - Row data object
   * @param {string} fieldName - Field name to search for
   * @returns {string|null} Field value
   * @private
   */
  findFieldValue(rowData, fieldName) {
    const lowerFieldName = fieldName.toLowerCase();

    // Direct match
    if (rowData[fieldName]) return rowData[fieldName];
    if (rowData[lowerFieldName]) return rowData[lowerFieldName];

    // Partial match
    const matchingKey = Object.keys(rowData).find((key) =>
      key.toLowerCase().includes(lowerFieldName)
    );

    return matchingKey ? rowData[matchingKey] : null;
  }

  /**
   * @description Get industry-related terms
   * @param {string} industry - Industry name
   * @returns {Array<string>} Related terms
   * @private
   */
  getIndustryTerms(industry) {
    const termMap = {
      textiles: ["fabric", "clothing", "garment", "fashion", "apparel"],
      spices: ["herbs", "seasoning", "condiment", "flavor"],
      technology: ["software", "hardware", "IT", "digital", "tech"],
      manufacturing: ["production", "factory", "industrial", "assembly"],
      agriculture: ["farming", "crops", "food", "organic", "produce"],
    };

    return termMap[industry.toLowerCase()] || [];
  }

  /**
   * @description Get country codes for region
   * @param {string} region - Region name
   * @returns {Array<string>} Country codes
   * @private
   */
  getCountryCodes(region) {
    const codeMap = {
      india: ["IN", "IND"],
      china: ["CN", "CHN"],
      usa: ["US", "USA"],
      germany: ["DE", "DEU"],
      japan: ["JP", "JPN"],
    };

    return codeMap[region.toLowerCase()] || [];
  }

  /**
   * @description Get regional terms
   * @param {string} region - Region name
   * @returns {Array<string>} Regional terms
   * @private
   */
  getRegionalTerms(region) {
    const termMap = {
      india: ["indian", "delhi", "mumbai", "bangalore", "asia"],
      china: ["chinese", "beijing", "shanghai", "asia"],
      usa: ["american", "america", "us"],
      europe: ["european", "eu"],
    };

    return termMap[region.toLowerCase()] || [];
  }

  /**
   * @description Get lead priority based on score
   * @param {number} score - Final score
   * @returns {string} Priority level
   * @private
   */
  getLeadPriority(score) {
    if (score >= 75) return "High";
    if (score >= 50) return "Medium";
    return "Low";
  }

  /**
   * @description Get top countries from leads
   * @param {Array} leads - Array of leads
   * @returns {Array} Top countries
   * @private
   */
  getTopCountries(leads) {
    const countryCount = {};
    leads.forEach((lead) => {
      const country = this.extractCountry(lead.rowData);
      countryCount[country] = (countryCount[country] || 0) + 1;
    });

    return Object.entries(countryCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([country, count]) => ({ country, count }));
  }

  /**
   * @description Enhanced activity/business size scoring
   * @param {Object} rowData - Lead row data
   * @param {string} content - Lead content
   * @returns {number} Score between 0-1
   * @private
   */
  calculateActivityScoreEnhanced(rowData, content) {
    let score = 0.5; // Default neutral score

    const businessSizeFields = this.findAllFieldValues(rowData, [
      "size",
      "employees",
      "revenue",
      "turnover",
      "tier",
      "level",
      "category",
    ]);

    for (const field of businessSizeFields) {
      if (!field) continue;
      const fieldLower = field.toLowerCase();

      // Large business indicators
      if (
        fieldLower.includes("large") ||
        fieldLower.includes("enterprise") ||
        fieldLower.includes("multinational") ||
        fieldLower.includes("500+")
      ) {
        score = 1.0;
        break;
      }

      // Medium business indicators
      if (
        fieldLower.includes("medium") ||
        fieldLower.includes("mid") ||
        fieldLower.includes("100") ||
        fieldLower.includes("50+")
      ) {
        score = 0.7;
      }

      // Premium/Gold tier
      if (
        fieldLower.includes("premium") ||
        fieldLower.includes("gold") ||
        fieldLower.includes("tier 1") ||
        fieldLower.includes("verified")
      ) {
        score = Math.max(score, 0.8);
      }
    }

    return score;
  }

  /**
   * @description Enhanced export/business readiness scoring
   * @param {string} content - Lead content
   * @param {Object} rowData - Lead row data
   * @returns {number} Score between 0-1
   * @private
   */
  calculateExportReadinessEnhanced(content, rowData) {
    const lowerContent = content.toLowerCase();
    let score = 0.3; // Default base score

    const exportTerms = [
      "export",
      "international",
      "global",
      "worldwide",
      "overseas",
      "import",
      "trade",
      "shipping",
      "logistics",
      "customs",
      "fob",
      "cif",
    ];

    const businessTerms = [
      "manufacturer",
      "distributor",
      "wholesale",
      "trader",
      "supplier",
      "exporter",
      "importer",
      "dealer",
      "retailer",
    ];

    // Check for export-related terms
    const exportMatches = exportTerms.filter((term) =>
      lowerContent.includes(term)
    ).length;

    if (exportMatches > 0) {
      score += Math.min(exportMatches * 0.2, 0.6);
    }

    // Check for business type terms
    const businessMatches = businessTerms.filter((term) =>
      lowerContent.includes(term)
    ).length;

    if (businessMatches > 0) {
      score += Math.min(businessMatches * 0.15, 0.4);
    }

    return Math.min(score, 1);
  }

  /**
   * @description Enhanced engagement scoring
   * @param {Object} rowData - Lead row data
   * @param {string} content - Lead content
   * @returns {number} Score between 0-1
   * @private
   */
  calculateEngagementScoreEnhanced(rowData, content) {
    let score = 0.5; // Default neutral score

    const statusFields = this.findAllFieldValues(rowData, [
      "status",
      "engagement",
      "activity",
      "priority",
      "quality",
    ]);

    for (const field of statusFields) {
      if (!field) continue;
      const fieldLower = field.toLowerCase();

      if (
        fieldLower.includes("active") ||
        fieldLower.includes("high") ||
        fieldLower.includes("premium") ||
        fieldLower.includes("verified")
      ) {
        score = 1.0;
        break;
      }

      if (fieldLower.includes("medium") || fieldLower.includes("regular")) {
        score = 0.6;
      }

      if (fieldLower.includes("low") || fieldLower.includes("inactive")) {
        score = 0.2;
      }
    }

    return score;
  }

  /**
   * @description Enhanced freshness/quality scoring
   * @param {Object} lead - Lead object
   * @param {Object} rowData - Lead row data
   * @returns {number} Score between 0-1
   * @private
   */
  calculateFreshnessScoreEnhanced(lead, rowData) {
    let score = 0.5; // Default score

    // Check for data quality indicators
    const content = JSON.stringify(rowData).toLowerCase();

    // Quality indicators
    if (
      content.includes("verified") ||
      content.includes("updated") ||
      content.includes("confirmed") ||
      content.includes("active")
    ) {
      score += 0.3;
    }

    // Data completeness as freshness indicator
    const fieldCount = Object.keys(rowData).length;
    if (fieldCount > 10) score += 0.2;
    else if (fieldCount > 5) score += 0.1;

    // Document freshness
    if (lead.document && lead.document.createdAt) {
      const createdDate = new Date(lead.document.createdAt);
      const now = new Date();
      const daysDiff = (now - createdDate) / (1000 * 60 * 60 * 24);

      if (daysDiff <= 30) score += 0.3;
      else if (daysDiff <= 90) score += 0.2;
      else if (daysDiff <= 180) score += 0.1;
    }

    return Math.min(score, 1);
  }

  /**
   * @description Format lead results consistently
   * @param {Array} leads - Array of scored leads
   * @returns {Array} Formatted lead results
   * @private
   */
  formatLeadResults(leads) {
    return leads.map((lead) => ({
      companyName: this.extractCompanyNameEnhanced(lead.rowData),
      country: this.extractCountryEnhanced(lead.rowData),
      industry: this.extractIndustryEnhanced(lead.rowData),
      email: this.extractEmailEnhanced(lead.rowData),
      phone: this.extractPhoneEnhanced(lead.rowData),
      website: this.extractWebsiteEnhanced(lead.rowData),

      // Additional extracted fields
      contactPerson: this.extractContactPersonEnhanced(lead.rowData),
      businessType: this.extractBusinessTypeEnhanced(lead.rowData),
      productCategories: this.extractProductCategoriesEnhanced(lead.rowData),

      // Scoring details
      finalScore: Math.round(lead.finalScore),
      scoreBreakdown: {
        geographicMatch: Math.round(lead.regionScore * 40), // 40% - TOP priority
        industryMatch: Math.round(lead.industryScore * 25), // 25% - Second priority
        contactCompleteness: Math.round(lead.completenessScore * 20), // 20% - Third priority
        businessSize: Math.round(lead.activityScore * 8), // 8%  - Lower priority
        exportReadiness: Math.round(lead.exportScore * 5), // 5%  - Lower priority
        engagement: Math.round(lead.engagementScore * 1), // 1%  - Minimal
        dataQuality: Math.round(lead.freshnessScore * 1), // 1%  - Minimal
      },

      // Raw data for reference
      rawData: lead.rowData,

      // Metadata
      vectorSimilarity: Math.round((lead.score || 0) * 100) / 100,
      fileName: lead.fileName,
      rowIndex: lead.rowIndex,
      priority: this.getLeadPriority(lead.finalScore),
    }));
  }

  /**
   * @description Get recommended action based on lead analysis
   * @param {Array} leads - Array of leads
   * @returns {string} Recommended action
   * @private
   */
  getRecommendedAction(leads) {
    const avgScore =
      leads.reduce((sum, lead) => sum + lead.finalScore, 0) / leads.length;

    if (avgScore >= 75) {
      return "Immediate outreach recommended - high-quality matches found";
    } else if (avgScore >= 50) {
      return "Targeted outreach with personalized messaging recommended";
    } else {
      return "Further market research recommended - consider refining search criteria";
    }
  }

  /**
   * @description Delete Excel file and its embeddings
   * @param {Object} req - Express request object
   * @param {string} req.body.fileKey - File key to delete (required)
   * @param {boolean} req.body.deleteFromS3 - Whether to delete from S3 (default: true)
   * @param {Object} res - Express response object
   * @returns {Object} Response with deletion status
   */
  async deleteFile(req, res) {
    try {
      const { fileKey, deleteFromS3 = true } = req.body;

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

      let s3DeletionResult = null;

      // Delete from S3 if requested
      if (deleteFromS3 && document.s3Url) {
        try {
          s3DeletionResult = await this.excelService.deleteExcelFromS3(fileKey);

          if (s3DeletionResult.success) {
            console.log(
              `ExcelController: Successfully deleted file from S3: ${fileKey}`
            );
          } else {
            console.warn(
              `ExcelController: Failed to delete from S3: ${s3DeletionResult.error}`
            );
            console.warn(
              `ExcelController: Error type: ${s3DeletionResult.errorType}`
            );

            // Provide helpful suggestions based on error type
            if (s3DeletionResult.errorType === "ACCESS_DENIED") {
              console.warn(
                `ExcelController: Suggestion: Check AWS IAM permissions for s3:DeleteObject on bucket ${this.excelService.bucketName}`
              );
            }
          }
        } catch (unexpectedError) {
          console.error(
            `ExcelController: Unexpected error during S3 deletion: ${unexpectedError.message}`
          );
          // Handle any unexpected errors that weren't caught by the service
          s3DeletionResult = {
            success: false,
            error: "Unexpected error during S3 deletion",
            errorType: "UNEXPECTED_ERROR",
            originalError: unexpectedError.message,
          };
        }
      }

      // Delete from database (this also deletes associated rows/embeddings)
      await this.excelModel.deleteDocument(document.id);

      console.log(
        `ExcelController: Successfully deleted file and embeddings: ${fileKey}`
      );

      // Determine overall success and appropriate message
      const overallSuccess = true; // Database deletion always succeeds if we reach here
      let message = "File and embeddings deleted successfully from database";

      if (deleteFromS3) {
        if (s3DeletionResult && s3DeletionResult.success) {
          message =
            "File and embeddings deleted successfully from both database and S3 storage";
        } else {
          message =
            "File and embeddings deleted from database, but S3 deletion failed";
        }
      }

      return res.status(200).json({
        success: overallSuccess,
        message: message,
        data: {
          fileKey: fileKey,
          fileName: document.fileName,
          deletedFromDatabase: true,
          deletedFromS3:
            deleteFromS3 && s3DeletionResult && s3DeletionResult.success,
          s3DeletionResult: s3DeletionResult,
          deletedAt: new Date(),
          // Add helpful information for troubleshooting
          troubleshooting:
            s3DeletionResult && !s3DeletionResult.success
              ? {
                  issue: "S3 deletion failed",
                  errorType: s3DeletionResult.errorType,
                  suggestion:
                    s3DeletionResult.errorType === "ACCESS_DENIED"
                      ? "Contact your AWS administrator to grant s3:DeleteObject permissions"
                      : "Check S3 configuration and try again",
                }
              : null,
        },
      });
    } catch (error) {
      console.error("ExcelController: Error deleting file:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to delete file",
        details: error.message,
      });
    }
  }

  /**
   * @description Find all field values matching any of the specified field names
   * @param {Object} rowData - Row data object
   * @param {Array<string>} fieldNames - Array of field names to search for
   * @returns {Array<string>} Array of found values
   * @private
   */
  findAllFieldValues(rowData, fieldNames) {
    const values = [];

    for (const fieldName of fieldNames) {
      const value = this.findFieldValue(rowData, fieldName);
      if (value && value.trim().length > 0) {
        values.push(value.trim());
      }
    }

    return values;
  }

  /**
   * @description Enhanced industry terms mapping
   * @param {string} industry - Industry name
   * @returns {Array<string>} Related terms
   * @private
   */
  getIndustryTermsEnhanced(industry) {
    const termMap = {
      fashion: [
        "apparel",
        "clothing",
        "garment",
        "textile",
        "fabric",
        "designer",
        "boutique",
        "fashion",
        "style",
        "wear",
      ],
      textiles: [
        "fabric",
        "clothing",
        "garment",
        "fashion",
        "apparel",
        "yarn",
        "cotton",
        "silk",
        "weaving",
      ],
      spices: [
        "herbs",
        "seasoning",
        "condiment",
        "flavor",
        "masala",
        "curry",
        "pepper",
        "turmeric",
      ],
      technology: [
        "software",
        "hardware",
        "IT",
        "digital",
        "tech",
        "computer",
        "programming",
        "development",
      ],
      manufacturing: [
        "production",
        "factory",
        "industrial",
        "assembly",
        "processing",
        "machinery",
      ],
      agriculture: [
        "farming",
        "crops",
        "food",
        "organic",
        "produce",
        "cultivation",
        "harvest",
      ],
      healthcare: [
        "medical",
        "pharmaceutical",
        "hospital",
        "clinic",
        "health",
        "medicine",
      ],
      finance: [
        "banking",
        "investment",
        "financial",
        "insurance",
        "accounting",
        "credit",
      ],
      education: [
        "school",
        "university",
        "training",
        "learning",
        "academic",
        "educational",
      ],
      retail: ["store", "shop", "sales", "commerce", "merchant", "trading"],
      automotive: ["car", "vehicle", "automobile", "motor", "parts", "garage"],
      "real-estate": [
        "property",
        "real estate",
        "housing",
        "construction",
        "building",
      ],
      food: [
        "restaurant",
        "catering",
        "beverage",
        "nutrition",
        "cooking",
        "culinary",
      ],
    };

    const normalizedIndustry = industry.toLowerCase().replace(/[^a-z]/g, "");
    return termMap[normalizedIndustry] || termMap[industry.toLowerCase()] || [];
  }

  /**
   * @description Get partial industry matches
   * @param {string} industry - Industry name
   * @returns {Array<string>} Partial matches
   * @private
   */
  getIndustryPartialMatches(industry) {
    const partialMap = {
      fashion: ["apparel", "clothing", "wear", "style"],
      technology: ["tech", "IT", "software", "digital"],
      manufacturing: ["production", "factory", "industrial"],
      healthcare: ["medical", "health", "pharma"],
      finance: ["banking", "financial", "money"],
      education: ["learning", "academic", "training"],
      food: ["restaurant", "catering", "nutrition"],
      textiles: ["fabric", "cloth", "textile"],
    };

    const normalizedIndustry = industry.toLowerCase().replace(/[^a-z]/g, "");
    return (
      partialMap[normalizedIndustry] || partialMap[industry.toLowerCase()] || []
    );
  }

  /**
   * @description Enhanced country codes mapping
   * @param {string} region - Region name
   * @returns {Array<string>} Country codes
   * @private
   */
  getCountryCodesEnhanced(region) {
    const codeMap = {
      india: ["IN", "IND", "+91"],
      china: ["CN", "CHN", "+86"],
      usa: ["US", "USA", "+1"],
      "united states": ["US", "USA", "+1"],
      germany: ["DE", "DEU", "+49"],
      japan: ["JP", "JPN", "+81"],
      uk: ["GB", "GBR", "+44"],
      "united kingdom": ["GB", "GBR", "+44"],
      france: ["FR", "FRA", "+33"],
      italy: ["IT", "ITA", "+39"],
      spain: ["ES", "ESP", "+34"],
      brazil: ["BR", "BRA", "+55"],
      canada: ["CA", "CAN", "+1"],
      australia: ["AU", "AUS", "+61"],
    };

    return codeMap[region.toLowerCase()] || [];
  }

  /**
   * @description Enhanced regional terms mapping
   * @param {string} region - Region name
   * @returns {Array<string>} Regional terms
   * @private
   */
  getRegionalTermsEnhanced(region) {
    const termMap = {
      india: [
        "indian",
        "delhi",
        "mumbai",
        "bangalore",
        "chennai",
        "kolkata",
        "pune",
        "hyderabad",
        "asia",
        "south asia",
      ],
      china: [
        "chinese",
        "beijing",
        "shanghai",
        "guangzhou",
        "shenzhen",
        "asia",
        "east asia",
      ],
      usa: [
        "american",
        "america",
        "new york",
        "california",
        "texas",
        "florida",
        "north america",
      ],
      "united states": [
        "american",
        "america",
        "new york",
        "california",
        "texas",
        "florida",
        "north america",
      ],
      europe: ["european", "eu", "germany", "france", "italy", "spain", "uk"],
      germany: ["german", "berlin", "munich", "hamburg", "european"],
      japan: ["japanese", "tokyo", "osaka", "kyoto", "asia", "east asia"],
      uk: ["british", "england", "london", "manchester", "european"],
      "united kingdom": [
        "british",
        "england",
        "london",
        "manchester",
        "european",
      ],
      asia: ["asian", "india", "china", "japan", "singapore", "thailand"],
      "north america": ["usa", "canada", "america", "american", "canadian"],
      "south america": [
        "brazil",
        "argentina",
        "chile",
        "colombia",
        "latin america",
      ],
    };

    return termMap[region.toLowerCase()] || [];
  }

  /**
   * @description Validate email format
   * @param {string} email - Email to validate
   * @returns {boolean} Is valid email
   * @private
   */
  isValidEmail(email) {
    if (!email || typeof email !== "string") return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * @description Validate phone format
   * @param {string} phone - Phone to validate
   * @returns {boolean} Is valid phone
   * @private
   */
  isValidPhone(phone) {
    if (!phone || typeof phone !== "string") return false;
    const cleanPhone = phone.replace(/[^\d]/g, "");
    return cleanPhone.length >= 8 && cleanPhone.length <= 15;
  }

  /**
   * @description Validate website format
   * @param {string} website - Website to validate
   * @returns {boolean} Is valid website
   * @private
   */
  isValidWebsite(website) {
    if (!website || typeof website !== "string") return false;
    try {
      const url = website.startsWith("http") ? website : `http://${website}`;
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @description Enhanced company name extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Company name
   * @private
   */
  extractCompanyNameEnhanced(rowData) {
    const companyFields = this.findAllFieldValues(rowData, [
      "company",
      "business",
      "organization",
      "firm",
      "companyname",
      "company_name",
      "business_name",
      "org",
      "enterprise",
    ]);

    for (const company of companyFields) {
      if (company && company.trim().length > 2) {
        return company.trim();
      }
    }

    return "Unknown Company";
  }

  /**
   * @description Enhanced country extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Country
   * @private
   */
  extractCountryEnhanced(rowData) {
    const locationFields = this.findAllFieldValues(rowData, [
      "country",
      "location",
      "region",
      "city",
      "state",
      "address",
    ]);

    for (const location of locationFields) {
      if (location && location.trim().length > 0) {
        return location.trim();
      }
    }

    return "Unknown";
  }

  /**
   * @description Enhanced contact person extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Contact person
   * @private
   */
  extractContactPersonEnhanced(rowData) {
    const nameFields = this.findAllFieldValues(rowData, [
      "name",
      "contact",
      "person",
      "contact_person",
      "contact_name",
      "representative",
      "manager",
      "owner",
      "director",
    ]);

    for (const name of nameFields) {
      if (name && name.trim().length > 1) {
        return name.trim();
      }
    }

    return null;
  }

  /**
   * @description Enhanced email extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Email
   * @private
   */
  extractEmailEnhanced(rowData) {
    const emailFields = this.findAllFieldValues(rowData, [
      "email",
      "mail",
      "e-mail",
      "contact",
      "email_address",
    ]);

    for (const email of emailFields) {
      if (email && this.isValidEmail(email)) {
        return email.trim();
      }
    }

    return null;
  }

  /**
   * @description Enhanced phone extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Phone
   * @private
   */
  extractPhoneEnhanced(rowData) {
    const phoneFields = this.findAllFieldValues(rowData, [
      "phone",
      "mobile",
      "tel",
      "telephone",
      "whatsapp",
      "contact",
      "phone_number",
      "mobile_number",
      "cell",
    ]);

    for (const phone of phoneFields) {
      if (phone && this.isValidPhone(phone)) {
        return phone.trim();
      }
    }

    return null;
  }

  /**
   * @description Enhanced website extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Website
   * @private
   */
  extractWebsiteEnhanced(rowData) {
    const websiteFields = this.findAllFieldValues(rowData, [
      "website",
      "url",
      "web",
      "site",
      "domain",
      "homepage",
    ]);

    for (const website of websiteFields) {
      if (website && this.isValidWebsite(website)) {
        return website.trim();
      }
    }

    return null;
  }

  /**
   * @description Enhanced business type extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Business type
   * @private
   */
  extractBusinessTypeEnhanced(rowData) {
    const typeFields = this.findAllFieldValues(rowData, [
      "type",
      "business_type",
      "category",
      "sector",
      "industry",
    ]);

    for (const type of typeFields) {
      if (type && type.trim().length > 0) {
        return type.trim();
      }
    }

    return "Unknown";
  }

  /**
   * @description Enhanced product categories extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Product categories
   * @private
   */
  extractProductCategoriesEnhanced(rowData) {
    const productFields = this.findAllFieldValues(rowData, [
      "products",
      "category",
      "categories",
      "services",
      "offerings",
    ]);

    for (const products of productFields) {
      if (products && products.trim().length > 0) {
        return products.trim();
      }
    }

    return "Unknown";
  }

  /**
   * @description Enhanced industry extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Industry
   * @private
   */
  extractIndustryEnhanced(rowData) {
    const industryFields = this.findAllFieldValues(rowData, [
      "industry",
      "sector",
      "category",
      "business",
      "field",
      "domain",
    ]);

    for (const industry of industryFields) {
      if (industry && industry.trim().length > 0) {
        return industry.trim();
      }
    }

    return "Unknown";
  }

  /**
   * @description Get city and regional indicators for location matching
   * @param {string} region - Region name
   * @returns {Array<string>} City and regional indicators
   * @private
   */
  getCityAndRegionalIndicators(region) {
    const regionLower = region.toLowerCase();

    const cityMap = {
      ajmer: ["ajmer", "ajmeri", "ajmer city", "ajmer district"],
      delhi: ["delhi", "new delhi", "delhi ncr", "national capital"],
      mumbai: ["mumbai", "bombay", "mumbai city", "greater mumbai"],
      bangalore: ["bangalore", "bengaluru", "silicon valley of india"],
      chennai: ["chennai", "madras", "chennai city"],
      kolkata: ["kolkata", "calcutta", "kolkata city"],
      pune: ["pune", "poona", "pune city"],
      hyderabad: ["hyderabad", "secunderabad", "cyberabad"],
      ahmedabad: ["ahmedabad", "amdavad", "ahmedabad city"],
      jaipur: ["jaipur", "pink city", "jaipur city"],
      surat: ["surat", "surat city", "diamond city"],
      kanpur: ["kanpur", "cawnpore", "kanpur city"],
      lucknow: ["lucknow", "city of nawabs", "lucknow city"],
      nagpur: ["nagpur", "orange city", "nagpur city"],
      indore: ["indore", "indore city", "commercial capital of mp"],
      thane: ["thane", "thane city", "city of lakes"],
      bhopal: ["bhopal", "city of lakes", "bhopal city"],
      visakhapatnam: ["visakhapatnam", "vizag", "visakhapatnam city"],
      pimpri: ["pimpri", "pimpri chinchwad", "pcmc"],
      patna: ["patna", "patna city", "patna sahib"],
      vadodara: ["vadodara", "baroda", "vadodara city"],
      ghaziabad: ["ghaziabad", "ghaziabad city"],
      ludhiana: ["ludhiana", "ludhiana city", "manchester of india"],
      agra: ["agra", "agra city", "city of taj"],
      nashik: ["nashik", "nasik", "nashik city"],
      faridabad: ["faridabad", "faridabad city"],
      meerut: ["meerut", "meerut city"],
      rajkot: ["rajkot", "rajkot city"],
      kalyan: ["kalyan", "kalyan city"],
      vasai: ["vasai", "vasai virar", "vasai city"],
      varanasi: ["varanasi", "benares", "kashi", "varanasi city"],
      srinagar: ["srinagar", "srinagar city", "summer capital"],
      aurangabad: ["aurangabad", "aurangabad city"],
      dhanbad: ["dhanbad", "dhanbad city", "coal capital"],
      amritsar: ["amritsar", "amritsar city", "holy city"],
      "navi mumbai": ["navi mumbai", "new mumbai", "planned city"],
      allahabad: ["allahabad", "prayagraj", "sangam city"],
      ranchi: ["ranchi", "ranchi city"],
      howrah: ["howrah", "howrah city"],
      coimbatore: ["coimbatore", "kovai", "manchester of south india"],
      jabalpur: ["jabalpur", "jabalpur city"],
      gwalior: ["gwalior", "gwalior city"],
      vijayawada: ["vijayawada", "bezawada", "vijayawada city"],
      jodhpur: ["jodhpur", "blue city", "sun city"],
      madurai: ["madurai", "temple city", "madurai city"],
      raipur: ["raipur", "raipur city"],
      kota: ["kota", "kota city", "education city"],
      chandigarh: ["chandigarh", "city beautiful", "chandigarh city"],
      gurgaon: ["gurgaon", "gurugram", "millennium city"],
      solapur: ["solapur", "sholapur", "solapur city"],
      hubli: ["hubli", "dharwad", "hubli dharwad"],
      tiruchirappalli: ["tiruchirappalli", "trichy", "rock fort city"],
      bareilly: ["bareilly", "bareilly city"],
      mysore: ["mysore", "mysuru", "city of palaces"],
      tiruppur: ["tiruppur", "t nagar", "knitwear capital"],
      guwahati: ["guwahati", "gauhati", "gateway to northeast"],
      salem: ["salem", "salem city", "steel city"],
      mira: ["mira", "mira road", "mira bhayander"],
      thiruvananthapuram: [
        "thiruvananthapuram",
        "trivandrum",
        "evergreen city",
      ],
      bhiwandi: ["bhiwandi", "bhiwandi city"],
      saharanpur: ["saharanpur", "saharanpur city"],
      gorakhpur: ["gorakhpur", "gorakhpur city"],
      guntur: ["guntur", "guntur city"],
      bikaner: ["bikaner", "bikaner city", "camel city"],
      amravati: ["amravati", "amravati city"],
      noida: ["noida", "new okhla", "planned city"],
      jamshedpur: ["jamshedpur", "tatanagar", "steel city"],
      bhilai: ["bhilai", "bhilai city", "steel city"],
      cuttack: ["cuttack", "kataka", "silver city"],
      firozabad: ["firozabad", "firozabad city", "glass city"],
      kochi: ["kochi", "cochin", "queen of arabian sea"],
      bhavnagar: ["bhavnagar", "bhavnagar city"],
      dehradun: ["dehradun", "doon", "school capital"],
      durgapur: ["durgapur", "durgapur city", "steel city"],
      asansol: ["asansol", "asansol city"],
      nanded: ["nanded", "nanded city"],
      kolhapur: ["kolhapur", "kolhapur city"],
      ajmer: ["ajmer", "ajmeri", "ajmer sharif", "holy city"],
    };

    return cityMap[regionLower] || [regionLower];
  }

  /**
   * @description Get location indicators for broader matching
   * @param {string} region - Region name
   * @returns {Array<string>} Location indicators
   * @private
   */
  getLocationIndicators(region) {
    const regionLower = region.toLowerCase();

    const indicators = [regionLower];

    // Add state/region indicators
    const stateMap = {
      rajasthan: ["rajasthan", "raj", "land of kings"],
      gujarat: ["gujarat", "guj", "jewel of west"],
      maharashtra: ["maharashtra", "mh", "maha"],
      karnataka: ["karnataka", "ka", "kar"],
      "tamil nadu": ["tamil nadu", "tn", "tamil"],
      "andhra pradesh": ["andhra pradesh", "ap", "andhra"],
      telangana: ["telangana", "ts", "tg"],
      kerala: ["kerala", "kl", "gods own country"],
      "west bengal": ["west bengal", "wb", "bengal"],
      odisha: ["odisha", "orissa", "od"],
      bihar: ["bihar", "br"],
      jharkhand: ["jharkhand", "jh"],
      "uttar pradesh": ["uttar pradesh", "up", "u.p."],
      "madhya pradesh": ["madhya pradesh", "mp", "m.p."],
      chhattisgarh: ["chhattisgarh", "cg"],
      punjab: ["punjab", "pb"],
      haryana: ["haryana", "hr"],
      "himachal pradesh": ["himachal pradesh", "hp"],
      uttarakhand: ["uttarakhand", "uk", "uttaranchal"],
      assam: ["assam", "as"],
      manipur: ["manipur", "mn"],
      meghalaya: ["meghalaya", "ml"],
      tripura: ["tripura", "tr"],
      mizoram: ["mizoram", "mz"],
      nagaland: ["nagaland", "nl"],
      "arunachal pradesh": ["arunachal pradesh", "ar"],
      sikkim: ["sikkim", "sk"],
      goa: ["goa", "ga"],
      delhi: ["delhi", "dl", "new delhi", "national capital territory"],
    };

    for (const [state, aliases] of Object.entries(stateMap)) {
      if (aliases.includes(regionLower)) {
        indicators.push(...aliases);
        break;
      }
    }

    return [...new Set(indicators)];
  }

  /**
   * @description Get partial location matches for fuzzy matching
   * @param {string} region - Region name
   * @returns {Array<string>} Partial matches
   * @private
   */
  getPartialLocationMatches(region) {
    const regionLower = region.toLowerCase();
    const partials = [];

    // Add partial matches based on common patterns
    if (regionLower.length > 3) {
      partials.push(regionLower.substring(0, 3)); // First 3 chars
      partials.push(regionLower.substring(0, 4)); // First 4 chars
    }

    // Add common abbreviations and variations
    const abbreviationMap = {
      bangalore: ["blr", "bang"],
      mumbai: ["bom", "mum"],
      delhi: ["del", "ndl"],
      chennai: ["che", "mad"],
      kolkata: ["cal", "kol"],
      hyderabad: ["hyd", "sec"],
      pune: ["pun", "poo"],
      ahmedabad: ["amd", "ahd"],
      surat: ["sur", "srt"],
      jaipur: ["jai", "jpr"],
      lucknow: ["lko", "luc"],
      kanpur: ["knp", "kan"],
      nagpur: ["nag", "ngp"],
      indore: ["ind", "idr"],
      thane: ["tha", "thn"],
      bhopal: ["bho", "bpl"],
      visakhapatnam: ["viz", "vsp"],
      vadodara: ["vad", "brd"],
      ghaziabad: ["ghz", "gzb"],
      ludhiana: ["ldh", "lud"],
      agra: ["agr", "agr"],
      nashik: ["nsk", "nas"],
      faridabad: ["fbd", "frd"],
      meerut: ["mrt", "mer"],
      rajkot: ["rjk", "raj"],
      varanasi: ["var", "bns"],
      srinagar: ["srn", "sri"],
      aurangabad: ["aur", "abd"],
      dhanbad: ["dhn", "dhb"],
      amritsar: ["asr", "amt"],
      allahabad: ["ald", "pry"],
      ranchi: ["ran", "rnc"],
      coimbatore: ["cbe", "coi"],
      jabalpur: ["jbp", "jab"],
      gwalior: ["gwa", "gwl"],
      vijayawada: ["vij", "bza"],
      jodhpur: ["jdh", "jod"],
      madurai: ["mad", "mdu"],
      raipur: ["rai", "rpr"],
      kota: ["kot", "kta"],
      gurgaon: ["ggn", "gur"],
      solapur: ["sol", "slp"],
      tiruchirappalli: ["trc", "tri"],
      bareilly: ["bar", "bly"],
      mysore: ["mys", "msr"],
      tiruppur: ["tup", "tir"],
      guwahati: ["guw", "ghy"],
      salem: ["sal", "slm"],
      thiruvananthapuram: ["tvm", "tri"],
      saharanpur: ["sah", "shp"],
      gorakhpur: ["gor", "gkp"],
      guntur: ["gun", "gnt"],
      bikaner: ["bik", "bkn"],
      noida: ["noi", "nda"],
      jamshedpur: ["jam", "jsr"],
      bhilai: ["bhi", "bla"],
      cuttack: ["cut", "ctc"],
      kochi: ["coc", "koc"],
      dehradun: ["ddn", "deh"],
      durgapur: ["dur", "dgp"],
      asansol: ["asa", "asl"],
      ajmer: ["ajm", "ajr"],
    };

    if (abbreviationMap[regionLower]) {
      partials.push(...abbreviationMap[regionLower]);
    }

    return [...new Set(partials)];
  }

  /**
   * @description Validate phone format
   * @param {string} phone - Phone to validate
   * @returns {boolean} Is valid phone
   * @private
   */
  isValidPhone(phone) {
    const phoneRegex = /[\d\+\-\(\)\s]{8,}/;
    return phoneRegex.test(phone);
  }

  /**
   * @description Validate website format
   * @param {string} website - Website to validate
   * @returns {boolean} Is valid website
   * @private
   */
  isValidWebsite(website) {
    const websiteRegex =
      /(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?/;
    return websiteRegex.test(website);
  }

  // Enhanced extraction methods
  /**
   * @description Enhanced company name extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Company name
   * @private
   */
  extractCompanyNameEnhanced(rowData) {
    return (
      this.findAllFieldValues(rowData, [
        "company",
        "business",
        "organization",
        "firm",
        "enterprise",
        "corp",
        "ltd",
        "inc",
      ])[0] || "Unknown Company"
    );
  }

  /**
   * @description Enhanced country extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Country
   * @private
   */
  extractCountryEnhanced(rowData) {
    return (
      this.findAllFieldValues(rowData, [
        "country",
        "nation",
        "location",
        "region",
        "address",
      ])[0] || "Unknown"
    );
  }

  /**
   * @description Enhanced industry extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Industry
   * @private
   */
  extractIndustryEnhanced(rowData) {
    return (
      this.findAllFieldValues(rowData, [
        "industry",
        "sector",
        "category",
        "business_type",
        "field",
        "domain",
      ])[0] || "Unknown"
    );
  }

  /**
   * @description Enhanced email extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Email
   * @private
   */
  extractEmailEnhanced(rowData) {
    const emails = this.findAllFieldValues(rowData, [
      "email",
      "mail",
      "e-mail",
      "contact",
      "email_address",
    ]);

    return emails.find((email) => this.isValidEmail(email)) || null;
  }

  /**
   * @description Enhanced phone extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Phone
   * @private
   */
  extractPhoneEnhanced(rowData) {
    const phones = this.findAllFieldValues(rowData, [
      "phone",
      "mobile",
      "tel",
      "telephone",
      "whatsapp",
      "contact_number",
    ]);

    return phones.find((phone) => this.isValidPhone(phone)) || null;
  }

  /**
   * @description Enhanced website extraction
   * @param {Object} rowData - Row data object
   * @returns {string} Website
   * @private
   */
  extractWebsiteEnhanced(rowData) {
    const websites = this.findAllFieldValues(rowData, [
      "website",
      "url",
      "web",
      "site",
      "domain",
      "homepage",
    ]);

    return websites.find((website) => this.isValidWebsite(website)) || null;
  }

  /**
   * @description Extract contact person name
   * @param {Object} rowData - Row data object
   * @returns {string} Contact person
   * @private
   */
  extractContactPersonEnhanced(rowData) {
    return (
      this.findAllFieldValues(rowData, [
        "contact_person",
        "name",
        "person",
        "contact_name",
        "representative",
      ])[0] || null
    );
  }

  /**
   * @description Extract business type
   * @param {Object} rowData - Row data object
   * @returns {string} Business type
   * @private
   */
  extractBusinessTypeEnhanced(rowData) {
    return (
      this.findAllFieldValues(rowData, [
        "business_type",
        "type",
        "category",
        "classification",
        "nature",
      ])[0] || null
    );
  }

  /**
   * @description Extract product categories
   * @param {Object} rowData - Row data object
   * @returns {string} Product categories
   * @private
   */
  extractProductCategoriesEnhanced(rowData) {
    return (
      this.findAllFieldValues(rowData, [
        "products",
        "categories",
        "product_category",
        "items",
        "goods",
        "services",
      ])[0] || null
    );
  }

  /**
   * @description Get upload middleware
   * @returns {Function} Multer middleware
   */
  getUploadMiddleware() {
    return this.upload.single("excel");
  }

  /**
   * @description Get location indicators like phone codes, postal patterns, etc.
   * @param {string} region - Region name
   * @returns {Array<string>} Location indicators
   * @private
   */
  getLocationIndicators(region) {
    const indicatorMap = {
      india: [
        "+91",
        "91-",
        "india",
        "ind",
        "delhi",
        "mumbai",
        "kolkata",
        "bangalore",
        "chennai",
        "hyderabad",
        "pune",
        "ahmedabad",
        "kerala",
        "tamil nadu",
        "maharashtra",
        "gujarat",
        "karnataka",
      ],
      china: [
        "+86",
        "86-",
        "china",
        "chn",
        "beijing",
        "shanghai",
        "guangzhou",
        "shenzhen",
        "tianjin",
        "wuhan",
        "chongqing",
        "sichuan",
        "guangdong",
        "jiangsu",
      ],
      usa: [
        "+1",
        "1-",
        "usa",
        "united states",
        "america",
        "ny",
        "ca",
        "tx",
        "fl",
        "washington",
        "oregon",
        "nevada",
        "arizona",
      ],
      "united states": [
        "+1",
        "1-",
        "usa",
        "united states",
        "america",
        "ny",
        "ca",
        "tx",
        "fl",
        "washington",
        "oregon",
        "nevada",
        "arizona",
      ],
      germany: [
        "+49",
        "49-",
        "germany",
        "deutschland",
        "berlin",
        "munich",
        "hamburg",
        "cologne",
        "frankfurt",
        "bavaria",
        "saxon",
      ],
      japan: [
        "+81",
        "81-",
        "japan",
        "nippon",
        "tokyo",
        "osaka",
        "kyoto",
        "yokohama",
        "kobe",
        "nagoya",
        "hiroshima",
      ],
      uk: [
        "+44",
        "44-",
        "uk",
        "britain",
        "england",
        "scotland",
        "wales",
        "london",
        "manchester",
        "birmingham",
        "liverpool",
        "bristol",
      ],
      "united kingdom": [
        "+44",
        "44-",
        "uk",
        "britain",
        "england",
        "scotland",
        "wales",
        "london",
        "manchester",
        "birmingham",
        "liverpool",
        "bristol",
      ],
      france: [
        "+33",
        "33-",
        "france",
        "paris",
        "marseille",
        "lyon",
        "toulouse",
        "nice",
        "nantes",
        "strasbourg",
      ],
      italy: [
        "+39",
        "39-",
        "italy",
        "italia",
        "rome",
        "milan",
        "naples",
        "turin",
        "florence",
        "venice",
      ],
      spain: [
        "+34",
        "34-",
        "spain",
        "espana",
        "madrid",
        "barcelona",
        "valencia",
        "seville",
        "bilbao",
      ],
      brazil: [
        "+55",
        "55-",
        "brazil",
        "brasil",
        "sao paulo",
        "rio de janeiro",
        "brasilia",
        "salvador",
        "fortaleza",
      ],
      canada: [
        "+1",
        "1-",
        "canada",
        "toronto",
        "vancouver",
        "montreal",
        "calgary",
        "ottawa",
        "quebec",
      ],
      australia: [
        "+61",
        "61-",
        "australia",
        "sydney",
        "melbourne",
        "brisbane",
        "perth",
        "adelaide",
      ],
    };

    return indicatorMap[region.toLowerCase()] || [];
  }

  /**
   * @description Get comprehensive city and regional indicators for precise location matching
   * @param {string} region - Region/City name
   * @returns {Array<string>} City and regional indicators
   * @private
   */
  getCityAndRegionalIndicators(region) {
    const cityIndicatorMap = {
      // Gujarat cities and regions (including Godhra)
      godhra: [
        "godhra",
        "panchmahal",
        "gujarat",
        "gj",
        "390001",
        "390",
        "dahod district",
      ],
      ahmedabad: ["ahmedabad", "amdavad", "gujarat", "gj", "380", "abad"],
      surat: ["surat", "gujarat", "gj", "395", "diamond city"],
      vadodara: ["vadodara", "baroda", "gujarat", "gj", "390"],
      rajkot: ["rajkot", "gujarat", "gj", "360"],
      bhavnagar: ["bhavnagar", "gujarat", "gj", "364"],
      gandhinagar: ["gandhinagar", "gujarat", "gj", "382"],
      gujarat: [
        "gujarat",
        "gj",
        "ahmedabad",
        "surat",
        "vadodara",
        "rajkot",
        "godhra",
        "panchmahal",
      ],

      // Maharashtra cities
      mumbai: ["mumbai", "bombay", "maharashtra", "mh", "400", "navi mumbai"],
      pune: ["pune", "maharashtra", "mh", "411", "pimpri"],
      nagpur: ["nagpur", "maharashtra", "mh", "440"],
      nashik: ["nashik", "maharashtra", "mh", "422"],
      aurangabad: ["aurangabad", "maharashtra", "mh", "431"],
      maharashtra: ["maharashtra", "mh", "mumbai", "pune", "nagpur"],

      // Delhi and NCR
      delhi: ["delhi", "new delhi", "dl", "110", "ncr", "gurgaon", "noida"],
      "new delhi": ["new delhi", "delhi", "dl", "110", "ncr"],
      gurgaon: ["gurgaon", "gurugram", "haryana", "hr", "122", "ncr"],
      noida: ["noida", "uttar pradesh", "up", "201", "ncr"],
      faridabad: ["faridabad", "haryana", "hr", "121", "ncr"],

      // Karnataka cities
      bangalore: ["bangalore", "bengaluru", "karnataka", "ka", "560"],
      bengaluru: ["bengaluru", "bangalore", "karnataka", "ka", "560"],
      mysore: ["mysore", "mysuru", "karnataka", "ka", "570"],
      hubli: ["hubli", "dharwad", "karnataka", "ka", "580"],
      karnataka: ["karnataka", "ka", "bangalore", "bengaluru", "mysore"],

      // Tamil Nadu cities
      chennai: ["chennai", "madras", "tamil nadu", "tn", "600"],
      coimbatore: ["coimbatore", "tamil nadu", "tn", "641"],
      madurai: ["madurai", "tamil nadu", "tn", "625"],
      salem: ["salem", "tamil nadu", "tn", "636"],
      tirupur: ["tirupur", "tamil nadu", "tn", "641"],
      "tamil nadu": ["tamil nadu", "tn", "chennai", "coimbatore", "madurai"],

      // Rajasthan cities
      jaipur: ["jaipur", "rajasthan", "rj", "302", "pink city"],
      jodhpur: ["jodhpur", "rajasthan", "rj", "342", "blue city"],
      udaipur: ["udaipur", "rajasthan", "rj", "313", "city of lakes"],
      kota: ["kota", "rajasthan", "rj", "324"],
      rajasthan: ["rajasthan", "rj", "jaipur", "jodhpur", "udaipur"],

      // West Bengal cities
      kolkata: ["kolkata", "calcutta", "west bengal", "wb", "700"],
      howrah: ["howrah", "west bengal", "wb", "711"],
      durgapur: ["durgapur", "west bengal", "wb", "713"],
      "west bengal": ["west bengal", "wb", "kolkata", "calcutta", "howrah"],

      // Uttar Pradesh cities
      lucknow: ["lucknow", "uttar pradesh", "up", "226"],
      kanpur: ["kanpur", "uttar pradesh", "up", "208"],
      agra: ["agra", "uttar pradesh", "up", "282", "taj mahal"],
      varanasi: ["varanasi", "benares", "uttar pradesh", "up", "221"],
      meerut: ["meerut", "uttar pradesh", "up", "250"],
      "uttar pradesh": ["uttar pradesh", "up", "lucknow", "kanpur", "agra"],

      // Haryana cities
      haryana: ["haryana", "hr", "gurgaon", "faridabad", "panipat"],
      panipat: ["panipat", "haryana", "hr", "132"],
      ambala: ["ambala", "haryana", "hr", "134"],

      // Punjab cities
      ludhiana: ["ludhiana", "punjab", "pb", "141"],
      amritsar: ["amritsar", "punjab", "pb", "143", "golden temple"],
      jalandhar: ["jalandhar", "punjab", "pb", "144"],
      punjab: ["punjab", "pb", "ludhiana", "amritsar", "jalandhar"],

      // International cities (common business locations)
      london: [
        "london",
        "uk",
        "england",
        "britain",
        "gb",
        "sw",
        "nw",
        "se",
        "ne",
      ],
      "new york": ["new york", "nyc", "ny", "manhattan", "brooklyn", "usa"],
      dubai: ["dubai", "uae", "emirates", "middle east"],
      singapore: ["singapore", "sg", "asia pacific"],
      "hong kong": ["hong kong", "hk", "china", "asia"],
      tokyo: ["tokyo", "japan", "jp", "asia"],
      paris: ["paris", "france", "fr", "europe"],
      berlin: ["berlin", "germany", "de", "europe"],
      sydney: ["sydney", "australia", "au", "oceania"],
      toronto: ["toronto", "canada", "ca", "north america"],
      "los angeles": ["los angeles", "la", "california", "ca", "usa"],
      chicago: ["chicago", "illinois", "il", "usa"],
      houston: ["houston", "texas", "tx", "usa"],
      miami: ["miami", "florida", "fl", "usa"],
    };

    const regionLower = region.toLowerCase();

    // Direct match
    if (cityIndicatorMap[regionLower]) {
      return cityIndicatorMap[regionLower];
    }

    // Partial match - search through values
    for (const [key, indicators] of Object.entries(cityIndicatorMap)) {
      if (key.includes(regionLower) || regionLower.includes(key)) {
        return indicators;
      }
    }

    // Fallback - return the region itself and common variations
    return [region, region.replace(/\s+/g, ""), region.toLowerCase()];
  }

  /**
   * @description Get partial location matches for fuzzy matching
   * @param {string} region - Region name
   * @returns {Array<string>} Partial matches
   * @private
   */
  getPartialLocationMatches(region) {
    const partialMap = {
      india: ["ind", "asia", "south", "desi", "hindi"],
      china: ["chn", "asia", "east", "chinese", "mandarin"],
      usa: ["us", "america", "american", "states"],
      "united states": ["us", "america", "american", "states"],
      germany: ["ger", "deutsch", "european", "eu"],
      japan: ["jp", "japanese", "asia", "east"],
      uk: ["british", "english", "european", "eu"],
      "united kingdom": ["british", "english", "european", "eu"],
      france: ["fr", "french", "european", "eu"],
      italy: ["it", "italian", "european", "eu"],
      spain: ["es", "spanish", "european", "eu"],
      brazil: ["br", "brazilian", "south america", "latin"],
      canada: ["ca", "canadian", "north america"],
      australia: ["au", "aussie", "oceania"],
      europe: ["eu", "european"],
      asia: ["asian"],
      africa: ["african"],
      "north america": ["na", "american"],
      "south america": ["sa", "latin"],
    };

    return partialMap[region.toLowerCase()] || [];
  }
}

module.exports = ExcelController;
