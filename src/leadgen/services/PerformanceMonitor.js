const { v4: uuidv4 } = require("uuid");

/**
 * @description Performance monitoring service for tracking API performance metrics
 * @class PerformanceMonitor
 */
class PerformanceMonitor {
  constructor() {
    this.activeRequests = new Map();
    this.metrics = {
      requests: [],
      aggregated: {
        totalRequests: 0,
        averageResponseTime: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        errorRate: 0,
        cacheHitRate: 0,
        openaiApiCalls: 0,
        dbQueries: 0,
      },
    };

    // Performance thresholds for alerting
    this.thresholds = {
      responseTime: {
        warning: 5000, // 5 seconds
        critical: 10000, // 10 seconds
      },
      errorRate: {
        warning: 0.05, // 5%
        critical: 0.1, // 10%
      },
      cacheHitRate: {
        warning: 0.7, // 70%
        critical: 0.5, // 50%
      },
    };
  }

  /**
   * @description Start tracking a new request
   * @param {string} operation - Operation name (e.g., 'findLeads')
   * @param {Object} metadata - Additional request metadata
   * @returns {string} Request ID for tracking
   */
  startRequest(operation, metadata = {}) {
    const requestId = uuidv4();
    const startTime = Date.now();

    this.activeRequests.set(requestId, {
      id: requestId,
      operation,
      startTime,
      stages: {},
      resources: {
        openaiCalls: 0,
        dbQueries: 0,
        cacheHits: 0,
        cacheMisses: 0,
      },
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(
      `🚀 [${requestId}] Started ${operation} at ${new Date().toISOString()}`
    );
    return requestId;
  }

  /**
   * @description Track timing for a specific stage of request processing
   * @param {string} requestId - Request ID
   * @param {string} stage - Stage name (e.g., 'validation', 'embeddingGeneration')
   * @param {number} duration - Duration in milliseconds
   * @param {Object} metadata - Additional stage metadata
   */
  trackStage(requestId, stage, duration, metadata = {}) {
    const request = this.activeRequests.get(requestId);
    if (!request) {
      console.warn(`⚠️ Request ${requestId} not found for stage tracking`);
      return;
    }

    request.stages[stage] = {
      duration,
      timestamp: Date.now(),
      metadata,
    };

    console.log(`⏱️ [${requestId}] ${stage}: ${duration}ms`);

    // Check for stage-specific performance issues
    this.checkStagePerformance(requestId, stage, duration);
  }

  /**
   * @description Track resource usage (API calls, DB queries, cache operations)
   * @param {string} requestId - Request ID
   * @param {string} resourceType - Type of resource ('openaiCalls', 'dbQueries', 'cacheHits', 'cacheMisses')
   * @param {number} count - Number of resources used (default: 1)
   * @param {Object} metadata - Additional resource metadata
   */
  trackResource(requestId, resourceType, count = 1, metadata = {}) {
    const request = this.activeRequests.get(requestId);
    if (!request) {
      console.warn(`⚠️ Request ${requestId} not found for resource tracking`);
      return;
    }

    request.resources[resourceType] =
      (request.resources[resourceType] || 0) + count;

    if (metadata.details) {
      request.resources[`${resourceType}Details`] =
        request.resources[`${resourceType}Details`] || [];
      request.resources[`${resourceType}Details`].push({
        timestamp: Date.now(),
        count,
        ...metadata,
      });
    }

    console.log(
      `📊 [${requestId}] ${resourceType}: +${count} (total: ${request.resources[resourceType]})`
    );
  }

  /**
   * @description Complete request tracking and calculate final metrics
   * @param {string} requestId - Request ID
   * @param {Object} result - Request result information
   * @returns {Object} Complete performance metrics for the request
   */
  completeRequest(requestId, result = {}) {
    const request = this.activeRequests.get(requestId);
    if (!request) {
      console.warn(`⚠️ Request ${requestId} not found for completion`);
      return null;
    }

    const endTime = Date.now();
    const totalDuration = endTime - request.startTime;

    // Calculate stage percentages
    const stagePercentages = {};
    Object.entries(request.stages).forEach(([stage, data]) => {
      stagePercentages[stage] = ((data.duration / totalDuration) * 100).toFixed(
        1
      );
    });

    const completedRequest = {
      ...request,
      endTime,
      totalDuration,
      stagePercentages,
      result: {
        success: result.success !== false,
        error: result.error,
        resultsCount: result.resultsCount || 0,
        qualityScore: result.qualityScore || 0,
      },
    };

    // Store in metrics history
    this.metrics.requests.push(completedRequest);

    // Update aggregated metrics
    this.updateAggregatedMetrics();

    // Check performance thresholds
    this.checkPerformanceThresholds(completedRequest);

    // Clean up active request
    this.activeRequests.delete(requestId);

    console.log(`✅ [${requestId}] Completed in ${totalDuration}ms`);
    console.log(`📈 [${requestId}] Stage breakdown:`, stagePercentages);
    console.log(`🔧 [${requestId}] Resources:`, request.resources);

    return completedRequest;
  }

  /**
   * @description Track OpenAI API call performance
   * @param {string} requestId - Request ID
   * @param {string} operation - API operation ('embedding', 'chat')
   * @param {number} duration - Duration in milliseconds
   * @param {Object} metadata - API call metadata (tokens, model, etc.)
   */
  trackOpenAICall(requestId, operation, duration, metadata = {}) {
    this.trackResource(requestId, "openaiCalls", 1, {
      operation,
      duration,
      model: metadata.model,
      tokens: metadata.tokens,
      cost: metadata.cost,
      details: true,
    });

    // Track as a stage if it's a significant operation
    if (duration > 100) {
      // Only track calls longer than 100ms as stages
      this.trackStage(requestId, `openai_${operation}`, duration, metadata);
    }
  }

  /**
   * @description Track database query performance
   * @param {string} requestId - Request ID
   * @param {string} queryType - Type of query ('vectorSearch', 'create', 'update')
   * @param {number} duration - Duration in milliseconds
   * @param {Object} metadata - Query metadata
   */
  trackDatabaseQuery(requestId, queryType, duration, metadata = {}) {
    this.trackResource(requestId, "dbQueries", 1, {
      queryType,
      duration,
      rowsAffected: metadata.rowsAffected,
      details: true,
    });

    this.trackStage(requestId, `db_${queryType}`, duration, metadata);
  }

  /**
   * @description Track cache operations
   * @param {string} requestId - Request ID
   * @param {string} operation - Cache operation ('hit', 'miss', 'set')
   * @param {string} cacheType - Type of cache ('embedding', 'searchResults', 'scores')
   * @param {Object} metadata - Cache metadata
   */
  trackCacheOperation(requestId, operation, cacheType, metadata = {}) {
    const resourceType = operation === "hit" ? "cacheHits" : "cacheMisses";
    this.trackResource(requestId, resourceType, 1, {
      operation,
      cacheType,
      key: metadata.key,
      size: metadata.size,
      details: true,
    });
  }

  /**
   * @description Check stage performance against thresholds
   * @param {string} requestId - Request ID
   * @param {string} stage - Stage name
   * @param {number} duration - Duration in milliseconds
   * @private
   */
  checkStagePerformance(requestId, stage, duration) {
    // Define stage-specific thresholds
    const stageThresholds = {
      embeddingGeneration: { warning: 2000, critical: 5000 },
      vectorSearch: { warning: 1000, critical: 3000 },
      scoring: { warning: 1000, critical: 2000 },
      validation: { warning: 100, critical: 500 },
    };

    const threshold = stageThresholds[stage];
    if (!threshold) return;

    if (duration > threshold.critical) {
      console.error(
        `🚨 [${requestId}] CRITICAL: ${stage} took ${duration}ms (threshold: ${threshold.critical}ms)`
      );
    } else if (duration > threshold.warning) {
      console.warn(
        `⚠️ [${requestId}] WARNING: ${stage} took ${duration}ms (threshold: ${threshold.warning}ms)`
      );
    }
  }

  /**
   * @description Update aggregated performance metrics
   * @private
   */
  updateAggregatedMetrics() {
    const recentRequests = this.metrics.requests.slice(-100); // Last 100 requests

    if (recentRequests.length === 0) return;

    const durations = recentRequests
      .map((r) => r.totalDuration)
      .sort((a, b) => a - b);
    const successfulRequests = recentRequests.filter((r) => r.result.success);
    const totalCacheOperations = recentRequests.reduce(
      (sum, r) =>
        sum + (r.resources.cacheHits || 0) + (r.resources.cacheMisses || 0),
      0
    );
    const totalCacheHits = recentRequests.reduce(
      (sum, r) => sum + (r.resources.cacheHits || 0),
      0
    );

    this.metrics.aggregated = {
      totalRequests: this.metrics.requests.length,
      averageResponseTime: Math.round(
        durations.reduce((sum, d) => sum + d, 0) / durations.length
      ),
      p50: durations[Math.floor(durations.length * 0.5)],
      p95: durations[Math.floor(durations.length * 0.95)],
      p99: durations[Math.floor(durations.length * 0.99)],
      errorRate:
        (recentRequests.length - successfulRequests.length) /
        recentRequests.length,
      cacheHitRate:
        totalCacheOperations > 0 ? totalCacheHits / totalCacheOperations : 0,
      openaiApiCalls: recentRequests.reduce(
        (sum, r) => sum + (r.resources.openaiCalls || 0),
        0
      ),
      dbQueries: recentRequests.reduce(
        (sum, r) => sum + (r.resources.dbQueries || 0),
        0
      ),
    };
  }

  /**
   * @description Check performance against thresholds and trigger alerts
   * @param {Object} request - Completed request object
   * @private
   */
  checkPerformanceThresholds(request) {
    const { totalDuration } = request;
    const { aggregated } = this.metrics;

    // Check response time
    if (totalDuration > this.thresholds.responseTime.critical) {
      console.error(
        `🚨 CRITICAL: Request ${request.id} exceeded critical response time: ${totalDuration}ms`
      );
    } else if (totalDuration > this.thresholds.responseTime.warning) {
      console.warn(
        `⚠️ WARNING: Request ${request.id} exceeded warning response time: ${totalDuration}ms`
      );
    }

    // Check error rate
    if (aggregated.errorRate > this.thresholds.errorRate.critical) {
      console.error(
        `🚨 CRITICAL: Error rate is ${(aggregated.errorRate * 100).toFixed(1)}%`
      );
    } else if (aggregated.errorRate > this.thresholds.errorRate.warning) {
      console.warn(
        `⚠️ WARNING: Error rate is ${(aggregated.errorRate * 100).toFixed(1)}%`
      );
    }

    // Check cache hit rate
    if (aggregated.cacheHitRate < this.thresholds.cacheHitRate.critical) {
      console.error(
        `🚨 CRITICAL: Cache hit rate is ${(
          aggregated.cacheHitRate * 100
        ).toFixed(1)}%`
      );
    } else if (aggregated.cacheHitRate < this.thresholds.cacheHitRate.warning) {
      console.warn(
        `⚠️ WARNING: Cache hit rate is ${(
          aggregated.cacheHitRate * 100
        ).toFixed(1)}%`
      );
    }
  }

  /**
   * @description Get current performance metrics
   * @returns {Object} Current performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeRequests: this.activeRequests.size,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * @description Get detailed performance report
   * @returns {Object} Detailed performance report
   */
  getPerformanceReport() {
    const metrics = this.getMetrics();
    const recentRequests = metrics.requests.slice(-50);

    // Calculate stage performance breakdown
    const stageStats = {};
    recentRequests.forEach((request) => {
      Object.entries(request.stages).forEach(([stage, data]) => {
        if (!stageStats[stage]) {
          stageStats[stage] = { durations: [], count: 0 };
        }
        stageStats[stage].durations.push(data.duration);
        stageStats[stage].count++;
      });
    });

    // Calculate averages for each stage
    Object.keys(stageStats).forEach((stage) => {
      const durations = stageStats[stage].durations.sort((a, b) => a - b);
      stageStats[stage].average = Math.round(
        durations.reduce((sum, d) => sum + d, 0) / durations.length
      );
      stageStats[stage].p95 = durations[Math.floor(durations.length * 0.95)];
    });

    return {
      summary: metrics.aggregated,
      stagePerformance: stageStats,
      recentRequests: recentRequests.slice(-10).map((r) => ({
        id: r.id,
        operation: r.operation,
        duration: r.totalDuration,
        success: r.result.success,
        timestamp: r.metadata.timestamp,
      })),
      recommendations: this.generateRecommendations(metrics, stageStats),
    };
  }

  /**
   * @description Generate performance optimization recommendations
   * @param {Object} metrics - Current metrics
   * @param {Object} stageStats - Stage performance statistics
   * @returns {Array} Array of recommendations
   * @private
   */
  generateRecommendations(metrics, stageStats) {
    const recommendations = [];

    // Response time recommendations
    if (metrics.aggregated.p95 > 8000) {
      recommendations.push({
        type: "critical",
        category: "response_time",
        message:
          "P95 response time exceeds 8 seconds. Consider implementing caching and parallel processing.",
        priority: 1,
      });
    }

    // Cache recommendations
    if (metrics.aggregated.cacheHitRate < 0.6) {
      recommendations.push({
        type: "warning",
        category: "caching",
        message:
          "Cache hit rate is below 60%. Review cache key strategies and TTL settings.",
        priority: 2,
      });
    }

    // Stage-specific recommendations
    if (
      stageStats.embeddingGeneration &&
      stageStats.embeddingGeneration.average > 3000
    ) {
      recommendations.push({
        type: "warning",
        category: "embedding",
        message:
          "Embedding generation is slow. Consider batching API calls and implementing embedding cache.",
        priority: 2,
      });
    }

    if (stageStats.vectorSearch && stageStats.vectorSearch.average > 2000) {
      recommendations.push({
        type: "warning",
        category: "database",
        message:
          "Vector search is slow. Check database indexes and consider query optimization.",
        priority: 2,
      });
    }

    return recommendations.sort((a, b) => a.priority - b.priority);
  }

  /**
   * @description Clear old metrics to prevent memory leaks
   * @param {number} maxAge - Maximum age in milliseconds (default: 1 hour)
   */
  cleanup(maxAge = 3600000) {
    const cutoff = Date.now() - maxAge;
    this.metrics.requests = this.metrics.requests.filter(
      (request) => request.endTime > cutoff
    );

    console.log(
      `🧹 Cleaned up old metrics, kept ${this.metrics.requests.length} recent requests`
    );
  }
}

module.exports = PerformanceMonitor;
