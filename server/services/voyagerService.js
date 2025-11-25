const fetch = require('node-fetch');
const { createLogger } = require('winston');
const soap = require('soap');
const crypto = require('crypto');
const https = require('https');
const logger = createLogger();

class VoyagerService {
  constructor() {
    // Hardcoded UAT URLs and credentials
    this.authUrl = 'http://ilstage.flysaa.com/saa_upg_uat-ws/services/AuthenticateMemberServiceV2.7';
    this.accountUrl = 'http://ilstage.flysaa.com/saa_upg_uat-ws/services/AccountSummaryServiceV2.7';
    this.memberProfileUrl = 'http://ilstage.flysaa.com/saa_upg_uat-ws/services/MemberProfileDetailsServiceV2.7';
    this.issueUrl = 'http://ilstage.flysaa.com/saa_upg_uat-ws/services/IssueCertificateServiceV2.7';
    this.markUrl = 'http://ilstage.flysaa.com/saa_upg_uat-ws/services/MarkCertificateAsUsedService';
    this.recreditUrl = 'http://ilstage.flysaa.com/saa_upg_uat-ws/services/RecreditPointsServiceV2.7';
    this.logoutUrl = 'http://ilstage.flysaa.com/saa_upg_uat-ws/services/LogoutMemberServiceV2.7';

    // UAT HTTPS endpoints mirroring test.js behavior
    this.uatBase = 'https://ilstage.flysaa.com/saa_upg_uat-ws/services';
    this.uatAuthUrl = `${this.uatBase}/AuthenticateMemberService`;
    this.uatAccountUrl = `${this.uatBase}/AccountSummaryService`;
    // Shared HTTPS agent for UAT to allow self-signed certs and proper SNI
    this.uatHttpsAgent = new https.Agent({
      servername: 'ilstage.flysaa.com',
      rejectUnauthorized: false,
      keepAlive: false
    });
    
    this.username = 'wom';
    this.password = 'RxjWNeJegwDTtbGW0Q2FFBCnQ3A';
    this.sessions = new Map(); // In production, use Redis or database
    
    // Validate required environment variables
    if (!this.authUrl || !this.accountUrl) {
      logger.warn('Missing required SAA Voyager service URLs');
    }
  }

