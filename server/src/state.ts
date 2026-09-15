import type pg from "pg";
import { withTransaction } from "./db.js";
import type { AppState } from "./schema.js";

const emptyState: AppState = {
  currentCycleId: null,
  cycles: [],
  lowStockThreshold: 20,
  expiryWarningDays: 90,
};

export async function readState() {
  return withTransaction(async (db) => {
    const settings = await db.query(
      "SELECT current_cycle_id, low_stock_threshold, expiry_warning_days, revision FROM app_settings WHERE id = 1",
    );
    if (!settings.rowCount) return { state: emptyState, revision: 0 };
    const cycles = await db.query(
      "SELECT id, name, created_at, source_file FROM inventory_cycles ORDER BY created_at DESC",
    );
    const batches = await db.query(
      "SELECT id, cycle_id, sku, name, quantity, warning_threshold, batch_no, expiry_date::text AS expiry_date, source_row FROM inventory_batches ORDER BY created_at",
    );
    const outbounds = await db.query(
      "SELECT id, cycle_id, document_no, record_date::text AS record_date, department, product_code, name, quantity, batch_no, expiry_date::text AS expiry_date, matched_batch_id, match_status, source_key, created_at FROM outbound_records ORDER BY created_at",
    );
    const batchMap = new Map<string, unknown[]>();
    const outboundMap = new Map<string, unknown[]>();
    for (const row of batches.rows) {
      const list = batchMap.get(row.cycle_id) ?? [];
      list.push({
        id: row.id,
        sku: row.sku,
        name: row.name,
        quantity: Number(row.quantity),
        warningThreshold:
          row.warning_threshold === null
            ? undefined
            : Number(row.warning_threshold),
        batchNo: row.batch_no,
        expiryDate: row.expiry_date ?? "",
        sourceRow: row.source_row ?? undefined,
      });
      batchMap.set(row.cycle_id, list);
    }
    for (const row of outbounds.rows) {
      const list = outboundMap.get(row.cycle_id) ?? [];
      list.push({
        id: row.id,
        documentNo: row.document_no,
        date: row.record_date ?? "",
        department: row.department,
        productCode: row.product_code,
        name: row.name,
        quantity: Number(row.quantity),
        batchNo: row.batch_no,
        expiryDate: row.expiry_date ?? "",
        matchedBatchId: row.matched_batch_id ?? undefined,
        matchStatus: row.match_status,
        sourceKey: row.source_key,
        createdAt: new Date(row.created_at).toISOString(),
      });
      outboundMap.set(row.cycle_id, list);
    }
    const setting = settings.rows[0];
    return {
      revision: Number(setting.revision),
      state: {
        currentCycleId: setting.current_cycle_id,
        lowStockThreshold: Number(setting.low_stock_threshold),
        expiryWarningDays: setting.expiry_warning_days,
        cycles: cycles.rows.map((row) => ({
          id: row.id,
          name: row.name,
          createdAt: new Date(row.created_at).toISOString(),
          sourceFile: row.source_file,
          batches: batchMap.get(row.id) ?? [],
          outbounds: outboundMap.get(row.id) ?? [],
        })),
      } as AppState,
    };
  });
}

export async function writeState(
  state: AppState,
  expectedRevision: number,
  actor: string,
) {
  return withTransaction(async (db) => {
    const current = await db.query(
      "SELECT revision FROM app_settings WHERE id = 1 FOR UPDATE",
    );
    const revision = current.rowCount ? Number(current.rows[0].revision) : 0;
    if (revision !== expectedRevision) return null;
    await db.query("DELETE FROM inventory_cycles");
    for (const cycle of state.cycles) {
      await db.query(
        "INSERT INTO inventory_cycles (id,name,created_at,source_file) VALUES ($1,$2,$3,$4)",
        [cycle.id, cycle.name, cycle.createdAt, cycle.sourceFile],
      );
      for (const batch of cycle.batches) await insertBatch(db, cycle.id, batch);
      for (const row of cycle.outbounds)
        await db.query(
          "INSERT INTO outbound_records (id,cycle_id,document_no,record_date,department,product_code,name,quantity,batch_no,expiry_date,matched_batch_id,match_status,source_key,created_at) VALUES ($1,$2,$3,NULLIF($4,'')::date,$5,$6,$7,$8,$9,NULLIF($10,'')::date,$11,$12,$13,$14)",
          [
            row.id,
            cycle.id,
            row.documentNo,
            row.date,
            row.department,
            row.productCode,
            row.name,
            row.quantity,
            row.batchNo,
            row.expiryDate,
            row.matchedBatchId ?? null,
            row.matchStatus,
            row.sourceKey,
            row.createdAt,
          ],
        );
    }
    const next = revision + 1;
    await db.query(
      "INSERT INTO app_settings (id,current_cycle_id,low_stock_threshold,expiry_warning_days,revision) VALUES (1,$1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET current_cycle_id=EXCLUDED.current_cycle_id,low_stock_threshold=EXCLUDED.low_stock_threshold,expiry_warning_days=EXCLUDED.expiry_warning_days,revision=EXCLUDED.revision,updated_at=now()",
      [
        state.currentCycleId,
        state.lowStockThreshold,
        state.expiryWarningDays,
        next,
      ],
    );
    await db.query(
      "INSERT INTO audit_logs (actor,action,entity_type,after_value) VALUES ($1,'state.replace','inventory_state',$2)",
      [
        actor,
        JSON.stringify({ revision: next, cycleCount: state.cycles.length }),
      ],
    );
    return next;
  });
}

async function insertBatch(
  db: pg.PoolClient,
  cycleId: string,
  row: AppState["cycles"][number]["batches"][number],
) {
  await db.query(
    "INSERT INTO inventory_batches (id,cycle_id,sku,name,quantity,warning_threshold,batch_no,expiry_date,source_row) VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::date,$9)",
    [
      row.id,
      cycleId,
      row.sku,
      row.name,
      row.quantity,
      row.warningThreshold ?? null,
      row.batchNo,
      row.expiryDate,
      row.sourceRow ?? null,
    ],
  );
}
