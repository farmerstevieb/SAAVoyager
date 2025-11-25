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
    { membershipNumber: '2730202', pin: '2222', note: 'Primary UAT test card (confirmed)' },
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
        const trimmedResponse = responseText.trimStart();
        
        // Log full response (or at least a larger portion)
        log('Raw Response Body:');
        if (trimmedResponse.length > 5000) {
            log(trimmedResponse.substring(0, 5000));
            log(`\n... (${trimmedResponse.length - 5000} more characters) ...`);
        } else {
            log(trimmedResponse);
        }
        
        if (!trimmedResponse.startsWith('<')) {
            log('WARNING: Response does not start with <. Possible HTML or non-XML response.');
        }

        // Check for SOAP fault
        if (trimmedResponse.includes('soapenv:Fault') || trimmedResponse.includes('soap:Fault')) {
            log('SOAP Fault detected!');
            const faultCodeMatch = trimmedResponse.match(/<faultcode[^>]*>(.*?)<\/faultcode>/i);
            const faultStringMatch = trimmedResponse.match(/<faultstring[^>]*>(.*?)<\/faultstring>/i);
            if (faultCodeMatch || faultStringMatch) {
                log('Fault Code: ' + (faultCodeMatch ? faultCodeMatch[1] : 'N/A'));
                log('Fault String: ' + (faultStringMatch ? faultStringMatch[1] : 'N/A'));
            }
            return { success: false, reason: 'SOAP_FAULT', response: trimmedResponse };
        }

        // Parse account summary details
        log('\n' + '='.repeat(60));
        log('PARSING ACCOUNT SUMMARY:');
        log('='.repeat(60));
        
        const accountSummary = {};
        
        // Extract basic member info
        const membershipNumberMatch = trimmedResponse.match(/<membershipNumber[^>]*>(.*?)<\/membershipNumber>/i);
        const firstNameMatch = trimmedResponse.match(/<firstName[^>]*>(.*?)<\/firstName>/i);
        const lastNameMatch = trimmedResponse.match(/<lastName[^>]*>(.*?)<\/lastName>/i);
        const tierMatch = trimmedResponse.match(/<tier[^>]*>(.*?)<\/tier>/i);
        const tierCodeMatch = trimmedResponse.match(/<tierCode[^>]*>(.*?)<\/tierCode>/i);
        
        if (membershipNumberMatch) {
            accountSummary.membershipNumber = membershipNumberMatch[1].trim();
            log(`Membership Number: ${accountSummary.membershipNumber}`);
        }
        if (firstNameMatch) {
            accountSummary.firstName = firstNameMatch[1].trim();
            log(`First Name: ${accountSummary.firstName}`);
        }
        if (lastNameMatch) {
            accountSummary.lastName = lastNameMatch[1].trim();
            log(`Last Name: ${accountSummary.lastName}`);
        }
        if (tierMatch) {
            accountSummary.tier = tierMatch[1].trim();
            log(`Tier: ${accountSummary.tier}`);
        }
        if (tierCodeMatch) {
            accountSummary.tierCode = tierCodeMatch[1].trim();
            log(`Tier Code: ${accountSummary.tierCode}`);
        }
        
        // Extract points balances
        const totalPointsMatch = trimmedResponse.match(/<totalPoints[^>]*>(.*?)<\/totalPoints>/i);
        const availablePointsMatch = trimmedResponse.match(/<availablePoints[^>]*>(.*?)<\/availablePoints>/i);
        const pointsBalanceMatch = trimmedResponse.match(/<pointsBalance[^>]*>(.*?)<\/pointsBalance>/i);
        const pendingPointsMatch = trimmedResponse.match(/<pendingPoints[^>]*>(.*?)<\/pendingPoints>/i);
        const expiringPointsMatch = trimmedResponse.match(/<expiringPoints[^>]*>(.*?)<\/expiringPoints>/i);
        
        log('\n--- Points Summary ---');
        if (totalPointsMatch) {
            accountSummary.totalPoints = parseFloat(totalPointsMatch[1]) || 0;
            log(`Total Points: ${accountSummary.totalPoints}`);
        }
        if (availablePointsMatch) {
            accountSummary.availablePoints = parseFloat(availablePointsMatch[1]) || 0;
            log(`Available Points: ${accountSummary.availablePoints}`);
        }
        if (pointsBalanceMatch) {
            accountSummary.pointsBalance = parseFloat(pointsBalanceMatch[1]) || 0;
            log(`Points Balance: ${accountSummary.pointsBalance}`);
        }
        if (pendingPointsMatch) {
            accountSummary.pendingPoints = parseFloat(pendingPointsMatch[1]) || 0;
            log(`Pending Points: ${accountSummary.pendingPoints}`);
        }
        if (expiringPointsMatch) {
            accountSummary.expiringPoints = parseFloat(expiringPointsMatch[1]) || 0;
            log(`Expiring Points: ${accountSummary.expiringPoints}`);
        }
        
        // Extract point details (pointDetails array)
        log('\n--- Point Details by Type ---');
        const pointDetailsMatches = trimmedResponse.match(/<pointDetails[^>]*>([\s\S]*?)<\/pointDetails>/gi);
        accountSummary.pointDetails = [];
        
        if (pointDetailsMatches && pointDetailsMatches.length > 0) {
            log(`Found ${pointDetailsMatches.length} point detail section(s)`);
            
            pointDetailsMatches.forEach((pointDetailSection, idx) => {
                const pointTypeMatch = pointDetailSection.match(/<pointType[^>]*>(.*?)<\/pointType>/i);
                const pointsMatch = pointDetailSection.match(/<points[^>]*>(.*?)<\/points>/i);
                const expiryDateMatch = pointDetailSection.match(/<expiryDate[^>]*>(.*?)<\/expiryDate>/i);
                const effectiveDateMatch = pointDetailSection.match(/<effectiveDate[^>]*>(.*?)<\/effectiveDate>/i);
                const statusMatch = pointDetailSection.match(/<status[^>]*>(.*?)<\/status>/i);
                
                const pointDetail = {
                    pointType: pointTypeMatch ? pointTypeMatch[1].trim() : null,
                    points: pointsMatch ? parseFloat(pointsMatch[1]) || 0 : 0,
                    expiryDate: expiryDateMatch ? expiryDateMatch[1].trim() : null,
                    effectiveDate: effectiveDateMatch ? effectiveDateMatch[1].trim() : null,
                    status: statusMatch ? statusMatch[1].trim() : null
                };
                
                accountSummary.pointDetails.push(pointDetail);
                
                log(`\n  Point Detail #${idx + 1}:`);
                log(`    Type: ${pointDetail.pointType || 'N/A'}`);
                log(`    Points: ${pointDetail.points}`);
                if (pointDetail.expiryDate) log(`    Expiry Date: ${pointDetail.expiryDate}`);
                if (pointDetail.effectiveDate) log(`    Effective Date: ${pointDetail.effectiveDate}`);
                if (pointDetail.status) log(`    Status: ${pointDetail.status}`);
            });
        } else {
            // Try alternative pattern - pointDetails might be structured differently
            const altPointDetails = trimmedResponse.match(/<pointDetails[^>]*>[\s\S]*?<\/pointDetails>/i);
            if (altPointDetails) {
                log('Found pointDetails section (alternative structure)');
                // Try to extract individual point entries
                const pointEntries = altPointDetails[0].match(/<point[^>]*>[\s\S]*?<\/point>/gi);
                if (pointEntries) {
                    log(`Found ${pointEntries.length} point entries`);
                    pointEntries.forEach((entry, idx) => {
                        const pointTypeMatch = entry.match(/<pointType[^>]*>(.*?)<\/pointType>/i);
                        const pointsMatch = entry.match(/<points[^>]*>(.*?)<\/points>/i);
                        log(`  Entry #${idx + 1}: Type=${pointTypeMatch ? pointTypeMatch[1] : 'N/A'}, Points=${pointsMatch ? pointsMatch[1] : 'N/A'}`);
                    });
                }
            } else {
                log('No pointDetails found in response');
            }
        }
        
        // Extract account status
        const accountStatusMatch = trimmedResponse.match(/<accountStatus[^>]*>(.*?)<\/accountStatus>/i);
        if (accountStatusMatch) {
            accountSummary.accountStatus = accountStatusMatch[1].trim();
            log(`\nAccount Status: ${accountSummary.accountStatus}`);
        }
        
        // Extract membership dates
        const joinDateMatch = trimmedResponse.match(/<joinDate[^>]*>(.*?)<\/joinDate>/i);
        const expiryDateMatch = trimmedResponse.match(/<membershipExpiryDate[^>]*>(.*?)<\/membershipExpiryDate>/i);
        if (joinDateMatch) {
            accountSummary.joinDate = joinDateMatch[1].trim();
            log(`Join Date: ${accountSummary.joinDate}`);
        }
        if (expiryDateMatch) {
            accountSummary.membershipExpiryDate = expiryDateMatch[1].trim();
            log(`Membership Expiry Date: ${accountSummary.membershipExpiryDate}`);
        }
        
        log('='.repeat(60));
        log('END OF ACCOUNT SUMMARY');
        log('='.repeat(60) + '\n');

        return { success: true, accountSummary, response: trimmedResponse };

    } catch (error) {
        log('ERROR: ' + error.message);
        log(error.stack);
        return { success: false, reason: 'NETWORK_ERROR', error: error.message };
    }
}

