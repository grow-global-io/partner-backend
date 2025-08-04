const LeadGenerationService = require("../LeadGenerationService");

// Mock dependencies
jest.mock("../../services/OpenAIService");
jest.mock("../EmbeddingSearchService");

const OpenAIService = require("../../services/OpenAIService");
const EmbeddingSearchService = require("../EmbeddingSearchService");

describe("LeadGenerationService", () => {
  let leadGenerationService;
  let mockOpenAIService;
  let mockEmbeddingSearch;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockOpenAIService = {
      client: {
        chat: {
          completions: {
            create: jest.fn(),
          },
        },
      },
      model: "gpt-4o",
    };

    mockEmbeddingSearch = {
      searchLeads: jest.fn(),
    };

    // Mock constructors
    OpenAIService.mockImplementation(() => mockOpenAIService);
    EmbeddingSearchService.mockImplementation(() => mockEmbeddingSearch);

    leadGenerationService = new LeadGenerationService();
  });

  describe("generateLeads", () => {
    const sampleQAPairs = [
      {
        question: "What industry are you in?",
        answer: "I am in the textile manufacturing business",
      },
      {
        question: "What region do you target?",
        answer: "We are looking for suppliers in India",
      },
    ];

    it("should generate leads successfully", async () => {
      // Mock LLM analysis response
      const mockAnalysisResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                product: "textiles",
                industry: "manufacturing",
                region: "India",
                keywords: ["supplier"],
              }),
            },
          },
        ],
      };

      // Mock search results
      const mockSearchResults = [
        {
          companyInfo: {
            companyName: "ABC Textiles",
            contactPerson: "John Smith",
            email: "john@abc.com",
          },
          combinedScore: 0.8,
          matchReasons: ["Industry match"],
        },
      ];

      // Mock LLM formatting response
      const mockFormattingResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                message: "Found 1 textile manufacturer in India",
                leads: [
                  {
                    companyName: "ABC Textiles",
                    contactPerson: "John Smith",
                    email: "john@abc.com",
                    phone: "",
                    website: "",
                    industry: "Textiles",
                    region: "India",
                    score: 80,
                    matchReason: "Industry match",
                  },
                ],
              }),
            },
          },
        ],
      };

      mockOpenAIService.client.chat.completions.create
        .mockResolvedValueOnce(mockAnalysisResponse)
        .mockResolvedValueOnce(mockFormattingResponse);

      mockEmbeddingSearch.searchLeads.mockResolvedValue(mockSearchResults);

      const result = await leadGenerationService.generateLeads(sampleQAPairs);

      expect(result.message).toBe("Found 1 textile manufacturer in India");
      expect(result.leads).toHaveLength(1);
      expect(result.leads[0].companyName).toBe("ABC Textiles");
      expect(result.metadata).toBeDefined();
      expect(result.metadata.totalFound).toBe(1);
    });

    it("should handle empty Q&A pairs", async () => {
      const result = await leadGenerationService.generateLeads([]);

      expect(result.message).toContain("Failed to generate leads");
      expect(result.leads).toEqual([]);
      expect(result.metadata.error).toBeDefined();
    });

    it("should handle LLM analysis failure with fallback", async () => {
      mockOpenAIService.client.chat.completions.create
        .mockRejectedValueOnce(new Error("LLM error"))
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  message: "Found leads using fallback analysis",
                  leads: [],
                }),
              },
            },
          ],
        });

      mockEmbeddingSearch.searchLeads.mockResolvedValue([]);

      const result = await leadGenerationService.generateLeads(sampleQAPairs);

      expect(result.message).toBeDefined();
      expect(result.leads).toEqual([]);
    });
  });

  describe("analyzeQuestionAnswers", () => {
    const sampleQAPairs = [
      {
        question: "What product do you offer?",
        answer: "We manufacture cotton textiles",
      },
    ];

    it("should extract criteria using LLM", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                product: "cotton textiles",
                industry: "manufacturing",
                region: null,
                keywords: ["cotton"],
              }),
            },
          },
        ],
      };

      mockOpenAIService.client.chat.completions.create.mockResolvedValue(
        mockResponse
      );

      const criteria = await leadGenerationService.analyzeQuestionAnswers(
        sampleQAPairs
      );

      expect(criteria.product).toBe("cotton textiles");
      expect(criteria.industry).toBe("manufacturing");
      expect(criteria.region).toBeNull();
      expect(criteria.keywords).toContain("cotton");
    });

    it("should use fallback extraction when LLM fails", async () => {
      mockOpenAIService.client.chat.completions.create.mockRejectedValue(
        new Error("LLM error")
      );

      const criteria = await leadGenerationService.analyzeQuestionAnswers(
        sampleQAPairs
      );

      expect(criteria).toBeDefined();
      expect(criteria.product).toBeNull(); // Fallback doesn't extract product well
      expect(Array.isArray(criteria.keywords)).toBe(true);
    });
  });

  describe("fallbackCriteriaExtraction", () => {
    it("should extract basic criteria from text", () => {
      const qaPairs = [
        {
          question: "What industry?",
          answer: "We are in textile manufacturing business in India",
        },
      ];

      const criteria =
        leadGenerationService.fallbackCriteriaExtraction(qaPairs);

      expect(criteria.industry).toBe("manufacturing");
      expect(criteria.region).toBe("india");
      expect(Array.isArray(criteria.keywords)).toBe(true);
    });

    it("should handle no matches gracefully", () => {
      const qaPairs = [
        {
          question: "Random question?",
          answer: "Random answer with no keywords",
        },
      ];

      const criteria =
        leadGenerationService.fallbackCriteriaExtraction(qaPairs);

      expect(criteria.industry).toBeNull();
      expect(criteria.region).toBeNull();
      expect(Array.isArray(criteria.keywords)).toBe(true);
    });
  });

  describe("searchLeads", () => {
    it("should search leads using EmbeddingSearchService", async () => {
      const criteria = {
        product: "textiles",
        industry: "manufacturing",
        region: "India",
        keywords: ["cotton"],
      };

      const mockResults = [
        { companyInfo: { companyName: "Test Company" }, score: 0.8 },
      ];

      mockEmbeddingSearch.searchLeads.mockResolvedValue(mockResults);

      const results = await leadGenerationService.searchLeads(criteria);

      expect(mockEmbeddingSearch.searchLeads).toHaveBeenCalledWith(criteria, {
        limit: 50,
        minSimilarity: 0.1,
      });
      expect(results).toEqual(mockResults);
    });

    it("should handle search errors", async () => {
      const criteria = { product: "textiles" };
      mockEmbeddingSearch.searchLeads.mockRejectedValue(
        new Error("Search error")
      );

      await expect(leadGenerationService.searchLeads(criteria)).rejects.toThrow(
        "Lead search failed: Search error"
      );
    });
  });

  describe("formatLeadsWithLLM", () => {
    const mockLeads = [
      {
        companyInfo: {
          companyName: "ABC Corp",
          contactPerson: "John Doe",
          email: "john@abc.com",
        },
        combinedScore: 0.8,
        matchReasons: ["Industry match"],
      },
    ];

    const mockCriteria = {
      product: "textiles",
      industry: "manufacturing",
      region: "India",
      keywords: [],
    };

    it("should format leads using LLM", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                message: "Found 1 matching lead",
                leads: [
                  {
                    companyName: "ABC Corp",
                    contactPerson: "John Doe",
                    email: "john@abc.com",
                    phone: "",
                    website: "",
                    industry: "Manufacturing",
                    region: "India",
                    score: 80,
                    matchReason: "Industry match",
                  },
                ],
              }),
            },
          },
        ],
      };

      mockOpenAIService.client.chat.completions.create.mockResolvedValue(
        mockResponse
      );

      const result = await leadGenerationService.formatLeadsWithLLM(
        mockLeads,
        mockCriteria,
        []
      );

      expect(result.message).toBe("Found 1 matching lead");
      expect(result.leads).toHaveLength(1);
      expect(result.leads[0].companyName).toBe("ABC Corp");
    });

    it("should handle empty leads array", async () => {
      const result = await leadGenerationService.formatLeadsWithLLM(
        [],
        mockCriteria,
        []
      );

      expect(result.message).toContain("No leads found");
      expect(result.leads).toEqual([]);
    });

    it("should use fallback formatting when LLM fails", async () => {
      mockOpenAIService.client.chat.completions.create.mockRejectedValue(
        new Error("LLM error")
      );

      const result = await leadGenerationService.formatLeadsWithLLM(
        mockLeads,
        mockCriteria,
        []
      );

      expect(result.message).toBeDefined();
      expect(result.leads).toHaveLength(1);
      expect(result.leads[0].companyName).toBe("ABC Corp");
    });
  });

  describe("fallbackLeadFormatting", () => {
    it("should format leads without LLM", () => {
      const mockLeads = [
        {
          companyInfo: {
            companyName: "Test Company",
            email: "test@company.com",
          },
          combinedScore: 0.7,
          matchReasons: ["Good match"],
        },
      ];

      const result = leadGenerationService.fallbackLeadFormatting(
        mockLeads,
        {}
      );

      expect(result.message).toContain("Found 1 potential leads");
      expect(result.leads).toHaveLength(1);
      expect(result.leads[0].companyName).toBe("Test Company");
      expect(result.leads[0].score).toBe(70);
    });

    it("should filter low-score leads", () => {
      const mockLeads = [
        {
          companyInfo: { companyName: "Low Score Company" },
          combinedScore: 0.2, // Below 0.3 threshold
          matchReasons: ["Weak match"],
        },
      ];

      const result = leadGenerationService.fallbackLeadFormatting(
        mockLeads,
        {}
      );

      expect(result.leads).toHaveLength(0);
      expect(result.message).toContain("No high-quality leads found");
    });
  });

  describe("statistics tracking", () => {
    it("should update stats on successful generation", () => {
      leadGenerationService.updateStats(true, 1000);

      const stats = leadGenerationService.getStats();
      expect(stats.successfulGenerations).toBe(1);
      expect(stats.failedGenerations).toBe(0);
      expect(stats.averageProcessingTime).toBe(1000);
      expect(stats.successRate).toBe(100);
    });

    it("should update stats on failed generation", () => {
      leadGenerationService.updateStats(false, 500);

      const stats = leadGenerationService.getStats();
      expect(stats.successfulGenerations).toBe(0);
      expect(stats.failedGenerations).toBe(1);
      expect(stats.successRate).toBe(0);
    });

    it("should reset stats correctly", () => {
      leadGenerationService.updateStats(true, 1000);
      leadGenerationService.resetStats();

      const stats = leadGenerationService.getStats();
      expect(stats.totalGenerations).toBe(0);
      expect(stats.successfulGenerations).toBe(0);
      expect(stats.failedGenerations).toBe(0);
    });
  });
});
