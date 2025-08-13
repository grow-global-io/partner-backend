const PerformanceMonitor = require("../services/PerformanceMonitor");

/**
 * @description Unit tests for PerformanceMonitor class
 */
describe("PerformanceMonitor", () => {
  let monitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  afterEach(() => {
    // Clean up any active requests
    monitor.activeRequests.clear();
    monitor.metrics.requests = [];
  });

  describe("Request Tracking", () => {
    test("should start and complete a request successfully", () => {
      const requestId = monitor.startRequest("testOperation", { test: true });

      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe("string");
      expect(monitor.activeRequests.has(requestId)).toBe(true);

      const request = monitor.activeRequests.get(requestId);
      expect(request.operation).toBe("testOperation");
      expect(request.metadata.test).toBe(true);
      expect(request.startTime).toBeDefined();
    });

    test("should track stages correctly", () => {
      const requestId = monitor.startRequest("testOperation");

      monitor.trackStage(requestId, "validation", 100, { field: "test" });
      monitor.trackStage(requestId, "processing", 500);

      const request = monitor.activeRequests.get(requestId);
      expect(request.stages.validation).toBeDefined();
      expect(request.stages.validation.duration).toBe(100);
      expect(request.stages.validation.metadata.field).toBe("test");
      expect(request.stages.processing.duration).toBe(500);
    });

    test("should track resources correctly", () => {
      const requestId = monitor.startRequest("testOperation");

      monitor.trackResource(requestId, "openaiCalls", 3);
      monitor.trackResource(requestId, "dbQueries", 1, {
        details: true,
        query: "SELECT *",
      });

      const request = monitor.activeRequests.get(requestId);
      expect(request.resources.openaiCalls).toBe(3);
      expect(request.resources.dbQueries).toBe(1);
      expect(request.resources.dbQueriesDetails).toBeDefined();
      expect(request.resources.dbQueriesDetails[0].query).toBe("SELECT *");
    });

    test("should complete request and calculate metrics", () => {
      const requestId = monitor.startRequest("testOperation");

      monitor.trackStage(requestId, "stage1", 100);
      monitor.trackStage(requestId, "stage2", 200);
      monitor.trackResource(requestId, "openaiCalls", 2);

      const result = monitor.completeRequest(requestId, {
        success: true,
        resultsCount: 10,
        qualityScore: 85,
      });

      expect(result).toBeDefined();
      expect(result.totalDuration).toBeGreaterThan(0);
      expect(result.stagePercentages.stage1).toBeDefined();
      expect(result.stagePercentages.stage2).toBeDefined();
      expect(result.result.success).toBe(true);
      expect(result.result.resultsCount).toBe(10);
      expect(result.result.qualityScore).toBe(85);

      // Should be removed from active requests
      expect(monitor.activeRequests.has(requestId)).toBe(false);

      // Should be added to metrics history
      expect(monitor.metrics.requests.length).toBe(1);
      expect(monitor.metrics.requests[0].id).toBe(requestId);
    });
  });

  describe("OpenAI API Tracking", () => {
    test("should track OpenAI calls correctly", () => {
      const requestId = monitor.startRequest("testOperation");

      monitor.trackOpenAICall(requestId, "embedding", 1500, {
        model: "text-embedding-3-large",
        tokens: 100,
      });

      const request = monitor.activeRequests.get(requestId);
      expect(request.resources.openaiCalls).toBe(1);
      expect(request.resources.openaiCallsDetails).toBeDefined();
      expect(request.resources.openaiCallsDetails[0].operation).toBe(
        "embedding"
      );
      expect(request.resources.openaiCallsDetails[0].model).toBe(
        "text-embedding-3-large"
      );
      expect(request.stages.openai_embedding).toBeDefined();
      expect(request.stages.openai_embedding.duration).toBe(1500);
    });

    test("should not create stage for short API calls", () => {
      const requestId = monitor.startRequest("testOperation");

      monitor.trackOpenAICall(requestId, "embedding", 50, {
        model: "text-embedding-3-large",
      });

      const request = monitor.activeRequests.get(requestId);
      expect(request.resources.openaiCalls).toBe(1);
      expect(request.stages.openai_embedding).toBeUndefined();
    });
  });

  describe("Database Query Tracking", () => {
    test("should track database queries correctly", () => {
      const requestId = monitor.startRequest("testOperation");

      monitor.trackDatabaseQuery(requestId, "vectorSearch", 800, {
        rowsAffected: 50,
      });

      const request = monitor.activeRequests.get(requestId);
      expect(request.resources.dbQueries).toBe(1);
      expect(request.resources.dbQueriesDetails[0].queryType).toBe(
        "vectorSearch"
      );
      expect(request.resources.dbQueriesDetails[0].rowsAffected).toBe(50);
      expect(request.stages.db_vectorSearch).toBeDefined();
      expect(request.stages.db_vectorSearch.duration).toBe(800);
    });
  });

  describe("Cache Operation Tracking", () => {
    test("should track cache hits and misses", () => {
      const requestId = monitor.startRequest("testOperation");

      monitor.trackCacheOperation(requestId, "hit", "embedding", {
        key: "test-key",
      });
      monitor.trackCacheOperation(requestId, "miss", "searchResults", {
        key: "search-key",
      });

      const request = monitor.activeRequests.get(requestId);
      expect(request.resources.cacheHits).toBe(1);
      expect(request.resources.cacheMisses).toBe(1);
      expect(request.resources.cacheHitsDetails[0].cacheType).toBe("embedding");
      expect(request.resources.cacheMissesDetails[0].cacheType).toBe(
        "searchResults"
      );
    });
  });

  describe("Metrics and Reporting", () => {
    test("should generate performance metrics", () => {
      // Complete a few requests to generate metrics
      for (let i = 0; i < 3; i++) {
        const requestId = monitor.startRequest("testOperation");
        monitor.trackStage(requestId, "processing", 1000 + i * 100);
        monitor.trackResource(requestId, "openaiCalls", 2);
        monitor.completeRequest(requestId, { success: true, resultsCount: 10 });
      }

      const metrics = monitor.getMetrics();

      expect(metrics.aggregated.totalRequests).toBe(3);
      expect(metrics.aggregated.averageResponseTime).toBeGreaterThan(0);
      expect(metrics.aggregated.p50).toBeGreaterThan(0);
      expect(metrics.aggregated.errorRate).toBe(0);
      expect(metrics.aggregated.openaiApiCalls).toBe(6);
      expect(metrics.activeRequests).toBe(0);
    });

    test("should generate performance report with recommendations", () => {
      // Create some requests with varying performance
      const slowRequestId = monitor.startRequest("slowOperation");
      monitor.trackStage(slowRequestId, "embeddingGeneration", 6000); // Slow embedding
      monitor.completeRequest(slowRequestId, { success: true });

      const fastRequestId = monitor.startRequest("fastOperation");
      monitor.trackStage(fastRequestId, "validation", 50);
      monitor.completeRequest(fastRequestId, { success: true });

      const report = monitor.getPerformanceReport();

      expect(report.summary).toBeDefined();
      expect(report.stagePerformance).toBeDefined();
      expect(report.recentRequests).toBeDefined();
      expect(report.recommendations).toBeDefined();

      // Should have recommendations for slow embedding
      const embeddingRec = report.recommendations.find(
        (r) => r.category === "embedding"
      );
      expect(embeddingRec).toBeDefined();
    });

    test("should handle cleanup of old metrics", () => {
      // Add some old requests
      const oldTime = Date.now() - 7200000; // 2 hours ago
      monitor.metrics.requests.push({
        id: "old-request",
        endTime: oldTime,
        totalDuration: 1000,
      });

      // Add recent request
      const requestId = monitor.startRequest("recentOperation");
      monitor.completeRequest(requestId, { success: true });

      expect(monitor.metrics.requests.length).toBe(2);

      // Cleanup with 1 hour max age
      monitor.cleanup(3600000);

      expect(monitor.metrics.requests.length).toBe(1);
      expect(monitor.metrics.requests[0].id).not.toBe("old-request");
    });
  });

  describe("Error Handling", () => {
    test("should handle tracking for non-existent request gracefully", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      monitor.trackStage("non-existent-id", "test", 100);
      monitor.trackResource("non-existent-id", "openaiCalls", 1);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });

    test("should handle completion of non-existent request", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const result = monitor.completeRequest("non-existent-id");

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Performance Thresholds", () => {
    test("should detect slow stages and log warnings", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
      const errorSpy = jest.spyOn(console, "error").mockImplementation();

      const requestId = monitor.startRequest("testOperation");

      // Should trigger warning
      monitor.trackStage(requestId, "embeddingGeneration", 3000);

      // Should trigger critical alert
      monitor.trackStage(requestId, "vectorSearch", 4000);

      expect(consoleSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});

// Mock console methods for testing
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
