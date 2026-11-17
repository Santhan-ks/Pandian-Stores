import { Decimal } from "decimal.js";
export const unitDefinitions = {
  g: ["mass", "1"],
  kg: ["mass", "1000"],
  ml: ["volume", "1"],
  L: ["volume", "1000"],
  piece: ["piece", "1"],
  packet: ["packet", "1"],
  carton: ["carton", "1"],
} as const;
export type Unit = keyof typeof unitDefinitions;
export function convert(
  quantity: string,
  from: Unit,
  to: Unit,
  cartonCapacity?: number,
): string {
  const amount = new Decimal(quantity);
  if (!amount.isFinite() || amount.isNegative())
    throw new Error("Quantity must be a nonnegative decimal.");
  if (unitDefinitions[from][0] === unitDefinitions[to][0])
    return amount
      .mul(unitDefinitions[from][1])
      .div(unitDefinitions[to][1])
      .toFixed();
  if (
    cartonCapacity &&
    Number.isSafeInteger(cartonCapacity) &&
    cartonCapacity > 0
  ) {
    if (from === "carton" && to === "packet")
      return amount.mul(cartonCapacity).toFixed();
    if (from === "packet" && to === "carton")
      return amount.div(cartonCapacity).toFixed();
  }
  throw new Error("Incompatible units.");
}
export function scaleBom(
  quantity: string,
  standardBatches: string,
  requestedBatches: string,
) {
  if (
    new Decimal(standardBatches).lte(0) ||
    new Decimal(requestedBatches).lte(0)
  )
    throw new Error("Batch sizes must be positive.");
  return new Decimal(quantity)
    .mul(requestedBatches)
    .div(standardBatches)
    .toFixed();
}
