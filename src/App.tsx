import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Archive, ArrowDownToLine, Boxes, CalendarClock, CheckCircle2, ChevronRight,
  ClipboardList, Database, Download, FileDown, FileSpreadsheet, History, LayoutDashboard,
  Menu, PackageMinus, Plus, Search, Settings, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react'
import {
  buildBatchViews, downloadJson, EMPTY_STATE, exportInventoryXlsx, id, localDate, parseInbound, parseOutbound,
  readWorkbook, refreshMatchStatuses,
} from './lib/inventory'
import type { AppState, BatchView, InventoryBatch, InventoryCycle, OutboundRecord } from './types'

type View = 'dashboard' | 'inventory' | 'outbound' | 'history' | 'settings'
type Toast = { kind: 'success' | 'error'; message: string } | null

const STORAGE_KEY = 'bio-reagent-inventory-v1'

const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: '库存概览', icon: LayoutDashboard },
  { id: 'inventory', label: '当前库存', icon: Boxes },
  { id: 'outbound', label: '出库记录', icon: PackageMinus },
  { id: 'history', label: '批次历史', icon: History },
  { id: 'settings', label: '数据设置', icon: Settings },
]

const loadState = (): AppState => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : EMPTY_STATE
  } catch { return EMPTY_STATE }
}

const formatNumber = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
const formatDate = (value: string) => value ? value.replace(/-/g, '/') : '未填写'

