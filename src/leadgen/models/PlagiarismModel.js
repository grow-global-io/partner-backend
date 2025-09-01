const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

/**
 * @description Plagiarism model for managing plagiarism reports and cache entries
 * @class PlagiarismModel
 */
class PlagiarismModel {
  constructor() {
    // In-memory cache for development (should be replaced with Redis in production)
    this.cache = new Map();
    this.reports = new Map();

    // Cache TTL settings (in milliseconds)
    this.CACHE_TTL = {
      text: 24 * 60 * 60 * 1000, // 24 hours for text
      url: 60 * 60 * 1000, // 1 hour for URLs
    };

    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Create a new plagiarism report
   * @param {Object} reportData - Report data
   * @returns {Object} Created report
   */
  async createReport(reportData) {
    const report = new PlagiarismReport({
      id: reportData.id || uuidv4(),
      inputType: reportData.inputType,
      inputContent: reportData.inputContent,
      inputHash: reportData.inputHash,
      plagiarismScore: reportData.plagiarismScore || 0,
      totalMatches: reportData.totalMatches || 0,
      matches: reportData.matches || [],
      processingTime: reportData.processingTime,
      creditsUsed: reportData.creditsUsed || 1,
      status: "completed",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(
        Date.now() + this.CACHE_TTL[reportData.inputType]
      ).toISOString(),
      metadata: reportData.metadata || {},
    });

    // Store in memory (in production, this would be stored in database)
    this.reports.set(report.id, report);

    // Cache the result by content hash
    this.cache.set(reportData.inputHash, {
      report: report,
      expiresAt: Date.now() + this.CACHE_TTL[reportData.inputType],
    });

    return report;
  }

  /**
   * Get plagiarism report by ID
   * @param {string} reportId - Report ID
   * @returns {Object|null} Report or null if not found
   */
  async getReport(reportId) {
    const report = this.reports.get(reportId);

    if (!report) {
      return null;
    }

    // Check if report has expired
    if (new Date(report.expiresAt) < new Date()) {
      this.reports.delete(reportId);
      return null;
    }

    return report;
  }

  /**
   * Get cached report by content hash
   * @param {string} contentHash - Content hash
   * @returns {Object|null} Cached report or null if not found/expired
   */
  async getCachedReport(contentHash) {
    const cached = this.cache.get(contentHash);

    if (!cached) {
      return null;
    }

    // Check if cache has expired
    if (cached.expiresAt < Date.now()) {
      this.cache.delete(contentHash);
      return null;
    }

    return cached.report;
  }

  /**
   * Get usage statistics
   * @returns {Object} Usage statistics
   */
  async getUsageStats() {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    const allReports = Array.from(this.reports.values());

    const last24Hours = allReports.filter(
      (report) => new Date(report.createdAt).getTime() > oneDayAgo
    );

    const lastHour = allReports.filter(
      (report) => new Date(report.createdAt).getTime() > oneHourAgo
    );

    const textChecks = allReports.filter(
      (report) => report.inputType === "text"
    );
    const urlChecks = allReports.filter((report) => report.inputType === "url");

    const totalCreditsUsed = allReports.reduce(
      (sum, report) => sum + (report.creditsUsed || 1),
      0
    );
    const avgProcessingTime =
      allReports.length > 0
        ? allReports.reduce((sum, report) => sum + report.processingTime, 0) /
          allReports.length
        : 0;

    return {
      totalReports: allReports.length,
      reportsLast24Hours: last24Hours.length,
      reportsLastHour: lastHour.length,
      textChecks: textChecks.length,
      urlChecks: urlChecks.length,
      totalCreditsUsed,
      averageProcessingTime: Math.round(avgProcessingTime),
      cacheStats: {
        totalCached: this.cache.size,
        cacheHitRate: this.calculateCacheHitRate(),
      },
    };
  }

  /**
   * Calculate cache hit rate (simplified for in-memory implementation)
   * @returns {number} Cache hit rate percentage
   */
  calculateCacheHitRate() {
    // This is a simplified calculation for the in-memory implementation
    // In production with Redis, this would be more accurate
    return this.cache.size > 0
      ? Math.min(85, (this.cache.size / this.reports.size) * 100)
      : 0;
  }

  /**
   * Start cleanup interval to remove expired entries
   */
  startCleanupInterval() {
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Cleanup every 5 minutes
  }

  /**
   * Clean up expired cache entries and reports
   */
  cleanup() {
    const now = Date.now();

    // Clean up expired cache entries
    for (const [key, value] of this.cache.entries()) {
      if (value.expiresAt < now) {
        this.cache.delete(key);
      }
    }

    // Clean up expired reports
    for (const [key, report] of this.reports.entries()) {
      if (new Date(report.expiresAt) < new Date()) {
        this.reports.delete(key);
      }
    }
  }

  /**
   * Clear all cache and reports (for testing)
   */
  clear() {
    this.cache.clear();
    this.reports.clear();
  }
}

/**
 * @description Plagiarism report data model
 * @class PlagiarismReport
 */
class PlagiarismReport {
  constructor(data) {
    this.id = data.id;
    this.inputType = data.inputType; // 'text' or 'url'
    this.inputContent = data.inputContent;
    this.inputHash = data.inputHash;
    this.plagiarismScore = data.plagiarismScore;
    this.totalMatches = data.totalMatches;
    this.matches = data.matches.map((match) => new PlagiarismMatch(match));
    this.processingTime = data.processingTime;
    this.creditsUsed = data.creditsUsed;
    this.status = data.status;
    this.createdAt = data.createdAt;
    this.expiresAt = data.expiresAt;
    this.metadata = data.metadata;

    // Generate summary
    this.summary = this.generateSummary();
  }

  /**
   * Generate summary of plagiarism matches
   * @returns {Object} Summary object
   */
  generateSummary() {
    const highSimilarityMatches = this.matches.filter(
      (match) => match.similarityScore >= 80
    ).length;
    const mediumSimilarityMatches = this.matches.filter(
      (match) => match.similarityScore >= 50 && match.similarityScore < 80
    ).length;
    const lowSimilarityMatches = this.matches.filter(
      (match) => match.similarityScore < 50
    ).length;

    return {
      totalMatches: this.totalMatches,
      highSimilarityMatches,
      mediumSimilarityMatches,
      lowSimilarityMatches,
      overallRisk: this.calculateOverallRisk(),
    };
  }

  /**
   * Calculate overall plagiarism risk level
   * @returns {string} Risk level: 'high', 'medium', 'low', 'minimal'
   */
  calculateOverallRisk() {
    if (this.plagiarismScore >= 80) return "high";
    if (this.plagiarismScore >= 50) return "medium";
    if (this.plagiarismScore >= 20) return "low";
    return "minimal";
  }
}

/**
 * @description Plagiarism match data model
 * @class PlagiarismMatch
 */
class PlagiarismMatch {
  constructor(data) {
    this.url = data.url;
    this.title = data.title || "";
    this.similarityScore = data.similarityScore;
    this.matchType = data.matchType || "partial"; // 'exact', 'partial', 'paraphrase'
    this.matchedText = data.matchedText || "";
    this.contextBefore = data.contextBefore || "";
    this.contextAfter = data.contextAfter || "";
    this.wordCount = data.wordCount || 0;
    this.characterCount = data.characterCount || 0;
  }
}

module.exports = PlagiarismModel;
