/**
 * Cloudflare Worker Entry Point for SAA Voyager App
 * Updated to use real SOAP service with UAT security headers
 */

// Worker only handles API endpoints - React app is hosted separately

// CORS headers (without Content-Type, set per response)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// App Settings Storage (using KV for persistence)
const DEFAULT_SETTINGS = {
  pointsToZarRate: 0.1,
  voyagerApiUrl: 'https://saa-voyager-app-prod.tofmail2022.workers.dev/api/voyager'
};

// Helper function to get settings from KV
async function getAppSettings(env) {
  try {
    if (env?.APP_SETTINGS) {
      const settingsJson = await env.APP_SETTINGS.get('settings');
      if (settingsJson) {
        const settings = JSON.parse(settingsJson);
        log('[Settings] Loaded from KV:', settings);
        return settings;
      }
    }
  } catch (error) {
    log('[Settings] Error loading from KV:', error);
  }
  
  // Fallback to default or env vars
  const settings = { ...DEFAULT_SETTINGS };
  if (env?.POINTS_TO_ZAR_RATE) {
    settings.pointsToZarRate = parseFloat(env.POINTS_TO_ZAR_RATE) || DEFAULT_SETTINGS.pointsToZarRate;
  }
  if (env?.VOYAGER_API_URL) {
    settings.voyagerApiUrl = env.VOYAGER_API_URL;
  }
  return settings;
}

// Helper function to save settings to KV
async function saveAppSettings(env, settings) {
  try {
    if (env?.APP_SETTINGS) {
      log('[Settings] Attempting to save to KV:', { settings, hasBinding: !!env.APP_SETTINGS });
      await env.APP_SETTINGS.put('settings', JSON.stringify(settings));
      log('[Settings] Successfully saved to KV:', settings);
      
      // Verify the save by reading it back
      const verify = await env.APP_SETTINGS.get('settings');
      if (verify) {
        log('[Settings] Verified KV save - read back:', JSON.parse(verify));
      } else {
        log('[Settings] WARNING: KV save verification failed - value not found after write');
      }
      
      return true;
    } else {
      log('[Settings] WARNING: APP_SETTINGS KV binding not available in env');
    }
  } catch (error) {
    log('[Settings] Error saving to KV:', { error: error.message, stack: error.stack });
  }
  return false;
}

// Simple logging
function log(message, data = null) {
  console.log(`[${new Date().toISOString()}] ${message}`, data || '');
}

// Real Voyager service with SOAP integration
class VoyagerService {
  constructor(env) {
    this.env = env;
    this.sessions = new Map();
    this.sessionBalances = new Map();
    this.memberBalances = new Map();
    // Mock mode disabled to use real Voyager responses
    // this.mockMode = String(env?.VOYAGER_MOCK_MODE ?? 'true').toLowerCase() !== 'false';
    this.mockMode = false; // Force real mode
    const parsedMockPoints = parseInt(env?.MOCK_POINTS ?? '100000', 10);
    this.mockPoints = Number.isFinite(parsedMockPoints) && parsedMockPoints > 0 ? parsedMockPoints : 100000;
    const parsedLatency = parseInt(env?.MOCK_LATENCY_MS ?? '0', 10);
    this.mockLatencyMs = Number.isFinite(parsedLatency) && parsedLatency > 0 ? parsedLatency : 0;
    
    // Enable UAT mode for real Voyager service
    this.isUAT = true;
    
    // Debug logging
    console.log('Environment detection:', {
      NODE_ENV: env.NODE_ENV,
      VOYAGER_ENV: env.VOYAGER_ENV,
      isUAT: this.isUAT,
      mockMode: this.mockMode,
      mockPoints: this.mockPoints,
      mockLatencyMs: this.mockLatencyMs
    });
    
    // UAT URLs (non-versioned to match working test.js behavior)
    this.authUrl = 'https://ilstage.flysaa.com/saa_upg_uat-ws/services/AuthenticateMemberService';
    this.accountUrl = 'https://ilstage.flysaa.com/saa_upg_uat-ws/services/AccountSummaryService';
    // Use non-versioned endpoint for UAT (matching SoapUI project)
    this.issueUrl = 'https://ilstage.flysaa.com/saa_upg_uat-ws/services/IssueCertificateService';
    this.markUrl = 'https://ilstage.flysaa.com/saa_upg_uat-ws/services/MarkCertificateAsUsedService';
    this.recreditUrl = 'https://ilstage.flysaa.com/saa_upg_uat-ws/services/RecreditPointsServiceV2.7';
    this.logoutUrl = 'https://ilstage.flysaa.com/saa_upg_uat-ws/services/LogoutMemberServiceV2.7';
    
    // Hardcoded UAT WS-Security credentials
    this.username = 'wom';
    this.password = 'RxjWNeJegwDTtbGW0Q2FFBCnQ3A';
  }

  async simulateMockLatency(stage) {
    if (!this.mockMode || this.mockLatencyMs <= 0) {
      return;
    }
    console.log(`[MOCK] Simulating latency (${this.mockLatencyMs}ms) for ${stage}`);
    await new Promise(resolve => setTimeout(resolve, this.mockLatencyMs));
  }

  // Generate a session ID based on credentials (more persistent than in-memory)
  generateSessionId(username, password) {
    // Create a deterministic session ID based on credentials
    const sessionData = `${username}:${password}`;
    return `session_${btoa(sessionData).substr(0, 20)}_${Date.now()}`;
  }

  // Validate session (placeholder; integrate with a store if needed)
  validateSession(sessionId) {
    return Boolean(sessionId);
  }

  // Point type priority for FEFO (First Expiry, First Out) when expiry dates are the same
  // Lower number = higher priority (use first)
  getPointTypePriority(pointType) {
    const priorityMap = {
      'MNBONEXP': 1,    // 1 month - highest priority
      'MNREINST': 2,    // 1 month
      '3MBON': 3,       // 3 months
      '6MBON': 4,       // 6 months
      '1YRBON': 5,      // 12 months
      'REINST': 6,      // 12 months
      'RFBON01': 7,     // 12 months
      'RFBON02': 8,     // 12 months
      'RFBON03': 9,     // 24 months
      'BASE': 10,       // 36 months
      'BONUS': 11,      // 36 months
      'EMDB': 12,       // 36 months
      'EMDR': 13,       // 36 months
      'MPURCH': 14,     // 36 months
      'PURCH': 15       // 36 months - lowest priority
    };
    return priorityMap[pointType] || 99; // Unknown types get lowest priority
  }

  // Parse expiry date string to Date object for comparison
  // Format: "31-Dec-2025" or "31-Dec-2025" or "2025-12-31"
  parseExpiryDate(dateStr) {
    if (!dateStr || dateStr === 'null' || dateStr.trim() === '') {
      return null;
    }
    
    try {
      // Try DD-MMM-YYYY format (e.g., "31-Dec-2025")
      const parts = dateStr.trim().split('-');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames.indexOf(parts[1]);
        const year = parseInt(parts[2], 10);
        
        if (month >= 0 && day > 0 && year > 0) {
          return new Date(year, month, day);
        }
      }
      
      // Try ISO format (e.g., "2025-12-31")
      const isoDate = new Date(dateStr);
      if (!isNaN(isoDate.getTime())) {
        return isoDate;
      }
    } catch (error) {
      log('[FEFO] Error parsing expiry date:', { dateStr, error: error.message });
    }
    
