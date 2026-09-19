import type { Workbook } from 'exceljs'
import type { AppState, BatchView, InventoryBatch, InventoryCycle, MatchStatus, OutboundRecord } from '../types'

const loadExcel = () => import('exceljs')

export const EMPTY_STATE: AppState = {
  currentCycleId: null,
  cycles: [],
  lowStockThreshold: 20,
  expiryWarningDays: 90,
}

const headerAliases = {
  sku: ['货号', '物料编码', '产品货号', 'sku'],
  name: ['名称', '产品名称', '品名', '试剂名称'],
  quantity: ['数量', '入库数量', '定数包数量', '出库数量'],
  batchNo: ['批号', '生产批号', '批次'],
  outQuantity: ['定数包数量', '出库数量', '数量'],
  expiryDate: ['有效期', '失效期', '有效期至'],
  documentNo: ['出库配送单号', '配送单号', '出库单号', '单据号'],
  date: ['日期', '出库日期', '配送日期'],
  department: ['收货科室', '科室', '领用科室'],
  productCode: ['品种编码', '产品编码', '院内码'],
} as const

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()

export const localDate = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const normalizeDate = (value: unknown): string => {
  if (!value) return ''
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return localDate(value)
  const text = String(value).trim().replace(/[./]/g, '-')
  const match = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/)
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return text
}

export const normalizeAppState = (state: AppState): AppState => ({
  ...state,
  cycles: state.cycles.map((cycle) => ({
    ...cycle,
    batches: cycle.batches.map((batch) => ({
      ...batch,
      expiryDate: normalizeDate(batch.expiryDate),
    })),
    outbounds: cycle.outbounds.map((record) => ({
      ...record,
      date: normalizeDate(record.date),
      expiryDate: normalizeDate(record.expiryDate),
    })),
  })),
})

const numberValue = (value: unknown) => {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

const findHeaderRow = (rows: unknown[][], required: string[]) => {
  let best = { index: -1, score: 0 }
  rows.slice(0, 30).forEach((row, index) => {
    const values = row.map(clean)
    const score = required.filter((key) => headerAliases[key as keyof typeof headerAliases]?.some((alias) => values.includes(clean(alias)))).length
    if (score > best.score) best = { index, score }
  })
  return best
}

const columnIndex = (headers: unknown[], key: keyof typeof headerAliases) => {
  const values = headers.map(clean)
  return values.findIndex((value) => headerAliases[key].some((alias) => value === clean(alias)))
}

// 按别名优先级收集数量列：出库表同时存在“数量”和“定数包数量”时优先“定数包数量”
const quantityColumnIndexes = (headers: unknown[]) => {
  const seen = new Set<number>()
  const list: number[] = []
  for (const alias of headerAliases.outQuantity) {
    headers.forEach((header, index) => {
      if (!seen.has(index) && clean(header) === clean(alias)) {
        seen.add(index)
        list.push(index)
      }
    })
  }
  return list
}

const cell = (row: unknown[], index: number) => index >= 0 ? row[index] : ''

export const id = () => crypto.randomUUID()

export async function readWorkbook(file: File) {
  const ExcelJS = await loadExcel()
  const bytes = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  return workbook
}

const plainCellValue = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  if ('result' in value) return plainCellValue((value as { result: unknown }).result)
  if ('text' in value) return (value as { text: string }).text
  if ('richText' in value) return (value as { richText: { text: string }[] }).richText.map((part) => part.text).join('')
  return String(value)
}

const worksheetRows = (worksheet: Workbook['worksheets'][number]) => {
  const rows: unknown[][] = []
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = Array.isArray(row.values) ? row.values.slice(1).map(plainCellValue) : []
    rows[rowNumber - 1] = values
  })
  return rows.map((row) => row ?? [])
}

