#!/usr/bin/env node

/**
 * Script to create Voyager Miles Discount via Shopify Admin GraphQL API
 * 
 * Usage:
 *   node create-voyager-discount.js
 * 
 * Environment variables:
 *   SHOPIFY_STORE_URL - Store URL (e.g., nian-store-111.myshopify.com)
 *   SHOPIFY_ACCESS_TOKEN - Admin API access token
 */

const https = require('https');
const http = require('http');

// Hardcoded configuration for quick testing
const SHOPIFY_STORE_URL = 'nian-store-111.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = '';
let ADMIN_TOKEN = SHOPIFY_ACCESS_TOKEN; // mutable token used for requests

// Public/CLI app OAuth details (replace SECRET before exchanging code)
const SHOPIFY_API_KEY = '5dd47accf1ac433ca66a52699fa9a4b0';
const SHOPIFY_API_SECRET = '680a897460c7c9f3cafaf3533265d173';
const SHOPIFY_REDIRECT_URI = 'https://shopify.dev/apps/default-app-home/api/auth';
const SHOPIFY_OAUTH_CODE = 'a0969e09a07f8292aff813fce9f4106e';

const GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE_URL}/admin/api/2025-04/graphql.json`;

// GraphQL query to get app functions
const GET_FUNCTIONS_QUERY = `
  query GetAppFunctions {
    shopifyFunctions(first: 25) {
      nodes {
        id
        title
        apiType
      }
    }
  }
`;

// GraphQL mutation to create automatic app discount
const CREATE_DISCOUNT_MUTATION = `
  mutation CreateVoyagerDiscount($functionId: String!) {
    discountAutomaticAppCreate(
      automaticAppDiscount: {
        title: "Voyager Miles Discount"
        functionId: $functionId
        startsAt: "2025-01-01T00:00:00Z"
        discountClasses: [ORDER]
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
        discountId
      }
    }
  }
`;

/**
 * Make GraphQL request to Shopify Admin API
 */
function makeGraphQLRequest(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(GRAPHQL_ENDPOINT);
    
    const postData = JSON.stringify({
      query,
      variables
    });

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-Shopify-Access-Token': ADMIN_TOKEN || ''
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
            return;
          }

          if (parsed.errors) {
            reject(new Error(`GraphQL errors: ${JSON.stringify(parsed.errors)}`));
            return;
          }

          resolve(parsed.data);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}\nResponse: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Request error: ${e.message}`));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Make simple HTTPS POST (form-encoded or JSON)
 */
