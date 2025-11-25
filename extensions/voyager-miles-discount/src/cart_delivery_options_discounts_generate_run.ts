import {
  DeliveryDiscountSelectionStrategy,
  DiscountClass,
  DeliveryInput,
  CartDeliveryOptionsDiscountsGenerateRunResult,
} from "../generated/api";

export function cartDeliveryOptionsDiscountsGenerateRun(
  input: DeliveryInput,
): CartDeliveryOptionsDiscountsGenerateRunResult {
  // Voyager Miles discounts are applied to order total, not delivery
  // Return no operations for delivery discounts
  return { operations: [] };
}