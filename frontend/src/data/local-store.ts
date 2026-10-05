import { SEED_ROWS, SEED_TODOS } from './seed'
import type { EntryRow, TodoItem } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type Dataset = Record<string, EntryRow[]>
const TODO_BUCKET = '__todos__'
type StorageShape = Record<string, EntryRow[] | TodoItem[]>

function seedDataset(): StorageShape {
  return { ...clone(SEED_ROWS), [TODO_BUCKET]: clone(SEED_TODOS) }
}

function readStorage(): StorageShape {
  const fallback = seedDataset()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as StorageShape
    // 旧版本没有待补样桶或新增模块时，用示例数据补齐，避免读取到 undefined。
    return { ...fallback, ...parsed, [TODO_BUCKET]: parsed[TODO_BUCKET] ?? fallback[TODO_BUCKET] }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: StorageShape | null = null

function ensureCache(): StorageShape {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Dataset {
  return ensureCache() as Dataset
}

export function listRows(key: string): EntryRow[] {
  return (ensureCache()[key] ?? []) as EntryRow[]
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commit({ [key]: rows })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function listTodos(): TodoItem[] {
  return (ensureCache()[TODO_BUCKET] ?? []) as TodoItem[]
}

// 跨业务面的一批改动只提交一次：要么整体生效，要么保存抛错时完全恢复现场。
// 浮选退回同时要改浮选行、关联测年单、待补样事项，必须走这里。
export function commit(changes: {
  rows?: Record<string, EntryRow[]>
  todos?: TodoItem[]
}): void {
  const current = ensureCache()
  const snapshot = clone(current)
  const next: StorageShape = {
    ...current,
    ...changes.rows,
    [TODO_BUCKET]: changes.todos ?? current[TODO_BUCKET] ?? [],
  }
  cache = next
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    }
  } catch (error) {
    // 持久化失败：内存缓存与已写状态一并回滚，调用方据此告知用户整体未生效。
    cache = snapshot
    throw error instanceof Error ? error : new Error('数据保存失败')
  }
}

export function resetTodos(): TodoItem[] {
  const todos = clone(SEED_TODOS)
  commit({ todos })
  return todos
}

export function storageKey(): string {
  return STORAGE_KEY
}
