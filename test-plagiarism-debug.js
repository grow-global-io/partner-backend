const PlagiarismDetectionService = require("./src/leadgen/services/PlagiarismDetectionService");

async function testPlagiarismDetection() {
  console.log("🔍 Testing Plagiarism Detection System...");

  const service = new PlagiarismDetectionService();

  const testText =
    "Artificial intelligence is transforming the way we work and live. Machine learning algorithms can now process vast amounts of data to identify patterns and make predictions.";

  try {
    console.log("📝 Testing with text:", testText);

    const result = await service.checkTextContent(testText, { maxQueries: 2 });

    console.log("✅ Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

testPlagiarismDetection();
