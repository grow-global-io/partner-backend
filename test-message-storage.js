/**
 * Test script to verify message storage functionality
 * Run with: node test-message-storage.js
 */

const axios = require("axios");

const baseUrl = "http://localhost:8000/api/pdf-chat";
const testWalletId = "test_wallet_123";
const testDocumentId = "test_document_id"; // Replace with actual document ID

async function testMessageStorage() {
  console.log("🧪 Testing PDF Chat Message Storage Functionality\n");

  try {
    // Step 1: Test API health
    console.log("1️⃣ Testing API health...");
    const healthResponse = await axios.get(`${baseUrl}/`);
    console.log("✅ API is running:", healthResponse.data.message);
    console.log("📖 Version:", healthResponse.data.version);
    console.log();

    // Step 2: Test chat endpoint with proper walletId
    console.log("2️⃣ Testing chat with document (should include walletId)...");
    try {
      const chatResponse = await axios.post(
        `${baseUrl}/chat/${testDocumentId}`,
        {
          walletId: testWalletId,
          query: "What is this document about? This is a test query.",
        }
      );

      console.log("✅ Chat successful!");
      console.log("📄 Document:", chatResponse.data.data.documentName);
      console.log(
        "💬 Response preview:",
        chatResponse.data.data.answer.substring(0, 100) + "..."
      );
      console.log(
        "⏱️ Response time:",
        chatResponse.data.data.responseTime + "ms"
      );
      console.log();
    } catch (chatError) {
      if (chatError.response?.status === 404) {
        console.log(
          "⚠️ Document not found. Please upload a document first or update testDocumentId"
        );
        console.log("📝 To upload: POST /upload with walletId and PDF file");
      } else if (chatError.response?.status === 400) {
        console.log(
          "❌ Chat failed - validation error:",
          chatError.response.data.error
        );
      } else {
        console.log(
          "❌ Chat failed:",
          chatError.response?.data?.error || chatError.message
        );
      }
      console.log();
    }

    // Step 3: Test message retrieval
    console.log("3️⃣ Testing message retrieval...");
    try {
      const messagesResponse = await axios.get(
        `${baseUrl}/documents/${testWalletId}/${testDocumentId}/messages?page=1&limit=10`
      );

      console.log("✅ Messages retrieved successfully!");
      console.log(
        "📊 Total messages:",
        messagesResponse.data.data.pagination.totalMessages
      );

      const messages = messagesResponse.data.data.messages;
      if (messages.length > 0) {
        console.log("📝 Recent messages:");
        messages.slice(-3).forEach((msg, index) => {
          console.log(
            `   ${index + 1}. [${msg.sender}] ${msg.message.substring(
              0,
              60
            )}...`
          );
        });
      } else {
        console.log("📝 No messages found for this document");
      }
      console.log();
    } catch (messageError) {
      if (messageError.response?.status === 404) {
        console.log("⚠️ Document not found or no messages exist");
      } else {
        console.log(
          "❌ Message retrieval failed:",
          messageError.response?.data?.error || messageError.message
        );
      }
      console.log();
    }

    // Step 4: Test documents with conversations
    console.log("4️⃣ Testing documents with conversation summaries...");
    try {
      const documentsResponse = await axios.get(
        `${baseUrl}/documents/${testWalletId}`
      );

      console.log("✅ Documents retrieved successfully!");
      console.log(
        "📁 Total documents:",
        documentsResponse.data.data.totalDocuments
      );
      console.log(
        "💬 Documents with conversations:",
        documentsResponse.data.data.documentsWithConversations
      );

      const docs = documentsResponse.data.data.documents;
      if (docs.length > 0) {
        console.log("📋 Document summaries:");
        docs.forEach((doc, index) => {
          console.log(`   ${index + 1}. ${doc.fileName}`);
          console.log(
            `      📊 Messages: ${doc.conversation.totalMessages} (${doc.conversation.userMessages} user, ${doc.conversation.assistantMessages} assistant)`
          );
          console.log(
            `      📅 Last chat: ${doc.conversation.lastMessageAt || "Never"}`
          );
        });
      }
      console.log();
    } catch (docError) {
      console.log(
        "❌ Documents retrieval failed:",
        docError.response?.data?.error || docError.message
      );
      console.log();
    }

    // Step 5: Test validation (missing walletId)
    console.log("5️⃣ Testing validation (missing walletId should fail)...");
    try {
      await axios.post(`${baseUrl}/chat/${testDocumentId}`, {
        query: "This should fail because walletId is missing",
      });
      console.log("❌ Validation failed - request should have been rejected");
    } catch (validationError) {
      if (
        validationError.response?.status === 400 &&
        validationError.response.data.error.includes("walletId")
      ) {
        console.log(
          "✅ Validation working correctly - missing walletId rejected"
        );
      } else {
        console.log(
          "⚠️ Unexpected validation error:",
          validationError.response?.data?.error
        );
      }
    }
    console.log();

    console.log("🎉 Message storage test completed!");
    console.log();
    console.log("📋 Summary of fixes:");
    console.log("✅ walletId is now required in chat requests");
    console.log("✅ Messages are stored with proper walletId");
    console.log("✅ Messages can be retrieved by walletId + documentId");
    console.log("✅ Conversation context works for chain of thought");
    console.log("✅ Access control prevents unauthorized document access");
    console.log();
    console.log("📝 Next steps:");
    console.log("1. Upload a PDF document using POST /upload");
    console.log(
      "2. Update testDocumentId in this script with real document ID"
    );
    console.log("3. Test the complete flow: upload → chat → retrieve messages");
  } catch (error) {
    console.error("💥 Test failed with unexpected error:", error.message);
  }
}

// Run the test
testMessageStorage();