  /**
   * Authenticate member and create session
   */
  async authenticateMember(voyagerUsername, voyagerPassword, correlationId) {
    try {
      logger.info('Authenticating member', { correlationId, voyagerUsername });
      
      
      
      // Generate WS-Security values
      // For UAT testing, use the specific values provided
      const isUAT = process.env.NODE_ENV === 'uat' || process.env.VOYAGER_ENV === 'uat';
      
      let created, nonceB64, passwordDigestB64;
      
      if (isUAT) {
        // Use the exact UAT values provided
        created = '2050-12-31T10:33:52.303Z';
        nonceB64 = 'MTY4NjExNjA4MQ==';
        passwordDigestB64 = 'RxjWNeJegwDTtbGW0Q2FFBCnQ3A=';
      } else {
        // Generate dynamic values for production
        created = new Date().toISOString();
        const nonceBytes = crypto.randomBytes(16);
        nonceB64 = nonceBytes.toString('base64');
        const password = this.password || '';
        // PasswordDigest = Base64( SHA1( nonce + created + password ) )
        const sha1 = crypto.createHash('sha1');
        sha1.update(Buffer.concat([nonceBytes, Buffer.from(created, 'utf8'), Buffer.from(password, 'utf8')]));
        passwordDigestB64 = sha1.digest('base64');
      }
      
      // Construct SOAP request exactly like test.js for UAT compatibility
      const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:type="http://www.ibsplc.com/iloyal/member/authenticatemember/type/">
   <soapenv:Header>
      <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
         <wsu:Timestamp wsu:Id="${isUAT ? 'Timestamp-2' : 'Timestamp-' + Date.now()}" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
            <wsu:Created>${created}</wsu:Created>
            <wsu:Expires>${created}</wsu:Expires>
         </wsu:Timestamp>
         <wsse:UsernameToken wsu:Id="${isUAT ? 'UsernameToken-20914066' : 'UsernameToken-' + Date.now()}" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
            <wsse:Username>${isUAT ? 'wom' : this.username}</wsse:Username>
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
         <membershipNumber>${voyagerUsername}</membershipNumber>
         <pin>${voyagerPassword}</pin>
         <skipPinChangeReminder>1</skipPinChangeReminder>
         <txnHeader>
            <transactionID></transactionID>
            <userName>${isUAT ? 'wom' : this.username}</userName>
            <transactionToken></transactionToken>
            <timeStamp>${new Date().toISOString()}</timeStamp>
         </txnHeader>
      </type:AuthenticateMemberRequest>
   </soapenv:Body>
</soapenv:Envelope>`;
      
      // Choose endpoint and headers per environment
      const authUrl = isUAT ? this.uatAuthUrl : this.authUrl;
      const authHeaders = isUAT
        ? { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' }
        : { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'AuthenticateMember' };

      const response = await fetch(authUrl, {
        method: 'POST',
        headers: authHeaders,
        body: soapEnvelope,
        ...(authUrl.startsWith('https') && isUAT ? { agent: this.uatHttpsAgent } : {})
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const responseText = await response.text();
      logger.info('SOAP response received', { correlationId, responseLength: responseText.length });
      
      // Parse the XML response to extract authentication result
      const result = this.parseAuthenticationResponse(responseText);
      
      if (result.success) {
        const sessionToken = result.sessionToken;
        const memberId = result.memberId;
        
        // Store session
        this.sessions.set(correlationId, {
          sessionToken,
          memberId,
          voyagerUsername,
          createdAt: new Date(),
          lastActivity: new Date()
        });
        
        logger.info('Member authenticated successfully', { 
          correlationId, 
          memberId, 
          voyagerUsername 
        });
        
        return {
          success: true,
          sessionToken,
          memberId,
          message: 'Authentication successful'
        };
      } else {
        logger.warn('Authentication failed', { correlationId, voyagerUsername, reason: result.message });
        return {
          success: false,
          message: result.message || 'Invalid credentials'
        };
      }
    } catch (error) {
      logger.error('Authentication error', { 
        correlationId, 
        voyagerUsername, 
        error: error.message 
      });
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

    /**
   * Parse SOAP authentication response
   */
  parseAuthenticationResponse(xmlResponse) {
    try {
      // Simple XML parsing using string operations
      // In production, consider using a proper XML parser like xml2js
      
      if (xmlResponse.includes('<fault>') || xmlResponse.includes('<soap:Fault>')) {
        return {
          success: false,
          message: 'SOAP fault occurred'
        };
      }
      
      // Look for success indicators based on SAA response format
      if (xmlResponse.includes('<status>true</status>') || 
          xmlResponse.includes('<success>true</success>') || 
          xmlResponse.includes('<success>1</success>')) {
        
        // Extract transaction ID as session token
        let sessionToken = null;
        const transactionMatch = xmlResponse.match(/<transactionID[^>]*>([^<]+)<\/transactionID>/);
        if (transactionMatch) {
          sessionToken = transactionMatch[1];
        }
        
        // Extract membership number as member ID
        let memberId = null;
        const membershipMatch = xmlResponse.match(/<membershipNumber[^>]*>([^<]+)<\/membershipNumber>/);
        if (membershipMatch) {
          memberId = membershipMatch[1];
        }
        
        // If we have a transaction ID, use it as session token
        if (sessionToken) {
          return {
            success: true,
            sessionToken,
            memberId: memberId || 'unknown'
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
        
        // Extract error message
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
      
      // Default case - try to extract any useful information
      return {
        success: false,
        message: 'Unable to parse authentication response'
      };
      
    } catch (error) {
      logger.error('XML parsing error', { error: error.message });
      return {
        success: false,
        message: 'Failed to parse response'
      };
    }
  }

  /**
   * Parse SOAP account summary response
   */
  parseAccountSummaryResponse(xmlResponse) {
    try {
      if (xmlResponse.includes('<fault>') || xmlResponse.includes('<soap:Fault>')) {
        return {
          success: false,
          message: 'SOAP fault occurred'
        };
      }
      
      // Look for success indicators
      if (xmlResponse.includes('<success>true</success>') || 
          xmlResponse.includes('<success>1</success>')) {
        
        // Extract points
        let points = 0;
        const pointsMatch = xmlResponse.match(/<totalPoints[^>]*>([^<]+)<\/totalPoints>/);
        if (pointsMatch) {
          points = parseInt(pointsMatch[1]) || 0;
        } else {
          const availableMatch = xmlResponse.match(/<availablePoints[^>]*>([^<]+)<\/availablePoints>/);
          if (availableMatch) {
            points = parseInt(availableMatch[1]) || 0;
          }
        }
        
        return {
          success: true,
          points
        };
      }
      
      // Look for failure indicators
      if (xmlResponse.includes('<success>false</success>') || 
          xmlResponse.includes('<success>0</success>')) {
        
        let errorMessage = 'Failed to retrieve account summary';
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
        message: 'Unable to parse account summary response'
      };
      
    } catch (error) {
      logger.error('Account summary XML parsing error', { error: error.message });
      return {
        success: false,
        message: 'Failed to parse response'
      };
    }
  }

  /**
   * Get member profile details
   */
  async getMemberProfile(correlationId) {
    try {
      const session = this.sessions.get(correlationId);
      if (!session) {
        throw new Error('No active session found');
      }

      logger.info('Fetching member profile', { correlationId, memberId: session.memberId });
      
      
      
      // Construct SOAP request manually
      const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://www.ibsplc.com/iloyal/member/profile/v2.7/type/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:GetMemberProfile>
      <web:sessionToken>${session.sessionToken}</web:sessionToken>
      <web:memberId>${session.memberId}</web:memberId>
    </web:GetMemberProfile>
  </soapenv:Body>
</soapenv:Envelope>`;
      
      const response = await fetch(this.memberProfileUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'GetMemberProfile'
        },
        body: soapEnvelope
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const responseText = await response.text();
      const result = this.parseMemberProfileResponse(responseText);
      
      if (result.success) {
        // Update session activity
        session.lastActivity = new Date();
        
        logger.info('Member profile retrieved', { 
          correlationId, 
          memberId: session.memberId 
        });
        
        return {
          success: true,
          profile: result.profile,
          message: 'Member profile retrieved successfully'
        };
      } else {
        throw new Error(result.message || 'Failed to retrieve member profile');
      }
    } catch (error) {
      logger.error('Member profile error', { 
        correlationId, 
        error: error.message 
      });
      throw new Error(`Failed to get member profile: ${error.message}`);
    }
  }

