/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 一次检测轮次中实验室填写、尚未被复核确认冻结的中间字段。退回时整组清空。 */
export type LabDraft = {
  检测室: string
  检测填写人: string
  检测编号: string
  初步结果: string
  检测结论: string
  检测提交时间: string
}

/** 复核通过后冻结的检测报告，按检测轮次累积；历史报告不因后续退回而改动。 */
export type LabReport = {
  轮次: number
  检测编号: string
  检测室: string
  检测填写人: string
  初步结果: string
  检测结论: string
  检测提交时间: string
  复核人: string
  复核时间: string
  报告编号: string
  关联送检单: number
}

/** 跨浮选采样、测年送检两个业务面共享的待补样事项。 */
export type ResampleTodo = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  样本ID: number
  样本编号: string
  采样单位: string
  原送检单位: string
  采样层位: string
  检测轮次: number
  原送检单ID: number
  退回原因: string
  退回时间: string
  事项状态: string
  新送检单ID: number | null
  [field: string]: string | number | boolean | null
}

export type EntryValue = string | number | boolean | LabDraft | LabReport[] | null

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 乐观锁版本：实验室并发提交结论时，只有版本匹配的首个结论生效。 */
  version?: number
  [field: string]: EntryValue | undefined
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 动作上下文：当前操作人及其所属单位，退回等动作按单位鉴权。 */
export type ActionContext = {
  operator: string
  unit: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
