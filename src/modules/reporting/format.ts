import type { Column } from "./types";
import { Money as D } from "../billing/tax";
export function displayCell(value: string | null, column: Column) {
  return value === null
    ? "Unavailable"
    : column.type === "money"
      ? new D(value).toFixed(2)
      : column.type === "number"
        ? new D(value).toFixed()
        : value;
}
