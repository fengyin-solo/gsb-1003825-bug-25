import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, commit, listRows, listTodos, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionContext,
  ActionResult,
  EntryRow,
  LabResultForm,
  ModuleMeta,
  OverviewResult,
  PageResult,
  TodoItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const FLOTATION_KEY = 'flotation'
const DATING_KEY = 'dating'

// 本轮检测写在浮选样本上的中间字段：退回时必须整体清空，复核归档时转入快照字段。
const FLOTATION_LAB_FIELDS = ['检测结论', '年代判定', '实验室', '出结果日期']

// 浮选状态机：每个状态只允许页面出现这里登记的动作，已归档为历史终态不再放行任何动作。
const FLOTATION_ACTION_BY_STATUS: Record<string, string[]> = {
  已采集: ['执行浮选'],
  已浮选: ['完成分拣'],
  已分拣: ['送出检测'],
  已送检: ['退回'],
  检测中: ['退回'],
  已出结果: ['复核通过', '退回'],
  已退回: ['完成补样'],
  已归档: [],
}

// 可执行退回的状态：样本必须处于本轮送检链路中；已归档历史报告不允许退回。
const RETURNABLE_STATUS = ['已送检', '检测中', '已出结果']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) ?? 0), 0) + 1
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function stripFields(row: EntryRow, fields: string[]): EntryRow {
  const next = { ...row }
  for (const field of fields) {
    delete next[field]
  }
  return next
}

function replaceRow(rows: EntryRow[], id: number, updated: EntryRow): EntryRow[] {
  return rows.map((row) => (Number(row.id) === id ? updated : row))
}

function findRow(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

// 任何持久化异常都转成统一结果：commit 内部已恢复现场，这里只负责把消息带回页面。
function persist(changes: { rows?: Record<string, EntryRow[]>; todos?: TodoItem[] }): ActionResult | null {
  try {
    commit(changes)
    return null
  } catch (error) {
    return {
      ok: false,
      message: `保存失败，本次操作已整体回滚：${error instanceof Error ? error.message : '未知存储错误'}`,
    }
  }
}

// 通用动作流转：仅服务于没有专用业务规则的模块；浮选/测年必须走各自的领域动作。
export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === FLOTATION_KEY || key === DATING_KEY) {
    return { ok: false, message: `${key === FLOTATION_KEY ? '浮选样本' : '测年送检单'}须走送检/退回/复核专用流程` }
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// ---------------------------------------------------------------------------
// 浮选采样 × 测年送检 专用业务规则
// ---------------------------------------------------------------------------

// 页面按状态渲染动作按钮，杜绝列表页对任意状态恒显示全部按钮。
export function flotationActionsFor(row: EntryRow): string[] {
  return FLOTATION_ACTION_BY_STATUS[String(row.status)] ?? []
}

export function datingActionsFor(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待送检':
      return []
    case '已送检':
      return ['开始检测']
    case '检测中':
      return ['登记结果']
    default:
      // 已出结果由浮选侧复核统一归档；已作废、已归档为终态。
      return []
  }
}

export function listResampleTodos(openOnly = true): TodoItem[] {
  const todos = listTodos()
  return openOnly ? todos.filter((item) => item.status === 'open') : todos
}

