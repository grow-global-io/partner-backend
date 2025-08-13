const axios = require("axios");
const PerformanceMonitor = require("../services/PerformanceMonitor");

/**
 * @description Baseline performance testing for the findLeads API
 * @class BaselinePerformanceTest
 */
class BaselinePerformanceTest {
  constructor(baseUrl = "http://localhost:3000") {
    this.baseUrl = baseUrl;
    this.monitor = new PerformanceMonitor();
    this.testResults = [];
  }

  /**
   * @description Run baseline performance tests
   * @param {Object} options - Test configuration options
   * @returns {Object} Test results summary
   */
  async runBaselineTests(options = {}) {
    const config = {
      iterations: 5,
      concurrentUsers: 1,
      testScenarios: [
        {
          name: "Simple Product Search",
          criteria: {
            product: "Software Development",
            industry: "Technology",
            limit: 10,
            minScore: 30,
          },
        },
        {
          name: "Complex Multi-Criteria Search",
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
          name: "High Volume Search",
          criteria: {
            product: "Consulting Services",
            industry: "Business Services",
            limit: 50,
            minScore: 20,
          },
        },
      ],
      ...options,
    };

    console.log("🚀 Starting baseline performance tests...");
    console.log(
      `📊 Configuration: ${config.iterations} iterations, ${config.concurrentUsers} concurrent users`
    );

    const startTime = Date.now();

    for (const scenario of config.testScenarios) {
      console.log(`\n🎯 Testing scenario: ${scenario.name}`);
      await this.runScenario(scenario, config);
    }

    const totalTime = Date.now() - startTime;
    const summary = this.generateSummary(totalTime);

    console.log("\n📈 Baseline Performance Test Results:");
    console.log(JSON.stringify(summary, null, 2));

    return summary;
  }

  /**
   * @description Run a specific test scenario
   * @param {Object} scenario - Test scenario configuration
   * @param {Object} config - Overall test configuration
   * @private
   */
  async runScenario(scenario, config) {
    const scenarioResults = [];

    for (let i = 0; i < config.iterations; i++) {
      console.log(`  📝 Iteration ${i + 1}/${config.iterations}`);

      try {
        const result = await this.executeRequest(
          scenario.criteria,
          scenario.name
        );
        scenarioResults.push(result);

        console.log(`    ⏱️  Response time: ${result.responseTime}ms`);
        console.log(`    📊 Results count: ${result.resultsCount}`);
        console.log(`    ✅ Success: ${result.success}`);

        // Wait between iterations to avoid overwhelming the server
        if (i < config.iterations - 1) {
          await this.sleep(1000);
        }
      } catch (error) {
        console.error(`    ❌ Error: ${error.message}`);
        scenarioResults.push({
          success: false,
          error: error.message,
          responseTime: null,
          resultsCount: 0,
        });
      }
    }

    this.testResults.push({
      scenario: scenario.name,
      results: scenarioResults,
    });
  }

