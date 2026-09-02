<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../../stores/session'
import type { PropertyAffairSummary } from '../../types/property-affairs'
import { propertyAffairPriorityLabel, propertyAffairStatusLabel } from '../../utils/property-affair-labels'

const props = defineProps<{ items: PropertyAffairSummary[] }>()

const router = useRouter()
const session = useSessionStore()
const canView = computed(() => ['SUPER_ADMIN', 'ADMIN'].includes(session.user?.role ?? ''))
const visibleItems = computed(() => (props.items ?? []).slice(0, 8))

function relationSummary(row: PropertyAffairSummary) {
  const labels = [
    ...(row.buildings ?? []),
    ...(row.rooms ?? []),
    ...(row.tenants ?? []),
    ...(row.contracts ?? []),
  ].map((item) => item.currentLabel || item.snapshotLabel).filter(Boolean)
  return labels.length ? labels.join('、') : '未关联业务对象'
}

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return '时间未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', { hour12: false })
}

function openDetail(id: number) {
  void router.push({ name: 'property-affair-detail', params: { id } })
}
</script>

<template>
  <el-card v-if="canView" data-test="dashboard-property-affairs" class="dashboard-affairs panel-card" shadow="never">
    <template #header>
      <div class="affairs-head">
        <div>
          <h2>物业办事</h2>
          <small>按优先级关注待办理与办理中事项</small>
        </div>
        <el-button text type="primary" @click="router.push({ name: 'property-affairs' })">查看全部</el-button>
      </div>
    </template>

    <el-empty v-if="!visibleItems.length" description="暂无待办理的物业办事事项" :image-size="48" />
    <div v-else class="affair-list">
      <button
        v-for="item in visibleItems"
        :key="item.id"
        data-test="dashboard-affair-row"
        class="affair-row"
        type="button"
        @click="openDetail(item.id)"
      >
        <span class="affair-main">
          <b data-test="dashboard-affair-title">{{ item.title }}</b>
          <small>{{ relationSummary(item) }}</small>
        </span>
        <span class="affair-owner">负责人：{{ item.responsibleSnapshot || '未指定' }}</span>
        <span class="affair-tags">
          <el-tag size="small" effect="plain">{{ propertyAffairStatusLabel(item.status) }}</el-tag>
          <el-tag size="small" effect="plain" type="warning">{{ propertyAffairPriorityLabel(item.priority) }}</el-tag>
        </span>
        <time :datetime="item.updatedAt">更新于 {{ formatUpdatedAt(item.updatedAt) }}</time>
      </button>
    </div>
  </el-card>
</template>

<style scoped>
.dashboard-affairs { border:1px solid #e7ecf3; border-radius:12px; box-shadow:0 10px 28px rgba(28,52,84,.07); }
.affairs-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.affairs-head h2 { margin:0; font-size:16px; }
.affairs-head small { color:#8792a2; }
.affair-list { display:grid; }
.affair-row { display:grid; grid-template-columns:minmax(220px,1.5fr) minmax(120px,.7fr) auto minmax(150px,.7fr); gap:14px; align-items:center; width:100%; padding:12px 4px; border:0; border-bottom:1px solid #edf1f5; background:transparent; color:#526075; cursor:pointer; text-align:left; }
.affair-row:last-child { border-bottom:0; }
.affair-row:hover { background:#f8faff; }
.affair-main { min-width:0; }
.affair-main b,.affair-main small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.affair-main b { color:#233044; font-size:13px; }
.affair-main small { margin-top:4px; color:#7b8798; font-size:11px; }
.affair-owner,time { font-size:12px; }
.affair-tags { display:flex; gap:6px; }
time { color:#8792a2; text-align:right; }
@media (max-width:900px) { .affair-row { grid-template-columns:1fr auto; } .affair-owner,time { text-align:left; } }
</style>
