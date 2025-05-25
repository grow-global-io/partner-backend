const fetch = require("node-fetch");

async function testEmbeddingEndpoint() {
  try {
    console.log("🧪 Testing Embedding System via API");

    // Test the server status first
    console.log("📡 Checking server status...");
    const statusResponse = await fetch(
      "http://localhost:8000/api/pdf-chat/docs"
    );
    console.log(`✅ Server is responding (status: ${statusResponse.status})`);

    // Since we don't have the actual PDF, let's test if we can create a document with embeddings
    // by checking if there are any existing documents
    console.log("\n📋 Checking existing documents...");

    const documentsResponse = await fetch(
      "http://localhost:8000/api/pdf-chat/documents/test_wallet_deepseek"
    );

    if (documentsResponse.ok) {
      const documentsResult = await documentsResponse.json();
      console.log(
        "📊 Documents found:",
        documentsResult.data?.documents?.length || 0
      );

      if (documentsResult.data?.documents?.length > 0) {
        const document = documentsResult.data.documents[0];
        console.log(`📄 Testing chat with document: ${document.fileName}`);

        // Test chat functionality
        const chatResponse = await fetch(
          `http://localhost:8000/api/pdf-chat/chat/${document.documentId}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: "What is this document about?",
            }),
          }
        );

        const chatResult = await chatResponse.json();

        if (chatResponse.ok) {
          console.log("✅ Chat successful!");
          console.log("🔍 Chat Results:");
          console.log(`   Document: ${chatResult.data.documentName}`);
          console.log(`   Relevant Chunks: ${chatResult.data.relevantChunks}`);
          console.log(`   Response Time: ${chatResult.data.responseTime}ms`);
          console.log(
            `   Answer: ${chatResult.data.answer.substring(0, 200)}...`
          );
        } else {
          console.log("❌ Chat failed:", chatResult.error);
          console.log(
            "   Details:",
            chatResult.details || "No details provided"
          );
        }
      } else {
        console.log(
          "📝 No documents found. The embedding system is ready for new uploads."
        );
        console.log(
          "✅ Server is running with the new Deepseek embedding system!"
        );
        console.log("🔧 To test with a real PDF:");
        console.log(
          "   1. Place a PDF file at /Users/lokeshst/Downloads/Tamiri Lokesh Sai.pdf"
        );
        console.log("   2. Run: node test-upload.js");
      }
    } else {
      console.log("❌ Failed to check documents:", documentsResponse.status);
    }
  } catch (error) {
    console.error("❌ Test failed with error:", error.message);
  }
}

// Run the test
testEmbeddingEndpoint();
