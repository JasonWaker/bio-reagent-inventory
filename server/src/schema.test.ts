import { describe, expect, it } from "vitest";
import { stateSchema } from "./schema.js";

describe("stateSchema", () => {
  it("normalizes legacy PostgreSQL ISO date values", () => {
    const parsed = stateSchema.parse({
      currentCycleId: "11111111-1111-4111-8111-111111111111",
      lowStockThreshold: 20,
      expiryWarningDays: 90,
      cycles: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "测试库存周期",
          createdAt: "2026-09-15T12:00:00.000Z",
          sourceFile: "test.xlsx · 亿丰库存",
          batches: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              sku: "SKU-1",
              name: "测试试剂",
              quantity: 10,
              batchNo: "BATCH-1",
              expiryDate: "2027-03-10T16:00:00.000Z",
              sourceRow: 2,
            },
          ],
          outbounds: [],
        },
      ],
    });

    expect(parsed.cycles[0]?.batches[0]?.expiryDate).toBe("2027-03-10");
  });
});
