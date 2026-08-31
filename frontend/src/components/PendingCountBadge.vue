<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ count: number }>()

const visible = computed(() => Number.isFinite(props.count) && props.count > 0)
const label = computed(() => (props.count >= 100 ? '99+' : String(props.count)))
</script>

<template>
  <span
    v-if="visible"
    data-test="pending-count-badge"
    class="pending-count-badge"
    :aria-label="`待处理 ${count} 项`"
  >{{ label }}</span>
</template>

<style scoped>
.pending-count-badge {
  display: inline-flex;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #f54a45;
  box-sizing: border-box;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 14px;
  white-space: nowrap;
}
</style>
