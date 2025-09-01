const { v4: uuidv4 } = require("uuid");
const PlagiarismDetectionService = require("../services/PlagiarismDetectionService");
const PlagiarismModel = require("../models/PlagiarismModel");
const PerformanceMonitor = require("../services/PerformanceMonitor");
const URLContentExtractor = require("../services/URLContentExtractor");
const crypto = require("crypto");

/**
 * @description Plagiarism controller for managing plagiarism checking via Copyscape API
 * @class PlagiarismController
 */
class PlagiarismController {
  constructor() {
    // No external API keys required - our plagiarism detection works independently
    console.log("Initializing custom plagiarism detection service...");

    this.plagiarismDetectionService = new PlagiarismDetectionService();
    this.plagiarismModel = new PlagiarismModel();
    this.performanceMonitor = new PerformanceMonitor();
    this.urlContentExtractor = new URLContentExtractor();

    // Bind methods to maintain context
    this.checkText = this.checkText.bind(this);
    this.checkUrl = this.checkUrl.bind(this);
    this.getReport = this.getReport.bind(this);
    this.getHealthStatus = this.getHealthStatus.bind(this);
    this.getUsageStats = this.getUsageStats.bind(this);
  }

  /**
   * Check text content for plagiarism
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async checkText(req, res) {
    const startTime = Date.now();
    const requestId = uuidv4();
    const perfRequestId = this.performanceMonitor.startRequest("checkText", {
      inputType: "text",
    });

    try {
      const { text, options = {} } = req.body;

      // Generate content hash for caching
      const contentHash = crypto
        .createHash("sha256")
        .update(text)
        .digest("hex");

      // Check cache first
      const cachedResult = await this.plagiarismModel.getCachedReport(
        contentHash
      );
      if (cachedResult) {
        return res.json({
          success: true,
          data: cachedResult,
          metadata: {
            cached: true,
            processingTime: Date.now() - startTime,
          },
        });
      }

      // Process through our plagiarism detection engine
      const plagiarismResult =
        await this.plagiarismDetectionService.checkTextContent(text, options);

      // Create report
      const report = await this.plagiarismModel.createReport({
        id: requestId,
        inputType: "text",
        inputContent: text,
        inputHash: contentHash,
        plagiarismScore: plagiarismResult.score,
        totalMatches: plagiarismResult.matches.length,
        matches: plagiarismResult.matches,
        processingTime: Date.now() - startTime,
        creditsUsed: plagiarismResult.creditsUsed || 1,
      });

      // Track performance
      this.performanceMonitor.completeRequest(perfRequestId, { success: true });

      return res.json({
        success: true,
        data: report,
        metadata: {
          cached: false,
          processingTime: Date.now() - startTime,
        },
      });
    } catch (error) {
      console.error("PlagiarismController: Text check error:", error);
      this.performanceMonitor.completeRequest(perfRequestId, {
        success: false,
        error: error.message,
      });

      return this.handleError(res, error);
    }
  }

  /**
   * Check URL content for plagiarism
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async checkUrl(req, res) {
    const startTime = Date.now();
    const requestId = uuidv4();
    const perfRequestId = this.performanceMonitor.startRequest("checkUrl", {
      inputType: "url",
    });

    try {
      const { url, options = {} } = req.body;

      // Extract content from URL
      const extractedContent = await this.urlContentExtractor.extractContent(
        url
      );

      // Generate content hash for caching
      const contentHash = crypto
        .createHash("sha256")
        .update(extractedContent.text)
        .digest("hex");

      // Check cache first
      const cachedResult = await this.plagiarismModel.getCachedReport(
        contentHash
      );
      if (cachedResult) {
        return res.json({
          success: true,
          data: {
            ...cachedResult,
            sourceUrl: url,
            extractedMetadata: extractedContent.metadata,
          },
          metadata: {
            cached: true,
            processingTime: Date.now() - startTime,
          },
        });
      }

      // Process through our plagiarism detection engine
      const plagiarismResult =
        await this.plagiarismDetectionService.checkUrlContent(url, options);

      // Create report
      const report = await this.plagiarismModel.createReport({
        id: requestId,
        inputType: "url",
        inputContent: url,
        inputHash: contentHash,
        plagiarismScore: plagiarismResult.score,
        totalMatches: plagiarismResult.matches.length,
        matches: plagiarismResult.matches,
        processingTime: Date.now() - startTime,
        creditsUsed: plagiarismResult.creditsUsed || 1,
        metadata: {
          sourceUrl: url,
          extractedContent: extractedContent,
        },
      });

      // Track performance
      this.performanceMonitor.completeRequest(perfRequestId, { success: true });

      return res.json({
        success: true,
        data: report,
        metadata: {
          cached: false,
          processingTime: Date.now() - startTime,
        },
      });
    } catch (error) {
      console.error("PlagiarismController: URL check error:", error);
      this.performanceMonitor.completeRequest(perfRequestId, {
        success: false,
        error: error.message,
      });

      return this.handleError(res, error);
    }
  }

  /**
   * Get plagiarism report by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getReport(req, res) {
    try {
      const { reportId } = req.params;

      const report = await this.plagiarismModel.getReport(reportId);

      if (!report) {
        return res.status(404).json({
          success: false,
          error: "Report not found",
          message:
            "The requested plagiarism report was not found or has expired",
          code: "REPORT_NOT_FOUND",
        });
      }

      return res.json({
        success: true,
        data: report,
      });
    } catch (error) {
      console.error("PlagiarismController: Get report error:", error);
      return this.handleError(res, error);
    }
  }

  /**
   * Get service health status
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getHealthStatus(req, res) {
    try {
      const healthStatus = await this.plagiarismDetectionService.healthCheck();

      return res.json({
        success: true,
        data: {
          status: healthStatus.healthy ? "healthy" : "unhealthy",
          plagiarismDetection: healthStatus,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("PlagiarismController: Health check error:", error);
      return res.status(503).json({
        success: false,
        error: "Health check failed",
        details: error.message,
      });
    }
  }

  /**
   * Get usage statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getUsageStats(req, res) {
    try {
      const stats = await this.plagiarismModel.getUsageStats();
      const performanceMetrics = this.performanceMonitor.getMetrics();

      return res.json({
        success: true,
        data: {
          usage: stats,
          performance: performanceMetrics,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("PlagiarismController: Usage stats error:", error);
      return this.handleError(res, error);
    }
  }

  /**
   * Handle errors and return appropriate response
   * @param {Object} res - Express response object
   * @param {Error} error - Error object
   */
  handleError(res, error) {
    // Plagiarism detection service specific errors
    if (error.code === "PLAGIARISM_DETECTION_ERROR") {
      return res.status(503).json({
        success: false,
        error: "Plagiarism detection service unavailable",
        message: "The plagiarism checking service is temporarily unavailable",
        code: "SERVICE_UNAVAILABLE",
      });
    }

    if (error.code === "SEARCH_ENGINE_ERROR") {
      return res.status(503).json({
        success: false,
        error: "Search service unavailable",
        message: "Web search service is temporarily unavailable",
        code: "SEARCH_UNAVAILABLE",
      });
    }

    if (error.code === "PLAGIARISM_RATE_LIMIT") {
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded",
        message: "Too many requests. Please try again later",
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: error.retryAfter || 60,
      });
    }

    // URL extraction errors
    if (error.code === "URL_EXTRACTION_ERROR") {
      return res.status(400).json({
        success: false,
        error: "URL content extraction failed",
        message: error.message,
        code: "URL_EXTRACTION_FAILED",
      });
    }

    // Generic server error
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "An unexpected error occurred while processing your request",
      code: "INTERNAL_ERROR",
    });
  }
}

module.exports = PlagiarismController;
