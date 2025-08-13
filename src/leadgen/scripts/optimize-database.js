/**
 * @description Database optimization script for MongoDB vector search performance
 */

const { PrismaClient } = require("@prisma/client");
const ExcelModel = require("../models/ExcelModel");

const prisma = new PrismaClient();
const excelModel = new ExcelModel();

/**
 * @description Run database optimizations
 */
async function optimizeDatabase() {
  console.log("🚀 Starting Database Optimization for Vector Search");
  console.log("=".repeat(60));

  try {
    // 1. Show current database statistics
    await showDatabaseStats();

    // 2. Create recommended indexes
    await createRecommendedIndexes();

    // 3. Analyze embedding data quality
    await analyzeEmbeddingQuality();

    // 4. Test vector search performance
    await testVectorSearchPerformance();

    console.log("\n✅ Database optimization completed successfully!");
    console.log("\n📋 Next Steps:");
    console.log(
      "1. If using MongoDB Atlas, create the vector search index manually"
    );
    console.log(
      "2. Set MONGODB_ATLAS_VECTOR_SEARCH=true in your environment variables"
    );
    console.log(
      "3. Test the optimized API with: node src/leadgen/test/test-optimized-findleads.js"
    );
  } catch (error) {
    console.error("❌ Database optimization failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * @description Show current database statistics
 */
async function showDatabaseStats() {
  console.log("\n📊 Current Database Statistics");
  console.log("-".repeat(40));

  try {
    // Count documents and rows
    const documentCount = await prisma.excelDocument.count();
    const rowCount = await prisma.excelRow.count();

    console.log(`📄 Excel Documents: ${documentCount}`);
    console.log(`📋 Excel Rows: ${rowCount}`);

    if (rowCount > 0) {
      // Sample embedding data
      const sampleRow = await prisma.excelRow.findFirst({
        select: {
          embedding: true,
          content: true,
          rowData: true,
        },
      });

      if (sampleRow) {
        const embeddingType = typeof sampleRow.embedding;
        const embeddingLength = Array.isArray(sampleRow.embedding)
          ? sampleRow.embedding.length
          : sampleRow.embedding && typeof sampleRow.embedding === "object"
          ? Object.keys(sampleRow.embedding).length
          : 0;

        console.log(`🔢 Embedding Type: ${embeddingType}`);
        console.log(`📏 Embedding Dimensions: ${embeddingLength}`);
        console.log(
          `📝 Sample Content Length: ${sampleRow.content?.length || 0} chars`
        );
        console.log(
          `🏢 Sample Company: ${
            sampleRow.rowData?.Company ||
            sampleRow.rowData?.companyname ||
            "N/A"
          }`
        );
      }

      // Check for null embeddings
      const nullEmbeddingCount = await prisma.excelRow.count({
        where: {
          embedding: null,
        },
      });

      console.log(
        `❌ Rows with NULL embeddings: ${nullEmbeddingCount} (${Math.round(
          (nullEmbeddingCount / rowCount) * 100
        )}%)`
      );
    }
  } catch (error) {
    console.error("Error getting database stats:", error.message);
  }
}

/**
 * @description Create recommended database indexes
 */
async function createRecommendedIndexes() {
  console.log("\n🔧 Database Index Recommendations");
  console.log("-".repeat(40));

  // Show recommended indexes for manual creation
  await excelModel.createOptimizedIndexes();

  console.log("\n💡 For MongoDB Atlas Vector Search:");
  console.log("1. Go to your Atlas cluster → Search → Create Search Index");
  console.log('2. Choose "JSON Editor" and use this configuration:');
  console.log(`
{
  "fields": [
    {
      "numDimensions": 1536,
      "path": "embedding",
      "similarity": "cosine",
      "type": "vector"
    }
  ]
}
  `);
  console.log('3. Name the index: "vector_search_index"');
  console.log("4. Set MONGODB_ATLAS_VECTOR_SEARCH=true in your .env file");
}

/**
 * @description Analyze embedding data quality
 */
async function analyzeEmbeddingQuality() {
  console.log("\n🔍 Analyzing Embedding Data Quality");
  console.log("-".repeat(40));

  try {
    const sampleSize = 10;
    const sampleRows = await prisma.excelRow.findMany({
      take: sampleSize,
      select: {
        id: true,
        embedding: true,
        content: true,
        rowData: true,
      },
    });

    let validEmbeddings = 0;
    let invalidEmbeddings = 0;
    let dimensionCounts = {};

    for (const row of sampleRows) {
      const normalized = excelModel.normalizeEmbedding(row.embedding);
      if (normalized) {
        validEmbeddings++;
        const dims = normalized.length;
        dimensionCounts[dims] = (dimensionCounts[dims] || 0) + 1;
      } else {
        invalidEmbeddings++;
        console.log(
          `❌ Invalid embedding in row ${row.id}: ${typeof row.embedding}`
        );
      }
    }

    console.log(`✅ Valid embeddings: ${validEmbeddings}/${sampleSize}`);
    console.log(`❌ Invalid embeddings: ${invalidEmbeddings}/${sampleSize}`);
    console.log(`📏 Dimension distribution:`, dimensionCounts);

    if (validEmbeddings === 0) {
      console.log(
        "⚠️  WARNING: No valid embeddings found! Vector search will not work."
      );
      console.log("   Please check your embedding generation process.");
    }
  } catch (error) {
    console.error("Error analyzing embedding quality:", error.message);
  }
}

/**
 * @description Test vector search performance
 */
async function testVectorSearchPerformance() {
  console.log("\n⚡ Testing Vector Search Performance");
  console.log("-".repeat(40));

  try {
    // Get a sample embedding for testing
    const sampleRow = await prisma.excelRow.findFirst({
      select: {
        embedding: true,
      },
    });

    if (!sampleRow || !sampleRow.embedding) {
      console.log("❌ No sample embedding found for performance testing");
      return;
    }

    const testEmbedding = excelModel.normalizeEmbedding(sampleRow.embedding);
    if (!testEmbedding) {
      console.log("❌ Sample embedding is invalid");
      return;
    }

    console.log("🧪 Testing different search methods...");

    // Test 1: Original method
    console.log("\n1. Testing original vector search...");
    const originalStart = Date.now();
    const originalResults = await excelModel.vectorSearch(
      testEmbedding,
      null,
      5,
      0.0
    );
    const originalTime = Date.now() - originalStart;
    console.log(
      `   Original method: ${originalTime}ms, ${originalResults.length} results`
    );

    // Test 2: Optimized method
    console.log("\n2. Testing optimized vector search...");
    const optimizedStart = Date.now();
    const optimizedResults = await excelModel.vectorSearchOptimized(
      testEmbedding,
      null,
      5,
      0.0
    );
    const optimizedTime = Date.now() - optimizedStart;
    console.log(
      `   Optimized method: ${optimizedTime}ms, ${optimizedResults.length} results`
    );

    // Test 3: Batch method
    console.log("\n3. Testing batch vector search...");
    const batchStart = Date.now();
    const batchResults = await excelModel.batchVectorSearch(
      [testEmbedding, testEmbedding],
      null,
      5,
      0.0
    );
    const batchTime = Date.now() - batchStart;
    console.log(
      `   Batch method: ${batchTime}ms, ${batchResults
        .map((r) => r.length)
        .join(",")} results`
    );

    // Performance comparison
    const improvement = Math.round(
      ((originalTime - optimizedTime) / originalTime) * 100
    );
    console.log(
      `\n📈 Performance Improvement: ${improvement}% faster with optimized method`
    );

    if (optimizedTime < originalTime) {
      console.log("✅ Optimization is working correctly!");
    } else {
      console.log("⚠️  Optimization may need tuning for your dataset size");
    }
  } catch (error) {
    console.error("Error testing vector search performance:", error.message);
  }
}

// Run optimization if called directly
if (require.main === module) {
  optimizeDatabase()
    .then(() => {
      console.log("\n🎉 Database optimization script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Database optimization failed:", error);
      process.exit(1);
    });
}

module.exports = {
  optimizeDatabase,
  showDatabaseStats,
  createRecommendedIndexes,
  analyzeEmbeddingQuality,
  testVectorSearchPerformance,
};
