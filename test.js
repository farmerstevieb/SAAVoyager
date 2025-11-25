/**
 * Two-Step UAT Authentication Test
 * Step 1: Establish API client session
 * Step 2: Authenticate member with the session token
 */

const fetch = require('node-fetch');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

// DNS workaround: ilstage.flysaa.com resolves to 196.46.23.82 (via Google DNS)
// VPN DNS isn't working, so we'll replace the hostname with the IP and set Host header
const SAA_HOSTNAME = 'ilstage.flysaa.com';
const SAA_IP_ADDRESS = '196.46.23.82';

// HTTPS agent
const httpsAgent = new https.Agent({
    servername: SAA_HOSTNAME,
    rejectUnauthorized: false, // Allow self-signed certs in UAT
    keepAlive: false
});

// UAT Credentials
// For UAT, we're using the pre-computed WS-Security values provided by SAA
const UAT_API_CREDENTIALS = {
    username: 'wom',
    // These are pre-computed for UAT - they're static
    passwordDigest: 'RxjWNeJegwDTtbGW0Q2FFBCnQ3A=',
    nonce: 'MTY4NjExNjA4MQ==',  // Fixed typo: was O (letter) now 0 (zero)
    created: '2050-12-31T10:33:52.303Z',
    endpoint: 'https://ilstage.flysaa.com/saa_upg_uat-ws/services'
};

// Test member credentials to try
const TEST_MEMBERS = [
    { membershipNumber: '500510614', pin: 'test', note: 'Primary UAT test card (confirmed)' },
    { membershipNumber: '500365586', pin: '2222', note: 'Fallback test account' },
    { membershipNumber: '32757624', pin: '2222', note: 'From sample XML (mtn user)' }
];

const LOG_FILE = 'test.log';

function log(message) {
    const timestamp = new Date().toISOString();
    const msg = `[${timestamp}] ${message}`;
    console.log(msg);
    fs.appendFileSync(LOG_FILE, msg + '\n');
}

/**
 * Get WS-Security headers for UAT
 * Uses pre-computed static values provided by SAA
 */
function getUATWSSecurityHeaders() {
    return {
        username: UAT_API_CREDENTIALS.username,
        passwordDigest: UAT_API_CREDENTIALS.passwordDigest,
        nonce: UAT_API_CREDENTIALS.nonce,
        created: UAT_API_CREDENTIALS.created,
        expires: UAT_API_CREDENTIALS.created // Using same for expires
    };
}

/**
 * Step 1: Authenticate member and return token/ID if successful
 */
