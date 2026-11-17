import { Decimal } from "decimal.js";
export const ProductionDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});
export function variance(actual: string, expected: string, tolerance: string) {
  const planned = new ProductionDecimal(expected),
    used = new ProductionDecimal(actual);
  if (planned.isZero()) return { percent: null, flagged: !used.isZero() };
  const percent = used.minus(planned).mul(100).div(planned);
  return {
    percent: percent.toFixed(),
    flagged: used
      .minus(planned)
      .abs()
      .mul(100)
      .gt(planned.abs().mul(tolerance)),
  };
}
