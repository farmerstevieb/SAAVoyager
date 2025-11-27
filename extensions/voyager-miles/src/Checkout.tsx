import {
  reactExtension,
  Banner,
  BlockStack,
  Text,
  TextField,
  Button,
  InlineStack,
  useApi,
  useApplyAttributeChange,
  useInstructions,
  useTranslate,
  useAttributes,
  useSubtotalAmount,
} from "@shopify/ui-extensions-react/checkout";
import { useCallback, useState, useEffect } from "react";

// Checkout UI Extension for Voyager Miles integration
export default reactExtension("purchase.checkout.payment-method-list.render-before", () => (
  <VoyagerMilesCheckout />
));

function VoyagerMilesCheckout() {
  const translate = useTranslate();
  const { extension } = useApi();
  const instructions = useInstructions();
  const applyAttributeChange = useApplyAttributeChange();
  const attributes = useAttributes();
  const subtotalAmount = useSubtotalAmount?.() as any;

  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [pointsToApply, setPointsToApply] = useState(0);
  const [balanceZar, setBalanceZar] = useState(0);
  const [discountZar, setDiscountZar] = useState(0);
  const [zarToApply, setZarToApply] = useState("");

  // Console log component initialization
  console.log("[Voyager Checkout] Component initialized", {
    attributes: attributes,
    subtotalAmount: subtotalAmount,
    canUpdateAttributes: instructions.attributes.canUpdateAttributes,
  });

  // Configure API endpoint (hardcoded for now)
  const API_URL = "https://saa-voyager-app-prod.tofmail2022.workers.dev/api/voyager";
  const SETTINGS_API_URL = "https://saa-voyager-app-prod.tofmail2022.workers.dev/api/settings/points-rate";
  const DEFAULT_POINTS_RATE = 0.1; // Fallback default rate

  // State for conversion rate fetched from API
  const [pointsRate, setPointsRate] = useState(DEFAULT_POINTS_RATE);
  const [rateLoaded, setRateLoaded] = useState(false);

  // Fetch conversion rate from API on component mount
  useEffect(() => {
    const fetchConversionRate = async () => {
      try {
        console.log("[Voyager Checkout] Fetching conversion rate from:", SETTINGS_API_URL);
        const response = await fetch(SETTINGS_API_URL);
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.pointsToZarRate) {
            const rate = parseFloat(data.pointsToZarRate);
            if (!isNaN(rate) && rate > 0) {
              console.log("[Voyager Checkout] Conversion rate loaded:", rate);
              setPointsRate(rate);
              setRateLoaded(true);
              return;
            }
          }
        }
        console.warn("[Voyager Checkout] Failed to fetch conversion rate, using default:", DEFAULT_POINTS_RATE);
        setRateLoaded(true);
      } catch (error) {
        console.error("[Voyager Checkout] Error fetching conversion rate:", error);
        setRateLoaded(true);
      }
    };

    fetchConversionRate();
  }, []);

  // Check for existing session from cart extension (via attributes)
  useEffect(() => {
    const sessionIdAttr = attributes?.find?.((a: any) => a?.key === "voyager_session_id");
    const sessionId = sessionIdAttr?.value || "";
    const prefilledPointsUsed = Number(
      attributes?.find?.((a: any) => a?.key === "voyager_points_used")?.value || 0
    );
    const prefilledPointsRate = Number(
      attributes?.find?.((a: any) => a?.key === "voyager_points_rate")?.value || pointsRate
    );
    const totalPointsAttr = Number(
      attributes?.find?.((a: any) => a?.key === "voyager_total_points")?.value || 0
    );
    const remainingPointsAttr = Number(
      attributes?.find?.((a: any) => a?.key === "voyager_remaining_points")?.value || 0
    );

    // If user logged in from cart, show points display
    if (sessionId && totalPointsAttr > 0 && !approved) {
      const remaining = remainingPointsAttr || Math.max(0, totalPointsAttr - prefilledPointsUsed);
      const calculatedBalance = totalPointsAttr || remaining + prefilledPointsUsed;
      const calculatedDiscount = prefilledPointsUsed * prefilledPointsRate;
      
      console.log("[Voyager Checkout] Existing session from cart detected", {
        sessionId,
        remaining,
        calculatedBalance,
        calculatedDiscount,
        prefilledPointsUsed,
        prefilledPointsRate,
      });
      
      setApproved(true);
      setPointsBalance(calculatedBalance);
      setPointsToApply(prefilledPointsUsed);
      setBalanceZar(calculatedBalance * prefilledPointsRate);
      setDiscountZar(calculatedDiscount);
    }
  }, [attributes, pointsRate, approved]);

  // Check if cart attributes can be updated
  if (!instructions.attributes.canUpdateAttributes) {
    return (
      <Banner title="SAA Voyager Miles" status="warning">
        Voyager Miles integration is not available for this checkout type.
      </Banner>
    );
  }

  // Get current values from attributes for calculations
  const prefilledPointsUsed = Number(
    attributes?.find?.((a: any) => a?.key === "voyager_points_used")?.value || 0
  );
  const prefilledPointsRate = Number(
    attributes?.find?.((a: any) => a?.key === "voyager_points_rate")?.value || pointsRate
  );

  // Use prefilled rate from attributes if available, otherwise use API-fetched rate
  const effectivePointsRate = prefilledPointsRate || pointsRate;

  console.log("[Voyager Checkout] Cart attributes read", {
    prefilledPointsUsed,
    prefilledPointsRate,
    approved,
    pointsToApply,
    allAttributes: attributes,
  });

  // Helper function to set cart attributes
  async function setAttribute(key, value) {
    console.log("[Voyager Checkout] Setting cart attribute", { key, value });
    const result = await applyAttributeChange({
      key,
      type: "updateAttribute",
      value,
    });
    console.log("[Voyager Checkout] Cart attribute set", { key, value, result });
    return result;
  }

  // Handle Voyager authentication and points application
  const handleCheckAndApply = useCallback(async () => {
    console.log("[Voyager Checkout] Starting points application", { userId, pin });
    setError("");
    setMessage("");
    setLoading(true);
    
    try {
      // Store Voyager credentials in cart attributes
      console.log("[Voyager Checkout] Setting user credentials");
      await setAttribute("voyager_user_id", userId);
      await setAttribute("voyager_pin_provided", pin ? "yes" : "no");

      // Step 1: Authenticate with Voyager
      console.log("[Voyager Checkout] Step 1: Authenticating with Voyager API");
      const authResponse = await fetch(`${API_URL}/authenticate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userId, password: pin }),
      });

      console.log("[Voyager Checkout] Authentication response", {
        status: authResponse.status,
        ok: authResponse.ok,
      });

      if (!authResponse.ok) {
        if (authResponse.status === 401) {
          throw new Error("Invalid Voyager credentials. Please use: Voyager Number: 500365586, PIN: 2222");
        }
        throw new Error(`Authentication failed: ${authResponse.status}`);
      }

      const authData = await authResponse.json();
      console.log("[Voyager Checkout] Authentication data", authData);
      
      if (!authData.success) {
        throw new Error(authData.message || "Authentication failed");
      }

      // Store session data
      console.log("[Voyager Checkout] Storing session data", {
        sessionId: authData.sessionId,
        memberNumber: authData.memberNumber,
      });
      await setAttribute("voyager_session_id", authData.sessionId);
      await setAttribute("voyager_member_number", authData.memberNumber);

      // Step 2: Get account summary (points balance)
      console.log("[Voyager Checkout] Step 2: Fetching account summary");
      const summaryResponse = await fetch(`${API_URL}/account-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: authData.sessionId }),
      });

      console.log("[Voyager Checkout] Account summary response", {
        status: summaryResponse.status,
        ok: summaryResponse.ok,
      });

      if (!summaryResponse.ok) {
        throw new Error("Failed to fetch points balance");
      }

      const summaryData = await summaryResponse.json();
      console.log("[Voyager Checkout] Account summary data", summaryData);
      
      if (!summaryData.success) {
        throw new Error(summaryData.message || "Failed to get points balance");
      }

      const balance = summaryData.points;
      console.log("[Voyager Checkout] Points balance retrieved", {
        balance,
        balanceZar: balance * effectivePointsRate,
      });
      setPointsBalance(balance);
      setBalanceZar(balance * effectivePointsRate);

      // Store points data in cart attributes (but don't apply discount yet)
      console.log("[Voyager Checkout] Storing points data in cart attributes");
      await setAttribute("voyager_total_points", balance.toString());
      await setAttribute("voyager_points_rate", effectivePointsRate.toString());

      setApproved(true);
      setMessage("Login successful! You can now apply Voyager Miles.");
      
      console.log("[Voyager Checkout] ✅ Login complete - ready to apply miles");

    } catch (e) {
      console.error("[Voyager Checkout] ❌ Error applying points:", e);
      setError(e.message || "Failed to apply Voyager points. Please try again.");
      setApproved(false);
      
      // Clear any partial data
      console.log("[Voyager Checkout] Clearing partial data due to error");
      await setAttribute("voyager_intent", "none");
      await setAttribute("voyager_points_used", "0");
    } finally {
      setLoading(false);
      console.log("[Voyager Checkout] Points application process completed");
    }
  }, [API_URL, userId, pin, effectivePointsRate, subtotalAmount]);

  // Handle applying ZAR discount (without triggering discount function)
  const handleApplyZarDiscount = useCallback(async () => {
    console.log("[Voyager Checkout] Applying ZAR discount", { zarToApply });
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const zarAmount = parseFloat(zarToApply);
      
      if (!zarAmount || zarAmount <= 0) {
        setError("Please enter a valid discount amount in ZAR.");
        setLoading(false);
        return;
      }

      // Calculate points needed for this ZAR amount
      const pointsNeeded = Math.ceil(zarAmount / effectivePointsRate);
      const maxAvailableZar = pointsBalance * effectivePointsRate;

      if (zarAmount > maxAvailableZar) {
        setError(`You can only discount up to R${maxAvailableZar.toFixed(2)} (${pointsBalance.toLocaleString()} points)`);
        setLoading(false);
        return;
      }

      // Recalculate actual discount amount based on points used (to avoid rounding issues)
      const discountAmount = pointsNeeded * effectivePointsRate;
      const remainingPoints = pointsBalance - pointsNeeded;

      console.log("[Voyager Checkout] ZAR discount calculation", {
        zarAmount,
        pointsNeeded,
        discountAmount,
        remainingPoints,
      });

      // Get session ID from attributes (set during login) - required by discount function
      const sessionIdAttr = attributes?.find?.((a: any) => a?.key === "voyager_session_id");
      const sessionId = sessionIdAttr?.value || "";
      
      if (!sessionId) {
        setError("Session ID not found. Please log in again.");
        setLoading(false);
        return;
      }

      // Store points data in cart attributes
      // The existing discount function (voyager-miles-discount) will automatically read these attributes
      // and apply the discount when Shopify evaluates discounts
      await setAttribute("voyager_points_used", pointsNeeded.toString());
      await setAttribute("voyager_points_rate", effectivePointsRate.toString());
      await setAttribute("voyager_session_id", sessionId);
      await setAttribute("voyager_total_points", pointsBalance.toString());
      await setAttribute("voyager_remaining_points", remainingPoints.toString());
      await setAttribute("voyager_discount_amount", discountAmount.toFixed(2));
      await setAttribute("voyager_points_value", discountAmount.toString());

      setPointsToApply(pointsNeeded);
      setDiscountZar(discountAmount);
      setMessage(
        `Discount applied: R${discountAmount.toFixed(2)} (${pointsNeeded.toLocaleString()} points). ` +
        `Remaining: ${remainingPoints.toLocaleString()} points.`
      );

      console.log("[Voyager Checkout] ✅ ZAR discount applied - discount function will use existing discount", {
        discountAmount,
        pointsNeeded,
        sessionId,
      });

    } catch (e) {
      console.error("[Voyager Checkout] ❌ Error applying ZAR discount:", e);
      setError(e.message || "Failed to apply discount amount. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [zarToApply, effectivePointsRate, pointsBalance, attributes]);

  // Handle removing Voyager points
  const handleRemoveMiles = useCallback(async () => {
    console.log("[Voyager Checkout] Removing Voyager points");
    setLoading(true);
    setError("");
    setMessage("");
    
    try {
      // Clear all Voyager attributes
      console.log("[Voyager Checkout] Clearing all Voyager attributes");
      await setAttribute("voyager_user_id", "");
      await setAttribute("voyager_session_id", "");
      await setAttribute("voyager_points_used", "0");
      await setAttribute("voyager_discount_amount", "0");
      await setAttribute("voyager_intent", "none");
      
      setApproved(false);
      setPointsBalance(0);
      setPointsToApply(0);
      setMessage("Voyager points removed successfully.");
      
      console.log("[Voyager Checkout] ✅ Voyager points removed - discount should be cleared");
      
    } catch (e) {
      console.error("[Voyager Checkout] ❌ Error removing Voyager points:", e);
      setError("Could not remove Voyager points. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Calculate order total and total after miles
  const orderTotal = subtotalAmount?.amount ? parseFloat(subtotalAmount.amount) / 100 : 0;
  const totalAfterMiles = Math.max(0, orderTotal - discountZar);

  return (
    <BlockStack spacing="base">
      {/* Header - Match cart extension design */}
      <BlockStack spacing="tight">
        <Text emphasis="bold" size="large">
          PAY WITH SAA VOYAGER MILES
        </Text>
      </BlockStack>

      {!approved ? (
        /* Login Form - Match cart extension design */
        <BlockStack spacing="base">
          {/* Login Header with Icon */}
          <BlockStack spacing="tight">
            <InlineStack spacing="tight" blockAlignment="center">
              <Text size="large">✈️</Text>
              <Text emphasis="bold" size="large">
                SAA Voyager Miles
              </Text>
            </InlineStack>
            <Text appearance="subdued" size="small">
              Log in securely to view your balance and apply Miles to this purchase
            </Text>
          </BlockStack>

          <TextField
            label="Voyager Number"
            value={userId}
            onChange={setUserId}
            placeholder="Enter your Voyager number"
            required
          />

          <TextField
            label="Pin"
            value={pin}
            onChange={setPin}
            placeholder="Enter your PIN"
            required
          />

          {/* Button Group - Match cart extension */}
          <InlineStack spacing="base">
            <Button
              kind="secondary"
              onPress={() => {
                setUserId("");
                setPin("");
                setError("");
                setMessage("");
              }}
            >
              CANCEL
            </Button>
            <Button
              kind="primary"
              loading={loading}
              disabled={!userId || !pin}
              onPress={handleCheckAndApply}
            >
              LOGIN & CHECK MILES
            </Button>
          </InlineStack>

          {/* Disclaimer - Match cart extension */}
          <Text appearance="subdued" size="small">
            *If you'd like to pay for your full order and delivery using Voyager Miles, you can do so on the final payment page.
          </Text>

          {error && (
            <Banner status="critical">
              <Text size="small">{error}</Text>
            </Banner>
          )}
          {message && (
            <Banner status="info">
              <Text size="small">{message}</Text>
            </Banner>
          )}
        </BlockStack>
      ) : (
        /* Points Display - Match cart extension design */
        <BlockStack spacing="base">
          {/* Points Header with Icon */}
          <BlockStack spacing="tight">
            <InlineStack spacing="tight" blockAlignment="center">
              <Text size="large">✈️</Text>
              <Text emphasis="bold" size="large">
                SAA Voyager Miles
              </Text>
            </InlineStack>
          </BlockStack>

          {/* Points Info - Match cart extension layout */}
          <BlockStack spacing="tight">
            <InlineStack spacing="base" blockAlignment="spaceBetween">
              <Text>Available Miles:</Text>
              <Text emphasis="bold">{pointsBalance.toLocaleString()}</Text>
            </InlineStack>
            <InlineStack spacing="base" blockAlignment="spaceBetween">
              <Text>Value in ZAR:</Text>
              <Text emphasis="bold">R {balanceZar.toFixed(2)}</Text>
            </InlineStack>
            <InlineStack spacing="base" blockAlignment="spaceBetween">
              <Text>Order Total:</Text>
              <Text emphasis="bold">R {orderTotal.toFixed(2)}</Text>
            </InlineStack>
            <InlineStack spacing="base" blockAlignment="spaceBetween">
              <Text emphasis="bold">Total after applied Miles:</Text>
              <Text emphasis="bold" size="large">R {totalAfterMiles.toFixed(2)}</Text>
            </InlineStack>
          </BlockStack>

          {/* ZAR Input for Partial Redemption - Match cart extension */}
          {pointsToApply === 0 && (
            <BlockStack spacing="base">
              <BlockStack spacing="tight">
                <Text size="small">Enter the Rand amount you would like to redeem</Text>
                <BlockStack spacing="tight">
                  <TextField
                    type="number"
                    value={zarToApply}
                    onChange={setZarToApply}
                    placeholder="R 100"
                  />
                  {zarToApply && (
                    <Text appearance="subdued" size="small">
                      = {Math.ceil(parseFloat(zarToApply) / effectivePointsRate).toLocaleString()} points
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>

              {/* Button Group - Match cart extension */}
              <InlineStack spacing="base">
                <Button
                  kind="secondary"
                  onPress={() => {
                    setZarToApply("");
                    setError("");
                    setMessage("");
                  }}
                >
                  CANCEL
                </Button>
                <Button
                  kind="primary"
                  loading={loading}
                  disabled={!zarToApply || parseFloat(zarToApply) <= 0 || parseFloat(zarToApply) > balanceZar}
                  onPress={handleApplyZarDiscount}
                >
                  APPLY MILES
                </Button>
              </InlineStack>
            </BlockStack>
          )}

          {/* Apply Full Order Amount Button */}
          {pointsToApply === 0 && (
            <Button
              kind="primary"
              loading={loading}
              disabled={orderTotal <= 0 || orderTotal > balanceZar}
              onPress={async () => {
                setLoading(true);
                setError("");
                setMessage("");
                
                try {
                  const pointsNeeded = Math.ceil(orderTotal / effectivePointsRate);
                  const discountAmount = pointsNeeded * effectivePointsRate;
                  const remainingPoints = pointsBalance - pointsNeeded;
                  
                  // Get session ID from attributes
                  const sessionIdAttr = attributes?.find?.((a: any) => a?.key === "voyager_session_id");
                  const sessionId = sessionIdAttr?.value || "";
                  
                  if (!sessionId) {
                    setError("Session ID not found. Please log in again.");
                    setLoading(false);
                    return;
                  }
                  
                  await setAttribute("voyager_points_used", pointsNeeded.toString());
                  await setAttribute("voyager_points_rate", effectivePointsRate.toString());
                  await setAttribute("voyager_remaining_points", remainingPoints.toString());
                  await setAttribute("voyager_discount_amount", discountAmount.toFixed(2));
                  await setAttribute("voyager_points_value", discountAmount.toString());
                  await setAttribute("voyager_session_id", sessionId);
                  await setAttribute("voyager_total_points", pointsBalance.toString());
                  
                  setPointsToApply(pointsNeeded);
                  setDiscountZar(discountAmount);
                  setMessage("Voyager Miles applied successfully!");
                } catch (e: any) {
                  setError(e.message || "Failed to apply Voyager Miles.");
                } finally {
                  setLoading(false);
                }
              }}
            >
              APPLY MILES
            </Button>
          )}

          {/* Applied Points Success Message */}
          {pointsToApply > 0 && (
            <Banner status="success">
              <InlineStack spacing="tight" blockAlignment="center">
                <Text>✈️</Text>
                <Text emphasis="bold">Voyager Miles Applied Successfully</Text>
              </InlineStack>
            </Banner>
          )}

          {/* Disclaimer - Match cart extension */}
          <Text appearance="subdued" size="small">
            *If you'd like to pay for your full order and delivery using Voyager Miles, you can do so on the final payment page.
          </Text>

          {message && pointsToApply === 0 && (
            <Banner status="info">
              <Text size="small">{message}</Text>
            </Banner>
          )}
          
          {error && (
            <Banner status="critical">
              <Text size="small">{error}</Text>
            </Banner>
          )}
        </BlockStack>
      )}
    </BlockStack>
  );
}