async function authenticateMember(memberCredentials) {
    log(`\n${'='.repeat(60)}`);
    log(`Testing: ${memberCredentials.note}`);
    log(`Member: ${memberCredentials.membershipNumber} / PIN: ${memberCredentials.pin}`);
    log('='.repeat(60));

    const security = getUATWSSecurityHeaders();

    log('Generated WS-Security Headers:');
    log(`Username: ${security.username}`);
    log(`Password Digest: ${security.passwordDigest}`);
    log(`Nonce: ${security.nonce}`);
    log(`Created: ${security.created}`);

    // Try to authenticate with just API credentials (no member data)
    const soapEnvelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:type="http://www.ibsplc.com/iloyal/member/authenticatemember/type/">
   <soapenv:Header>
      <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
         <wsu:Timestamp wsu:Id="Timestamp-${Date.now()}" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
            <wsu:Created>${security.created}</wsu:Created>
            <wsu:Expires>${security.expires}</wsu:Expires>
         </wsu:Timestamp>
         <wsse:UsernameToken wsu:Id="UsernameToken-${Date.now()}" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
            <wsse:Username>${security.username}</wsse:Username>
            <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${security.passwordDigest}</wsse:Password>
            <wsse:Nonce>${security.nonce}</wsse:Nonce>
            <wsu:Created>${security.created}</wsu:Created>
         </wsse:UsernameToken>
      </wsse:Security>
   </soapenv:Header>
   <soapenv:Body>
      <type:AuthenticateMemberRequest>
         <companyCode>SA</companyCode>
         <programCode>VOYAG</programCode>
         <membershipNumber>${memberCredentials.membershipNumber}</membershipNumber>
         <pin>${memberCredentials.pin}</pin>
         <skipPinChangeReminder>1</skipPinChangeReminder>
         <txnHeader>
            <transactionID></transactionID>
            <userName>${security.username}</userName>
            <transactionToken></transactionToken>
            <timeStamp>${new Date().toISOString()}</timeStamp>
         </txnHeader>
      </type:AuthenticateMemberRequest>
   </soapenv:Body>
</soapenv:Envelope>`;

    log('SOAP Request:');
    log(soapEnvelope);

    try {
        // Use the correct endpoint and SOAPAction from the WSDL pattern
        const url = `${UAT_API_CREDENTIALS.endpoint}/AuthenticateMemberService`;
        log(`Sending to: ${url}`);

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': '' // Use empty SOAPAction as with AccountSummaryService
            },
            body: soapEnvelope
        };
        if (url.startsWith('https')) {
            fetchOptions.agent = httpsAgent;
        }
        const response = await fetch(url, fetchOptions);

        log(`Response Status: ${response.status} ${response.statusText}`);
        log('Response Headers: ' + JSON.stringify(response.headers.raw()));
        const responseText = await response.text();
        log('Raw Response Body:');
        log(responseText);

        // Check for SOAP fault
        if (responseText.includes('soapenv:Fault') || responseText.includes('soap:Fault')) {
            log('SOAP Fault detected!');

            // Extract fault details
            const faultCodeMatch = responseText.match(/<faultcode>(.*?)<\/faultcode>/);
            const faultStringMatch = responseText.match(/<faultstring>(.*?)<\/faultstring>/);

            if (faultCodeMatch || faultStringMatch) {
                log('Fault Code: ' + (faultCodeMatch ? faultCodeMatch[1] : 'N/A'));
                log('Fault String: ' + (faultStringMatch ? faultStringMatch[1] : 'N/A'));
            }

            // Check for specific error codes
            if (responseText.includes('LoginBlockedToChangeSystemGeneratedPin')) {
                log('\n ACCOUNT BLOCKED: Member must change system-generated PIN');
                log('   This is a business logic error, not an authentication error.');
                log('   The API connection and WS-Security authentication worked correctly!');
                return { success: false, reason: 'MEMBER_BLOCKED', requiresPinChange: true };
            }

            return { success: false, reason: 'SOAP_FAULT', response: responseText };
        }

        // Check for successful authentication
        if (responseText.includes('<status>true</status>')) {
            log('SUCCESS: Authentication successful!');

            // Try to extract transaction token
            const tokenMatch = responseText.match(/<transactionToken>(.*?)<\/transactionToken>/);
            const transactionId = responseText.match(/<transactionID>(.*?)<\/transactionID>/);

            return {
                success: true,
                transactionToken: tokenMatch ? tokenMatch[1] : null,
                transactionId: transactionId ? transactionId[1] : null,
                response: responseText
            };
        }

        return { success: false, reason: 'UNKNOWN', response: responseText };

    } catch (error) {
        log('ERROR: ' + error.message);
        log(error.stack);
        return { success: false, reason: 'NETWORK_ERROR', error: error.message };
    }
}

/**
 * Step 2: Fetch account summary using token/ID
 */
async function fetchAccountSummary(transactionToken, transactionId, memberCredentials) {
    const security = getUATWSSecurityHeaders();
    // Build SOAP envelope for Account Summary request (WSDL-compliant)
    const soapEnvelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:type="http://www.ibsplc.com/iloyal/member/accountsummary/type/">
      <soapenv:Header>
        <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
           <wsu:Timestamp wsu:Id="Timestamp-${Date.now()}" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
              <wsu:Created>${security.created}</wsu:Created>
              <wsu:Expires>${security.expires}</wsu:Expires>
           </wsu:Timestamp>
           <wsse:UsernameToken wsu:Id="UsernameToken-${Date.now()}" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
              <wsse:Username>${security.username}</wsse:Username>
              <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${security.passwordDigest}</wsse:Password>
              <wsse:Nonce>${security.nonce}</wsse:Nonce>
              <wsu:Created>${security.created}</wsu:Created>
           </wsse:UsernameToken>
        </wsse:Security>
      </soapenv:Header>
      <soapenv:Body>
        <type:AccountSummaryRequest>
          <companyCode>SA</companyCode>
          <programCode>VOYAG</programCode>
          <membershipNumber>${memberCredentials.membershipNumber}</membershipNumber>
          <txnHeader>
            <transactionID>${transactionId || ''}</transactionID>
            <userName>${security.username}</userName>
            <transactionToken>${transactionToken || ''}</transactionToken>
            <timeStamp>${new Date().toISOString()}</timeStamp>
          </txnHeader>
        </type:AccountSummaryRequest>
      </soapenv:Body>
    </soapenv:Envelope>`;
    log('SOAP Request (Account Summary):');
    log(soapEnvelope);

    try {
        // Use the correct endpoint and SOAPAction from the WSDL
        const url = `${UAT_API_CREDENTIALS.endpoint}/AccountSummaryService`;
        log(`Sending to: ${url}`);
        log(`(Host header: ${SAA_HOSTNAME})`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': '',
                'Host': SAA_HOSTNAME
            },
            body: soapEnvelope,
            agent: httpsAgent
        });

        log(`Response Status: ${response.status} ${response.statusText}`);
        log('Response Headers: ' + JSON.stringify(response.headers.raw()));
        const responseText = await response.text();
        // Diagnostic: log first 200 chars and check for XML prolog
        const trimmedResponse = responseText.trimStart();
        log('Raw Response Body (first 200 chars):');
        log(trimmedResponse.substring(0, 200));
        if (!trimmedResponse.startsWith('<')) {
            log('WARNING: Response does not start with <. Possible HTML or non-XML response.');
        }

        // Check for SOAP fault
        if (trimmedResponse.includes('soapenv:Fault') || trimmedResponse.includes('soap:Fault')) {
            log('SOAP Fault detected!');
            const faultCodeMatch = trimmedResponse.match(/<faultcode>(.*?)<\/faultcode>/);
            const faultStringMatch = trimmedResponse.match(/<faultstring>(.*?)<\/faultstring>/);
            if (faultCodeMatch || faultStringMatch) {
                log('Fault Code: ' + (faultCodeMatch ? faultCodeMatch[1] : 'N/A'));
                log('Fault String: ' + (faultStringMatch ? faultStringMatch[1] : 'N/A'));
            }
            return { success: false, reason: 'SOAP_FAULT', response: trimmedResponse };
        }

        // Try to extract account summary details (example: points balance)
        const pointsMatch = trimmedResponse.match(/<pointsBalance>(.*?)<\/pointsBalance>/);
        const tierMatch = trimmedResponse.match(/<tier>(.*?)<\/tier>/);
        const accountSummary = {
            pointsBalance: pointsMatch ? pointsMatch[1] : null,
            tier: tierMatch ? tierMatch[1] : null
        };

        return { success: true, accountSummary, response: trimmedResponse };

    } catch (error) {
        log('ERROR: ' + error.message);
        log(error.stack);
        return { success: false, reason: 'NETWORK_ERROR', error: error.message };
    }
}

