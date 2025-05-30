/**
 * @fileoverview Test suite for PricingPlan CRUD operations
 * @description Comprehensive tests following TDD principles for pricing plan management
 * @author AI Assistant
 */

const request = require("supertest");
const { PrismaClient } = require("@prisma/client");
const express = require("express");

const prisma = new PrismaClient();
const app = express();

// Mock data for testing
const mockPricingPlans = {
  free: {
    planName: "Free",
    description: "Free tier with 3 PDF documents",
    price: 0,
    pdfLimit: 3,
    planType: "free",
    features: ["3 PDF documents", "Basic support"],
  },
  basic: {
    planName: "Basic",
    description: "Basic plan with 10 PDF documents for $3",
    price: 3,
    pdfLimit: 10,
    planType: "paid",
    features: ["10 PDF documents", "Email support", "Basic analytics"],
  },
  standard: {
    planName: "Standard",
    description: "Standard plan with 20 PDF documents for $5",
    price: 5,
    pdfLimit: 20,
    planType: "paid",
    features: [
      "20 PDF documents",
      "Priority support",
      "Advanced analytics",
      "API access",
    ],
  },
  premium: {
    planName: "Premium",
    description: "Premium plan with 40 PDF documents for $10",
    price: 10,
    pdfLimit: 40,
    planType: "paid",
    features: [
      "40 PDF documents",
      "24/7 support",
      "Advanced analytics",
      "API access",
      "Custom integrations",
    ],
  },
};

const mockPlanUpdate = {
  description: "Updated description for the plan",
  price: 4,
  features: ["Updated feature 1", "Updated feature 2"],
};