    return null;
  }

  // Select point type to deduct from based on FEFO logic
  // Returns: { pointType, points, expiryDate } or null if insufficient balance
  selectPointTypeForDeduction(pointTypes, pointsToDeduct) {
    if (!pointTypes || pointTypes.length === 0) {
      log('[FEFO] No point types available');
      return null;
    }

    // Filter point types that have available balance
    const availableTypes = pointTypes
      .filter(pt => pt.points > 0 && pt.expiryDate)
      .map(pt => ({
        ...pt,
        expiryDateObj: this.parseExpiryDate(pt.expiryDate)
      }))
      .filter(pt => pt.expiryDateObj !== null); // Only include valid expiry dates

    if (availableTypes.length === 0) {
      log('[FEFO] No point types with valid expiry dates');
      return null;
    }

    // Sort by expiry date (earliest first), then by priority if same date
    availableTypes.sort((a, b) => {
      // First compare expiry dates
      const dateDiff = a.expiryDateObj.getTime() - b.expiryDateObj.getTime();
      if (dateDiff !== 0) {
        return dateDiff; // Earlier expiry date comes first
      }
      
      // If same expiry date, use priority
      const priorityA = this.getPointTypePriority(a.pointType);
      const priorityB = this.getPointTypePriority(b.pointType);
      return priorityA - priorityB; // Lower priority number = higher priority
    });

    log('[FEFO] Sorted point types:', availableTypes.map(pt => ({
      type: pt.pointType,
      points: pt.points,
      expiryDate: pt.expiryDate,
      priority: this.getPointTypePriority(pt.pointType)
    })));

    // Select the first point type (earliest expiry, highest priority)
    const selected = availableTypes[0];
    
    if (selected.points < pointsToDeduct) {
      log('[FEFO] Selected point type has insufficient balance:', {
        pointType: selected.pointType,
        available: selected.points,
        required: pointsToDeduct
      });
      // Could implement multi-type deduction here if needed
      // For now, return null if insufficient
      return null;
    }

    log('[FEFO] Selected point type for deduction:', {
      pointType: selected.pointType,
      points: selected.points,
      expiryDate: selected.expiryDate,
      pointsToDeduct
    });

    return {
      pointType: selected.pointType,
      points: selected.points,
      expiryDate: selected.expiryDate
    };
  }

  // Store session in KV (if available) for persistence across Worker instances
  async storeSessionInKV(sessionId, sessionData) {
    try {
      if (this.env?.SESSIONS_KV) {
        await this.env.SESSIONS_KV.put(sessionId, JSON.stringify(sessionData), { expirationTtl: 3600 }); // 1 hour TTL
        log('[SESSION-KV] Stored session in KV:', { sessionId, hasMemberId: !!sessionData.memberId });
        return true;
      }
    } catch (error) {
      log('[SESSION-KV] Error storing session in KV:', error);
    }
    return false;
  }

  // Retrieve session from KV (if available)
  async getSessionFromKV(sessionId) {
    try {
      if (this.env?.SESSIONS_KV) {
        const sessionData = await this.env.SESSIONS_KV.get(sessionId);
        if (sessionData) {
          log('[SESSION-KV] Retrieved session from KV:', { sessionId, hasMemberId: !!JSON.parse(sessionData).memberId });
          return JSON.parse(sessionData);
        }
      }
    } catch (error) {
      log('[SESSION-KV] Error retrieving session from KV:', error);
    }
    return null;
  }

  // Get or reconstruct session (tries KV first, then in-memory, then reconstructs from sessionId)
  async getSession(sessionId) {
    // Try in-memory first (fastest)
    let session = this.sessions.get(sessionId);
    if (session) {
      log('[SESSION] Found session in memory:', { sessionId, memberId: session.memberId });
      return session;
    }

    // Try KV storage (persistent across instances)
    session = await this.getSessionFromKV(sessionId);
    if (session) {
      // Restore to in-memory cache for faster access
      this.sessions.set(sessionId, session);
      log('[SESSION] Restored session from KV to memory:', { sessionId, memberId: session.memberId });
      return session;
    }

    // Fallback: Try to extract membership number from sessionId
    // SessionId format: session_<base64(username:password)>_<timestamp>
    // Note: Only first 20 chars of base64 are used, so full decode may not work
    // But we can try to decode and extract username if possible
    try {
      const sessionIdParts = sessionId.split('_');
      if (sessionIdParts.length >= 2) {
        const encodedData = sessionIdParts[1];
        // Try to decode (base64) - may fail if truncated
        try {
          const decoded = atob(encodedData + '=='); // Add padding in case it was truncated
          const [username] = decoded.split(':');
          if (username && username.length > 0) {
            log('[SESSION] Reconstructed session from sessionId:', { sessionId, username });
            // Return minimal session data - tokens will need to be re-fetched
            // But we can at least identify the member
            return {
              username,
              memberId: username, // Use username as memberId fallback
              sessionToken: null, // Will need to be fetched again via re-auth
              transactionId: null
            };
          }
        } catch (decodeError) {
          // Base64 decode failed - sessionId might be truncated
          log('[SESSION] Could not decode sessionId (may be truncated):', decodeError.message);
        }
      }
    } catch (error) {
      log('[SESSION] Could not reconstruct session from sessionId:', error);
    }

    return null;
  }

  async authenticateMember(username, password) {
    if (this.mockMode) {
      await this.simulateMockLatency('authenticateMember');
      const sessionId = this.generateSessionId(username || 'mock-user', password || '');
      const memberId = username || 'mock-member';
      const sessionToken = `mock-token-${Date.now()}`;
      this.sessions.set(sessionId, {
        sessionToken,
        memberId,
        username: memberId
      });
      this.sessionBalances.set(sessionId, this.mockPoints);
      this.memberBalances.set(memberId, this.mockPoints);
      console.log('[MOCK][AUTH] Authentication successful', {
        sessionId,
        memberId,
        points: this.mockPoints
      });
      return {
        success: true,
        sessionId,
        memberId,
        message: 'Authentication successful (mock)'
      };
    }
    // Real SOAP authentication
    try {
      log('Authenticating with SOAP service:', { username, isUAT: this.isUAT });
      
      // Fixed WS-Security values (UAT)
      const created = '2050-12-31T10:33:52.303Z';
      const nonceB64 = 'MTY4NjExNjA4MQ==';
      const passwordDigestB64 = 'RxjWNeJegwDTtbGW0Q2FFBCnQ3A=';
      
      // Debug logging
      console.log('SOAP Request Debug:', {
        isUAT: this.isUAT,
        authUrl: this.authUrl,
        username: this.username,
        created,
        nonceB64,
        passwordDigestB64
      });
      
      // Construct SOAP request (match test.js exactly for UAT)
      const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:type="http://www.ibsplc.com/iloyal/member/authenticatemember/type/">
   <soapenv:Header>
      <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"> 
         <wsu:Timestamp wsu:Id="${this.isUAT ? 'Timestamp-2' : 'Timestamp-' + Date.now()}" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"> 
            <wsu:Created>${created}</wsu:Created>
            <wsu:Expires>${created}</wsu:Expires>
         </wsu:Timestamp>
         <wsse:UsernameToken wsu:Id="UsernameToken-20914066" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"> 
            <wsse:Username>wom</wsse:Username>
            <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigestB64}</wsse:Password>
            <wsse:Nonce>${nonceB64}</wsse:Nonce>
            <wsu:Created>${created}</wsu:Created>
         </wsse:UsernameToken>
      </wsse:Security>
   </soapenv:Header>
   <soapenv:Body>
      <type:AuthenticateMemberRequest>
         <companyCode>SA</companyCode>
         <programCode>VOYAG</programCode>
         <membershipNumber>${username}</membershipNumber>
         <pin>${password}</pin>
         <skipPinChangeReminder>1</skipPinChangeReminder>
         <txnHeader>
            <transactionID></transactionID>
            <userName>wom</userName>
            <transactionToken></transactionToken>
            <timeStamp>${new Date().toISOString()}</timeStamp>
         </txnHeader>
      </type:AuthenticateMemberRequest>
   </soapenv:Body>
</soapenv:Envelope>`;
      
      console.log('Making SOAP request to:', this.authUrl);
      console.log('Request body length:', soapEnvelope.length);
      console.log('SOAP Request Body:', soapEnvelope);
      
      let response;
      try {
        // Try HTTPS first with Cloudflare-specific options
        // Note: Cloudflare Workers may have network restrictions accessing UAT servers
        // If this fails, you may need a backend proxy server
        response = await fetch(this.authUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '',
            'User-Agent': 'SAA-Voyager-Worker/1.0',
            'Host': 'ilstage.flysaa.com' // Explicit Host header
          },
          body: soapEnvelope,
          // Cloudflare-specific fetch options
          cf: {
            cacheTtl: 0,
            cacheEverything: false,
            // Try to resolve DNS directly
            resolveOverride: '196.46.23.82' // Direct IP from test.js DNS workaround
          }
        });
      } catch (fetchError) {
        console.log('Fetch error details:', {
          name: fetchError.name,
          message: fetchError.message,
          cause: fetchError.cause,
          stack: fetchError.stack
        });
        
        // Try HTTP fallback if HTTPS fails
        if (this.authUrl.startsWith('https://')) {
          const httpUrl = this.authUrl.replace('https://', 'http://');
          console.log(`⚠️  HTTPS failed, trying HTTP fallback: ${httpUrl}`);
          try {
            response = await fetch(httpUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': '',
                'User-Agent': 'SAA-Voyager-Worker/1.0'
              },
              body: soapEnvelope,
              cf: {
                cacheTtl: 0,
                cacheEverything: false
              }
            });
          } catch (httpError) {
            console.log('HTTP fallback also failed:', httpError.message);
            throw new Error(`Both HTTPS and HTTP failed. HTTPS: ${fetchError.message}, HTTP: ${httpError.message}`);
          }
        } else {
        throw fetchError;
        }
      }
      
      console.log('SOAP Response Debug:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      // Handle Cloudflare-specific errors
      if (response.status === 530 || response.status === 1016 || response.status === 520) {
        const responseText = await response.text().catch(() => '');
        console.log(`Cloudflare ${response.status} Error - Origin unreachable`);
        console.log('Error Response Body:', responseText);
        console.log('Error Response Headers:', Object.fromEntries(response.headers.entries()));
        
        // Try HTTP with direct IP if we were using HTTPS
        if (this.authUrl.startsWith('https://')) {
          // Try HTTP with direct IP resolution (DNS workaround from test.js)
          const httpUrl = this.authUrl.replace('https://ilstage.flysaa.com', 'http://196.46.23.82');
          console.log(`⚠️  Trying HTTP with direct IP due to ${response.status} error: ${httpUrl}`);
          try {
            response = await fetch(httpUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': '',
                'User-Agent': 'SAA-Voyager-Worker/1.0',
                'Host': 'ilstage.flysaa.com' // Important: set Host header for IP-based requests
              },
              body: soapEnvelope,
              cf: {
                cacheTtl: 0,
                cacheEverything: false
              }
            });
            console.log(`HTTP with IP fallback response status: ${response.status}`);
            
            // If still failing, provide helpful error message
            if (response.status >= 500 || response.status === 520 || response.status === 530) {
              const errorText = await response.text().catch(() => '');
              throw new Error(`Cloudflare Worker cannot reach UAT server. Status: ${response.status}. This is likely due to network restrictions. Solutions: 1) Use a backend proxy server, 2) Configure UAT server to allow Cloudflare IPs, 3) Use Cloudflare Tunnel. Error: ${errorText || responseText || 'No response body'}`);
            }
          } catch (httpError) {
            console.log('HTTP with IP fallback failed:', httpError.message);
            throw new Error(`Cloudflare Worker network error (${response.status}): Cannot reach UAT server at ilstage.flysaa.com. This indicates the UAT server is blocking Cloudflare Workers or requires IP whitelisting. Solutions: 1) Deploy a backend proxy server (Node.js) that can access UAT, 2) Configure UAT firewall to allow Cloudflare IP ranges, 3) Use Cloudflare Tunnel. Original error: ${responseText || httpError.message}`);
          }
        } else {
          throw new Error(`Cloudflare Worker network error (${response.status}): Cannot reach UAT server. Solutions: 1) Use a backend proxy server, 2) Configure UAT server to allow Cloudflare IPs. Error: ${responseText || 'No response body'}`);
        }
      }
      
      if (!response.ok) {
        const responseText = await response.text();
        console.log('Error Response Body:', responseText);
        console.log('Error Response Headers:', Object.fromEntries(response.headers.entries()));
        
        // For SOAP services, even 500 responses might contain valid SOAP fault information
        // Try to parse it as a SOAP response first
        if (responseText.includes('<soapenv:Envelope>') || responseText.includes('<soap:Envelope>')) {
          console.log('Parsing SOAP fault response...');
          const result = this.parseAuthenticationResponse(responseText);
          if (result && !result.success) {
            return result;
          }
        }
        
        throw new Error(`HTTP ${response.status}: ${response.statusText} - error code: ${response.status === 530 ? '1016' : 'unknown'}`);
      }
      
      const responseText = await response.text();
      log('SOAP response received', { responseLength: responseText.length });
      
      // Parse the XML response
      const result = this.parseAuthenticationResponse(responseText);
      
      if (result.success) {
        const sessionId = this.generateSessionId(username, password);
        try {
          // Use username (membership number) as memberId if not in response
          const memberId = (result.memberId && result.memberId !== 'unknown') ? result.memberId : username;
          console.log(`[AUTH] Setting up session - sessionId: ${sessionId}, memberId: ${memberId}, username: ${username}, sessionToken: ${result.sessionToken ? 'present' : 'missing'}`);
          
          // Check if we have an existing balance for this member
          const existingMemberBalance = this.memberBalances.get(memberId);
          console.log(`[AUTH] Existing member balance check - memberId: ${memberId}, existingBalance: ${existingMemberBalance || 'none'}`);
          
          const sessionData = {
            sessionToken: result.sessionToken,
            transactionId: result.transactionId,
            memberId,
            username
          };
          
          // Store in memory
          this.sessions.set(sessionId, sessionData);
          
          // Also store in KV for persistence across Worker instances
          await this.storeSessionInKV(sessionId, sessionData);
          
          let points;
          if (existingMemberBalance != null) {
            // Use existing member balance (preserves deductions from previous sessions)
            points = existingMemberBalance;
            console.log(`[AUTH] Using existing member balance - memberId: ${memberId}, points: ${points}`);
            this.sessionBalances.set(sessionId, points);
            console.log(`[AUTH] Session balance set from existing member balance - sessionId: ${sessionId}, points: ${points}`);
          } else {
            // No existing balance, fetch from SOAP
            console.log('[AUTH] No existing member balance, fetching initial account summary from SOAP...');
            const summary = await this.fetchAccountSummaryFromSOAP(sessionId);
            
            if (summary.success) {
              points = summary.points;
              console.log(`[AUTH] SOAP account summary success - points: ${points}, sessionId: ${sessionId}, memberId: ${memberId}`);
              this.sessionBalances.set(sessionId, points);
              this.memberBalances.set(memberId, points);
              
              // Store point types for FEFO logic
              if (summary.pointTypes && summary.pointTypes.length > 0) {
                const session = this.sessions.get(sessionId);
                if (session) {
                  session.pointTypes = summary.pointTypes;
                  await this.storeSessionInKV(sessionId, session);
                  console.log(`[AUTH] Stored ${summary.pointTypes.length} point types for FEFO logic`);
                }
              }
              
              console.log(`[AUTH] Balance stored - sessionBalance: ${this.sessionBalances.get(sessionId)}, memberBalance: ${this.memberBalances.get(memberId)}, memberId: ${memberId}`);
            } else {
              // Do not fabricate balances; leave caches unset. Account summary can populate later.
              console.log(`[AUTH] SOAP account summary failed, no existing member balance to use - error: ${summary.message || 'unknown'}, sessionId: ${sessionId}, memberId: ${memberId}`);
            }
          }
        } catch (error) {
          const memberId = (result.memberId && result.memberId !== 'unknown') ? result.memberId : username;
          console.log(`[AUTH] Exception during balance initialization - error: ${error.message}, sessionId: ${sessionId}, memberId: ${memberId}`);
          
          // Check for existing member balance even in error case
          const existingMemberBalance = this.memberBalances.get(memberId);
          const points = existingMemberBalance != null ? existingMemberBalance : undefined;
          
          if (points != null) {
            this.sessionBalances.set(sessionId, points);
            this.memberBalances.set(memberId, points);
            console.log(`[AUTH] Fallback balance stored - sessionBalance: ${this.sessionBalances.get(sessionId)}, memberBalance: ${this.memberBalances.get(memberId)}, memberId: ${memberId}, usedExisting: ${existingMemberBalance != null}`);
          } else {
            console.log(`[AUTH] No existing balance available; will require SOAP on account-summary - memberId: ${memberId}`);
          }
        }
        return {
          success: true,
          sessionId: sessionId,
          memberId: (result.memberId && result.memberId !== 'unknown') ? result.memberId : username,
          message: 'Authentication successful'
        };
      } else {
        return {
          success: false,
          message: result.message || 'Invalid credentials'
        };
      }
    } catch (error) {
      log('SOAP authentication error:', error);
      
      // Provide user-friendly error messages
      let userMessage = 'Authentication failed';
      let errorCode = 'AUTH_ERROR';
      
      if (error.message.includes('530') || error.message.includes('1016') || error.message.includes('520')) {
        userMessage = 'Unable to connect to Voyager service. Please try again later or contact support.';
        errorCode = 'NETWORK_ERROR';
        log('⚠️  Cloudflare Worker cannot reach UAT server. Consider using a backend proxy server.');
      } else if (error.message.includes('network') || error.message.includes('unreachable')) {
        userMessage = 'Service temporarily unavailable. Please try again in a few moments.';
        errorCode = 'SERVICE_UNAVAILABLE';
      } else {
        userMessage = error.message || 'Authentication failed. Please check your credentials.';
      }
      
      return {
        success: false,
        message: userMessage,
        errorCode: errorCode,
        technicalDetails: process.env.NODE_ENV === 'development' ? error.message : undefined
      };
    }
  }

  async getAccountSummary(sessionId) {
    if (this.mockMode) {
      await this.simulateMockLatency('getAccountSummary');
      if (!this.validateSession(sessionId)) {
        return {
          success: false,
          message: 'Invalid or expired session'
        };
      }
      const current = this.sessionBalances.get(sessionId);
      const points = Number.isFinite(current) ? current : this.mockPoints;
      if (!Number.isFinite(current)) {
        this.sessionBalances.set(sessionId, points);
      }
      return {
        success: true,
        points,
        message: 'Points balance retrieved successfully (mock)'
      };
    }
    console.log(`[ACCOUNT-SUMMARY] Request received - sessionId: ${sessionId}`);
    
    if (!this.validateSession(sessionId)) {
      console.log(`[ACCOUNT-SUMMARY] Invalid session: ${sessionId}`);
      return {
        success: false,
        status: 401,
        message: 'Invalid or expired session'
      };
    }

    let points = this.sessionBalances.get(sessionId);
    const session = await this.getSession(sessionId);
    const memberId = session?.memberId;
    
    const memberBalance = memberId ? this.memberBalances.get(memberId) : undefined;
    console.log(`[ACCOUNT-SUMMARY] Current state - sessionId: ${sessionId}, memberId: ${memberId || 'none'}, sessionExists: ${!!session}, sessionBalance: ${points || 'null'}, memberBalance: ${memberBalance || 'none'}, hasSessionBalance: ${this.sessionBalances.has(sessionId)}, hasMemberBalance: ${memberId ? this.memberBalances.has(memberId) : false}`);

    if (points == null) {
      // First check if we have an existing member balance to use
      if (memberId && this.memberBalances.has(memberId)) {
        points = this.memberBalances.get(memberId);
        console.log(`[ACCOUNT-SUMMARY] Using existing member balance - points: ${points}, memberId: ${memberId}`);
        this.sessionBalances.set(sessionId, points);
        console.log(`[ACCOUNT-SUMMARY] Session balance set from existing member balance - sessionId: ${sessionId}, points: ${points}`);
      } else {
        console.log(`[ACCOUNT-SUMMARY] No session or member balance found, fetching from SOAP for sessionId: ${sessionId}`);
        const summary = await this.fetchAccountSummaryFromSOAP(sessionId);
        
        if (summary.success) {
          points = summary.points;
          console.log(`[ACCOUNT-SUMMARY] SOAP fetch success - points: ${points}, sessionId: ${sessionId}, memberId: ${memberId || 'none'}`);
          this.sessionBalances.set(sessionId, points);
          console.log(`[ACCOUNT-SUMMARY] Session balance set - sessionId: ${sessionId}, points: ${points}`);
          if (memberId) {
            this.memberBalances.set(memberId, points);
            console.log(`[ACCOUNT-SUMMARY] Member balance set - memberId: ${memberId}, points: ${points}`);
          }
          
          // Store point types for FEFO logic
          if (summary.pointTypes && summary.pointTypes.length > 0) {
            const session = await this.getSession(sessionId);
            if (session) {
              session.pointTypes = summary.pointTypes;
              this.sessions.set(sessionId, session);
              await this.storeSessionInKV(sessionId, session);
              console.log(`[ACCOUNT-SUMMARY] Stored ${summary.pointTypes.length} point types for FEFO logic`);
            }
          }
        } else {
          // Cannot provide a real balance
          console.log(`[ACCOUNT-SUMMARY] SOAP fetch failed and no cached balance - sessionId: ${sessionId}, memberId: ${memberId || 'none'}, error: ${summary.message || 'unknown'}`);
          return {
            success: false,
            status: 502,
            message: 'Account summary unavailable'
          };
        }
      }
    } else {
      console.log(`[ACCOUNT-SUMMARY] Using cached session balance - sessionId: ${sessionId}, points: ${points}`);
      // If we have a memberId but member balance doesn't match, update it
      if (memberId && this.memberBalances.get(memberId) !== points) {
        this.memberBalances.set(memberId, points);
        console.log(`[ACCOUNT-SUMMARY] Member balance updated to match session balance - memberId: ${memberId}, points: ${points}`);
      }
    }

    if (memberId && !this.memberBalances.has(memberId)) {
      this.memberBalances.set(memberId, points);
      console.log(`[ACCOUNT-SUMMARY] Member balance initialized from session - memberId: ${memberId}, points: ${points}`);
    }

    console.log(`[ACCOUNT-SUMMARY] Returning balance - sessionId: ${sessionId}, memberId: ${memberId || 'none'}, points: ${points}`);
    return {
      success: true,
      points,
      message: 'Points balance retrieved successfully'
    };
  }

  async issueCertificate(sessionId, points, orderId) {
    if (this.mockMode) {
      await this.simulateMockLatency('issueCertificate');
      if (!this.validateSession(sessionId)) {
        return {
          success: false,
          message: 'Invalid or expired session'
        };
      }
      const use = Math.max(0, parseInt(points, 10) || 0);
      const current = this.sessionBalances.get(sessionId) ?? this.mockPoints;
      const remaining = Math.max(0, current - use);
      this.sessionBalances.set(sessionId, remaining);
      const session = this.sessions.get(sessionId);
      const memberId = session?.memberId;
      if (memberId) {
        this.memberBalances.set(memberId, remaining);
      }
      return {
        success: true,
        certificateId: `mock-cert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message: 'Certificate issued successfully (mock)',
        pointsUsed: use,
        remainingPoints: remaining
      };
    }
    
    // Validate session first
    if (!this.validateSession(sessionId)) {
      return {
        success: false,
        message: 'Invalid or expired session'
      };
    }

    const session = await this.getSession(sessionId);
    if (!session) {
      return {
        success: false,
        message: 'Session not found'
      };
    }

    const memberId = session.memberId;
    const sessionToken = session.sessionToken;
    const timestamp = new Date().toISOString();

    // Use FEFO logic to select which point type to deduct from
    let selectedPointType = null;
    if (session.pointTypes && session.pointTypes.length > 0) {
      const selected = this.selectPointTypeForDeduction(session.pointTypes, points);
      if (selected) {
        selectedPointType = selected.pointType;
        log('[ISSUE-CERT] FEFO selected point type:', {
          pointType: selected.pointType,
          availablePoints: selected.points,
          expiryDate: selected.expiryDate,
          pointsToDeduct: points
        });
      } else {
        log('[ISSUE-CERT] FEFO: No suitable point type found or insufficient balance');
        return {
          success: false,
          message: 'Insufficient points in point types with expiry dates'
        };
      }
    }

    log('[ISSUE-CERT] Starting certificate issuance', { 
      sessionId, 
      memberId, 
      points, 
      orderId,
      selectedPointType,
      hasSessionToken: !!sessionToken 
    });

    try {
      // Use configured endpoint (UAT or production based on worker config)
      // For production, use: 'http://iflyloyalty.flysaa.com/saa-ws/services/IssueCertificateService'
      // For UAT, use: this.issueUrl (already configured)
      const issueUrl = this.isUAT ? this.issueUrl : 'http://iflyloyalty.flysaa.com/saa-ws/services/IssueCertificateService';
      
      // WS-Security credentials (UAT or production based on config)
      const created = '2050-12-31T10:33:52.303Z';
      const nonceB64 = this.isUAT ? 'MTY4NjExNjA4MQ==' : '5lXRolFB0oWSOjRgioe4DA==';
      const passwordDigestB64 = this.isUAT ? 'RxjWNeJegwDTtbGW0Q2FFBCnQ3A=' : 'Iwo5n9AqZVNpvY/2Q0+/SJjcUK4=';
      
      // Construct SOAP request (UAT uses WS-Security, production may not)
      const soapHeader = this.isUAT ? `<soapenv:Header>
      <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"> 
         <wsu:Timestamp wsu:Id="Timestamp-2" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"> 
            <wsu:Created>${created}</wsu:Created>
            <wsu:Expires>${created}</wsu:Expires>
         </wsu:Timestamp>
         <wsse:UsernameToken wsu:Id="UsernameToken-20914066" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"> 
            <wsse:Username>wom</wsse:Username>
            <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigestB64}</wsse:Password>
            <wsse:Nonce>${nonceB64}</wsse:Nonce>
            <wsu:Created>${created}</wsu:Created>
         </wsse:UsernameToken>
      </wsse:Security>
   </soapenv:Header>` : `<soapenv:Header/>`;
      
      const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:type="http://www.ibsplc.com/iloyal/redemption/issuecertificate/type/">
   ${soapHeader}
   <soapenv:Body>
      <type:IssueCertificateRequest>
         <certificate>
            <companyCode>SA</companyCode>
            <programCode>VOYAG</programCode>
            <partnerCode>WOM</partnerCode>
            <rewardCode>WMDYRD</rewardCode>
            <rewardGroup>L</rewardGroup>
            <rewardDiscount>0</rewardDiscount>
            <membershipNumber>${memberId}</membershipNumber>
            <title></title>
            <givenName>TEST</givenName>
            <familyName>USER</familyName>
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
               <pointsCollected>${points}</pointsCollected>
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
            <transactionID>${sessionToken || ''}</transactionID>
            <userName>wom</userName>
            <timeStamp>${timestamp}</timeStamp>
         </txnHeader>
      </type:IssueCertificateRequest>
   </soapenv:Body>
</soapenv:Envelope>`;

      log('[ISSUE-CERT] Making SOAP request', { 
        url: issueUrl, 
        requestLength: soapEnvelope.length,
        memberId,
        points 
      });

      const response = await fetch(issueUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://www.ibsplc.com/iloyal/redemption/issuecertificate/wsdl/IssueCertificate/IssueCertificateRequest',
          'User-Agent': 'SAA-Voyager-Worker/1.0'
        },
        body: soapEnvelope,
        cf: {
          cacheTtl: 0,
          cacheEverything: false
        }
      });

      const responseText = await response.text();
      log('[ISSUE-CERT] SOAP response received', { 
        status: response.status, 
        responseLength: responseText.length 
      });

      if (!response.ok) {
        log('[ISSUE-CERT] HTTP error', { 
          status: response.status, 
          statusText: response.statusText,
          responseText: responseText.substring(0, 2000)
        });
        
        // Try to parse SOAP fault even on HTTP error
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let hasSpecificError = false; // Flag to track if we found a specific nested error
        if (responseText.length > 0) {
          // Log full response for debugging first
          console.log('[ISSUE-CERT] Full SOAP fault response:', responseText);
          
          // Try to extract RewardWebServiceException structure
          // RewardWebServiceException has: faultcode, faultstring, faultdata
          let faultStringMatch = null;
          let faultCodeMatch = null;
          let faultDataMatch = null;
          
          // Pattern 4 FIRST: In detail/RewardWebServiceException (with namespace prefix like ns4:)
          // This is the most specific error and should be checked first
          // Check this FIRST because nested errors are more specific than outer faultstring
          const detailMatch = responseText.match(/<detail[^>]*>([\s\S]*?)<\/detail>/i);
          if (detailMatch) {
            const detailBody = detailMatch[1];
            console.log('[ISSUE-CERT] Detail body found, length:', detailBody.length);
            // Match RewardWebServiceException with any namespace prefix (ns4:, ns:, etc.)
            // Try multiple patterns to handle different namespace formats
            // Pattern 1: With namespace prefix (ns4:, ns:, etc.) - most common
            let rewardExceptionMatch = detailBody.match(/<[^:>]*:RewardWebServiceException[^>]*>([\s\S]*?)<\/[^:>]*:RewardWebServiceException>/i);
            if (!rewardExceptionMatch) {
              // Pattern 2: Without namespace prefix
              rewardExceptionMatch = detailBody.match(/<RewardWebServiceException[^>]*>([\s\S]*?)<\/RewardWebServiceException>/i);
            }
            if (!rewardExceptionMatch) {
              // Pattern 3: Explicit ns4: prefix (from actual logs)
              rewardExceptionMatch = detailBody.match(/<ns4:RewardWebServiceException[^>]*>([\s\S]*?)<\/ns4:RewardWebServiceException>/i);
            }
            if (!rewardExceptionMatch) {
              // Pattern 4: More flexible - match any tag ending with RewardWebServiceException
              rewardExceptionMatch = detailBody.match(/<[^>]*RewardWebServiceException[^>]*>([\s\S]*?)<\/[^>]*RewardWebServiceException>/i);
            }
            
            if (rewardExceptionMatch) {
              const exceptionBody = rewardExceptionMatch[1];
              console.log('[ISSUE-CERT] RewardWebServiceException found, body length:', exceptionBody.length);
              // Extract nested faultcode and faultstring from RewardWebServiceException
              // The nested faultcode is the actual specific error (more important than outer faultstring)
              const nestedFaultCodeMatch = exceptionBody.match(/<faultcode[^>]*>([^<]+)<\/faultcode>/i);
              const nestedFaultStringMatch = exceptionBody.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/i);
              
              console.log('[ISSUE-CERT] Nested faultcode match:', nestedFaultCodeMatch ? nestedFaultCodeMatch[1] : 'none');
              
              if (nestedFaultCodeMatch) {
                // Use the nested faultcode as the primary error message (it's the specific error)
                const nestedFaultCode = nestedFaultCodeMatch[1].trim();
                errorMessage = `SOAP Fault: ${nestedFaultCode}`;
                if (nestedFaultStringMatch && nestedFaultStringMatch[1].trim() !== nestedFaultCode) {
                  errorMessage += ` (${nestedFaultStringMatch[1].trim()})`;
                }
                faultDataMatch = exceptionBody.match(/<faultdata[^>]*>([^<]+)<\/faultdata>/i);
                if (faultDataMatch) {
                  if (Array.isArray(faultDataMatch)) {
                    errorMessage += ` [Data: ${faultDataMatch.join(', ')}]`;
                  } else {
                    errorMessage += ` [Data: ${faultDataMatch[1].trim()}]`;
                  }
                }
                // Mark that we have a specific error and skip generic error building
                hasSpecificError = true;
                faultStringMatch = { 1: nestedFaultCode };
                faultCodeMatch = nestedFaultCodeMatch;
                console.log('[ISSUE-CERT] Using specific nested error:', errorMessage);
              } else {
                // Fallback to standard extraction
                faultStringMatch = nestedFaultStringMatch;
                faultCodeMatch = nestedFaultCodeMatch;
                faultDataMatch = exceptionBody.match(/<faultdata[^>]*>([^<]+)<\/faultdata>/i);
              }
            } else {
              console.log('[ISSUE-CERT] RewardWebServiceException not found in detail body');
            }
          }
          
          // Pattern 5: Try to find any faultstring anywhere in the response (last resort)
          if (!faultStringMatch) {
            // Look for faultstring with any namespace prefix
            faultStringMatch = responseText.match(/<(?:[^:>]+:)?faultstring[^>]*>([^<]+)<\/(?:[^:>]+:)?faultstring>/i);
          }
          
          // Also try to extract all faultdata elements (can be multiple)
          if (!faultDataMatch) {
            const allFaultData = responseText.match(/<faultdata[^>]*>([^<]+)<\/faultdata>/gi);
            if (allFaultData && allFaultData.length > 0) {
              faultDataMatch = allFaultData.map(m => m.match(/<faultdata[^>]*>([^<]+)<\/faultdata>/i)?.[1]).filter(Boolean);
            }
          }
          
          // Build error message (only if we haven't already set a specific error)
          if (!hasSpecificError && faultStringMatch) {
            const faultString = faultStringMatch[1].trim();
            errorMessage = `SOAP Fault: ${faultString}`;
            if (faultCodeMatch) {
              errorMessage += ` [Code: ${faultCodeMatch[1].trim()}]`;
            }
            if (faultDataMatch) {
              if (Array.isArray(faultDataMatch)) {
                errorMessage += ` [Data: ${faultDataMatch.join(', ')}]`;
              } else {
                errorMessage += ` [Data: ${faultDataMatch[1].trim()}]`;
              }
            }
          } else if (!hasSpecificError) {
            // If we can't parse, include raw response snippet
            // Try to find any text content that might be an error message
            const bodyMatch = responseText.match(/<soapenv:Body[^>]*>([\s\S]*?)<\/soapenv:Body>/i);
            if (bodyMatch) {
              const bodyContent = bodyMatch[1];
              // Look for any text content that might indicate an error
              const textContent = bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (textContent.length > 0 && textContent.length < 500) {
                errorMessage += ` - ${textContent}`;
              } else {
                errorMessage += ` - Response preview: ${responseText.substring(0, 1000)}`;
              }
            } else {
              errorMessage += ` - Response preview: ${responseText.substring(0, 1000)}`;
            }
          }
        }
        
        return {
          success: false,
          message: errorMessage,
          status: response.status,
          responseText: responseText.substring(0, 1000) // Include response for debugging
        };
      }

      if (responseText.length === 0) {
        log('[ISSUE-CERT] Empty response received', { 
          status: response.status,
          url: issueUrl 
        });
        return {
          success: false,
          message: 'Empty response from IssueCertificate service',
          status: response.status
        };
      }

      // Check for SOAP faults even if HTTP status is OK (some services return 200 with SOAP faults)
      if (responseText.includes('<fault>') || responseText.includes('<soap:Fault>') || responseText.includes('<soapenv:Fault>')) {
        log('[ISSUE-CERT] SOAP fault detected in response (even though HTTP status was OK)');
        
        // Enhanced error parsing (matching test.js logic)
        let errorMessage = 'SOAP fault occurred';
        let hasSpecificError = false;
        
        const detailMatch = responseText.match(/<detail[^>]*>([\s\S]*?)<\/detail>/i);
        if (detailMatch) {
          const detailBody = detailMatch[1];
          log('[ISSUE-CERT] Detail body found, length:', detailBody.length);
          
          // Match RewardWebServiceException with any namespace prefix (ns4:, ns:, etc.)
          let rewardExceptionMatch = detailBody.match(/<[^:>]*:RewardWebServiceException[^>]*>([\s\S]*?)<\/[^:>]*:RewardWebServiceException>/i);
          if (!rewardExceptionMatch) {
            rewardExceptionMatch = detailBody.match(/<RewardWebServiceException[^>]*>([\s\S]*?)<\/RewardWebServiceException>/i);
          }
          if (!rewardExceptionMatch) {
            rewardExceptionMatch = detailBody.match(/<ns4:RewardWebServiceException[^>]*>([\s\S]*?)<\/ns4:RewardWebServiceException>/i);
          }
          if (!rewardExceptionMatch) {
            rewardExceptionMatch = detailBody.match(/<[^>]*RewardWebServiceException[^>]*>([\s\S]*?)<\/[^>]*RewardWebServiceException>/i);
          }
          
          if (rewardExceptionMatch) {
            const exceptionBody = rewardExceptionMatch[1];
            log('[ISSUE-CERT] RewardWebServiceException found, body length:', exceptionBody.length);
            
            // Extract nested faultcode and faultstring from RewardWebServiceException
            const nestedFaultCodeMatch = exceptionBody.match(/<faultcode[^>]*>([^<]+)<\/faultcode>/i);
            const nestedFaultStringMatch = exceptionBody.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/i);
            
            log('[ISSUE-CERT] Nested faultcode match:', nestedFaultCodeMatch ? nestedFaultCodeMatch[1] : 'none');
            
            if (nestedFaultCodeMatch) {
              // Use the nested faultcode as the primary error message (it's the specific error)
              const nestedFaultCode = nestedFaultCodeMatch[1].trim();
              errorMessage = `SOAP Fault: ${nestedFaultCode}`;
              if (nestedFaultStringMatch && nestedFaultStringMatch[1].trim() !== nestedFaultCode) {
                errorMessage += ` (${nestedFaultStringMatch[1].trim()})`;
              }
              hasSpecificError = true;
              log('[ISSUE-CERT] Using specific nested error:', errorMessage);
            }
          } else {
            log('[ISSUE-CERT] RewardWebServiceException not found in detail body');
          }
        }
        
        // Fallback to standard fault parsing if no specific error found
        if (!hasSpecificError) {
          const faultStringMatch = responseText.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/i);
          const faultCodeMatch = responseText.match(/<faultcode[^>]*>([^<]+)<\/faultcode>/i);
          
          if (faultStringMatch) {
            errorMessage = `SOAP Fault: ${faultStringMatch[1].trim()}`;
            if (faultCodeMatch) {
              errorMessage += ` [Code: ${faultCodeMatch[1].trim()}]`;
            }
          } else {
            errorMessage = 'Unknown SOAP fault';
          }
        }
        
        log('[ISSUE-CERT] SOAP fault error message:', errorMessage);
        return {
          success: false,
          message: errorMessage,
          status: response.status
        };
      }

      // Parse successful response to extract certificate details
      log('[ISSUE-CERT] Parsing successful response');
      const certificateNumberMatch = responseText.match(/<certificateNumber[^>]*>([^<]+)<\/certificateNumber>/i);
      const statusMatch = responseText.match(/<status[^>]*>([^<]+)<\/status>/i);
      const pointsRedeemedMatch = responseText.match(/<totalRedeemedpoints[^>]*>([^<]+)<\/totalRedeemedpoints>/i);
      const remainingBalanceMatch = responseText.match(/<remainingBalance[^>]*>([^<]+)<\/remainingBalance>/i);
      
      const certificateId = certificateNumberMatch ? certificateNumberMatch[1].trim() : `cert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const status = statusMatch ? statusMatch[1].trim() : 'unknown';
      const pointsRedeemed = pointsRedeemedMatch ? parseFloat(pointsRedeemedMatch[1]) : points;
      const remainingBalance = remainingBalanceMatch ? parseFloat(remainingBalanceMatch[1]) : null;

      log('[ISSUE-CERT] Certificate issued successfully', { 
        certificateId, 
        status, 
        pointsRedeemed,
        remainingBalance: remainingBalance !== null ? remainingBalance : 'not in response'
      });

      // Update balances after successful redemption
      // Prefer remainingBalance from response if available, otherwise calculate
      const current = this.sessionBalances.get(sessionId);
      let remaining;
      
      if (remainingBalance !== null) {
        // Use the remaining balance from the SOAP response (most accurate)
        remaining = remainingBalance;
        log('[ISSUE-CERT] Using remaining balance from SOAP response:', remaining);
      } else if (current != null) {
        // Calculate remaining balance if not in response
        remaining = Math.max(0, current - pointsRedeemed);
        log('[ISSUE-CERT] Calculated remaining balance:', remaining, 'from current:', current, 'minus pointsRedeemed:', pointsRedeemed);
      } else {
        // If we don't have current balance, try to fetch from account summary
        log('[ISSUE-CERT] No current balance available, fetching from account summary...');
        const summary = await this.fetchAccountSummaryFromSOAP(sessionId);
        if (summary.success && summary.points != null) {
          remaining = Math.max(0, summary.points - pointsRedeemed);
          log('[ISSUE-CERT] Fetched balance from account summary, calculated remaining:', remaining);
        } else {
          // Last resort: use pointsRedeemed as estimate (shouldn't happen in production)
          remaining = null;
          log('[ISSUE-CERT] WARNING: Could not determine remaining balance');
        }
      }
      
      if (remaining !== null) {
        this.sessionBalances.set(sessionId, remaining);
        if (memberId) {
          this.memberBalances.set(memberId, remaining);
        }
        log('[ISSUE-CERT] Balance updated', { 
          sessionId, 
          memberId, 
          oldBalance: current, 
          pointsRedeemed, 
          newBalance: remaining 
        });
      }

      return {
        success: true,
        certificateId: certificateId,
        message: 'Certificate issued successfully',
        pointsUsed: pointsRedeemed,
        remainingPoints: remaining !== null ? remaining : this.sessionBalances.get(sessionId)
      };

    } catch (error) {
      log('[ISSUE-CERT] Error during certificate issuance', { 
        error: error.message, 
        stack: error.stack 
      });
      return {
        success: false,
        message: `Failed to issue certificate: ${error.message}`
      };
    }
  }

  async markCertificateAsUsed(sessionId, certificateId) {
    if (this.mockMode) {
      await this.simulateMockLatency('markCertificateAsUsed');
      return {
        success: true,
        message: 'Certificate marked as used (mock)'
      };
    }
    // Validate session first
    if (!this.validateSession(sessionId)) {
      return {
        success: false,
        message: 'Invalid or expired session'
      };
    }

    // Mock certificate marking
    return {
      success: true,
      message: 'Certificate marked as used'
    };
  }

  async recreditPoints(sessionId, points, reason) {
    // Validate session first
    if (!this.validateSession(sessionId)) {
      return {
        success: false,
        message: 'Invalid or expired session'
      };
    }

    if (!this.mockMode) {
    return {
      success: true,
      message: 'Points recredited successfully'
      };
    }

    await this.simulateMockLatency('recreditPoints');
    // Mock points recredit (restore points to session balance)
    const current = this.sessionBalances.get(sessionId) ?? this.mockPoints;
    const delta = Math.max(0, parseInt(points, 10) || 0);
    const updated = current + delta;
    this.sessionBalances.set(sessionId, updated);
    const session = this.sessions.get(sessionId);
    const memberId = session?.memberId;
    if (memberId) {
      this.memberBalances.set(memberId, updated);
    }
    return {
      success: true,
      message: 'Points recredited successfully (mock)',
      pointsRestored: delta,
      remainingPoints: updated
    };
  }

  // Parse SOAP authentication response
  parseAuthenticationResponse(xmlResponse) {
    try {
      if (xmlResponse.includes('<fault>') || xmlResponse.includes('<soap:Fault>') || xmlResponse.includes('<soapenv:Fault>')) {
        // Parse specific fault details
        let errorMessage = 'SOAP fault occurred';
        let errorCode = 'unknown';
        
        // Extract fault code
        const faultCodeMatch = xmlResponse.match(/<faultcode[^>]*>([^<]+)<\/faultcode>/);
        if (faultCodeMatch) {
          errorCode = faultCodeMatch[1];
        }
        
        // Extract fault string
        const faultStringMatch = xmlResponse.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/);
        if (faultStringMatch) {
          errorMessage = faultStringMatch[1];
        }
        
        // Check for specific member service exceptions
        if (xmlResponse.includes('MemberWebServiceException')) {
          // Look for the nested fault codes inside MemberWebServiceException
          const memberFaultCodeMatch = xmlResponse.match(/<ns2:MemberWebServiceException[^>]*>[\s\S]*?<faultcode[^>]*>([^<]+)<\/faultcode>/);
          const memberFaultStringMatch = xmlResponse.match(/<ns2:MemberWebServiceException[^>]*>[\s\S]*?<faultstring[^>]*>([^<]+)<\/faultstring>/);
          
          if (memberFaultCodeMatch) {
            errorCode = memberFaultCodeMatch[1];
          }
          if (memberFaultStringMatch) {
            errorMessage = memberFaultStringMatch[1];
          }
        }
        
        // Handle specific known errors
        if (errorCode.includes('LoginBlockedToChangeSystemGeneratedPin')) {
          errorMessage = 'Account blocked: Please change your system-generated PIN before logging in';
        } else if (errorCode.includes('InvalidCredentials')) {
          errorMessage = 'Invalid username or password';
        } else if (errorCode.includes('AccountLocked')) {
          errorMessage = 'Account is locked due to multiple failed login attempts';
        }
        
        return {
          success: false,
          message: errorMessage,
          errorCode: errorCode
        };
      }
      
      // Look for success indicators
      if (xmlResponse.includes('<status>true</status>') || 
          xmlResponse.includes('<success>true</success>') || 
          xmlResponse.includes('<success>1</success>')) {
        
        // Extract transaction token and transaction ID (matching test.js)
        let sessionToken = null;
        let transactionId = null;
        const tokenMatch = xmlResponse.match(/<transactionToken[^>]*>(.*?)<\/transactionToken>/);
        const transactionMatch = xmlResponse.match(/<transactionID[^>]*>([^<]+)<\/transactionID>/);
        if (tokenMatch) {
          sessionToken = tokenMatch[1].trim();
        }
        if (transactionMatch) {
          transactionId = transactionMatch[1].trim();
        }
        // Use transactionID as sessionToken if transactionToken is not available
        if (!sessionToken && transactionId) {
          sessionToken = transactionId;
        }
        
        // Extract membership number as member ID
        // Note: The membership number might not be in the response, so we'll use the username parameter
        let memberId = null;
        const membershipMatch = xmlResponse.match(/<membershipNumber[^>]*>([^<]+)<\/membershipNumber>/);
        if (membershipMatch) {
          memberId = membershipMatch[1].trim();
        }
        
        if (sessionToken || transactionId) {
          return {
            success: true,
            sessionToken: sessionToken || transactionId,
            transactionId: transactionId || sessionToken,
            memberId: memberId // Will be set from username parameter if not in response
          };
        } else {
          return {
            success: false,
            message: 'Authentication succeeded but missing transaction data'
          };
        }
      }
      
      // Look for failure indicators
      if (xmlResponse.includes('<status>false</status>') ||
          xmlResponse.includes('<success>false</success>') || 
          xmlResponse.includes('<success>0</success>')) {
        
        let errorMessage = 'Authentication failed';
        const errorMatch = xmlResponse.match(/<message[^>]*>([^<]+)<\/message>/);
        if (errorMatch) {
          errorMessage = errorMatch[1];
        }
        
        return {
          success: false,
          message: errorMessage
        };
      }
      
      return {
        success: false,
        message: 'Unable to parse authentication response'
      };
      
    } catch (error) {
      log('XML parsing error:', error);
      return {
        success: false,
        message: 'Failed to parse response'
      };
    }
  }

  parseAccountSummaryResponse(xmlResponse) {
    try {
      log('[SOAP-PARSE] Parsing account summary response, length:', xmlResponse.length);
      
      const trimmedResponse = xmlResponse.trimStart();
      
      // Check for SOAP faults first
      if (trimmedResponse.includes('<fault>') || trimmedResponse.includes('<soap:Fault>') || trimmedResponse.includes('<soapenv:Fault>')) {
        let errorMessage = 'SOAP fault occurred';
        let errorCode = 'unknown';
        const faultStringMatch = trimmedResponse.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/i);
        if (faultStringMatch) {
          errorMessage = faultStringMatch[1];
        }
        const faultCodeMatch = trimmedResponse.match(/<faultcode[^>]*>([^<]+)<\/faultcode>/i);
        if (faultCodeMatch) {
          errorCode = faultCodeMatch[1];
        }
        log('[SOAP-PARSE] SOAP fault detected:', { errorMessage, errorCode });
        return { success: false, message: `${errorMessage} (${errorCode})` };
      }
      
      // Account summary response doesn't have <success> tags - it just has data
      // Check if we have account data (membership number or point details)
      const hasMembershipNumber = trimmedResponse.match(/<membershipNumber[^>]*>([^<]+)<\/membershipNumber>/i);
      const hasPointDetails = trimmedResponse.match(/<pointDetails[^>]*>/i);
      
      if (!hasMembershipNumber && !hasPointDetails) {
        log('[SOAP-PARSE] No account data found in response');
        return { success: false, message: 'No account data found in response' };
      }
      
      // Parse all point types with expiry dates for FEFO (First Expiry, First Out) logic
      const pointTypesWithExpiry = new Map(); // Map<pointType, {points, expiryDate}>
      let totalPoints = 0;
      
      // First, check pointDetails sections for points with expiry dates
      const pointDetailsMatches = trimmedResponse.match(/<pointDetails[^>]*>([\s\S]*?)<\/pointDetails>/gi);
      if (pointDetailsMatches && pointDetailsMatches.length > 0) {
        for (const pointDetailSection of pointDetailsMatches) {
          const pointTypeMatch = pointDetailSection.match(/<pointType[^>]*>(.*?)<\/pointType>/i);
          const pointsMatch = pointDetailSection.match(/<points[^>]*>(.*?)<\/points>/i);
          const expiryDateMatch = pointDetailSection.match(/<expiryDate[^>]*>(.*?)<\/expiryDate>/i);
          
          if (pointTypeMatch && pointsMatch) {
            const pointType = pointTypeMatch[1].trim();
            const pointValue = parseFloat(pointsMatch[1]) || 0;
            const expiryDate = expiryDateMatch && expiryDateMatch[1].trim() && expiryDateMatch[1].trim() !== 'null' 
              ? expiryDateMatch[1].trim() 
              : null;
            
            // Store point type with expiry date
            if (expiryDate) {
              if (!pointTypesWithExpiry.has(pointType)) {
                pointTypesWithExpiry.set(pointType, { points: 0, expiryDate });
              }
              pointTypesWithExpiry.get(pointType).points += pointValue;
              totalPoints += pointValue;
              log('[SOAP-PARSE] Added points with expiry:', { pointType, points: pointValue, expiryDate, runningTotal: totalPoints });
            }
          }
        }
      }
      
      // Also check expiryDetails sections (separate section specifically for expiry info)
      const expiryDetailsMatches = trimmedResponse.match(/<expiryDetails[^>]*>([\s\S]*?)<\/expiryDetails>/gi);
      if (expiryDetailsMatches && expiryDetailsMatches.length > 0) {
        for (const expiryDetailSection of expiryDetailsMatches) {
          const pointTypeMatch = expiryDetailSection.match(/<pointType[^>]*>(.*?)<\/pointType>/i);
          const pointsMatch = expiryDetailSection.match(/<points[^>]*>(.*?)<\/points>/i);
          const expiryDateMatch = expiryDetailSection.match(/<expiryDate[^>]*>(.*?)<\/expiryDate>/i);
          
          if (pointTypeMatch && pointsMatch && expiryDateMatch) {
            const pointType = pointTypeMatch[1].trim();
            const pointValue = parseFloat(pointsMatch[1]) || 0;
            const expiryDate = expiryDateMatch[1].trim();
            
            // Only add if we haven't already counted this point type from pointDetails
            // (expiryDetails might duplicate pointDetails, so we dedupe by pointType)
            if (expiryDate && expiryDate !== 'null') {
              if (!pointTypesWithExpiry.has(pointType)) {
                pointTypesWithExpiry.set(pointType, { points: 0, expiryDate });
              }
              // Use the expiry date from expiryDetails (more accurate)
              pointTypesWithExpiry.get(pointType).expiryDate = expiryDate;
              pointTypesWithExpiry.get(pointType).points += pointValue;
              totalPoints += pointValue;
              log('[SOAP-PARSE] Added points from expiryDetails:', { pointType, points: pointValue, expiryDate, runningTotal: totalPoints });
            }
          }
        }
      }
      
      let points = totalPoints;
      
      // If no points with expiry dates found, fall back to PURCH points only
      if (points === 0) {
        log('[SOAP-PARSE] No points with expiry dates found, falling back to PURCH points');
        if (pointDetailsMatches && pointDetailsMatches.length > 0) {
          for (const pointDetailSection of pointDetailsMatches) {
            const pointTypeMatch = pointDetailSection.match(/<pointType[^>]*>(.*?)<\/pointType>/i);
            const pointsMatch = pointDetailSection.match(/<points[^>]*>(.*?)<\/points>/i);
            
            if (pointTypeMatch && pointTypeMatch[1].trim() === 'PURCH' && pointsMatch) {
              points = parseFloat(pointsMatch[1]) || 0;
              log('[SOAP-PARSE] Found PURCH points (fallback):', { points, match: pointsMatch[1] });
              break;
            }
          }
        }
      }
      
      // If still no points, try totalPoints
      if (points === 0) {
        const totalPointsMatch = trimmedResponse.match(/<totalPoints[^>]*>([^<]+)<\/totalPoints>/i);
        if (totalPointsMatch) {
          points = parseFloat(totalPointsMatch[1]) || 0;
          log('[SOAP-PARSE] Found totalPoints (fallback):', { points, match: totalPointsMatch[1] });
        }
      }
      
      // If still no points, try availablePoints
      if (points === 0) {
        const availableMatch = trimmedResponse.match(/<availablePoints[^>]*>([^<]+)<\/availablePoints>/i);
        if (availableMatch) {
          points = parseFloat(availableMatch[1]) || 0;
          log('[SOAP-PARSE] Found availablePoints (fallback):', { points, match: availableMatch[1] });
        }
      }
      
      // If we have account data (membership number or point details), consider it successful
      // even if points is 0 (account might just have 0 points)
      if (hasMembershipNumber || hasPointDetails) {
        log('[SOAP-PARSE] Parsed account summary successfully:', { 
          points, 
          pointTypesCount: pointTypesWithExpiry.size,
          hasMembershipNumber: !!hasMembershipNumber, 
          hasPointDetails: !!hasPointDetails 
        });
        return { 
          success: true, 
          points,
          pointTypes: Array.from(pointTypesWithExpiry.entries()).map(([type, data]) => ({
            pointType: type,
            points: data.points,
            expiryDate: data.expiryDate
          }))
        };
      }
      
      log('[SOAP-PARSE] Unable to parse response - no account data found');
      return { success: false, message: 'Unable to parse account summary response' };
    } catch (error) {
      log('[SOAP-PARSE] Parse error:', error);
      return { success: false, message: 'Failed to parse response' };
    }
  }
  
  async fetchAccountSummaryFromSOAP(sessionId) {
    try {
      log('[SOAP-FETCH] Starting SOAP account summary fetch:', { sessionId });
      
      // Get session (tries memory, then KV, then reconstructs)
      const session = await this.getSession(sessionId);
      if (!session) {
        log('[SOAP-FETCH] Session not found:', { sessionId });
        return { success: false, message: 'Invalid session' };
      }
      
      // If session was reconstructed and missing tokens, we need to re-authenticate
      if (!session.sessionToken && !session.transactionId) {
        log('[SOAP-FETCH] Session missing tokens, cannot fetch account summary:', { sessionId, username: session.username });
        return { success: false, message: 'Session expired. Please log in again.' };
      }
      
      const memberId = session.memberId || session.username; // Use username as fallback
      const transactionToken = session.sessionToken;
      const transactionId = session.transactionId || session.sessionToken; // Use sessionToken as transactionId
      
      log('[SOAP-FETCH] Session data:', { 
        sessionId, 
        memberId, 
        transactionToken: transactionToken ? 'present' : 'missing',
        transactionId: transactionId ? 'present' : 'missing',
        username: session.username 
      });
      
      // Build SOAP envelope matching test.js exactly (with WS-Security headers)
      const created = '2050-12-31T10:33:52.303Z';
      const nonceB64 = 'MTY4NjExNjA4MQ==';
      const passwordDigestB64 = 'RxjWNeJegwDTtbGW0Q2FFBCnQ3A=';
      
      const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:type="http://www.ibsplc.com/iloyal/member/accountsummary/type/">
  <soapenv:Header>
    <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
       <wsu:Timestamp wsu:Id="Timestamp-${Date.now()}" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
          <wsu:Created>${created}</wsu:Created>
          <wsu:Expires>${created}</wsu:Expires>
       </wsu:Timestamp>
       <wsse:UsernameToken wsu:Id="UsernameToken-${Date.now()}" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
          <wsse:Username>wom</wsse:Username>
          <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigestB64}</wsse:Password>
          <wsse:Nonce>${nonceB64}</wsse:Nonce>
          <wsu:Created>${created}</wsu:Created>
       </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <type:AccountSummaryRequest>
      <companyCode>SA</companyCode>
      <programCode>VOYAG</programCode>
      <membershipNumber>${memberId}</membershipNumber>
      <txnHeader>
        <transactionID>${transactionId || ''}</transactionID>
        <userName>wom</userName>
        <transactionToken>${transactionToken || ''}</transactionToken>
        <timeStamp>${new Date().toISOString()}</timeStamp>
      </txnHeader>
    </type:AccountSummaryRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
      
      log('[SOAP-FETCH] SOAP request:', { 
        url: this.accountUrl, 
        transactionToken: transactionToken ? 'present' : 'missing', 
        transactionId: transactionId ? 'present' : 'missing',
        memberId,
        envelopeLength: soapEnvelope.length 
      });
      
      const response = await fetch(this.accountUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': '',
          'Host': 'ilstage.flysaa.com' // Explicit Host header
        },
        body: soapEnvelope,
        cf: {
          cacheTtl: 0,
          cacheEverything: false,
          resolveOverride: '196.46.23.82' // Direct IP from test.js
        }
      });
      
      log('[SOAP-FETCH] SOAP response status:', { 
        status: response.status, 
        statusText: response.statusText,
        ok: response.ok 
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        log('[SOAP-FETCH] SOAP error response:', { 
          status: response.status, 
          statusText: response.statusText,
          errorText: errorText.substring(0, 500) 
        });
        return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
      }
      
      const text = await response.text();
      log('[SOAP-FETCH] SOAP response received, length:', text.length);
      log('[SOAP-FETCH] SOAP response preview (first 500 chars):', text.substring(0, 500));
      
      const parsed = this.parseAccountSummaryResponse(text);
      log('[SOAP-FETCH] Parse result:', parsed);
      
      return parsed;
    } catch (error) {
      log('[SOAP-FETCH] Exception during SOAP fetch:', { 
        error: error.message, 
        stack: error.stack,
        sessionId 
      });
      return { success: false, message: error.message || 'Account summary request failed' };
    }
  }
}

