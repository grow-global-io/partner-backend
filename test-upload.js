const FormData = require("form-data");
const fs = require("fs");
const fetch = require("node-fetch");

async function testPDFUpload() {
  try {
    console.log("🧪 Testing PDF Upload with New Embedding System");

    // Check if the PDF file exists
    const pdfPath = "/Users/lokeshst/Downloads/Tamiri Lokesh Sai.pdf";
    if (!fs.existsSync(pdfPath)) {
      console.error("❌ PDF file not found at:", pdfPath);
      console.log("Please ensure the PDF file exists at the expected location");
      return;
    }

    console.log("✅ PDF file found");

    // Create form data
    const form = new FormData();
    form.append("pdf", fs.createReadStream(pdfPath));
    form.append("walletId", "test_wallet_deepseek");

    console.log("📤 Uploading PDF to server...");

    // Upload PDF
    const response = await fetch("http://localhost:8000/api/pdf-chat/upload", {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    });

    const result = await response.json();

    if (response.ok) {
      console.log("✅ Upload successful!");
      console.log("📊 Upload Results:");
      console.log(`   Document ID: ${result.data.documentId}`);
      console.log(`   File Name: ${result.data.fileName}`);
      console.log(`   Total Pages: ${result.data.totalPages}`);
      console.log(`   Total Chunks: ${result.data.totalChunks}`);
      console.log(
        `   File Size: ${Math.round(result.data.fileSize / 1024)} KB`
      );

      // Test chat functionality
      if (result.data.totalChunks > 0) {
        console.log("\n🤖 Testing Chat Functionality...");

        const chatResponse = await fetch(
          `http://localhost:8000/api/pdf-chat/chat/${result.data.documentId}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query:
                "What is this person's name and what technologies do they know?",
            }),
          }
        );

        const chatResult = await chatResponse.json();

        if (chatResponse.ok) {
          console.log("✅ Chat successful!");
          console.log("🔍 Chat Results:");
          console.log(`   Relevant Chunks: ${chatResult.data.relevantChunks}`);
          console.log(`   Response Time: ${chatResult.data.responseTime}ms`);
          console.log(
            `   Answer: ${chatResult.data.answer.substring(0, 200)}...`
          );
        } else {
          console.log("❌ Chat failed:", chatResult.error);
        }
      }
    } else {
      console.log("❌ Upload failed:", result.error);
      if (result.details) {
        console.log("   Details:", result.details);
      }
    }
  } catch (error) {
    console.error("❌ Test failed with error:", error.message);
  }
}

// Run the test
testPDFUpload();
