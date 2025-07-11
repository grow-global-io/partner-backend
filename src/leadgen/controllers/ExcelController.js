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
   * @description Find and score leads based on matchmaking criteria
   * @param {Object} req - Express request object
   * @param {string} req.body.product - Product/Service name (required)
   * @param {string} req.body.industry - Industry name (required)
   * @param {string} req.body.region - Region/Country (optional)
   * @param {Array<string>} req.body.keywords - Keywords array (optional)
   * @param {number} req.body.limit - Maximum results (default: 10)
   * @param {number} req.body.minScore - Minimum score threshold (default: 50)
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
        keywords = [],
        limit = 10,
        minScore = 50,
      } = req.body;

      // Validate required fields
      if (!product || !industry) {
        return res.status(400).json({
          success: false,
          error: "Product/Service and Industry are required fields",
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

      // Build comprehensive search query
      const searchQuery = this.buildSearchQuery(
        product,
        industry,
        region,
        keywords
      );

      console.log(`ExcelController: Finding leads for query: ${searchQuery}`);

      // Generate query embedding
      let queryEmbedding;
      try {
        queryEmbedding = await this.openAIService.generateEmbedding(
          searchQuery
        );
      } catch (embeddingError) {
        console.error("Error generating query embedding:", embeddingError);
        return this.handleDeepseekError(embeddingError, res);
      }

      // Search for relevant rows across all documents with larger initial set
      let relevantRows;
      try {
        relevantRows = await this.excelModel.vectorSearch(
          queryEmbedding,
          null, // fileKey - search all files
          Math.max(50, limit * 5), // Get more results for better scoring
          0.1 // Lower similarity threshold for initial search
        );
      } catch (searchError) {
        console.error("Error searching vectors:", searchError);
        return res.status(500).json({
          success: false,
          error: "Failed to search lead data",
          details: searchError.message,
        });
      }

      if (!relevantRows.length) {
        return res.status(404).json({
          success: false,
          error: "No relevant leads found for the specified criteria",
          data: {
            searchQuery,
            totalResults: 0,
            leads: [],
          },
        });
      }

      // Apply advanced scoring logic
      const scoredLeads = await this.scoreLeads(
        relevantRows,
        product,
        industry,
        region,
        keywords
      );

      // Filter by minimum score and limit results
      const filteredLeads = scoredLeads
        .filter((lead) => lead.finalScore >= minScore)
        .slice(0, parseInt(limit));

      // Generate AI insights about the lead matching
      let aiInsights = null;
      if (filteredLeads.length > 0) {
        try {
          aiInsights = await this.generateLeadInsights(
            searchQuery,
            filteredLeads.slice(0, 5), // Top 5 for insights
            product,
            industry,
            region
          );
        } catch (insightError) {
          console.error("Error generating AI insights:", insightError);
          // Continue without insights if this fails
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
            searchQuery,
          },
          totalMatches: relevantRows.length,
          qualifiedLeads: filteredLeads.length,
          leads: filteredLeads.map((lead) => ({
            companyName: this.extractCompanyName(lead.rowData),
            country: this.extractCountry(lead.rowData),
            industry: this.extractIndustry(lead.rowData),
            email: this.extractEmail(lead.rowData),
            phone: this.extractPhone(lead.rowData),
            website: this.extractWebsite(lead.rowData),

            // Scoring details
            finalScore: Math.round(lead.finalScore),
            scoreBreakdown: {
              industryMatch: Math.round(lead.industryScore * 30),
              geographicMatch: Math.round(lead.regionScore * 15),
              contactCompleteness: Math.round(lead.completenessScore * 10),
              leadActivity: Math.round(lead.activityScore * 15),
              exportReadiness: Math.round(lead.exportScore * 10),
              engagement: Math.round(lead.engagementScore * 10),
              dataFreshness: Math.round(lead.freshnessScore * 10),
            },

            // Metadata
            vectorSimilarity: lead.score,
            fileName: lead.fileName,
            rowIndex: lead.rowIndex,
            priority: this.getLeadPriority(lead.finalScore),
          })),

          // AI Insights
          insights: aiInsights,

          // Metadata
          responseTime,
          minScore,
          limit: parseInt(limit),
          model: "advanced-scoring-engine-v1",
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
   * @description Build comprehensive search query from criteria
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
   * @description Apply advanced scoring logic to leads
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
   * @description Calculate industry matching score
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
   * @description Calculate geographic matching score
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
   * @description Calculate contact completeness score
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
   * @description Get upload middleware
   * @returns {Function} Multer middleware
   */
  getUploadMiddleware() {
    return this.upload.single("excel");
  }
}

module.exports = ExcelController;
