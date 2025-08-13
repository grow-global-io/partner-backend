#!/usr/bin/env node

/**
 * @description Script to run baseline performance tests for the findLeads API
 */

const BaselinePerformanceTest = require("./performance-baseline");

async function runBaselineTest() {
  console.log("🚀 Starting Baseline Performance Test for findLeads API");
  console.log("=".repeat(60));

  const test = new BaselinePerformanceTest();

  try {
    const results = await test.runBaselineTests({
      iterations: 3,
      testScenarios: [
        {
          name: "Simple Search - Current Performance",
          criteria: {
            product: "Software Development",
            industry: "Technology",
            limit: 10,
            minScore: 30,
          },
        },
        {
          name: "Complex Search - Current Performance",
          criteria: {
            product: "Digital Marketing Services",
            industry: "E-commerce",
            region: "India",
            keywords: ["SEO", "social media", "advertising"],
            limit: 20,
            minScore: 40,
          },
        },
        {
          name: "High Volume Search - Current Performance",
          criteria: {
            product: "Consulting Services",
            industry: "Business Services",
            limit: 50,
            minScore: 20,
          },
        },
      ],
    });

    console.log("\n" + "=".repeat(60));
    console.log("📊 BASELINE PERFORMANCE TEST RESULTS");
    console.log("=".repeat(60));

    if (results.successfulTests === 0) {
      console.log(
        "❌ All tests failed! Check API availability and configuration."
      );
      console.log("\nPossible issues:");
      console.log("- API server is not running");
      console.log("- Database connection issues");
      console.log("- OpenAI API key not configured");
      console.log("- Network connectivity problems");
      process.exit(1);
    }

    console.log(`\n📈 Overall Results:`);
    console.log(`   Total Tests: ${results.totalTests}`);
    console.log(`   Successful: ${results.successfulTests}`);
    console.log(`   Failed: ${results.failedTests}`);
    console.log(`   Success Rate: ${(results.successRate * 100).toFixed(1)}%`);

    if (results.averageResponseTime) {
      console.log(`\n⏱️  Response Time Analysis:`);
      console.log(
        `   Average: ${(results.averageResponseTime / 1000).toFixed(1)}s`
      );
      console.log(
        `   Median: ${(results.medianResponseTime / 1000).toFixed(1)}s`
      );
      console.log(
        `   95th Percentile: ${(results.p95ResponseTime / 1000).toFixed(1)}s`
      );
      console.log(
        `   99th Percentile: ${(results.p99ResponseTime / 1000).toFixed(1)}s`
      );
      console.log(`   Min: ${(results.minResponseTime / 1000).toFixed(1)}s`);
      console.log(`   Max: ${(results.maxResponseTime / 1000).toFixed(1)}s`);
    }

    console.log(`\n🎯 Scenario Breakdown:`);
    results.scenarios.forEach((scenario) => {
      console.log(`   ${scenario.name}:`);
      console.log(
        `     Success Rate: ${(scenario.successRate * 100).toFixed(1)}%`
      );
      if (scenario.averageResponseTime) {
        console.log(
          `     Avg Response Time: ${(
            scenario.averageResponseTime / 1000
          ).toFixed(1)}s`
        );
        console.log(`     Avg Results: ${scenario.averageResultsCount} leads`);
      }
    });

    if (results.recommendations && results.recommendations.length > 0) {
      console.log(`\n💡 Performance Recommendations:`);
      results.recommendations.forEach((rec, index) => {
        const icon =
          rec.type === "critical" ? "🚨" : rec.type === "warning" ? "⚠️" : "ℹ️";
        console.log(
          `   ${index + 1}. ${icon} [${rec.category.toUpperCase()}] ${
            rec.message
          }`
        );
        if (rec.targetImprovement) {
          console.log(`      Target: ${rec.targetImprovement}`);
        }
      });
    }

    console.log(`\n🎯 Optimization Targets:`);
    console.log(
      `   Target Response Time: <10 seconds (90% improvement needed)`
    );
    console.log(`   Target Success Rate: >99%`);
    console.log(`   Target Consistency: <3x variance in response times`);

    console.log(`\n📁 Next Steps:`);
    console.log(`   1. Implement caching layer (Redis)`);
    console.log(`   2. Add parallel processing for embeddings`);
    console.log(`   3. Optimize database vector search`);
    console.log(`   4. Implement request batching for OpenAI API`);
    console.log(`   5. Add performance monitoring dashboard`);

    // Save results to file
    await test.saveResults(`baseline-${Date.now()}.json`);

    console.log(`\n✅ Baseline test completed successfully!`);
    console.log(
      `📊 Use these metrics to measure improvement after optimizations.`
    );
  } catch (error) {
    console.error("\n❌ Baseline test failed:", error.message);
    console.error("\nError details:", error.stack);

    console.log("\n🔧 Troubleshooting:");
    console.log("1. Ensure the API server is running on http://localhost:3000");
    console.log("2. Check database connectivity");
    console.log("3. Verify OpenAI API key is configured");
    console.log("4. Check network connectivity");

    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n⏹️  Test interrupted by user");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\n⏹️  Test terminated");
  process.exit(0);
});

// Run the test
if (require.main === module) {
  runBaselineTest();
}

module.exports = runBaselineTest;
