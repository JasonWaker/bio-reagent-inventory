import { z } from "zod";

const dateSchema = z
  .string()
  .max(100)
  .transform((value) => value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? value);

export const batchSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(300),
  quantity: z.number().finite().nonnegative(),
  warningThreshold: z.number().finite().nonnegative().optional(),
  batchNo: z.string().min(1).max(120),
  expiryDate: dateSchema,
  sourceRow: z.number().int().positive().optional(),
});

export const outboundSchema = z.object({
  id: z.string().uuid(),
  documentNo: z.string().max(120),
  date: dateSchema,
  department: z.string().max(200),
  productCode: z.string().max(100),
  name: z.string().min(1).max(300),
  quantity: z.number().finite().positive(),
  batchNo: z.string().max(120),
  expiryDate: dateSchema,
  matchedBatchId: z.string().uuid().optional(),
  matchStatus: z.enum(["matched", "unmatched", "overdrawn"]),
  sourceKey: z.string().max(500),
  createdAt: z.string().datetime(),
});

export const stateSchema = z.object({
  currentCycleId: z.string().uuid().nullable(),
  cycles: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200),
        createdAt: z.string().datetime(),
        sourceFile: z.string().max(500),
        batches: z.array(batchSchema).max(10000),
        outbounds: z.array(outboundSchema).max(50000),
      }),
    )
    .max(500),
  lowStockThreshold: z.number().finite().nonnegative(),
  expiryWarningDays: z.number().int().positive().max(3650),
});

export type AppState = z.infer<typeof stateSchema>;

const recognizedBase = z.object({
  name: z.string().trim().min(1).max(300),
  quantity: z.number().finite().positive(),
  batchNo: z.string().trim().max(120),
  expiryDate: z.string().trim().max(20),
});
export const recognitionSchema = z.object({
  documentNo: z.string().trim().max(120).default(""),
  date: z.string().trim().max(20).default(""),
  department: z.string().trim().max(200).default(""),
  rows: z
    .array(
      recognizedBase.extend({
        sku: z.string().trim().max(100).default(""),
        productCode: z.string().trim().max(100).default(""),
      }),
    )
    .min(1)
    .max(100),
});
