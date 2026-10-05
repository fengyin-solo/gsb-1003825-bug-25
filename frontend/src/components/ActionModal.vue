<template>
  <div v-if="open" class="modal-mask" @click.self="emitCancel">
    <div class="modal-card" role="dialog" :aria-label="title">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button class="link" type="button" @click="emitCancel">关闭</button>
      </header>
      <div class="modal-body">
        <slot />
      </div>
      <footer class="modal-foot">
        <button class="btn ghost" type="button" @click="emitCancel">取消</button>
        <button class="btn primary" type="button" :disabled="busy" @click="emitConfirm">
          {{ busy ? '提交中…' : confirmText }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
  confirmText?: string
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'confirm'): void
}>()

function emitCancel() {
  emit('cancel')
}
function emitConfirm() {
  emit('confirm')
}
</script>