export default function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [view, setView] = useState<View>('dashboard')
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [batchModal, setBatchModal] = useState<InventoryBatch | null | undefined>(undefined)
  const [outboundModal, setOutboundModal] = useState<OutboundRecord | null | undefined>(undefined)
  const inboundInput = useRef<HTMLInputElement>(null)
  const outboundInput = useRef<HTMLInputElement>(null)
  const restoreInput = useRef<HTMLInputElement>(null)

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), [state])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const cycle = state.cycles.find((item) => item.id === state.currentCycleId)
  const batchViews = useMemo(() => buildBatchViews(cycle), [cycle])
  const filteredBatches = batchViews.filter((item) => [item.sku, item.name, item.batchNo].some((value) => value.toLowerCase().includes(query.toLowerCase())))
  const totalRemaining = batchViews.reduce((sum, row) => sum + row.remaining, 0)
  const skuCount = new Set(batchViews.map((row) => row.sku)).size
  const thresholdFor = (row: InventoryBatch) => row.warningThreshold ?? state.lowStockThreshold
  const lowStock = batchViews.filter((row) => row.remaining <= thresholdFor(row))
  const expiring = batchViews.filter((row) => row.daysToExpiry !== null && row.daysToExpiry <= state.expiryWarningDays)
  const exceptions = cycle?.outbounds.filter((row) => row.matchStatus !== 'matched') ?? []

  const updateCycle = (updater: (cycle: InventoryCycle) => InventoryCycle) => {
    if (!cycle) return
    setState((current) => ({ ...current, cycles: current.cycles.map((item) => item.id === cycle.id ? refreshMatchStatuses(updater(item)) : item) }))
  }

  const importInbound = async (file?: File) => {
    if (!file) return
    try {
      const parsed = await parseInbound(await readWorkbook(file))
      if (cycle && !window.confirm(`导入“${file.name}”将开启新库存周期，当前周期会转入历史。继续吗？`)) return
      const next: InventoryCycle = {
        id: id(), name: `${new Date().toLocaleDateString('zh-CN')} 库存批次`, createdAt: new Date().toISOString(),
        sourceFile: `${file.name} · ${parsed.sheetName}`, batches: parsed.batches, outbounds: [],
      }
      setState((current) => ({ ...current, currentCycleId: next.id, cycles: [next, ...current.cycles] }))
      setView('inventory')
      setToast({ kind: 'success', message: `已导入 ${parsed.batches.length} 个批次，新库存周期已生效` })
    } catch (error) { setToast({ kind: 'error', message: error instanceof Error ? error.message : '入库导入失败' }) }
    finally { if (inboundInput.current) inboundInput.current.value = '' }
  }

  const importOutbound = async (file?: File) => {
    if (!file || !cycle) return
    try {
      const rows = await parseOutbound(await readWorkbook(file), cycle, file.name)
      const existing = new Set(cycle.outbounds.map((row) => row.sourceKey))
      const fresh = rows.filter((row) => !existing.has(row.sourceKey))
      const nextCycle = refreshMatchStatuses({ ...cycle, outbounds: [...cycle.outbounds, ...fresh] })
      const warningCount = buildBatchViews(nextCycle).filter((row) => row.remaining <= thresholdFor(row)).length
      setState((current) => ({ ...current, cycles: current.cycles.map((item) => item.id === cycle.id ? nextCycle : item) }))
      setView('outbound')
      setToast({ kind: 'success', message: `新增 ${fresh.length} 条出库，跳过 ${rows.length - fresh.length} 条重复；当前 ${warningCount} 个批次预警` })
    } catch (error) { setToast({ kind: 'error', message: error instanceof Error ? error.message : '出库导入失败' }) }
    finally { if (outboundInput.current) outboundInput.current.value = '' }
  }

  const saveBatch = (draft: InventoryBatch) => {
    updateCycle((current) => ({ ...current, batches: batchModal ? current.batches.map((row) => row.id === draft.id ? draft : row) : [...current.batches, draft] }))
    setBatchModal(undefined)
    setToast({ kind: 'success', message: batchModal ? '库存批次已修改' : '库存批次已添加' })
  }

  const saveOutbound = (draft: OutboundRecord) => {
    updateCycle((current) => ({ ...current, outbounds: outboundModal ? current.outbounds.map((row) => row.id === draft.id ? draft : row) : [...current.outbounds, draft] }))
    setOutboundModal(undefined)
    setToast({ kind: 'success', message: outboundModal ? '出库记录已修改' : '出库记录已添加' })
  }

  const setBatchThreshold = (batchId: string, warningThreshold?: number) => {
    updateCycle((current) => ({
      ...current,
      batches: current.batches.map((batch) => batch.id === batchId ? { ...batch, warningThreshold } : batch),
    }))
  }

  const restoreBackup = async (file?: File) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as AppState
      if (!Array.isArray(parsed.cycles)) throw new Error('备份文件格式不正确')
      setState(parsed); setToast({ kind: 'success', message: '备份已恢复' })
    } catch (error) { setToast({ kind: 'error', message: error instanceof Error ? error.message : '恢复失败' }) }
    finally { if (restoreInput.current) restoreInput.current.value = '' }
  }

  const emptyPanel = (
    <div className="empty-state">
      <div className="empty-illustration"><FileSpreadsheet size={38} /></div>
      <h2>从一份入库表开始</h2>
      <p>选择包含“亿丰库存”的 Excel 文件。系统会读取货号、名称、数量、批号和有效期，并建立第一期库存快照。</p>
      <button className="button primary" onClick={() => inboundInput.current?.click()}><Upload size={18} />导入入库表</button>
      <span>文件只在当前浏览器处理，不会上传到服务器</span>
    </div>
  )

  return (
    <div className="app-shell">
      <input ref={inboundInput} hidden type="file" accept=".xlsx,.xls" onChange={(e) => importInbound(e.target.files?.[0])} />
      <input ref={outboundInput} hidden type="file" accept=".xlsx,.xls" onChange={(e) => importOutbound(e.target.files?.[0])} />
      <input ref={restoreInput} hidden type="file" accept=".json" onChange={(e) => restoreBackup(e.target.files?.[0])} />

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Database size={22} /></div><div><strong>试剂库存台账</strong><span>Inventory monitor</span></div></div>
        <nav>{navItems.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); setMenuOpen(false) }}><item.icon size={19} /><span>{item.label}</span>{item.id === 'outbound' && exceptions.length > 0 && <b>{exceptions.length}</b>}</button>)}</nav>
        <div className="sidebar-note"><ShieldCheck size={18} /><div><strong>本地数据模式</strong><span>数据保存在此浏览器</span></div></div>
      </aside>
      {menuOpen && <button className="scrim" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />}

      <main>
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)}><Menu size={22} /></button>
          <div><span className="eyebrow">当前周期</span><strong>{cycle?.name ?? '尚未建立库存'}</strong></div>
          <div className="header-actions">
            <button className="button secondary hide-mobile" onClick={() => inboundInput.current?.click()}><ArrowDownToLine size={17} />导入新入库表</button>
            <button className="button primary" disabled={!cycle} onClick={() => outboundInput.current?.click()}><Upload size={17} /><span className="hide-mobile">导入</span>出库</button>
          </div>
        </header>

        <div className="content">
          {view === 'dashboard' && (!cycle ? emptyPanel : <>
            <section className="page-heading"><div><span className="eyebrow">库存监测</span><h1>库存概览</h1><p>截至当前库存周期，余量已扣除全部已匹配出库记录。</p></div><div className="as-of"><CheckCircle2 size={17} />{new Date(cycle.createdAt).toLocaleDateString('zh-CN')} 建立</div></section>
            <section className="metric-grid">
              <Metric label="库存余量" value={`${formatNumber(totalRemaining)} 盒`} note={`期初 ${formatNumber(batchViews.reduce((s, r) => s + r.quantity, 0))} 盒`} tone="green" icon={Boxes} />
              <Metric label="在库品种" value={`${skuCount} 种`} note={`${batchViews.length} 个在库批次`} tone="blue" icon={ClipboardList} />
              <Metric label="库存预警批次" value={`${lowStock.length} 个`} note="按每批次预警值判定" tone="amber" icon={AlertTriangle} />
              <Metric label="待处理记录" value={`${exceptions.length} 条`} note="未匹配或超出库存" tone="red" icon={ShieldCheck} />
            </section>
            {lowStock.length > 0 && <div className="alert-banner stock-alert"><AlertTriangle size={20} /><div><strong>{lowStock.length} 个批次已达到库存预警线</strong><span>当前余量已低于或等于各自预警值，请优先补货或核查使用计划。</span></div><button className="button warning-button" onClick={() => setView('inventory')}>重点关注</button></div>}
            <section className="dashboard-grid">
              <div className="panel"><div className="panel-heading"><div><span className="eyebrow">库存风险</span><h2>近期有效期</h2></div><button className="text-button" onClick={() => setView('inventory')}>查看全部 <ChevronRight size={16} /></button></div>
                <div className="risk-list">{expiring.length ? expiring.sort((a, b) => (a.daysToExpiry ?? 99999) - (b.daysToExpiry ?? 99999)).slice(0, 6).map((row) => <div className="risk-row" key={row.id}><div className={`risk-date ${(row.daysToExpiry ?? 1) < 0 ? 'expired' : ''}`}><strong>{row.daysToExpiry !== null && row.daysToExpiry < 0 ? '已过期' : `${row.daysToExpiry} 天`}</strong><span>{formatDate(row.expiryDate)}</span></div><div className="risk-name"><strong>{row.name}</strong><span>{row.batchNo} · 余量 {formatNumber(row.remaining)} 盒</span></div></div>) : <SmallEmpty text={`未来 ${state.expiryWarningDays} 天没有到期批次`} />}</div>
              </div>
              <div className="panel"><div className="panel-heading"><div><span className="eyebrow">库存分布</span><h2>余量最低批次</h2></div></div>
                <div className="stock-bars">{[...batchViews].sort((a, b) => a.remaining - b.remaining).slice(0, 7).map((row) => { const max = Math.max(...batchViews.map((x) => Math.max(x.remaining, 0)), 1); return <div className="stock-bar" key={row.id}><div><strong>{row.name.replace(/测定试剂盒|检测试剂盒/, '')}</strong><span>{row.batchNo} · 预警 {formatNumber(thresholdFor(row))}</span></div><div className="bar-track"><i style={{ width: `${Math.max(3, Math.min(100, row.remaining / max * 100))}%` }} /></div><b className={row.remaining <= thresholdFor(row) ? 'warning-text' : ''}>{formatNumber(row.remaining)}</b></div> })}</div>
              </div>
            </section>
          </>)}

          {view === 'inventory' && (!cycle ? emptyPanel : <>
            <section className="page-heading compact"><div><span className="eyebrow">按货号与批号管理</span><h1>当前库存</h1><p>{cycle.sourceFile} · {batchViews.length} 个批次</p></div><button className="button secondary" onClick={() => setBatchModal(null)}><Plus size={17} />手工入库</button></section>
            <div className="toolbar"><label className="search"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索货号、名称或批号" /></label><button className="button ghost" onClick={() => exportInventoryXlsx(cycle, batchViews)}><FileDown size={17} />导出台账</button></div>
            <div className="table-card"><table><thead><tr><th>试剂信息</th><th>批号 / 有效期</th><th className="number">期初</th><th className="number">已出库</th><th className="number">库存余量</th><th>预警值 / 状态</th><th></th></tr></thead><tbody>{filteredBatches.map((row) => { const warning = row.remaining <= thresholdFor(row); return <tr className={warning ? 'warning-row' : ''} key={row.id}><td data-label="试剂信息"><strong>{row.name}</strong><span>{row.sku}</span></td><td data-label="批号 / 有效期"><strong>{row.batchNo}</strong><span className={row.daysToExpiry !== null && row.daysToExpiry <= state.expiryWarningDays ? 'warning-text' : ''}>{formatDate(row.expiryDate)}{row.daysToExpiry !== null && row.daysToExpiry <= state.expiryWarningDays ? ` · ${row.daysToExpiry < 0 ? '已过期' : `${row.daysToExpiry}天`}` : ''}</span></td><td data-label="期初" className="number">{formatNumber(row.quantity)}</td><td data-label="已出库" className="number">{formatNumber(row.outboundQuantity)}</td><td data-label="库存余量" className={`number balance ${warning ? 'low' : ''}`}>{formatNumber(row.remaining)}</td><td data-label="预警值 / 状态"><strong>{formatNumber(thresholdFor(row))} 盒</strong><span className={`stock-status ${warning ? 'warning' : 'normal'}`}>{warning ? '重点关注' : '库存正常'}</span></td><td><button className="icon-button" aria-label="编辑" onClick={() => setBatchModal(row)}><ChevronRight size={18} /></button></td></tr> })}</tbody></table></div>
          </>)}

          {view === 'outbound' && (!cycle ? emptyPanel : <>
            <section className="page-heading compact"><div><span className="eyebrow">当前周期流水</span><h1>出库记录</h1><p>已导入 {cycle.outbounds.length} 条，{exceptions.length} 条需要处理。</p></div><button className="button secondary" onClick={() => setOutboundModal(null)}><Plus size={17} />手工出库</button></section>
            {exceptions.length > 0 && <div className="alert-banner"><AlertTriangle size={20} /><div><strong>有 {exceptions.length} 条出库尚未正确扣减</strong><span>请检查批号，或打开记录后手动选择对应的库存批次。</span></div></div>}
            <div className="table-card"><table><thead><tr><th>出库单 / 日期</th><th>产品</th><th>批号</th><th>科室</th><th className="number">数量</th><th>状态</th><th></th></tr></thead><tbody>{cycle.outbounds.length ? [...cycle.outbounds].reverse().map((row) => <tr key={row.id}><td data-label="出库单 / 日期"><strong>{row.documentNo || '手工记录'}</strong><span>{formatDate(row.date)}</span></td><td data-label="产品"><strong>{row.name}</strong><span>{row.productCode || '未填品种编码'}</span></td><td data-label="批号"><strong>{row.batchNo || '未填写'}</strong></td><td data-label="科室">{row.department || '未填写'}</td><td data-label="数量" className="number">{formatNumber(row.quantity)}</td><td data-label="状态"><StatusPill status={row.matchStatus} /></td><td><button className="icon-button" aria-label="编辑" onClick={() => setOutboundModal(row)}><ChevronRight size={18} /></button></td></tr>) : <tr><td colSpan={7}><SmallEmpty text="当前周期还没有出库记录" /></td></tr>}</tbody></table></div>
          </>)}

          {view === 'history' && <><section className="page-heading compact"><div><span className="eyebrow">快照留痕</span><h1>库存批次历史</h1><p>导入新入库表后，旧周期会保留在这里。</p></div></section><div className="cycle-list">{state.cycles.map((item) => { const views = buildBatchViews(item); const active = item.id === state.currentCycleId; return <article className={`cycle-card ${active ? 'active' : ''}`} key={item.id}><div className="cycle-icon"><Archive size={21} /></div><div><div className="cycle-title"><strong>{item.name}</strong>{active && <span>当前</span>}</div><p>{item.sourceFile}</p><small>{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.batches.length} 批次 · {item.outbounds.length} 条出库 · 余量 {formatNumber(views.reduce((s, r) => s + r.remaining, 0))} 盒</small></div>{!active && <button className="button ghost" onClick={() => { if (window.confirm('切换后该历史周期将成为当前操作周期，是否继续？')) setState((current) => ({ ...current, currentCycleId: item.id })) }}>切换</button>}</article> })}{!state.cycles.length && <SmallEmpty text="还没有历史库存周期" />}</div></>}

          {view === 'settings' && <><section className="page-heading compact"><div><span className="eyebrow">浏览器本地模式</span><h1>数据设置</h1><p>管理全局默认值和每个库存批次的独立预警线。</p></div></section><div className="settings-grid"><section className="panel settings-panel"><h2>默认预警规则</h2><label>默认库存预警值（盒）<input type="number" min="0" value={state.lowStockThreshold} onChange={(e) => setState({ ...state, lowStockThreshold: Number(e.target.value) })} /></label><label>近效期提醒（天）<input type="number" min="1" value={state.expiryWarningDays} onChange={(e) => setState({ ...state, expiryWarningDays: Number(e.target.value) })} /></label><p>未单独设置预警值的批次使用全局默认值。</p></section><section className="panel settings-panel"><h2>备份与恢复</h2><p>GitHub Pages 不保存业务数据。更换设备或清理浏览器前，请先下载 JSON 备份。</p><div className="button-stack"><button className="button secondary" onClick={() => downloadJson(state)}><Download size={17} />下载完整备份</button><button className="button ghost" onClick={() => restoreInput.current?.click()}><Upload size={17} />恢复 JSON 备份</button></div></section>{cycle && <ThresholdManager rows={batchViews} defaultThreshold={state.lowStockThreshold} onChange={setBatchThreshold} />}<section className="panel settings-panel danger-zone"><h2>清除数据</h2><p>清除当前浏览器中的全部库存周期与设置。此操作无法撤销。</p><button className="button danger" onClick={() => { if (window.confirm('确定清除全部本地数据吗？此操作无法撤销。')) setState(EMPTY_STATE) }}><Trash2 size={17} />清除全部数据</button></section></div></>}
        </div>
      </main>

      <nav className="bottom-nav">{navItems.slice(0, 4).map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><item.icon size={20} /><span>{item.label.replace('库存', '')}</span>{item.id === 'outbound' && exceptions.length > 0 && <b>{exceptions.length}</b>}</button>)}</nav>
      {toast && <div className={`toast ${toast.kind}`}>{toast.kind === 'success' ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}{toast.message}</div>}
      {batchModal !== undefined && <BatchModal initial={batchModal} defaultThreshold={state.lowStockThreshold} onClose={() => setBatchModal(undefined)} onSave={saveBatch} onDelete={batchModal ? () => { updateCycle((current) => ({ ...current, batches: current.batches.filter((row) => row.id !== batchModal.id) })); setBatchModal(undefined) } : undefined} />}
      {outboundModal !== undefined && cycle && <OutboundModal initial={outboundModal} batches={cycle.batches} onClose={() => setOutboundModal(undefined)} onSave={saveOutbound} onDelete={outboundModal ? () => { updateCycle((current) => ({ ...current, outbounds: current.outbounds.filter((row) => row.id !== outboundModal.id) })); setOutboundModal(undefined) } : undefined} />}
    </div>
  )
}

