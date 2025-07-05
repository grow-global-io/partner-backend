# Storefront API

This module provides a complete set of backend APIs required to support the Storefront feature, enabling users to create and manage their own online stores linked by their walletId.

## Features

1. **Store Management**

   - Create a new store associated with a user's walletId
   - Retrieve a store (or multiple stores) by walletId
   - Update and delete a store (authorization ensures only the store owner can perform these actions)

2. **Product Management**

   - Add, update, and delete products within a store
   - Each product supports fields such as: name, description, price, category, and multiple image URLs

3. **Catalogue Display**

   - Public API endpoint to fetch a store's product catalogue by store ID or slug
   - Optional filters (e.g., category)

4. **Image Handling**
   - AWS S3 integration for image uploads
   - Store references to image URLs in the product schema

## API Documentation

API documentation is available at `/api/storefront/docs` when the server is running.

## Authentication

Authentication is handled by validating the `walletId` in the request body for all protected endpoints. The walletId is used to verify store ownership for operations like updating or deleting stores and products.

## Technical Implementation

- **Models**: Uses Prisma ORM with MongoDB
- **Controllers**: Follows controller-service pattern
- **Image Uploads**: Uses AWS S3 for image storage
- **Documentation**: Swagger/OpenAPI specification

## Environment Variables Required

```
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=your_aws_region
AWS_BUCKET_NAME=your_s3_bucket_name
```

## Testing

You can use the provided `test-endpoints.http` file to test the API endpoints. This file is compatible with REST client extensions in various IDEs.

## Example Usage

```javascript
// Create a store
const response = await fetch("/api/storefront/stores", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "My Store",
    description: "My online store",
    walletId: "0x1234567890abcdef1234567890abcdef12345678",
  }),
});

// Get stores by wallet ID
const stores = await fetch(
  "/api/storefront/stores?walletId=0x1234567890abcdef1234567890abcdef12345678"
);

// Get products from a store
const products = await fetch("/api/storefront/stores/store_id_here/products");
```
