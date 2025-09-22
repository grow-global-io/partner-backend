# Plagiarism Checker Setup Guide

## Overview

This plagiarism detection system is a complete Copyscape clone that works independently without requiring external plagiarism APIs. It uses web search engines to find potential matches and advanced text similarity algorithms to detect plagiarism.

## Required Dependencies

To use the plagiarism checker functionality, you need to install the following additional dependency:

```bash
npm install jsdom
```


## Environment Variables

Copy the `.env.plagiarism.example` file to your `.env` file and configure the following variables:

### Optional for Better Results

- `GOOGLE_SEARCH_API_KEY` - Your Google Custom Search API key
- `GOOGLE_SEARCH_ENGINE_ID` - Your Google Custom Search Engine ID
- `BING_SEARCH_API_KEY` - Your Bing Search API key

### Configuration Options

- `PLAGIARISM_MAX_TEXT_LENGTH` - Maximum text length (default: 10000)
- `PLAGIARISM_MAX_SEARCH_RESULTS` - Maximum search results to check (default: 10)
- `PLAGIARISM_MIN_SIMILARITY_THRESHOLD` - Minimum similarity threshold (default: 0.3)

## Getting Search Engine API Keys

### Google Custom Search API (Recommended)

1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Custom Search API
4. Create credentials (API key)
5. Set up a Custom Search Engine at [Google CSE](https://cse.google.com/)
6. Get your Search Engine ID
7. Add both to your `.env` file

### Bing Search API (Alternative)

1. Visit [Microsoft Azure Portal](https://portal.azure.com/)
2. Create a Bing Search v7 resource
3. Get your API key from the resource
4. Add it to your `.env` file

## No API Keys Required

The system works without any API keys using DuckDuckGo search, but results will be limited. For production use, it's recommended to configure at least one search engine API.

## How It Works

### 1. Content Analysis

- Extracts key phrases and important sentences from input text
- Generates optimized search queries for web search
- Analyzes text structure and readability

### 2. Web Search

- Searches multiple search engines (Google, Bing, DuckDuckGo)
- Finds potential sources containing similar content
- Filters and ranks results by relevance

### 3. Content Extraction

- Extracts text content from found web pages
- Handles various content formats and structures
- Implements security measures against SSRF attacks

### 4. Similarity Analysis

- Uses multiple algorithms: Cosine similarity, Jaccard similarity, N-gram analysis
- Finds exact phrase matches and paraphrased content
- Calculates weighted plagiarism scores

### 5. Report Generation

- Creates detailed reports with matching sources
- Provides similarity scores and risk levels
- Includes context and matched text segments

## API Endpoints

Once set up, the following endpoints will be available:

- `POST /api/leadgen/plagiarism/check-text` - Check text content for plagiarism
- `POST /api/leadgen/plagiarism/check-url` - Check URL content for plagiarism
- `GET /api/leadgen/plagiarism/report/:reportId` - Get plagiarism report by ID
- `GET /api/leadgen/plagiarism/health` - Check service health
- `GET /api/leadgen/plagiarism/stats` - Get usage statistics

## Security Features

- **SSRF Protection**: Validates URLs and blocks access to private networks
- **Input Validation**: Comprehensive validation and sanitization
- **Rate Limiting**: Built-in rate limiting for search engines
- **Content Size Limits**: Prevents processing of oversized content
- **Protocol Restrictions**: Only allows HTTP/HTTPS protocols

## Performance Features

- **Intelligent Caching**: Results cached to reduce duplicate processing
- **Concurrent Processing**: Parallel content extraction and analysis
- **Search Optimization**: Smart query generation and result filtering
- **Resource Management**: Configurable limits and timeouts

## Accuracy Features

- **Multi-Algorithm Analysis**: Combines multiple similarity detection methods
- **Phrase-Level Matching**: Detects exact phrase matches and paraphrasing
- **Context Analysis**: Provides context around matched content
- **Risk Assessment**: Categorizes plagiarism risk levels
- **Detailed Reporting**: Comprehensive match analysis and scoring

## Testing

The service includes comprehensive testing capabilities:

- Works immediately without any API keys
- Generates realistic test data for development
- Includes health checks and monitoring
- Provides detailed error reporting

## Production Deployment

For production use:

1. Configure at least one search engine API (Google recommended)
2. Set appropriate rate limits and timeouts
3. Monitor usage statistics and performance
4. Implement proper logging and error handling
5. Consider using Redis for caching in high-traffic scenarios

## Comparison with Copyscape

This implementation provides:

- ✅ **No subscription fees** - Completely free to use
- ✅ **Full control** - Customize algorithms and thresholds
- ✅ **No rate limits** - Only limited by your search API quotas
- ✅ **Detailed analysis** - More comprehensive similarity metrics
- ✅ **Open source** - Modify and extend as needed
- ✅ **Privacy** - Content processed on your servers
- ⚠️ **Search dependency** - Requires search engine APIs for best results
- ⚠️ **Setup complexity** - More initial configuration required
