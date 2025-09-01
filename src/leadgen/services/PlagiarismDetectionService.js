const axios = require("axios");
const crypto = require("crypto");
const WebSearchService = require("./WebSearchService");
const TextSimilarityService = require("./TextSimilarityService");
const ContentAnalysisService = require("./ContentAnalysisService");
const URLContentExtractor = require("./URLContentExtractor");

/**
 * @description Custom plagiarism detection service (Copyscape clone)
 * @class PlagiarismDetectionService
 */
class PlagiarismDetectionService {
  constructor() {
    // Initialize sub-services
    this.webSearchService = new WebSearchService();
    this.textSimilarityService = new TextSimilarityService();
    this.contentAnalysisService = new ContentAnalysisService();
    this.urlContentExtractor = new URLContentExtractor();

    // Configuration
    this.maxSearchResults =
      parseInt(process.env.PLAGIARISM_MAX_SEARCH_RESULTS) || 10;
    this.maxConcurrentChecks =
      parseInt(process.env.PLAGIARISM_MAX_CONCURRENT_CHECKS) || 5;
    this.minSimilarityThreshold =
      parseFloat(process.env.PLAGIARISM_MIN_SIMILARITY_THRESHOLD) || 0.1; // Lowered for testing

    // Track usage
    this.checksPerformed = 0;
    this.lastCheck = null;

    // Cache for processed URLs to avoid duplicate processing
    this.processedUrls = new Set();
  }

