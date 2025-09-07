const axios = require("axios");

async function testGetWallet() {
  try {
    const walletAddress = "0x6ef04528da15786a9D75a6895Ac56461e6f12F05";
    const response = await axios.get(
      `http://localhost:8000/api/leadgen/ai-text/wallet/${walletAddress}`
    );

    console.log("✅ Wallet GET Response:");
    console.log(JSON.stringify(response.data, null, 2));

    // Check if generationsAllowed is present
    if (
      response.data.data &&
      response.data.data.generationsAllowed !== undefined
    ) {
      console.log("\n✅ generationsAllowed field is present!");
      console.log(`   Value: ${response.data.data.generationsAllowed}`);
    } else {
      console.log("\n❌ generationsAllowed field is missing!");
    }
  } catch (error) {
    if (error.response) {
      console.log("❌ API Error:");
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Data:`, error.response.data);
    } else if (error.code === "ECONNREFUSED") {
      console.log("❌ Server is not running on port 8000");
      console.log("   Please start your server first");
    } else {
      console.log("❌ Request Error:", error.message);
    }
  }
}

testGetWallet();
