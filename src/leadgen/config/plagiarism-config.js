/**
 * @description Configuration for plagiarism checker service
 */

const plagiarismConfig = {
  // Search Engine API Configuration
  searchEngines: {
    google: {
      apiKey: process.env.GOOGLE_SEARCH_API_KEY,
      engineId: process.env.GOOGLE_SEARCH_ENGINE_ID,
      enabled:
        !!process.env.GOOGLE_SEARCH_API_KEY &&
        !!process.env.GOOGLE_SEARCH_ENGINE_ID,
    },
    bing: {
      apiKey: process.env.BING_SEARCH_API_KEY,
      enabled: !!process.env.BING_SEARCH_API_KEY,
    },
  },

  // Detection Configuration
  detection: {
    maxSearchResults: parseInt(process.env.PLAGIARISM_MAX_SEARCH_RESULTS) || 10,
    maxConcurrentChecks:
      parseInt(process.env.PLAGIARISM_MAX_CONCURRENT_CHECKS) || 5,
    minSimilarityThreshold:
      parseFloat(process.env.PLAGIARISM_MIN_SIMILARITY_THRESHOLD) || 0.3,
    timeout: parseInt(process.env.PLAGIARISM_DETECTION_TIMEOUT) || 30000,
  },

  // Content Processing Limits
  limits: {
    maxTextLength: parseInt(process.env.PLAGIARISM_MAX_TEXT_LENGTH) || 10000,
    maxUrlContentLength:
      parseInt(process.env.PLAGIARISM_MAX_URL_CONTENT_LENGTH) || 50000,
    minWordCount: parseInt(process.env.PLAGIARISM_MIN_WORD_COUNT) || 10,
    requestTimeout: parseInt(process.env.PLAGIARISM_REQUEST_TIMEOUT) || 15000,
  },

  // Cache Configuration
  cache: {
    textTtl:
      parseInt(process.env.PLAGIARISM_CACHE_TEXT_TTL) || 24 * 60 * 60 * 1000, // 24 hours
    urlTtl: parseInt(process.env.PLAGIARISM_CACHE_URL_TTL) || 60 * 60 * 1000, // 1 hour
    cleanupInterval:
      parseInt(process.env.PLAGIARISM_CACHE_CLEANUP_INTERVAL) || 5 * 60 * 1000, // 5 minutes
    maxCacheSize: parseInt(process.env.PLAGIARISM_MAX_CACHE_SIZE) || 1000,
  },

  // Security Configuration
  security: {
    allowedProtocols: ["http:", "https:"],
    blockedDomains: [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "169.254.169.254", // AWS metadata
      "10.0.0.0/8", // Private networks
      "172.16.0.0/12",
      "192.168.0.0/16",
    ],
    maxContentSize:
      parseInt(process.env.PLAGIARISM_MAX_CONTENT_SIZE) || 5 * 1024 * 1024, // 5MB
    rateLimitWindow:
      parseInt(process.env.PLAGIARISM_RATE_LIMIT_WINDOW) || 60 * 1000, // 1 minute
    rateLimitMax: parseInt(process.env.PLAGIARISM_RATE_LIMIT_MAX) || 10, // 10 requests per minute
  },

  // Scoring Configuration
  scoring: {
    highSimilarityThreshold:
      parseInt(process.env.PLAGIARISM_HIGH_SIMILARITY_THRESHOLD) || 80,
    mediumSimilarityThreshold:
      parseInt(process.env.PLAGIARISM_MEDIUM_SIMILARITY_THRESHOLD) || 50,
    lowSimilarityThreshold:
      parseInt(process.env.PLAGIARISM_LOW_SIMILARITY_THRESHOLD) || 20,
  },

  // Feature Flags
  features: {
    enableMockMode: process.env.PLAGIARISM_ENABLE_MOCK_MODE === "true",
    enableCaching: process.env.PLAGIARISM_ENABLE_CACHING !== "false",
    enableUrlExtraction:
      process.env.PLAGIARISM_ENABLE_URL_EXTRACTION !== "false",
    enableDetailedLogging:
      process.env.PLAGIARISM_ENABLE_DETAILED_LOGGING === "true",
  },
};

/**
 * Validate configuration and provide warnings for missing values
 */
function validateConfig() {
  const warnings = [];
  const errors = [];

  // Check search engine configurations
  if (
    !plagiarismConfig.searchEngines.google.enabled &&
    !plagiarismConfig.searchEngines.bing.enabled
  ) {
    warnings.push(
      "No search engine APIs configured - using DuckDuckGo only (limited functionality)"
    );
  }

  if (!plagiarismConfig.searchEngines.google.enabled) {
    warnings.push(
      "Google Search API not configured - consider adding for better results"
    );
  }

  // Validate numeric configurations
  if (plagiarismConfig.limits.maxTextLength < 100) {
    errors.push("PLAGIARISM_MAX_TEXT_LENGTH must be at least 100 characters");
  }

  if (plagiarismConfig.cache.textTtl < 60000) {
    warnings.push(
      "PLAGIARISM_CACHE_TEXT_TTL is very low (< 1 minute) - this may impact performance"
    );
  }

  if (plagiarismConfig.security.rateLimitMax < 1) {
    errors.push("PLAGIARISM_RATE_LIMIT_MAX must be at least 1");
  }

  // Log warnings and errors
  if (warnings.length > 0) {
    console.warn("Plagiarism Config Warnings:");
    warnings.forEach((warning) => console.warn(`  - ${warning}`));
  }

  if (errors.length > 0) {
    console.error("Plagiarism Config Errors:");
    errors.forEach((error) => console.error(`  - ${error}`));
    throw new Error("Invalid plagiarism configuration");
  }

  return {
    valid: errors.length === 0,
    warnings: warnings.length,
    errors: errors.length,
  };
}

/**
 * Get configuration with environment-specific overrides
 */
function getConfig() {
  const config = { ...plagiarismConfig };

  // Environment-specific overrides
  if (process.env.NODE_ENV === "development") {
    config.features.enableMockMode = true;
    config.features.enableDetailedLogging = true;
  }

  if (process.env.NODE_ENV === "production") {
    config.features.enableMockMode = false;
    config.features.enableDetailedLogging = false;
  }

  if (process.env.NODE_ENV === "test") {
    config.features.enableMockMode = true;
    config.cache.textTtl = 1000; // 1 second for tests
    config.cache.urlTtl = 1000;
  }

  return config;
}

module.exports = {
  plagiarismConfig,
  validateConfig,
  getConfig,
};
