<template>
  <section class="todo-panel">
    <header class="todo-head">
      <h3>待补样事项（浮选采样 · 测年送检 跨业务面）</h3>
      <span class="todo-count">打开 {{ openTodos.length }} 条 · 共 {{ todos.length }} 条</span>
    </header>
    <table v-if="todos.length" class="data-table">
      <thead>
        <tr>
          <th>事项#</th>
          <th>样本编号</th>
          <th>采样层位</th>
          <th>原送检单位</th>
          <th>轮次</th>
          <th>退回原因</th>
          <th>退回时间</th>
          <th>事项状态</th>
          <th>新送检单</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="todo in todos" :key="String(todo.id)" :class="{ 'row-open': todo.事项状态 === openStatus }">
          <td>{{ todo.id }}</td>
          <td>{{ todo.样本编号 }}</td>
          <td>{{ todo.采样层位 }}</td>
          <td>{{ todo.原送检单位 }}</td>
          <td>第{{ todo.检测轮次 }}轮</td>
          <td class="todo-reason">{{ todo.退回原因 }}</td>
          <td>{{ todo.退回时间 }}</td>
          <td>{{ todo.事项状态 }}</td>
          <td>{{ todo.新送检单ID ? `#${todo.新送检单ID}` : '—' }}</td>
          <td>
            <button
              v-if="todo.事项状态 === openStatus"
              class="link"
              type="button"
              @click="emit('resend', Number(todo.id))"
            >
              重新采样送检
            </button>
            <span v-else>—</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty-state">当前没有待补样事项</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { listResampleTodos } from '@/api/flotation-domain'
import { TODO_OPEN } from '@/data/lab'
import type { ResampleTodo } from '@/data/types'

const props = defineProps<{
  /** 递增即可触发刷新：页面动作完成后 bump 一下。 */
  refreshTick: number
  onlyOpen?: boolean
}>()

const emit = defineEmits<{
  (e: 'resend', todoId: number): void
}>()

const openStatus = TODO_OPEN

const todos = computed<ResampleTodo[]>(() => {
  // 依赖 refreshTick，动作后重新从存储读取。
  void props.refreshTick
  return listResampleTodos(props.onlyOpen ?? false)
})

const openTodos = computed(() => todos.value.filter((todo) => todo.事项状态 === TODO_OPEN))
</script>