  /**
   * Check text content for plagiarism
   * @param {string} text - Text content to check
   * @param {Object} options - Additional options
   * @returns {Object} Plagiarism check result
   */
  async checkTextContent(text, options = {}) {
    try {
      const startTime = Date.now();

      // Analyze and prepare text for searching
      const analysis = await this.contentAnalysisService.analyzeText(text);

      // Extract key phrases for searching
      const searchQueries = this.contentAnalysisService.extractSearchQueries(
        text,
        {
          maxQueries: options.maxQueries || 5,
          minPhraseLength: options.minPhraseLength || 4,
        }
      );

      console.log(
        `Generated ${searchQueries.length} search queries for plagiarism check`
      );

      // Search for potential matches
      const searchResults = await this.searchForMatches(searchQueries, options);
      console.log(
        `Found ${searchResults.length} URLs to check:`,
        searchResults.map((url) => url.substring(0, 50))
      );

      // Extract content from found URLs
      const contentMatches = await this.extractAndCompareContent(
        text,
        searchResults,
        options
      );
      console.log("Content matches found:", { count: contentMatches.length });

      // Calculate final plagiarism score
      const plagiarismResult = this.calculatePlagiarismScore(
        text,
        contentMatches,
        analysis
      );

      // Track usage
      this.checksPerformed++;
      this.lastCheck = new Date().toISOString();

      return {
        score: plagiarismResult.score,
        matches: plagiarismResult.matches,
        analysis: {
          totalWords: analysis.wordCount,
          totalSentences: analysis.sentenceCount,
          keyPhrases: analysis.keyPhrases.length,
          searchQueries: searchQueries.length,
          urlsChecked: searchResults.length,
          processingTime: Date.now() - startTime,
        },
        originalContent: text,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("PlagiarismDetectionService: Text check error:", error);
      throw this.handleDetectionError(error);
    }
  }

  /**
   * Check URL content for plagiarism
   * @param {string} url - URL to check
   * @param {Object} options - Additional options
   * @returns {Object} Plagiarism check result
   */
  async checkUrlContent(url, options = {}) {
    try {
      // Extract content from the URL
      const extractedContent = await this.urlContentExtractor.extractContent(
        url
      );

      // Check the extracted text for plagiarism
      const result = await this.checkTextContent(
        extractedContent.text,
        options
      );

      // Add URL-specific metadata
      result.sourceUrl = url;
      result.extractedMetadata = extractedContent.metadata;

      return result;
    } catch (error) {
      console.error("PlagiarismDetectionService: URL check error:", error);
      throw this.handleDetectionError(error);
    }
  }

  /**
   * Search for potential matches using multiple search engines
   * @param {Array} searchQueries - Array of search queries
   * @param {Object} options - Search options
   * @returns {Array} Array of URLs to check
   */
  async searchForMatches(searchQueries, options = {}) {
    const allUrls = new Set();
    const excludeUrls = new Set(options.excludeUrls || []);

    try {
      // Search using multiple queries
      for (const query of searchQueries.slice(0, 3)) {
        // Limit to top 3 queries
        try {
          const results = await this.webSearchService.search(query, {
            maxResults: Math.ceil(this.maxSearchResults / searchQueries.length),
            excludeDomains: Array.from(excludeUrls),
          });

          results.forEach((result) => {
            if (
              !excludeUrls.has(result.url) &&
              !this.processedUrls.has(result.url)
            ) {
              allUrls.add(result.url);
            }
          });

          // Add small delay between searches to be respectful
          await this.delay(500);
        } catch (searchError) {
          // Fix format string vulnerability by using structured logging
          console.warn("Search failed for query:", {
            query: String(query).substring(0, 100), // Limit query length for logging
            error: searchError.message,
            timestamp: new Date().toISOString(),
          });
        }
      }

      return Array.from(allUrls).slice(0, this.maxSearchResults);
    } catch (error) {
      console.error("Error searching for matches:", error);
      return [];
    }
  }

  /**
   * Extract content from URLs and compare with original text
   * @param {string} originalText - Original text to compare against
   * @param {Array} urls - URLs to extract content from
   * @param {Object} options - Comparison options
   * @returns {Array} Array of content matches
   */
  async extractAndCompareContent(originalText, urls, options = {}) {
    const matches = [];
    const concurrencyLimit = this.maxConcurrentChecks;

    // Process URLs in batches to avoid overwhelming servers
    for (let i = 0; i < urls.length; i += concurrencyLimit) {
      const batch = urls.slice(i, i + concurrencyLimit);

      const batchPromises = batch.map(async (url) => {
        try {
          // Extract content from URL
          const extractedContent =
            await this.urlContentExtractor.extractContent(url);

          // Compare with original text
          const similarity =
            await this.textSimilarityService.calculateSimilarity(
              originalText,
              extractedContent.text
            );

          console.log("Similarity analysis:", {
            url: String(url).substring(0, 100),
            similarity: similarity.overallScore,
            threshold: this.minSimilarityThreshold,
            originalTextPreview: String(originalText).substring(0, 100),
            extractedTextPreview: String(extractedContent.text).substring(
              0,
              100
            ),
          });

          // Only include if similarity is above threshold
          if (similarity.overallScore >= this.minSimilarityThreshold) {
            const matchDetails =
              await this.textSimilarityService.findMatchingSegments(
                originalText,
                extractedContent.text
              );

            return {
              url,
              title: extractedContent.metadata.title || "Untitled",
              similarityScore: Math.round(similarity.overallScore * 100),
              matchType: this.determineMatchType(similarity.overallScore),
              matchedSegments: matchDetails.segments,
              matchedText: matchDetails.longestMatch,
              contextBefore: matchDetails.contextBefore,
              contextAfter: matchDetails.contextAfter,
              wordCount: matchDetails.matchedWordCount,
              characterCount: matchDetails.matchedCharCount,
              similarity: similarity,
            };
          }

          return null;
        } catch (error) {
          console.warn("Failed to process URL:", {
            url: String(url).substring(0, 100),
            error: error.message,
          });
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      matches.push(...batchResults.filter((result) => result !== null));

      // Add delay between batches
      if (i + concurrencyLimit < urls.length) {
        await this.delay(1000);
      }
    }

    // Sort by similarity score (highest first)
    return matches.sort((a, b) => b.similarityScore - a.similarityScore);
  }

  /**
   * Calculate final plagiarism score based on all matches
   * @param {string} originalText - Original text
   * @param {Array} matches - Array of content matches
   * @param {Object} analysis - Text analysis results
   * @returns {Object} Final plagiarism result
   */
  calculatePlagiarismScore(originalText, matches, analysis) {
    if (matches.length === 0) {
      return {
        score: 0,
        matches: [],
        riskLevel: "minimal",
      };
    }

    // Calculate weighted plagiarism score
    const totalWords = analysis.wordCount;
    let totalMatchedWords = 0;
    let weightedScore = 0;

    // Process each match
    const processedMatches = matches.map((match) => {
      const matchWeight = match.wordCount / totalWords;
      const adjustedScore = match.similarityScore * matchWeight;

      weightedScore += adjustedScore;
      totalMatchedWords += match.wordCount;

      return {
        ...match,
        weight: matchWeight,
        contribution: adjustedScore,
      };
    });

    // Calculate final score (ensure it doesn't exceed 100)
    let finalScore = Math.min(100, Math.round(weightedScore));

    // Apply penalties for multiple sources
    if (matches.length > 1) {
      const multiSourcePenalty = Math.min(10, matches.length * 2);
      finalScore = Math.min(100, finalScore + multiSourcePenalty);
    }

    // Apply bonus for high-similarity matches
    const highSimilarityMatches = matches.filter(
      (m) => m.similarityScore >= 80
    );
    if (highSimilarityMatches.length > 0) {
      const highSimilarityBonus = Math.min(
        15,
        highSimilarityMatches.length * 5
      );
      finalScore = Math.min(100, finalScore + highSimilarityBonus);
    }

    return {
      score: finalScore,
      matches: processedMatches,
      riskLevel: this.calculateRiskLevel(finalScore),
      statistics: {
        totalMatches: matches.length,
        totalMatchedWords,
        matchedPercentage: Math.round((totalMatchedWords / totalWords) * 100),
        highSimilarityMatches: highSimilarityMatches.length,
        averageSimilarity: Math.round(
          matches.reduce((sum, m) => sum + m.similarityScore, 0) /
            matches.length
        ),
      },
    };
  }

  /**
   * Determine match type based on similarity score
   * @param {number} score - Similarity score (0-1)
   * @returns {string} Match type
   */
  determineMatchType(score) {
    if (score >= 0.9) return "exact";
    if (score >= 0.7) return "near-exact";
    if (score >= 0.5) return "partial";
    return "paraphrase";
  }

  /**
   * Calculate risk level based on plagiarism score
   * @param {number} score - Plagiarism score (0-100)
   * @returns {string} Risk level
   */
  calculateRiskLevel(score) {
    if (score >= 80) return "high";
    if (score >= 50) return "medium";
    if (score >= 20) return "low";
    return "minimal";
  }

  /**
   * Get account/service information
   * @returns {Object} Service information
   */
  async getAccountInfo() {
    return {
      service: "Custom Plagiarism Detection",
      checksPerformed: this.checksPerformed,
      lastCheck: this.lastCheck,
      status: "active",
      features: [
        "Multi-engine web search",
        "Advanced text similarity analysis",
        "Real-time content extraction",
        "Comprehensive reporting",
      ],
    };
  }

  /**
   * Validate service configuration
   * @returns {Object} Validation result
   */
  async validateCredentials() {
    try {
      // Test web search functionality
      const testResult = await this.webSearchService.search("test query", {
        maxResults: 1,
      });

      return {
        valid: true,
        searchEngines: this.webSearchService.getAvailableEngines(),
        message: "Plagiarism detection service is operational",
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        message: "Service configuration error",
      };
    }
  }

  /**
   * Health check for plagiarism detection service
   * @returns {Object} Health status
   */
  async healthCheck() {
    try {
      const startTime = Date.now();

      // Test all sub-services
      const webSearchHealth = await this.webSearchService.healthCheck();
      const textSimilarityHealth = this.textSimilarityService.healthCheck();
      const contentAnalysisHealth = this.contentAnalysisService.healthCheck();

      const responseTime = Date.now() - startTime;

      const allHealthy =
        webSearchHealth.healthy &&
        textSimilarityHealth.healthy &&
        contentAnalysisHealth.healthy;

      return {
        healthy: allHealthy,
        responseTime,
        services: {
          webSearch: webSearchHealth,
          textSimilarity: textSimilarityHealth,
          contentAnalysis: contentAnalysisHealth,
        },
        checksPerformed: this.checksPerformed,
        lastCheck: this.lastCheck,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        checksPerformed: this.checksPerformed,
        lastCheck: this.lastCheck,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Handle detection errors
   * @param {Error} error - Original error
   * @returns {Error} Formatted error
   */
  handleDetectionError(error) {
    if (error.code === "SEARCH_ENGINE_ERROR") {
      const searchError = new Error("Web search service unavailable");
      searchError.code = "PLAGIARISM_SEARCH_ERROR";
      return searchError;
    }

    if (error.code === "URL_EXTRACTION_ERROR") {
      const extractionError = new Error("Content extraction failed");
      extractionError.code = "PLAGIARISM_EXTRACTION_ERROR";
      return extractionError;
    }

    if (error.code === "RATE_LIMIT_ERROR") {
      const rateLimitError = new Error(
        "Rate limit exceeded for plagiarism checking"
      );
      rateLimitError.code = "PLAGIARISM_RATE_LIMIT";
      rateLimitError.retryAfter = 60;
      return rateLimitError;
    }

    // Generic detection error
    const detectionError = new Error(
      `Plagiarism detection failed: ${error.message}`
    );
    detectionError.code = "PLAGIARISM_DETECTION_ERROR";
    return detectionError;
  }

  /**
   * Utility function to add delays
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = PlagiarismDetectionService;