function Metric({ label, value, note, tone, icon: Icon }: { label: string; value: string; note: string; tone: string; icon: typeof Boxes }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={21} /></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>
}

function StatusPill({ status }: { status: OutboundRecord['matchStatus'] }) {
  const labels = { matched: '已匹配', unmatched: '待匹配', overdrawn: '超出库存' }
  return <span className={`status ${status}`}>{labels[status]}</span>
}

function SmallEmpty({ text }: { text: string }) { return <div className="small-empty"><CalendarClock size={24} /><span>{text}</span></div> }

function ThresholdManager({ rows, defaultThreshold, onChange }: { rows: BatchView[]; defaultThreshold: number; onChange: (batchId: string, value?: number) => void }) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredRows = useMemo(() => normalizedQuery
    ? rows.filter((row) => [row.name, row.sku, row.batchNo].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedQuery)))
    : rows, [rows, normalizedQuery])
  const warningCount = rows.filter((row) => row.remaining <= (row.warningThreshold ?? defaultThreshold)).length
  return <section className="panel settings-panel threshold-manager"><div className="panel-heading"><div><span className="eyebrow">当前周期</span><h2>批次库存预警管理</h2></div><span className="manager-count">{warningCount} 个预警</span></div><div className="threshold-toolbar"><label className="search"><Search size={18} /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索产品名称、品种编码或批号" aria-label="搜索预警批次" />{query && <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="清空搜索"><X size={15} /></button>}</label><span>{normalizedQuery ? `找到 ${filteredRows.length} / ${rows.length} 个批次` : `共 ${rows.length} 个批次`}</span></div><div className="threshold-list">{filteredRows.length ? filteredRows.map((row) => { const threshold = row.warningThreshold ?? defaultThreshold; const warning = row.remaining <= threshold; return <div className={`threshold-row ${warning ? 'warning' : ''}`} key={row.id}><div><strong>{row.name}</strong><span>{row.sku} · {row.batchNo} · 当前余量 {formatNumber(row.remaining)} 盒</span></div><label>预警值<input aria-label={`${row.batchNo} 预警值`} type="number" min="0" step="any" value={threshold} onChange={(e) => onChange(row.id, Number(e.target.value))} /></label><button className="button ghost mini" disabled={row.warningThreshold === undefined} onClick={() => onChange(row.id, undefined)}>使用默认</button><span className={`stock-status ${warning ? 'warning' : 'normal'}`}>{warning ? '重点关注' : '正常'}</span></div> }) : <div className="threshold-empty"><Search size={22} /><span>没有找到匹配的库存批次</span><button type="button" className="text-button" onClick={() => setQuery('')}>清空搜索</button></div>}</div></section>
}

