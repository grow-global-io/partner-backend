/**
 * @description Service for calculating text similarity using multiple algorithms
 * @class TextSimilarityService
 */
class TextSimilarityService {
  constructor() {
    // Configuration
    this.ngramSizes = [2, 3, 4]; // Bigrams, trigrams, 4-grams
    this.minMatchLength = 5; // Minimum words for a match
    this.stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "this",
      "that",
      "these",
      "those",
      "i",
      "you",
      "he",
      "she",
      "it",
      "we",
      "they",
      "me",
      "him",
      "her",
      "us",
      "them",
      "my",
      "your",
      "his",
      "her",
      "its",
      "our",
      "their",
      "mine",
      "yours",
      "hers",
      "ours",
      "theirs",
    ]);
  }

  /**
   * Calculate comprehensive similarity between two texts
   * @param {string} text1 - First text
   * @param {string} text2 - Second text
   * @returns {Object} Similarity analysis
   */
  async calculateSimilarity(text1, text2) {
    try {
      // Preprocess texts
      const processed1 = this.preprocessText(text1);
      const processed2 = this.preprocessText(text2);

      // Calculate different similarity metrics
      const cosineSimilarity = this.calculateCosineSimilarity(
        processed1,
        processed2
      );
      const jaccardSimilarity = this.calculateJaccardSimilarity(
        processed1,
        processed2
      );
      const ngramSimilarity = this.calculateNgramSimilarity(
        processed1,
        processed2
      );
      const exactMatches = this.findExactMatches(processed1, processed2);
      const semanticSimilarity = this.calculateSemanticSimilarity(
        processed1,
        processed2
      );

      // Calculate weighted overall score
      const overallScore = this.calculateWeightedScore({
        cosine: cosineSimilarity,
        jaccard: jaccardSimilarity,
        ngram: ngramSimilarity,
        exact: exactMatches.score,
        semantic: semanticSimilarity,
      });

      return {
        overallScore,
        metrics: {
          cosineSimilarity,
          jaccardSimilarity,
          ngramSimilarity,
          exactMatchScore: exactMatches.score,
          semanticSimilarity,
        },
        exactMatches: exactMatches.matches,
        analysis: {
          text1Length: processed1.words.length,
          text2Length: processed2.words.length,
          commonWords: this.findCommonWords(processed1.words, processed2.words)
            .length,
          uniqueWords1: processed1.uniqueWords.size,
          uniqueWords2: processed2.uniqueWords.size,
        },
      };
    } catch (error) {
      console.error(
        "TextSimilarityService: Similarity calculation error:",
        error
      );
      throw error;
    }
  }

  /**
   * Find matching segments between two texts
   * @param {string} text1 - Original text
   * @param {string} text2 - Comparison text
   * @returns {Object} Matching segments details
   */
  async findMatchingSegments(text1, text2) {
    try {
      const sentences1 = this.splitIntoSentences(text1);
      const sentences2 = this.splitIntoSentences(text2);

      const segments = [];
      let longestMatch = "";
      let totalMatchedWords = 0;
      let totalMatchedChars = 0;

      // Compare sentences for matches
      for (let i = 0; i < sentences1.length; i++) {
        const sentence1 = sentences1[i];

        for (let j = 0; j < sentences2.length; j++) {
          const sentence2 = sentences2[j];

          const similarity = this.calculateStringSimilarity(
            sentence1,
            sentence2
          );

          if (similarity > 0.7) {
            // High similarity threshold for segments
            const matchedWords = this.countWords(sentence1);
            const matchedChars = sentence1.length;

            segments.push({
              originalText: sentence1,
              matchedText: sentence2,
              similarity: Math.round(similarity * 100),
              position: i,
              wordCount: matchedWords,
              characterCount: matchedChars,
            });

            totalMatchedWords += matchedWords;
            totalMatchedChars += matchedChars;

            if (sentence1.length > longestMatch.length) {
              longestMatch = sentence1;
            }
          }
        }
      }

      // Find context for the longest match
      let contextBefore = "";
      let contextAfter = "";

      if (longestMatch && segments.length > 0) {
        const longestSegment = segments.find(
          (s) => s.originalText === longestMatch
        );
        if (longestSegment) {
          const position = longestSegment.position;
          contextBefore = position > 0 ? sentences1[position - 1] : "";
          contextAfter =
            position < sentences1.length - 1 ? sentences1[position + 1] : "";
        }
      }

      return {
        segments,
        longestMatch,
        contextBefore,
        contextAfter,
        matchedWordCount: totalMatchedWords,
        matchedCharCount: totalMatchedChars,
        totalSegments: segments.length,
      };
    } catch (error) {
      console.error("TextSimilarityService: Segment matching error:", error);
      return {
        segments: [],
        longestMatch: "",
        contextBefore: "",
        contextAfter: "",
        matchedWordCount: 0,
        matchedCharCount: 0,
        totalSegments: 0,
      };
    }
  }

  /**
   * Preprocess text for analysis
   * @param {string} text - Input text
   * @returns {Object} Processed text data
   */
  preprocessText(text) {
    // Clean and normalize text
    const cleaned = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ") // Remove punctuation
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim();

    const words = cleaned.split(" ").filter((word) => word.length > 0);
    const filteredWords = words.filter((word) => !this.stopWords.has(word));
    const uniqueWords = new Set(filteredWords);

    return {
      original: text,
      cleaned,
      words: filteredWords,
      uniqueWords,
      wordCount: filteredWords.length,
    };
  }

  /**
   * Calculate cosine similarity using TF-IDF
   * @param {Object} processed1 - Processed text 1
   * @param {Object} processed2 - Processed text 2
   * @returns {number} Cosine similarity score
   */
  calculateCosineSimilarity(processed1, processed2) {
    // Create vocabulary
    const vocabulary = new Set([
      ...processed1.uniqueWords,
      ...processed2.uniqueWords,
    ]);

    if (vocabulary.size === 0) return 0;

    // Calculate TF-IDF vectors
    const vector1 = this.createTfIdfVector(processed1.words, vocabulary);
    const vector2 = this.createTfIdfVector(processed2.words, vocabulary);

    // Calculate cosine similarity
    const dotProduct = this.dotProduct(vector1, vector2);
    const magnitude1 = this.magnitude(vector1);
    const magnitude2 = this.magnitude(vector2);

    if (magnitude1 === 0 || magnitude2 === 0) return 0;

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Calculate Jaccard similarity
   * @param {Object} processed1 - Processed text 1
   * @param {Object} processed2 - Processed text 2
   * @returns {number} Jaccard similarity score
   */
  calculateJaccardSimilarity(processed1, processed2) {
    const set1 = processed1.uniqueWords;
    const set2 = processed2.uniqueWords;

    const intersection = new Set([...set1].filter((word) => set2.has(word)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 0;

    return intersection.size / union.size;
  }

  /**
   * Calculate N-gram similarity
   * @param {Object} processed1 - Processed text 1
   * @param {Object} processed2 - Processed text 2
   * @returns {number} N-gram similarity score
   */
  calculateNgramSimilarity(processed1, processed2) {
    let totalSimilarity = 0;
    let totalComparisons = 0;

    for (const n of this.ngramSizes) {
      const ngrams1 = this.generateNgrams(processed1.words, n);
      const ngrams2 = this.generateNgrams(processed2.words, n);

      if (ngrams1.length === 0 || ngrams2.length === 0) continue;

      const similarity = this.calculateSetSimilarity(ngrams1, ngrams2);
      totalSimilarity += similarity;
      totalComparisons++;
    }

    return totalComparisons > 0 ? totalSimilarity / totalComparisons : 0;
  }

  /**
   * Find exact phrase matches
   * @param {Object} processed1 - Processed text 1
   * @param {Object} processed2 - Processed text 2
   * @returns {Object} Exact matches data
   */
  findExactMatches(processed1, processed2) {
    const matches = [];
    const words1 = processed1.words;
    const words2 = processed2.words;

    // Find exact phrase matches of minimum length
    for (let i = 0; i <= words1.length - this.minMatchLength; i++) {
      for (
        let len = this.minMatchLength;
        len <= Math.min(20, words1.length - i);
        len++
      ) {
        const phrase1 = words1.slice(i, i + len).join(" ");

        for (let j = 0; j <= words2.length - len; j++) {
          const phrase2 = words2.slice(j, j + len).join(" ");

          if (phrase1 === phrase2) {
            matches.push({
              phrase: phrase1,
              length: len,
              position1: i,
              position2: j,
            });
          }
        }
      }
    }

    // Remove overlapping matches, keep longest ones
    const uniqueMatches = this.removeOverlappingMatches(matches);

    // Calculate score based on matched words
    const totalMatchedWords = uniqueMatches.reduce(
      (sum, match) => sum + match.length,
      0
    );
    const score =
      Math.min(words1.length, words2.length) > 0
        ? totalMatchedWords / Math.min(words1.length, words2.length)
        : 0;

    return {
      matches: uniqueMatches,
      score,
      totalMatchedWords,
    };
  }

  /**
   * Calculate semantic similarity (simplified version)
   * @param {Object} processed1 - Processed text 1
   * @param {Object} processed2 - Processed text 2
   * @returns {number} Semantic similarity score
   */
  calculateSemanticSimilarity(processed1, processed2) {
    // This is a simplified semantic similarity calculation
    // In a production system, you might use word embeddings or language models

    // For now, we'll use word overlap with semantic word groups
    const semanticGroups = this.getSemanticWordGroups();
    let semanticMatches = 0;
    let totalWords = 0;

    for (const word1 of processed1.uniqueWords) {
      totalWords++;

      if (processed2.uniqueWords.has(word1)) {
        semanticMatches += 1; // Exact match
      } else {
        // Check for semantic similarity
        for (const group of semanticGroups) {
          if (group.has(word1)) {
            for (const word2 of processed2.uniqueWords) {
              if (group.has(word2)) {
                semanticMatches += 0.5; // Partial semantic match
                break;
              }
            }
            break;
          }
        }
      }
    }

    return totalWords > 0 ? semanticMatches / totalWords : 0;
  }

  /**
   * Calculate weighted overall similarity score
   * @param {Object} scores - Individual similarity scores
   * @returns {number} Weighted overall score
   */
  calculateWeightedScore(scores) {
    // Weights for different similarity metrics
    const weights = {
      exact: 0.4, // Exact matches are most important
      cosine: 0.25, // TF-IDF cosine similarity
      ngram: 0.2, // N-gram similarity
      jaccard: 0.1, // Word overlap
      semantic: 0.05, // Semantic similarity
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [metric, score] of Object.entries(scores)) {
      if (weights[metric] && !isNaN(score)) {
        weightedSum += score * weights[metric];
        totalWeight += weights[metric];
      }
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Create TF-IDF vector for a document
   * @param {Array} words - Array of words
   * @param {Set} vocabulary - Complete vocabulary
   * @returns {Array} TF-IDF vector
   */
  createTfIdfVector(words, vocabulary) {
    const vector = [];
    const wordCount = words.length;
    const wordFreq = {};

    // Calculate term frequency
    for (const word of words) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }

    // Create vector (simplified TF-IDF, without IDF calculation)
    for (const word of vocabulary) {
      const tf = (wordFreq[word] || 0) / wordCount;
      vector.push(tf);
    }

    return vector;
  }

  /**
   * Calculate dot product of two vectors
   * @param {Array} vector1 - First vector
   * @param {Array} vector2 - Second vector
   * @returns {number} Dot product
   */
  dotProduct(vector1, vector2) {
    let sum = 0;
    for (let i = 0; i < vector1.length; i++) {
      sum += vector1[i] * vector2[i];
    }
    return sum;
  }

  /**
   * Calculate magnitude of a vector
   * @param {Array} vector - Input vector
   * @returns {number} Magnitude
   */
  magnitude(vector) {
    let sum = 0;
    for (const value of vector) {
      sum += value * value;
    }
    return Math.sqrt(sum);
  }

  /**
   * Generate N-grams from words
   * @param {Array} words - Array of words
   * @param {number} n - N-gram size
   * @returns {Array} Array of N-grams
   */
  generateNgrams(words, n) {
    const ngrams = [];
    for (let i = 0; i <= words.length - n; i++) {
      ngrams.push(words.slice(i, i + n).join(" "));
    }
    return ngrams;
  }

  /**
   * Calculate similarity between two sets
   * @param {Array} set1 - First set
   * @param {Array} set2 - Second set
   * @returns {number} Set similarity
   */
  calculateSetSimilarity(set1, set2) {
    const s1 = new Set(set1);
    const s2 = new Set(set2);
    const intersection = new Set([...s1].filter((x) => s2.has(x)));
    const union = new Set([...s1, ...s2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} Similarity score (0-1)
   */
  calculateStringSimilarity(str1, str2) {
    // Input validation and coercion to prevent loop bound injection
    const safeStr1 = String(str1 || "").substring(0, 10000); // Limit to 10k chars
    const safeStr2 = String(str2 || "").substring(0, 10000); // Limit to 10k chars

    const distance = this.levenshteinDistance(safeStr1, safeStr2);
    const maxLength = Math.max(safeStr1.length, safeStr2.length);
    return maxLength > 0 ? 1 - distance / maxLength : 1;
  }

  /**
   * Calculate Levenshtein distance between two strings
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} Levenshtein distance
   */
  levenshteinDistance(str1, str2) {
    // Input validation and coercion to prevent loop bound injection
    const safeStr1 = String(str1 || "").substring(0, 10000); // Limit to 10k chars
    const safeStr2 = String(str2 || "").substring(0, 10000); // Limit to 10k chars

    const matrix = [];

    for (let i = 0; i <= safeStr2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= safeStr1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= safeStr2.length; i++) {
      for (let j = 1; j <= safeStr1.length; j++) {
        if (safeStr2.charAt(i - 1) === safeStr1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[safeStr2.length][safeStr1.length];
  }

  /**
   * Split text into sentences
   * @param {string} text - Input text
   * @returns {Array} Array of sentences
   */
  splitIntoSentences(text) {
    return text
      .split(/[.!?]+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 10); // Filter out very short sentences
  }

  /**
   * Count words in text
   * @param {string} text - Input text
   * @returns {number} Word count
   */
  countWords(text) {
    return text.split(/\s+/).filter((word) => word.length > 0).length;
  }

  /**
   * Find common words between two arrays
   * @param {Array} words1 - First word array
   * @param {Array} words2 - Second word array
   * @returns {Array} Common words
   */
  findCommonWords(words1, words2) {
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    return [...set1].filter((word) => set2.has(word));
  }

  /**
   * Remove overlapping matches, keeping the longest ones
   * @param {Array} matches - Array of matches
   * @returns {Array} Non-overlapping matches
   */
  removeOverlappingMatches(matches) {
    // Sort by length (longest first)
    matches.sort((a, b) => b.length - a.length);

    const uniqueMatches = [];
    const usedPositions = new Set();

    for (const match of matches) {
      let overlaps = false;

      for (let i = match.position1; i < match.position1 + match.length; i++) {
        if (usedPositions.has(i)) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        uniqueMatches.push(match);
        for (let i = match.position1; i < match.position1 + match.length; i++) {
          usedPositions.add(i);
        }
      }
    }

    return uniqueMatches;
  }

  /**
   * Get semantic word groups for basic semantic similarity
   * @returns {Array} Array of word sets representing semantic groups
   */
  getSemanticWordGroups() {
    return [
      new Set([
        "good",
        "great",
        "excellent",
        "amazing",
        "wonderful",
        "fantastic",
      ]),
      new Set(["bad", "terrible", "awful", "horrible", "poor", "worst"]),
      new Set(["big", "large", "huge", "enormous", "massive", "giant"]),
      new Set(["small", "tiny", "little", "mini", "miniature", "petite"]),
      new Set(["fast", "quick", "rapid", "swift", "speedy", "hasty"]),
      new Set(["slow", "sluggish", "gradual", "leisurely", "unhurried"]),
      new Set(["happy", "joyful", "cheerful", "glad", "pleased", "delighted"]),
      new Set(["sad", "unhappy", "depressed", "melancholy", "sorrowful"]),
    ];
  }

  /**
   * Health check for text similarity service
   * @returns {Object} Health status
   */
  healthCheck() {
    try {
      // Test basic functionality
      const testResult = this.calculateStringSimilarity("test", "test");

      return {
        healthy: testResult === 1,
        algorithms: ["cosine", "jaccard", "ngram", "exact", "semantic"],
        ngramSizes: this.ngramSizes,
        stopWordsCount: this.stopWords.size,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
      };
    }
  }
}

module.exports = TextSimilarityService;
