const express = require('express');
const router = express.Router();
const { createLogger } = require('winston');

const logger = createLogger();

/**
 * GET /api/shopify/install
 * Shopify app installation endpoint
 */
router.get('/install', (req, res) => {
  try {
    const { shop, hmac, code, state } = req.query;
    const correlationId = req.correlationId;

    logger.info('Shopify app installation request', {
      correlationId,
      shop,
      state
    });

    // In a real implementation, you would:
    // 1. Verify the HMAC
    // 2. Exchange the authorization code for an access token
    // 3. Store the shop and access token
    // 4. Redirect to the app

    res.json({
      success: true,
      message: 'App installation endpoint reached',
      shop,
      correlationId
    });
  } catch (error) {
    logger.error('Installation route error', {
      correlationId: req.correlationId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Installation failed',
      error: error.message,
      correlationId: req.correlationId
    });
  }
});

/**
 * POST /api/shopify/webhooks/orders/create
 * Handle order creation webhook
 */
router.post('/webhooks/orders/create', async (req, res) => {
  try {
    const order = req.body;
    const correlationId = req.headers['x-correlation-id'] || require('uuid').v4();

    logger.info('Order created webhook received', {
      correlationId,
      orderId: order.id,
      orderNumber: order.order_number,
      totalPrice: order.total_price,
      customerId: order.customer?.id
    });

    // Check if this order has Voyager points applied by looking for cart attributes
    const voyagerSessionId = order.note_attributes?.find(
      attr => attr.name === 'voyager_session_id'
    )?.value;
    
    const voyagerPointsUsed = order.note_attributes?.find(
      attr => attr.name === 'voyager_points_used'
    )?.value;

    if (voyagerSessionId && voyagerPointsUsed) {
      // Call Voyager finalize endpoint
      try {
        const finalizeResponse = await fetch(`${process.env.APP_URL}/api/voyager/finalize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-correlation-id': correlationId
          },
          body: JSON.stringify({
            sessionId: voyagerSessionId,
            orderId: order.id.toString(),
            orderTotal: parseFloat(order.total_price),
            pointsUsed: parseInt(voyagerPointsUsed)
          })
        });

        if (finalizeResponse.ok) {
          logger.info('Voyager points finalized successfully', {
            correlationId,
            orderId: order.id,
            voyagerSessionId
          });
        } else {
          logger.error('Failed to finalize Voyager points', {
            correlationId,
            orderId: order.id,
            voyagerSessionId,
            status: finalizeResponse.status
          });
        }
      } catch (finalizeError) {
        logger.error('Error calling Voyager finalize endpoint', {
          correlationId,
          orderId: order.id,
          error: finalizeError.message
        });
      }
    }

    // Always return 200 to acknowledge webhook receipt
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Order create webhook error', {
      correlationId: req.headers['x-correlation-id'],
      error: error.message
    });
    
    // Still return 200 to prevent webhook retries
    res.status(200).send('OK');
  }
});

/**
 * POST /api/shopify/webhooks/orders/cancelled
 * Handle order cancellation webhook
 */
router.post('/webhooks/orders/cancelled', async (req, res) => {
  try {
    const order = req.body;
    const correlationId = req.headers['x-correlation-id'] || require('uuid').v4();

    logger.info('Order cancelled webhook received', {
      correlationId,
      orderId: order.id,
      orderNumber: order.order_number,
      cancelReason: order.cancel_reason
    });

    // Check if this order had Voyager points applied by looking for cart attributes
    const voyagerSessionId = order.note_attributes?.find(
      attr => attr.name === 'voyager_session_id'
    )?.value;

    if (voyagerSessionId) {
      // Call Voyager recredit endpoint
      try {
        const recreditResponse = await fetch(`${process.env.APP_URL}/api/voyager/recredit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-correlation-id': correlationId
          },
          body: JSON.stringify({
            orderId: order.id.toString(),
            reason: `Order cancelled: ${order.cancel_reason || 'No reason provided'}`
          })
        });

        if (recreditResponse.ok) {
          logger.info('Voyager points recredited successfully', {
            correlationId,
            orderId: order.id,
            voyagerSessionId,
            reason: order.cancel_reason
          });
        } else {
          logger.error('Failed to recredit Voyager points', {
            correlationId,
            orderId: order.id,
            voyagerSessionId,
            status: recreditResponse.status
          });
        }
      } catch (recreditError) {
        logger.error('Error calling Voyager recredit endpoint', {
          correlationId,
          orderId: order.id,
          error: recreditError.message
        });
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Order cancelled webhook error', {
      correlationId: req.headers['x-correlation-id'],
      error: error.message
    });
    
    res.status(200).send('OK');
  }
});

/**
 * POST /api/shopify/webhooks/refunds/create
 * Handle refund creation webhook
 */
router.post('/webhooks/refunds/create', async (req, res) => {
  try {
    const refund = req.body;
    const correlationId = req.headers['x-correlation-id'] || require('uuid').v4();

    logger.info('Refund created webhook received', {
      correlationId,
      refundId: refund.id,
      orderId: refund.order_id,
      amount: refund.amount
    });

    // Check if the original order had Voyager points applied
    // You might need to fetch the original order here
    // For now, we'll log the refund for manual processing

    logger.info('Refund requires manual Voyager points handling', {
      correlationId,
      refundId: refund.id,
      orderId: refund.order_id,
      amount: refund.amount
    });

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Refund create webhook error', {
      correlationId: req.headers['x-correlation-id'],
      error: error.message
    });
    
    res.status(200).send('OK');
  }
});

/**
 * GET /api/shopify/app-info
 * Get app information for frontend
 */
router.get('/app-info', (req, res) => {
  try {
    const correlationId = req.correlationId;

    res.json({
      success: true,
      appName: process.env.SHOPIFY_APP_NAME || 'SAA Voyager Points',
      appUrl: process.env.SHOPIFY_APP_URL,
      pointsToZarRate: process.env.POINTS_TO_ZAR_RATE || 0.01,
      minPointsUsage: process.env.MIN_POINTS_USAGE || 100,
      maxPointsUsage: process.env.MAX_POINTS_USAGE || 10000,
      correlationId
    });
  } catch (error) {
    logger.error('App info route error', {
      correlationId: req.correlationId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to get app info',
      error: error.message,
      correlationId: req.correlationId
    });
  }
});

/**
 * POST /api/shopify/validate-session
 * Validate Voyager session for Shopify integration
 */
router.post('/validate-session', async (req, res) => {
  try {
    const { correlationId } = req.body;
    
    if (!correlationId) {
      return res.status(400).json({
        success: false,
        message: 'Correlation ID is required'
      });
    }

    // Call Voyager session endpoint
    try {
      const sessionResponse = await fetch(`${process.env.APP_URL}/api/voyager/session`, {
        method: 'GET',
        headers: {
          'x-correlation-id': correlationId
        }
      });

      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        res.json({
          success: true,
          hasValidSession: true,
          session: sessionData,
          correlationId
        });
      } else {
        res.json({
          success: true,
          hasValidSession: false,
          message: 'No valid session found',
          correlationId
        });
      }
    } catch (sessionError) {
      logger.error('Error validating Voyager session', {
        correlationId,
        error: sessionError.message
      });
      
      res.json({
        success: true,
        hasValidSession: false,
        message: 'Session validation failed',
        correlationId
      });
    }
  } catch (error) {
    logger.error('Validate session route error', {
      correlationId: req.correlationId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Session validation failed',
      error: error.message,
      correlationId: req.correlationId
    });
  }
});

module.exports = router;
