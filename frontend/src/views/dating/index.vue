<template>
  <section class="page" data-module="dating">
    <header class="page-head">
      <div>
        <h2>测年送检管理</h2>
        <p class="page-desc">
          维护测年送检单。浮选样本「送出检测」时在此自动生成送检单，检测中间字段随样本同轮回写；
          样本退回后旧送检单作废并清空检测字段，补样重送生成新单，新旧报告不再串档。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记测年送检单</button>
        <button class="btn" type="button" @click="exportRows">导出测年送检清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">送检总数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检测中数</span>
        <strong class="stat-value">{{ testingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已出结果数</span>
        <strong class="stat-value">{{ doneCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <ResamplePanel :refresh-tick="tick" @resend="openResend" />

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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>{{ row['送检编号'] ?? '—' }}</td>
          <td>
            <span v-if="row['来源样本编号']">{{ row['来源样本编号'] }}（浮选联动）</span>
            <span v-else class="muted">独立送检</span>
          </td>
          <td>{{ row['采样单位'] ?? '—' }}</td>
          <td>{{ row['采样层位'] ?? '—' }}</td>
          <td>{{ row['送检方法'] ?? '—' }}</td>
          <td>{{ row['送检日期'] || '—' }}</td>
          <td>{{ row['来源样本编号'] ? `第${row['检测轮次']}轮` : '—' }}</td>
          <td>{{ row['检测编号'] || '—' }}</td>
          <td>{{ row['检测结论'] || '—' }}</td>
          <td>{{ row['报告编号'] || '—' }}</td>
          <td :class="{ 'status-cancelled': row.status === '已取消' }">{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!actionsFor(row).length" class="muted">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无测年送检数据</td>
        </tr>
      </tbody>
    </table>

    <p class="round-note">
      说明：标注「浮选联动」的送检单由浮选样本送检生成，其开始检测、登记结果、复核均在浮选采样页按同一检测轮次操作，
      本页不再开放独立结果登记，避免与样本报告对不上。
    </p>

    <footer class="page-foot">
      <span>共 {{ total }} 条测年送检记录 · 当前身份：{{ store.unit }}·{{ store.operator }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import ResamplePanel from '@/components/ResamplePanel.vue'
import { resendFromTodo } from '@/api/flotation-domain'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('dating')
const columns = ['送检编号', '来源样本', '采样单位', '采样层位', '送检方法', '送检日期', '检测轮次', '检测编号', '检测结论', '报告编号']
const statuses = ['待送检', '已送检', '检测中', '待复核', '已出结果', '已取消', '已归档']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['送检编号', '采样单位', '来源样本编号']
const tick = ref(0)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const testingCount = computed(() => rows.value.filter((row) => ['已送检', '检测中', '待复核'].includes(row.status)).length)
const doneCount = computed(() => rows.value.filter((row) => ['已出结果', '已归档'].includes(row.status)).length)

function isLinked(row: EntryRow): boolean {
  return row.来源样本编号 !== '' && row.来源样本编号 !== undefined
}

/** 联动送检单的检测/复核动作归属浮选业务面；本页只保留独立送检单的通用流转与归档。 */
function actionsFor(row: EntryRow): string[] {
  if (isLinked(row)) {
    return row.status === '已出结果' ? ['归档报告'] : []
  }
  switch (row.status) {
    case '待送检':
      return ['送出检测']
    case '已送检':
    case '检测中':
      return ['登记结果']
    case '已出结果':
      return ['归档报告']
    default:
      return []
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '测年送检单登记入口尚未接入审批流'
}

function openResend(todoId: number) {
  const result = resendFromTodo(todoId, { operator: store.operator, unit: store.unit })
  finish(result)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result: ActionResult = applyAction(meta.key, Number(row.id), action)
  finish(result)
}

function finish(result: ActionResult) {
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  tick.value += 1
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    tick.value += 1
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '测年送检列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.muted {
  color: #9aa0a6;
}
.status-cancelled {
  color: #c0392b;
}
.round-note {
  margin-top: 12px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
</style>
