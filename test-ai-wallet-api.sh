#!/bin/bash

# AI Text Wallet API Test Commands
# Make sure your server is running on localhost:8000

BASE_URL="http://localhost:8000/api/leadgen/ai-text"

echo "🚀 Testing AI Text Wallet API..."
echo ""

# 1. Health Check
echo "1. Health Check:"
curl -X GET "${BASE_URL}/health" \
  -H "Content-Type: application/json" | jq '.'
echo ""
echo "---"

# 2. Create a test wallet using GET endpoint
echo "2. Create Test Wallet (GET):"
curl -X GET "${BASE_URL}/test" \
  -H "Content-Type: application/json" | jq '.'
echo ""
echo "---"

# 3. Create wallet using POST
echo "3. Create Wallet (POST):"
curl -X POST "${BASE_URL}/wallet" \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "user123@example.com",
    "generationsCount": 0
  }' | jq '.'
echo ""
echo "---"

# 4. Get wallet information
echo "4. Get Wallet Info:"
curl -X GET "${BASE_URL}/wallet/user123@example.com" \
  -H "Content-Type: application/json" | jq '.'
echo ""
echo "---"

# 5. Increment generations
echo "5. Increment Generations:"
curl -X PUT "${BASE_URL}/wallet/user123@example.com" \
  -H "Content-Type: application/json" \
  -d '{
    "generationsCount": 1,
    "operation": "increment"
  }' | jq '.'
echo ""
echo "---"

# 6. Set generations count
echo "6. Set Generations Count:"
curl -X PUT "${BASE_URL}/wallet/user123@example.com" \
  -H "Content-Type: application/json" \
  -d '{
    "generationsCount": 10,
    "operation": "set"
  }' | jq '.'
echo ""
echo "---"

# 7. Get all wallets
echo "7. Get All Wallets:"
curl -X GET "${BASE_URL}/wallets?page=1&limit=5" \
  -H "Content-Type: application/json" | jq '.'
echo ""
echo "---"

# 8. Get statistics
echo "8. Get Statistics:"
curl -X GET "${BASE_URL}/statistics" \
  -H "Content-Type: application/json" | jq '.'
echo ""
echo "---"

echo "✅ Test completed!"
