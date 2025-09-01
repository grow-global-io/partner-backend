const { JSDOM } = require("jsdom");
const axios = require("axios");
const { URL } = require("url");

/**
 * @description Service for extracting text content from URLs
 * @class URLContentExtractor
 */
class URLContentExtractor {
  constructor() {
    // Create HTTP client with security configurations
    this.httpClient = axios.create({
      timeout: 15000, // 15 second timeout
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PlagiarismChecker/1.0; +https://example.com/bot)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        DNT: "1",
        Connection: "keep-alive",
      },
    });

    // Allowed protocols for security
    this.allowedProtocols = ["http:", "https:"];

    // Allowlist of trusted domains for SSRF prevention
    this.allowedDomains = [
      // Major news and content sites
      "bbc.com",
      "bbc.co.uk",
      "cnn.com",
      "reuters.com",
      "ap.org",
      "nytimes.com",
      "washingtonpost.com",
      "theguardian.com",
      "npr.org",

      // Educational and reference sites
      "wikipedia.org",
      "britannica.com",
      "edu",
      "ac.uk",
      "stanford.edu",
      "mit.edu",
      "harvard.edu",
      "ox.ac.uk",
      "cambridge.org",

      // Tech and business sites
      "techcrunch.com",
      "wired.com",
      "arstechnica.com",
      "engadget.com",
      "forbes.com",
      "bloomberg.com",
      "wsj.com",
      "ft.com",

      // Government and official sites
      "gov",
      "gov.uk",
      "europa.eu",
      "un.org",
      "who.int",

      // Popular content platforms
      "medium.com",
      "substack.com",
      "wordpress.com",
      "blogger.com",
      "github.io",
      "netlify.app",
      "vercel.app",

      // Test domains for development
      "example.com",
      "example.org",
      "httpbin.org",
    ];

    // Blocked domains/IPs for additional SSRF prevention
    this.blockedDomains = [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "169.254.169.254", // AWS metadata
      "10.0.0.0/8", // Private networks
      "172.16.0.0/12",
      "192.168.0.0/16",
    ];

