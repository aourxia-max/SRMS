<script setup lang="ts">
import { getActivePinia } from 'pinia'
import { computed, getCurrentInstance, ref, watch } from 'vue'
import type { Router } from 'vue-router'
import { listPropertyAffairs } from '../../services/property-affairs'
import { useSessionStore } from '../../stores/session'
import type { PropertyAffairListQuery, PropertyAffairSummary } from '../../types/property-affairs'
import { propertyAffairPriorityLabel, propertyAffairStatusLabel } from '../../utils/property-affair-labels'

const props = defineProps<{
  roomId?: number
  tenantId?: number
  contractId?: number
}>()

const router = getCurrentInstance()?.appContext.config.globalProperties.$router as Router | undefined
const activePinia = getActivePinia()
const session = activePinia ? useSessionStore(activePinia) : null
const items = ref<PropertyAffairSummary[]>([])
const loading = ref(false)
const error = ref('')
let requestGeneration = 0

const canView = computed(() => ['SUPER_ADMIN', 'ADMIN'].includes(session?.user?.role ?? ''))

function targetQuery(): PropertyAffairListQuery {
  const query: PropertyAffairListQuery = {}
  if (props.roomId !== undefined) query.roomId = props.roomId
  if (props.tenantId !== undefined) query.tenantId = props.tenantId
  if (props.contractId !== undefined) query.contractId = props.contractId
  return query
}

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return '时间未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  const generation = ++requestGeneration
  if (!canView.value) {
    items.value = []
    error.value = ''
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await listPropertyAffairs({ ...targetQuery(), page: 1, pageSize: 5 })
    if (generation !== requestGeneration) return
    items.value = result.items.filter((item) => !item.deletedAt)
  } catch {
    if (generation !== requestGeneration) return
    items.value = []
    error.value = '关联物业办事加载失败，请稍后重试'
  } finally {
    if (generation === requestGeneration) loading.value = false
  }
}

function openDetail(id: number) {
  void router?.push({ name: 'property-affair-detail', params: { id } })
}

function viewAll() {
  void router?.push({ name: 'property-affairs', query: targetQuery() })
}

watch(
  [() => session?.user?.role, () => props.roomId, () => props.tenantId, () => props.contractId],
  () => void load(),
  { immediate: true },
)
</script>

<template>
  <el-card
    v-if="canView"
    data-test="related-property-affairs"
    class="related-affairs"
    shadow="never"
  >
    <template #header>
      <div class="related-head">
        <div>
          <h2>关联物业办事</h2>
          <small>与当前业务对象有关的最近事项</small>
        </div>
        <el-button
          data-test="related-affairs-view-all"
          text
          type="primary"
          @click="viewAll"
        >
          查看全部
        </el-button>
      </div>
    </template>

    <p v-if="loading" class="related-state">正在加载物业办事…</p>
    <el-alert v-else-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-empty v-else-if="!items.length" description="暂无关联的物业办事事项" :image-size="48" />
    <div v-else class="related-list">
      <button
        v-for="item in items"
        :key="item.id"
        data-test="related-affair-row"
        class="related-row"
        type="button"
        @click="openDetail(item.id)"
      >
        <span class="related-main">
          <small>{{ item.affairNo }}</small>
          <b data-test="related-affair-title">{{ item.title }}</b>
        </span>
        <span class="related-tags">
          <el-tag size="small" effect="plain">{{ propertyAffairStatusLabel(item.status) }}</el-tag>
          <el-tag size="small" type="warning" effect="plain">{{ propertyAffairPriorityLabel(item.priority) }}</el-tag>
        </span>
        <time :datetime="item.updatedAt">更新于 {{ formatUpdatedAt(item.updatedAt) }}</time>
      </button>
    </div>
  </el-card>
</template>

<style scoped>
.related-affairs { margin-top:16px; border:1px solid #e7ecf3; border-radius:12px; }
.related-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.related-head h2 { margin:0; font-size:16px; }
.related-head small { color:#8792a2; }
.related-state { margin:0; padding:20px 0; color:#748196; text-align:center; }
.related-list { display:grid; }
.related-row { display:grid; grid-template-columns:minmax(220px,1fr) auto minmax(150px,.6fr); gap:14px; align-items:center; width:100%; padding:12px 4px; border:0; border-bottom:1px solid #edf1f5; background:transparent; color:#526075; cursor:pointer; text-align:left; }
.related-row:last-child { border-bottom:0; }
.related-row:hover { background:#f8faff; }
.related-main { min-width:0; }
.related-main small,.related-main b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.related-main small { color:#8792a2; font-size:11px; }
.related-main b { margin-top:4px; color:#233044; font-size:13px; }
.related-tags { display:flex; gap:6px; }
time { color:#8792a2; font-size:12px; text-align:right; }
@media (max-width:760px) { .related-row { grid-template-columns:1fr auto; } time { text-align:left; } }
</style>
