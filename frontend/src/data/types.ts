/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
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

export type Operator = {
  name: string
  unit: string
}

export type ActionContext = {
  operator: Operator
}

export type LabResultForm = {
  conclusion: string
  period: string
}

// 跨业务面的待办事项：浮选样本退回后，在浮选采样与测年送检两个业务面都要能看到。
export type TodoItem = {
  id: number
  kind: 'flotation-resample'
  title: string
  module: string
  refId: number
  refCode: string
  samplingUnit: string
  reason: string
  round: number
  status: 'open' | 'done'
  createdAt: string
  doneAt?: string
  newDatingId?: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
