/**
 * @fileoverview Initialize Default Pricing Plans Script
 * @description Script to create default pricing plans in the database
 * @author AI Assistant
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

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

async function initializePricingPlans() {
  try {
    console.log("🚀 Initializing default pricing plans...");

    const createdPlans = [];
    const existingPlans = [];

    for (const planData of DEFAULT_PRICING_PLANS) {
      // Check if plan already exists
      const existingPlan = await prisma.pricingPlan.findUnique({
        where: { planName: planData.planName },
      });

      if (existingPlan) {
        existingPlans.push(existingPlan.planName);
        console.log(`⚠️  Plan "${planData.planName}" already exists`);
        continue;
      }

      // Create the plan
      const newPlan = await prisma.pricingPlan.create({
        data: planData,
      });

      createdPlans.push(newPlan);
      console.log(
        `✅ Created plan: ${newPlan.planName} - $${newPlan.price} (${newPlan.pdfLimit} PDFs)`
      );
    }

    console.log("\n📊 Summary:");
    console.log(`✅ Created: ${createdPlans.length} new plans`);
    console.log(`⚠️  Already existed: ${existingPlans.length} plans`);

    if (createdPlans.length > 0) {
      console.log(
        "\n🎉 Default pricing plans have been successfully initialized!"
      );
      console.log("\nCreated plans:");
      createdPlans.forEach((plan) => {
        console.log(
          `  - ${plan.planName}: $${plan.price} for ${plan.pdfLimit} PDFs`
        );
      });
    }

    if (existingPlans.length > 0) {
      console.log("\nExisting plans:");
      existingPlans.forEach((planName) => {
        console.log(`  - ${planName}`);
      });
    }
  } catch (error) {
    console.error("❌ Error initializing pricing plans:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  initializePricingPlans();
}

module.exports = { initializePricingPlans };
