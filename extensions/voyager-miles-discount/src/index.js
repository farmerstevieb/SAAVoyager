export const cartLinesDiscountsGenerateRun = ({ cart, discount }) => {
  try {
    // Require at least one line
    if (!cart?.lines || cart.lines.length === 0) {
      return { operations: [] };
    }

    // Read cart attributes as defined in input.graphql (aliased fields)
    const pointsUsedStr = cart?.voyagerPointsUsed?.value;
    const pointsRateStr = cart?.voyagerPointsRate?.value;
    const sessionIdStr = cart?.voyagerSessionId?.value;

    if (!pointsUsedStr || !pointsRateStr || !sessionIdStr) {
      return { operations: [] };
    }

    const pointsUsed = parseInt(pointsUsedStr, 10);
    const pointsRate = parseFloat(pointsRateStr);

    if (!Number.isFinite(pointsUsed) || !Number.isFinite(pointsRate)) {
      return { operations: [] };
    }
    if (pointsUsed <= 0 || pointsRate <= 0) {
      return { operations: [] };
    }

    // Prefer cart cost subtotal if present
    let subtotal = 0;
    if (cart?.cost?.subtotalAmount?.amount != null) {
      subtotal = parseFloat(String(cart.cost.subtotalAmount.amount));
    }
    if (!(subtotal > 0)) {
      // Fallback: sum line subtotals
      subtotal = cart.lines.reduce((sum, line) => {
        const amt = line?.cost?.subtotalAmount?.amount;
        return sum + (amt != null ? parseFloat(String(amt)) : 0);
      }, 0);
    }
    if (!(subtotal > 0)) {
      return { operations: [] };
    }

    // Calculate discount and cap at subtotal
    let discountAmount = pointsUsed * pointsRate;
    if (discountAmount > subtotal) discountAmount = subtotal;
    if (!(discountAmount > 0)) return { operations: [] };

    const currencyCode = (cart?.cost?.subtotalAmount?.currencyCode) || (cart.lines[0]?.cost?.subtotalAmount?.currencyCode) || 'ZAR';
    const amountStr = discountAmount.toFixed(2);

    return {
      operations: [
        {
          orderDiscountsAdd: {
            candidates: [
              {
                message: `Voyager Points Discount`,
                targets: [
                  { orderSubtotal: { excludedCartLineIds: [] } }
                ],
                value: {
                  fixedAmount: {
                    amount: amountStr
                  }
                }
              }
            ],
            // Choose the first (and only) candidate
            selectionStrategy: "FIRST"
          }
        }
      ]
    };
  } catch (_e) {
    return { operations: [] };
  }
};
