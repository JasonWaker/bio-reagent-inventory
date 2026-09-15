export type MatchStatus = 'matched' | 'unmatched' | 'overdrawn'

export interface InventoryBatch {
  id: string
  sku: string
  name: string
  quantity: number
  warningThreshold?: number
  batchNo: string
  expiryDate: string
  sourceRow?: number
}

export interface OutboundRecord {
  id: string
  documentNo: string
  date: string
  department: string
  productCode: string
  name: string
  quantity: number
  batchNo: string
  expiryDate: string
  matchedBatchId?: string
  matchStatus: MatchStatus
  sourceKey: string
  createdAt: string
}

export interface InventoryCycle {
  id: string
  name: string
  createdAt: string
  sourceFile: string
  batches: InventoryBatch[]
  outbounds: OutboundRecord[]
}

export interface AppState {
  currentCycleId: string | null
  cycles: InventoryCycle[]
  lowStockThreshold: number
  expiryWarningDays: number
}

export interface BatchView extends InventoryBatch {
  outboundQuantity: number
  remaining: number
  daysToExpiry: number | null
}