export function parseInbound(workbook: Workbook): { batches: InventoryBatch[]; sheetName: string } {
  const worksheet = workbook.worksheets.find((sheet) => sheet.name.includes('亿丰')) ?? workbook.worksheets[1] ?? workbook.worksheets[0]
  if (!worksheet) throw new Error('工作簿中没有可读取的工作表')
  const sheetName = worksheet.name
  const rows = worksheetRows(worksheet)
  const header = findHeaderRow(rows, ['sku', 'name', 'quantity', 'batchNo'])
  if (header.score < 3) throw new Error('没有找到入库表头，需要包含货号、名称、数量、批号')
  const headers = rows[header.index]
  const indexes = {
    sku: columnIndex(headers, 'sku'), name: columnIndex(headers, 'name'), quantity: columnIndex(headers, 'quantity'),
    batchNo: columnIndex(headers, 'batchNo'), expiryDate: columnIndex(headers, 'expiryDate'),
  }
  const batches = rows.slice(header.index + 1).map((row, offset) => ({
    id: id(), sku: String(cell(row, indexes.sku)).trim(), name: String(cell(row, indexes.name)).trim(),
    quantity: numberValue(cell(row, indexes.quantity)), batchNo: String(cell(row, indexes.batchNo)).trim(),
    expiryDate: normalizeDate(cell(row, indexes.expiryDate)), sourceRow: header.index + offset + 2,
  })).filter((row) => row.sku && row.name && row.batchNo && row.quantity >= 0)
  if (!batches.length) throw new Error('未读取到有效入库记录')
  const duplicates = new Set<string>()
  const seen = new Set<string>()
  batches.forEach((batch) => {
    const key = `${clean(batch.sku)}::${clean(batch.batchNo)}`
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  })
  if (duplicates.size) throw new Error(`存在 ${duplicates.size} 个重复的“货号 + 批号”，请先在表格中合并或修正`)
  return { batches, sheetName }
}

// 出库匹配：只按批号关联入库批次；批号不唯一（不同产品可能共用批号）时用名称兜底。
// 不做出库品种编码与入库货号是否一致的拦截——院内品种编码与供货货号本来就可能不同。
function resolveBatch(batches: InventoryBatch[], draft: Pick<OutboundRecord, 'batchNo' | 'productCode' | 'name'>) {
  const batchMatches = batches.filter((batch) => clean(batch.batchNo) && clean(batch.batchNo) === clean(draft.batchNo))
  if (batchMatches.length === 1) return batchMatches[0]
  if (batchMatches.length > 1) {
    const nameMatches = batchMatches.filter((batch) => clean(batch.name) === clean(draft.name))
    if (nameMatches.length === 1) return nameMatches[0]
    return undefined
  }
  // 批号完全对不上时，保留“全局唯一名称”兜底；名称不唯一则不猜，标记待人工匹配
  const nameMatches = batches.filter((batch) => clean(batch.name) === clean(draft.name))
  if (nameMatches.length === 1) return nameMatches[0]
  return undefined
}

export function parseOutbound(workbook: Workbook, cycle: InventoryCycle, fileName: string): OutboundRecord[] {
  const results: OutboundRecord[] = []
  for (const worksheet of workbook.worksheets) {
    const rows = worksheetRows(worksheet)
    const header = findHeaderRow(rows, ['name', 'outQuantity', 'batchNo'])
    if (header.score < 3) continue
    const headers = rows[header.index]
    const indexes = {
      documentNo: columnIndex(headers, 'documentNo'), date: columnIndex(headers, 'date'), department: columnIndex(headers, 'department'),
      productCode: columnIndex(headers, 'productCode'), name: columnIndex(headers, 'name'),
      quantityColumns: quantityColumnIndexes(headers),
      batchNo: columnIndex(headers, 'batchNo'), expiryDate: columnIndex(headers, 'expiryDate'),
    }
    for (const [offset, row] of rows.slice(header.index + 1).entries()) {
      // 优先取“定数包数量”，该列为空/0 的行再逐列回退到“出库数量/数量”
      const quantity = indexes.quantityColumns
        .map((qIndex) => numberValue(cell(row, qIndex)))
        .find((value) => value > 0) ?? 0
      const name = String(cell(row, indexes.name)).trim()
      const batchNo = String(cell(row, indexes.batchNo)).trim()
      if (!quantity || (!name && !batchNo)) continue
      const documentNo = String(cell(row, indexes.documentNo)).trim() || fileName.replace(/\.[^.]+$/, '')
      const draft = {
        productCode: String(cell(row, indexes.productCode)).trim(), name, batchNo,
      }
      const matched = resolveBatch(cycle.batches, draft)
      results.push({
        id: id(), documentNo, date: normalizeDate(cell(row, indexes.date)), department: String(cell(row, indexes.department)).trim(),
        ...draft, quantity, expiryDate: normalizeDate(cell(row, indexes.expiryDate)), matchedBatchId: matched?.id,
        matchStatus: matched ? 'matched' : 'unmatched',
        sourceKey: [documentNo, draft.productCode, draft.batchNo, quantity, header.index + offset + 2].join('::'),
        createdAt: new Date().toISOString(),
      })
    }
    // A single import represents one outbound-detail sheet. Stop after the
    // first sheet with a valid schema to avoid importing unrelated tabs.
    break
  }
  if (!results.length) throw new Error('未找到出库明细，需要包含产品名称、数量、批号')
  return results
}

