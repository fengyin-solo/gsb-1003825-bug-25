<template>
  <section class="page" data-module="flotation">
    <header class="page-head">
      <div>
        <h2>浮选采样管理</h2>
        <p class="page-desc">
          维护浮选样本，围绕样本编号、采样单位、采样层位、土样重量做登记、筛选与检测流转。
          送检、检测、复核、退回全程按检测轮次留痕，退回只清本次检测中间态，历史报告不动。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记浮选样本</button>
        <button class="btn" type="button" @click="exportRows">导出浮选采样清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">样本总数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检测中数</span>
        <strong class="stat-value">{{ testingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待补样数</span>
        <strong class="stat-value">{{ returnedCount }}</strong>
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
          <td>{{ row['样本编号'] ?? '—' }}</td>
          <td>{{ row['采样单位'] ?? '—' }}</td>
          <td>{{ row['采样层位'] ?? '—' }}</td>
          <td>{{ row['土样重量'] ?? '—' }}</td>
          <td>{{ row['浮选日期'] || '—' }}</td>
          <td>{{ row['轻浮物类型'] || '—' }}</td>
          <td>{{ row['送检单位'] || '—' }}</td>
          <td>第{{ Number(row['检测轮次']) || 0 }}轮</td>
          <td>{{ row['检测编号'] || '—' }}</td>
          <td>{{ row['检测结论'] || '—' }}</td>
          <td>
            <span v-if="row['结果报告']">{{ row['结果报告'] }}</span>
            <span v-else class="muted">—</span>
          </td>
          <td :class="{ 'status-returned': row.status === '已退回' }">{{ row.status }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无浮选采样数据</td>
        </tr>
      </tbody>
    </table>

    <p class="round-note">
      说明：检测编号、初步结果、检测结论均为「本次检测」中间字段，退回后立即清空，复检须重新填写；
      已返回样本的最终报告以「结果报告/检测历史报告」为准，后续补样不改动历史报告。
    </p>

    <footer class="page-foot">
      <span>共 {{ total }} 条浮选采样记录 · 当前身份：{{ store.unit }}·{{ store.operator }}（切换身份可验证跨单位退回拦截）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 送出检测 / 补样重送 -->
    <ActionModal
      :open="modal === 'send'"
      :title="sendForm.todoId ? `补样后重新送检 · ${sendForm.样本编号}` : `送出检测 · ${sendForm.样本编号}`"
      confirm-text="确认送出"
      @cancel="closeModal"
      @confirm="confirmSend"
    >
      <p class="form-tip">
        送出后将在「测年送检」业务面生成送检单，检测轮次计为第 {{ sendForm.nextRound }} 轮；
        旧送检单作废并清空其上的检测中间字段。
      </p>
      <label class="form-item">
        <span>补样土样重量</span>
        <input v-model="sendForm.土样重量" placeholder="如 7.6kg（补样重送建议填写）" />
      </label>
      <label class="form-item">
        <span>轻浮物类型</span>
        <input v-model="sendForm.轻浮物类型" placeholder="如 炭化植物种子" />
      </label>
    </ActionModal>

    <!-- 检测室登记结果（乐观锁） -->
    <ActionModal
      :open="modal === 'lab'"
      :title="`检测室登记结果 · ${labForm.样本编号}（第${labForm.round}轮）`"
      confirm-text="提交结论并送复核"
      @cancel="closeModal"
      @confirm="confirmLab"
    >
      <p class="form-tip">
        基于版本 v{{ labForm.expectedVersion }} 提交；若其他检测员已先行提交，本次结论将被拒绝，只有首个结论生效。
      </p>
      <label class="form-item">
        <span>检测编号 *</span>
        <input v-model="labForm.检测编号" placeholder="如 LAB-2026-0021" />
      </label>
      <label class="form-item">
        <span>初步结果 *</span>
        <textarea v-model="labForm.初步结果" rows="3" placeholder="本次观察/测量的初步结果" />
      </label>
      <label class="form-item">
        <span>检测结论 *</span>
        <textarea v-model="labForm.检测结论" rows="2" placeholder="是否合格、能否用于测年" />
      </label>
    </ActionModal>

    <!-- 退回 -->
    <ActionModal
      :open="modal === 'return'"
      :title="`退回样本 · ${returnForm.样本编号}（第${returnForm.round}轮）`"
      confirm-text="确认退回并生成待补样"
      @cancel="closeModal"
      @confirm="confirmReturn"
    >
      <p class="form-tip">
        退回仅允许原送检单位「{{ returnForm.ownerUnit }}」执行；提交后将清空本次检测中间字段、
        作废送检单，并跨浮选/测年两个业务面生成待补样事项。
      </p>
      <label class="form-item">
        <span>退回原因 *</span>
        <textarea v-model="returnForm.退回原因" rows="3" placeholder="如 样品污染、量不足，需重新采样" />
      </label>
    </ActionModal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import ResamplePanel from '@/components/ResamplePanel.vue'
import ActionModal from '@/components/ActionModal.vue'
import {
  approveReview,
  availableActions,
  completeSorting,
  executeFlotation,
  listResampleTodos,
  resendFromTodo,
  returnSample,
  sendForTesting,
  startTesting,
  submitLabResult,
  type ReturnInput,
  type SendInput,
} from '@/api/flotation-domain'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('flotation')
const columns = ['样本编号', '采样单位', '采样层位', '土样重量', '浮选日期', '轻浮物类型', '送检单位', '检测轮次', '检测编号', '检测结论', '结果报告']
const statuses = ['已采集', '已浮选', '已分拣', '已送检', '检测中', '待复核', '已返回', '已退回']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['样本编号', '采样单位', '采样层位']
const tick = ref(0)
const modal = ref<'' | 'send' | 'lab' | 'return'>('')

const sendForm = ref<{ id: number; 样本编号: string; nextRound: number; todoId: number | null; 土样重量: string; 轻浮物类型: string }>({
  id: 0,
  样本编号: '',
  nextRound: 1,
  todoId: null,
  土样重量: '',
  轻浮物类型: '',
})
const labForm = ref<{ id: number; 样本编号: string; round: number; expectedVersion: number; 检测编号: string; 初步结果: string; 检测结论: string }>({
  id: 0,
  样本编号: '',
  round: 1,
  expectedVersion: 0,
  检测编号: '',
  初步结果: '',
  检测结论: '',
})
const returnForm = ref<{ id: number; 样本编号: string; round: number; ownerUnit: string; expectedVersion: number; 退回原因: string }>({
  id: 0,
  样本编号: '',
  round: 1,
  ownerUnit: '',
  expectedVersion: 0,
  退回原因: '',
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const testingCount = computed(() => rows.value.filter((row) => row.status === '检测中').length)
const returnedCount = computed(() => rows.value.filter((row) => row.status === '已退回').length)

function actionsFor(row: EntryRow): string[] {
  return availableActions(row, store.unit)
}

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

function closeModal() {
  modal.value = ''
  errorMessage.value = ''
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const ctx = { operator: store.operator, unit: store.unit }
  let result: ActionResult

  switch (action) {
    case '执行浮选':
      result = executeFlotation(Number(row.id), ctx)
      break
    case '完成分拣':
      result = completeSorting(Number(row.id), ctx)
      break
    case '送出检测':
      sendForm.value = {
        id: Number(row.id),
        样本编号: String(row.样本编号),
        nextRound: (Number(row.检测轮次) || 0) + 1,
        todoId: null,
        土样重量: '',
        轻浮物类型: '',
      }
      modal.value = 'send'
      return
    case '开始检测':
      result = startTesting(Number(row.id), ctx)
      break
    case '登记结果': {
      const draft = (row.检测中间态 ?? {}) as Partial<Record<string, string>>
      labForm.value = {
        id: Number(row.id),
        样本编号: String(row.样本编号),
        round: Number(row.检测轮次) || 1,
        expectedVersion: Number(row.version) || 0,
        检测编号: draft.检测编号 ?? '',
        初步结果: draft.初步结果 ?? '',
        检测结论: draft.检测结论 ?? '',
      }
      modal.value = 'lab'
      return
    }
    case '复核通过':
      result = approveReview(Number(row.id), ctx)
      break
    case '复核退回':
    case '退回样本':
      returnForm.value = {
        id: Number(row.id),
        样本编号: String(row.样本编号),
        round: Number(row.检测轮次) || 1,
        ownerUnit: String(row.送检单位 || row.采样单位),
        expectedVersion: Number(row.version) || 0,
        退回原因: action === '复核退回' ? String(row.待补样原因 || '') : '',
      }
      modal.value = 'return'
      return
    default:
      result = { ok: false, message: `未实现动作「${action}」` }
  }

  finish(result)
}

function openResend(todoId: number) {
  errorMessage.value = ''
  const todo = listResampleTodos().find((item) => Number(item.id) === todoId)
  if (!todo) {
    errorMessage.value = `待补样事项 #${todoId} 不存在`
    return
  }
  sendForm.value = {
    id: Number(todo.样本ID),
    样本编号: String(todo.样本编号),
    nextRound: Number(todo.检测轮次) + 1,
    todoId,
    土样重量: '',
    轻浮物类型: '',
  }
  modal.value = 'send'
}

function confirmSend() {
  const input: SendInput = {
    土样重量: sendForm.value.土样重量.trim(),
    轻浮物类型: sendForm.value.轻浮物类型.trim(),
  }
  const ctx = { operator: store.operator, unit: store.unit }
  const result = sendForm.value.todoId
    ? resendFromTodo(sendForm.value.todoId, ctx, input)
    : sendForTesting(sendForm.value.id, ctx, input)
  finish(result)
}

function confirmLab() {
  const result = submitLabResult(labForm.value.id, { operator: store.operator, unit: store.unit }, {
    检测编号: labForm.value.检测编号,
    初步结果: labForm.value.初步结果,
    检测结论: labForm.value.检测结论,
    expectedVersion: labForm.value.expectedVersion,
  })
  finish(result)
}

function confirmReturn() {
  const input: ReturnInput = {
    退回原因: returnForm.value.退回原因,
    expectedVersion: returnForm.value.expectedVersion,
  }
  const result = returnSample(returnForm.value.id, { operator: store.operator, unit: store.unit }, input)
  finish(result)
}

function finish(result: ActionResult) {
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  modal.value = ''
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
    errorMessage.value = error instanceof Error ? error.message : '浮选采样列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.muted {
  color: #9aa0a6;
}
.status-returned {
  color: #c0392b;
  font-weight: 600;
}
.round-note {
  margin-top: 12px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
.form-tip {
  margin: 0 0 12px;
  padding: 8px 10px;
  background: #f1f5f9;
  border-radius: 6px;
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
}
.form-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.form-item > span {
  font-size: 13px;
  color: #374151;
}
.form-item input,
.form-item textarea {
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font: inherit;
}
.row-open {
  background: #fef3c7;
}
.todo-reason {
  max-width: 240px;
}
</style>
