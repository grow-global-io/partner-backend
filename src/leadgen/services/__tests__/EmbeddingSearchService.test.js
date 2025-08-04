const EmbeddingSearchService = require("../EmbeddingSearchService");

// Mock dependencies
jest.mock("../models/ExcelModel");
jest.mock("../../services/OpenAIService");

const ExcelModel = require("../models/ExcelModel");
const OpenAIService = require("../../services/OpenAIService");

describe("EmbeddingSearchService", () => {
  let embeddingSearchService;
  let mockExcelModel;
  let mockOpenAIService;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockExcelModel = {
      vectorSearch: jest.fn(),
    };
    mockOpenAIService = {
      generateEmbedding: jest.fn(),
    };

    // Mock constructors
    ExcelModel.mockImplementation(() => mockExcelModel);
    OpenAIService.mockImplementation(() => mockOpenAIService);

    embeddingSearchService = new EmbeddingSearchService();
  });

  describe("generateSearchQuery", () => {
    it("should generate comprehensive search query from criteria", () => {
      const query = embeddingSearchService.generateSearchQuery(
        "textiles",
        "manufacturing",
        "India",
        ["cotton", "fabric"]
      );

      expect(query).toContain("textiles");
      expect(query).toContain("manufacturing industry");
      expect(query).toContain("located in India");
      expect(query).toContain("cotton");
      expect(query).toContain("fabric");
      expect(query).toContain("Business company");
    });

    it("should handle missing criteria gracefully", () => {
      const query = embeddingSearchService.generateSearchQuery(
        "textiles",
        null,
        null,
        []
      );

      expect(query).toContain("textiles");
      expect(query).toContain("Business company");
    });

    it("should handle empty criteria", () => {
      const query = embeddingSearchService.generateSearchQuery(
        null,
        null,
        null,
        null
      );

      expect(query).toContain("Business company");
    });
  });

  describe("extractCompanyInfo", () => {
    it("should extract company information from row data", () => {
      const rowData = {
        "Company Name": "ABC Textiles Ltd",
        "Contact Person": "John Smith",
        Email: "john@abctextiles.com",
        Phone: "+91-9876543210",
        Website: "www.abctextiles.com",
        Industry: "Textiles",
        Country: "India",
      };

      const extracted = embeddingSearchService.extractCompanyInfo(rowData);

      expect(extracted.companyName).toBe("ABC Textiles Ltd");
      expect(extracted.contactPerson).toBe("John Smith");
      expect(extracted.email).toBe("john@abctextiles.com");
      expect(extracted.phone).toBe("+91-9876543210");
      expect(extracted.website).toBe("www.abctextiles.com");
      expect(extracted.industry).toBe("Textiles");
      expect(extracted.region).toBe("India");
    });

    it("should handle case-insensitive field matching", () => {
      const rowData = {
        company_name: "XYZ Corp",
        CONTACT_PERSON: "Jane Doe",
        Email_Address: "jane@xyzcorp.com",
      };

      const extracted = embeddingSearchService.extractCompanyInfo(rowData);

      expect(extracted.companyName).toBe("XYZ Corp");
      expect(extracted.contactPerson).toBe("Jane Doe");
      expect(extracted.email).toBe("jane@xyzcorp.com");
    });

    it("should handle missing fields gracefully", () => {
      const rowData = {
        Company: "Test Company",
      };

      const extracted = embeddingSearchService.extractCompanyInfo(rowData);

      expect(extracted.companyName).toBe("Test Company");
      expect(extracted.contactPerson).toBeUndefined();
      expect(extracted.email).toBeUndefined();
    });
  });

  describe("calculateRelevanceScore", () => {
    it("should calculate relevance score based on criteria matching", () => {
      const result = {
        content:
          "ABC Textiles manufacturing company located in India producing cotton fabrics",
        rowData: {},
      };

      const criteria = {
        product: "textiles",
        industry: "manufacturing",
        region: "India",
        keywords: ["cotton"],
      };

      const score = embeddingSearchService.calculateRelevanceScore(
        result,
        criteria
      );

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it("should return 0 for no matches", () => {
      const result = {
        content: "Software development company in USA",
        rowData: {},
      };

      const criteria = {
        product: "textiles",
        industry: "manufacturing",
        region: "India",
        keywords: ["cotton"],
      };

      const score = embeddingSearchService.calculateRelevanceScore(
        result,
        criteria
      );

      expect(score).toBe(0);
    });
  });

  describe("generateMatchReasons", () => {
    it("should generate appropriate match reasons", () => {
      const result = {
        content: "ABC Textiles manufacturing company located in India",
        rowData: {},
        score: 0.8,
      };

      const criteria = {
        product: "textiles",
        industry: "manufacturing",
        region: "India",
        keywords: [],
      };

      const reasons = embeddingSearchService.generateMatchReasons(
        result,
        criteria
      );

      expect(reasons).toContain("Matches product: textiles");
      expect(reasons).toContain("Matches industry: manufacturing");
      expect(reasons).toContain("Located in: India");
      expect(reasons).toContain("High content similarity");
    });

    it("should provide default reason when no specific matches", () => {
      const result = {
        content: "Some random content",
        rowData: {},
        score: 0.2,
      };

      const criteria = {
        product: "textiles",
        industry: "manufacturing",
        region: "India",
        keywords: [],
      };

      const reasons = embeddingSearchService.generateMatchReasons(
        result,
        criteria
      );

      expect(reasons).toContain("General content match");
    });
  });

  describe("performVectorSearch", () => {
    it("should call ExcelModel vectorSearch with correct parameters", async () => {
      const embedding = [0.1, 0.2, 0.3];
      const mockResults = [
        { score: 0.8, content: "test content", rowData: {} },
      ];

      mockExcelModel.vectorSearch.mockResolvedValue(mockResults);

      const results = await embeddingSearchService.performVectorSearch(
        embedding,
        {
          limit: 50,
          minSimilarity: 0.1,
        }
      );

      expect(mockExcelModel.vectorSearch).toHaveBeenCalledWith(
        embedding,
        null,
        50,
        0.1
      );
      expect(results).toEqual(mockResults);
    });

    it("should handle vector search errors", async () => {
      const embedding = [0.1, 0.2, 0.3];
      mockExcelModel.vectorSearch.mockRejectedValue(
        new Error("Database error")
      );

      await expect(
        embeddingSearchService.performVectorSearch(embedding)
      ).rejects.toThrow("Vector search failed: Database error");
    });
  });

  describe("searchLeads", () => {
    it("should perform complete lead search flow", async () => {
      const criteria = {
        product: "textiles",
        industry: "manufacturing",
        region: "India",
        keywords: ["cotton"],
      };

      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockSearchResults = [
        {
          score: 0.8,
          content: "ABC Textiles manufacturing company in India",
          rowData: {
            Company: "ABC Textiles",
            Contact: "John Smith",
            Email: "john@abc.com",
          },
        },
      ];

      mockOpenAIService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockExcelModel.vectorSearch.mockResolvedValue(mockSearchResults);

      const results = await embeddingSearchService.searchLeads(criteria, {
        limit: 10,
      });

      expect(mockOpenAIService.generateEmbedding).toHaveBeenCalled();
      expect(mockExcelModel.vectorSearch).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty("companyInfo");
      expect(results[0]).toHaveProperty("relevanceScore");
      expect(results[0]).toHaveProperty("matchReasons");
    });

    it("should handle embedding generation failure", async () => {
      const criteria = { product: "textiles" };
      mockOpenAIService.generateEmbedding.mockResolvedValue(null);

      await expect(
        embeddingSearchService.searchLeads(criteria)
      ).rejects.toThrow("Failed to generate embedding for search query");
    });

    it("should handle empty search results", async () => {
      const criteria = { product: "textiles" };
      const mockEmbedding = [0.1, 0.2, 0.3];

      mockOpenAIService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockExcelModel.vectorSearch.mockResolvedValue([]);

      const results = await embeddingSearchService.searchLeads(criteria);

      expect(results).toEqual([]);
    });
  });

  describe("findFieldValue", () => {
    it("should find field value with case-insensitive matching", () => {
      const rowData = {
        Company_Name: "ABC Corp",
        CONTACT_PERSON: "John Doe",
        email_address: "john@abc.com",
      };

      expect(embeddingSearchService.findFieldValue(rowData, "company")).toBe(
        "ABC Corp"
      );
      expect(embeddingSearchService.findFieldValue(rowData, "contact")).toBe(
        "John Doe"
      );
      expect(embeddingSearchService.findFieldValue(rowData, "email")).toBe(
        "john@abc.com"
      );
    });

    it("should return null for non-existent fields", () => {
      const rowData = { Company: "ABC Corp" };

      expect(
        embeddingSearchService.findFieldValue(rowData, "nonexistent")
      ).toBeNull();
    });

    it("should handle empty or null values", () => {
      const rowData = {
        Company: "",
        Contact: null,
        Email: "test@example.com",
      };

      expect(
        embeddingSearchService.findFieldValue(rowData, "company")
      ).toBeNull();
      expect(
        embeddingSearchService.findFieldValue(rowData, "contact")
      ).toBeNull();
      expect(embeddingSearchService.findFieldValue(rowData, "email")).toBe(
        "test@example.com"
      );
    });
  });
});
