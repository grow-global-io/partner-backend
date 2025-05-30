/**
 * @fileoverview Pricing Plan CRUD Routes
 * @description API routes for managing pricing plans and subscription models
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
 * @description Default pricing plans configuration
 */
const DEFAULT_PRICING_PLANS = [
  {
    planName: "Free",
    description: "Free tier with 3 PDF documents - perfect for getting started",
    price: 0,
    pdfLimit: 3,
    planType: "free",
    features: [
      "3 PDF documents",
      "Basic support",
      "Standard processing speed",
      "Basic document analysis",
    ],
  },
  {
    planName: "Basic",
    description:
      "Basic plan with 10 PDF documents for $3 - ideal for personal use",
    price: 3,
    pdfLimit: 10,
    planType: "paid",
    features: [
      "10 PDF documents",
      "Email support",
      "Fast processing speed",
      "Enhanced document analysis",
      "Document history",
    ],
  },
  {
    planName: "Standard",
    description:
      "Standard plan with 20 PDF documents for $5 - perfect for professionals",
    price: 5,
    pdfLimit: 20,
    planType: "paid",
    features: [
      "20 PDF documents",
      "Priority support",
      "Fastest processing speed",
      "Advanced document analysis",
      "Document history",
      "API access",
      "Export capabilities",
    ],
  },
  {
    planName: "Premium",
    description:
      "Premium plan with 40 PDF documents for $10 - for power users and teams",
    price: 10,
    pdfLimit: 40,
    planType: "paid",
    features: [
      "40 PDF documents",
      "24/7 priority support",
      "Lightning-fast processing",
      "AI-powered analysis",
      "Unlimited document history",
      "Full API access",
      "Advanced export options",
      "Custom integrations",
      "Team collaboration features",
    ],
  },
];

/**
 * @description Validate pricing plan input data
 * @param {Object} data - Pricing plan data
 * @returns {Object} - Validation result with isValid boolean and error messages
 */
