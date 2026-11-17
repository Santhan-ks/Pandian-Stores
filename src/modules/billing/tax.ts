import { Decimal } from "decimal.js";
export const Money = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});
export function financialYear(date: string) {
  const [year, month] = date.split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
export function taxLine(
  quantity: string,
  rate: string,
  percent: string,
  supplierState: string,
  placeOfSupply: string,
) {
  const taxable = new Money(quantity).mul(rate).toDecimalPlaces(2);
  const intra =
    supplierState.trim().toLowerCase() === placeOfSupply.trim().toLowerCase();
  const cgst = intra
    ? taxable.mul(percent).div(200).toDecimalPlaces(2)
    : new Money(0);
  const sgst = cgst;
  const igst = intra
    ? new Money(0)
    : taxable.mul(percent).div(100).toDecimalPlaces(2);
  return {
    taxable: taxable.toFixed(2),
    cgst: cgst.toFixed(2),
    sgst: sgst.toFixed(2),
    igst: igst.toFixed(2),
    total: taxable.plus(cgst).plus(sgst).plus(igst).toFixed(2),
  };
}