  /**
   * Get account summary (points balance)
   */
  async getAccountSummary(correlationId) {
    try {
      const session = this.sessions.get(correlationId);
      if (!session) {
        throw new Error('No active session found');
      }

      logger.info('Fetching account summary', { correlationId, memberId: session.memberId });
      
      
      
      // Construct SOAP request manually
      const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://www.ibsplc.com/iloyal/member/accountsummary/v2.7/type/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:GetAccountSummary>
      <web:sessionToken>${session.sessionToken}</web:sessionToken>
      <web:memberId>${session.memberId}</web:memberId>
    </web:GetAccountSummary>
  </soapenv:Body>
</soapenv:Envelope>`;
      
      // Choose endpoint and headers per environment
      const accountUrl = (process.env.NODE_ENV === 'uat' || process.env.VOYAGER_ENV === 'uat') ? this.uatAccountUrl : this.accountUrl;
      const accountHeaders = (process.env.NODE_ENV === 'uat' || process.env.VOYAGER_ENV === 'uat')
        ? { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' }
        : { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'GetAccountSummary' };

      const response = await fetch(accountUrl, {
        method: 'POST',
        headers: accountHeaders,
        body: soapEnvelope,
        ...(accountUrl.startsWith('https') && (process.env.NODE_ENV === 'uat' || process.env.VOYAGER_ENV === 'uat') ? { agent: this.uatHttpsAgent } : {})
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const responseText = await response.text();
      const result = this.parseAccountSummaryResponse(responseText);
      
      if (result.success) {
        const points = result.points;
        const zarValue = this.convertPointsToZAR(points);
        
        // Update session activity
        session.lastActivity = new Date();
        
        logger.info('Account summary retrieved', { 
          correlationId, 
          memberId: session.memberId, 
          points, 
          zarValue 
        });
        
        return {
          success: true,
          points,
          zarValue,
          message: `You have ${points.toLocaleString()} points available`
        };
      } else {
        throw new Error(result.message || 'Failed to retrieve account summary');
      }
    } catch (error) {
      logger.error('Account summary error', { 
        correlationId, 
        error: error.message 
      });
      throw new Error(`Failed to get account summary: ${error.message}`);
    }
  }

  /**
   * Parse SOAP member profile response
   */
  parseMemberProfileResponse(xmlResponse) {
    try {
      if (xmlResponse.includes('<fault>') || xmlResponse.includes('<soap:Fault>')) {
        return {
          success: false,
          message: 'SOAP fault occurred'
        };
      }
      
      // Look for success indicators
      if (xmlResponse.includes('<success>true</success>') || 
          xmlResponse.includes('<success>1</success>')) {
        
        // Extract profile information
        const profile = {};
        
        // Extract common fields
        const firstNameMatch = xmlResponse.match(/<firstName[^>]*>([^<]+)<\/firstName>/);
        if (firstNameMatch) profile.firstName = firstNameMatch[1];
        
        const lastNameMatch = xmlResponse.match(/<lastName[^>]*>([^<]+)<\/lastName>/);
        if (lastNameMatch) profile.lastName = lastNameMatch[1];
        
        const memberIdMatch = xmlResponse.match(/<memberId[^>]*>([^<]+)<\/memberId>/);
        if (memberIdMatch) profile.memberId = memberIdMatch[1];
        
        const emailMatch = xmlResponse.match(/<email[^>]*>([^<]+)<\/email>/);
        if (emailMatch) profile.email = emailMatch[1];
        
        return {
          success: true,
          profile
        };
      }
      
      // Look for failure indicators
      if (xmlResponse.includes('<success>false</success>') || 
          xmlResponse.includes('<success>0</success>')) {
        
        let errorMessage = 'Failed to retrieve member profile';
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
        message: 'Unable to parse member profile response'
      };
      
    } catch (error) {
      logger.error('Member profile XML parsing error', { error: error.message });
      return {
        success: false,
        message: 'Failed to parse response'
      };
    }
  }

  /**
   * Issue certificate for points deduction
   */
  async issueCertificate(pointsToDeduct, correlationId) {
    try {
      const session = this.sessions.get(correlationId);
      if (!session) {
        throw new Error('No active session found');
      }

      logger.info('Issuing certificate', { 
        correlationId, 
        memberId: session.memberId, 
        pointsToDeduct 
      });
      
      
      
      const client = await soap.createClientAsync(this.issueUrl);
      
      const args = {
        sessionToken: session.sessionToken,
        memberId: session.memberId,
        points: pointsToDeduct,
        description: 'Shopify order discount'
      };
      
      const result = await client.IssueCertificateAsync(args);
      
      if (result && result[0] && result[0].success) {
        const certificateId = result[0].certificateId;
        
        logger.info('Certificate issued successfully', { 
          correlationId, 
          memberId: session.memberId, 
          certificateId, 
          pointsToDeduct 
        });
        
        return {
          success: true,
          certificateId,
          pointsDeducted: pointsToDeduct,
          message: 'Certificate issued successfully'
        };
      } else {
        throw new Error('Failed to issue certificate');
      }
    } catch (error) {
      logger.error('Certificate issuance error', { 
        correlationId, 
        pointsToDeduct, 
        error: error.message 
      });
      throw new Error(`Failed to issue certificate: ${error.message}`);
    }
  }

  /**
   * Mark certificate as used
   */
  async markCertificateAsUsed(certificateId, correlationId) {
    try {
      const session = this.sessions.get(correlationId);
      if (!session) {
        throw new Error('No active session found');
      }

      logger.info('Marking certificate as used', { 
        correlationId, 
        memberId: session.memberId, 
        certificateId 
      });
      
      
      
      const client = await soap.createClientAsync(this.markUrl);
      
      const args = {
        sessionToken: session.sessionToken,
        certificateId: certificateId
      };
      
      const result = await client.MarkCertificateAsUsedAsync(args);
      
      if (result && result[0] && result[0].success) {
        logger.info('Certificate marked as used', { 
          correlationId, 
          memberId: session.memberId, 
          certificateId 
        });
        
        return {
          success: true,
          message: 'Certificate marked as used'
        };
      } else {
        throw new Error('Failed to mark certificate as used');
      }
    } catch (error) {
      logger.error('Mark certificate error', { 
        correlationId, 
        certificateId, 
        error: error.message 
      });
      throw new Error(`Failed to mark certificate as used: ${error.message}`);
    }
  }

  /**
   * Recredit points (for cancellations/refunds)
   */
  async recreditPoints(pointsToRecredit, certificateId, correlationId) {
    try {
      const session = this.sessions.get(correlationId);
      if (!session) {
        throw new Error('No active session found');
      }

      logger.info('Recrediting points', { 
        correlationId, 
        memberId: session.memberId, 
        pointsToRecredit, 
        certificateId 
      });
      
      
      
      const client = await soap.createClientAsync(this.recreditUrl);
      
      const args = {
        sessionToken: session.sessionToken,
        memberId: session.memberId,
        points: pointsToRecredit,
        certificateId: certificateId,
        reason: 'Order cancellation/refund'
      };
      
      const result = await client.RecreditPointsAsync(args);
      
      if (result && result[0] && result[0].success) {
        logger.info('Points recredited successfully', { 
          correlationId, 
          memberId: session.memberId, 
          pointsToRecredit, 
          certificateId 
        });
        
        return {
          success: true,
          pointsRecredited: pointsToRecredit,
          message: 'Points recredited successfully'
        };
      } else {
        throw new Error('Failed to recredit points');
      }
    } catch (error) {
      logger.error('Points recredit error', { 
        correlationId, 
        pointsToRecredit, 
        certificateId, 
        error: error.message 
      });
      throw new Error(`Failed to recredit points: ${error.message}`);
    }
  }

  /**
   * Logout member and end session
   */
  async logoutMember(correlationId) {
    try {
      const session = this.sessions.get(correlationId);
      if (!session) {
        return { success: true, message: 'No active session to logout' };
      }

      logger.info('Logging out member', { 
        correlationId, 
        memberId: session.memberId 
      });
      
      
      
      // Construct SOAP request manually
      const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://www.ibsplc.com/iloyal/member/logout/v2.7/type/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:LogoutMember>
      <web:sessionToken>${session.sessionToken}</web:sessionToken>
      <web:memberId>${session.memberId}</web:memberId>
    </web:LogoutMember>
  </soapenv:Body>
</soapenv:Envelope>`;
      
      try {
        const response = await fetch(this.logoutUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': 'LogoutMember'
          },
          body: soapEnvelope
        });
        
        if (response.ok) {
          logger.info('Logout SOAP call successful', { correlationId, memberId: session.memberId });
        } else {
          logger.warn('Logout SOAP call failed', { correlationId, memberId: session.memberId, status: response.status });
        }
      } catch (soapError) {
        logger.warn('Logout SOAP call error', { correlationId, memberId: session.memberId, error: soapError.message });
      }
      
