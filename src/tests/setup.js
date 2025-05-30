/**
 * @fileoverview Jest Test Setup Configuration
 * @description Global test setup for Jest testing environment
 * @author AI Assistant
 */

// Set test timeout to 30 seconds for database operations
jest.setTimeout(30000);

// Mock console.log in tests to reduce noise
if (process.env.NODE_ENV === "test") {
  global.console = {
    ...console,
    log: jest.fn(),
    error: console.error,
    warn: console.warn,
    info: jest.fn(),
    debug: jest.fn(),
  };
}

// Global test environment variables
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
