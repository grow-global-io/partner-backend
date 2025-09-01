// Simple demonstration of working plagiarism detection
const TextSimilarityService = require("./src/leadgen/services/TextSimilarityService");

class SimplePlagiarismDemo {
  constructor() {
    this.textSimilarityService = new TextSimilarityService();

    // Mock database of content to check against
    this.mockDatabase = [
      "Artificial intelligence is transforming the way we work and live. Machine learning algorithms can now process vast amounts of data to identify patterns and make predictions.",
      "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet and is commonly used for testing purposes.",
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      "Technology innovation drives economic growth and social progress. Digital transformation affects every aspect of modern business operations.",
      "Research methodology involves systematic investigation and analysis of phenomena to establish facts and reach new conclusions.",
    ];
  }

  async checkPlagiarism(inputText) {
    console.log(
      `🔍 Checking plagiarism for: "${inputText.substring(0, 50)}..."`
    );

    const matches = [];
    let highestScore = 0;

    // Check against each item in our mock database
    for (let i = 0; i < this.mockDatabase.length; i++) {
      const dbText = this.mockDatabase[i];

      const similarity = await this.textSimilarityService.calculateSimilarity(
        inputText,
        dbText
      );

      console.log(
        `📊 Similarity with source ${i + 1}: ${(
          similarity.overallScore * 100
        ).toFixed(1)}%`
      );

      if (similarity.overallScore > 0.1) {
        // 10% threshold
        matches.push({
          url: `https://example-source-${i + 1}.com/article`,
          title: `Source Document ${i + 1}`,
          similarityScore: Math.round(similarity.overallScore * 100),
          matchType: this.determineMatchType(similarity.overallScore),
          matchedText: dbText.substring(0, 100) + "...",
          similarity: similarity,
        });

        if (similarity.overallScore > highestScore) {
          highestScore = similarity.overallScore;
        }
      }
    }

    // Calculate final plagiarism score
    const plagiarismScore = Math.round(highestScore * 100);

    return {
      plagiarismScore,
      totalMatches: matches.length,
      matches: matches.sort((a, b) => b.similarityScore - a.similarityScore),
      riskLevel: this.calculateRiskLevel(plagiarismScore),
    };
  }

  determineMatchType(score) {
    if (score >= 0.9) return "exact";
    if (score >= 0.7) return "near-exact";
    if (score >= 0.5) return "partial";
    return "paraphrase";
  }

  calculateRiskLevel(score) {
    if (score >= 80) return "high";
    if (score >= 50) return "medium";
    if (score >= 20) return "low";
    return "minimal";
  }
}

async function demonstratePlagiarism() {
  const demo = new SimplePlagiarismDemo();

  console.log("🎯 PLAGIARISM DETECTION DEMONSTRATION\n");

  // Test 1: Exact match
  console.log("TEST 1: Exact Match");
  console.log("===================");
  const exactMatch =
    "Artificial intelligence is transforming the way we work and live. Machine learning algorithms can now process vast amounts of data to identify patterns and make predictions.";
  const result1 = await demo.checkPlagiarism(exactMatch);
  console.log("✅ Result:", JSON.stringify(result1, null, 2));
  console.log("\n");

  // Test 2: Partial match
  console.log("TEST 2: Partial Match");
  console.log("====================");
  const partialMatch =
    "Artificial intelligence is changing how we work. AI systems can analyze large datasets to find patterns.";
  const result2 = await demo.checkPlagiarism(partialMatch);
  console.log("✅ Result:", JSON.stringify(result2, null, 2));
  console.log("\n");

  // Test 3: No match
  console.log("TEST 3: Original Content");
  console.log("=======================");
  const originalContent =
    "This is completely original content that should not match anything in our database. It discusses unique topics and ideas.";
  const result3 = await demo.checkPlagiarism(originalContent);
  console.log("✅ Result:", JSON.stringify(result3, null, 2));
  console.log("\n");

  console.log("🎉 DEMONSTRATION COMPLETE!");
  console.log(
    "This shows how plagiarism detection SHOULD work with proper similarity scores."
  );
}

demonstratePlagiarism().catch(console.error);
