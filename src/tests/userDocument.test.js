/**
 * @fileoverview Test suite for UserDocument CRUD operations
 * @description Comprehensive tests following TDD principles for user document management
 * @author AI Assistant
 */

const request = require("supertest");
const { PrismaClient } = require("@prisma/client");
const express = require("express");

const prisma = new PrismaClient();
const app = express();

// Mock data for testing
const mockUserDocument = {
  walletId: "test_wallet_123",
  totalDocumentsCapacity: 3,
  documentsUsed: 0,
  isFreeTier: true,
};

const mockUserDocumentUpdate = {
  totalDocumentsCapacity: 10,
  documentsUsed: 2,
  isFreeTier: false,
};

describe("UserDocument CRUD Operations", () => {
  let createdUserDocumentId;

  beforeAll(async () => {
    // Setup test database connection
    await prisma.$connect();
  });

  afterAll(async () => {
    // Cleanup test data and close connection
    if (createdUserDocumentId) {
      await prisma.userDocument.delete({
        where: { id: createdUserDocumentId },
      });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    // Reset test data before each test
    createdUserDocumentId = null;
  });

  describe("POST /api/user-documents", () => {
    test("should create a new user document with valid data", async () => {
      const response = await request(app)
        .post("/api/user-documents")
        .send(mockUserDocument)
        .expect(201);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
      expect(response.body.data).toHaveProperty("id");
      expect(response.body.data.walletId).toBe(mockUserDocument.walletId);
      expect(response.body.data.totalDocumentsCapacity).toBe(3);
      expect(response.body.data.isFreeTier).toBe(true);

      createdUserDocumentId = response.body.data.id;
    });

    test("should return 400 for duplicate walletId", async () => {
      // First create a user document
      const firstResponse = await request(app)
        .post("/api/user-documents")
        .send(mockUserDocument)
        .expect(201);

      createdUserDocumentId = firstResponse.body.data.id;

      // Try to create another with same walletId
      const response = await request(app)
        .post("/api/user-documents")
        .send(mockUserDocument)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("walletId already exists");
    });

    test("should return 400 for missing required fields", async () => {
      const invalidData = {
        totalDocumentsCapacity: 5,
        // Missing walletId
      };

      const response = await request(app)
        .post("/api/user-documents")
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /api/user-documents", () => {
    beforeEach(async () => {
      // Create test data for GET operations
      const response = await request(app)
        .post("/api/user-documents")
        .send(mockUserDocument);
      createdUserDocumentId = response.body.data.id;
    });

    test("should retrieve all user documents", async () => {
      const response = await request(app)
        .get("/api/user-documents")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    test("should retrieve user document by walletId", async () => {
      const response = await request(app)
        .get(`/api/user-documents/wallet/${mockUserDocument.walletId}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.walletId).toBe(mockUserDocument.walletId);
    });

    test("should return 404 for non-existent walletId", async () => {
      const response = await request(app)
        .get("/api/user-documents/wallet/non_existent_wallet")
        .expect(404);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("PUT /api/user-documents/:id", () => {
    beforeEach(async () => {
      // Create test data for PUT operations
      const response = await request(app)
        .post("/api/user-documents")
        .send(mockUserDocument);
      createdUserDocumentId = response.body.data.id;
    });

    test("should update user document with valid data", async () => {
      const response = await request(app)
        .put(`/api/user-documents/${createdUserDocumentId}`)
        .send(mockUserDocumentUpdate)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.totalDocumentsCapacity).toBe(10);
      expect(response.body.data.documentsUsed).toBe(2);
      expect(response.body.data.isFreeTier).toBe(false);
    });

    test("should return 404 for non-existent user document", async () => {
      const nonExistentId = "507f1f77bcf86cd799439011";

      const response = await request(app)
        .put(`/api/user-documents/${nonExistentId}`)
        .send(mockUserDocumentUpdate)
        .expect(404);

      expect(response.body).toHaveProperty("success", false);
    });

    test("should return 400 for invalid ObjectId", async () => {
      const response = await request(app)
        .put("/api/user-documents/invalid_id")
        .send(mockUserDocumentUpdate)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body.error).toContain("Invalid ID format");
    });
  });

  describe("DELETE /api/user-documents/:id", () => {
    beforeEach(async () => {
      // Create test data for DELETE operations
      const response = await request(app)
        .post("/api/user-documents")
        .send(mockUserDocument);
      createdUserDocumentId = response.body.data.id;
    });

    test("should delete user document successfully", async () => {
      const response = await request(app)
        .delete(`/api/user-documents/${createdUserDocumentId}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty(
        "message",
        "User document deleted successfully"
      );

      // Verify deletion
      const getResponse = await request(app)
        .get(`/api/user-documents/${createdUserDocumentId}`)
        .expect(404);

      createdUserDocumentId = null; // Reset since it's deleted
    });

    test("should return 404 for non-existent user document", async () => {
      const nonExistentId = "507f1f77bcf86cd799439011";

      const response = await request(app)
        .delete(`/api/user-documents/${nonExistentId}`)
        .expect(404);

      expect(response.body).toHaveProperty("success", false);
    });
  });

  describe("POST /api/user-documents/:id/upgrade-plan", () => {
    beforeEach(async () => {
      // Create test data for plan upgrade operations
      const response = await request(app)
        .post("/api/user-documents")
        .send(mockUserDocument);
      createdUserDocumentId = response.body.data.id;
    });

    test("should upgrade user plan successfully", async () => {
      const planUpgradeData = {
        planId: "basic_plan_id",
        subscriptionMonths: 1,
      };

      const response = await request(app)
        .post(`/api/user-documents/${createdUserDocumentId}/upgrade-plan`)
        .send(planUpgradeData)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.isFreeTier).toBe(false);
      expect(response.body.data).toHaveProperty("subscriptionStartDate");
      expect(response.body.data).toHaveProperty("subscriptionEndDate");
    });

    test("should return 400 for invalid plan upgrade data", async () => {
      const invalidPlanData = {
        // Missing required fields
      };

      const response = await request(app)
        .post(`/api/user-documents/${createdUserDocumentId}/upgrade-plan`)
        .send(invalidPlanData)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
    });
  });

  describe("GET /api/user-documents/:walletId/usage", () => {
    beforeEach(async () => {
      // Create test data with some usage
      const testData = {
        ...mockUserDocument,
        documentsUsed: 2,
      };
      const response = await request(app)
        .post("/api/user-documents")
        .send(testData);
      createdUserDocumentId = response.body.data.id;
    });

    test("should retrieve user document usage stats", async () => {
      const response = await request(app)
        .get(`/api/user-documents/${mockUserDocument.walletId}/usage`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("documentsUsed");
      expect(response.body.data).toHaveProperty("totalDocumentsCapacity");
      expect(response.body.data).toHaveProperty("remainingDocuments");
      expect(response.body.data).toHaveProperty("usagePercentage");
    });
  });
});
