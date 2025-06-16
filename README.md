# GrowLimitless Partner Backend

A comprehensive backend API for the GrowLimitless platform with payment processing capabilities.

## 🚀 Features

- **Payment Processing**: Complete payment API with custom gateway integration
- **Wallet Management**: Document-based wallet system with automatic updates
- **User Management**: Comprehensive user registration and management
- **PDF Chat**: AI-powered PDF document processing
- **Telegram Bot**: Automated bot for user interactions

## 📖 API Documentation

### 🎯 Interactive Swagger Documentation

**Access the complete API documentation at:** [`http://localhost:8000/api/docs`](http://localhost:8000/api/docs)

The unified Swagger documentation includes:

- ✅ **Payment Processing API** - Complete payment gateway integration
- ✅ **PDF Chat API** - Document upload and AI chat functionality
- ✅ **Wallet Management API** - Wallet document limits and information
- ✅ **Interactive Testing** - Test endpoints directly from the documentation
- ✅ **Request/Response Examples** - Complete examples for all endpoints
- ✅ **Schema Documentation** - Detailed data models and validation rules

### 📄 Additional Documentation

- [`docs/PAYMENT_API.md`](docs/PAYMENT_API.md) - Detailed payment API guide
- [`docs/SWAGGER_INTEGRATION.md`](docs/SWAGGER_INTEGRATION.md) - Swagger documentation guide
- [`examples/payment-integration-example.js`](examples/payment-integration-example.js) - Integration examples

## 📋 Payment API

The Payment API provides endpoints for handling plan purchases through a custom payment gateway integration.

### Key Features

- ✅ **TDD Implementation**: Built following Test-Driven Development principles
- ✅ **Comprehensive Validation**: Input validation for all endpoints
- ✅ **Error Handling**: Graceful error handling with detailed responses
- ✅ **Webhook Support**: Secure webhook processing for payment events
- ✅ **Database Integration**: Automatic wallet document management
- ✅ **Integration Tests**: Full test coverage with real API testing

### API Endpoints

#### 1. Create Payment Session

```http
POST /api/payments/purchase-plan
```

**Request Body:**

```json
{
  "walletId": "wallet-123",
  "mode": "payment",
  "line_items": [
    {
      "price_data": {
        "currency": "USD",
        "product_data": {
          "name": "Document Plan - Premium",
          "description": "Premium document processing plan"
        },
        "unit_amount": 5000
      },
      "quantity": 1
    }
  ],
  "metadata": {
    "invoice_id": "456",
    "user_id": "123"
  },
  "noOfDocs": 10
}
```

**Response:**

```json
{
  "success": true,
  "sessionId": "session_1234567890",
  "checkoutUrl": "https://checkout.example.com/session_1234567890",
  "message": "Payment session created successfully"
}
```

#### 2. Payment Success Callback

```http
GET /api/payments/success?session_id=xxx&walletId=xxx&noOfDocs=xxx
```

#### 3. Payment Cancel Callback

```http
GET /api/payments/cancel?session_id=xxx
```

#### 4. Webhook Handler

```http
POST /api/payments/webhook
```

#### 5. Get Wallet Information

```http
GET /api/payments/wallet/:walletId
```

## 🛠️ Installation

1. **Clone the repository**

```bash
git clone <repository-url>
cd partner-backend
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Generate Prisma client**

```bash
npm run generate
```

5. **Run database migrations**

```bash
npm run migrate
```

## 🚀 Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test src/routes/paymentRoutes.integration.test.js

# Watch mode
npm run test:watch
```

## 📁 Project Structure

```
├── src/
│   ├── routes/
│   │   ├── paymentRoutes.js              # Payment API implementation
│   │   ├── paymentRoutes.integration.test.js  # Integration tests
│   │   ├── userRoutes.js                 # User management
│   │   └── botRoutes.js                  # Telegram bot
│   ├── config/
│   │   ├── db.js                         # Database configuration
│   │   ├── blockchain.js                 # Blockchain utilities
│   │   └── encrypt.js                    # Encryption utilities
│   └── middleware/
│       └── errorHandler.js               # Global error handling
├── docs/
│   ├── PAYMENT_API.md                    # Detailed API documentation
│   └── SWAGGER_INTEGRATION.md            # Swagger documentation guide
├── examples/
│   └── payment-integration-example.js    # Usage examples
├── prisma/
│   └── schema.prisma                     # Database schema
├── jest.config.js                        # Jest configuration
└── growlimitless.js                      # Main application entry
```

## 🧪 Testing

The project follows Test-Driven Development (TDD) principles with comprehensive test coverage:

- **Unit Tests**: Individual function testing
- **Integration Tests**: Full API endpoint testing
- **Error Handling Tests**: Validation and error scenarios
- **Database Tests**: Wallet document management

### Running Tests

```bash
# All tests
npm test

# Integration tests only
npm test src/routes/paymentRoutes.integration.test.js

# With coverage report
npm run test:coverage
```

## 🔧 Configuration

### Environment Variables

```env
# Database
DATABASE_URL=mongodb://localhost:27017/growlimitless

# Server
PORT=8000
BASE_URL=http://localhost:8000

# Payment Gateway
PAYMENT_GATEWAY_API_KEY=your-growlimitless-api-key

# Other configurations...
```

### Database Schema

The payment system uses the `WalletDocuments` model:

```prisma
model WalletDocuments {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  walletId      String   @unique
  noOfDocuments Int      @default(3)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

## 🔒 Security

- **Input Validation**: All inputs are validated before processing
- **Error Handling**: Secure error messages without sensitive data exposure
- **Environment Variables**: Sensitive data stored in environment variables
- **HTTPS**: Production deployment uses HTTPS only
- **Webhook Security**: Webhook signature verification (recommended for production)

## 🚀 Deployment

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure proper `DATABASE_URL`
- [ ] Set secure `PAYMENT_GATEWAY_API_KEY`
- [ ] Enable HTTPS
- [ ] Configure webhook signature verification
- [ ] Set up monitoring and logging
- [ ] Configure CORS for production domains

## 📊 API Testing Examples

### Using Swagger UI (Recommended)

1. Navigate to [`http://localhost:8000/api/docs`](http://localhost:8000/api/docs)
2. Find the **Payment Processing** section
3. Click on any endpoint to see detailed documentation
4. Use **"Try it out"** to test endpoints interactively
5. View real request/response examples

### Manual Testing

```bash
# Test payment creation (will return 500 with real gateway)
curl -X POST http://localhost:8000/api/payments/purchase-plan \
  -H "Content-Type: application/json" \
  -d '{"walletId": "test-wallet", "mode": "payment", "line_items": [...], "metadata": {...}, "noOfDocs": 10}'

# Test validation
curl -X POST http://localhost:8000/api/payments/purchase-plan \
  -H "Content-Type: application/json" \
  -d '{"mode": "payment"}'

# Test success callback
curl "http://localhost:8000/api/payments/success?session_id=test&walletId=test-wallet&noOfDocs=5"

# Check wallet
curl http://localhost:8000/api/payments/wallet/test-wallet
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Implement the feature
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For technical support or integration assistance, please contact the GrowLimitless development team.

---

**Built with ❤️ by the GrowLimitless Team**
