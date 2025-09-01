/**
 * @description Service for analyzing and processing text content
 * @class ContentAnalysisService
 */
class ContentAnalysisService {
  constructor() {
    // Configuration
    this.minPhraseLength = 3; // Minimum words in a phrase
    this.maxPhraseLength = 8; // Maximum words in a phrase
    this.maxSearchQueries = 10; // Maximum search queries to generate

    // Stop words for filtering
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
      "am",
      "been",
      "very",
      "much",
      "many",
      "most",
      "more",
      "some",
      "any",
      "all",
      "each",
      "every",
      "both",
      "either",
      "neither",
      "not",
      "no",
      "yes",
      "well",
      "also",
      "too",
      "only",
      "just",
      "even",
      "still",
      "yet",
    ]);

    // Common words that are good for searching
    this.searchableWords = new Set([
      "technology",
      "business",
      "development",
      "management",
      "system",
      "process",
      "method",
      "approach",
      "strategy",
      "solution",
      "problem",
      "issue",
      "challenge",
      "opportunity",
      "research",
      "study",
      "analysis",
      "report",
      "data",
      "information",
      "knowledge",
      "learning",
      "education",
      "training",
      "skill",
      "experience",
      "expertise",
      "professional",
      "industry",
      "market",
      "customer",
      "client",
      "service",
      "product",
      "quality",
      "performance",
      "result",
    ]);
  }

  /**
   * Analyze text content comprehensively
   * @param {string} text - Text to analyze
   * @returns {Object} Analysis results
   */
  async analyzeText(text) {
    try {
      // Basic text statistics
      const basicStats = this.calculateBasicStats(text);

      // Extract sentences and paragraphs
      const sentences = this.extractSentences(text);
      const paragraphs = this.extractParagraphs(text);

      // Extract key phrases
      const keyPhrases = this.extractKeyPhrases(text);

      // Identify important words
      const importantWords = this.identifyImportantWords(text);

      // Calculate readability metrics
      const readability = this.calculateReadability(
        text,
        sentences,
        basicStats.wordCount
      );

      // Extract named entities (simplified)
      const entities = this.extractNamedEntities(text);

      return {
        basicStats,
        sentences,
        paragraphs,
        keyPhrases,
        importantWords,
        readability,
        entities,
        wordCount: basicStats.wordCount,
        sentenceCount: sentences.length,
        paragraphCount: paragraphs.length,
        averageWordsPerSentence: basicStats.wordCount / sentences.length || 0,
        averageSentencesPerParagraph: sentences.length / paragraphs.length || 0,
      };
    } catch (error) {
      console.error("ContentAnalysisService: Analysis error:", error);
      throw error;
    }
  }

  /**
   * Extract search queries from text for plagiarism checking
   * @param {string} text - Text to extract queries from
   * @param {Object} options - Extraction options
   * @returns {Array} Array of search queries
   */
  extractSearchQueries(text, options = {}) {
    const maxQueries = options.maxQueries || this.maxSearchQueries;
    const minPhraseLength = options.minPhraseLength || this.minPhraseLength;

    try {
      // Extract key phrases
      const keyPhrases = this.extractKeyPhrases(text, {
        minLength: minPhraseLength,
        maxLength: this.maxPhraseLength,
      });

      // Extract important sentences
      const sentences = this.extractSentences(text);
      const importantSentences = this.selectImportantSentences(sentences, text);

      // Combine phrases and sentence fragments
      const queries = new Set();

      // Add key phrases as exact search queries
      keyPhrases.slice(0, Math.ceil(maxQueries * 0.6)).forEach((phrase) => {
        queries.add(`"${phrase.text}"`);
      });

      // Add sentence fragments
      importantSentences
        .slice(0, Math.ceil(maxQueries * 0.4))
        .forEach((sentence) => {
          const fragment = this.extractSearchableFragment(sentence);
          if (fragment && fragment.length > 20) {
            queries.add(`"${fragment}"`);
          }
        });

      // Convert to array and limit
      return Array.from(queries).slice(0, maxQueries);
    } catch (error) {
      console.error("ContentAnalysisService: Query extraction error:", error);
      return [];
    }
  }

  /**
   * Calculate basic text statistics
   * @param {string} text - Input text
   * @returns {Object} Basic statistics
   */
  calculateBasicStats(text) {
    const cleanText = text.trim();
    const words = cleanText.split(/\s+/).filter((word) => word.length > 0);
    const characters = cleanText.length;
    const charactersNoSpaces = cleanText.replace(/\s/g, "").length;

    return {
      characterCount: characters,
      characterCountNoSpaces: charactersNoSpaces,
      wordCount: words.length,
      averageWordLength:
        words.length > 0 ? charactersNoSpaces / words.length : 0,
      longestWord: words.reduce(
        (longest, word) =>
          word.replace(/[^\w]/g, "").length > longest.length
            ? word.replace(/[^\w]/g, "")
            : longest,
        ""
      ),
    };
  }

  /**
   * Extract sentences from text
   * @param {string} text - Input text
   * @returns {Array} Array of sentences
   */
  extractSentences(text) {
    return text
      .split(/[.!?]+/)
      .map((sentence) => sentence.trim())
      .filter(
        (sentence) => sentence.length > 10 && sentence.split(/\s+/).length >= 3
      );
  }

  /**
   * Extract paragraphs from text
   * @param {string} text - Input text
   * @returns {Array} Array of paragraphs
   */
  extractParagraphs(text) {
    return text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 20);
  }

  /**
   * Extract key phrases from text
   * @param {string} text - Input text
   * @param {Object} options - Extraction options
   * @returns {Array} Array of key phrases with scores
   */
  extractKeyPhrases(text, options = {}) {
    const minLength = options.minLength || this.minPhraseLength;
    const maxLength = options.maxLength || this.maxPhraseLength;

    // Clean and tokenize text
    const cleanText = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ");
    const words = cleanText.split(" ").filter((word) => word.length > 2);

    const phrases = new Map();

    // Extract n-gram phrases with bounds checking
    const maxWords = 1000; // Limit to prevent DoS
    const len = Math.min(words.length, maxWords);

    for (let n = minLength; n <= maxLength; n++) {
      for (let i = 0; i <= len - n; i++) {
        const phrase = words.slice(i, i + n);

        // Skip phrases with too many stop words
        const stopWordCount = phrase.filter((word) =>
          this.stopWords.has(word)
        ).length;
        if (stopWordCount > Math.floor(n / 2)) continue;

        // Skip phrases that are all common words
        const hasSearchableWord = phrase.some(
          (word) => this.searchableWords.has(word) || word.length > 6
        );
        if (!hasSearchableWord) continue;

        const phraseText = phrase.join(" ");
        const currentScore = phrases.get(phraseText) || 0;

        // Calculate phrase score
        let score = 1;

        // Longer phrases get higher scores
        score += (n - minLength) * 0.5;

        // Phrases with searchable words get higher scores
        score +=
          phrase.filter((word) => this.searchableWords.has(word)).length * 0.3;

        // Phrases with longer words get higher scores
        score += phrase.filter((word) => word.length > 6).length * 0.2;

        phrases.set(phraseText, currentScore + score);
      }
    }

    // Sort by score and return top phrases
    return Array.from(phrases.entries())
      .map(([text, score]) => ({ text, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }

  /**
   * Identify important words in text
   * @param {string} text - Input text
   * @returns {Array} Array of important words with frequencies
   */
  identifyImportantWords(text) {
    const cleanText = text.toLowerCase().replace(/[^\w\s]/g, " ");
    const words = cleanText
      .split(/\s+/)
      .filter((word) => word.length > 3 && !this.stopWords.has(word));

    const wordFreq = {};
    words.forEach((word) => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    // Calculate TF scores and importance
    const totalWords = words.length;
    const importantWords = [];

    for (const [word, freq] of Object.entries(wordFreq)) {
      let importance = freq / totalWords; // TF score

      // Boost score for searchable words
      if (this.searchableWords.has(word)) {
        importance *= 1.5;
      }

      // Boost score for longer words
      if (word.length > 6) {
        importance *= 1.2;
      }

      // Boost score for capitalized words (likely proper nouns)
      if (text.includes(word.charAt(0).toUpperCase() + word.slice(1))) {
        importance *= 1.3;
      }

      importantWords.push({
        word,
        frequency: freq,
        importance: importance,
        tfScore: freq / totalWords,
      });
    }

    return importantWords
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 15);
  }

  /**
   * Calculate readability metrics
   * @param {string} text - Input text
   * @param {Array} sentences - Array of sentences
   * @param {number} wordCount - Total word count
   * @returns {Object} Readability metrics
   */
  calculateReadability(text, sentences, wordCount) {
    if (sentences.length === 0 || wordCount === 0) {
      return {
        averageWordsPerSentence: 0,
        averageSyllablesPerWord: 0,
        fleschReadingEase: 0,
        readingLevel: "Unknown",
      };
    }

    const averageWordsPerSentence = wordCount / sentences.length;

    // Estimate syllables (simplified)
    const syllableCount = this.estimateSyllables(text);
    const averageSyllablesPerWord = syllableCount / wordCount;

    // Flesch Reading Ease Score
    const fleschReadingEase =
      206.835 -
      1.015 * averageWordsPerSentence -
      84.6 * averageSyllablesPerWord;

    // Determine reading level
    let readingLevel;
    if (fleschReadingEase >= 90) readingLevel = "Very Easy";
    else if (fleschReadingEase >= 80) readingLevel = "Easy";
    else if (fleschReadingEase >= 70) readingLevel = "Fairly Easy";
    else if (fleschReadingEase >= 60) readingLevel = "Standard";
    else if (fleschReadingEase >= 50) readingLevel = "Fairly Difficult";
    else if (fleschReadingEase >= 30) readingLevel = "Difficult";
    else readingLevel = "Very Difficult";

    return {
      averageWordsPerSentence: Math.round(averageWordsPerSentence * 10) / 10,
      averageSyllablesPerWord: Math.round(averageSyllablesPerWord * 10) / 10,
      fleschReadingEase: Math.round(fleschReadingEase * 10) / 10,
      readingLevel,
    };
  }

  /**
   * Extract named entities (simplified version)
   * @param {string} text - Input text
   * @returns {Object} Named entities
   */
  extractNamedEntities(text) {
    // This is a simplified named entity extraction
    // In production, you might use a proper NLP library

    const entities = {
      organizations: [],
      locations: [],
      persons: [],
      dates: [],
      numbers: [],
    };

    // Extract potential organizations (capitalized words/phrases)
    const orgPattern =
      /\b[A-Z][a-z]+ (?:[A-Z][a-z]+ )*(?:Inc|Corp|LLC|Ltd|Company|Corporation|Organization|Institute|University|College)\b/g;
    entities.organizations = [...new Set(text.match(orgPattern) || [])];

    // Extract potential locations (capitalized words before common location words)
    const locationPattern =
      /\b[A-Z][a-z]+ (?:City|State|Country|County|Province|Region|Street|Avenue|Road|Boulevard)\b/g;
    entities.locations = [...new Set(text.match(locationPattern) || [])];

    // Extract dates
    const datePattern =
      /\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4}|(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2},? \d{4})\b/g;
    entities.dates = [...new Set(text.match(datePattern) || [])];

    // Extract numbers and percentages
    const numberPattern = /\b\d+(?:\.\d+)?%?\b/g;
    entities.numbers = [...new Set(text.match(numberPattern) || [])];

    return entities;
  }

  /**
   * Select important sentences for search query generation
   * @param {Array} sentences - Array of sentences
   * @param {string} fullText - Full text for context
   * @returns {Array} Important sentences
   */
  selectImportantSentences(sentences, fullText) {
    const importantWords = this.identifyImportantWords(fullText);
    const importantWordSet = new Set(importantWords.map((w) => w.word));

    const scoredSentences = sentences.map((sentence) => {
      const words = sentence.toLowerCase().split(/\s+/);
      let score = 0;

      // Score based on important words
      words.forEach((word) => {
        if (importantWordSet.has(word)) {
          score += 1;
        }
      });

      // Prefer sentences of medium length
      const wordCount = words.length;
      if (wordCount >= 8 && wordCount <= 20) {
        score += 2;
      } else if (wordCount >= 5 && wordCount <= 30) {
        score += 1;
      }

      // Boost sentences with numbers or specific terms
      if (/\d+/.test(sentence)) score += 0.5;
      if (
        /\b(?:research|study|analysis|method|approach|system|process)\b/i.test(
          sentence
        )
      )
        score += 1;

      return { sentence, score };
    });

    return scoredSentences
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.sentence);
  }

  /**
   * Extract searchable fragment from sentence
   * @param {string} sentence - Input sentence
   * @returns {string} Searchable fragment
   */
  extractSearchableFragment(sentence) {
    const words = sentence.split(/\s+/);

    // If sentence is short enough, return as is
    if (words.length <= 12) {
      return sentence;
    }

    // Extract middle portion of longer sentences
    const start = Math.floor(words.length * 0.2);
    const end = Math.floor(words.length * 0.8);

    return words.slice(start, end).join(" ");
  }

  /**
   * Estimate syllable count in text (simplified)
   * @param {string} text - Input text
   * @returns {number} Estimated syllable count
   */
  estimateSyllables(text) {
    const words = text.toLowerCase().match(/\b[a-z]+\b/g) || [];
    let syllableCount = 0;

    words.forEach((word) => {
      // Simple syllable estimation
      let syllables = word.match(/[aeiouy]+/g) || [];
      syllables = syllables.length;

      // Adjust for silent e
      if (word.endsWith("e")) syllables--;

      // Minimum of 1 syllable per word
      syllables = Math.max(1, syllables);

      syllableCount += syllables;
    });

    return syllableCount;
  }

  /**
   * Health check for content analysis service
   * @returns {Object} Health status
   */
  healthCheck() {
    try {
      // Test basic functionality
      const testText = "This is a test sentence for analysis.";
      const analysis = this.calculateBasicStats(testText);

      return {
        healthy: analysis.wordCount === 8,
        features: [
          "Text statistics",
          "Key phrase extraction",
          "Important word identification",
          "Readability analysis",
          "Named entity extraction",
          "Search query generation",
        ],
        stopWordsCount: this.stopWords.size,
        searchableWordsCount: this.searchableWords.size,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
      };
    }
  }
}

module.exports = ContentAnalysisService;
