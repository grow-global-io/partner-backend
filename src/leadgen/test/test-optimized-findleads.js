/**
 * @description Quick test script for the optimized findLeads API
 */

const axios = require("axios");
const { printDatabaseConfig } = require("../config/database-config");

async function testOptimizedFindLeads() {
  console.log("🧪 Testing Optimized FindLeads API with Database Optimizations");
  console.log("=".repeat(60));

  // Show database configuration status
  printDatabaseConfig();

  const testCriteria = {
    product: "textile manufacturing",
    industry: "textile",
    region: "India",
    keywords: ["cotton", "fabric"],
    limit: 10,
    minScore: 30,
  };

  const startTime = Date.now();

  try {
    console.log("📤 Sending request with criteria:", testCriteria);

    const response = await axios.post(
      "http://localhost:8000/api/leadgen/find-leads",
      testCriteria,
      {
        timeout: 60000, // 60 second timeout
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const responseTime = Date.now() - startTime;

    console.log("✅ Request completed successfully!");
    console.log(`⏱️  Total Response Time: ${responseTime}ms`);
    console.log(
      `📊 Results: ${response.data.data?.qualifiedLeads || 0} qualified leads`
    );
    console.log(`🎯 Model: ${response.data.data?.model || "unknown"}`);

    if (response.data.data?.optimizations) {
      console.log("🚀 Optimizations Applied:");
      console.log(
        `   - Batch Embedding: ${response.data.data.optimizations.batchEmbedding}`
      );
      console.log(
        `   - Parallel Search: ${response.data.data.optimizations.parallelSearch}`
      );
      console.log(
        `   - Embedding Time: ${response.data.data.optimizations.embeddingTime}ms`
      );
      console.log(
        `   - Search Time: ${response.data.data.optimizations.searchTime}ms`
      );
      console.log(
        `   - Estimated Savings: ${response.data.data.optimizations.totalOptimizationSavings}`
      );
    }

    if (response.data.data?.searchSummary) {
      console.log("🔍 Search Summary:");
      response.data.data.searchSummary.forEach((search, index) => {
        console.log(
          `   ${index + 1}. "${search.query.substring(0, 50)}..." - ${
            search.resultsCount
          } results (${search.searchTime || "N/A"}ms)`
        );
      });
    }

    // Performance assessment
    if (responseTime < 10000) {
      console.log("🎉 EXCELLENT: Response time under 10 seconds!");
    } else if (responseTime < 30000) {
      console.log("✅ GOOD: Response time under 30 seconds");
    } else if (responseTime < 60000) {
      console.log("⚠️  ACCEPTABLE: Response time under 60 seconds");
    } else {
      console.log("❌ SLOW: Response time over 60 seconds");
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error("❌ Request failed after", responseTime + "ms");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Error:", error.response.data?.error || "Unknown error");
      console.error("Details:", error.response.data?.details || "No details");
    } else if (error.code === "ECONNABORTED") {
      console.error("Request timed out after 60 seconds");
    } else {
      console.error("Network error:", error.message);
    }
  }
}

// Run the test
if (require.main === module) {
  testOptimizedFindLeads()
    .then(() => {
      console.log("\n🏁 Test completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Test failed:", error.message);
      process.exit(1);
    });
}

module.exports = { testOptimizedFindLeads };
