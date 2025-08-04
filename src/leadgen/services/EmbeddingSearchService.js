const ExcelModel = require("../models/ExcelModel");
const OpenAIService = require("../../services/OpenAIService");

/**
 * @description Embedding search service wrapper for lead generation
 * @class EmbeddingSearchService
 */
class EmbeddingSearchService {
  constructor() {
    this.excelModel = new ExcelModel();
    this.openAIService = new OpenAIService();
  }

  /**
   * @description Search for leads using extracted criteria
   * @param {Object} criteria - Search criteria extracted from Q&A
   * @param {string} criteria.product - Product or service
   * @param {string} criteria.industry - Industry type
   * @param {string} criteria.region - Target region
   * @param {Array<string>} criteria.keywords - Additional keywords
   * @param {Object} options - Search options
   * @param {number} options.limit - Maximum results (default: 50)
   * @param {number} options.minSimilarity - Minimum similarity threshold (default: 0.1)
   * @returns {Promise<Array>} Array of matching leads
   */
  async searchLeads(criteria, options = {}) {
    const { limit = 50, minSimilarity = 0.1 } = options;

    try {
      console.log(
        "EmbeddingSearchService: Starting lead search with criteria:",
        criteria
      );

      // Generate comprehensive search query
      const searchQuery = this.generateSearchQuery(
        criteria.product,
        criteria.industry,
        criteria.region,
        criteria.keywords
      );

      console.log(
        "EmbeddingSearchService: Generated search query:",
        searchQuery
      );

      // Generate embedding for the search query
      const embedding = await this.openAIService.generateEmbedding(searchQuery);

      if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Failed to generate embedding for search query");
      }

      console.log(
        `EmbeddingSearchService: Generated embedding with ${embedding.length} dimensions`
      );

      // Perform vector search using existing ExcelModel
      const searchResults = await this.performVectorSearch(embedding, {
        limit: Math.max(limit, 100), // Get more results for better filtering
        minSimilarity,
      });

      console.log(
        `EmbeddingSearchService: Found ${searchResults.length} initial results`
      );

      // Filter and enhance results
      const enhancedResults = this.enhanceSearchResults(
        searchResults,
        criteria
      );

      // Sort by relevance and limit results
      const finalResults = enhancedResults
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      console.log(
        `EmbeddingSearchService: Returning ${finalResults.length} final results`
      );

      return finalResults;
    } catch (error) {
      console.error("EmbeddingSearchService: Error searching leads:", error);
      throw error;
    }
  }

  /**
   * @description Generate comprehensive search query from criteria
   * @param {string} product - Product or service
   * @param {string} industry - Industry type
   * @param {string} region - Target region
   * @param {Array<string>} keywords - Additional keywords
   * @returns {string} Comprehensive search query
   */
  generateSearchQuery(product, industry, region, keywords = []) {
    const queryParts = [];

    // Add product/service information
    if (product) {
      queryParts.push(product);
    }

    // Add industry information
    if (industry) {
      queryParts.push(`${industry} industry`);
    }

    // Add regional information
    if (region) {
      queryParts.push(`located in ${region}`);
    }

    // Add keywords
    if (keywords && keywords.length > 0) {
      queryParts.push(...keywords);
    }

    // Create comprehensive query
    const baseQuery = queryParts.join(" ");

    // Add context for better matching
    const contextualQuery = `Business company ${baseQuery} manufacturer supplier exporter contact information`;

    return contextualQuery;
  }

  /**
   * @description Perform vector search using existing ExcelModel
   * @param {Array<number>} embedding - Query embedding
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async performVectorSearch(embedding, options = {}) {
    const { limit = 100, minSimilarity = 0.1 } = options;

    try {
      // Use existing ExcelModel vector search functionality
      const results = await this.excelModel.vectorSearch(
        embedding,
        null, // fileKey - search all files
        limit,
        minSimilarity
      );

      return results || [];
    } catch (error) {
      console.error("EmbeddingSearchService: Vector search error:", error);
      throw new Error(`Vector search failed: ${error.message}`);
    }
  }

  /**
   * @description Enhance search results with additional scoring and metadata
   * @param {Array} searchResults - Raw search results from vector search
   * @param {Object} criteria - Original search criteria
   * @returns {Array} Enhanced results with additional scoring
   */
  enhanceSearchResults(searchResults, criteria) {
    return searchResults.map((result) => {
      // Extract company information from row data
      const companyInfo = this.extractCompanyInfo(result.rowData || {});

      // Calculate additional relevance scores
      const relevanceScore = this.calculateRelevanceScore(result, criteria);

      // Combine vector similarity with relevance score
      const combinedScore = result.score * 0.7 + relevanceScore * 0.3;

      return {
        ...result,
        companyInfo,
        relevanceScore,
        combinedScore: Math.min(combinedScore, 1.0), // Cap at 1.0
        matchReasons: this.generateMatchReasons(result, criteria),
      };
    });
  }

  /**
   * @description Extract company information from row data
   * @param {Object} rowData - Raw row data
   * @returns {Object} Extracted company information
   */
  extractCompanyInfo(rowData) {
    // Common field name variations
    const fieldMappings = {
      companyName: [
        "company",
        "companyname",
        "company_name",
        "business_name",
        "organization",
        "firm",
      ],
      contactPerson: [
        "contact",
        "name",
        "contact_person",
        "person",
        "representative",
      ],
      email: ["email", "e_mail", "email_address", "contact_email"],
      phone: ["phone", "telephone", "mobile", "contact_number", "phone_number"],
      website: ["website", "web", "url", "site"],
      industry: ["industry", "business_type", "sector", "category"],
      region: ["region", "country", "location", "address", "city", "state"],
    };

    const extracted = {};

    // Extract information using field mappings
    Object.keys(fieldMappings).forEach((key) => {
      const possibleFields = fieldMappings[key];

      for (const field of possibleFields) {
        const value = this.findFieldValue(rowData, field);
        if (value) {
          extracted[key] = value;
          break;
        }
      }
    });

    return extracted;
  }

  /**
   * @description Find field value with case-insensitive matching
   * @param {Object} rowData - Row data object
   * @param {string} fieldName - Field name to search for
   * @returns {string|null} Field value or null
   */
  findFieldValue(rowData, fieldName) {
    const lowerFieldName = fieldName.toLowerCase();

    for (const [key, value] of Object.entries(rowData)) {
      if (key.toLowerCase().includes(lowerFieldName) && value) {
        return String(value).trim();
      }
    }

    return null;
  }

  /**
   * @description Calculate additional relevance score based on criteria matching
   * @param {Object} result - Search result
   * @param {Object} criteria - Search criteria
   * @returns {number} Relevance score (0-1)
   */
  calculateRelevanceScore(result, criteria) {
    let score = 0;
    let factors = 0;

    const content = (
      result.content || JSON.stringify(result.rowData || {})
    ).toLowerCase();

    // Check product/service match
    if (criteria.product) {
      const productTerms = criteria.product.toLowerCase().split(" ");
      const productMatches = productTerms.filter((term) =>
        content.includes(term)
      ).length;
      score += (productMatches / productTerms.length) * 0.4;
      factors += 0.4;
    }

    // Check industry match
    if (criteria.industry) {
      const industryTerms = criteria.industry.toLowerCase().split(" ");
      const industryMatches = industryTerms.filter((term) =>
        content.includes(term)
      ).length;
      score += (industryMatches / industryTerms.length) * 0.3;
      factors += 0.3;
    }

    // Check region match
    if (criteria.region) {
      const regionTerms = criteria.region.toLowerCase().split(" ");
      const regionMatches = regionTerms.filter((term) =>
        content.includes(term)
      ).length;
      score += (regionMatches / regionTerms.length) * 0.2;
      factors += 0.2;
    }

    // Check keyword matches
    if (criteria.keywords && criteria.keywords.length > 0) {
      const keywordMatches = criteria.keywords.filter((keyword) =>
        content.includes(keyword.toLowerCase())
      ).length;
      score += (keywordMatches / criteria.keywords.length) * 0.1;
      factors += 0.1;
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * @description Generate match reasons for a result
   * @param {Object} result - Search result
   * @param {Object} criteria - Search criteria
   * @returns {Array<string>} Array of match reasons
   */
  generateMatchReasons(result, criteria) {
    const reasons = [];
    const content = (
      result.content || JSON.stringify(result.rowData || {})
    ).toLowerCase();

    // Check for specific matches
    if (criteria.product && content.includes(criteria.product.toLowerCase())) {
      reasons.push(`Matches product: ${criteria.product}`);
    }

    if (
      criteria.industry &&
      content.includes(criteria.industry.toLowerCase())
    ) {
      reasons.push(`Matches industry: ${criteria.industry}`);
    }

    if (criteria.region && content.includes(criteria.region.toLowerCase())) {
      reasons.push(`Located in: ${criteria.region}`);
    }

    if (criteria.keywords) {
      const matchedKeywords = criteria.keywords.filter((keyword) =>
        content.includes(keyword.toLowerCase())
      );
      if (matchedKeywords.length > 0) {
        reasons.push(`Matches keywords: ${matchedKeywords.join(", ")}`);
      }
    }

    // Add vector similarity reason
    if (result.score > 0.5) {
      reasons.push("High content similarity");
    } else if (result.score > 0.3) {
      reasons.push("Moderate content similarity");
    }

    return reasons.length > 0 ? reasons : ["General content match"];
  }

  /**
   * @description Get search statistics for monitoring
   * @returns {Object} Search statistics
   */
  getSearchStats() {
    return {
      totalSearches: 0, // Will be tracked by LeadGenerationService
      averageResultCount: 0,
      averageSearchTime: 0,
      lastSearch: null,
    };
  }
}

module.exports = EmbeddingSearchService;