  /**
   * @description Execute a single API request and measure performance
   * @param {Object} criteria - Search criteria
   * @param {string} scenarioName - Name of the test scenario
   * @returns {Object} Request result with performance metrics
   * @private
   */
  async executeRequest(criteria, scenarioName) {
    const requestId = this.monitor.startRequest("findLeads_baseline", {
      scenario: scenarioName,
      criteria,
    });

    const startTime = Date.now();

    try {
      // Track validation stage
      this.monitor.trackStage(requestId, "validation", 5, { criteria });

      const response = await axios.post(
        `${this.baseUrl}/api/leadgen/find-leads`,
        criteria,
        {
          timeout: 180000, // 3 minute timeout
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const responseTime = Date.now() - startTime;

      // Track the complete request
      const result = {
        success: response.data.success,
        responseTime,
        resultsCount: response.data.data?.leads?.length || 0,
        totalMatches: response.data.data?.totalMatches || 0,
        qualifiedLeads: response.data.data?.qualifiedLeads || 0,
        searchQueries:
          response.data.data?.searchCriteria?.searchQueries?.length || 0,
        model: response.data.data?.model,
        httpStatus: response.status,
      };

      this.monitor.completeRequest(requestId, result);
      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      const result = {
        success: false,
        error: error.message,
        responseTime,
        resultsCount: 0,
        httpStatus: error.response?.status || 0,
      };

      this.monitor.completeRequest(requestId, result);
      throw error;
    }
  }

  /**
   * @description Generate performance test summary
   * @param {number} totalTestTime - Total time for all tests
   * @returns {Object} Performance summary
   * @private
   */
  generateSummary(totalTestTime) {
    const allResults = this.testResults.flatMap((test) => test.results);
    const successfulResults = allResults.filter((r) => r.success);
    const responseTimes = successfulResults
      .map((r) => r.responseTime)
      .sort((a, b) => a - b);

    if (responseTimes.length === 0) {
      return {
        totalTests: allResults.length,
        successfulTests: 0,
        failedTests: allResults.length,
        successRate: 0,
        averageResponseTime: null,
        medianResponseTime: null,
        p95ResponseTime: null,
        p99ResponseTime: null,
        minResponseTime: null,
        maxResponseTime: null,
        totalTestTime,
        scenarios: this.testResults.map((test) => ({
          name: test.scenario,
          successRate:
            test.results.filter((r) => r.success).length / test.results.length,
          averageResponseTime: this.calculateAverage(
            test.results.filter((r) => r.success).map((r) => r.responseTime)
          ),
        })),
        recommendations: this.generateBaselineRecommendations(allResults),
      };
    }

    const summary = {
      totalTests: allResults.length,
      successfulTests: successfulResults.length,
      failedTests: allResults.length - successfulResults.length,
      successRate: successfulResults.length / allResults.length,
      averageResponseTime: Math.round(this.calculateAverage(responseTimes)),
      medianResponseTime: responseTimes[Math.floor(responseTimes.length / 2)],
      p95ResponseTime: responseTimes[Math.floor(responseTimes.length * 0.95)],
      p99ResponseTime: responseTimes[Math.floor(responseTimes.length * 0.99)],
      minResponseTime: Math.min(...responseTimes),
      maxResponseTime: Math.max(...responseTimes),
      totalTestTime,
      scenarios: this.testResults.map((test) => {
        const scenarioSuccessful = test.results.filter((r) => r.success);
        const scenarioResponseTimes = scenarioSuccessful.map(
          (r) => r.responseTime
        );

        return {
          name: test.scenario,
          successRate: scenarioSuccessful.length / test.results.length,
          averageResponseTime:
            scenarioResponseTimes.length > 0
              ? Math.round(this.calculateAverage(scenarioResponseTimes))
              : null,
          averageResultsCount:
            scenarioSuccessful.length > 0
              ? Math.round(
                  this.calculateAverage(
                    scenarioSuccessful.map((r) => r.resultsCount)
                  )
                )
              : 0,
        };
      }),
      recommendations: this.generateBaselineRecommendations(allResults),
      performanceMetrics: this.monitor.getMetrics(),
    };

    return summary;
  }

  /**
   * @description Calculate average of an array of numbers
   * @param {Array<number>} numbers - Array of numbers
   * @returns {number} Average value
   * @private
   */
  calculateAverage(numbers) {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  }

  /**
   * @description Generate recommendations based on baseline results
   * @param {Array} results - Test results
   * @returns {Array} Array of recommendations
   * @private
   */
  generateBaselineRecommendations(results) {
    const recommendations = [];
    const successfulResults = results.filter((r) => r.success);

    if (successfulResults.length === 0) {
      recommendations.push({
        type: "critical",
        category: "availability",
        message:
          "All requests failed. Check API availability and configuration.",
        priority: 1,
      });
      return recommendations;
    }

    const avgResponseTime = this.calculateAverage(
      successfulResults.map((r) => r.responseTime)
    );
    const maxResponseTime = Math.max(
      ...successfulResults.map((r) => r.responseTime)
    );

    // Response time recommendations
    if (avgResponseTime > 120000) {
      // 2 minutes
      recommendations.push({
        type: "critical",
        category: "performance",
        message: `Average response time is ${Math.round(
          avgResponseTime / 1000
        )}s. Immediate optimization required.`,
        priority: 1,
        targetImprovement: "90% reduction to <10s",
      });
    } else if (avgResponseTime > 30000) {
      // 30 seconds
      recommendations.push({
        type: "warning",
        category: "performance",
        message: `Average response time is ${Math.round(
          avgResponseTime / 1000
        )}s. Optimization recommended.`,
        priority: 2,
        targetImprovement: "70% reduction to <10s",
      });
    }

    // Consistency recommendations
    if (maxResponseTime > avgResponseTime * 3) {
      recommendations.push({
        type: "warning",
        category: "consistency",
        message:
          "High variance in response times. Consider implementing caching and load balancing.",
        priority: 2,
      });
    }

    // Success rate recommendations
    const successRate = successfulResults.length / results.length;
    if (successRate < 0.95) {
      recommendations.push({
        type: "warning",
        category: "reliability",
        message: `Success rate is ${(successRate * 100).toFixed(
          1
        )}%. Improve error handling and resilience.`,
        priority: 2,
      });
    }

    return recommendations.sort((a, b) => a.priority - b.priority);
  }

  /**
   * @description Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Promise that resolves after the specified time
   * @private
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * @description Save test results to file
   * @param {string} filename - Output filename
   */
  async saveResults(filename = "baseline-performance-results.json") {
    const fs = require("fs").promises;
    const path = require("path");

    const outputPath = path.join(__dirname, filename);
    const summary = this.generateSummary(0);

    await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
    console.log(`📁 Results saved to: ${outputPath}`);
  }
}

// Export for use in other modules
module.exports = BaselinePerformanceTest;

// Allow running as standalone script
if (require.main === module) {
  const test = new BaselinePerformanceTest();

  test
    .runBaselineTests({
      iterations: 3,
      testScenarios: [
        {
          name: "Current Performance Baseline",
          criteria: {
            product: "Software Development",
            industry: "Technology",
            region: "India",
            keywords: ["web development", "mobile apps"],
            limit: 10,
            minScore: 30,
          },
        },
      ],
    })
    .then((results) => {
      console.log("\n🎯 Baseline testing completed!");
      console.log(
        "Use these results to measure improvement after optimizations."
      );
    })
    .catch((error) => {
      console.error("❌ Baseline testing failed:", error.message);
      process.exit(1);
    });
}
