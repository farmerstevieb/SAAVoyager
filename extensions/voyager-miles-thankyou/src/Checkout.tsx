import {
  reactExtension,
  Banner,
  BlockStack,
  Text,
  useApi,
  useTranslate,
  InlineStack,
  Divider,
  Button,
  useAttributes,
} from "@shopify/ui-extensions-react/checkout";
import { useEffect, useMemo, useState } from "react";

// Thank you page extension for order completion and points finalization
export default reactExtension("purchase.thank-you.block.render", () => <VoyagerMilesThankYou />);

function VoyagerMilesThankYou() {
  const translate = useTranslate();
  const { extension } = useApi();
  const attributes = useAttributes?.();

  // Define settings directly in the component
  const voyagerApiUrl = "https://saa-voyager-app-prod.tofmail2022.workers.dev/api/voyager";
  const settingsApiUrl = "https://saa-voyager-app-prod.tofmail2022.workers.dev/api/settings/points-rate";
  const defaultPointsRate = 0.1; // Fallback default rate

  // State for conversion rate fetched from API
  const [apiPointsRate, setApiPointsRate] = useState<number | null>(null);

  // Helper to read attribute value by key
  const getAttr = (key: string): string | undefined => {
    try {
      const a = attributes?.find?.((x: any) => x?.key === key);
      if (a?.value != null) return String(a.value);
    } catch (_e) {}
    return undefined;
  };

  // Fetch conversion rate from API on component mount
  useEffect(() => {
    const fetchConversionRate = async () => {
      try {
        console.log("[Voyager Thank You] Fetching conversion rate from:", settingsApiUrl);
        const response = await fetch(settingsApiUrl);
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.pointsToZarRate) {
            const rate = parseFloat(data.pointsToZarRate);
            if (!isNaN(rate) && rate > 0) {
              console.log("[Voyager Thank You] Conversion rate loaded:", rate);
              setApiPointsRate(rate);
              return;
            }
          }
        }
        console.warn("[Voyager Thank You] Failed to fetch conversion rate, using default:", defaultPointsRate);
      } catch (error) {
        console.error("[Voyager Thank You] Error fetching conversion rate:", error);
      }
    };

    fetchConversionRate();
  }, []);

  // Resolve values strictly from checkout attributes
  const sessionId = getAttr('voyager_session_id') ?? '';
  const pointsUsedStr = getAttr('voyager_points_used') ?? '0';
  const pointsRateStr = getAttr('voyager_points_rate') ?? '';
  const totalPointsStr = getAttr('voyager_total_points') ?? '0';
  const remainingPointsStr = getAttr('voyager_remaining_points') ?? '';
  const originalTotalStr = getAttr('voyager_original_total') ?? '';

  const pointsUsed = useMemo(() => parseInt(pointsUsedStr || '0', 10) || 0, [pointsUsedStr]);
  
  // Use rate from attributes if available, otherwise use API-fetched rate, otherwise default
  const pointsRate = useMemo(() => {
    if (pointsRateStr) {
      const attrRate = parseFloat(pointsRateStr);
      if (!isNaN(attrRate) && attrRate > 0) {
        return attrRate;
      }
    }
    if (apiPointsRate !== null) {
      return apiPointsRate;
    }
    return defaultPointsRate;
  }, [pointsRateStr, apiPointsRate]);
  const originalTotalZar = useMemo(() => {
    const p = parseFloat(originalTotalStr || '');
    return Number.isFinite(p) ? p : null;
  }, [originalTotalStr]);

  // Derived local values from attributes
  let initialTotalPoints = parseInt(totalPointsStr || '0', 10) || 0;
  let initialRemainingPoints = remainingPointsStr ? (parseInt(remainingPointsStr, 10) || 0) : (initialTotalPoints ? Math.max(0, initialTotalPoints - pointsUsed) : 0);
  const discountAmount = pointsUsed * pointsRate;

  // Runtime state for API-fetched remaining points
  const [fetchedRemainingPoints, setFetchedRemainingPoints] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string>("");

  // Fetch latest remaining points from backend using the session id from attributes
  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        setFetchError("");
        const res = await fetch(`${voyagerApiUrl}/account-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
        if (!res.ok) {
          setFetchError(`Account summary failed: ${res.status}`);
          return;
        }
        const data = await res.json();
        if (data && data.success && typeof data.points === 'number') {
          setFetchedRemainingPoints(data.points);
        } else {
          setFetchError('Invalid account summary response');
        }
      } catch (e: any) {
        setFetchError(e?.message || 'Network error fetching account summary');
      }
    })();
  }, [sessionId]);

  // Prefer API-fetched remaining points if available
  const effectiveRemainingPoints = fetchedRemainingPoints != null ? fetchedRemainingPoints : initialRemainingPoints;
  const inferredTotalPoints = initialTotalPoints || (effectiveRemainingPoints + pointsUsed);

  return (
    <BlockStack spacing="tight">
      <Banner title="Order Complete - Voyager Points Summary" status="success">
        <BlockStack spacing="tight">
         
          
          {fetchError && (
            <Text appearance="critical" size="small">{fetchError}</Text>
          )}
          
          {(pointsUsed > 0 || inferredTotalPoints > 0) ? (
            <>
              <InlineStack spacing="tight" blockAlignment="center">
                <Text>Total Points (before order):</Text>
                <Text emphasis="bold">{inferredTotalPoints.toLocaleString()} points</Text>
              </InlineStack>
              
              <InlineStack spacing="tight" blockAlignment="center">
                <Text>Points Used:</Text>
                <Text emphasis="bold">{pointsUsed.toLocaleString()} points</Text>
              </InlineStack>
              
              <InlineStack spacing="tight" blockAlignment="center">
                <Text>Available Points (after order):</Text>
                <Text emphasis="bold">{Math.max(0, effectiveRemainingPoints).toLocaleString()} points</Text>
              </InlineStack>

              <InlineStack spacing="tight" blockAlignment="center">
                <Text>Discount Applied (ZAR):</Text>
                <Text emphasis="bold" appearance="accent">R{discountAmount.toFixed(2)}</Text>
              </InlineStack>

              {originalTotalZar != null && (
                <InlineStack spacing="tight" blockAlignment="center">
                  <Text>Original Order Total:</Text>
                  <Text emphasis="bold">R{originalTotalZar.toFixed(2)}</Text>
                </InlineStack>
              )}


            </>
          ) : (
            <>
              <InlineStack spacing="tight" blockAlignment="center">
                <Text>Order Status:</Text>
                <Text emphasis="bold">Successfully completed</Text>
              </InlineStack>

              <Divider />

              <Text appearance="subdued" size="small">
                We could not detect Voyager points data for this order.
              </Text>
            </>
          )}
        </BlockStack>
      </Banner>
    </BlockStack>
  );
}
