<template>
  <section class="page" data-module="dating">
    <header class="page-head">
      <div>
        <h2>测年送检管理</h2>
        <p class="page-desc">维护测年送检单，围绕送检编号、样品类型、采样单位、采样层位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记测年送检单</button>
        <button class="btn" type="button" @click="exportRows">导出测年送检清单</button>
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
      <h3>跨业务面待补样事项（由浮选采样退回生成，请回浮选页面补样）</h3>
      <ul v-if="resampleTodos.length">
        <li v-for="todo in resampleTodos" :key="todo.id">
          {{ todo.title }}｜采样单位：{{ todo.samplingUnit }}｜退回原因：{{ todo.reason }}｜第 {{ todo.round }} 轮
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
          <th>关联浮选样本/轮次</th>
          <th>留痕</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <template v-if="row._flotationId !== undefined">
              FLOT-{{ String(row._flotationId).padStart(4, '0') }} · 第 {{ row._round ?? 1 }} 轮
            </template>
            <template v-else>—</template>
          </td>
          <td>
            <span v-if="String(row.status) === '已作废'" class="error-text">
              已作废：{{ row._invalidReason }}（{{ row._invalidAt }}）
            </span>
            <span v-else-if="row.检测结论" class="page-desc">
              结论版本 v{{ row._version }} · {{ row.出结果日期 }}
            </span>
            <span v-else>—</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="resultDraftId === Number(row.id)">
              <span class="inline-form">
                <input v-model="resultForm.conclusion" type="text" placeholder="检测结论" />
                <input v-model="resultForm.period" type="text" placeholder="年代判定" />
                <button class="link" type="button" @click="submitResult(row)">提交结论（v{{ resultDraftVersion }}）</button>
                <button class="link" type="button" @click="cancelResult">取消</button>
              </span>
            </template>
            <template v-else>
              <button
                v-for="action in datingActionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <span v-if="!datingActionsFor(row).length" class="page-desc">无</span>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无测年送检数据，送检单由浮选采样「送出检测」自动生成</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条测年送检记录 · 当前操作单位：{{ store.unit }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  datingActionsFor,
  downloadEntries,
  listEntries,
  listResampleTodos,
  moduleMeta,
  runDatingAction,
} from '@/api/local-service'
import type { EntryRow, TodoItem } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('dating')
const store = useSessionStore()
const columns = meta.fields
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const resampleTodos = ref<TodoItem[]>([])

// 打开录入框时定格送检单版本；并发下另一个结论先生效会让版本号变化，提交时被拒。
const resultDraftId = ref<number | null>(null)
const resultDraftVersion = ref(0)
const resultForm = ref({ conclusion: '', period: '' })

const stats = computed(() => [
  { label: '送检总数', value: rows.value.length },
  { label: '检测中数', value: rows.value.filter((row) => String(row.status) === '检测中').length },
  { label: '已出结果数', value: rows.value.filter((row) => String(row.status) === '已出结果').length },
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
  errorMessage.value = '测年送检单由浮选采样「送出检测」自动生成，不手工登记'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '登记结果') {
    resultDraftId.value = Number(row.id)
    // 每次打开都是空白表单，不会把上一次实验室填写内容带出来。
    resultForm.value = { conclusion: '', period: '' }
    resultDraftVersion.value = Number(row._version ?? 1)
    return
  }
  const result = runDatingAction(
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

function submitResult(row: EntryRow) {
  const result = runDatingAction(
    Number(row.id),
    '登记结果',
    { operator: { name: store.operator, unit: store.unit } },
    { conclusion: resultForm.value.conclusion, period: resultForm.value.period },
    resultDraftVersion.value,
  )
  cancelResult()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function cancelResult() {
  resultDraftId.value = null
  resultForm.value = { conclusion: '', period: '' }
  resultDraftVersion.value = 0
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    resampleTodos.value = listResampleTodos(true)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '测年送检列表读取失败'
  }
}

onMounted(reload)
</script>
