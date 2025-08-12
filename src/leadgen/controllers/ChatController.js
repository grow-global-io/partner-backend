const ChatCacheService = require("../services/ChatCacheService");
const LeadGenerationService = require("../services/LeadGenerationService");
const { v4: uuidv4 } = require("uuid");

/**
 * @description Chat controller for managing chat sessions and lead generation
 * @class ChatController
 */
class ChatController {
  constructor() {
    this.chatCache = new ChatCacheService();
    this.leadGeneration = new LeadGenerationService();
  }

  /**
   * @description Store question-answer pair in chat session
   * @param {Object} req - Express request object
   * @param {string} req.body.chatId - Chat session ID (optional, will create if not provided)
   * @param {string} req.body.question - Predefined question from frontend
   * @param {string} req.body.answer - User's varied answer
   * @param {Object} res - Express response object
   */
  async storeQuestionAnswer(req, res) {
    try {
      const { chatId: providedChatId, question, answer } = req.body;

      // Validate required fields
      if (!question || !answer) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Both question and answer are required",
          code: "MISSING_REQUIRED_FIELDS",
        });
      }

      // Validate input lengths
      if (question.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Question cannot be empty",
          code: "EMPTY_QUESTION",
        });
      }

      if (answer.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Answer cannot be empty",
          code: "EMPTY_ANSWER",
        });
      }

      if (question.length > 500) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Question is too long (maximum 500 characters)",
          code: "QUESTION_TOO_LONG",
        });
      }

      if (answer.length > 2000) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Answer is too long (maximum 2000 characters)",
          code: "ANSWER_TOO_LONG",
        });
      }

      // Generate chatId if not provided
      const chatId = providedChatId || uuidv4();

      // Validate chatId format if provided
      if (providedChatId && !this.isValidChatId(providedChatId)) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Invalid chatId format",
          code: "INVALID_CHAT_ID",
        });
      }

      console.log(`ChatController: Storing Q&A for chat ${chatId}`);

      // Store question-answer pair in cache
      const updatedSession = this.chatCache.addQuestionAnswer(
        chatId,
        question,
        answer
      );

      // Determine session status
      const status = this.determineSessionStatus(updatedSession);

      // Return success response
      return res.status(200).json({
        success: true,
        data: {
          chatId: updatedSession.chatId,
          messageCount: updatedSession.metadata.totalQuestions,
          status: status,
          metadata: {
            lastActivity: updatedSession.lastActivity,
            totalQuestions: updatedSession.metadata.totalQuestions,
            sessionAge: Date.now() - updatedSession.createdAt.getTime(),
            questionType:
              updatedSession.questionAnswers[
                updatedSession.questionAnswers.length - 1
              ]?.metadata?.questionType,
          },
        },
      });
    } catch (error) {
      console.error("ChatController: Error storing question-answer:", error);

      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to store question-answer pair",
        details: error.message,
        code: "STORAGE_ERROR",
        retryable: true,
      });
    }
  }

  /**
   * @description Generate leads from chat history using LLM analysis
   * @param {Object} req - Express request object
   * @param {string} req.body.chatId - Chat session ID
   * @param {Object} res - Express response object
   */
  async generateLeads(req, res) {
    const startTime = Date.now();

    try {
      const { chatId } = req.body;

      // Validate required chatId
      if (!chatId) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "chatId is required",
          code: "MISSING_CHAT_ID",
        });
      }

      // Validate chatId format
      if (!this.isValidChatId(chatId)) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Invalid chatId format",
          code: "INVALID_CHAT_ID",
        });
      }

      console.log(`ChatController: Generating leads for chat ${chatId}`);

      // Retrieve chat session
      const session = this.chatCache.getChat(chatId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: "Chat not found",
          message: "Chat session not found or has expired",
          code: "CHAT_NOT_FOUND",
          retryable: false,
        });
      }

      // Validate sufficient Q&A data
      if (session.questionAnswers.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Insufficient data",
          message: "No question-answer pairs found in chat session",
          code: "NO_QA_DATA",
          retryable: false,
        });
      }

      // Check minimum data requirement (at least 2 Q&A pairs recommended)
      if (session.questionAnswers.length < 2) {
        console.log(
          `ChatController: Warning - Only ${session.questionAnswers.length} Q&A pairs available`
        );
      }

      console.log(
        `ChatController: Processing ${session.questionAnswers.length} Q&A pairs`
      );

      // Generate leads using LeadGenerationService
      const leadResult = await this.leadGeneration.generateLeads(
        session.questionAnswers
      );

      // Update last generation timestamp
      this.chatCache.updateLastGeneration(chatId);

      const processingTime = Date.now() - startTime;

      // Return successful response
      return res.status(200).json({
        success: true,
        data: {
          message: leadResult.message,
          leads: leadResult.leads,
          metadata: {
            ...leadResult.metadata,
            chatId: chatId,
            questionAnswerCount: session.questionAnswers.length,
            sessionCreated: session.createdAt,
            processingTime: processingTime,
          },
        },
      });
    } catch (error) {
      console.error("ChatController: Error generating leads:", error);

      const processingTime = Date.now() - startTime;

      // Determine if error is retryable
      const isRetryable = this.isRetryableError(error);

      return res.status(500).json({
        success: false,
        error: "Lead generation failed",
        message: "Failed to generate leads from chat history",
        details: error.message,
        code: "GENERATION_ERROR",
        retryable: isRetryable,
        metadata: {
          processingTime: processingTime,
          chatId: req.body.chatId,
        },
      });
    }
  }

  /**
   * @description Get chat session information
   * @param {Object} req - Express request object
   * @param {string} req.params.chatId - Chat session ID
   * @param {Object} res - Express response object
   */
  async getChatInfo(req, res) {
    try {
      const { chatId } = req.params;

      if (!chatId || !this.isValidChatId(chatId)) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Valid chatId is required",
          code: "INVALID_CHAT_ID",
        });
      }

      const session = this.chatCache.getChat(chatId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: "Chat not found",
          message: "Chat session not found or has expired",
          code: "CHAT_NOT_FOUND",
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          chatId: session.chatId,
          createdAt: session.createdAt,
          lastActivity: session.lastActivity,
          questionCount: session.metadata.totalQuestions,
          lastGeneration: session.metadata.lastGeneration,
          status: this.determineSessionStatus(session),
          questionAnswers: session.questionAnswers.map((qa) => ({
            id: qa.id,
            timestamp: qa.timestamp,
            question: qa.question,
            answer: qa.answer,
            questionType: qa.metadata.questionType,
          })),
        },
      });
    } catch (error) {
      console.error("ChatController: Error getting chat info:", error);

      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to retrieve chat information",
        details: error.message,
        code: "RETRIEVAL_ERROR",
      });
    }
  }

  /**
   * @description Get chat system health and statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getHealthStatus(req, res) {
    try {
      const cacheStats = this.chatCache.getChatStats();
      const generationStats = this.leadGeneration.getStats();

      const healthStatus = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        cache: {
          ...cacheStats,
          status: cacheStats.totalSessions < 1000 ? "healthy" : "warning",
        },
        leadGeneration: {
          ...generationStats,
          status: generationStats.successRate > 80 ? "healthy" : "warning",
        },
        system: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          nodeVersion: process.version,
        },
      };

      // Determine overall health
      const isHealthy =
        healthStatus.cache.status === "healthy" &&
        healthStatus.leadGeneration.status === "healthy";

      healthStatus.status = isHealthy ? "healthy" : "warning";

      return res.status(200).json({
        success: true,
        data: healthStatus,
      });
    } catch (error) {
      console.error("ChatController: Error getting health status:", error);

      return res.status(500).json({
        success: false,
        error: "Health check failed",
        message: "Failed to retrieve system health status",
        details: error.message,
      });
    }
  }

  /**
   * @description Validate chatId format (UUID v4)
   * @param {string} chatId - Chat ID to validate
   * @returns {boolean} True if valid
   * @private
   */
  isValidChatId(chatId) {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return typeof chatId === "string" && uuidRegex.test(chatId);
  }

  /**
   * @description Determine session status based on Q&A count and activity
   * @param {Object} session - Chat session object
   * @returns {string} Session status
   * @private
   */
  determineSessionStatus(session) {
    const qaCount = session.questionAnswers.length;
    const timeSinceLastActivity = Date.now() - session.lastActivity.getTime();
    const fiveMinutes = 5 * 60 * 1000;

    if (qaCount === 0) {
      return "new";
    } else if (qaCount < 3) {
      return "gathering";
    } else if (timeSinceLastActivity > fiveMinutes) {
      return "idle";
    } else {
      return "active";
    }
  }

  /**
   * @description Check if error is retryable
   * @param {Error} error - Error object
   * @returns {boolean} True if retryable
   * @private
   */
  isRetryableError(error) {
    const retryableErrors = [
      "rate limit",
      "timeout",
      "network",
      "connection",
      "temporary",
    ];

    const errorMessage = error.message.toLowerCase();
    return retryableErrors.some((keyword) => errorMessage.includes(keyword));
  }

  /**
   * @description Clear expired sessions manually (for maintenance)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async clearExpiredSessions(req, res) {
    try {
      const beforeCount = this.chatCache.getChatStats().totalSessions;
      this.chatCache.cleanup();
      const afterCount = this.chatCache.getChatStats().totalSessions;
      const clearedCount = beforeCount - afterCount;

      return res.status(200).json({
        success: true,
        message: `Cleared ${clearedCount} expired sessions`,
        data: {
          clearedSessions: clearedCount,
          remainingSessions: afterCount,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("ChatController: Error clearing expired sessions:", error);

      return res.status(500).json({
        success: false,
        error: "Cleanup failed",
        message: "Failed to clear expired sessions",
        details: error.message,
      });
    }
  }
}

module.exports = ChatController;
