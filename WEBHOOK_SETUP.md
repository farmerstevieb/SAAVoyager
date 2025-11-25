# 🎯 SAA Voyager App - Webhook Setup Guide

## 📋 **Required Webhooks for Thank You Page Integration**

To enable automatic points finalization and recrediting, you need to configure these Shopify webhooks:

### **1. Orders Create Webhook**
**Purpose**: Finalize points deduction after successful order completion
**URL**: `https://saa-voyager-app-prod.tofmail2022.workers.dev/api/webhooks/orders-create`
**Event**: `orders/create`
**Format**: JSON

**What it does**:
- Triggers when an order is successfully created
- Reads Voyager points data from order attributes
- Calls SAA Voyager service to finalize points deduction
- Issues certificate and marks it as used

### **2. Orders Cancelled Webhook**
**Purpose**: Recredit points when orders are cancelled
**URL**: `https://saa-voyager-app-prod.tofmail2022.workers.dev/api/webhooks/orders-cancelled`
**Event**: `orders/cancelled`
**Format**: JSON

**What it does**:
- Triggers when an order is cancelled
- Reads Voyager points data from order attributes
- Calls SAA Voyager service to recredit points
- Restores points to customer's account

### **3. Orders Refunds Webhook**
**Purpose**: Recredit points when orders are refunded
**URL**: `https://saa-voyager-app-prod.tofmail2022.workers.dev/api/webhooks/orders-refunds`
**Event**: `orders/refunds`
**Format**: JSON

**What it does**:
- Triggers when an order is refunded
- Reads Voyager points data from order attributes
- Calls SAA Voyager service to recredit points
- Restores points to customer's account

## 🔧 **How to Set Up Webhooks**

### **Option 1: Shopify Admin (Recommended for Testing)**
1. Go to **Settings** → **Notifications** → **Webhooks**
2. Click **Create webhook**
3. Select the event type (e.g., `orders/create`)
4. Enter the webhook URL
5. Choose **JSON** format
6. Click **Save webhook**
7. Repeat for all three webhooks

### **Option 2: Shopify CLI (Recommended for Production)**
```bash
# Create orders/create webhook
shopify webhook create --event orders/create --address https://saa-voyager-app-prod.tofmail2022.workers.dev/api/webhooks/orders-create --format json

# Create orders/cancelled webhook
shopify webhook create --event orders/cancelled --address https://saa-voyager-app-prod.tofmail2022.workers.dev/api/webhooks/orders-cancelled --format json

# Create orders/refunds webhook
shopify webhook create --event orders/refunds --address https://saa-voyager-app-prod.tofmail2022.workers.dev/api/webhooks/orders-refunds --format json
```

### **Option 3: API (Programmatic Setup)**
```bash
# Get your access token first
curl -X POST "https://your-shop.myshopify.com/admin/oauth/access_token" \
  -H "Content-Type: application/json" \
  -d '{"client_id":"YOUR_CLIENT_ID","client_secret":"YOUR_CLIENT_SECRET","code":"AUTHORIZATION_CODE"}'

# Create webhook
curl -X POST "https://your-shop.myshopify.com/admin/api/2023-10/webhooks.json" \
  -H "X-Shopify-Access-Token: YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "topic": "orders/create",
      "address": "https://saa-voyager-app-prod.tofmail2022.workers.dev/api/webhooks/orders-create",
      "format": "json"
    }
  }'
```

## 📊 **Webhook Data Flow**

### **Order Creation Flow**:
1. Customer completes checkout with Voyager points
2. Shopify creates order with Voyager attributes
3. `orders/create` webhook triggers
4. Backend reads Voyager data from order
5. Calls SAA Voyager service to finalize points
6. Points are deducted from customer's account
7. Order is marked as completed

### **Order Cancellation Flow**:
1. Merchant cancels order
2. `orders/cancelled` webhook triggers
3. Backend reads Voyager data from order
4. Calls SAA Voyager service to recredit points
5. Points are restored to customer's account
6. Cancellation is processed

## 🧪 **Testing Webhooks**

### **Test Order Creation**:
1. Complete a test order with Voyager points
2. Check Cloudflare Worker logs for webhook receipt
3. Verify points finalization in SAA Voyager system
4. Check order attributes contain Voyager data

### **Test Order Cancellation**:
1. Cancel a test order with Voyager points
2. Check Cloudflare Worker logs for webhook receipt
3. Verify points recredit in SAA Voyager system
4. Confirm points are restored to customer account

## 🚨 **Important Notes**

- **Webhook URLs must be publicly accessible** (HTTPS required)
- **Webhook failures are retried automatically** by Shopify
- **Test webhooks in development mode first**
- **Monitor webhook delivery in Shopify admin**
- **Implement proper error handling and logging**

## 🔍 **Troubleshooting**

### **Webhook Not Delivering**:
- Check URL accessibility
- Verify HTTPS requirement
- Check Shopify webhook logs
- Verify webhook is active

### **Webhook Processing Errors**:
- Check Cloudflare Worker logs
- Verify SAA Voyager service connectivity
- Check order attribute format
- Verify authentication tokens

## 📈 **Next Steps**

1. **Deploy the updated Cloudflare Worker** with webhook endpoints
2. **Set up the three required webhooks** in your Shopify store
3. **Test the complete flow** from cart → checkout → order completion
4. **Monitor webhook delivery** and processing
5. **Verify points finalization** in SAA Voyager system

This webhook-based approach provides a robust, reliable way to handle order completion and points finalization without relying on Checkout UI Extensions for the thank you page.
