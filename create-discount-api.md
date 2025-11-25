# Create Voyager Miles Discount via GraphQL API

## Step 1: Get Your Function ID

Run this query in Shopify Admin GraphiQL (or Postman/Altair):

```graphql
query GetAppFunctions {
  app {
    id
    functions(first: 10) {
      edges {
        node {
          id
          apiType
          title
        }
      }
    }
  }
}
```

Look for the function with `apiType: "DISCOUNT"` and note the `id`.

## Step 2: Create the Discount

Run this mutation:

```graphql
mutation CreateVoyagerDiscount($functionId: ID!) {
  discountAutomaticAppCreate(
    automaticAppDiscount: {
      title: "Voyager Miles Discount"
      functionId: $functionId
      startsAt: "2025-01-01T00:00:00Z"
      status: ACTIVE
      combinesWith: {
        orderDiscounts: true
        productDiscounts: true
        shippingDiscounts: true
      }
    }
  ) {
    userErrors {
      field
      message
    }
    automaticAppDiscount {
      id
      title
      status
      appDiscountType {
        app {
          id
        }
        functionId
      }
    }
  }
}
```

**Variables:**

```json
{
  "functionId": "gid://shopify/AppFunction/YOUR_FUNCTION_ID_HERE"
}
```

## Step 3: Verify Discount is Active

After creating, check:

1. Go to: `https://nian-store-111.myshopify.com/admin/discounts`
2. Look for "Voyager Miles Discount"
3. Verify it shows as "Active"

## Step 4: Test Discount

1. Add product to cart
2. Apply Voyager points (via cart extension)
3. Go to checkout
4. Discount should now apply automatically

## Expected Result

With your current cart:

- Points: 500
- Rate: 0.1
- Expected discount: 500 × 0.1 = **50 ZAR**
- Subtotal: 12892 ZAR
- Final total: 12892 - 50 = **12842 ZAR**
