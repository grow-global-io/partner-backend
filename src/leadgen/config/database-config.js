/**
 * @description Database configuration for vector search optimizations
 */

/**
 * @description Get database configuration for vector search
 * @returns {Object} Database configuration
 */
function getDatabaseConfig() {
  return {
    // MongoDB Atlas Vector Search
    useAtlasVectorSearch: process.env.MONGODB_ATLAS_VECTOR_SEARCH === "true",
    vectorSearchIndex:
      process.env.VECTOR_SEARCH_INDEX_NAME || "vector_search_index",

    // Performance tuning
    maxCandidates: parseInt(process.env.VECTOR_SEARCH_MAX_CANDIDATES) || 100,
    batchSize: parseInt(process.env.VECTOR_SEARCH_BATCH_SIZE) || 50,
    connectionPoolSize: parseInt(process.env.DB_CONNECTION_POOL_SIZE) || 10,

    // Search optimization
    enableEarlyTermination: process.env.ENABLE_EARLY_TERMINATION !== "false",
    enableBatchSearch: process.env.ENABLE_BATCH_SEARCH !== "false",
    enableQueryOptimization: process.env.ENABLE_QUERY_OPTIMIZATION !== "false",

    // Debugging
    enableVectorSearchDebug: process.env.VECTOR_SEARCH_DEBUG === "true",
    logSlowQueries: process.env.LOG_SLOW_QUERIES !== "false",
    slowQueryThreshold: parseInt(process.env.SLOW_QUERY_THRESHOLD) || 5000, // 5 seconds
  };
}

/**
 * @description Check if all required configurations are set
 * @returns {Object} Configuration status
 */
function checkDatabaseConfig() {
  const config = getDatabaseConfig();
  const issues = [];
  const recommendations = [];

  // Check MongoDB connection
  if (!process.env.DATABASE_URL) {
    issues.push("DATABASE_URL environment variable is not set");
  }

  // Check Atlas Vector Search setup
  if (!config.useAtlasVectorSearch) {
    recommendations.push(
      "Consider enabling MongoDB Atlas Vector Search for better performance"
    );
    recommendations.push(
      "Set MONGODB_ATLAS_VECTOR_SEARCH=true after creating the vector index"
    );
  }

  // Performance recommendations
  if (config.connectionPoolSize < 5) {
    recommendations.push(
      "Consider increasing DB_CONNECTION_POOL_SIZE for better concurrency"
    );
  }

  return {
    config,
    issues,
    recommendations,
    isOptimal: issues.length === 0 && config.useAtlasVectorSearch,
  };
}

/**
 * @description Print database configuration status
 */
function printDatabaseConfig() {
  const status = checkDatabaseConfig();

  console.log("\n🔧 Database Configuration Status");
  console.log("=".repeat(40));

  console.log("\n📋 Current Configuration:");
  console.log(
    `  Atlas Vector Search: ${
      status.config.useAtlasVectorSearch ? "✅ Enabled" : "❌ Disabled"
    }`
  );
  console.log(`  Vector Index Name: ${status.config.vectorSearchIndex}`);
  console.log(`  Max Candidates: ${status.config.maxCandidates}`);
  console.log(`  Batch Size: ${status.config.batchSize}`);
  console.log(`  Connection Pool: ${status.config.connectionPoolSize}`);
  console.log(
    `  Early Termination: ${status.config.enableEarlyTermination ? "✅" : "❌"}`
  );
  console.log(
    `  Batch Search: ${status.config.enableBatchSearch ? "✅" : "❌"}`
  );
  console.log(
    `  Query Optimization: ${
      status.config.enableQueryOptimization ? "✅" : "❌"
    }`
  );

  if (status.issues.length > 0) {
    console.log("\n❌ Configuration Issues:");
    status.issues.forEach((issue) => console.log(`  - ${issue}`));
  }

  if (status.recommendations.length > 0) {
    console.log("\n💡 Recommendations:");
    status.recommendations.forEach((rec) => console.log(`  - ${rec}`));
  }

  if (status.isOptimal) {
    console.log("\n🎉 Database configuration is optimal for vector search!");
  } else {
    console.log(
      "\n⚠️  Database configuration can be improved for better performance"
    );
  }

  return status;
}

module.exports = {
  getDatabaseConfig,
  checkDatabaseConfig,
  printDatabaseConfig,
};
