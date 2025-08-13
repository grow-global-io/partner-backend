# Performance Testing for LeadGen API

This directory contains performance testing tools for the LeadGen API optimization project.

## Files

- `PerformanceMonitor.js` - Core performance monitoring service
- `performance-baseline.js` - Baseline performance testing class
- `run-baseline-test.js` - Script to run baseline performance tests

## Running Baseline Performance Tests

### Prerequisites

1. Ensure the API server is running on `http://localhost:3000`
2. Database is connected and has data
3. OpenAI API key is configured
4. Install dependencies: `npm install axios`

### Running the Test

```bash
# From the project root
node src/leadgen/test/run-baseline-test.js

# Or from the test directory
cd src/leadgen/test
node run-baseline-test.js
```

### Test Configuration

The baseline test runs multiple scenarios:

1. **Simple Search** - Basic product/industry search
2. **Complex Search** - Multi-criteria search with region and keywords
3. **High Volume Search** - Large result set request

Each scenario runs 3 iterations by default to get consistent measurements.

### Expected Output

The test will output:

- Overall performance metrics (response times, success rates)
- Per-scenario breakdown
- Performance recommendations
- Optimization targets
- Results saved to JSON file

### Sample Output

```
📊 BASELINE PERFORMANCE TEST RESULTS
====================================

📈 Overall Results:
   Total Tests: 9
   Successful: 9
   Failed: 0
   Success Rate: 100.0%

⏱️  Response Time Analysis:
   Average: 127.3s
   Median: 125.1s
   95th Percentile: 142.8s
   99th Percentile: 142.8s
   Min: 118.2s
   Max: 142.8s

💡 Performance Recommendations:
   1. 🚨 [PERFORMANCE] Average response time is 127s. Immediate optimization required.
      Target: 90% reduction to <10s
```

## Performance Monitoring Integration

The `PerformanceMonitor` class is integrated into the `ExcelController` to track:

- Request-level timing
- Stage-by-stage performance breakdown
- Resource usage (OpenAI API calls, DB queries)
- Cache hit/miss rates
- Error rates and patterns

### Accessing Performance Data

Once the server is running with performance monitoring:

```bash
# Get current metrics
curl http://localhost:3000/api/leadgen/performance/metrics

# Get detailed performance report
curl http://localhost:3000/api/leadgen/performance/report
```

## Performance Targets

Based on the requirements, we aim for:

- **Response Time**: <10 seconds for 95% of requests
- **Throughput**: Support 50+ concurrent users
- **Cache Hit Rate**: >80% for repeated searches
- **API Call Reduction**: >50% reduction in OpenAI API calls
- **Success Rate**: >99% uptime
- **Error Rate**: <1% of requests

## Optimization Phases

1. **Phase 1**: Implement caching and parallel processing
2. **Phase 2**: Optimize database queries and vector search
3. **Phase 3**: Add request batching and circuit breakers
4. **Phase 4**: Fine-tune and monitor performance

## Troubleshooting

### Common Issues

1. **Connection Refused**: API server not running
2. **Timeout Errors**: Database or OpenAI API issues
3. **Authentication Errors**: OpenAI API key not configured
4. **No Results**: Database empty or embedding issues

### Debug Mode

Set `DEBUG=true` environment variable for verbose logging:

```bash
DEBUG=true node src/leadgen/test/run-baseline-test.js
```

## Continuous Monitoring

After implementing optimizations, run the baseline test regularly to:

1. Measure improvement over time
2. Detect performance regressions
3. Validate optimization effectiveness
4. Monitor system health

The performance monitoring system will automatically track and alert on performance issues in production.