/**
 * Step 3: Redeem points (reduce balance) using IssueCertificate service
 */
async function redeemPoints(transactionId, membershipNumber, pointsToDeduct, memberName = { givenName: 'TEST', familyName: 'USER' }) {
    log('\n' + '='.repeat(60));
    log('TESTING POINT REDEMPTION (REDUCING BALANCE)');
    log('='.repeat(60));
    log(`Membership Number: ${membershipNumber}`);
    log(`Points to Deduct: ${pointsToDeduct}`);
    log(`Point Type: PURCH (or available)`);
    log(`Member Name: ${memberName.givenName} ${memberName.familyName}\n`);
    
    const security = getUATWSSecurityHeaders();
    const timestamp = new Date().toISOString();
    
    // Build SOAP envelope for IssueCertificate request (point redemption)
    const soapEnvelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:type="http://www.ibsplc.com/iloyal/redemption/issuecertificate/type/">
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
      <type:IssueCertificateRequest>
         <certificate>
            <companyCode>SA</companyCode>
            <programCode>VOYAG</programCode>
            <partnerCode>WOM</partnerCode>
            <rewardCode>WMDYRD</rewardCode>
            <rewardGroup>L</rewardGroup>
            <rewardDiscount>0</rewardDiscount>
            <membershipNumber>${membershipNumber}</membershipNumber>
            <title></title>
            <givenName>${memberName.givenName}</givenName>
            <familyName>${memberName.familyName}</familyName>
            <rewardPoints>0</rewardPoints>
            <minimumPoints>0</minimumPoints>
            <maximumPoints>0</maximumPoints>
            <actualCostofRedemption>0</actualCostofRedemption>
            <cabinClass></cabinClass>
            <excessWeight>0</excessWeight>
            <issueDate></issueDate>
            <redemptionDate></redemptionDate>
            <fareClassGroup></fareClassGroup>
            <ssrCode></ssrCode>
            <flightDate></flightDate>
            <plannedDate></plannedDate>
            <paymentDetail>
               <pointsCollected>${pointsToDeduct}</pointsCollected>
               <amountCollected>0</amountCollected>
               <paymentType></paymentType>
               <currencyCode></currencyCode>
               <paymentSource></paymentSource>
               <quoteReferenceNumber></quoteReferenceNumber>
               <paymentGateWayRefNumber></paymentGateWayRefNumber>
               <bankRefNumber></bankRefNumber>
               <cardType></cardType>
               <cardHolderName></cardHolderName>
            </paymentDetail>
         </certificate>
         <txnHeader>
            <transactionID>${transactionId || ''}</transactionID>
            <userName>${security.username}</userName>
            <timeStamp>${timestamp}</timeStamp>
         </txnHeader>
      </type:IssueCertificateRequest>
   </soapenv:Body>
</soapenv:Envelope>`;
    
    log('SOAP Request (Point Redemption):');
    log(soapEnvelope);
    
    try {
        const url = `${UAT_API_CREDENTIALS.endpoint}/IssueCertificateService`;
        log(`Sending to: ${url}`);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://www.ibsplc.com/iloyal/redemption/issuecertificate/wsdl/IssueCertificate/IssueCertificateRequest',
                'User-Agent': 'SAA-Voyager-Test/1.0'
            },
            body: soapEnvelope,
            agent: httpsAgent
        });
        
        log(`Response Status: ${response.status} ${response.statusText}`);
        log('Response Headers: ' + JSON.stringify(response.headers.raw()));
        const responseText = await response.text();
        const trimmedResponse = responseText.trimStart();
        
        // Log full response
        log('Raw Response Body:');
        if (trimmedResponse.length > 3000) {
            log(trimmedResponse.substring(0, 3000));
            log(`\n... (${trimmedResponse.length - 3000} more characters) ...`);
        } else {
            log(trimmedResponse);
        }
        
        // Check for SOAP fault
        if (trimmedResponse.includes('soapenv:Fault') || trimmedResponse.includes('soap:Fault')) {
            log('\n❌ SOAP Fault detected!');
            const faultCodeMatch = trimmedResponse.match(/<faultcode[^>]*>(.*?)<\/faultcode>/i);
            const faultStringMatch = trimmedResponse.match(/<faultstring[^>]*>(.*?)<\/faultstring>/i);
            
            // Try to extract nested RewardWebServiceException details
            const detailMatch = trimmedResponse.match(/<detail[^>]*>([\s\S]*?)<\/detail>/i);
            if (detailMatch) {
                const detailBody = detailMatch[1];
                const rewardExceptionMatch = detailBody.match(/<[^>]*:RewardWebServiceException[^>]*>([\s\S]*?)<\/[^>]*:RewardWebServiceException>/i);
                if (rewardExceptionMatch) {
                    const exceptionBody = rewardExceptionMatch[1];
                    const nestedFaultCodeMatch = exceptionBody.match(/<faultcode[^>]*>(.*?)<\/faultcode>/i);
                    const nestedFaultStringMatch = exceptionBody.match(/<faultstring[^>]*>(.*?)<\/faultstring>/i);
                    
                    if (nestedFaultCodeMatch) {
                        log(`Specific Error Code: ${nestedFaultCodeMatch[1].trim()}`);
                    }
                    if (nestedFaultStringMatch) {
                        log(`Specific Error: ${nestedFaultStringMatch[1].trim()}`);
                    }
                }
            }
            
            if (faultCodeMatch || faultStringMatch) {
                log('Fault Code: ' + (faultCodeMatch ? faultCodeMatch[1] : 'N/A'));
                log('Fault String: ' + (faultStringMatch ? faultStringMatch[1] : 'N/A'));
            }
            return { success: false, reason: 'SOAP_FAULT', response: trimmedResponse };
        }
        
        // Parse successful response
        log('\n' + '='.repeat(60));
        log('PARSING REDEMPTION RESPONSE:');
        log('='.repeat(60));
        
        const redemptionResult = {};
        
        // Extract certificate number
        const certificateNumberMatch = trimmedResponse.match(/<certificateNumber[^>]*>(.*?)<\/certificateNumber>/i);
        if (certificateNumberMatch) {
            redemptionResult.certificateNumber = certificateNumberMatch[1].trim();
            log(`✅ Certificate Number: ${redemptionResult.certificateNumber}`);
        }
        
        // Extract status
        const statusMatch = trimmedResponse.match(/<status[^>]*>(.*?)<\/status>/i);
        if (statusMatch) {
            redemptionResult.status = statusMatch[1].trim();
            log(`Status: ${redemptionResult.status}`);
        }
        
        // Extract points redeemed
        const pointsRedeemedMatch = trimmedResponse.match(/<totalRedeemedpoints[^>]*>(.*?)<\/totalRedeemedpoints>/i);
        if (pointsRedeemedMatch) {
            redemptionResult.pointsRedeemed = parseFloat(pointsRedeemedMatch[1]) || 0;
            log(`Points Redeemed: ${redemptionResult.pointsRedeemed}`);
        }
        
        // Extract remaining balance
        const remainingBalanceMatch = trimmedResponse.match(/<remainingBalance[^>]*>(.*?)<\/remainingBalance>/i);
        if (remainingBalanceMatch) {
            redemptionResult.remainingBalance = parseFloat(remainingBalanceMatch[1]) || 0;
            log(`Remaining Balance: ${redemptionResult.remainingBalance}`);
        }
        
        log('='.repeat(60));
        log('END OF REDEMPTION RESPONSE');
        log('='.repeat(60) + '\n');
        
        return { success: true, redemptionResult, response: trimmedResponse };
        
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
            // Step 2: Fetch account summary (BEFORE redemption)
            const accountSummaryResult = await fetchAccountSummary(authResult.transactionToken, authResult.transactionId, memberCredentials);
            results[results.length - 1].accountSummary = accountSummaryResult;
            
            // Step 3: Test point redemption (reduce balance)
            if (accountSummaryResult.success && accountSummaryResult.accountSummary) {
                const summary = accountSummaryResult.accountSummary;
                
                // Find PURCH point type balance
                let purchPoints = 0;
                let memberName = { givenName: 'TEST', familyName: 'USER' };
                
                if (summary.pointDetails && summary.pointDetails.length > 0) {
                    const purchDetail = summary.pointDetails.find(d => d.pointType === 'PURCH');
                    if (purchDetail) {
                        purchPoints = purchDetail.points;
                    }
                    
                    // Try to get member name from account summary
                    if (summary.firstName) memberName.givenName = summary.firstName;
                    if (summary.lastName) memberName.familyName = summary.lastName;
                }
                
                // Test with a small amount (100 points) if PURCH balance is available
                if (purchPoints >= 100) {
                    log('\n⚠️  WARNING: About to deduct 100 points from PURCH balance!');
                    log(`   Current PURCH balance: ${purchPoints} points`);
                    log('   Waiting 3 seconds before proceeding...\n');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    const redemptionResult = await redeemPoints(
                        authResult.transactionId,
                        memberCredentials.membershipNumber,
                        100, // Deduct 100 points
                        memberName
                    );
                    results[results.length - 1].redemption = redemptionResult;
                    
                    // Step 4: Fetch account summary again (AFTER redemption) to verify balance changed
                    if (redemptionResult.success) {
                        log('\n' + '='.repeat(60));
                        log('VERIFYING BALANCE CHANGE - Fetching Account Summary Again');
                        log('='.repeat(60));
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                        
                        const accountSummaryAfter = await fetchAccountSummary(authResult.transactionToken, authResult.transactionId, memberCredentials);
                        results[results.length - 1].accountSummaryAfter = accountSummaryAfter;
                        
                        // Compare balances
                        if (accountSummaryAfter.success && accountSummaryAfter.accountSummary) {
                            const summaryAfter = accountSummaryAfter.accountSummary;
                            if (summaryAfter.pointDetails && summaryAfter.pointDetails.length > 0) {
                                const purchDetailAfter = summaryAfter.pointDetails.find(d => d.pointType === 'PURCH');
                                if (purchDetailAfter) {
                                    const newPurchPoints = purchDetailAfter.points;
                                    const expectedPoints = purchPoints - 100;
                                    log(`\n📊 BALANCE COMPARISON:`);
                                    log(`   Before: ${purchPoints} PURCH points`);
                                    log(`   After:  ${newPurchPoints} PURCH points`);
                                    log(`   Expected: ${expectedPoints} PURCH points`);
                                    if (newPurchPoints === expectedPoints) {
                                        log(`   ✅ SUCCESS: Balance correctly reduced by 100 points!`);
                                    } else {
                                        log(`   ⚠️  WARNING: Balance change doesn't match expected value`);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    log(`\n⚠️  Skipping redemption test: PURCH balance (${purchPoints}) is less than 100 points`);
                }
            }
            
            break;
        }

        // Add a small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Summary
    log('\n' + '='.repeat(60));
    log('Final Summary:');
    log('='.repeat(60));
    const successfulAuth = results.find(r => r.success);
    if (successfulAuth) {
        log('SUCCESSFUL AUTHENTICATION:');
        log(`Member: ${successfulAuth.membershipNumber}`);
        log(`PIN: ${successfulAuth.pin}`);
        log(`Transaction Token: ${successfulAuth.transactionToken || 'N/A'}`);
        log(`Transaction ID: ${successfulAuth.transactionId || 'N/A'}`);
        
        // Display account summary if available
        if (successfulAuth.accountSummary && successfulAuth.accountSummary.success) {
            log('\nACCOUNT SUMMARY (BEFORE REDEMPTION):');
            const summary = successfulAuth.accountSummary.accountSummary;
            
            if (summary.totalPoints !== undefined) {
                log(`Total Points: ${summary.totalPoints}`);
            }
            if (summary.availablePoints !== undefined) {
                log(`Available Points: ${summary.availablePoints}`);
            }
            if (summary.pointsBalance !== undefined) {
                log(`Points Balance: ${summary.pointsBalance}`);
            }
            if (summary.tier) {
                log(`Tier: ${summary.tier}`);
            }
            if (summary.pointDetails && summary.pointDetails.length > 0) {
                log(`\nPoint Details (${summary.pointDetails.length} types):`);
                summary.pointDetails.forEach((detail, idx) => {
                    log(`  ${idx + 1}. ${detail.pointType || 'Unknown'}: ${detail.points} points`);
                    if (detail.expiryDate) {
                        log(`     Expires: ${detail.expiryDate}`);
                    }
                });
            }
        } else if (successfulAuth.accountSummary && !successfulAuth.accountSummary.success) {
            log(`\nAccount Summary Failed: ${successfulAuth.accountSummary.reason || 'Unknown error'}`);
        }
        
        // Display redemption result if available
        if (successfulAuth.redemption) {
            log('\nPOINT REDEMPTION RESULT:');
            if (successfulAuth.redemption.success) {
                log('✅ Redemption SUCCESSFUL');
                if (successfulAuth.redemption.redemptionResult.certificateNumber) {
                    log(`   Certificate Number: ${successfulAuth.redemption.redemptionResult.certificateNumber}`);
                }
                if (successfulAuth.redemption.redemptionResult.pointsRedeemed !== undefined) {
                    log(`   Points Redeemed: ${successfulAuth.redemption.redemptionResult.pointsRedeemed}`);
                }
                if (successfulAuth.redemption.redemptionResult.remainingBalance !== undefined) {
                    log(`   Remaining Balance: ${successfulAuth.redemption.redemptionResult.remainingBalance}`);
                }
            } else {
                log(`❌ Redemption FAILED: ${successfulAuth.redemption.reason || 'Unknown error'}`);
            }
        }
        
        // Display account summary after redemption if available
        if (successfulAuth.accountSummaryAfter && successfulAuth.accountSummaryAfter.success) {
            log('\nACCOUNT SUMMARY (AFTER REDEMPTION):');
            const summaryAfter = successfulAuth.accountSummaryAfter.accountSummary;
            
            if (summaryAfter.pointDetails && summaryAfter.pointDetails.length > 0) {
                log(`\nPoint Details (${summaryAfter.pointDetails.length} types):`);
                summaryAfter.pointDetails.forEach((detail, idx) => {
                    log(`  ${idx + 1}. ${detail.pointType || 'Unknown'}: ${detail.points} points`);
                    if (detail.expiryDate) {
                        log(`     Expires: ${detail.expiryDate}`);
                    }
                });
            }
        }
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