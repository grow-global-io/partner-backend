const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const DocumentModel = require("../models/DocumentModel");
const MessageModel = require("../models/MessageModel");
const DeepseekService = require("../services/OpenAIService");
const S3Service = require("../services/S3Service");
const PDFService = require("../services/PDFService");

/**
 * @description Main PDF Chat Controller
 * @class PDFChatController
 */
class PDFChatController {
  constructor() {
    this.documentModel = new DocumentModel();
    this.messageModel = new MessageModel();
    this.deepseekService = new DeepseekService();
    this.s3Service = new S3Service();
    this.pdfService = new PDFService();

    // Initialize database connections
    this.initializeDatabase();

    // Configure multer for file uploads
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: this.pdfService.getMaxFileSize(),
      },
      fileFilter: (req, file, cb) => {
        if (file.mimetype === "application/pdf") {
          cb(null, true);
        } else {
          cb(new Error("Only PDF files are allowed"), false);
        }
      },
    });
  }

  /**
   * @description Initialize database connections
   * @private
   */
  async initializeDatabase() {
    try {
      await this.documentModel.connect();
      await this.messageModel.connect();
    } catch (error) {
      console.error("PDFChatController: Failed to initialize database:", error);
    }
  }

  /**
   * @description Upload PDF and create embeddings
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async uploadPDF(req, res) {
    try {
      const { walletId } = req.body;

      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No PDF file uploaded",
        });
      }

      const fileBuffer = req.file.buffer;
      const fileName = req.file.originalname;
      const mimeType = req.file.mimetype;

      // Validate PDF
      if (!this.pdfService.validatePDF(fileBuffer, mimeType)) {
        return res.status(400).json({
          success: false,
          error: "Invalid PDF file",
        });
      }

      // Check if password protected
      const isPasswordProtected = await this.pdfService.isPasswordProtected(
        fileBuffer
      );
      if (isPasswordProtected) {
        return res.status(400).json({
          success: false,
          error: "Password-protected PDFs are not supported",
        });
      }

      // Generate unique document ID
      const documentId = uuidv4();

      // Upload to S3 with better error handling
      let s3Result;
      try {
        s3Result = await this.s3Service.uploadPDF(
          fileBuffer,
          fileName,
          walletId,
          mimeType
        );
      } catch (s3Error) {
        console.error("S3 Upload Error:", s3Error.message);

        // Provide specific error messages for common AWS issues
        if (s3Error.message.includes("signature")) {
          return res.status(500).json({
            success: false,
            error: "AWS credentials configuration error",
            details:
              "Please check your AWS Access Key ID and Secret Access Key. See src/pdf-chat/QUICK_AWS_FIX.md for setup instructions.",
            troubleshooting: {
              issue: "AWS signature mismatch",
              solution:
                "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables",
              documentation: "/api/pdf-chat/docs - check AWS Setup section",
            },
          });
        } else if (s3Error.message.includes("Access Denied")) {
          return res.status(500).json({
            success: false,
            error: "AWS S3 access denied",
            details: "Check your AWS IAM permissions and bucket access policy.",
          });
        } else if (s3Error.message.includes("NoSuchBucket")) {
          return res.status(500).json({
            success: false,
            error: "S3 bucket not found",
            details: `Bucket '${process.env.AWS_BUCKET_NAME}' does not exist or is not accessible.`,
          });
        } else if (s3Error.message.includes("environment variables")) {
          return res.status(500).json({
            success: false,
            error: "AWS configuration missing",
            details: s3Error.message,
            quickFix:
              "See src/pdf-chat/QUICK_AWS_FIX.md for setup instructions",
          });
        }

        // Generic S3 error
        throw s3Error;
      }

      // Extract text from PDF
      const pdfData = await this.pdfService.extractTextFromPDF(fileBuffer);
      const cleanedText = this.pdfService.cleanText(pdfData.text);

      // Validate that text was extracted successfully
      if (!cleanedText || cleanedText.trim().length === 0) {
        console.error(`PDF text extraction failed for ${fileName}:`, {
          originalTextLength: pdfData.text?.length || 0,
          cleanedTextLength: cleanedText?.length || 0,
          totalPages: pdfData.totalPages,
        });
        return res.status(400).json({
          success: false,
          error: "No text content could be extracted from the PDF",
          details:
            "This PDF appears to be image-based (scanned) or contains no extractable text. Please ensure your PDF contains selectable text content.",
          troubleshooting: {
            issue: "Text extraction failed",
            solutions: [
              "Ensure the PDF contains selectable text (not just images)",
              "Try re-uploading the document",
              "Convert scanned images to text-based PDF using OCR if needed",
            ],
            fileInfo: {
              fileName: fileName,
              fileSize: fileBuffer.length,
              totalPages: pdfData.totalPages,
              extractedTextLength: cleanedText?.length || 0,
            },
          },
        });
      }

      // Split text into chunks
      const textChunks = this.deepseekService.splitTextIntoChunks(cleanedText);

      // Validate that chunks were created
      if (!textChunks || textChunks.length === 0) {
        console.error(`Text chunking failed for ${fileName}:`, {
          cleanedTextLength: cleanedText.length,
          textPreview: cleanedText.substring(0, 100),
        });
        return res.status(400).json({
          success: false,
          error: "Failed to process PDF text into chunks",
          details:
            "The extracted text could not be split into processable chunks.",
          extractedTextLength: cleanedText.length,
        });
      }

      console.log(
        `PDF processing: ${textChunks.length} chunks created from ${cleanedText.length} characters`
      );

      // Generate embeddings
      const embeddings = await this.deepseekService.generateEmbeddings(
        textChunks
      );

      // Validate embeddings were generated
      if (!embeddings || embeddings.length === 0) {
        console.error(`Embedding generation failed for ${fileName}:`, {
          textChunks: textChunks.length,
          textLength: cleanedText.length,
        });
        return res.status(500).json({
          success: false,
          error: "Failed to generate embeddings for PDF content",
          details:
            "The text chunks could not be converted to embeddings for search functionality.",
          textChunks: textChunks.length,
        });
      }

      // Add page information to embeddings
      const enrichedEmbeddings = embeddings.map((embedding, index) => {
        const pageInfo = this.getPageInfoForChunk(
          index,
          textChunks.length,
          pdfData.totalPages
        );
        return {
          ...embedding,
          metadata: {
            ...embedding.metadata,
            pageNumber: pageInfo.pageNumber,
            totalPages: pdfData.totalPages,
            documentId: documentId,
          },
        };
      });

      // Store document in MongoDB
      const documentData = {
        documentId,
        walletId,
        fileName,
        s3Key: s3Result.s3Key,
        s3Url: s3Result.s3Url,
        fileSize: s3Result.fileSize,
        mimeType: s3Result.mimeType,
        embeddings: enrichedEmbeddings,
        totalPages: pdfData.totalPages,
        extractedText: cleanedText,
      };

      const storedDocument = await this.documentModel.storeDocument(
        documentData
      );

      // Store system message about document upload
      await this.messageModel.storeMessage({
        walletId,
        documentId,
        documentName: fileName,
        message: `Document "${fileName}" uploaded successfully. ${pdfData.totalPages} pages processed with ${enrichedEmbeddings.length} text chunks.`,
        sender: "system",
        messageType: "system",
        metadata: {
          documentUpload: {
            fileName,
            fileSize: s3Result.fileSize,
            totalPages: pdfData.totalPages,
            totalChunks: enrichedEmbeddings.length,
          },
        },
      });

      res.status(201).json({
        success: true,
        message: "PDF uploaded and processed successfully",
        data: {
          documentId: documentId,
          fileName: fileName,
          totalPages: pdfData.totalPages,
          totalChunks: enrichedEmbeddings.length,
          fileSize: s3Result.fileSize,
          s3Url: s3Result.s3Url,
          uploadedAt: new Date(),
          metadata: pdfData.metadata,
        },
      });
    } catch (error) {
      console.error("PDFChatController: Error uploading PDF:", error);
      res.status(500).json({
        success: false,
        error: "Failed to upload and process PDF",
        details: error.message,
      });
    }
  }

  /**
   * @description Chat with a specific document (document-centric with conversation context)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async chatWithDocument(req, res) {
    const startTime = Date.now();

    try {
      const { documentId } = req.params;
      const { query, walletId } = req.body;

      // Validate required fields first
      if (!documentId) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameter: documentId is required",
        });
      }

      if (!query) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: query is required",
        });
      }

      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: walletId is required",
        });
      }

      // Check if document exists (without walletId requirement)
      const document = await this.documentModel.getDocumentById(documentId);
      if (!document) {
        return res.status(404).json({
          success: false,
          error: "Document not found",
          details: "Document does not exist",
        });
      }

      // Verify that the user has access to this document
      if (document.walletId !== walletId) {
        return res.status(403).json({
          success: false,
          error: "Access denied",
          details: "You don't have permission to chat with this document",
        });
      }

      const documentData = document;

      // Store user query in document-specific conversation
      const userMessage = {
        walletId,
        documentId,
        documentName: documentData.fileName,
        message: query,
        sender: "user",
        messageType: "query",
        metadata: {
          userAgent: req.headers["user-agent"],
          ipAddress: req.ip,
          responseTime: null,
          tokenUsage: null,
        },
      };

      const userMessageResult = await this.messageModel.storeMessage(
        userMessage
      );

      if (!userMessageResult) {
        return res.status(500).json({
          success: false,
          error: "Failed to store user message",
        });
      }

      // Get conversation context for chain of thought (get recent messages)
      const recentMessages = await this.messageModel.getMessagesByWallet(
        walletId,
        1,
        8,
        documentId
      );

      const conversationContext = recentMessages.messages
        .slice(-6) // Get last 6 messages for context
        .map((msg) => ({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.message,
          timestamp: msg.timestamp,
        }));

      // Check if document has embeddings/chunks
      if (!documentData.embeddings || documentData.embeddings.length === 0) {
        const noEmbeddingsResponse = `I'm sorry, but I can't answer questions about this document. The document "${
          documentData.fileName
        }" doesn't have any processed text content or embeddings available. 

**Analysis:**
📄 File: ${documentData.fileName}
📊 File Size: ${Math.round(documentData.fileSize / 1024)} KB
📄 Pages: ${documentData.metadata?.totalPages || "Unknown"}
📝 Extracted Text: ${
          documentData.metadata?.extractedText?.length || 0
        } characters
🔍 Text Chunks: ${documentData.embeddings?.length || 0}

**This typically happens because:**
1. **Image-based PDF**: The document is a scanned PDF without selectable text
2. **Text extraction failed**: Technical issue during upload processing  
3. **Empty/corrupted document**: The PDF contains no readable content

**Solutions:**
✅ Re-upload the document (if it was a processing error)
✅ Use a text-based PDF with selectable text content
✅ Convert scanned PDFs using OCR software first
✅ Ensure the PDF is not corrupted or password-protected

Would you like to try uploading a different document?`;

        // Store assistant response
        await this.messageModel.storeMessage({
          walletId,
          documentId,
          documentName: documentData.fileName,
          message: noEmbeddingsResponse,
          sender: "assistant",
          messageType: "response",
          metadata: {
            responseTime: Date.now() - startTime,
            relevantChunks: 0,
            conversationContext: conversationContext.length,
            error: "No embeddings available",
            documentAnalysis: {
              fileName: documentData.fileName,
              fileSize: documentData.fileSize,
              totalPages: documentData.metadata?.totalPages,
              extractedTextLength:
                documentData.metadata?.extractedText?.length || 0,
              embeddingsCount: documentData.embeddings?.length || 0,
            },
          },
        });

        return res.json({
          success: true,
          data: {
            answer: noEmbeddingsResponse,
            documentId,
            documentName: documentData.fileName,
            conversationContext: conversationContext.length,
            relevantChunks: 0,
            responseTime: Date.now() - startTime,
            error: "No embeddings available",
            documentAnalysis: {
              fileName: documentData.fileName,
              fileSize: documentData.fileSize,
              totalPages: documentData.metadata?.totalPages,
              extractedTextLength:
                documentData.metadata?.extractedText?.length || 0,
              embeddingsCount: documentData.embeddings?.length || 0,
              recommendation: "Upload a text-based PDF with selectable content",
            },
          },
        });
      }

      // Generate query embedding for similarity search
      let queryEmbedding;
      try {
        queryEmbedding = await this.deepseekService.generateEmbedding(query);
      } catch (embeddingError) {
        console.error("Error generating query embedding:", embeddingError);

        const embeddingErrorResponse = `I'm sorry, but I can't process your question right now due to an issue with the AI service. Please try again later.`;

        await this.messageModel.storeMessage({
          walletId,
          documentId,
          documentName: documentData.fileName,
          message: embeddingErrorResponse,
          sender: "assistant",
          messageType: "response",
          metadata: {
            responseTime: Date.now() - startTime,
            relevantChunks: 0,
            conversationContext: conversationContext.length,
            error: "Embedding generation failed",
          },
        });

        return res.json({
          success: true,
          data: {
            answer: embeddingErrorResponse,
            documentId,
            documentName: documentData.fileName,
            conversationContext: conversationContext.length,
            relevantChunks: 0,
            responseTime: Date.now() - startTime,
            error: "Embedding generation failed",
          },
        });
      }

      // Get relevant document chunks using embeddings
      const relevantChunks =
        await this.documentModel.searchSimilarEmbeddingsByDocument(
          queryEmbedding,
          documentId,
          5 // Top 5 relevant chunks
        );

      if (relevantChunks.length === 0) {
        const noContextResponse = `I don't have any relevant information about "${query}" in the document "${documentData.fileName}". The document might not contain text content, or the information you're looking for might not be available.`;

        // Store assistant response
        await this.messageModel.storeMessage({
          walletId,
          documentId,
          documentName: documentData.fileName,
          message: noContextResponse,
          sender: "assistant",
          messageType: "response",
          metadata: {
            responseTime: Date.now() - startTime,
            relevantChunks: 0,
            conversationContext: conversationContext.length,
          },
        });

        return res.json({
          success: true,
          data: {
            answer: noContextResponse,
            documentId,
            documentName: documentData.fileName,
            conversationContext: conversationContext.length,
            relevantChunks: 0,
            responseTime: Date.now() - startTime,
          },
        });
      }

      // Generate AI response with conversation context
      const chatResponse =
        await this.deepseekService.generateChatResponseWithContext(
          query,
          relevantChunks,
          documentData.fileName,
          conversationContext // Include conversation history for chain of thought
        );

      const responseTime = Date.now() - startTime;

      // Store assistant response in document conversation
      await this.messageModel.storeMessage({
        walletId,
        documentId,
        documentName: documentData.fileName,
        message: chatResponse.answer,
        sender: "assistant",
        messageType: "response",
        metadata: {
          responseTime,
          tokenUsage: chatResponse.usage,
          model: chatResponse.model,
          relevantChunks: chatResponse.relevantChunks,
          conversationContext: conversationContext.length,
          relevantSources: chatResponse.sources,
        },
      });

      // Update document's last chat time
      await this.documentModel.updateLastChatTime(documentId, walletId);

      res.json({
        success: true,
        data: {
          answer: chatResponse.answer,
          documentId,
          documentName: documentData.fileName,
          conversationContext: conversationContext.length,
          relevantChunks: chatResponse.relevantChunks,
          sources: chatResponse.sources,
          responseTime,
          usage: chatResponse.usage,
        },
      });
    } catch (error) {
      console.error("PDFChatController: Error in document chat:", error);

      // Try to store error message
      try {
        if (req.params.documentId && req.body.walletId) {
          await this.messageModel.storeMessage({
            walletId: req.body.walletId,
            documentId: req.params.documentId,
            message: "An error occurred while processing your request.",
            sender: "system",
            messageType: "error",
            metadata: {
              error: error.message,
              responseTime: Date.now() - startTime,
            },
          });
        }
      } catch (storeError) {
        console.error("Failed to store error message:", storeError);
      }

      res.status(500).json({
        success: false,
        error: "Failed to process chat request",
        details: error.message,
      });
    }
  }

  /**
   * @description Get all messages for a specific document
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDocumentMessages(req, res) {
    try {
      const { walletId, documentId } = req.params;
      const { page = 1, limit = 50, sortOrder = "asc" } = req.query;

      if (!walletId || !documentId) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters: walletId and documentId",
        });
      }

      // Verify document access
      const document = await this.documentModel.getDocument(
        documentId,
        walletId
      );
      if (!document) {
        return res.status(404).json({
          success: false,
          error: "Document not found or access denied",
        });
      }

      const result = await this.messageModel.getMessagesByWallet(
        walletId,
        parseInt(page),
        parseInt(limit),
        documentId
      );

      // Add document info to response
      const responseData = {
        success: true,
        data: {
          messages: result.messages,
          documentId,
          document: {
            documentId,
            fileName: document.fileName,
            uploadedAt: document.uploadedAt,
          },
          pagination: result.pagination,
        },
      };

      res.json(responseData);
    } catch (error) {
      console.error(
        "PDFChatController: Error getting document messages:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Failed to retrieve document messages",
        details: error.message,
      });
    }
  }

  /**
   * @description Get all documents with their conversation summaries
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDocumentsWithConversations(req, res) {
    try {
      const { walletId } = req.params;

      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameter: walletId",
        });
      }

      // Get all documents for the wallet
      const documents = await this.documentModel.getDocumentsByWallet(walletId);

      // For each document, get conversation statistics
      const documentsWithConversations = [];

      for (const doc of documents) {
        // Get message statistics for this document
        const messageStats = await this.messageModel.getMessagesByWallet(
          walletId,
          1,
          1,
          doc.documentId
        );

        // Get first and last message for this document
        const firstMessage = await this.messageModel.collection.findOne(
          { walletId, documentId: doc.documentId },
          { sort: { timestamp: 1 } }
        );

        const lastMessage = await this.messageModel.collection.findOne(
          { walletId, documentId: doc.documentId },
          { sort: { timestamp: -1 } }
        );

        const userMessageCount =
          await this.messageModel.collection.countDocuments({
            walletId,
            documentId: doc.documentId,
            sender: "user",
          });

        const assistantMessageCount =
          await this.messageModel.collection.countDocuments({
            walletId,
            documentId: doc.documentId,
            sender: "assistant",
          });

        documentsWithConversations.push({
          documentId: doc.documentId,
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          totalPages: doc.metadata?.totalPages || 0,
          totalChunks: doc.metadata?.totalChunks || 0,
          uploadedAt: doc.metadata?.uploadedAt || doc.uploadedAt,
          lastChatAt: doc.metadata?.lastChatAt,
          conversation: {
            totalMessages: messageStats.pagination.totalMessages,
            userMessages: userMessageCount,
            assistantMessages: assistantMessageCount,
            firstMessageAt: firstMessage?.timestamp || null,
            lastMessageAt: lastMessage?.timestamp || null,
            hasConversation: messageStats.pagination.totalMessages > 0,
          },
        });
      }

      res.json({
        success: true,
        data: {
          walletId,
          documents: documentsWithConversations,
          totalDocuments: documentsWithConversations.length,
          documentsWithConversations: documentsWithConversations.filter(
            (doc) => doc.conversation.hasConversation
          ).length,
        },
      });
    } catch (error) {
      console.error(
        "PDFChatController: Error getting documents with conversations:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Failed to retrieve documents with conversations",
        details: error.message,
      });
    }
  }

  /**
   * @description Get conversation summary for a specific document
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDocumentConversationSummary(req, res) {
    try {
      const { walletId, documentId } = req.params;

      if (!walletId || !documentId) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters: walletId and documentId",
        });
      }

      // Verify document access
      const document = await this.documentModel.getDocument(
        documentId,
        walletId
      );
      if (!document) {
        return res.status(404).json({
          success: false,
          error: "Document not found or access denied",
        });
      }

      // Get conversation statistics
      const totalMessages = await this.messageModel.collection.countDocuments({
        walletId,
        documentId,
      });

      const userMessages = await this.messageModel.collection.countDocuments({
        walletId,
        documentId,
        sender: "user",
      });

      const assistantMessages =
        await this.messageModel.collection.countDocuments({
          walletId,
          documentId,
          sender: "assistant",
        });

      const firstMessage = await this.messageModel.collection.findOne(
        { walletId, documentId },
        { sort: { timestamp: 1 } }
      );

      const lastMessage = await this.messageModel.collection.findOne(
        { walletId, documentId },
        { sort: { timestamp: -1 } }
      );

      const result = {
        success: true,
        data: {
          documentId,
          totalMessages,
          userMessages,
          assistantMessages,
          firstMessageAt: firstMessage?.timestamp || null,
          lastMessageAt: lastMessage?.timestamp || null,
          hasConversation: totalMessages > 0,
          document: {
            fileName: document.fileName,
            uploadedAt: document.uploadedAt,
            fileSize: document.fileSize,
            totalPages: document.metadata?.totalPages || 0,
          },
        },
      };

      res.json(result);
    } catch (error) {
      console.error(
        "PDFChatController: Error getting document conversation summary:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Failed to retrieve document conversation summary",
        details: error.message,
      });
    }
  }

  /**
   * @description Get user's documents
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getUserDocuments(req, res) {
    try {
      const { walletId } = req.params;

      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      const documents = await this.documentModel.getDocumentsByWallet(walletId);

      const formattedDocuments = documents.map((doc) => ({
        documentId: doc.documentId,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        totalPages: doc.metadata.totalPages,
        totalChunks: doc.metadata.totalChunks,
        uploadedAt: doc.metadata.uploadedAt,
        lastChatAt: doc.metadata.lastChatAt,
      }));

      res.json({
        success: true,
        data: {
          documents: formattedDocuments,
          totalDocuments: formattedDocuments.length,
        },
      });
    } catch (error) {
      console.error("PDFChatController: Error getting user documents:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve documents",
        details: error.message,
      });
    }
  }

  /**
   * @description Get messages for a wallet with pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getMessages(req, res) {
    try {
      const { walletId } = req.params;
      const { page = 1, limit = 50, documentId } = req.query;

      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      const result = await this.messageModel.getMessagesByWallet(
        walletId,
        parseInt(page),
        parseInt(limit),
        documentId
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("PDFChatController: Error getting messages:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve messages",
        details: error.message,
      });
    }
  }

  /**
   * @description Get conversations for a wallet
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getConversations(req, res) {
    try {
      const { walletId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      const result = await this.messageModel.getConversationsByWallet(
        walletId,
        parseInt(page),
        parseInt(limit)
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("PDFChatController: Error getting conversations:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve conversations",
        details: error.message,
      });
    }
  }

  /**
   * @description Get specific conversation messages
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getConversationMessages(req, res) {
    try {
      const { walletId, conversationId } = req.params;

      if (!walletId || !conversationId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID and Conversation ID are required",
        });
      }

      const messages = await this.messageModel.getConversationMessages(
        conversationId,
        walletId
      );

      res.json({
        success: true,
        data: {
          conversationId,
          messages,
          messageCount: messages.length,
        },
      });
    } catch (error) {
      console.error(
        "PDFChatController: Error getting conversation messages:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Failed to retrieve conversation messages",
        details: error.message,
      });
    }
  }

  /**
   * @description Get message statistics for a wallet
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getMessageStatistics(req, res) {
    try {
      const { walletId } = req.params;

      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      const statistics = await this.messageModel.getMessageStatistics(walletId);

      res.json({
        success: true,
        data: statistics,
      });
    } catch (error) {
      console.error("PDFChatController: Error getting statistics:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve message statistics",
        details: error.message,
      });
    }
  }

  /**
   * @description Search messages
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async searchMessages(req, res) {
    try {
      const { walletId } = req.params;
      const { q: searchQuery, page = 1, limit = 20 } = req.query;

      if (!walletId || !searchQuery) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID and search query are required",
        });
      }

      const result = await this.messageModel.searchMessages(
        walletId,
        searchQuery,
        parseInt(page),
        parseInt(limit)
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("PDFChatController: Error searching messages:", error);
      res.status(500).json({
        success: false,
        error: "Failed to search messages",
        details: error.message,
      });
    }
  }

  /**
   * @description Delete a conversation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteConversation(req, res) {
    try {
      const { walletId, conversationId } = req.params;

      if (!walletId || !conversationId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID and Conversation ID are required",
        });
      }

      const deleted = await this.messageModel.deleteConversation(
        conversationId,
        walletId
      );

      if (deleted) {
        res.json({
          success: true,
          message: "Conversation deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          error: "Conversation not found",
        });
      }
    } catch (error) {
      console.error("PDFChatController: Error deleting conversation:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete conversation",
        details: error.message,
      });
    }
  }

  /**
   * @description Delete a document
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteDocument(req, res) {
    try {
      const { walletId, documentId } = req.params;

      if (!walletId || !documentId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID and Document ID are required",
        });
      }

      // Get document to retrieve S3 key
      const document = await this.documentModel.getDocument(
        documentId,
        walletId
      );

      if (!document) {
        return res.status(404).json({
          success: false,
          error: "Document not found",
        });
      }

      // Delete from S3
      await this.s3Service.deletePDF(document.s3Key);

      // Delete from MongoDB
      const deleted = await this.documentModel.deleteDocument(
        documentId,
        walletId
      );

      if (deleted) {
        res.json({
          success: true,
          message: "Document deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          error: "Document not found",
        });
      }
    } catch (error) {
      console.error("PDFChatController: Error deleting document:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete document",
        details: error.message,
      });
    }
  }

  /**
   * @description Get document details
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDocumentDetails(req, res) {
    try {
      const { walletId, documentId } = req.params;

      const document = await this.documentModel.getDocument(
        documentId,
        walletId
      );

      if (!document) {
        return res.status(404).json({
          success: false,
          error: "Document not found",
        });
      }

      // Generate presigned URL for download
      const presignedUrl = await this.s3Service.generatePresignedUrl(
        document.s3Key
      );

      res.json({
        success: true,
        data: {
          documentId: document.documentId,
          fileName: document.fileName,
          fileSize: document.fileSize,
          totalPages: document.metadata.totalPages,
          totalChunks: document.metadata.totalChunks,
          uploadedAt: document.metadata.uploadedAt,
          lastChatAt: document.metadata.lastChatAt,
          downloadUrl: presignedUrl,
        },
      });
    } catch (error) {
      console.error(
        "PDFChatController: Error getting document details:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Failed to get document details",
        details: error.message,
      });
    }
  }

  /**
   * @description Get page info for a chunk
   * @private
   */
  getPageInfoForChunk(chunkIndex, totalChunks, totalPages) {
    const pageNumber = Math.ceil((chunkIndex + 1) / (totalChunks / totalPages));
    return {
      pageNumber: Math.min(pageNumber, totalPages),
    };
  }

  /**
   * @description Get multer upload middleware
   * @returns {Function} Multer middleware
   */
  getUploadMiddleware() {
    return this.upload.single("pdf");
  }

  /**
   * @description Legacy method: Get documents for wallet (calls getUserDocuments)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDocuments(req, res) {
    // Redirect to the new method
    return this.getUserDocuments(req, res);
  }

  /**
   * @description Legacy method: Chat with documents (supports old API format)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async chat(req, res) {
    try {
      const { walletId, query, documentId } = req.body;

      if (!walletId || !query) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: walletId and query are required",
        });
      }

      // If documentId is provided, redirect to the new document-specific chat
      if (documentId) {
        req.params.documentId = documentId;
        return this.chatWithDocument(req, res);
      }

      // If no documentId, get the user's documents and chat with the first one
      const documentsResult = await this.documentModel.getDocumentsByWallet(
        walletId
      );

      if (!documentsResult || documentsResult.length === 0) {
        return res.status(404).json({
          success: false,
          error:
            "No documents found for this wallet. Please upload a PDF first.",
          suggestion: "Use POST /upload to upload a PDF document",
        });
      }

      // Use the first document for backward compatibility
      req.params.documentId = documentsResult[0].documentId;
      return this.chatWithDocument(req, res);
    } catch (error) {
      console.error("PDFChatController: Error in legacy chat:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process chat request",
        details: error.message,
      });
    }
  }
}

module.exports = PDFChatController;
