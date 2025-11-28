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
  useTotalAmount,
  useBuyerJourneyIntercept,
} from "@shopify/ui-extensions-react/checkout";
import { useCallback, useState, useEffect } from "react";

// Checkout UI Extension for Voyager Miles integration
export default reactExtension("purchase.checkout.payment-method-list.render-after", () => (
  <VoyagerMilesCheckout />
));

function VoyagerMilesCheckout() {
  const translate = useTranslate();
  const { extension } = useApi();
  const instructions = useInstructions();
  const applyAttributeChange = useApplyAttributeChange();
  const attributes = useAttributes();
  const subtotalAmount = useSubtotalAmount?.() as any;
  const totalAmount = useTotalAmount?.() as any;

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

  // Intercept checkout submission to finalize points deduction when "Pay now" is clicked
  useBuyerJourneyIntercept(async ({ canBlockProgress }) => {
    // Only intercept if Voyager points are applied
    const pointsUsed = Number(
      attributes?.find?.((a: any) => a?.key === "voyager_points_used")?.value || 0
    );
    const sessionId = attributes?.find?.((a: any) => a?.key === "voyager_session_id")?.value || "";
    
    if (pointsUsed > 0 && sessionId) {
      console.log("[Voyager Checkout] Intercepting checkout submission to finalize points deduction", {
        pointsUsed,
        sessionId,
      });
      
      try {
        // Call API to finalize points deduction (issue certificate)
        // Note: We use a temporary order ID here, the webhook will update it with the real order ID
        const tempOrderId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const finalizeResponse = await fetch(`${API_URL}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            pointsUsed,
            orderId: tempOrderId, // Temporary ID, webhook will update with real order ID
          }),
        });

        if (!finalizeResponse.ok) {
          const errorData = await finalizeResponse.json();
          console.error("[Voyager Checkout] Points finalization failed:", errorData);
          
          if (canBlockProgress) {
            return {
              behavior: "block",
              reason: "Points deduction failed",
              errors: [
                {
                  message: errorData.message || "Failed to deduct Voyager miles. Please try again or contact support.",
                },
              ],
            };
          }
        }

        const finalizeData = await finalizeResponse.json();
        console.log("[Voyager Checkout] Points finalized successfully:", finalizeData);
        
        // Allow checkout to proceed
        return { behavior: "allow" };
      } catch (error: any) {
        console.error("[Voyager Checkout] Error during points finalization:", error);
        
        if (canBlockProgress) {
          return {
            behavior: "block",
            reason: "Points deduction error",
            errors: [
              {
                message: error.message || "An error occurred while processing your Voyager miles. Please try again.",
              },
            ],
          };
        }
      }
    }
    
    // If no Voyager points applied, allow checkout to proceed normally
    return { behavior: "allow" };
  });

  // Check for existing session from cart extension (via attributes)
  useEffect(() => {
    const sessionIdAttr = attributes?.find?.((a: any) => a?.key === "voyager_session_id");
    const sessionId = sessionIdAttr?.value || "";
    const memberNumberAttr = attributes?.find?.((a: any) => a?.key === "voyager_member_number")?.value || "";
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

    // If user logged in from cart (has sessionId), use existing session
    // Even if totalPointsAttr is 0, we should still use the session and fetch fresh balance
    if (sessionId && !approved) {
      console.log("[Voyager Checkout] Existing session from cart detected", {
        sessionId,
        memberNumber: memberNumberAttr,
        totalPoints: totalPointsAttr,
        pointsUsed: prefilledPointsUsed,
        remainingPoints: remainingPointsAttr,
        prefilledPointsRate,
      });
      
      // If we have cached points data, use it immediately
      if (totalPointsAttr > 0) {
        // Calculate remaining points (available miles after discount)
        const remaining = remainingPointsAttr > 0 
          ? remainingPointsAttr 
          : Math.max(0, totalPointsAttr - prefilledPointsUsed);
        
        // Use remaining points as available balance (what user can still use)
        const availableBalance = remaining;
        const calculatedDiscount = prefilledPointsUsed * prefilledPointsRate;
        
        setApproved(true);
        setPointsBalance(availableBalance);
        setPointsToApply(prefilledPointsUsed);
        setBalanceZar(availableBalance * prefilledPointsRate);
        setDiscountZar(calculatedDiscount);
      } else {
        // Session exists but no cached points - fetch fresh balance
        console.log("[Voyager Checkout] Session found but no cached points, fetching account summary...");
        setApproved(true); // Mark as approved so we don't show login form
        
        // Fetch account summary using existing session
        const fetchAccountSummary = async () => {
          try {
            setLoading(true);
            const summaryResponse = await fetch(`${API_URL}/account-summary`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId }),
            });

            if (summaryResponse.ok) {
              const summaryData = await summaryResponse.json();
              if (summaryData.success) {
                // Validate that the returned member number matches the expected one
                const returnedMemberId = summaryData.memberId || "";
                if (memberNumberAttr && returnedMemberId && memberNumberAttr !== returnedMemberId) {
                  console.error("[Voyager Checkout] Member number mismatch!", {
                    expected: memberNumberAttr,
                    returned: returnedMemberId,
                    sessionId,
                  });
                  setError(`Account mismatch detected. Expected member ${memberNumberAttr}, but got ${returnedMemberId}. Please log in again.`);
                  setApproved(false);
                  setLoading(false);
                  return;
                }
                
                const balance = summaryData.points || 0;
                const effectiveRate = prefilledPointsRate || pointsRate;
                
                setPointsBalance(balance);
                setBalanceZar(balance * effectiveRate);
                
                // Update attributes with fresh balance and ensure member number is set
                await setAttribute("voyager_total_points", balance.toString());
                await setAttribute("voyager_points_rate", effectiveRate.toString());
                if (memberNumberAttr) {
                  await setAttribute("voyager_member_number", memberNumberAttr);
                }
                if (returnedMemberId && !memberNumberAttr) {
                  await setAttribute("voyager_member_number", returnedMemberId);
                }
                
                console.log("[Voyager Checkout] Account summary fetched successfully", {
                  balance,
                  balanceZar: balance * effectiveRate,
                  memberId: returnedMemberId || memberNumberAttr,
                });
              } else {
                console.error("[Voyager Checkout] Account summary failed:", summaryData.message);
                setError(summaryData.message || "Failed to fetch account summary");
              }
            } else {
              console.error("[Voyager Checkout] Account summary request failed:", summaryResponse.status);
              setError("Failed to fetch account summary");
            }
          } catch (error) {
            console.error("[Voyager Checkout] Error fetching account summary:", error);
            setError("Network error while fetching account summary");
          } finally {
            setLoading(false);
          }
        };
        
        fetchAccountSummary();
      }
    }
  }, [attributes, pointsRate, approved, API_URL]);

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
      // Check if there's already a session from cart extension
      const existingSessionId = attributes?.find?.((a: any) => a?.key === "voyager_session_id")?.value || "";
      const existingMemberNumber = attributes?.find?.((a: any) => a?.key === "voyager_member_number")?.value || "";
      
      // If session exists and member number matches, reuse existing session
      if (existingSessionId && existingMemberNumber === userId) {
        console.log("[Voyager Checkout] Reusing existing session from cart", {
          sessionId: existingSessionId,
          memberNumber: existingMemberNumber,
        });
        
        // Fetch account summary using existing session
        const summaryResponse = await fetch(`${API_URL}/account-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: existingSessionId }),
        });

        if (summaryResponse.ok) {
          const summaryData = await summaryResponse.json();
          if (summaryData.success) {
            // Validate that the returned member number matches the expected one
            const returnedMemberId = summaryData.memberId || "";
            if (returnedMemberId && existingMemberNumber && returnedMemberId !== existingMemberNumber) {
              console.error("[Voyager Checkout] Member number mismatch when reusing session!", {
                expected: existingMemberNumber,
                returned: returnedMemberId,
                sessionId: existingSessionId,
              });
              setError(`Account mismatch detected. Expected member ${existingMemberNumber}, but got ${returnedMemberId}. Please log in again.`);
              setLoading(false);
              return;
            }
            
            const balance = summaryData.points || 0;
            const effectiveRate = pointsRate;
            
            setApproved(true);
            setPointsBalance(balance);
            setBalanceZar(balance * effectiveRate);
            
            // Update attributes with fresh data
            await setAttribute("voyager_session_id", existingSessionId);
            await setAttribute("voyager_member_number", existingMemberNumber || returnedMemberId);
            await setAttribute("voyager_total_points", balance.toString());
            await setAttribute("voyager_points_rate", effectiveRate.toString());
            
            setMessage("Session restored successfully!");
            setLoading(false);
            return;
          } else {
            console.error("[Voyager Checkout] Account summary validation failed:", summaryData.message);
            setError(summaryData.message || "Failed to validate session");
            setLoading(false);
            return;
          }
        } else {
          console.error("[Voyager Checkout] Account summary request failed:", summaryResponse.status);
          setError("Failed to validate existing session");
          setLoading(false);
          return;
        }
        
        // If session validation failed, continue with new authentication
        console.log("[Voyager Checkout] Existing session validation failed, creating new session");
      }
      
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
          throw new Error("Invalid Voyager credentials. Please use correct account credentials");
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

  // Get actual values directly from Shopify checkout hooks
  // useSubtotalAmount() returns the subtotal BEFORE discounts (matches "Subtotal" in order summary)
  // useTotalAmount() returns the final total AFTER all discounts and shipping (matches "Total" in order summary)
  // Note: The amount property from Shopify hooks is already in decimal format (e.g., 10972 = R 10,972.00)
  // We should NOT divide by 100 - the value is already in the correct format
  const subtotalRaw = subtotalAmount?.amount;
  const totalRaw = totalAmount?.amount;
  
  // Parse amounts directly - they're already in decimal format
  const subtotalBeforeDiscount = subtotalRaw != null 
    ? (typeof subtotalRaw === 'string' ? parseFloat(subtotalRaw) : Number(subtotalRaw))
    : 0;
  
  const finalTotal = totalRaw != null
    ? (typeof totalRaw === 'string' ? parseFloat(totalRaw) : Number(totalRaw))
    : 0;
  
  // Order Total = Subtotal (before discount) - use directly from useSubtotalAmount()
  const orderTotal = subtotalBeforeDiscount;
  
  // Total after applied Miles = Final Total (after discount) - use directly from useTotalAmount()
  const totalAfterMiles = finalTotal;
  
  console.log("[Voyager Checkout] Order calculation (direct from Shopify hooks - no division)", {
    subtotalAmount: subtotalAmount,
    totalAmount: totalAmount,
    subtotalRaw,
    totalRaw,
    subtotalBeforeDiscount,
    finalTotal,
    discountZar,
    orderTotal,
    totalAfterMiles,
    pointsBalance,
    pointsToApply
  });

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
            required
          />

          <TextField
            label="Pin"
            value={pin}
            onChange={setPin}
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
            <InlineStack spacing="base">
              <Text>Available Miles:</Text>
              <Text emphasis="bold">{pointsBalance.toLocaleString()}</Text>
            </InlineStack>
            <InlineStack spacing="base">
              <Text>Value in ZAR:</Text>
              <Text emphasis="bold">R {balanceZar.toFixed(2)}</Text>
            </InlineStack>
            <InlineStack spacing="base">
              <Text>Order Total:</Text>
              <Text emphasis="bold">R {orderTotal.toFixed(2)}</Text>
            </InlineStack>
            <InlineStack spacing="base">
              <Text emphasis="bold">Total after applied Miles:</Text>
              <Text emphasis="bold">R {totalAfterMiles.toFixed(2)}</Text>
            </InlineStack>
          </BlockStack>

          {/* ZAR Input for Partial or Full Redemption - Match cart extension */}
          {pointsToApply === 0 && (
            <BlockStack spacing="base">
              <BlockStack spacing="tight">
                <BlockStack spacing="tight">
                  <TextField
                    label=""
                    value={zarToApply}
                    onChange={setZarToApply}
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
                  disabled={
                    (zarToApply && (parseFloat(zarToApply) <= 0 || parseFloat(zarToApply) > balanceZar)) ||
                    (!zarToApply && (orderTotal <= 0 || orderTotal > balanceZar))
                  }
                  onPress={async () => {
                    setLoading(true);
                    setError("");
                    setMessage("");
                    
                    try {
                      // If ZAR amount is entered, use it; otherwise apply full order amount
                      const zarAmount = zarToApply ? parseFloat(zarToApply) : orderTotal;
                      const pointsNeeded = Math.ceil(zarAmount / effectivePointsRate);
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
                      setZarToApply(""); // Clear input after applying
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
              </InlineStack>
            </BlockStack>
          )}

          {/* Applied Points Success Message with Remove Button */}
          {pointsToApply > 0 && (
            <BlockStack spacing="base">
              <Banner status="success">
                <InlineStack spacing="tight" blockAlignment="center">
                  <Text>✈️</Text>
                  <Text emphasis="bold">Voyager Miles Applied Successfully</Text>
                </InlineStack>
              </Banner>
              <Button
                kind="secondary"
                onPress={async () => {
                  setLoading(true);
                  setError("");
                  setMessage("");
                  
                  try {
                    // Clear all Voyager discount attributes
                    await setAttribute("voyager_points_used", "0");
                    await setAttribute("voyager_discount_amount", "0");
                    await setAttribute("voyager_points_value", "0");
                    await setAttribute("voyager_remaining_points", pointsBalance.toString());
                    
                    // Reset state
                    setPointsToApply(0);
                    setDiscountZar(0);
                    setMessage("Discount removed successfully");
                    
                    console.log("[Voyager Checkout] ✅ Discount removed");
                  } catch (e: any) {
                    setError(e.message || "Failed to remove discount.");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                REMOVE DISCOUNT
              </Button>
            </BlockStack>
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