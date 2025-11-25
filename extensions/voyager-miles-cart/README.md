# SAA Voyager Miles Cart Extension

This Shopify theme extension integrates SAA Voyager loyalty points into your cart page, allowing customers to log in with their Voyager credentials and apply points as discounts to their orders.

## 🚀 Features

- **Voyager Authentication**: Secure login with Voyager number and PIN
- **Points Display**: Real-time display of available points and ZAR value
- **Discount Application**: Apply points as discounts to cart
- **Session Management**: Persistent login across page refreshes
- **Responsive Design**: Mobile-friendly interface
- **Customizable Settings**: Configurable API endpoints and conversion rates

## 📁 File Structure

```
extensions/voyager-miles-cart/
├── shopify.extension.toml    # Extension configuration
├── blocks/
│   └── voyager-miles-cart.liquid  # Main block template
├── assets/
│   ├── voyager-miles-cart.css     # Styles
│   └── voyager-miles-cart.js      # JavaScript functionality
├── snippets/
│   └── voyager-miles-cart.liquid  # Reusable snippet
└── README.md                # This file
```

## 🛠️ Installation

### 1. Add to Your Theme

Include the extension in your cart template:

```liquid
{% comment %} In your cart.liquid template {% endcomment %}
{% render 'voyager-miles-cart' %}
```

### 2. Customize Settings (Optional)

```liquid
{% render 'voyager-miles-cart', 
   api_url: 'https://your-production-api.com',
   points_rate: 0.01,
   min_points: 1000,
   max_points: 50000 %}
```

### 3. Configure Backend

Ensure your backend API is running and accessible at the configured URL.

## ⚙️ Configuration

The extension supports the following settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `api_url` | string | `http://localhost:3000/api/voyager` | Backend API endpoint |
| `points_rate` | number | `0.01` | Points to ZAR conversion rate |
| `min_points` | number | `1000` | Minimum points that can be used |
| `max_points` | number | `50000` | Maximum points that can be used |

## 🔧 Customization

### Styling

Modify `assets/voyager-miles-cart.css` to match your theme's design:

```css
.voyager-miles-section {
  /* Custom background, borders, etc. */
}

.voyager-login-btn {
  /* Custom button styles */
}
```

### Functionality

Extend `assets/voyager-miles-cart.js` to add custom features:

```javascript
class VoyagerMilesCart {
  // Add custom methods
  customFeature() {
    // Your custom logic
  }
}
```

## 📱 Usage Flow

1. **Customer visits cart page**
2. **Sees Voyager login form**
3. **Enters Voyager number and PIN**
4. **Views available points and ZAR value**
5. **Specifies points to use**
6. **Applies points as discount**
7. **Proceeds to checkout with discount applied**

## 🔌 API Integration

The extension expects these backend endpoints:

- `POST /api/voyager/authenticate` - User authentication
- `GET /api/voyager/balance` - Get points balance
- `POST /api/voyager/apply-discount` - Apply points discount
- `GET /api/voyager/session-status` - Check session validity
- `POST /api/voyager/logout` - End session

## 🎨 Theme Integration

### Cart Attributes

The extension automatically updates cart attributes:

- `voyager_points` - Available points
- `voyager_zar_value` - Points value in ZAR
- `voyager_discount` - Applied discount amount

### Events

Listen for discount application events:

```javascript
document.addEventListener('voyager:discount-applied', (event) => {
  const { discountAmount } = event.detail;
  // Update cart display, etc.
});
```

## 🚨 Error Handling

The extension handles various error scenarios:

- **Network errors**: Displays user-friendly messages
- **Authentication failures**: Shows specific error details
- **Invalid input**: Validates user input before submission
- **Session timeouts**: Automatically clears expired sessions

## 📱 Responsive Design

The extension is fully responsive and works on:

- Desktop computers
- Tablets
- Mobile phones
- All screen sizes

## 🔒 Security Features

- **HTTPS only**: API calls require secure connections
- **Token-based auth**: Secure session management
- **Input validation**: Client-side and server-side validation
- **CSRF protection**: Built-in form protection

## 🧪 Testing

Test the extension with:

1. **Valid credentials**: Use real Voyager test accounts
2. **Invalid credentials**: Test error handling
3. **Network issues**: Test offline scenarios
4. **Different devices**: Test responsive design

## 🚀 Deployment

### Development

```bash
# Test locally
shopify app dev

# Build extension
shopify app build
```

### Production

```bash
# Deploy to Shopify
shopify app deploy
```

## 📞 Support

For issues or questions:

1. Check the backend API logs
2. Verify network connectivity
3. Test with mock mode enabled
4. Review browser console for errors

## 📝 License

This extension is part of the SAA Voyager Shopify integration project.

## 🔄 Updates

Keep the extension updated by:

1. Pulling latest changes from the repository
2. Testing in development environment
3. Deploying to staging for validation
4. Rolling out to production

---

**Note**: This extension requires a running backend API that implements the SAA Voyager SOAP services. Ensure your backend is properly configured and accessible before deploying the extension.
