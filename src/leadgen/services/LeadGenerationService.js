const OpenAIService = require("../../services/OpenAIService");
const EmbeddingSearchService = require("./EmbeddingSearchService");

/**
 * @description Lead generation service with LLM analysis
 * @class LeadGenerationService
 */
class LeadGenerationService {
  constructor() {
    this.openAIService = new OpenAIService();
    this.embeddingSearch = new EmbeddingSearchService();

    // JSON schema for structured lead generation response
    this.jsonSchema = {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Summary message about the lead generation results",
        },
        leads: {
          type: "array",
          items: {
            type: "object",
            properties: {
              companyName: { type: "string" },
              contactPerson: { type: "string" },
              email: { type: "string" },
              phone: { type: "string" },
              website: { type: "string" },
              industry: { type: "string" },
              region: { type: "string" },
              score: {
                type: "number",
                minimum: 0,
                maximum: 100,
              },
              matchReason: { type: "string" },
            },
            required: ["companyName", "score", "matchReason"],
          },
        },
      },
      required: ["message", "leads"],
    };

    // Performance tracking
    this.stats = {
      totalGenerations: 0,
      successfulGenerations: 0,
      failedGenerations: 0,
      averageProcessingTime: 0,
      lastGeneration: null,
    };
  }

  /**
   * @description Main lead generation method
   * @param {Array} questionAnswerPairs - Array of Q&A pairs from chat history
   * @returns {Promise<Object>} { message: string, leads: Array }
   */
  async generateLeads(questionAnswerPairs) {
    const startTime = Date.now();
    this.stats.totalGenerations++;

    try {
      console.log(
        `LeadGenerationService: Starting lead generation with ${questionAnswerPairs.length} Q&A pairs`
      );

      // Validate input
      if (!questionAnswerPairs || questionAnswerPairs.length === 0) {
        throw new Error(
          "No question-answer pairs provided for lead generation"
        );
      }

      // Step 1: Analyze Q&A pairs to extract search criteria
      const criteria = await this.analyzeQuestionAnswers(questionAnswerPairs);
      console.log("LeadGenerationService: Extracted criteria:", criteria);

      // Step 2: Search for leads using extracted criteria
      const searchResults = await this.searchLeads(criteria);
      console.log(
        `LeadGenerationService: Found ${searchResults.length} potential leads`
      );

      // Step 3: Format leads using LLM with structured output
      const formattedResult = await this.formatLeadsWithLLM(
        searchResults,
        criteria,
        questionAnswerPairs
      );

      // Update performance stats
      const processingTime = Date.now() - startTime;
      this.updateStats(true, processingTime);

      console.log(
        `LeadGenerationService: Successfully generated leads in ${processingTime}ms`
      );

      return {
        ...formattedResult,
        metadata: {
          totalFound: searchResults.length,
          processingTime,
          searchCriteria: criteria,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error("LeadGenerationService: Error generating leads:", error);
      this.updateStats(false, Date.now() - startTime);

      // Return error response in expected format
      return {
        message: `Failed to generate leads: ${error.message}`,
        leads: [],
        metadata: {
          totalFound: 0,
          processingTime: Date.now() - startTime,
          error: error.message,
          generatedAt: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * @description Analyze Q&A pairs to extract search criteria using LLM
   * @param {Array} questionAnswerPairs - Array of Q&A objects
   * @returns {Promise<Object>} Extracted criteria { product, industry, region, keywords }
   */
  async analyzeQuestionAnswers(questionAnswerPairs) {
    try {
      // Build context from Q&A pairs
      const qaContext = questionAnswerPairs
        .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
        .join("\n\n");

      const systemPrompt = `You are a lead generation analyst. Analyze the following question-answer pairs and extract key search criteria for finding business leads.

Extract the following information:
1. Product or Service: What product/service is the user looking for or offering?
2. Industry: What industry or business sector?
3. Region: What geographic region, country, or location?
4. Keywords: Any specific keywords, terms, or requirements mentioned?

Return your analysis as a JSON object with these exact keys: product, industry, region, keywords (array).
If any information is not available, use null for strings or empty array for keywords.`;

      const userPrompt = `Analyze these question-answer pairs and extract lead search criteria:

${qaContext}

Return JSON with: product, industry, region, keywords`;

      console.log("LeadGenerationService: Analyzing Q&A pairs with LLM...");

      const response = await this.openAIService.client.chat.completions.create({
        model: this.openAIService.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 500,
      });

      const analysisResult = JSON.parse(response.choices[0].message.content);

      // Validate and clean the extracted criteria
      const criteria = {
        product: analysisResult.product || null,
        industry: analysisResult.industry || null,
        region: analysisResult.region || null,
        keywords: Array.isArray(analysisResult.keywords)
          ? analysisResult.keywords
          : [],
      };

      console.log("LeadGenerationService: LLM analysis completed:", criteria);
      return criteria;
    } catch (error) {
      console.error("LeadGenerationService: Error analyzing Q&A pairs:", error);

      // Fallback: Extract criteria using simple text analysis
      console.log(
        "LeadGenerationService: Falling back to simple text analysis..."
      );
      return this.fallbackCriteriaExtraction(questionAnswerPairs);
    }
  }

  /**
   * @description Fallback method to extract criteria without LLM
   * @param {Array} questionAnswerPairs - Array of Q&A objects
   * @returns {Object} Basic extracted criteria
   */
  fallbackCriteriaExtraction(questionAnswerPairs) {
    const criteria = {
      product: null,
      industry: null,
      region: null,
      keywords: [],
    };

    // Simple keyword-based extraction
    const allAnswers = questionAnswerPairs
      .map((qa) => qa.answer.toLowerCase())
      .join(" ");

    // Common industry keywords
    const industryKeywords = [
      "manufacturing",
      "textile",
      "software",
      "agriculture",
      "automotive",
      "pharmaceutical",
    ];
    const foundIndustry = industryKeywords.find((keyword) =>
      allAnswers.includes(keyword)
    );
    if (foundIndustry) {
      criteria.industry = foundIndustry;
    }

    // Common region keywords
    const regionKeywords = [
      "india",
      "usa",
      "china",
      "germany",
      "japan",
      "uk",
      "canada",
    ];
    const foundRegion = regionKeywords.find((keyword) =>
      allAnswers.includes(keyword)
    );
    if (foundRegion) {
      criteria.region = foundRegion;
    }

    // Extract potential product keywords (simple approach)
    const words = allAnswers.split(/\s+/).filter((word) => word.length > 3);
    criteria.keywords = [...new Set(words)].slice(0, 5); // Unique words, max 5

    console.log(
      "LeadGenerationService: Fallback extraction completed:",
      criteria
    );
    return criteria;
  }

  /**
   * @description Search for leads using extracted criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Array>} Array of lead objects
   */
  async searchLeads(criteria) {
    try {
      // Use EmbeddingSearchService to find matching leads
      const searchOptions = {
        limit: 50, // Get more results for better LLM formatting
        minSimilarity: 0.1, // Lower threshold for broader results
      };

      const results = await this.embeddingSearch.searchLeads(
        criteria,
        searchOptions
      );

      console.log(
        `LeadGenerationService: Search completed, found ${results.length} results`
      );
      return results;
    } catch (error) {
      console.error("LeadGenerationService: Error searching leads:", error);
      throw new Error(`Lead search failed: ${error.message}`);
    }
  }

  /**
   * @description Format leads using LLM with structured JSON output
   * @param {Array} leads - Raw search results
   * @param {Object} criteria - Search criteria
   * @param {Array} questionAnswerPairs - Original Q&A pairs
   * @returns {Promise<Object>} Formatted response { message, leads }
   */
  async formatLeadsWithLLM(leads, criteria, questionAnswerPairs) {
    try {
      if (leads.length === 0) {
        return {
          message:
            "No leads found matching your criteria. Try broadening your search parameters.",
          leads: [],
        };
      }

      // Prepare lead data for LLM formatting
      const leadSummaries = leads.slice(0, 20).map((lead, index) => {
        const company = lead.companyInfo || {};
        return {
          index: index + 1,
          company: company.companyName || "Unknown Company",
          contact: company.contactPerson || "N/A",
          email: company.email || "N/A",
          phone: company.phone || "N/A",
          website: company.website || "N/A",
          industry: company.industry || "N/A",
          region: company.region || "N/A",
          score: Math.round((lead.combinedScore || lead.score || 0) * 100),
          reasons: lead.matchReasons || ["General match"],
        };
      });

      const systemPrompt = `You are a lead generation specialist. Format the provided lead data into a structured JSON response.

Create a summary message and format each lead with the following structure:
- companyName: Company name
- contactPerson: Contact person name  
- email: Email address
- phone: Phone number
- website: Website URL
- industry: Industry/business type
- region: Location/region
- score: Relevance score (0-100)
- matchReason: Brief explanation of why this lead matches

Return JSON with exactly this structure:
{
  "message": "Summary of results",
  "leads": [array of lead objects]
}

Focus on the most relevant leads (score > 60) and limit to maximum 15 leads.`;

      const userPrompt = `Format these leads based on search criteria:
Product: ${criteria.product || "Not specified"}
Industry: ${criteria.industry || "Not specified"}  
Region: ${criteria.region || "Not specified"}
Keywords: ${criteria.keywords?.join(", ") || "None"}

Lead data:
${JSON.stringify(leadSummaries, null, 2)}

Return formatted JSON response with message and leads array.`;

      console.log("LeadGenerationService: Formatting leads with LLM...");

      const response = await this.openAIService.client.chat.completions.create({
        model: this.openAIService.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 2000,
      });

      const formattedResult = JSON.parse(response.choices[0].message.content);

      // Validate the response structure
      if (!formattedResult.message || !Array.isArray(formattedResult.leads)) {
        throw new Error("Invalid LLM response format");
      }

      console.log(
        `LeadGenerationService: LLM formatting completed, ${formattedResult.leads.length} leads formatted`
      );
      return formattedResult;
    } catch (error) {
      console.error(
        "LeadGenerationService: Error formatting leads with LLM:",
        error
      );

      // Fallback: Simple formatting without LLM
      return this.fallbackLeadFormatting(leads, criteria);
    }
  }

  /**
   * @description Fallback lead formatting without LLM
   * @param {Array} leads - Raw search results
   * @param {Object} criteria - Search criteria
   * @returns {Object} Basic formatted response
   */
  fallbackLeadFormatting(leads, criteria) {
    const topLeads = leads
      .filter((lead) => (lead.combinedScore || lead.score || 0) > 0.3)
      .slice(0, 15)
      .map((lead) => {
        const company = lead.companyInfo || {};
        return {
          companyName: company.companyName || "Unknown Company",
          contactPerson: company.contactPerson || "",
          email: company.email || "",
          phone: company.phone || "",
          website: company.website || "",
          industry: company.industry || "",
          region: company.region || "",
          score: Math.round((lead.combinedScore || lead.score || 0) * 100),
          matchReason: lead.matchReasons?.[0] || "Content similarity match",
        };
      });

    const message =
      topLeads.length > 0
        ? `Found ${topLeads.length} potential leads matching your criteria.`
        : "No high-quality leads found. Consider broadening your search criteria.";

    return { message, leads: topLeads };
  }

  /**
   * @description Update performance statistics
   * @param {boolean} success - Whether generation was successful
   * @param {number} processingTime - Processing time in milliseconds
   */
  updateStats(success, processingTime) {
    if (success) {
      this.stats.successfulGenerations++;
    } else {
      this.stats.failedGenerations++;
    }

    // Update average processing time
    const totalTime =
      this.stats.averageProcessingTime * (this.stats.totalGenerations - 1) +
      processingTime;
    this.stats.averageProcessingTime = Math.round(
      totalTime / this.stats.totalGenerations
    );

    this.stats.lastGeneration = new Date();
  }

  /**
   * @description Get service statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate:
        this.stats.totalGenerations > 0
          ? Math.round(
              (this.stats.successfulGenerations / this.stats.totalGenerations) *
                100
            )
          : 0,
    };
  }

  /**
   * @description Reset statistics (for testing)
   */
  resetStats() {
    this.stats = {
      totalGenerations: 0,
      successfulGenerations: 0,
      failedGenerations: 0,
      averageProcessingTime: 0,
      lastGeneration: null,
    };
  }
}

module.exports = LeadGenerationService;
