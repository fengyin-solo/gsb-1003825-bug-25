import { SEED_ROWS } from './seed'
import type { EntryRow, LabDraft, LabReport } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'
// 跨业务面共享的「待补样事项」表键，浮选页与测年页读同一份。
export const RESAMPLE_TODO_KEY = 'resampleTodos'

export type DataTables = Record<string, EntryRow[]>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function emptyDraft(): LabDraft {
  return { 检测室: '', 检测填写人: '', 检测编号: '', 初步结果: '', 检测结论: '', 检测提交时间: '' }
}

/**
 * 旧缓存迁移：检测流程上线后，浮选样本需要带上送检单位、检测轮次与检测中间字段。
 * 迁移只补缺字段，不回改任何历史报告——历史已完成样本仍按当时报告保留。
 */
function migrateFlotation(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row, version: typeof row.version === 'number' ? row.version : 0 }
  if (!('送检单位' in next)) {
    next.送检单位 = ''
  }
  if (!('检测轮次' in next)) {
    next.检测轮次 = 0
  }
  if (!('待补样原因' in next)) {
    next.待补样原因 = ''
  }
  if (!('检测中间态' in next)) {
    next.检测中间态 = emptyDraft()
  }
  if (!('检测历史报告' in next)) {
    next.检测历史报告 = [] as LabReport[]
  }
  if (!('结果报告' in next)) {
    next.结果报告 = ''
  }
  if (!('复核人' in next)) {
    next.复核人 = ''
  }
  if (!('复核时间' in next)) {
    next.复核时间 = ''
  }
  return next
}

/** 测年送检单若是浮选样本送检时生成的，用这些字段回溯来源样本与检测轮次。 */
function migrateDating(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row, version: typeof row.version === 'number' ? row.version : 0 }
  for (const field of ['来源样本ID', '来源样本编号', '检测轮次', '检测编号', '检测结论', '初步结果', '检测室', '检测填写人', '复核人', '报告编号', '原送检单ID']) {
    if (!(field in next)) {
      next[field] = ''
    }
  }
  return next
}

function readStorage(): DataTables {
  const fallback = clone(SEED_ROWS) as DataTables
  if (typeof window === 'undefined' || !window.localStorage) {
    return normalize(fallback)
  }
  let parsed: DataTables
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    parsed = fallback
  } else {
    try {
      parsed = { ...fallback, ...(JSON.parse(raw) as DataTables) }
    } catch {
      parsed = fallback
    }
  }
  const normalized = normalize(parsed)
  // 迁移结果尽力落库；存储不可用时读路径仍可用内存兜底，真正的写入失败由 commit 抛出回滚。
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // 忽略迁移落库失败，不影响本次内存读取。
  }
  return normalized
}

function normalize(tables: DataTables): DataTables {
  return {
    ...tables,
    flotation: (tables.flotation ?? []).map(migrateFlotation),
    dating: (tables.dating ?? []).map(migrateDating),
    [RESAMPLE_TODO_KEY]: tables[RESAMPLE_TODO_KEY] ?? [],
  }
}

let cache: DataTables | null = null
// 跨标签页：别的标签页提交检测结论后，本标签页不得再用旧内存缓存覆盖它。
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
  })
}

export function allRows(): DataTables {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commit({ [key]: rows })
}

/**
 * 多表事务提交：调用方先在克隆数据上完成全部业务变更，再一次性落库。
 * 序列化或 localStorage 写入失败（配额、存储被禁等）时不触碰内存缓存，
 * 保证浮选样本、测年送检单、待补样事项要么全部生效、要么整体回滚。
 */
export function commit(nextTables: DataTables): void {
  const snapshot = allRows()
  const merged: DataTables = { ...snapshot, ...nextTables }
  const serialized = JSON.stringify(merged)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, serialized)
  }
  cache = merged
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
