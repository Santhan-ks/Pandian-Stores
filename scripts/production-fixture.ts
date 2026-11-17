import type { Database } from "../src/modules/catalog/service";
import {
  createRun,
  postRun,
  addOverhead,
} from "../src/modules/production/service";
export function benchmarkProduction(requestKey = "demo-production-stage3") {
  return {
    bomId: "demo-bom-1",
    batches: "1",
    goodOutput: "188",
    tolerance: "3",
    requestKey,
    inputs: [
      { itemId: "demo-flour", actual: "40", damaged: "0", unit: "kg" },
      { itemId: "demo-oil", actual: "10.5", damaged: "0", unit: "L" },
      { itemId: "demo-spice", actual: "1.2", damaged: "0", unit: "kg" },
      { itemId: "demo-pouch", actual: "194", damaged: "6", unit: "piece" },
      { itemId: "demo-carton", actual: "9", damaged: "0", unit: "piece" },
    ],
  };
}
export async function productionFixture(db: Database) {
  const actor = { id: "demo-production", role: "production" } as const;
  const id = await createRun(db, actor, benchmarkProduction());
  await postRun(db, actor, id);
  await addOverhead(db, actor, id, {
    category: "labour",
    amount: "1200",
    reason: "Benchmark labour",
    requestKey: "demo-production-labour",
  });
  await addOverhead(db, actor, id, {
    category: "gas_power",
    amount: "600",
    reason: "Benchmark gas and power",
    requestKey: "demo-production-power",
  });
  return id;
}
