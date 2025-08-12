const request = require("supertest");
const express = require("express");
const leadgenRoutes = require("../leadgenRoutes");

// Mock the controllers to avoid dependencies
jest.mock("../../controllers/ExcelController", () => {
  return jest.fn().mockImplementation(() => ({
    getUploadMiddleware: jest.fn(() => (req, res, next) => next()),
    uploadExcel: jest.fn((req, res) => res.json({ success: true })),
    searchExcel: jest.fn((req, res) => res.json({ success: true })),
    llmQuery: jest.fn((req, res) => res.json({ success: true })),
    getFiles: jest.fn((req, res) => res.json({ success: true })),
    reprocessFile: jest.fn((req, res) => res.json({ success: true })),
    deleteFile: jest.fn((req, res) => res.json({ success: true })),
    findLeads: jest.fn((req, res) => res.json({ success: true })),
    debugApiKey: jest.fn((req, res) => res.json({ success: true })),
    excelService: {
      healthCheck: jest.fn(() => ({ s3Connection: true, bucketAccess: true })),
    },
    getOpenAIHealthStatus: jest.fn(() => ({ status: "healthy" })),
  }));
});

jest.mock("../../controllers/ChatController", () => {
  return jest.fn().mockImplementation(() => ({
    storeQuestionAnswer: jest.fn((req, res) => {
      res.json({
        success: true,
        data: {
          chatId: "test-chat-id",
          messageCount: 1,
          status: "gathering",
          metadata: {
            lastActivity: new Date(),
            totalQuestions: 1,
            sessionAge: 1000,
            questionType: "industry",
          },
        },
      });
    }),
    generateLeads: jest.fn((req, res) => {
      res.json({
        success: true,
        data: {
          message: "Found 5 leads matching your criteria",
          leads: [
            {
              companyName: "ABC Textiles",
              contactPerson: "John Smith",
              email: "john@abc.com",
              phone: "+91-9876543210",
              industry: "Textiles",
              region: "India",
              score: 85,
              matchReason: "Industry and region match",
            },
          ],
          metadata: {
            totalFound: 5,
            processingTime: 1500,
            chatId: "test-chat-id",
            questionAnswerCount: 3,
          },
        },
      });
    }),
    getChatInfo: jest.fn((req, res) => {
      res.json({
        success: true,
        data: {
          chatId: req.params.chatId,
          createdAt: new Date(),
          lastActivity: new Date(),
          questionCount: 2,
          status: "active",
          questionAnswers: [
            {
              id: "qa1",
              timestamp: new Date(),
              question: "What industry are you in?",
              answer: "Textile manufacturing",
              questionType: "industry",
            },
          ],
        },
      });
    }),
    getHealthStatus: jest.fn((req, res) => {
      res.json({
        success: true,
        data: {
          status: "healthy",
          timestamp: new Date(),
          cache: {
            totalSessions: 10,
            activeSessions: 8,
            status: "healthy",
          },
          leadGeneration: {
            totalGenerations: 50,
            successfulGenerations: 45,
            successRate: 90,
            status: "healthy",
          },
          system: {
            uptime: 3600,
            memoryUsage: process.memoryUsage(),
            nodeVersion: process.version,
          },
        },
      });
    }),
    clearExpiredSessions: jest.fn((req, res) => {
      res.json({
        success: true,
        message: "Cleared 3 expired sessions",
        data: {
          clearedSessions: 3,
          remainingSessions: 7,
          timestamp: new Date(),
        },
      });
    }),
  }));
});

