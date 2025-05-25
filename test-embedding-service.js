// Test the new DeepseekService embedding functionality
const DeepseekService = require("./src/pdf-chat/services/OpenAIService.js");

async function testEmbeddingService() {
  console.log("🧪 Testing New Deepseek Embedding Service");

  try {
    const service = new DeepseekService();

    // Test 1: Simple embedding generation
    console.log("\n📝 Test 1: Generate simple text embedding");
    const testText =
      "Tamiri Lokesh Sai is a Full Stack Developer with experience in React, Node.js, and MongoDB.";
    const embedding = await service.generateEmbedding(testText);

    console.log(`✅ Generated embedding vector of length: ${embedding.length}`);
    console.log(
      `📊 First 10 values: [${embedding
        .slice(0, 10)
        .map((v) => v.toFixed(6))
        .join(", ")}...]`
    );

    // Test 2: Multiple chunk embeddings
    console.log("\n📝 Test 2: Generate embeddings for multiple chunks");
    const textChunks = [
      "Tamiri Lokesh Sai is a Full Stack Developer",
      "Experience with React, Node.js, MongoDB, and Python",
      "Skilled in frontend and backend development",
      "Knowledge of database design and API development",
    ];

    const embeddings = await service.generateEmbeddings(textChunks);
    console.log(`✅ Generated ${embeddings.length} embeddings`);

    embeddings.forEach((emb, index) => {
      console.log(
        `   Chunk ${index + 1}: "${emb.text.substring(0, 30)}..." -> Vector[${
          emb.embedding.length
        }]`
      );
    });

    // Test 3: Similarity test
    console.log("\n📝 Test 3: Test similarity between embeddings");
    const queryEmbedding = await service.generateEmbedding(
      "What programming languages does this person know?"
    );

    // Calculate similarities
    const similarities = embeddings.map((emb, index) => {
      const similarity = calculateCosineSimilarity(
        queryEmbedding,
        emb.embedding
      );
      return { index, text: emb.text, similarity };
    });

    similarities.sort((a, b) => b.similarity - a.similarity);

    console.log("🔍 Similarity rankings:");
    similarities.forEach((sim, rank) => {
      console.log(
        `   ${rank + 1}. "${sim.text}" (similarity: ${sim.similarity.toFixed(
          4
        )})`
      );
    });

    console.log(
      "\n✅ All embedding tests passed! The new system is working correctly."
    );
  } catch (error) {
    console.error("❌ Embedding test failed:", error.message);
    console.error(error.stack);
  }
}

function calculateCosineSimilarity(vector1, vector2) {
  if (vector1.length !== vector2.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (let i = 0; i < vector1.length; i++) {
    dotProduct += vector1[i] * vector2[i];
    magnitude1 += vector1[i] * vector1[i];
    magnitude2 += vector2[i] * vector2[i];
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  return dotProduct / (magnitude1 * magnitude2);
}

// Run the test
testEmbeddingService();