const validatePricingPlanData = (data) => {
  const errors = [];

  if (
    !data.planName ||
    typeof data.planName !== "string" ||
    data.planName.trim().length === 0
  ) {
    errors.push("planName is required and must be a non-empty string");
  }

  if (
    !data.description ||
    typeof data.description !== "string" ||
    data.description.trim().length === 0
  ) {
    errors.push("description is required and must be a non-empty string");
  }

  if (
    data.price === undefined ||
    data.price === null ||
    typeof data.price !== "number" ||
    data.price < 0
  ) {
    errors.push("Price must be non-negative number");
  }

  if (
    !data.pdfLimit ||
    !Number.isInteger(data.pdfLimit) ||
    data.pdfLimit <= 0
  ) {
    errors.push("PDF limit must be greater than 0");
  }

  if (data.planType && !["free", "paid"].includes(data.planType)) {
    errors.push('planType must be either "free" or "paid"');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * @route POST /api/pricing-plans
 * @description Create a new pricing plan
 * @access Public
 */
router.post("/", async (req, res) => {
  try {
    const validation = validatePricingPlanData(req.body);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(", "),
      });
    }

    // Check if plan name already exists
    const existingPlan = await prisma.pricingPlan.findUnique({
      where: { planName: req.body.planName.trim() },
    });

    if (existingPlan) {
      return res.status(400).json({
        success: false,
        error: "Plan name already exists",
      });
    }

    const pricingPlan = await prisma.pricingPlan.create({
      data: {
        planName: req.body.planName.trim(),
        description: req.body.description.trim(),
        price: parseFloat(req.body.price),
        pdfLimit: parseInt(req.body.pdfLimit),
        planType: req.body.planType || "paid",
        features: req.body.features || [],
        isActive: req.body.isActive !== undefined ? req.body.isActive : true,
      },
    });

    res.status(201).json({
      success: true,
      message: "Pricing plan created successfully",
      data: pricingPlan,
    });
  } catch (error) {
    console.error("Error creating pricing plan:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route GET /api/pricing-plans
 * @description Get all pricing plans with optional filtering
 * @access Public
 */
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      active,
      type,
      sortBy = "price",
      order = "asc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {};

    if (active !== undefined) {
      where.isActive = active === "true";
    }

    if (type && ["free", "paid"].includes(type)) {
      where.planType = type;
    }

    // Determine sort order
    const orderBy = {};
    if (["price", "pdfLimit", "createdAt", "planName"].includes(sortBy)) {
      orderBy[sortBy] = order === "desc" ? "desc" : "asc";
    } else {
      orderBy.price = "asc"; // Default sorting
    }

    const [pricingPlans, totalCount] = await prisma.$transaction([
      prisma.pricingPlan.findMany({
        where,
        skip,
        take,
        orderBy,
      }),
      prisma.pricingPlan.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: pricingPlans,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching pricing plans:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route GET /api/pricing-plans/:id
 * @description Get pricing plan by ID
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

    const pricingPlan = await prisma.pricingPlan.findUnique({
      where: { id },
      include: {
        _count: {
          select: { userDocuments: true },
        },
      },
    });

    if (!pricingPlan) {
      return res.status(404).json({
        success: false,
        error: "Pricing plan not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...pricingPlan,
        subscriberCount: pricingPlan._count.userDocuments,
      },
    });
  } catch (error) {
    console.error("Error fetching pricing plan:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route PUT /api/pricing-plans/:id
 * @description Update pricing plan by ID
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

    // Validate update data (exclude planName from validation for updates)
    const updateData = { ...req.body };
    if (updateData.planName) {
      updateData.planName = updateData.planName.trim();
    }
    if (updateData.description) {
      updateData.description = updateData.description.trim();
    }

    // Check if the plan exists
    const existingPlan = await prisma.pricingPlan.findUnique({
      where: { id },
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        error: "Pricing plan not found",
      });
    }

    // Validate specific fields if they're being updated
    if (
      updateData.price !== undefined &&
      (typeof updateData.price !== "number" || updateData.price < 0)
    ) {
      return res.status(400).json({
        success: false,
        error: "Price must be non-negative number",
      });
    }

    if (
      updateData.pdfLimit !== undefined &&
      (!Number.isInteger(updateData.pdfLimit) || updateData.pdfLimit <= 0)
    ) {
      return res.status(400).json({
        success: false,
        error: "PDF limit must be greater than 0",
      });
    }

    if (
      updateData.planType &&
      !["free", "paid"].includes(updateData.planType)
    ) {
      return res.status(400).json({
        success: false,
        error: 'planType must be either "free" or "paid"',
      });
    }

    // Check for duplicate plan name if planName is being updated
    if (updateData.planName && updateData.planName !== existingPlan.planName) {
      const duplicatePlan = await prisma.pricingPlan.findUnique({
        where: { planName: updateData.planName },
      });

      if (duplicatePlan) {
        return res.status(400).json({
          success: false,
          error: "Plan name already exists",
        });
      }
    }

    const pricingPlan = await prisma.pricingPlan.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: "Pricing plan updated successfully",
      data: pricingPlan,
    });
  } catch (error) {
    console.error("Error updating pricing plan:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route DELETE /api/pricing-plans/:id
 * @description Soft delete (deactivate) pricing plan by ID
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

    const existingPlan = await prisma.pricingPlan.findUnique({
      where: { id },
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        error: "Pricing plan not found",
      });
    }

    // Soft delete - just deactivate the plan
    await prisma.pricingPlan.update({
      where: { id },
      data: { isActive: false },
    });

    res.status(200).json({
      success: true,
      message: "Pricing plan deactivated successfully",
    });
  } catch (error) {
    console.error("Error deactivating pricing plan:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route POST /api/pricing-plans/initialize-default
 * @description Initialize default pricing plans
 * @access Public
 */
router.post("/initialize-default", async (req, res) => {
  try {
    const createdPlans = [];
    const existingPlans = [];

    for (const planData of DEFAULT_PRICING_PLANS) {
      // Check if plan already exists
      const existingPlan = await prisma.pricingPlan.findUnique({
        where: { planName: planData.planName },
      });

      if (existingPlan) {
        existingPlans.push(existingPlan.planName);
        continue;
      }

      // Create the plan
      const newPlan = await prisma.pricingPlan.create({
        data: planData,
      });

      createdPlans.push(newPlan);
    }

    if (createdPlans.length === 0) {
      return res.status(200).json({
        success: true,
        message: "All default pricing plans already exist",
        data: {
          created: 0,
          existing: existingPlans.length,
          existingPlans,
        },
      });
    }

    res.status(201).json({
      success: true,
      message: "Default pricing plans created successfully",
      data: {
        created: createdPlans.length,
        existing: existingPlans.length,
        createdPlans: createdPlans.map((p) => ({
          id: p.id,
          planName: p.planName,
          price: p.price,
        })),
        existingPlans,
        planIds: createdPlans.map((p) => p.id),
      },
    });
  } catch (error) {
    console.error("Error initializing default pricing plans:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route GET /api/pricing-plans/recommended/:walletId
 * @description Get recommended pricing plan for a user based on their usage
 * @access Public
 */
router.get("/recommended/:walletId", async (req, res) => {
  try {
    const { walletId } = req.params;

    // Get user's current document usage
    const userDocument = await prisma.userDocument.findUnique({
      where: { walletId },
      include: { currentPlan: true },
    });

    // Get all active pricing plans
    const activePlans = await prisma.pricingPlan.findMany({
      where: { isActive: true },
      orderBy: { price: "asc" },
    });

    if (activePlans.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No active pricing plans available",
      });
    }

    let recommendedPlan;
    let reason;

    if (!userDocument) {
      // New user - recommend free plan
      recommendedPlan =
        activePlans.find((plan) => plan.planType === "free") || activePlans[0];
      reason = "Recommended for new users to get started";
    } else {
      const { documentsUsed, totalDocumentsCapacity, isFreeTier } =
        userDocument;
      const usagePercentage = (documentsUsed / totalDocumentsCapacity) * 100;

      if (isFreeTier && documentsUsed >= 2) {
        // Free tier user approaching limit - recommend basic plan
        recommendedPlan =
          activePlans.find((plan) => plan.planName === "Basic") ||
          activePlans[1];
        reason =
          "You're approaching your free tier limit. Upgrade for more documents!";
      } else if (usagePercentage >= 80) {
        // User is using 80%+ of their capacity - recommend upgrade
        const currentPlanIndex = activePlans.findIndex(
          (plan) => plan.id === userDocument.currentPlanId
        );
        const nextPlan = activePlans[currentPlanIndex + 1];

        if (nextPlan) {
          recommendedPlan = nextPlan;
          reason =
            "You're using most of your document capacity. Consider upgrading for more flexibility!";
        } else {
          recommendedPlan = userDocument.currentPlan;
          reason =
            "You're on our highest tier plan. Consider managing your document usage.";
        }
      } else if (usagePercentage <= 30 && !isFreeTier) {
        // User is underutilizing - might suggest a lower plan (but carefully)
        const currentPlanIndex = activePlans.findIndex(
          (plan) => plan.id === userDocument.currentPlanId
        );
        const lowerPlan =
          currentPlanIndex > 0 ? activePlans[currentPlanIndex - 1] : null;

        if (lowerPlan && documentsUsed <= lowerPlan.pdfLimit * 0.7) {
          recommendedPlan = lowerPlan;
          reason =
            "You might be able to save money with a lower tier plan based on your usage.";
        } else {
          recommendedPlan = userDocument.currentPlan;
          reason = "Your current plan seems perfect for your usage patterns.";
        }
      } else {
        // Current plan is suitable
        recommendedPlan =
          userDocument.currentPlan ||
          activePlans.find((plan) => plan.planType === "free");
        reason = "Your current plan fits your usage patterns well.";
      }
    }

    res.status(200).json({
      success: true,
      data: {
        recommendedPlan,
        reason,
        currentUsage: userDocument
          ? {
              documentsUsed: userDocument.documentsUsed,
              totalCapacity: userDocument.totalDocumentsCapacity,
              usagePercentage: userDocument
                ? Math.round(
                    (userDocument.documentsUsed /
                      userDocument.totalDocumentsCapacity) *
                      100
                  )
                : 0,
            }
          : null,
        allPlans: activePlans,
      },
    });
  } catch (error) {
    console.error("Error getting recommended plan:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * @route GET /api/pricing-plans/public/active
 * @description Get all active pricing plans for public display
 * @access Public
 */
router.get("/public/active", async (req, res) => {
  try {
    const activePlans = await prisma.pricingPlan.findMany({
      where: { isActive: true },
      orderBy: { price: "asc" },
      select: {
        id: true,
        planName: true,
        description: true,
        price: true,
        pdfLimit: true,
        planType: true,
        features: true,
      },
    });

    res.status(200).json({
      success: true,
      data: activePlans,
    });
  } catch (error) {
    console.error("Error fetching active pricing plans:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

module.exports = router;