function httpsPost({ hostname, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const options = {
      hostname,
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Content-Type': headers && headers['Content-Type'] ? headers['Content-Type'] : 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(headers || {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

/**
 * If no Admin token is provided, help user perform OAuth or exchange a code.
 */
async function ensureAdminToken() {
  if (ADMIN_TOKEN) {
    return ADMIN_TOKEN;
  }

  if (!SHOPIFY_API_KEY) {
    throw new Error('Missing SHOPIFY_ACCESS_TOKEN and SHOPIFY_API_KEY (hardcoded) is empty.');
  }

  // If a one-time code is provided, exchange it for a token
  if (SHOPIFY_OAUTH_CODE) {
    if (!SHOPIFY_API_SECRET || SHOPIFY_API_SECRET === 'REPLACE_WITH_APP_SECRET') {
      throw new Error('SHOPIFY_OAUTH_CODE set, but SHOPIFY_API_SECRET is missing. Replace the placeholder with your app secret.');
    }

    const res = await httpsPost({
      hostname: SHOPIFY_STORE_URL,
      path: '/admin/oauth/access_token',
      headers: { 'Content-Type': 'application/json' },
      body: {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code: SHOPIFY_OAUTH_CODE
      }
    });

    if (res.statusCode !== 200) {
      throw new Error(`Token exchange failed: HTTP ${res.statusCode} ${res.body}`);
    }

    const parsed = JSON.parse(res.body || '{}');
    if (!parsed.access_token) {
      throw new Error(`Token exchange response missing access_token: ${res.body}`);
    }

    return parsed.access_token;
  }

  // Otherwise print an authorize URL and exit with instructions
  const scope = encodeURIComponent('write_discounts');
  const redirectParam = SHOPIFY_REDIRECT_URI ? `&redirect_uri=${encodeURIComponent(SHOPIFY_REDIRECT_URI)}` : '';
  const authorizeUrl = `https://${SHOPIFY_STORE_URL}/admin/oauth/authorize?client_id=${encodeURIComponent(
    SHOPIFY_API_KEY
  )}&scope=${scope}${redirectParam}&state=nonce`;

  console.log('\n⚠️  No SHOPIFY_ACCESS_TOKEN provided.');
  console.log('Open this URL in a browser, approve, then paste the code into SHOPIFY_OAUTH_CODE in this file and rerun:\n');
  console.log(authorizeUrl + '\n');
  process.exit(1);
}

/**
 * Get app functions and find the Voyager discount function
 */
async function getVoyagerFunctionId() {
  console.log('🔍 Fetching app functions...');

  const data = await makeGraphQLRequest(GET_FUNCTIONS_QUERY);

  if (!data.shopifyFunctions || !data.shopifyFunctions.nodes || data.shopifyFunctions.nodes.length === 0) {
    throw new Error('No app functions found. Make sure the function is deployed to this app.');
  }

  console.log('\n📋 Available functions:');
  data.shopifyFunctions.nodes.forEach((node) => {
    console.log(`  - ${node.title || 'Untitled'} (${node.apiType}) - ID: ${node.id}`);
  });

  // Prefer a function whose title matches our discount function name
  const voyagerFunction = data.shopifyFunctions.nodes.find((node) =>
    (node.title || '').toLowerCase().includes('voyager') || (node.title || '').toLowerCase().includes('miles')
  );

  if (voyagerFunction) {
    console.log(`\n✅ Found Voyager discount function by title: ${voyagerFunction.id}`);
    return voyagerFunction.id;
  }

  // Fallback: pick any discount-related function
  const discountFunction = data.shopifyFunctions.nodes.find((node) =>
    (node.apiType || '').toLowerCase().includes('discount')
  );

  if (!discountFunction) {
    throw new Error('No discount function found. Make sure voyager-miles-discount is deployed.');
  }

  console.log(`\n✅ Found discount function: ${discountFunction.id}`);
  return discountFunction.id;
}


/**
 * Create the Voyager Miles discount
 */
async function createDiscount(functionId) {
  console.log(`\n🎫 Creating Voyager Miles Discount...`);
  // Use the raw UUID function ID (the API expects String, not GID)
  const uuid = functionId.replace('gid://shopify/AppFunction/', '');
  console.log(`   Function ID: ${uuid}`);
  
  const data = await makeGraphQLRequest(CREATE_DISCOUNT_MUTATION, {
    functionId: uuid
  });

  if (data.discountAutomaticAppCreate.userErrors && data.discountAutomaticAppCreate.userErrors.length > 0) {
    const errors = data.discountAutomaticAppCreate.userErrors;
    throw new Error(`Discount creation errors: ${JSON.stringify(errors)}`);
  }

  const discount = data.discountAutomaticAppCreate.automaticAppDiscount;
  
  if (!discount) {
    throw new Error('Discount creation failed - no discount returned');
  }

  console.log('\n✅ Discount created successfully!');
  console.log(`   Discount ID: ${discount.discountId}`);
  
  return discount;
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('🚀 Creating Voyager Miles Discount');
    console.log(`   Store: ${SHOPIFY_STORE_URL}`);
    console.log(`   Endpoint: ${GRAPHQL_ENDPOINT}\n`);

    const adminToken = await ensureAdminToken();

    // Inject token for this run
    ADMIN_TOKEN = adminToken;

    const functionId = await getVoyagerFunctionId();
    const discount = await createDiscount(functionId);

    console.log('\n✨ Success!');
    console.log('\n📝 Next steps:');
    console.log('   1. Verify the discount is active in Admin:');
    console.log(`      https://${SHOPIFY_STORE_URL}/admin/discounts`);
    console.log('   2. Test the discount:');
    console.log('      - Add product to cart');
    console.log('      - Apply Voyager points in cart extension');
    console.log('      - Go to checkout');
    console.log('      - Verify discount is applied\n');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { getVoyagerFunctionId, createDiscount, makeGraphQLRequest };

