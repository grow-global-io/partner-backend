const ChatController = require("../ChatController");

// Mock dependencies
jest.mock("../services/ChatCacheService");
jest.mock("../services/LeadGenerationService");
jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid-1234"),
}));

const ChatCacheService = require("../services/ChatCacheService");
const LeadGenerationService = require("../services/LeadGenerationService");

describe("ChatController", () => {
  let chatController;
  let mockChatCache;
  let mockLeadGeneration;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockChatCache = {
      addQuestionAnswer: jest.fn(),
      getChat: jest.fn(),
      updateLastGeneration: jest.fn(),
      getChatStats: jest.fn(),
      cleanup: jest.fn(),
    };

    mockLeadGeneration = {
      generateLeads: jest.fn(),
      getStats: jest.fn(),
    };

    // Mock constructors
    ChatCacheService.mockImplementation(() => mockChatCache);
    LeadGenerationService.mockImplementation(() => mockLeadGeneration);

    chatController = new ChatController();

    // Mock Express req/res objects
    mockReq = {
      body: {},
      params: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe("storeQuestionAnswer", () => {
    beforeEach(() => {
      mockReq.body = {
        chatId: "test-chat-id",
        question: "What industry are you in?",
        answer: "I am in the textile manufacturing business",
      };
    });

    it("should store Q&A successfully with existing chatId", async () => {
      const mockSession = {
        chatId: "test-chat-id",
        createdAt: new Date(),
        lastActivity: new Date(),
        metadata: { totalQuestions: 1 },
        questionAnswers: [
          {
            metadata: { questionType: "industry" },
          },
        ],
      };

      mockChatCache.addQuestionAnswer.mockReturnValue(mockSession);

      await chatController.storeQuestionAnswer(mockReq, mockRes);

      expect(mockChatCache.addQuestionAnswer).toHaveBeenCalledWith(
        "test-chat-id",
        "What industry are you in?",
        "I am in the textile manufacturing business"
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          chatId: "test-chat-id",
          messageCount: 1,
          status: expect.any(String),
        }),
      });
    });

    it("should generate new chatId when not provided", async () => {
      delete mockReq.body.chatId;

      const mockSession = {
        chatId: "test-uuid-1234",
        createdAt: new Date(),
        lastActivity: new Date(),
        metadata: { totalQuestions: 1 },
        questionAnswers: [{ metadata: { questionType: "industry" } }],
      };

      mockChatCache.addQuestionAnswer.mockReturnValue(mockSession);

      await chatController.storeQuestionAnswer(mockReq, mockRes);

      expect(mockChatCache.addQuestionAnswer).toHaveBeenCalledWith(
        "test-uuid-1234",
        expect.any(String),
        expect.any(String)
      );
    });

    it("should return 400 for missing question", async () => {
      delete mockReq.body.question;

      await chatController.storeQuestionAnswer(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Validation error",
        message: "Both question and answer are required",
        code: "MISSING_REQUIRED_FIELDS",
      });
    });

    it("should return 400 for missing answer", async () => {
      delete mockReq.body.answer;

      await chatController.storeQuestionAnswer(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Validation error",
        message: "Both question and answer are required",
        code: "MISSING_REQUIRED_FIELDS",
      });
    });

    it("should return 400 for empty question", async () => {
      mockReq.body.question = "   ";

      await chatController.storeQuestionAnswer(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Validation error",
        message: "Question cannot be empty",
        code: "EMPTY_QUESTION",
      });
    });

    it("should return 400 for question too long", async () => {
      mockReq.body.question = "a".repeat(501);

      await chatController.storeQuestionAnswer(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Validation error",
        message: "Question is too long (maximum 500 characters)",
        code: "QUESTION_TOO_LONG",
      });
    });

    it("should return 400 for invalid chatId format", async () => {
      mockReq.body.chatId = "invalid-chat-id";

      await chatController.storeQuestionAnswer(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Validation error",
        message: "Invalid chatId format",
        code: "INVALID_CHAT_ID",
      });
    });

    it("should handle cache service errors", async () => {
      mockChatCache.addQuestionAnswer.mockImplementation(() => {
        throw new Error("Cache error");
      });

      await chatController.storeQuestionAnswer(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Internal server error",
        message: "Failed to store question-answer pair",
        details: "Cache error",
        code: "STORAGE_ERROR",
        retryable: true,
      });
    });
  });

  describe("generateLeads", () => {
    beforeEach(() => {
      mockReq.body = {
        chatId: "12345678-1234-4123-8123-123456789012",
      };
    });

    it("should generate leads successfully", async () => {
      const mockSession = {
        chatId: "12345678-1234-4123-8123-123456789012",
        createdAt: new Date(),
        questionAnswers: [
          { question: "Q1", answer: "A1" },
          { question: "Q2", answer: "A2" },
        ],
      };

      const mockLeadResult = {
        message: "Found 5 leads matching your criteria",
        leads: [{ companyName: "ABC Corp", score: 85 }],
        metadata: {
          totalFound: 5,
          processingTime: 1500,
        },
      };

      mockChatCache.getChat.mockReturnValue(mockSession);
      mockLeadGeneration.generateLeads.mockResolvedValue(mockLeadResult);

      await chatController.generateLeads(mockReq, mockRes);

      expect(mockChatCache.getChat).toHaveBeenCalledWith(
        "12345678-1234-4123-8123-123456789012"
      );
      expect(mockLeadGeneration.generateLeads).toHaveBeenCalledWith(
        mockSession.questionAnswers
      );
      expect(mockChatCache.updateLastGeneration).toHaveBeenCalledWith(
        "12345678-1234-4123-8123-123456789012"
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          message: "Found 5 leads matching your criteria",
          leads: expect.any(Array),
          metadata: expect.objectContaining({
            chatId: "12345678-1234-4123-8123-123456789012",
            questionAnswerCount: 2,
          }),
        }),
      });
    });

    it("should return 400 for missing chatId", async () => {
      delete mockReq.body.chatId;

      await chatController.generateLeads(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Validation error",
        message: "chatId is required",
        code: "MISSING_CHAT_ID",
      });
    });

    it("should return 400 for invalid chatId format", async () => {
      mockReq.body.chatId = "invalid-format";

      await chatController.generateLeads(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Validation error",
        message: "Invalid chatId format",
        code: "INVALID_CHAT_ID",
      });
    });

    it("should return 404 for non-existent chat", async () => {
      mockChatCache.getChat.mockReturnValue(null);

      await chatController.generateLeads(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Chat not found",
        message: "Chat session not found or has expired",
        code: "CHAT_NOT_FOUND",
        retryable: false,
      });
    });

    it("should return 400 for empty Q&A data", async () => {
      const mockSession = {
        chatId: "12345678-1234-4123-8123-123456789012",
        questionAnswers: [],
      };

      mockChatCache.getChat.mockReturnValue(mockSession);

      await chatController.generateLeads(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Insufficient data",
        message: "No question-answer pairs found in chat session",
        code: "NO_QA_DATA",
        retryable: false,
      });
    });

    it("should handle lead generation service errors", async () => {
      const mockSession = {
        chatId: "12345678-1234-4123-8123-123456789012",
        questionAnswers: [{ question: "Q1", answer: "A1" }],
      };

      mockChatCache.getChat.mockReturnValue(mockSession);
      mockLeadGeneration.generateLeads.mockRejectedValue(
        new Error("Generation failed")
      );

      await chatController.generateLeads(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Lead generation failed",
        message: "Failed to generate leads from chat history",
        details: "Generation failed",
        code: "GENERATION_ERROR",
        retryable: false,
        metadata: expect.objectContaining({
          chatId: "12345678-1234-4123-8123-123456789012",
        }),
      });
    });
  });

  describe("getChatInfo", () => {
    beforeEach(() => {
      mockReq.params = {
        chatId: "12345678-1234-4123-8123-123456789012",
      };
    });

    it("should return chat information successfully", async () => {
      const mockSession = {
        chatId: "12345678-1234-4123-8123-123456789012",
        createdAt: new Date(),
        lastActivity: new Date(),
        metadata: {
          totalQuestions: 2,
          lastGeneration: new Date(),
        },
        questionAnswers: [
          {
            id: "qa1",
            timestamp: new Date(),
            question: "Q1",
            answer: "A1",
            metadata: { questionType: "industry" },
          },
        ],
      };

      mockChatCache.getChat.mockReturnValue(mockSession);

      await chatController.getChatInfo(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          chatId: "12345678-1234-4123-8123-123456789012",
          questionCount: 2,
          questionAnswers: expect.any(Array),
        }),
      });
    });

    it("should return 404 for non-existent chat", async () => {
      mockChatCache.getChat.mockReturnValue(null);

      await chatController.getChatInfo(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Chat not found",
        message: "Chat session not found or has expired",
        code: "CHAT_NOT_FOUND",
      });
    });
  });

  describe("getHealthStatus", () => {
    it("should return health status successfully", async () => {
      const mockCacheStats = {
        totalSessions: 10,
        activeSessions: 8,
      };

      const mockGenerationStats = {
        totalGenerations: 50,
        successfulGenerations: 45,
        successRate: 90,
      };

      mockChatCache.getChatStats.mockReturnValue(mockCacheStats);
      mockLeadGeneration.getStats.mockReturnValue(mockGenerationStats);

      await chatController.getHealthStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          status: "healthy",
          cache: expect.objectContaining(mockCacheStats),
          leadGeneration: expect.objectContaining(mockGenerationStats),
        }),
      });
    });
  });

  describe("utility methods", () => {
    describe("isValidChatId", () => {
      it("should validate correct UUID v4 format", () => {
        const validId = "12345678-1234-4123-8123-123456789012";
        expect(chatController.isValidChatId(validId)).toBe(true);
      });

      it("should reject invalid formats", () => {
        expect(chatController.isValidChatId("invalid")).toBe(false);
        expect(chatController.isValidChatId("")).toBe(false);
        expect(chatController.isValidChatId(null)).toBe(false);
        expect(chatController.isValidChatId(undefined)).toBe(false);
      });
    });

    describe("determineSessionStatus", () => {
      it('should return "new" for empty session', () => {
        const session = {
          questionAnswers: [],
          lastActivity: new Date(),
        };
        expect(chatController.determineSessionStatus(session)).toBe("new");
      });

      it('should return "gathering" for sessions with few Q&As', () => {
        const session = {
          questionAnswers: [{ question: "Q1", answer: "A1" }],
          lastActivity: new Date(),
        };
        expect(chatController.determineSessionStatus(session)).toBe(
          "gathering"
        );
      });

      it('should return "idle" for inactive sessions', () => {
        const session = {
          questionAnswers: [
            { question: "Q1", answer: "A1" },
            { question: "Q2", answer: "A2" },
            { question: "Q3", answer: "A3" },
          ],
          lastActivity: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        };
        expect(chatController.determineSessionStatus(session)).toBe("idle");
      });

      it('should return "active" for recent active sessions', () => {
        const session = {
          questionAnswers: [
            { question: "Q1", answer: "A1" },
            { question: "Q2", answer: "A2" },
            { question: "Q3", answer: "A3" },
          ],
          lastActivity: new Date(),
        };
        expect(chatController.determineSessionStatus(session)).toBe("active");
      });
    });

    describe("isRetryableError", () => {
      it("should identify retryable errors", () => {
        const retryableError = new Error("Rate limit exceeded");
        expect(chatController.isRetryableError(retryableError)).toBe(true);

        const networkError = new Error("Network timeout");
        expect(chatController.isRetryableError(networkError)).toBe(true);
      });

      it("should identify non-retryable errors", () => {
        const validationError = new Error("Invalid input");
        expect(chatController.isRetryableError(validationError)).toBe(false);
      });
    });
  });
});
