<template>
  <section class="page" data-module="flotation">
    <header class="page-head">
      <div>
        <h2>浮选采样管理</h2>
        <p class="page-desc">维护浮选样本，围绕样本编号、采样单位、采样层位、土样重量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记浮选样本</button>
        <button class="btn" type="button" @click="exportRows">导出浮选采样清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div class="todo-panel">
      <h3>跨业务面待补样事项（测年送检页面同步可见）</h3>
      <ul v-if="resampleTodos.length">
        <li v-for="todo in resampleTodos" :key="todo.id">
          {{ todo.title }}｜采样单位：{{ todo.samplingUnit }}｜退回原因：{{ todo.reason }}｜第 {{ todo.round }} 轮
          <button class="link" type="button" @click="completeResample(todo.refId)">完成补样</button>
        </li>
      </ul>
      <p v-else class="todo-empty">暂无待补样事项</p>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>送检轮次/关联单</th>
          <th>本轮检测 / 归档报告</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <template v-if="row._datingCode">第 {{ row._round ?? 1 }} 轮 · {{ row._datingCode }}</template>
            <template v-else>—</template>
          </td>
          <td>
            <template v-if="String(row.status) === '已归档'">
              <strong>[归档报告·第 {{ row._archiveRound }} 轮 {{ row._archiveDatingCode }}]</strong><br />
              {{ row._archiveConclusion }}<br />
              <span class="page-desc">年代：{{ row._archivePeriod }}</span>
            </template>
            <template v-else-if="String(row.status) === '已退回'">
              —（本轮检测中间态已清空）<br />
              <span class="error-text">退回原因：{{ row._returnReason }}</span>
            </template>
            <template v-else-if="row.检测结论">
              {{ row.检测结论 }}<br />
              <span class="page-desc">年代：{{ row.年代判定 }}（{{ row.实验室 }}）</span>
            </template>
            <template v-else>—</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="returnDraftId === Number(row.id)">
              <input
                v-model="returnReason"
                type="text"
                placeholder="填写退回原因"
                @keyup.enter="confirmReturn(row)"
              />
              <button class="link" type="button" @click="confirmReturn(row)">确认退回</button>
              <button class="link" type="button" @click="cancelReturn">取消</button>
            </template>
            <template v-else>
              <button
                v-for="action in flotationActionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <span v-if="!flotationActionsFor(row).length" class="page-desc">无</span>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无浮选采样数据，可先登记浮选样本</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条浮选采样记录 · 当前操作单位：{{ store.unit }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  flotationActionsFor,
  listEntries,
  listResampleTodos,
  moduleMeta,
  runFlotationAction,
} from '@/api/local-service'
import type { EntryRow, TodoItem } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('flotation')
const store = useSessionStore()
const columns = meta.fields
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const resampleTodos = ref<TodoItem[]>([])
const returnDraftId = ref<number | null>(null)
const returnReason = ref('')

const stats = computed(() => [
  { label: '样本总数', value: rows.value.length },
  { label: '检测中数', value: rows.value.filter((row) => String(row.status) === '检测中').length },
  { label: '待补样数', value: rows.value.filter((row) => String(row.status) === '已退回').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '浮选样本登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '退回') {
    returnDraftId.value = Number(row.id)
    returnReason.value = ''
    return
  }
  const result = runFlotationAction(
    Number(row.id),
    action,
    { operator: { name: store.operator, unit: store.unit } },
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function confirmReturn(row: EntryRow) {
  const result = runFlotationAction(
    Number(row.id),
    '退回',
    { operator: { name: store.operator, unit: store.unit } },
    { reason: returnReason.value },
  )
  returnDraftId.value = null
  returnReason.value = ''
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function cancelReturn() {
  returnDraftId.value = null
  returnReason.value = ''
}

function completeResample(refId: number) {
  errorMessage.value = ''
  const result = runFlotationAction(
    refId,
    '完成补样',
    { operator: { name: store.operator, unit: store.unit } },
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    resampleTodos.value = listResampleTodos(true)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '浮选采样列表读取失败'
  }
}

onMounted(reload)
</script>