// 浮选样本动作统一入口：reason 用于退回原因，form 预留扩展。
export function runFlotationAction(
  id: number,
  action: string,
  context: ActionContext,
  options: { reason?: string } = {},
): ActionResult {
  const flotation = listRows(FLOTATION_KEY)
  const row = findRow(flotation, id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的浮选样本` }
  }
  const allowed = FLOTATION_ACTION_BY_STATUS[String(row.status)] ?? []
  if (!allowed.includes(action)) {
    return { ok: false, message: `浮选样本当前为「${row.status}」，不能执行「${action}」` }
  }

  if (action === '执行浮选' || action === '完成分拣') {
    return simpleFlotationForward(row, action)
  }
  if (action === '送出检测') {
    return sendForDating(flotation, row)
  }
  if (action === '退回') {
    return returnFromLab(flotation, row, context, options.reason?.trim() ?? '')
  }
  if (action === '完成补样') {
    return completeResample(flotation, row, context)
  }
  if (action === '复核通过') {
    return reviewAndArchive(flotation, row)
  }
  return { ok: false, message: `未识别的浮选动作「${action}」` }
}

function simpleFlotationForward(row: EntryRow, action: string): ActionResult {
  const meta = moduleMeta(FLOTATION_KEY)
  const target = meta.actionTargets[action]
  const updated: EntryRow = { ...row, status: target, pending: true, abnormal: false }
  const failed = persist({ rows: { [FLOTATION_KEY]: replaceRow(listRows(FLOTATION_KEY), Number(row.id), updated) } })
  return failed ?? { ok: true, message: `浮选样本已${action}，当前状态「${target}」` }
}

// 送出检测：在测年模块生成关联送检单，并在浮选样本上记录送检单位、轮次与关联单。
function sendForDating(flotation: EntryRow[], row: EntryRow): ActionResult {
  const dating = listRows(DATING_KEY)
  // 同一浮选样本第 2 次及以后送检（补样后重送）轮次 +1，旧单即使存在也不再回写。
  const round = Number(row._round ?? 1)
  const datingId = nextId(dating)
  const datingCode = `DATI-${String(datingId).padStart(4, '0')}`
  const datingRow: EntryRow = {
    id: datingId,
    status: '已送检',
    pending: true,
    abnormal: false,
    送检编号: datingCode,
    样品类型: '浮选炭样',
    采样单位: String(row.采样单位 ?? ''),
    采样层位: String(row.采样层位 ?? ''),
    送检方法: 'AMS 碳十四',
    送检日期: today(),
    预计返回: '待定',
    _flotationId: Number(row.id),
    _round: round,
    _version: 1,
  }
  const updatedFlotation: EntryRow = stripFields(
    {
      ...row,
      status: '已送检',
      pending: true,
      abnormal: false,
      送检单位: String(row.采样单位 ?? ''),
      _round: round,
      _datingId: datingId,
      _datingCode: datingCode,
    },
    FLOTATION_LAB_FIELDS,
  )
  const failed = persist({
    rows: {
      [FLOTATION_KEY]: replaceRow(flotation, Number(row.id), updatedFlotation),
      [DATING_KEY]: [...dating, datingRow],
    },
  })
  return failed ?? { ok: true, message: `已生成测年送检单 ${datingCode}，浮选样本进入「已送检」` }
}

// 退回：清空本轮检测中间态、作废关联测年单、生成跨浮选/测年两个业务面的待补样事项。
// 全部改动一次提交，任一保存失败整体回滚；只允许原送检单位操作。
function returnFromLab(
  flotation: EntryRow[],
  row: EntryRow,
  context: ActionContext,
  reason: string,
): ActionResult {
  if (!RETURNABLE_STATUS.includes(String(row.status))) {
    return { ok: false, message: `仅${RETURNABLE_STATUS.join('、')}状态的浮选样本可以退回，「${row.status}」不允许` }
  }
  const originUnit = String(row.送检单位 ?? row.采样单位 ?? '')
  if (context.operator.unit !== originUnit) {
    return {
      ok: false,
      message: `退回仅限原送检单位「${originUnit}」操作，当前单位「${context.operator.unit}」不能替代退回`,
    }
  }
  if (!reason) {
    return { ok: false, message: '退回必须填写退回原因，用于生成待补样事项' }
  }

  const round = Number(row._round ?? 1)
  const dating = listRows(DATING_KEY)
  const nextDating = dating.map((order) => {
    const linked =
      Number(order._flotationId) === Number(row.id) &&
      Number(order._round) === round &&
      String(order.status) !== '已作废'
    if (!linked) {
      return order
    }
    return {
      ...order,
      status: '已作废',
      pending: false,
      abnormal: true,
      _invalidReason: `关联浮选样本退回：${reason}`,
      _invalidAt: today(),
    }
  })

  // 清空本轮检测的实验室中间字段：复检页面不会再看到上一轮实验室填写内容。
  const updatedFlotation: EntryRow = stripFields(
    {
      ...row,
      status: '已退回',
      pending: true,
      abnormal: true,
      _returnReason: reason,
      _returnedAt: today(),
    },
    FLOTATION_LAB_FIELDS,
  )

  const todos = listTodos()
  const todo: TodoItem = {
    id: nextId(todos),
    kind: 'flotation-resample',
    title: `浮选样本 ${String(row.样本编号)} 待补样后重新送检`,
    module: FLOTATION_KEY,
    refId: Number(row.id),
    refCode: String(row.样本编号),
    samplingUnit: originUnit,
    reason,
    round,
    status: 'open',
    createdAt: today(),
  }

  const failed = persist({
    rows: {
      [FLOTATION_KEY]: replaceRow(flotation, Number(row.id), updatedFlotation),
      [DATING_KEY]: nextDating,
    },
    todos: [...todos, todo],
  })
  return failed ?? { ok: true, message: `浮选样本已退回并清空本轮检测内容，已生成待补样事项（第 ${round} 轮）` }
}

// 完成补样：关闭对应的待补样事项，样本回到已分拣，之后重新「送出检测」开新一轮。
function completeResample(flotation: EntryRow[], row: EntryRow, context: ActionContext): ActionResult {
  const originUnit = String(row.采样单位 ?? '')
  if (context.operator.unit !== originUnit) {
    return {
      ok: false,
      message: `补样仅限采样单位「${originUnit}」处理，当前单位「${context.operator.unit}」不能代为补样`,
    }
  }
  const todos = listTodos()
  let closed = 0
  const nextTodos = todos.map((item) => {
    if (
      item.kind === 'flotation-resample' &&
      item.status === 'open' &&
      item.refId === Number(row.id)
    ) {
      closed += 1
      return { ...item, status: 'done' as const, doneAt: today() }
    }
    return item
  })
  if (closed === 0) {
    return { ok: false, message: '没有找到该样本处于打开状态的待补样事项，不能完成补样' }
  }
  // 补样后送检属于新一轮：先递增轮次，再清空退回原因。
  const updated: EntryRow = stripFields(
    {
      ...row,
      status: '已分拣',
      pending: true,
      abnormal: false,
      _round: Number(row._round ?? 1) + 1,
    },
    ['_returnReason', '_returnedAt'],
  )
  const failed = persist({
    rows: { [FLOTATION_KEY]: replaceRow(flotation, Number(row.id), updated) },
    todos: nextTodos,
  })
  return failed ?? { ok: true, message: '补样完成，待补样事项已关闭，可重新送出检测' }
}

// 复核通过：只允许本轮关联测年单回写，快照归档；历史已归档样本保持原报告不动。
function reviewAndArchive(flotation: EntryRow[], row: EntryRow): ActionResult {
  const round = Number(row._round ?? 1)
  const dating = listRows(DATING_KEY)
  const order =
    findRow(dating, Number(row._datingId)) ??
    dating.find((item) => Number(item._flotationId) === Number(row.id) && Number(item._round) === round)
  if (!order || Number(order._round) !== round || String(order.status) !== '已出结果') {
    return { ok: false, message: '关联测年单不存在、轮次对不上或尚未出结果，不能复核回写' }
  }

  const updatedFlotation: EntryRow = stripFields(
    {
      ...row,
      status: '已归档',
      pending: false,
      abnormal: false,
      _archiveConclusion: String(order.检测结论 ?? ''),
      _archivePeriod: String(order.年代判定 ?? ''),
      _archiveRound: round,
      _archiveDatingCode: String(order.送检编号 ?? ''),
      _archiveAt: today(),
    },
    FLOTATION_LAB_FIELDS,
  )
  const updatedDating: EntryRow = { ...order, status: '已归档', pending: false, abnormal: false }
  const failed = persist({
    rows: {
      [FLOTATION_KEY]: replaceRow(flotation, Number(row.id), updatedFlotation),
      [DATING_KEY]: replaceRow(dating, Number(order.id), updatedDating),
    },
  })
  return failed ?? { ok: true, message: `复核通过，检测结论已回写并按报告归档（${order.送检编号}）` }
}

// 测年送检动作入口：开始检测 / 登记结果（实验室并发提交结论）。
export function runDatingAction(
  id: number,
  action: string,
  context: ActionContext,
  form?: LabResultForm,
  expectedVersion?: number,
): ActionResult {
  const dating = listRows(DATING_KEY)
  const order = findRow(dating, id)
  if (!order) {
    return { ok: false, message: `没有找到编号为 ${id} 的测年送检单` }
  }

  if (action === '开始检测') {
    if (String(order.status) !== '已送检' && String(order.status) !== '待送检') {
      return { ok: false, message: `测年送检单当前为「${order.status}」，不能开始检测` }
    }
    const flotation = listRows(FLOTATION_KEY)
    const linked = flotation.find(
      (row) =>
        Number(row.id) === Number(order._flotationId) &&
        Number(row._round) === Number(order._round),
    )
    const nextDating = replaceRow(dating, id, { ...order, status: '检测中', pending: true, abnormal: false })
    const nextFlotation = linked
      ? replaceRow(flotation, Number(linked.id), { ...linked, status: '检测中', pending: true, abnormal: false })
      : flotation
    const failed = persist({ rows: { [DATING_KEY]: nextDating, [FLOTATION_KEY]: nextFlotation } })
    return failed ?? { ok: true, message: '实验室已开始检测，浮选样本同步进入「检测中」' }
  }

  if (action === '登记结果') {
    return submitLabResult(dating, order, context, form, expectedVersion)
  }

  return { ok: false, message: `测年送检单不能执行「${action}」` }
}

// 实验室提交结论：乐观版本控制，并发提交时只有第一个结论生效，其余全部拒绝且不落任何字段。
function submitLabResult(
  dating: EntryRow[],
  order: EntryRow,
  context: ActionContext,
  form: LabResultForm | undefined,
  expectedVersion: number | undefined,
): ActionResult {
  // 版本冲突优先判定：并发的两次提交打开时都定格在同一版本，只有一次能对上当前版本。
  if (expectedVersion !== undefined && expectedVersion !== Number(order._version)) {
    return {
      ok: false,
      message: '已有另一个检测结论先一步提交并生效，本次结论未保存（每轮送检仅允许一个结论生效）',
    }
  }
  if (String(order.status) !== '检测中') {
    return { ok: false, message: `仅「检测中」的送检单可以登记结果，当前为「${order.status}」` }
  }
  const conclusion = form?.conclusion.trim() ?? ''
  const period = form?.period.trim() ?? ''
  if (!conclusion || !period) {
    return { ok: false, message: '检测结论与年代判定都必须填写' }
  }

  const round = Number(order._round)
  const flotation = listRows(FLOTATION_KEY)
  const linked = flotation.find((row) => Number(row.id) === Number(order._flotationId))
  if (!linked || Number(linked._round) !== round || !['已送检', '检测中'].includes(String(linked.status))) {
    return {
      ok: false,
      message: `送检单 ${order.送检编号} 与浮选样本当前轮次/状态对不上，结果不予回写，请核对退回或补样记录`,
    }
  }

  const updatedDating: EntryRow = {
    ...order,
    status: '已出结果',
    pending: false,
    abnormal: false,
    检测结论: conclusion,
    年代判定: period,
    实验室: context.operator.unit,
    出结果日期: today(),
    _version: Number(order._version ?? 1) + 1,
  }
  // 回写本轮中间结论到浮选样本；复核前都是临时态，退回即清空。
  const updatedFlotation: EntryRow = {
    ...linked,
    status: '已出结果',
    pending: true,
    abnormal: false,
    检测结论: conclusion,
    年代判定: period,
    实验室: context.operator.unit,
    出结果日期: today(),
  }
  const failed = persist({
    rows: {
      [DATING_KEY]: replaceRow(dating, Number(order.id), updatedDating),
      [FLOTATION_KEY]: replaceRow(flotation, Number(linked.id), updatedFlotation),
    },
  })
  return failed ?? { ok: true, message: `检测结论已登记并回写浮选样本 ${linked.样本编号}，等待采样单位复核` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
