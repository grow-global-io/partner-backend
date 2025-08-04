/**
 * @description Chat cache service for managing chat sessions with TTL
 * @class ChatCacheService
 */
class ChatCacheService {
  constructor() {
    this.cache = new Map();
    this.ttl = 60 * 60 * 1000; // 1 hour in milliseconds
    this.cleanupInterval = 5 * 60 * 1000; // 5 minutes
    this.startCleanupTimer();
  }

  /**
   * @description Create new chat session with empty question-answer history
   * @param {string} chatId - Unique chat identifier
   * @returns {Object} ChatSession object
   */
  createChat(chatId) {
    const session = {
      chatId,
      createdAt: new Date(),
      lastActivity: new Date(),
      questionAnswers: [],
      metadata: {
        totalQuestions: 0,
        lastGeneration: null,
      },
    };

    this.cache.set(chatId, session);
    console.log(`ChatCacheService: Created new chat session ${chatId}`);
    return session;
  }

  /**
   * @description Retrieve existing chat session
   * @param {string} chatId - Chat identifier
   * @returns {Object|null} ChatSession or null if not found
   */
  getChat(chatId) {
    const session = this.cache.get(chatId);
    if (!session) {
      return null;
    }

    // Check if session has expired
    const now = new Date();
    const timeSinceLastActivity = now - session.lastActivity;

    if (timeSinceLastActivity > this.ttl) {
      this.cache.delete(chatId);
      console.log(`ChatCacheService: Session ${chatId} expired and removed`);
      return null;
    }

    return session;
  }

  /**
   * @description Add question-answer pair to chat history
   * @param {string} chatId - Chat identifier
   * @param {string} question - Predefined question from frontend
   * @param {string} answer - User's varied answer
   * @returns {Object} Updated session
   */
  addQuestionAnswer(chatId, question, answer) {
    let session = this.getChat(chatId);

    if (!session) {
      session = this.createChat(chatId);
    }

    const questionAnswer = {
      id: `qa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      question: question.trim(),
      answer: answer.trim(),
      metadata: {
        questionType: this.classifyQuestion(question),
        answerLength: answer.trim().length,
      },
    };

    session.questionAnswers.push(questionAnswer);
    session.lastActivity = new Date();
    session.metadata.totalQuestions = session.questionAnswers.length;

    this.cache.set(chatId, session);

    console.log(
      `ChatCacheService: Added Q&A to session ${chatId}, total: ${session.metadata.totalQuestions}`
    );
    return session;
  }

  /**
   * @description Classify question type for metadata
   * @param {string} question - Question text
   * @returns {string} Question category
   * @private
   */
  classifyQuestion(question) {
    const lowerQuestion = question.toLowerCase();

    if (
      lowerQuestion.includes("product") ||
      lowerQuestion.includes("service")
    ) {
      return "product";
    }
    if (
      lowerQuestion.includes("industry") ||
      lowerQuestion.includes("business")
    ) {
      return "industry";
    }
    if (
      lowerQuestion.includes("region") ||
      lowerQuestion.includes("country") ||
      lowerQuestion.includes("location")
    ) {
      return "region";
    }
    if (
      lowerQuestion.includes("keyword") ||
      lowerQuestion.includes("specific")
    ) {
      return "keywords";
    }

    return "general";
  }

  /**
   * @description Update last generation timestamp
   * @param {string} chatId - Chat identifier
   */
  updateLastGeneration(chatId) {
    const session = this.getChat(chatId);
    if (session) {
      session.metadata.lastGeneration = new Date();
      this.cache.set(chatId, session);
    }
  }

  /**
   * @description Remove expired chat sessions
   * Called automatically every 5 minutes
   */
  cleanup() {
    const now = new Date();
    let removedCount = 0;

    for (const [chatId, session] of this.cache.entries()) {
      const timeSinceLastActivity = now - session.lastActivity;

      if (timeSinceLastActivity > this.ttl) {
        this.cache.delete(chatId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(
        `ChatCacheService: Cleaned up ${removedCount} expired sessions`
      );
    }
  }

  /**
   * @description Start automatic cleanup timer
   * @private
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);

    console.log(
      `ChatCacheService: Started cleanup timer (${
        this.cleanupInterval / 1000
      }s interval)`
    );
  }

  /**
   * @description Return cache statistics for monitoring
   * @returns {Object} Cache statistics
   */
  getChatStats() {
    const sessions = Array.from(this.cache.values());
    const now = new Date();

    const activeSessions = sessions.filter(
      (session) => now - session.lastActivity <= this.ttl
    );

    const totalQuestionAnswers = sessions.reduce(
      (total, session) => total + session.questionAnswers.length,
      0
    );

    const averageSessionDuration =
      sessions.length > 0
        ? sessions.reduce(
            (total, session) =>
              total + (session.lastActivity - session.createdAt),
            0
          ) /
          sessions.length /
          (1000 * 60) // Convert to minutes
        : 0;

    // Estimate memory usage (rough calculation)
    const sessionMemory = sessions.length * 200; // Base session object
    const qaMemory = totalQuestionAnswers * 500; // Average Q&A pair size
    const totalMemory = sessionMemory + qaMemory;

    return {
      totalSessions: sessions.length,
      activeSessions: activeSessions.length,
      expiredSessions: sessions.length - activeSessions.length,
      averageSessionDuration: Math.round(averageSessionDuration),
      totalQuestionAnswers,
      memoryUsage: {
        sessions: sessionMemory,
        questionAnswers: qaMemory,
        total: totalMemory,
      },
      performance: {
        averageGenerationTime: 0, // Will be updated by LeadGenerationService
        successfulGenerations: 0,
        failedGenerations: 0,
      },
      lastCleanup: new Date(),
    };
  }

  /**
   * @description Get all active session IDs (for debugging)
   * @returns {Array<string>} Array of active chat IDs
   */
  getActiveSessions() {
    const now = new Date();
    const activeSessions = [];

    for (const [chatId, session] of this.cache.entries()) {
      const timeSinceLastActivity = now - session.lastActivity;
      if (timeSinceLastActivity <= this.ttl) {
        activeSessions.push(chatId);
      }
    }

    return activeSessions;
  }

  /**
   * @description Clear all sessions (for testing)
   */
  clearAll() {
    this.cache.clear();
    console.log("ChatCacheService: Cleared all sessions");
  }
}

module.exports = ChatCacheService;
