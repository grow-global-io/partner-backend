/**
 * @fileoverview User Document CRUD Routes
 * @description API routes for managing user documents, capacity, and subscription management
 * @author AI Assistant
 */

const express = require("express");
const { PrismaClient } = require("@prisma/client");
const router = express.Router();

const prisma = new PrismaClient();

/**
 * @description Validate ObjectId format
 * @param {string} id - ObjectId to validate
 * @returns {boolean} - True if valid ObjectId format
 */
const isValidObjectId = (id) => {
  return /^[0-9a-fA-F]{24}$/.test(id);
};

/**
 * @description Validate user document input data
 * @param {Object} data - User document data
 * @returns {Object} - Validation result with isValid boolean and error message
 */
const validateUserDocumentData = (data) => {
  const errors = [];

  if (!data.walletId || typeof data.walletId !== "string") {
    errors.push("walletId is required and must be a string");
  }

  if (
    data.totalDocumentsCapacity !== undefined &&
    (!Number.isInteger(data.totalDocumentsCapacity) ||
      data.totalDocumentsCapacity < 0)
  ) {
    errors.push("totalDocumentsCapacity must be a non-negative integer");
  }

  if (
    data.documentsUsed !== undefined &&
    (!Number.isInteger(data.documentsUsed) || data.documentsUsed < 0)
  ) {
    errors.push("documentsUsed must be a non-negative integer");
  }

  if (
    data.documentsUsed &&
    data.totalDocumentsCapacity &&
    data.documentsUsed > data.totalDocumentsCapacity
  ) {
    errors.push("documentsUsed cannot exceed totalDocumentsCapacity");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * @route POST /api/user-documents
 * @description Create a new user document record
 * @access Public
 */
router.post("/", async (req, res) => {
  try {
    const validation = validateUserDocumentData(req.body);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(", "),
      });
    }

    // Check if walletId already exists
    const existingDocument = await prisma.userDocument.findUnique({
      where: { walletId: req.body.walletId },
    });

    if (existingDocument) {
      return res.status(400).json({
        success: false,
        error: "walletId already exists",
      });
    }

    const userDocument = await prisma.userDocument.create({
      data: {
        walletId: req.body.walletId,
        totalDocumentsCapacity: req.body.totalDocumentsCapacity || 3,
        documentsUsed: req.body.documentsUsed || 0,
        isFreeTier:
          req.body.isFreeTier !== undefined ? req.body.isFreeTier : true,
        currentPlanId: req.body.currentPlanId || null,
      },
      include: {
        currentPlan: true,
      },
    });

    res.status(201).json({
      success: true,
      message: "User document created successfully",
      data: userDocument,
    });
  } catch (error) {
    console.error("Error creating user document:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route GET /api/user-documents
 * @description Get all user documents with optional filtering
 * @access Public
 */
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 10, isFreeTier, walletId } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {};

    if (isFreeTier !== undefined) {
      where.isFreeTier = isFreeTier === "true";
    }

    if (walletId) {
      where.walletId = { contains: walletId };
    }

    const [userDocuments, totalCount] = await prisma.$transaction([
      prisma.userDocument.findMany({
        where,
        skip,
        take,
        include: {
          currentPlan: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.userDocument.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: userDocuments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching user documents:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route GET /api/user-documents/:id
 * @description Get user document by ID
 * @access Public
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format",
      });
    }

    const userDocument = await prisma.userDocument.findUnique({
      where: { id },
      include: {
        currentPlan: true,
      },
    });

    if (!userDocument) {
      return res.status(404).json({
        success: false,
        error: "User document not found",
      });
    }

    res.status(200).json({
      success: true,
      data: userDocument,
    });
  } catch (error) {
    console.error("Error fetching user document:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route GET /api/user-documents/wallet/:walletId
 * @description Get user document by wallet ID
 * @access Public
 */
router.get("/wallet/:walletId", async (req, res) => {
  try {
    const { walletId } = req.params;

    const userDocument = await prisma.userDocument.findUnique({
      where: { walletId },
      include: {
        currentPlan: true,
      },
    });

    if (!userDocument) {
      return res.status(404).json({
        success: false,
        error: "User document not found for this wallet ID",
      });
    }

    res.status(200).json({
      success: true,
      data: userDocument,
    });
  } catch (error) {
    console.error("Error fetching user document by wallet ID:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route PUT /api/user-documents/:id
 * @description Update user document by ID
 * @access Public
 */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format",
      });
    }

    // Validate update data (exclude walletId from updates)
    const updateData = { ...req.body };
    delete updateData.walletId; // Prevent walletId updates

    const validation = validateUserDocumentData({
      walletId: "dummy",
      ...updateData,
    });

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(", "),
      });
    }

    const existingDocument = await prisma.userDocument.findUnique({
      where: { id },
    });

    if (!existingDocument) {
      return res.status(404).json({
        success: false,
        error: "User document not found",
      });
    }

    const userDocument = await prisma.userDocument.update({
      where: { id },
      data: updateData,
      include: {
        currentPlan: true,
      },
    });

    res.status(200).json({
      success: true,
      message: "User document updated successfully",
      data: userDocument,
    });
  } catch (error) {
    console.error("Error updating user document:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route DELETE /api/user-documents/:id
 * @description Delete user document by ID
 * @access Public
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format",
      });
    }

    const existingDocument = await prisma.userDocument.findUnique({
      where: { id },
    });

    if (!existingDocument) {
      return res.status(404).json({
        success: false,
        error: "User document not found",
      });
    }

    await prisma.userDocument.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: "User document deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting user document:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route POST /api/user-documents/:id/upgrade-plan
 * @description Upgrade user's plan
 * @access Public
 */
router.post("/:id/upgrade-plan", async (req, res) => {
  try {
    const { id } = req.params;
    const { planId, subscriptionMonths = 1 } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format",
      });
    }

    if (!planId || !isValidObjectId(planId)) {
      return res.status(400).json({
        success: false,
        error: "Valid planId is required",
      });
    }

    // Check if user document exists
    const existingDocument = await prisma.userDocument.findUnique({
      where: { id },
    });

    if (!existingDocument) {
      return res.status(404).json({
        success: false,
        error: "User document not found",
      });
    }

    // Check if plan exists
    const plan = await prisma.pricingPlan.findUnique({
      where: { id: planId },
    });

    if (!plan || !plan.isActive) {
      return res.status(400).json({
        success: false,
        error: "Invalid or inactive plan",
      });
    }

    // Calculate subscription dates
    const subscriptionStartDate = new Date();
    const subscriptionEndDate = new Date();
    subscriptionEndDate.setMonth(
      subscriptionEndDate.getMonth() + parseInt(subscriptionMonths)
    );

    const userDocument = await prisma.userDocument.update({
      where: { id },
      data: {
        currentPlanId: planId,
        totalDocumentsCapacity: plan.pdfLimit,
        isFreeTier: plan.planType === "free",
        subscriptionStartDate,
        subscriptionEndDate,
      },
      include: {
        currentPlan: true,
      },
    });

    res.status(200).json({
      success: true,
      message: "Plan upgraded successfully",
      data: userDocument,
    });
  } catch (error) {
    console.error("Error upgrading plan:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route GET /api/user-documents/:walletId/usage
 * @description Get user document usage statistics
 * @access Public
 */
router.get("/:walletId/usage", async (req, res) => {
  try {
    const { walletId } = req.params;

    const userDocument = await prisma.userDocument.findUnique({
      where: { walletId },
      include: {
        currentPlan: true,
      },
    });

    if (!userDocument) {
      return res.status(404).json({
        success: false,
        error: "User document not found for this wallet ID",
      });
    }

    const remainingDocuments =
      userDocument.totalDocumentsCapacity - userDocument.documentsUsed;
    const usagePercentage = Math.round(
      (userDocument.documentsUsed / userDocument.totalDocumentsCapacity) * 100
    );

    // Check if subscription is expired
    const isSubscriptionExpired =
      userDocument.subscriptionEndDate &&
      new Date() > userDocument.subscriptionEndDate;

    res.status(200).json({
      success: true,
      data: {
        walletId: userDocument.walletId,
        documentsUsed: userDocument.documentsUsed,
        totalDocumentsCapacity: userDocument.totalDocumentsCapacity,
        remainingDocuments,
        usagePercentage,
        isFreeTier: userDocument.isFreeTier,
        currentPlan: userDocument.currentPlan,
        subscriptionStatus: {
          isExpired: isSubscriptionExpired,
          startDate: userDocument.subscriptionStartDate,
          endDate: userDocument.subscriptionEndDate,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching usage statistics:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route POST /api/user-documents/:walletId/increment-usage
 * @description Increment document usage for a user
 * @access Public
 */
router.post("/:walletId/increment-usage", async (req, res) => {
  try {
    const { walletId } = req.params;
    const { increment = 1 } = req.body;

    if (!Number.isInteger(increment) || increment < 1) {
      return res.status(400).json({
        success: false,
        error: "Increment must be a positive integer",
      });
    }

    const userDocument = await prisma.userDocument.findUnique({
      where: { walletId },
    });

    if (!userDocument) {
      return res.status(404).json({
        success: false,
        error: "User document not found for this wallet ID",
      });
    }

    // Check if user has enough capacity
    const newUsage = userDocument.documentsUsed + increment;
    if (newUsage > userDocument.totalDocumentsCapacity) {
      return res.status(400).json({
        success: false,
        error:
          "Document usage would exceed capacity. Please upgrade your plan.",
        data: {
          currentUsage: userDocument.documentsUsed,
          capacity: userDocument.totalDocumentsCapacity,
          attemptedIncrement: increment,
        },
      });
    }

    const updatedDocument = await prisma.userDocument.update({
      where: { walletId },
      data: {
        documentsUsed: newUsage,
      },
      include: {
        currentPlan: true,
      },
    });

    res.status(200).json({
      success: true,
      message: "Document usage updated successfully",
      data: updatedDocument,
    });
  } catch (error) {
    console.error("Error incrementing usage:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

module.exports = router;