function BatchModal({ initial, defaultThreshold, onClose, onSave, onDelete }: { initial: InventoryBatch | null; defaultThreshold: number; onClose: () => void; onSave: (value: InventoryBatch) => void; onDelete?: () => void }) {
  const [form, setForm] = useState<InventoryBatch>(initial ?? { id: id(), sku: '', name: '', quantity: 0, batchNo: '', expiryDate: '' })
  const field = (key: keyof InventoryBatch, value: string | number | undefined) => setForm({ ...form, [key]: value })
  return <Modal title={initial ? '修改库存批次' : '手工添加库存'} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSave(form) }}><div className="form-grid"><label>货号<input required value={form.sku} onChange={(e) => field('sku', e.target.value)} /></label><label>批号<input required value={form.batchNo} onChange={(e) => field('batchNo', e.target.value)} /></label><label className="span-2">产品名称<input required value={form.name} onChange={(e) => field('name', e.target.value)} /></label><label>期初数量<input required min="0" step="any" type="number" value={form.quantity} onChange={(e) => field('quantity', Number(e.target.value))} /></label><label>有效期<input type="date" value={form.expiryDate} onChange={(e) => field('expiryDate', e.target.value)} /></label><label className="span-2">库存预警值（盒）<input min="0" step="any" type="number" value={form.warningThreshold ?? ''} placeholder={`留空使用默认值 ${defaultThreshold}`} onChange={(e) => field('warningThreshold', e.target.value === '' ? undefined : Number(e.target.value))} /></label></div><div className="modal-actions">{onDelete && <button type="button" className="button danger-link" onClick={() => window.confirm('确定删除这个库存批次吗？') && onDelete()}><Trash2 size={17} />删除</button>}<span /><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary">保存</button></div></form></Modal>
}

