import {
  DiscountClass,
  OrderDiscountSelectionStrategy,
  CartInput,
  CartLinesDiscountsGenerateRunResult,
} from '../generated/api';

export function cartLinesDiscountsGenerateRun(
  input: CartInput,
): CartLinesDiscountsGenerateRunResult {
  // Early return if no cart lines
  if (!input.cart.lines.length) {
    return { operations: [] };
  }

  // Check if this is an order discount (cart-level discount)
  const hasOrderDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Order,
  );

  if (!hasOrderDiscountClass) {
    return { operations: [] };
  }

  // Read Voyager data from aliased cart attributes (defined in input.graphql)
  const pointsUsedStr = input.cart.voyagerPointsUsed?.value;
  const pointsRateStr = input.cart.voyagerPointsRate?.value;
  const sessionIdStr = input.cart.voyagerSessionId?.value;

  // Validate all required attributes exist
  if (!pointsUsedStr || !pointsRateStr || !sessionIdStr) {
    return { operations: [] };
  }

  try {
    // Parse and validate values
    const pointsUsed = parseInt(pointsUsedStr, 10);
    const pointsRate = parseFloat(pointsRateStr);

    if (!Number.isFinite(pointsUsed) || !Number.isFinite(pointsRate)) {
      return { operations: [] };
    }

    if (pointsUsed <= 0 || pointsRate <= 0) {
      return { operations: [] };
    }

    // Calculate discount amount (points * rate)
    let discountAmount = pointsUsed * pointsRate;

    // Calculate cart subtotal from cart lines
    let subtotal = 0;
    for (const line of input.cart.lines) {
      if (line.cost?.subtotalAmount?.amount) {
        subtotal += parseFloat(line.cost.subtotalAmount.amount as unknown as string);
      }
    }

    if (!(subtotal > 0)) {
      return { operations: [] };
    }

    // Cap discount at subtotal (can't have negative total)
    if (discountAmount > subtotal) {
      discountAmount = subtotal;
    }

    if (!(discountAmount > 0)) {
      return { operations: [] };
    }

    // Get currency from first cart line (assuming consistent currency)
    const currencyCode = (input.cart.lines[0]?.cost?.subtotalAmount as any)?.currencyCode || 'ZAR';

    const discountMoney = {
      amount: discountAmount.toFixed(2),
      currencyCode,
    } as const;

    const operations = [{
      orderDiscountsAdd: {
        candidates: [
          {
            message: `Voyager Points Discount (${pointsUsed.toLocaleString()} points = ${discountMoney.currencyCode} ${discountMoney.amount})`,
            targets: [
              {
                orderSubtotal: {
                  excludedCartLineIds: [],
                },
              },
            ],
            value: {
              fixedAmount: {
                amount: discountMoney.amount,
                currencyCode: discountMoney.currencyCode,
              },
            },
          },
        ],
        selectionStrategy: OrderDiscountSelectionStrategy.First,
      },
    }];

    return { operations };
  } catch (_error) {
    return { operations: [] };
  }
}