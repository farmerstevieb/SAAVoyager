# Voyager Miles Checkout Extension

This is a Shopify Checkout UI Extension that displays SAA Voyager loyalty points information during the checkout process.

## Features

- **Checkout Display**: Shows applied Voyager points discount information
- **Points Summary**: Displays points used, discount amount, and final total
- **Professional UI**: Clean, informative banner with airline branding

## Extension Points

- `purchase.checkout.block.render` - Displays on the checkout page

## Configuration

The extension can be configured through the `shopify.extension.toml` file:

```toml
[settings]
VOYAGER_API_URL = "http://localhost:3000/api/voyager"
POINTS_TO_ZAR_RATE = "0.01"
```

## Development

This extension is built with:
- TypeScript
- React
- Shopify UI Extensions React

## Usage

1. The extension automatically displays when Voyager points are applied to a cart
2. Shows points used, discount amount, and final order total
3. Provides clear information about the loyalty discount

## Integration

This extension works in conjunction with:
- `voyager-miles-cart` - Theme extension for cart page login
- `voyager-miles-discount` - Shopify Function for automatic discount application

## Building and Deploying

```bash
# Build the extension
shopify app build

# Deploy the extension
shopify app deploy
```