describe("PricingPlan CRUD Operations", () => {
  let createdPlanIds = [];

  beforeAll(async () => {
    // Setup test database connection
    await prisma.$connect();
  });

  afterAll(async () => {
    // Cleanup test data and close connection
    if (createdPlanIds.length > 0) {
      await prisma.pricingPlan.deleteMany({
        where: {
          id: { in: createdPlanIds },
        },
      });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    // Reset test data before each test
    createdPlanIds = [];
  });

  describe("POST /api/pricing-plans", () => {
    test("should create a new pricing plan with valid data", async () => {
      const response = await request(app)
        .post("/api/pricing-plans")
        .send(mockPricingPlans.basic)
        .expect(201);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
      expect(response.body.data).toHaveProperty("id");
      expect(response.body.data.planName).toBe(mockPricingPlans.basic.planName);
      expect(response.body.data.price).toBe(mockPricingPlans.basic.price);
      expect(response.body.data.pdfLimit).toBe(mockPricingPlans.basic.pdfLimit);
      expect(response.body.data.planType).toBe("paid");
      expect(response.body.data.isActive).toBe(true);

      createdPlanIds.push(response.body.data.id);
    });

    test("should create all default pricing plans successfully", async () => {
      const planKeys = Object.keys(mockPricingPlans);

      for (const key of planKeys) {
        const response = await request(app)
          .post("/api/pricing-plans")
          .send(mockPricingPlans[key])
          .expect(201);

        expect(response.body.success).toBe(true);
        expect(response.body.data.planName).toBe(
          mockPricingPlans[key].planName
        );
        createdPlanIds.push(response.body.data.id);
      }
    });

    test("should return 400 for duplicate plan name", async () => {
      // First create a pricing plan
      const firstResponse = await request(app)
        .post("/api/pricing-plans")
        .send(mockPricingPlans.basic)
        .expect(201);

      createdPlanIds.push(firstResponse.body.data.id);

      // Try to create another with same plan name
      const response = await request(app)
        .post("/api/pricing-plans")
        .send(mockPricingPlans.basic)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("Plan name already exists");
    });

    test("should return 400 for missing required fields", async () => {
      const invalidData = {
        price: 5,
        pdfLimit: 10,
        // Missing planName and description
      };

      const response = await request(app)
        .post("/api/pricing-plans")
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body).toHaveProperty("error");
    });

    test("should return 400 for negative price", async () => {
      const invalidData = {
        ...mockPricingPlans.basic,
        price: -1,
      };

      const response = await request(app)
        .post("/api/pricing-plans")
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body.error).toContain("Price must be non-negative");
    });

    test("should return 400 for invalid PDF limit", async () => {
      const invalidData = {
        ...mockPricingPlans.basic,
        pdfLimit: 0,
      };

      const response = await request(app)
        .post("/api/pricing-plans")
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body.error).toContain("PDF limit must be greater than 0");
    });
  });

  describe("GET /api/pricing-plans", () => {
    beforeEach(async () => {
      // Create test data for GET operations
      const response = await request(app)
        .post("/api/pricing-plans")
        .send(mockPricingPlans.basic);
      createdPlanIds.push(response.body.data.id);
    });

    test("should retrieve all pricing plans", async () => {
      const response = await request(app).get("/api/pricing-plans").expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    test("should retrieve only active pricing plans", async () => {
      const response = await request(app)
        .get("/api/pricing-plans?active=true")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      response.body.data.forEach((plan) => {
        expect(plan.isActive).toBe(true);
      });
    });

    test("should retrieve plans by type", async () => {
      const response = await request(app)
        .get("/api/pricing-plans?type=paid")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(Array.isArray(response.body.data)).toBe(true);
      response.body.data.forEach((plan) => {
        expect(plan.planType).toBe("paid");
      });
    });

    test("should retrieve pricing plan by ID", async () => {
      const planId = createdPlanIds[0];

      const response = await request(app)
        .get(`/api/pricing-plans/${planId}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.id).toBe(planId);
    });

    test("should return 404 for non-existent plan ID", async () => {
      const nonExistentId = "507f1f77bcf86cd799439011";

      const response = await request(app)
        .get(`/api/pricing-plans/${nonExistentId}`)
        .expect(404);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("PUT /api/pricing-plans/:id", () => {
    beforeEach(async () => {
      // Create test data for PUT operations
      const response = await request(app)
        .post("/api/pricing-plans")
        .send(mockPricingPlans.basic);
      createdPlanIds.push(response.body.data.id);
    });

    test("should update pricing plan with valid data", async () => {
      const planId = createdPlanIds[0];

      const response = await request(app)
        .put(`/api/pricing-plans/${planId}`)
        .send(mockPlanUpdate)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data.description).toBe(mockPlanUpdate.description);
      expect(response.body.data.price).toBe(mockPlanUpdate.price);
      expect(response.body.data.features).toEqual(mockPlanUpdate.features);
    });

    test("should return 404 for non-existent pricing plan", async () => {
      const nonExistentId = "507f1f77bcf86cd799439011";

      const response = await request(app)
        .put(`/api/pricing-plans/${nonExistentId}`)
        .send(mockPlanUpdate)
        .expect(404);

      expect(response.body).toHaveProperty("success", false);
    });

    test("should return 400 for invalid ObjectId", async () => {
      const response = await request(app)
        .put("/api/pricing-plans/invalid_id")
        .send(mockPlanUpdate)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body.error).toContain("Invalid ID format");
    });

    test("should return 400 for invalid price update", async () => {
      const planId = createdPlanIds[0];
      const invalidUpdate = {
        ...mockPlanUpdate,
        price: -5,
      };

      const response = await request(app)
        .put(`/api/pricing-plans/${planId}`)
        .send(invalidUpdate)
        .expect(400);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body.error).toContain("Price must be non-negative");
    });
  });

  describe("DELETE /api/pricing-plans/:id", () => {
    beforeEach(async () => {
      // Create test data for DELETE operations
      const response = await request(app)
        .post("/api/pricing-plans")
        .send(mockPricingPlans.basic);
      createdPlanIds.push(response.body.data.id);
    });

    test("should soft delete pricing plan successfully", async () => {
      const planId = createdPlanIds[0];

      const response = await request(app)
        .delete(`/api/pricing-plans/${planId}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty(
        "message",
        "Pricing plan deactivated successfully"
      );

      // Verify soft deletion (plan should be inactive but still exist)
      const getResponse = await request(app)
        .get(`/api/pricing-plans/${planId}`)
        .expect(200);

      expect(getResponse.body.data.isActive).toBe(false);
    });

    test("should return 404 for non-existent pricing plan", async () => {
      const nonExistentId = "507f1f77bcf86cd799439011";

      const response = await request(app)
        .delete(`/api/pricing-plans/${nonExistentId}`)
        .expect(404);

      expect(response.body).toHaveProperty("success", false);
    });
  });

  describe("POST /api/pricing-plans/initialize-default", () => {
    test("should initialize default pricing plans", async () => {
      const response = await request(app)
        .post("/api/pricing-plans/initialize-default")
        .expect(201);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty(
        "message",
        "Default pricing plans created successfully"
      );
      expect(response.body.data).toHaveProperty("created");
      expect(response.body.data.created).toBeGreaterThanOrEqual(4); // Should create 4 default plans

      // Store created plan IDs for cleanup
      if (response.body.data.planIds) {
        createdPlanIds.push(...response.body.data.planIds);
      }
    });

    test("should handle existing plans gracefully", async () => {
      // First, create default plans
      await request(app)
        .post("/api/pricing-plans/initialize-default")
        .expect(201);

      // Try to create again
      const response = await request(app)
        .post("/api/pricing-plans/initialize-default")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toContain("already exist");
    });
  });

  describe("GET /api/pricing-plans/recommended/:walletId", () => {
    beforeEach(async () => {
      // Create default plans for recommendation testing
      await request(app).post("/api/pricing-plans/initialize-default");
    });

    test("should recommend appropriate plan based on usage", async () => {
      const walletId = "test_wallet_for_recommendation";

      const response = await request(app)
        .get(`/api/pricing-plans/recommended/${walletId}`)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("recommendedPlan");
      expect(response.body.data).toHaveProperty("reason");
      expect(response.body.data.recommendedPlan).toHaveProperty("planName");
      expect(response.body.data.recommendedPlan).toHaveProperty("price");
    });
  });
});
