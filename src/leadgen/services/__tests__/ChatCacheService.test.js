const ChatCacheService = require("../ChatCacheService");

describe("ChatCacheService", () => {
  let chatCache;

  beforeEach(() => {
    chatCache = new ChatCacheService();
    // Clear any existing sessions
    chatCache.clearAll();
  });

  afterEach(() => {
    chatCache.clearAll();
  });

  describe("createChat", () => {
    it("should create a new chat session", () => {
      const chatId = "test-chat-1";
      const session = chatCache.createChat(chatId);

      expect(session).toBeDefined();
      expect(session.chatId).toBe(chatId);
      expect(session.questionAnswers).toEqual([]);
      expect(session.metadata.totalQuestions).toBe(0);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivity).toBeInstanceOf(Date);
    });

    it("should store the session in cache", () => {
      const chatId = "test-chat-2";
      chatCache.createChat(chatId);

      const retrieved = chatCache.getChat(chatId);
      expect(retrieved).toBeDefined();
      expect(retrieved.chatId).toBe(chatId);
    });
  });

  describe("getChat", () => {
    it("should return null for non-existent chat", () => {
      const result = chatCache.getChat("non-existent");
      expect(result).toBeNull();
    });

    it("should return existing chat session", () => {
      const chatId = "test-chat-3";
      chatCache.createChat(chatId);

      const retrieved = chatCache.getChat(chatId);
      expect(retrieved).toBeDefined();
      expect(retrieved.chatId).toBe(chatId);
    });

    it("should return null for expired session", () => {
      const chatId = "test-chat-4";
      const session = chatCache.createChat(chatId);

      // Manually set lastActivity to past TTL
      session.lastActivity = new Date(Date.now() - chatCache.ttl - 1000);
      chatCache.cache.set(chatId, session);

      const retrieved = chatCache.getChat(chatId);
      expect(retrieved).toBeNull();
    });
  });

  describe("addQuestionAnswer", () => {
    it("should add Q&A to existing session", () => {
      const chatId = "test-chat-5";
      chatCache.createChat(chatId);

      const question = "What industry are you in?";
      const answer = "I am in the textile manufacturing business";

      const updatedSession = chatCache.addQuestionAnswer(
        chatId,
        question,
        answer
      );

      expect(updatedSession.questionAnswers).toHaveLength(1);
      expect(updatedSession.questionAnswers[0].question).toBe(question);
      expect(updatedSession.questionAnswers[0].answer).toBe(answer);
      expect(updatedSession.metadata.totalQuestions).toBe(1);
    });

    it("should create new session if chat does not exist", () => {
      const chatId = "test-chat-6";
      const question = "What product do you offer?";
      const answer = "We manufacture cotton fabrics";

      const session = chatCache.addQuestionAnswer(chatId, question, answer);

      expect(session).toBeDefined();
      expect(session.chatId).toBe(chatId);
      expect(session.questionAnswers).toHaveLength(1);
      expect(session.metadata.totalQuestions).toBe(1);
    });

    it("should update lastActivity timestamp", () => {
      const chatId = "test-chat-7";
      const originalSession = chatCache.createChat(chatId);
      const originalTime = originalSession.lastActivity;

      // Wait a bit to ensure timestamp difference
      setTimeout(() => {
        const updatedSession = chatCache.addQuestionAnswer(
          chatId,
          "Test question",
          "Test answer"
        );
        expect(updatedSession.lastActivity.getTime()).toBeGreaterThan(
          originalTime.getTime()
        );
      }, 10);
    });

    it("should classify question types correctly", () => {
      const chatId = "test-chat-8";

      const testCases = [
        { question: "What product do you offer?", expectedType: "product" },
        { question: "Which industry are you in?", expectedType: "industry" },
        { question: "What region do you target?", expectedType: "region" },
        { question: "Any specific keywords?", expectedType: "keywords" },
        { question: "Tell me about yourself", expectedType: "general" },
      ];

      testCases.forEach(({ question, expectedType }) => {
        const session = chatCache.addQuestionAnswer(
          chatId,
          question,
          "Test answer"
        );
        const lastQA =
          session.questionAnswers[session.questionAnswers.length - 1];
        expect(lastQA.metadata.questionType).toBe(expectedType);
      });
    });
  });

  describe("cleanup", () => {
    it("should remove expired sessions", () => {
      const chatId1 = "test-chat-9";
      const chatId2 = "test-chat-10";

      const session1 = chatCache.createChat(chatId1);
      const session2 = chatCache.createChat(chatId2);

      // Make session1 expired
      session1.lastActivity = new Date(Date.now() - chatCache.ttl - 1000);
      chatCache.cache.set(chatId1, session1);

      // Run cleanup
      chatCache.cleanup();

      expect(chatCache.getChat(chatId1)).toBeNull();
      expect(chatCache.getChat(chatId2)).toBeDefined();
    });

    it("should not remove active sessions", () => {
      const chatId = "test-chat-11";
      chatCache.createChat(chatId);

      chatCache.cleanup();

      expect(chatCache.getChat(chatId)).toBeDefined();
    });
  });

  describe("getChatStats", () => {
    it("should return correct statistics", () => {
      const chatId1 = "test-chat-12";
      const chatId2 = "test-chat-13";

      chatCache.createChat(chatId1);
      chatCache.addQuestionAnswer(chatId1, "Question 1", "Answer 1");
      chatCache.addQuestionAnswer(chatId1, "Question 2", "Answer 2");

      chatCache.createChat(chatId2);
      chatCache.addQuestionAnswer(chatId2, "Question 3", "Answer 3");

      const stats = chatCache.getChatStats();

      expect(stats.totalSessions).toBe(2);
      expect(stats.activeSessions).toBe(2);
      expect(stats.totalQuestionAnswers).toBe(3);
      expect(stats.memoryUsage.total).toBeGreaterThan(0);
    });
  });

  describe("getActiveSessions", () => {
    it("should return only active session IDs", () => {
      const chatId1 = "test-chat-14";
      const chatId2 = "test-chat-15";

      const session1 = chatCache.createChat(chatId1);
      chatCache.createChat(chatId2);

      // Make session1 expired
      session1.lastActivity = new Date(Date.now() - chatCache.ttl - 1000);
      chatCache.cache.set(chatId1, session1);

      const activeSessions = chatCache.getActiveSessions();

      expect(activeSessions).toHaveLength(1);
      expect(activeSessions).toContain(chatId2);
      expect(activeSessions).not.toContain(chatId1);
    });
  });

  describe("updateLastGeneration", () => {
    it("should update lastGeneration timestamp", () => {
      const chatId = "test-chat-16";
      chatCache.createChat(chatId);

      chatCache.updateLastGeneration(chatId);

      const session = chatCache.getChat(chatId);
      expect(session.metadata.lastGeneration).toBeInstanceOf(Date);
    });

    it("should handle non-existent session gracefully", () => {
      expect(() => {
        chatCache.updateLastGeneration("non-existent");
      }).not.toThrow();
    });
  });
});
