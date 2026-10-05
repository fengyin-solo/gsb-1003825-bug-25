import type { ActionContext, LabDraft, LabReport, ResampleTodo } from './types'

/** 实验室在「检测中 → 待复核」期间填写的中间字段，退回时按这份清单整组清空。 */
export const LAB_DRAFT_FIELDS: (keyof LabDraft)[] = [
  '检测室',
  '检测填写人',
  '检测编号',
  '初步结果',
  '检测结论',
  '检测提交时间',
]

export function createEmptyDraft(): LabDraft {
  return { 检测室: '', 检测填写人: '', 检测编号: '', 初步结果: '', 检测结论: '', 检测提交时间: '' }
}

export function createReport(partial: Omit<LabReport, never>): LabReport {
  return { ...partial }
}

/** 待补样事项的「事项状态」取值。 */
export const TODO_OPEN = '待补样'
export const TODO_DONE = '已重新送检'

export function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function nowStamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

export type Failure = { ok: false; message: string }
export type Success<T = undefined> = { ok: true; message: string; data: T }
export type Outcome<T = undefined> = Success<T> | Failure

export function fail(message: string): Failure {
  return { ok: false, message }
}

export function succeed<T>(message: string, data: T): Success<T> {
  return { ok: true, message, data }
}

export function ctxLabel(ctx: ActionContext): string {
  return `${ctx.unit}·${ctx.operator}`
}

export function openResampleTodo(
  partial: Omit<ResampleTodo, 'status' | 'pending' | 'abnormal' | '事项状态'>,
): ResampleTodo {
  return {
    ...partial,
    status: TODO_OPEN,
    pending: true,
    abnormal: false,
    事项状态: TODO_OPEN,
  } as ResampleTodo
}
