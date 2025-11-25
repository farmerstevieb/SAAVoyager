# SAA Voyager Points - Shopify Integration

A comprehensive Shopify app that integrates SAA Voyager loyalty points with your online store, allowing customers to use their miles as discounts during checkout.

## 🚀 Features

- **Customer Authentication**: Secure login with SAA Voyager credentials
- **Points Balance Display**: Real-time points balance and ZAR conversion
- **Automatic Discount Application**: Points automatically convert to cart discounts
- **Smart Points Calculation**: Optimizes points usage based on cart value
- **Order Finalization**: Points deducted after successful payment
- **Automatic Refunds**: Points recredited on order cancellation/failure
- **Shopify Plus Ready**: Checkout UI Extensions and Functions support
- **Responsive Design**: Works on all devices with modern UI

## 🏗️ Architecture

### Backend Components
- **Express.js Server**: RESTful API endpoints
- **SOAP Integration**: Secure communication with SAA Voyager services
- **Session Management**: Secure customer session handling
- **Webhook Handlers**: Shopify order lifecycle management

### Frontend Components
- **Theme App Extension**: Cart page integration (Shopify Basic/Advanced)
- **Checkout UI Extension**: Checkout display (Shopify Plus)
- **Shopify Function**: Automatic discount application

### SAA Voyager Services
- `AuthenticateMemberServiceV2.7`: Customer authentication
- `AccountSummaryServiceV2.7`: Points balance retrieval
- `MemberProfileDetailsServiceV2.7`: Member profile information
- `IssueCertificateServiceV2.7`: Points deduction
- `MarkCertificateAsUsedService`: Certificate finalization
- `RecreditPointsServiceV2.7`: Points refund
- `LogoutMemberServiceV2.7`: Session cleanup

## 📋 Prerequisites

- Node.js 16+ and npm
- Shopify Partner account
- SAA Voyager UAT/Production credentials
- Shopify store (Basic, Advanced, or Plus)

## 🛠️ Installation

### 1. Clone the Repository
```bash
git clone <repository-url>
cd saa-voyager-2
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Copy `env.example` to `.env` and configure:

```bash
# Shopify App Configuration
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret
SHOPIFY_SCOPES=write_products,write_orders,write_discounts,write_customers
SHOPIFY_APP_URL=https://your-app-domain.com

# SAA Voyager SOAP Services (UAT)
VOYAGER_AUTH_URL=http://ilstage.flysaa.com/saa_upg_uat-ws/services/AuthenticateMemberServiceV2.7
VOYAGER_ACCOUNT_URL=http://ilstage.flysaa.com/saa_upg_uat-ws/services/AccountSummaryServiceV2.7
VOYAGER_MEMBER_PROFILE_URL=http://ilstage.flysaa.com/saa_upg_uat-ws/services/MemberProfileDetailsServiceV2.7
VOYAGER_ISSUE_URL=http://ilstage.flysaa.com/saa_upg_uat-ws/services/IssueCertificateServiceV2.7
VOYAGER_MARK_URL=http://ilstage.flysaa.com/saa_upg_uat-ws/services/MarkCertificateAsUsedService
VOYAGER_RECREDIT_URL=http://ilstage.flysaa.com/saa_upg_uat-ws/services/RecreditPointsServiceV2.7
VOYAGER_LOGOUT_URL=http://ilstage.flysaa.com/saa_upg_uat-ws/services/LogoutMemberServiceV2.7

# SAA Voyager Credentials (UAT)
# Username: Voyager Number (500365586)
# Password: PIN (2222)
VOYAGER_USERNAME=500365586
VOYAGER_PASSWORD=2222

# Points to ZAR Conversion
POINTS_TO_ZAR_RATE=0.01
MIN_POINTS_USAGE=100
MAX_POINTS_USAGE=10000
```

### 4. Shopify App Setup
```bash
# Install Shopify CLI
npm install -g @shopify/cli

# Login to Shopify
shopify auth login

# Configure app
shopify app config link