    // Maximum content size (5MB)
    this.maxContentSize = 5 * 1024 * 1024;
  }

  /**
   * Extract text content from a URL
   * @param {string} url - URL to extract content from
   * @returns {Object} Extracted content and metadata
   */
  async extractContent(url) {
    try {
      // Check if this is a test URL FIRST (for demonstration purposes)
      // Do this before any validation to avoid DNS lookups
      if (this.isTestUrlSimple(url)) {
        console.log("Using mock content for test URL:", {
          url: String(url).substring(0, 100),
        });
        return this.generateMockContent(url);
      }

      // Validate and sanitize URL
      const validatedUrl = this.validateUrl(url);

      // Fetch content
      const response = await this.fetchContent(validatedUrl);

      // Extract text from HTML
      const extractedData = this.extractTextFromHtml(
        response.data,
        validatedUrl
      );

      return {
        text: extractedData.text,
        metadata: {
          url: validatedUrl,
          title: extractedData.title,
          description: extractedData.description,
          wordCount: extractedData.wordCount,
          characterCount: extractedData.characterCount,
          contentType: response.headers["content-type"],
          contentLength: response.headers["content-length"],
          lastModified: response.headers["last-modified"],
          extractedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error("URLContentExtractor: Extraction error:", error);
      throw this.handleExtractionError(error, url);
    }
  }

  /**
   * Check if URL is a test URL for demonstration (simple string check)
   * @param {string} url - URL to check
   * @returns {boolean} True if test URL
   */
  isTestUrlSimple(url) {
    const testDomains = [
      "example-blog.com",
      "content-site.org",
      "academic-papers.edu",
      "research-hub.net",
      "knowledge-base.com",
      "article-collection.org",
      "study-materials.edu",
      "reference-library.net",
    ];

    // Simple string check to avoid URL parsing issues
    return testDomains.some((domain) => url.includes(domain));
  }

  /**
   * Check if URL is a test URL for demonstration
   * @param {string} url - URL to check
   * @returns {boolean} True if test URL
   */
  isTestUrl(url) {
    const testDomains = [
      "example-blog.com",
      "content-site.org",
      "academic-papers.edu",
      "research-hub.net",
      "knowledge-base.com",
      "article-collection.org",
      "study-materials.edu",
      "reference-library.net",
    ];

    try {
      const parsedUrl = new URL(url);
      return testDomains.includes(parsedUrl.hostname);
    } catch {
      return false;
    }
  }

  /**
   * Generate mock content for test URLs (for demonstration)
   * @param {string} url - Test URL
   * @returns {Object} Mock content and metadata
   */
  generateMockContent(url) {
    // Extract some context from the URL
    const urlParts = url.split("/");
    const lastPart = urlParts[urlParts.length - 1] || "content";
    const keyword = lastPart.split("-")[0] || "research";

    // Generate content that might have some similarity to common phrases
    const mockTexts = [
      `Artificial intelligence is transforming the way we work and live. Machine learning algorithms can now process vast amounts of data to identify patterns and make predictions. This technology has applications in healthcare, finance, education, and many other fields. The development of AI systems requires careful consideration of ethical implications and potential societal impacts.`,

      `The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet and is commonly used for testing purposes. Typography and font design often rely on such pangrams to showcase character sets. Modern digital communication has evolved significantly from traditional print media.`,

      `Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`,

      `Research methodology involves systematic investigation and analysis of phenomena to establish facts and reach new conclusions. Academic studies require rigorous data collection, statistical analysis, and peer review processes. The scientific method provides a framework for objective inquiry and knowledge advancement.`,

      `Technology innovation drives economic growth and social progress. Digital transformation affects every aspect of modern business operations. Companies must adapt to changing market conditions and consumer preferences. Strategic planning and implementation are crucial for organizational success in competitive environments.`,
    ];

    // Select content based on URL hash for consistency
    const urlHash = this.simpleHash(url);
    const selectedText = mockTexts[urlHash % mockTexts.length];

    // Add some variation to make it more realistic
    const variations = [
      `Introduction: ${selectedText}`,
      `${selectedText} Furthermore, additional research is needed to fully understand the implications.`,
      `As discussed in recent studies, ${selectedText.toLowerCase()}`,
      `${selectedText} This analysis provides valuable insights for future development.`,
      `Key findings indicate that ${selectedText.toLowerCase()}`,
    ];

    const finalText = variations[urlHash % variations.length];

    return {
      text: finalText,
      metadata: {
        url: url,
        title: `${this.capitalizeFirst(keyword)} Research Article`,
        description: `Comprehensive analysis of ${keyword} and related topics`,
        wordCount: finalText.split(/\s+/).length,
        characterCount: finalText.length,
        contentType: "text/html",
        contentLength: finalText.length.toString(),
        lastModified: new Date().toISOString(),
        extractedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Simple hash function for consistent content selection
   * @param {string} str - Input string
   * @returns {number} Hash value
   */
  simpleHash(str) {
    // Input validation to prevent loop bound injection
    if (typeof str !== "string") {
      return 0; // Return fixed hash for non-string inputs
    }

    // Limit string length to prevent DoS attacks
    const MAX_HASH_LENGTH = 1000; // Reduced for better security
    const safeStr = str.substring(0, MAX_HASH_LENGTH);

    // Use validated length instead of string.length property
    const len = Math.min(safeStr.length, MAX_HASH_LENGTH);

    let hash = 0;
    for (let i = 0; i < len; i++) {
      const char = safeStr.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Add a trusted domain to the allowlist
   * @param {string} domain - Domain to add to allowlist
   */
  addTrustedDomain(domain) {
    if (typeof domain === "string" && domain.length > 0) {
      const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, "");
      if (!this.allowedDomains.includes(cleanDomain)) {
        this.allowedDomains.push(cleanDomain);
      }
    }
  }

  /**
   * Get list of trusted domains
   * @returns {Array} Array of trusted domains
   */
  getTrustedDomains() {
    return [...this.allowedDomains]; // Return copy to prevent modification
  }

  /**
   * Capitalize first letter of a string
   * @param {string} str - Input string
   * @returns {string} Capitalized string
   */
  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Validate URL for security and format
   * @param {string} url - URL to validate
   * @returns {string} Validated URL
   */
  validateUrl(url) {
    if (!url || typeof url !== "string") {
      throw new Error("URL is required and must be a string");
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      throw new Error("Invalid URL format");
    }

    // Check protocol
    if (!this.allowedProtocols.includes(parsedUrl.protocol)) {
      throw new Error(
        `Protocol ${parsedUrl.protocol} is not allowed. Only HTTP and HTTPS are supported.`
      );
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // SSRF Prevention: Use allowlist approach for better security
    const isAllowed = this.allowedDomains.some((allowedDomain) => {
      // Check for exact match or subdomain match
      return (
        hostname === allowedDomain ||
        hostname.endsWith("." + allowedDomain) ||
        (allowedDomain.startsWith(".") && hostname.endsWith(allowedDomain))
      );
    });

    if (!isAllowed) {
      throw new Error(
        `Domain ${hostname} is not in the allowlist of trusted domains for security reasons`
      );
    }

    // Additional security checks for blocked domains/IPs
    if (
      this.blockedDomains.some((blocked) => {
        if (blocked.includes("/")) {
          // CIDR notation check (simplified)
          return this.isInCidrRange(hostname, blocked);
        }
        return hostname === blocked || hostname.endsWith("." + blocked);
      })
    ) {
      throw new Error(
        "Access to this domain is not allowed for security reasons"
      );
    }

    // Additional security checks for IP addresses
    if (parsedUrl.hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      // IP address - additional validation
      if (this.isPrivateIP(parsedUrl.hostname)) {
        throw new Error("Access to private IP addresses is not allowed");
      }
    }

    return parsedUrl.toString();
  }

  /**
   * Fetch content from URL
   * @param {string} url - Validated URL
   * @returns {Object} HTTP response
   */
  async fetchContent(url) {
    try {
      // Additional SSRF protection: Re-validate URL before making request
      const revalidatedUrl = this.validateUrl(url);

      const response = await this.httpClient.get(revalidatedUrl, {
        maxContentLength: this.maxContentSize,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      // Check content type
      const contentType = response.headers["content-type"] || "";
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml")
      ) {
        throw new Error(
          `Unsupported content type: ${contentType}. Only HTML content is supported.`
        );
      }

      return response;
    } catch (error) {
      if (error.code === "ECONNABORTED") {
        throw new Error(
          "Request timeout - the website took too long to respond"
        );
      }

      if (error.response) {
        const status = error.response.status;
        if (status === 404) {
          throw new Error("Page not found (404)");
        } else if (status === 403) {
          throw new Error("Access forbidden (403)");
        } else if (status === 500) {
          throw new Error("Server error (500)");
        } else {
          throw new Error(`HTTP error ${status}: ${error.response.statusText}`);
        }
      }

      throw error;
    }
  }

  /**
   * Extract text content from HTML
   * @param {string} html - HTML content
   * @param {string} url - Source URL
   * @returns {Object} Extracted text and metadata
   */
  extractTextFromHtml(html, url) {
    try {
      const dom = new JSDOM(html, { url });
      const document = dom.window.document;

      // Remove script and style elements
      const scriptsAndStyles = document.querySelectorAll(
        "script, style, noscript"
      );
      scriptsAndStyles.forEach((element) => element.remove());

      // Extract title
      const titleElement = document.querySelector("title");
      const title = titleElement ? titleElement.textContent.trim() : "";

      // Extract meta description
      const descriptionElement = document.querySelector(
        'meta[name="description"]'
      );
      const description = descriptionElement
        ? descriptionElement.getAttribute("content").trim()
        : "";

      // Extract main content
      let mainContent = "";

      // Try to find main content areas
      const contentSelectors = [
        "main",
        "article",
        '[role="main"]',
        ".content",
        ".main-content",
        ".post-content",
        ".entry-content",
        "#content",
        "#main",
      ];

      let contentElement = null;
      for (const selector of contentSelectors) {
        contentElement = document.querySelector(selector);
        if (contentElement) break;
      }

      // If no main content area found, use body
      if (!contentElement) {
        contentElement = document.body;
      }

      if (contentElement) {
        // Remove unwanted elements
        const unwantedSelectors = [
          "nav",
          "header",
          "footer",
          "aside",
          ".navigation",
          ".menu",
          ".sidebar",
          ".advertisement",
          ".ads",
          ".social-share",
          ".comments",
          ".comment-section",
        ];

        unwantedSelectors.forEach((selector) => {
          const elements = contentElement.querySelectorAll(selector);
          elements.forEach((el) => el.remove());
        });

        // Extract text content
        mainContent = contentElement.textContent || "";
      }

      // Clean up the text
      const cleanedText = this.cleanText(mainContent);

      // Calculate statistics
      const wordCount = cleanedText
        .split(/\s+/)
        .filter((word) => word.length > 0).length;
      const characterCount = cleanedText.length;

      // Validate minimum content
      if (wordCount < 10) {
        throw new Error(
          "Insufficient content found on the page (minimum 10 words required)"
        );
      }

      return {
        text: cleanedText,
        title,
        description,
        wordCount,
        characterCount,
      };
    } catch (error) {
      if (error.message.includes("Insufficient content")) {
        throw error;
      }
      throw new Error(`Failed to parse HTML content: ${error.message}`);
    }
  }

  /**
   * Clean extracted text content
   * @param {string} text - Raw text content
   * @returns {string} Cleaned text
   */
  cleanText(text) {
    return (
      text
        // Normalize whitespace
        .replace(/\s+/g, " ")
        // Remove excessive line breaks
        .replace(/\n\s*\n/g, "\n")
        // Trim whitespace
        .trim()
        // Remove control characters
        .replace(/[\x00-\x1F\x7F]/g, "")
        // Limit length (max 50,000 characters for plagiarism checking)
        .substring(0, 50000)
    );
  }

  /**
   * Check if IP is in private range (simplified CIDR check)
   * @param {string} ip - IP address
   * @returns {boolean} True if private IP
   */
  isPrivateIP(ip) {
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./,
      /^169\.254\./,
    ];

    return privateRanges.some((range) => range.test(ip));
  }

  /**
   * Check if IP is in CIDR range (simplified)
   * @param {string} ip - IP address
   * @param {string} cidr - CIDR notation
   * @returns {boolean} True if in range
   */
  isInCidrRange(ip, cidr) {
    // Simplified CIDR check - in production, use a proper CIDR library
    const [network, bits] = cidr.split("/");
    return ip.startsWith(
      network
        .split(".")
        .slice(0, Math.floor(bits / 8))
        .join(".")
    );
  }

  /**
   * Handle extraction errors
   * @param {Error} error - Original error
   * @param {string} url - URL that failed
   * @returns {Error} Formatted error
   */
  handleExtractionError(error, url) {
    const extractionError = new Error(
      `URL content extraction failed: ${error.message}`
    );
    extractionError.code = "URL_EXTRACTION_ERROR";
    extractionError.originalError = error;
    extractionError.url = url;
    return extractionError;
  }
}

module.exports = URLContentExtractor;
