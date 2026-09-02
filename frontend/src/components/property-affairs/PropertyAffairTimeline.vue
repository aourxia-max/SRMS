<script setup lang="ts">
import { computed } from 'vue'
import type { PropertyAffairProgress } from '../../types/property-affairs'
import { propertyAffairStatusLabel } from '../../utils/property-affair-labels'

const props = defineProps<{ progresses: PropertyAffairProgress[] }>()
const orderedProgresses = computed(() => [...props.progresses].sort((left, right) => {
  const byTime = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  return byTime || right.id - left.id
}))

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false })
}

function transition(progress: PropertyAffairProgress) {
  if (!progress.statusAfter) return ''
  if (!progress.statusBefore) return `状态设为${propertyAffairStatusLabel(progress.statusAfter)}`
  if (progress.statusBefore === progress.statusAfter) return ''
  return `${propertyAffairStatusLabel(progress.statusBefore)} → ${propertyAffairStatusLabel(progress.statusAfter)}`
}
</script>

<template>
  <el-empty v-if="orderedProgresses.length === 0" description="暂无办理进度" />
  <el-timeline v-else class="affair-timeline">
    <el-timeline-item v-for="progress in orderedProgresses" :key="progress.id" :timestamp="formatDate(progress.createdAt)" placement="top">
      <article data-test="timeline-entry" class="timeline-entry">
        <div class="timeline-meta"><strong>{{ progress.createdBySnapshot || '管理员' }}</strong><el-tag v-if="transition(progress)" size="small" type="primary">{{ transition(progress) }}</el-tag></div>
        <p>{{ progress.content }}</p>
      </article>
    </el-timeline-item>
  </el-timeline>
</template>

<style scoped>
.affair-timeline { padding-left: 4px; }
.timeline-entry { padding: 14px 16px; border: 1px solid #e5eaf1; border-radius: 10px; background: #fff; }
.timeline-meta { display: flex; align-items: center; gap: 10px; color: #334155; }
.timeline-entry p { margin: 10px 0 0; color: #475569; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