      // Remove session regardless of SOAP result
      this.sessions.delete(correlationId);
      
      logger.info('Member logged out', { 
        correlationId, 
        memberId: session.memberId 
      });
      
      return {
        success: true,
        message: 'Logout successful'
      };
    } catch (error) {
      logger.error('Logout error', { 
        correlationId, 
        error: error.message 
      });
      
      // Remove session even if there's an error
      this.sessions.delete(correlationId);
      
      return {
        success: true,
        message: 'Session ended (logout may have failed)'
      };
    }
  }

  /**
   * Convert points to ZAR value
   */
  convertPointsToZAR(points) {
    const rate = parseFloat(process.env.POINTS_TO_ZAR_RATE) || 0.01;
    return Math.round(points * rate * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Calculate maximum points that can be used for a given subtotal
   */
  calculateMaxPointsUsage(subtotal, availablePoints) {
    const maxPoints = Math.min(
      availablePoints,
      Math.floor(subtotal / this.convertPointsToZAR(1)),
      parseInt(process.env.MAX_POINTS_USAGE) || 10000
    );
    
    const minPoints = parseInt(process.env.MIN_POINTS_USAGE) || 100;
    return Math.max(maxPoints, minPoints);
  }

  /**
   * Validate session
   */
  validateSession(correlationId) {
    const session = this.sessions.get(correlationId);
    if (!session) {
      return false;
    }
    
    // Check if session is expired (24 hours)
    const sessionAge = Date.now() - session.createdAt.getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    if (sessionAge > maxAge) {
      this.sessions.delete(correlationId);
      return false;
    }
    
    // Update last activity
    session.lastActivity = new Date();
    return true;
  }

  /**
   * Get session info
   */
  getSession(correlationId) {
    return this.sessions.get(correlationId);
  }

  /**
   * Store a new session for frontend extensions
   */
  storeSession(sessionId, sessionData) {
    this.sessions.set(sessionId, {
      ...sessionData,
      createdAt: new Date(),
      lastActivity: new Date()
    });
    
    console.log(`Session stored: ${sessionId} for user: ${sessionData.username}`);
  }

  /**
   * Get session by ID for frontend extensions
   */
  getSessionById(sessionId) {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return null;
    }

    // Check if session is expired (24 hours)
    const now = new Date();
    const sessionAge = now - session.createdAt;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    if (sessionAge > maxAge) {
      this.sessions.delete(sessionId);
      console.log(`Session expired: ${sessionId}`);
      return null;
    }

    // Update last activity
    session.lastActivity = new Date();
    
    return session;
  }

  /**
   * Remove session for frontend extensions
   */
  removeSession(sessionId) {
    const removed = this.sessions.delete(sessionId);
    if (removed) {
      console.log(`Session removed: ${sessionId}`);
    }
    return removed;
  }

  /**
   * Get session statistics
   */
  getSessionStats() {
    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(session => {
        const now = new Date();
        const sessionAge = now - session.createdAt;
        return sessionAge <= 24 * 60 * 60 * 1000;
      }).length
    };
  }
}

module.exports = new VoyagerService();