export function buildBatchViews(cycle: InventoryCycle | undefined): BatchView[] {
  if (!cycle) return []
  const deductions = new Map<string, number>()
  cycle.outbounds.forEach((record) => {
    if (record.matchedBatchId) deductions.set(record.matchedBatchId, (deductions.get(record.matchedBatchId) ?? 0) + record.quantity)
  })
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return cycle.batches.map((batch) => {
    const outboundQuantity = deductions.get(batch.id) ?? 0
    const expiry = batch.expiryDate ? new Date(`${batch.expiryDate}T00:00:00`) : null
    const daysToExpiry = expiry && !Number.isNaN(expiry.valueOf()) ? Math.ceil((expiry.valueOf() - today.valueOf()) / 86400000) : null
    return { ...batch, outboundQuantity, remaining: batch.quantity - outboundQuantity, daysToExpiry }
  })
}

export function refreshMatchStatuses(cycle: InventoryCycle): InventoryCycle {
  const totals = new Map<string, number>()
  const outbounds = cycle.outbounds.map((record) => {
    const matched = record.matchedBatchId ? cycle.batches.find((batch) => batch.id === record.matchedBatchId) : resolveBatch(cycle.batches, record)
    if (!matched) return { ...record, matchedBatchId: undefined, matchStatus: 'unmatched' as MatchStatus }
    const total = (totals.get(matched.id) ?? 0) + record.quantity
    totals.set(matched.id, total)
    return { ...record, matchedBatchId: matched.id, matchStatus: (total > matched.quantity ? 'overdrawn' : 'matched') as MatchStatus }
  })
  return { ...cycle, outbounds }
}

export function downloadJson(state: AppState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `试剂库存备份-${localDate()}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

export async function exportInventoryXlsx(cycle: InventoryCycle, views: BatchView[]) {
  const ExcelJS = await loadExcel()
  const inventory = views.map((row) => ({
    货号: row.sku, 名称: row.name, 期初数量: row.quantity, 已出库: row.outboundQuantity,
    库存余量: row.remaining, 库存预警值: row.warningThreshold ?? '', 批号: row.batchNo, 有效期: row.expiryDate,
  }))
  const outbound = cycle.outbounds.map((row) => ({
    出库单号: row.documentNo, 日期: row.date, 科室: row.department, 品种编码: row.productCode,
    产品名称: row.name, 数量: row.quantity, 批号: row.batchNo, 有效期: row.expiryDate,
    匹配状态: row.matchStatus === 'matched' ? '已匹配' : row.matchStatus === 'overdrawn' ? '超出库存' : '待匹配',
  }))
  const workbook = new ExcelJS.Workbook()
  const addSheet = (name: string, rows: Record<string, unknown>[]) => {
    const sheet = workbook.addWorksheet(name)
    if (!rows.length) return
    const keys = Object.keys(rows[0])
    sheet.columns = keys.map((key) => ({ header: key, key, width: Math.min(42, Math.max(12, key.length * 2 + 2)) }))
    rows.forEach((row) => sheet.addRow(row))
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E655D' } }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } }
  }
  addSheet('当前库存', inventory)
  addSheet('出库记录', outbound)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `库存台账-${localDate()}.xlsx`
  link.click()
  URL.revokeObjectURL(link.href)
}
