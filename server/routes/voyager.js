const express = require('express');
const router = express.Router();
const voyagerService = require('../services/voyagerService');
const { createLogger } = require('winston');

const logger = createLogger();

/**
 * POST /api/voyager/authenticate
 * Authenticate customer with Voyager credentials (for frontend extensions)
 */
router.post('/authenticate', async (req, res) => {
  try {
    const { username, password } = req.body;
    const correlationId = req.correlationId;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }

    const result = await voyagerService.authenticateMember(username, password, correlationId);
    
    if (result.success) {
      // Generate a session ID for the frontend
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store session in memory (in production, use Redis or database)
      voyagerService.storeSession(sessionId, {
        memberId: result.memberId,
        username: username,
        correlationId,
        createdAt: new Date(),
        lastActivity: new Date()
      });
      
      res.json({
        success: true,
        sessionId: sessionId,
        memberNumber: username,
        message: 'Authentication successful',
        correlationId
      });
    } else {
      res.status(401).json({
        success: false,
        message: result.message || 'Authentication failed'
      });
    }
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/voyager/account-summary
 * Get customer's points balance (for frontend extensions)
 */
router.post('/account-summary', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const correlationId = req.correlationId;
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Session ID is required' 
      });
    }

    // Get session data
    const session = voyagerService.getSessionById(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session'
      });
    }

    // Update last activity
    session.lastActivity = new Date();

    // Prefer the original correlation context if available
    const effectiveCorrelationId = session.correlationId || correlationId;
    const result = await voyagerService.getAccountSummary(effectiveCorrelationId);
    
    if (result.success) {
      res.json({
        success: true,
        points: result.points,
        message: 'Points balance retrieved successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message || 'Failed to retrieve points balance'
      });
    }
  } catch (error) {
    logger.error('Account summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/voyager/finalize
 * Finalize points deduction after successful order (for frontend extensions)
 */
router.post('/finalize', async (req, res) => {
  try {
    const { sessionId, orderId, orderTotal } = req.body;
    const correlationId = req.correlationId;
    
    if (!sessionId || !orderId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Session ID and order ID are required' 
      });
    }

    // Get session data
    const session = voyagerService.getSessionById(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session'
      });
    }

    // Get points used from request body (in real app, this would be stored in database)
    const pointsUsed = req.body.pointsUsed || 0;
    const pointsValue = req.body.pointsValue || 0;

    if (pointsUsed <= 0) {
      return res.status(400).json({
        success: false,
        message: 'No points to finalize'
      });
    }

    // Issue certificate to deduct points
    // Use original correlation context for SOAP calls
    const effectiveCorrelationId = session.correlationId || correlationId;
    const certificateResult = await voyagerService.issueCertificate(pointsUsed, effectiveCorrelationId);
    
    if (certificateResult.success) {
      // Mark certificate as used
      const markResult = await voyagerService.markCertificateAsUsed(
        certificateResult.certificateId,
        effectiveCorrelationId
      );
      
      if (markResult.success) {
        // Store order information
        session.completedOrders = session.completedOrders || [];
        session.completedOrders.push({
          orderId,
          orderTotal,
          pointsDeducted: pointsUsed,
          discountAmount: pointsValue,
          certificateId: certificateResult.certificateId,
          completedAt: new Date()
        });
        
        res.json({
          success: true,
          pointsUsed: pointsUsed,
          pointsValue: pointsValue,
          certificateId: certificateResult.certificateId,
          orderId: orderId,
          message: 'Points deduction finalized successfully'
        });
      } else {
        // If marking fails, try to recredit points
        await voyagerService.recreditPoints(pointsUsed, certificateResult.certificateId, effectiveCorrelationId);
        
        res.status(500).json({
          success: false,
          message: 'Failed to finalize points deduction'
        });
      }
    } else {
      res.status(500).json({
        success: false,
        message: certificateResult.message || 'Failed to issue certificate'
      });
    }
  } catch (error) {
    logger.error('Points finalization error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during points finalization'
    });
  }
});

/**
 * POST /api/voyager/recredit
 * Recredit points for cancelled/failed orders
 */
router.post('/recredit', async (req, res) => {
  try {
    const { orderId, reason } = req.body;
    const correlationId = req.correlationId;
    
    if (!voyagerService.validateSession(correlationId)) {
      return res.status(401).json({
        success: false,
        message: 'No active session found. Please authenticate first.',
        correlationId
      });
    }

    const session = voyagerService.getSession(correlationId);
    const order = session.completedOrders?.find(o => o.orderId === orderId);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
        correlationId
      });
    }

    // Recredit the points
    const recreditResult = await voyagerService.recreditPoints(
      order.pointsDeducted,
      order.certificateId,
      correlationId
    );
    
    if (recreditResult.success) {
      // Mark order as recredited
      order.recredited = true;
      order.recreditReason = reason;
      order.recreditedAt = new Date();
      
      logger.info('Points recredited', {
        correlationId,
        memberId: session.memberId,
        orderId,
        pointsRecredited: order.pointsDeducted,
        reason
      });

      res.json({
        success: true,
        message: 'Points recredited successfully',
        orderId,
        pointsRecredited: order.pointsDeducted,
        reason,
        correlationId
      });
    } else {
      throw new Error('Failed to recredit points');
    }
  } catch (error) {
    logger.error('Recredit route error', {
      correlationId: req.correlationId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to recredit points',
      error: error.message,
      correlationId: req.correlationId
    });
  }
});

/**
 * POST /api/voyager/logout
 * Logout customer and end session (for frontend extensions)
 */
router.post('/logout', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Session ID is required' 
      });
    }

    // Remove session from memory
    voyagerService.removeSession(sessionId);
    
    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /api/voyager/session
 * Get current session status
 */
router.get('/session', async (req, res) => {
  try {
    const correlationId = req.correlationId;
    const session = voyagerService.getSession(correlationId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'No active session found',
        correlationId
      });
    }

    res.json({
      success: true,
      memberId: session.memberId,
      voyagerUsername: session.voyagerUsername,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      hasPendingDeduction: !!session.pendingDeduction,
      pendingDeduction: session.pendingDeduction,
      completedOrders: session.completedOrders || [],
      correlationId
    });
  } catch (error) {
    logger.error('Session route error', {
      correlationId: req.correlationId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to get session',
      error: error.message,
      correlationId: req.correlationId
    });
  }
});

module.exports = router;