function OutboundModal({ initial, batches, onClose, onSave, onDelete }: { initial: OutboundRecord | null; batches: InventoryBatch[]; onClose: () => void; onSave: (value: OutboundRecord) => void; onDelete?: () => void }) {
  const [form, setForm] = useState<OutboundRecord>(initial ?? { id: id(), documentNo: '', date: localDate(), department: '', productCode: '', name: '', quantity: 1, batchNo: '', expiryDate: '', matchStatus: 'unmatched', sourceKey: id(), createdAt: new Date().toISOString() })
  const field = (key: keyof OutboundRecord, value: string | number | undefined) => setForm({ ...form, [key]: value })
  return <Modal title={initial ? '修改出库记录' : '手工添加出库'} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); const matched = batches.find((b) => b.id === form.matchedBatchId); onSave({ ...form, batchNo: matched?.batchNo ?? form.batchNo, name: form.name || matched?.name || '', matchStatus: matched ? 'matched' : 'unmatched' }) }}><div className="form-grid"><label>出库单号<input value={form.documentNo} onChange={(e) => field('documentNo', e.target.value)} /></label><label>出库日期<input type="date" value={form.date} onChange={(e) => field('date', e.target.value)} /></label><label className="span-2">匹配库存批次<select value={form.matchedBatchId ?? ''} onChange={(e) => { const matched = batches.find((b) => b.id === e.target.value); setForm({ ...form, matchedBatchId: matched?.id, batchNo: matched?.batchNo ?? form.batchNo, name: matched?.name ?? form.name, productCode: form.productCode || matched?.sku || '' }) }}><option value="">暂不匹配</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batchNo} · {batch.name} · 期初 {batch.quantity}</option>)}</select></label><label className="span-2">产品名称<input required value={form.name} onChange={(e) => field('name', e.target.value)} /></label><label>品种/产品编码<input value={form.productCode} onChange={(e) => field('productCode', e.target.value)} /></label><label>批号<input value={form.batchNo} onChange={(e) => field('batchNo', e.target.value)} /></label><label>数量<input required min="0.01" step="any" type="number" value={form.quantity} onChange={(e) => field('quantity', Number(e.target.value))} /></label><label>领用科室<input value={form.department} onChange={(e) => field('department', e.target.value)} /></label></div><div className="modal-actions">{onDelete && <button type="button" className="button danger-link" onClick={() => window.confirm('确定删除这条出库记录吗？') && onDelete()}><Trash2 size={17} />删除</button>}<span /><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary">保存</button></div></form></Modal>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal"><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={20} /></button></div>{children}</div></div>
}
