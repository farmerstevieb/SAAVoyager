# Voyager Miles Discount Function

This is a Shopify Function that automatically applies SAA Voyager loyalty points as a discount during checkout.

## Features

- **Automatic Discount Application**: Reads cart attributes to apply points-based discounts
- **Points-to-ZAR Conversion**: Converts Voyager points to ZAR using configurable rate
- **Subtotal Capping**: Ensures discount never exceeds cart subtotal
- **Error Handling**: Graceful fallback when points data is invalid

## How It Works

1. **Cart Attributes**: Reads `voyager_points_used` and `voyager_points_rate` from cart
2. **Discount Calculation**: Multiplies points by rate to get discount amount
3. **Subtotal Capping**: Caps discount at cart subtotal to prevent negative totals
4. **Discount Application**: Applies fixed-amount discount to order total

## Cart Attributes Required

The function expects these cart attributes to be set:

- `voyager_points_used`: Number of points to use (e.g., "5000")
- `voyager_points_rate`: Points to ZAR conversion rate (e.g., "0.01")

## Example

If a customer has:
- 5000 Voyager points
- Points rate: 0.01 (1 point = R0.01)
- Cart subtotal: R100.00

The function will:
- Calculate discount: 5000 × 0.01 = R50.00
- Apply R50.00 discount to the order
- Final total: R50.00

## Integration

This function works in conjunction with:
- `voyager-miles-cart` - Theme extension for cart page login
- `voyager-miles` - Checkout UI extension for discount display

## Building and Testing

```bash
# Generate types
npm run typegen

# Build the function
npm run build

# Test the function
npm run test

# Preview the function
npm run preview
```

## Targets

- `cart.lines.discounts.generate.run` - Main discount generation
- `cart.delivery-options.discounts.generate.run` - Delivery options (no-op for Voyager)

## Error Handling

- Returns no operations if cart attributes are missing
- Returns no operations if points/rate values are invalid
- Logs errors for debugging purposes
- Gracefully handles parsing errors