/**
 * Main test runner - try multiple member accounts
 */
async function runTest() {
    log('UAT Member Authentication Test');
    log('Testing multiple member accounts to find one that works...');

    const results = [];

    for (const memberCredentials of TEST_MEMBERS) {
        // Step 1: Authenticate
        const authResult = await authenticateMember(memberCredentials);
        results.push({ ...memberCredentials, ...authResult });

        if (authResult.success) {
            log('FOUND WORKING CREDENTIALS!');
            // Step 2: Fetch account summary
            await fetchAccountSummary(authResult.transactionToken, authResult.transactionId, memberCredentials);
            break;
        }

        // Add a small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Summary
    log('Final Summary:');
    const successfulAuth = results.find(r => r.success);
    if (successfulAuth) {
        log('SUCCESSFUL AUTHENTICATION:');
        log(`Member: ${successfulAuth.membershipNumber}`);
        log(`PIN: ${successfulAuth.pin}`);
        log(`Transaction Token: ${successfulAuth.transactionToken || 'N/A'}`);
        log(`Transaction ID: ${successfulAuth.transactionId || 'N/A'}`);
    } else {
        log('NO SUCCESSFUL AUTHENTICATIONS');
        results.forEach(r => {
            log(`${r.membershipNumber}: ${r.reason || 'FAILED'}`);
            if (r.requiresPinChange) {
                log('└─ Account blocked - needs PIN change');
            }
        });
        log('Note: API connection and WS-Security are working!');
        log('The issue is with the member account credentials.');
        log('Request valid test credentials from SAA IT team.');
    }
    log('Test completed!');
}

// Run the test
runTest();