# Deploy app
shopify app deploy
```

## 🚀 Usage

### Customer Journey

1. **Cart Page**: Customer enters Voyager credentials
2. **Points Display**: Shows available points and ZAR value
3. **Discount Application**: Customer selects points to use
4. **Checkout**: Points discount automatically applied
5. **Order Completion**: Points deducted after payment success
6. **Refund Handling**: Points automatically recredited if needed

### API Endpoints

#### Authentication
```http
POST /api/voyager/auth
{
  "voyagerUsername": "customer_username",
  "voyagerPassword": "customer_password"
}
```

#### Get Balance
```http
GET /api/voyager/balance
Headers: x-correlation-id: {session_id}
```

#### Get Member Profile
```http
GET /api/voyager/profile
Headers: x-correlation-id: {session_id}
```

#### Apply Discount
```http
POST /api/voyager/apply-discount
{
  "cartSubtotal": 4000.00,
  "requestedPoints": 2500
}
```

#### Finalize Points
```http
POST /api/voyager/finalize
{
  "orderId": "12345",
  "orderTotal": 1500.00
}
```

#### Recredit Points
```http
POST /api/voyager/recredit
{
  "orderId": "12345",
  "reason": "Order cancelled"
}
```

## 🔧 Configuration

### Points Conversion
- **Rate**: Configurable points-to-ZAR conversion rate
- **Minimum**: Minimum points required for usage
- **Maximum**: Maximum points that can be used per order

### Session Management
- **Timeout**: 24-hour session timeout
- **Security**: Correlation ID tracking for all requests
- **Storage**: In-memory storage (production: use Redis/database)

### Error Handling
- **Retry Logic**: Automatic retry for failed SOAP calls
- **Fallback**: Graceful degradation on service failures
- **Logging**: Comprehensive logging with correlation IDs

## 🧪 Testing

### Development Mode
```bash
# Start backend server
npm run dev:server

# Start Shopify app
npm run dev:shopify

# Or run both concurrently
npm run dev
```

### Testing Endpoints
```bash
# Health check
curl http://localhost:3000/health

# Test authentication (replace with real credentials)
curl -X POST http://localhost:3000/api/voyager/auth \
  -H "Content-Type: application/json" \
  -d '{"voyagerUsername":"test","voyagerPassword":"test"}'
```

## 📱 Shopify Integration

### Theme App Extension
Add to your cart template:
```liquid
{% section 'voyager-miles-cart' %}
```

### Checkout UI Extension (Plus Only)
Automatically displays Voyager discount information during checkout.

### Shopify Function
Automatically applies points discount based on cart attributes.

## 🔒 Security Features

- **HTTPS Only**: All communications encrypted
- **Session Validation**: Secure session management
- **Input Validation**: Comprehensive input sanitization
- **CORS Protection**: Controlled cross-origin access
- **Rate Limiting**: Protection against abuse
- **Correlation Tracking**: Full request traceability

## 📊 Monitoring & Logging

### Log Levels
- **Info**: Normal operations
- **Warn**: Authentication failures, validation issues
- **Error**: SOAP failures, system errors

### Metrics
- Authentication success/failure rates
- Points usage patterns
- API response times
- Error rates by endpoint

## 🚨 Troubleshooting

### Common Issues

1. **SOAP Connection Failed**
   - Check network connectivity
   - Verify service URLs
   - Check credentials

2. **Points Not Applied**
   - Verify session is active
   - Check cart attributes
   - Review discount function logs

3. **Webhook Failures**
   - Verify webhook endpoints
   - Check Shopify app permissions
   - Review webhook logs

### Debug Mode
Enable detailed logging:
```bash
LOG_LEVEL=debug npm run dev:server
```

## 🔄 Deployment

### Production Checklist
- [ ] Environment variables configured
- [ ] SSL certificates installed
- [ ] Database/Redis configured
- [ ] Monitoring setup
- [ ] Backup procedures
- [ ] Error alerting

### Scaling Considerations
- **Load Balancing**: Multiple server instances
- **Database**: Persistent session storage
- **Caching**: Redis for session management
- **CDN**: Static asset delivery

## 📈 Business Rules

### Points Usage
- Minimum points: 100
- Maximum points: 10,000 per order
- Conversion rate: 1 point = R0.01
- Points cannot exceed cart subtotal

### Order Processing
- Points deducted after payment success
- Automatic refund on cancellation
- Manual refund handling for returns
- Idempotent operations for safety

## 🤝 Support

### Documentation
- [Shopify App Development](https://shopify.dev/docs/apps)
- [Checkout UI Extensions](https://shopify.dev/docs/apps/checkout/ui-extensions)
- [Shopify Functions](https://shopify.dev/docs/apps/functions)

### Issues
- Check logs for error details
- Verify configuration settings
- Test with UAT environment first
- Contact development team

## 📄 License

MIT License - see LICENSE file for details.

## 🏢 Company

Developed for SAA Voyager integration with Shopify stores.

---

**Note**: This app requires proper SAA Voyager credentials and should be tested thoroughly in UAT environment before production deployment.
