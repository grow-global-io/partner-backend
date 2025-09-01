const TextSimilarityService = require("./src/leadgen/services/TextSimilarityService");

async function testSimilarity() {
  console.log("🔍 Testing Text Similarity Directly...");

  const service = new TextSimilarityService();

  const text1 =
    "Artificial intelligence is transforming the way we work and live. Machine learning algorithms can now process vast amounts of data to identify patterns and make predictions.";

  const text2 =
    "Artificial intelligence is transforming the way we work and live. This technology has applications in healthcare, finance, education, and many other fields.";

  try {
    console.log("📝 Text 1:", text1);
    console.log("📝 Text 2:", text2);

    const similarity = await service.calculateSimilarity(text1, text2);

    console.log("✅ Similarity Result:", JSON.stringify(similarity, null, 2));

    // Test with exact match
    const exactSimilarity = await service.calculateSimilarity(text1, text1);
    console.log(
      "✅ Exact Match Similarity:",
      JSON.stringify(exactSimilarity, null, 2)
    );
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

testSimilarity();