// Initialize service (will be created with env in main handler)
let voyagerService;

// Handle Voyager API requests
async function handleVoyagerAPI(request, path) {
  const method = request.method;
  
  if (path === '/api/voyager/authenticate' && method === 'POST') {
    const body = await request.json();
    const { username, password } = body;
    log('Authenticating member:', username);

    if (!username || !password) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Username and password are required'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    const result = await voyagerService.authenticateMember(username, password);
    log('Authentication result:', result);

    if (result.success) {
      return new Response(JSON.stringify({
        success: true,
        sessionId: result.sessionId,
        memberNumber: username,
        message: 'Authentication successful'
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } else {
      // Determine appropriate HTTP status based on error type
      let statusCode = 401; // Default to unauthorized
      if (result.errorCode === 'NETWORK_ERROR' || result.errorCode === 'SERVICE_UNAVAILABLE') {
        statusCode = 503; // Service unavailable for network issues
      }
      
      return new Response(JSON.stringify({
        success: false,
        message: result.message || 'Authentication failed',
        errorCode: result.errorCode || 'unknown',
        technicalDetails: result.technicalDetails
      }), {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }

  if (path === '/api/voyager/account-summary' && method === 'POST') {
    console.log('[ACCOUNT-SUMMARY-ENDPOINT] ========== ACCOUNT SUMMARY REQUEST ==========');
    const body = await request.json();
    const { sessionId } = body;
    
    console.log(`[ACCOUNT-SUMMARY-ENDPOINT] Request received - sessionId: ${sessionId}`);

    if (!sessionId) {
      console.log('[ACCOUNT-SUMMARY-ENDPOINT] Missing sessionId');
      return new Response(JSON.stringify({
        success: false,
        message: 'Session ID is required'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    const result = await voyagerService.getAccountSummary(sessionId);
    
    console.log(`[ACCOUNT-SUMMARY-ENDPOINT] Service result - success: ${result.success}, points: ${result.points || 'N/A'}, message: ${result.message || 'N/A'}`);
    
    // If SOAP fetch failed, try to return cached balance
    if (!result.success) {
      const session = await voyagerService.getSession(sessionId);
      const memberId = session?.memberId;
      const cachedBalance = voyagerService.sessionBalances.get(sessionId) || 
                           (memberId ? voyagerService.memberBalances.get(memberId) : null);
      
      if (cachedBalance != null) {
        console.log(`[ACCOUNT-SUMMARY-ENDPOINT] SOAP failed but returning cached balance: ${cachedBalance}`);
        return new Response(JSON.stringify({
          success: true,
          points: cachedBalance,
          message: 'Points balance retrieved from cache (SOAP unavailable)',
          fromCache: true
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      const statusCode = result.status || 502;
      console.log(`[ACCOUNT-SUMMARY-ENDPOINT] Returning error status ${statusCode}`);
      return new Response(JSON.stringify({
        success: false,
        message: result.message || 'Account summary unavailable'
      }), {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    console.log(`[ACCOUNT-SUMMARY-ENDPOINT] Returning success with points: ${result.points}`);
    console.log('[ACCOUNT-SUMMARY-ENDPOINT] ========== ACCOUNT SUMMARY COMPLETE ==========');
    
    return new Response(JSON.stringify({
      success: true,
      points: result.points,
      message: result.message,
      fromCache: false
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }

  // Apply points during cart step (mock/testing only): decrement session balance
  if (path === '/api/voyager/apply' && method === 'POST') {
    console.log('[APPLY] ========== APPLY POINTS REQUEST ==========');
    const body = await request.json();
    const { sessionId, pointsUsed } = body || {};
    
    console.log(`[APPLY] Request body - sessionId: ${sessionId}, pointsUsed: ${pointsUsed}`);

    if (!sessionId || pointsUsed == null) {
      console.log('[APPLY] Validation failed - missing required fields');
      return new Response(JSON.stringify({ success: false, message: 'sessionId and pointsUsed are required' }), { status: 400, headers: corsHeaders });
    }

    if (!voyagerService.validateSession(sessionId)) {
      console.log(`[APPLY] Invalid session: ${sessionId}`);
      return new Response(JSON.stringify({ success: false, message: 'Invalid or expired session' }), { status: 401, headers: corsHeaders });
    }

    let session = await voyagerService.getSession(sessionId);
    let memberId = session?.memberId;
    
    // If session doesn't exist, try to find memberId by matching session balance with member balance
    if (!session && voyagerService.sessionBalances.has(sessionId)) {
      const sessionBalance = voyagerService.sessionBalances.get(sessionId);
      console.log(`[APPLY] Session not found, but session balance exists: ${sessionBalance}, searching for matching member balance...`);
      
      // Find memberId by matching balance
      for (const [mid, balance] of voyagerService.memberBalances.entries()) {
        if (balance === sessionBalance) {
          memberId = mid;
          console.log(`[APPLY] Found matching member balance - memberId: ${memberId}, balance: ${balance}`);
          // Recreate session entry for future use
          const sessionData = {
            sessionToken: null,
            memberId,
            username: memberId // Use memberId as username fallback
          };
          voyagerService.sessions.set(sessionId, sessionData);
          await voyagerService.storeSessionInKV(sessionId, sessionData);
          session = await voyagerService.getSession(sessionId);
          break;
        }
      }
    }
    
    console.log(`[APPLY] Session found - sessionId: ${sessionId}, memberId: ${memberId || 'none'}, username: ${session?.username || 'none'}, sessionExists: ${!!session}, hasSessionBalance: ${voyagerService.sessionBalances.has(sessionId)}, hasMemberBalance: ${memberId ? voyagerService.memberBalances.has(memberId) : false}`);

    if (!voyagerService.sessionBalances.has(sessionId)) {
      if (voyagerService.mockMode) {
        voyagerService.sessionBalances.set(sessionId, voyagerService.mockPoints);
        if (memberId) {
          voyagerService.memberBalances.set(memberId, voyagerService.mockPoints);
        }
      } else {
      console.log(`[APPLY] No session balance found, fetching from SOAP for sessionId: ${sessionId}`);
      const summary = await voyagerService.fetchAccountSummaryFromSOAP(sessionId);
      
      if (summary.success) {
        console.log(`[APPLY] SOAP fetch success, setting balances - points: ${summary.points}, sessionId: ${sessionId}, memberId: ${memberId || 'none'}`);
        voyagerService.sessionBalances.set(sessionId, summary.points);
        if (memberId) {
          voyagerService.memberBalances.set(memberId, summary.points);
          console.log(`[APPLY] Member balance set from SOAP - memberId: ${memberId}, points: ${summary.points}`);
        }
        
        // Store point types for FEFO logic
        if (summary.pointTypes && summary.pointTypes.length > 0) {
          const currentSession = await voyagerService.getSession(sessionId);
          if (currentSession) {
            currentSession.pointTypes = summary.pointTypes;
            voyagerService.sessions.set(sessionId, currentSession);
            await voyagerService.storeSessionInKV(sessionId, currentSession);
            console.log(`[APPLY] Stored ${summary.pointTypes.length} point types for FEFO logic`);
          }
        }
      } else {
        // If we have a memberId, use existing member balance; otherwise, cannot proceed
        if (memberId && voyagerService.memberBalances.has(memberId)) {
          const balanceToUse = voyagerService.memberBalances.get(memberId);
          console.log(`[APPLY] SOAP fetch failed, using existing member balance - memberId: ${memberId}, points: ${balanceToUse}`);
          voyagerService.sessionBalances.set(sessionId, balanceToUse);
        } else {
          console.log(`[APPLY] SOAP fetch failed and no cached balance available - cannot apply points`);
          return new Response(JSON.stringify({ success: false, message: 'Balance unavailable; cannot apply points' }), { status: 502, headers: corsHeaders });
        }
        }
      }
    } else {
      console.log(`[APPLY] Using existing session balance for sessionId: ${sessionId}`);
      // If we have session balance but no memberId, try to find it
      if (!memberId) {
        const sessionBalance = voyagerService.sessionBalances.get(sessionId);
        for (const [mid, balance] of voyagerService.memberBalances.entries()) {
          if (balance === sessionBalance) {
            memberId = mid;
            console.log(`[APPLY] Found memberId from balance match - memberId: ${memberId}, balance: ${balance}`);
            // Recreate session entry
            if (!session) {
              voyagerService.sessions.set(sessionId, {
                sessionToken: null,
                memberId,
                username: memberId
              });
            }
            break;
          }
        }
      }
    }

    const currentSessionBalance = voyagerService.sessionBalances.get(sessionId);
    const currentMemberBalance = memberId ? voyagerService.memberBalances.get(memberId) : undefined;
    if (currentSessionBalance == null && currentMemberBalance == null) {
      console.log(`[APPLY] No current balance available after recovery - cannot apply points`);
      return new Response(JSON.stringify({ success: false, message: 'Balance unavailable; cannot apply points' }), { status: 502, headers: corsHeaders });
    }
    const current = currentSessionBalance != null ? currentSessionBalance : currentMemberBalance;
    
    console.log(`[APPLY] Current balances BEFORE deduction - sessionId: ${sessionId}, memberId: ${memberId || 'none'}, currentSessionBalance: ${currentSessionBalance}, currentMemberBalance: ${currentMemberBalance || 'none'}, current: ${current}, pointsToUse: ${pointsUsed}`);

    const pointsUsedInt = parseInt(pointsUsed, 10);
    const use = Math.max(0, Math.min(current, pointsUsedInt));
    const remaining = current - use;
    
    console.log(`[APPLY] Calculation - pointsUsedRaw: ${pointsUsed}, pointsUsedInt: ${pointsUsedInt}, current: ${current}, use: ${use}, remaining: ${remaining}, calculation: ${current} - ${use} = ${remaining}`);

    voyagerService.sessionBalances.set(sessionId, remaining);
    console.log(`[APPLY] Session balance updated - sessionId: ${sessionId}, old: ${current}, new: ${remaining}`);
    
    // Final attempt to find memberId if still missing (by matching the new remaining balance)
    if (!memberId) {
      console.log(`[APPLY] MemberId still missing, attempting final recovery by matching remaining balance: ${remaining}`);
      for (const [mid, balance] of voyagerService.memberBalances.entries()) {
        // Check if any member has a balance close to what we expect after deduction
        // (within 1000 points to account for rounding or previous deductions)
        if (Math.abs(balance - remaining) < 1000 || balance === current) {
          memberId = mid;
          console.log(`[APPLY] Found memberId from final recovery - memberId: ${memberId}, balance: ${balance}, remaining: ${remaining}`);
          // Recreate session entry
          voyagerService.sessions.set(sessionId, {
            sessionToken: null,
            memberId,
            username: memberId
          });
          break;
        }
      }
    }
    
    if (memberId) {
      const oldMemberBalance = voyagerService.memberBalances.get(memberId);
      voyagerService.memberBalances.set(memberId, remaining);
      console.log(`[APPLY] Member balance updated - memberId: ${memberId}, old: ${oldMemberBalance || 'none'}, new: ${remaining}, sessionBalance: ${voyagerService.sessionBalances.get(sessionId)}, memberBalance: ${voyagerService.memberBalances.get(memberId)}`);
    } else {
      console.log(`[APPLY] WARNING: MemberId still not found, member balance NOT updated. Session balance updated to: ${remaining}`);
    }

    const finalSessionBalance = voyagerService.sessionBalances.get(sessionId);
    const finalMemberBalance = memberId ? voyagerService.memberBalances.get(memberId) : undefined;
    console.log(`[APPLY] Final balances AFTER deduction - sessionId: ${sessionId}, memberId: ${memberId || 'none'}, sessionBalance: ${finalSessionBalance}, memberBalance: ${finalMemberBalance || 'none'}, remainingPoints: ${remaining}`);
    
    console.log('[APPLY] ========== APPLY POINTS COMPLETE ==========');
    return new Response(JSON.stringify({ success: true, remainingPoints: remaining }), { status: 200, headers: corsHeaders });
  }

  if (path === '/api/voyager/finalize' && method === 'POST') {
    const body = await request.json();
    const { sessionId, orderId, pointsUsed, pointsValue } = body;

    if (!sessionId || !orderId) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Session ID and order ID are required'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }

    if (!voyagerService.validateSession(sessionId)) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Invalid or expired session'
      }), {
        status: 401,
        headers: corsHeaders
      });
    }

    if (pointsUsed <= 0) {
      return new Response(JSON.stringify({
        success: false,
        message: 'No points to finalize'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const certificateResult = await voyagerService.issueCertificate(sessionId, pointsUsed, orderId);
    
    if (!certificateResult.success) {
      log('[FINALIZE] Certificate issuance failed', { 
        error: certificateResult.message,
        status: certificateResult.status,
        hasResponseText: !!certificateResult.responseText
      });
      return new Response(JSON.stringify({
        success: false,
        message: certificateResult.message || 'Failed to issue certificate',
        error: certificateResult.responseText ? certificateResult.responseText.substring(0, 500) : undefined
      }), {
        status: certificateResult.status || 500,
        headers: corsHeaders
      });
    }
    
    const markResult = await voyagerService.markCertificateAsUsed(sessionId, certificateResult.certificateId);
    
    // Get remaining balance after redemption
    const finalSession = await voyagerService.getSession(sessionId);
    const finalMemberId = finalSession?.memberId;
    const remainingBalance = voyagerService.sessionBalances.get(sessionId) || 
                             (finalMemberId ? voyagerService.memberBalances.get(finalMemberId) : null);

    if (markResult.success) {
      return new Response(JSON.stringify({
        success: true,
        pointsUsed: pointsUsed,
        pointsValue: pointsValue,
        certificateId: certificateResult.certificateId || 'N/A',
        orderId: orderId,
        remainingBalance: remainingBalance,
        message: 'Points deduction finalized successfully'
      }), {
        status: 200,
        headers: corsHeaders
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        message: 'Failed to finalize points deduction',
        certificateId: certificateResult.certificateId || 'N/A',
        remainingBalance: remainingBalance
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }

  if (path === '/api/voyager/logout' && method === 'POST') {
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Session ID is required'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }

    // No explicit removal of session in mock mode, as it's not persistent
    // In a real application, you would invalidate the session in a persistent store
    return new Response(JSON.stringify({
      success: true,
      message: 'Logout successful'
    }), {
      status: 200,
      headers: corsHeaders
    });
  }

  return new Response(JSON.stringify({
    error: 'Not Found',
    path: path,
    method: method
  }), {
    status: 404,
    headers: corsHeaders
  });
}

// Handle webhook requests for order completion
async function handleWebhooks(request, path) {
  const method = request.method;
  
  // Shopify orders/create webhook - finalize points deduction
  if (path === '/api/webhooks/orders-create' && method === 'POST') {
    try {
      const body = await request.json();
      log('Orders create webhook received:', body);
      
      // Extract order information
      const { id: orderId, total_price, customer, note_attributes } = body;
      
      // Check if this order has Voyager points
      const voyagerPoints = note_attributes?.find(attr => attr.name === 'voyager_points_used');
      const voyagerRate = note_attributes?.find(attr => attr.name === 'voyager_points_rate');
      const voyagerSession = note_attributes?.find(attr => attr.name === 'voyager_session_id');
      
      if (voyagerPoints && voyagerRate && voyagerSession) {
        const pointsUsed = parseInt(voyagerPoints.value);
        const pointsRate = parseFloat(voyagerRate.value);
        const sessionId = voyagerSession.value;
        
        log('Finalizing Voyager points for order:', { orderId, pointsUsed, pointsRate, sessionId });
        
        // Finalize points deduction
        const finalizeResult = await voyagerService.issueCertificate(sessionId, pointsUsed, orderId);
        
        if (finalizeResult.success) {
          log('Points finalized successfully:', finalizeResult);
          return new Response(JSON.stringify({
            success: true,
            message: 'Points finalized successfully',
            certificateId: finalizeResult.certificateId
          }), {
            status: 200,
            headers: corsHeaders
          });
        } else {
          log('Points finalization failed:', finalizeResult);
          return new Response(JSON.stringify({
            success: false,
            message: 'Points finalization failed'
          }), {
            status: 500,
            headers: corsHeaders
          });
        }
      } else {
        log('No Voyager points found in order');
        return new Response(JSON.stringify({
          success: true,
          message: 'No Voyager points to finalize'
        }), {
          status: 200,
          headers: corsHeaders
        });
      }
      
    } catch (error) {
      log('Webhook error:', error);
      return new Response(JSON.stringify({
        success: false,
        message: 'Webhook processing failed'
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
  
  // Shopify orders/cancelled webhook - recredit points
  if (path === '/api/webhooks/orders-cancelled' && method === 'POST') {
    try {
      const body = await request.json();
      log('Orders cancelled webhook received:', body);
      
      // Extract order information
      const { id: orderId, note_attributes } = body;
      
      // Check if this order had Voyager points
      const voyagerPoints = note_attributes?.find(attr => attr.name === 'voyager_points_used');
      const voyagerSession = note_attributes?.find(attr => attr.name === 'voyager_session_id');
      
      if (voyagerPoints && voyagerSession) {
        const pointsUsed = parseInt(voyagerPoints.value);
        const sessionId = voyagerSession.value;
        
        log('Recrediting Voyager points for cancelled order:', { orderId, pointsUsed, sessionId });
        
        // Recredit points
        const recreditResult = await voyagerService.recreditPoints(sessionId, pointsUsed, 'Order cancelled');
        
        if (recreditResult.success) {
          log('Points recredited successfully:', recreditResult);
          return new Response(JSON.stringify({
            success: true,
            message: 'Points recredited successfully'
          }), {
            status: 200,
            headers: corsHeaders
          });
        } else {
          log('Points recredit failed:', recreditResult);
          return new Response(JSON.stringify({
            success: false,
            message: 'Points recredit failed'
          }), {
            status: 500,
            headers: corsHeaders
          });
        }
      } else {
        log('No Voyager points found in cancelled order');
        return new Response(JSON.stringify({
          success: true,
          message: 'No Voyager points to recredit'
        }), {
          status: 200,
          headers: corsHeaders
        });
      }
      
    } catch (error) {
      log('Webhook error:', error);
      return new Response(JSON.stringify({
        success: false,
        message: 'Webhook processing failed'
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
  
  return new Response(JSON.stringify({
    error: 'Webhook not found',
    path: path,
    method: method
  }), {
    status: 404,
    headers: corsHeaders
  });
}

// Handle Settings API
async function handleSettingsAPI(request, path, method, env) {
  log('Settings API request', { path, method });

  // Initialize app settings from environment variables (if not already set)
  // Settings are now loaded from KV via getAppSettings() function

  // GET /api/settings/points-rate - Get conversion rate
  if (path === '/api/settings/points-rate' && method === 'GET') {
    try {
      const settings = await getAppSettings(env);
      log('[Settings API] GET request - returning rate:', settings.pointsToZarRate);
      return new Response(JSON.stringify({
        success: true,
        pointsToZarRate: settings.pointsToZarRate
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error) {
      log('[Settings API] GET error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }

  // PUT /api/settings/points-rate - Update conversion rate
  if (path === '/api/settings/points-rate' && method === 'PUT') {
    try {
      log('[Settings API] PUT request received', { 
        path, 
        method, 
        origin: request.headers.get('Origin'),
        contentType: request.headers.get('Content-Type')
      });
      
      const bodyText = await request.text();
      log('[Settings API] Request body text:', bodyText);
      
      let body;
      try {
        body = JSON.parse(bodyText);
      } catch (parseError) {
        log('[Settings API] JSON parse error:', parseError);
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid JSON in request body'
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      log('[Settings API] Request body:', body);
      
      const newRate = parseFloat(body.pointsToZarRate);
      log('[Settings API] Parsed rate:', newRate);
      
      if (isNaN(newRate) || newRate <= 0) {
        log('[Settings API] Invalid rate:', newRate);
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid rate. Must be a positive number.'
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      // Load current settings
      const currentSettings = await getAppSettings(env);
      const oldRate = currentSettings.pointsToZarRate;
      
      // Update settings
      const updatedSettings = {
        ...currentSettings,
        pointsToZarRate: newRate
      };
      
      // Save to KV
      const saveResult = await saveAppSettings(env, updatedSettings);
      log('[Settings API] KV save result:', saveResult);
      
      if (!saveResult) {
        log('[Settings API] WARNING: Failed to save to KV, but continuing with response');
      }
      
      log('[Settings API] Conversion rate updated', { oldRate, newRate, savedToKV: saveResult });

      return new Response(JSON.stringify({
        success: true,
        pointsToZarRate: updatedSettings.pointsToZarRate,
        message: 'Conversion rate updated successfully'
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (error) {
      log('[Settings API] Error processing PUT request:', error);
      log('[Settings API] Error stack:', error.stack);
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }

  return new Response(JSON.stringify({
    error: 'Settings endpoint not found',
    path: path,
    method: method
  }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}


// Main handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Initialize service with environment variables
    if (!voyagerService) {
      voyagerService = new VoyagerService(env);
    }

    // Settings are now loaded from KV via getAppSettings() function

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      log('CORS preflight request', { path, origin: request.headers.get('Origin') });
      return new Response(null, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    try {
      // Health check API endpoint
      if (path === '/api/health' && method === 'GET') {
        return new Response(JSON.stringify({
          status: 'healthy',
          service: 'SAA Voyager API',
          timestamp: new Date().toISOString(),
          environment: env.NODE_ENV || 'production',
          isUAT: voyagerService.isUAT
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      // Handle Voyager API requests
      if (path.startsWith('/api/voyager/')) {
        return await handleVoyagerAPI(request, path);
      }

      // Handle Settings API requests
      if (path.startsWith('/api/settings/')) {
        return await handleSettingsAPI(request, path, method, env);
      }

      // Handle webhook requests
      if (path.startsWith('/api/webhooks/')) {
        return await handleWebhooks(request, path);
      }

      // Worker only handles API routes - React app is hosted separately
      // All non-API routes return 404
      return new Response(JSON.stringify({
        error: 'Not Found',
        path: path,
        method: method
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });

    } catch (error) {
      log('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
};