describe("Chat Routes Integration Tests", () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/api/leadgen", leadgenRoutes);
  });

  describe("POST /api/leadgen/store-qa", () => {
    it("should store question-answer pair successfully", async () => {
      const response = await request(app).post("/api/leadgen/store-qa").send({
        chatId: "12345678-1234-4123-8123-123456789012",
        question: "What industry are you in?",
        answer: "I am in the textile manufacturing business",
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("chatId");
      expect(response.body.data).toHaveProperty("messageCount");
      expect(response.body.data).toHaveProperty("status");
    });

    it("should work without chatId (auto-generate)", async () => {
      const response = await request(app).post("/api/leadgen/store-qa").send({
        question: "What product do you offer?",
        answer: "We manufacture cotton fabrics",
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.chatId).toBeDefined();
    });

    it("should return 400 for missing question", async () => {
      const response = await request(app).post("/api/leadgen/store-qa").send({
        answer: "Test answer",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Validation error");
    });

    it("should return 400 for missing answer", async () => {
      const response = await request(app).post("/api/leadgen/store-qa").send({
        question: "Test question?",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Validation error");
    });

    it("should return 400 for invalid chatId format", async () => {
      const response = await request(app).post("/api/leadgen/store-qa").send({
        chatId: "invalid-chat-id",
        question: "Test question?",
        answer: "Test answer",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Validation error");
    });

    it("should return 400 for question too long", async () => {
      const response = await request(app)
        .post("/api/leadgen/store-qa")
        .send({
          question: "a".repeat(501),
          answer: "Test answer",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 for answer too long", async () => {
      const response = await request(app)
        .post("/api/leadgen/store-qa")
        .send({
          question: "Test question?",
          answer: "a".repeat(2001),
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /api/leadgen/generate-leads", () => {
    it("should generate leads successfully", async () => {
      const response = await request(app)
        .post("/api/leadgen/generate-leads")
        .send({
          chatId: "12345678-1234-4123-8123-123456789012",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("message");
      expect(response.body.data).toHaveProperty("leads");
      expect(response.body.data).toHaveProperty("metadata");
      expect(Array.isArray(response.body.data.leads)).toBe(true);
    });

    it("should return 400 for missing chatId", async () => {
      const response = await request(app)
        .post("/api/leadgen/generate-leads")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Validation error");
    });

    it("should return 400 for invalid chatId format", async () => {
      const response = await request(app)
        .post("/api/leadgen/generate-leads")
        .send({
          chatId: "invalid-format",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Validation error");
    });
  });

  describe("GET /api/leadgen/chat/:chatId", () => {
    it("should get chat information successfully", async () => {
      const chatId = "12345678-1234-4123-8123-123456789012";
      const response = await request(app).get(`/api/leadgen/chat/${chatId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("chatId", chatId);
      expect(response.body.data).toHaveProperty("questionCount");
      expect(response.body.data).toHaveProperty("questionAnswers");
      expect(Array.isArray(response.body.data.questionAnswers)).toBe(true);
    });
  });

  describe("GET /api/leadgen/chat-health", () => {
    it("should get health status successfully", async () => {
      const response = await request(app).get("/api/leadgen/chat-health");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("status");
      expect(response.body.data).toHaveProperty("cache");
      expect(response.body.data).toHaveProperty("leadGeneration");
      expect(response.body.data).toHaveProperty("system");
    });
  });

  describe("POST /api/leadgen/clear-expired", () => {
    it("should clear expired sessions successfully", async () => {
      const response = await request(app).post("/api/leadgen/clear-expired");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain("Cleared");
      expect(response.body.data).toHaveProperty("clearedSessions");
      expect(response.body.data).toHaveProperty("remainingSessions");
    });
  });

  describe("Route validation middleware", () => {
    it("should validate UUID format for chatId in store-qa", async () => {
      const response = await request(app).post("/api/leadgen/store-qa").send({
        chatId: "not-a-uuid",
        question: "Test question?",
        answer: "Test answer",
      });

      expect(response.status).toBe(400);
      expect(response.body.details).toBeDefined();
      expect(
        response.body.details.some((error) => error.msg.includes("valid UUID"))
      ).toBe(true);
    });

    it("should validate UUID format for chatId in generate-leads", async () => {
      const response = await request(app)
        .post("/api/leadgen/generate-leads")
        .send({
          chatId: "not-a-uuid",
        });

      expect(response.status).toBe(400);
      expect(response.body.details).toBeDefined();
      expect(
        response.body.details.some((error) => error.msg.includes("valid UUID"))
      ).toBe(true);
    });

    it("should validate string length for question", async () => {
      const response = await request(app).post("/api/leadgen/store-qa").send({
        question: "",
        answer: "Test answer",
      });

      expect(response.status).toBe(400);
      expect(response.body.details).toBeDefined();
    });

    it("should validate string length for answer", async () => {
      const response = await request(app).post("/api/leadgen/store-qa").send({
        question: "Test question?",
        answer: "",
      });

      expect(response.status).toBe(400);
      expect(response.body.details).toBeDefined();
    });
  });

  describe("Content-Type validation", () => {
    it("should handle JSON content type correctly", async () => {
      const response = await request(app)
        .post("/api/leadgen/store-qa")
        .set("Content-Type", "application/json")
        .send({
          question: "What industry are you in?",
          answer: "Textile manufacturing",
        });

      expect(response.status).toBe(200);
    });

    it("should handle missing Content-Type gracefully", async () => {
      const response = await request(app).post("/api/leadgen/store-qa").send({
        question: "What industry are you in?",
        answer: "Textile manufacturing",
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Error handling", () => {
    it("should handle malformed JSON gracefully", async () => {
      const response = await request(app)
        .post("/api/leadgen/store-qa")
        .set("Content-Type", "application/json")
        .send('{"invalid": json}');

      expect(response.status).toBe(400);
    });
  });
});
