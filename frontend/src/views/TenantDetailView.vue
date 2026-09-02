<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import RelatedPropertyAffairs from '../components/property-affairs/RelatedPropertyAffairs.vue'
import { http } from '../services/http'
import { tenantIdTypeLabel, tenantStatusLabel, tenantTypeLabel } from '../utils/status-labels'
import type { TenantListItem } from './tenant-form'

type TenantDetail = TenantListItem & {
  createdAt?: string | null
  updatedAt?: string | null
}

type DetailState = 'loading' | 'ready' | 'empty' | 'missing' | 'error'

const route = useRoute()
const router = useRouter()
const tenant = ref<TenantDetail | null>(null)
const state = ref<DetailState>('loading')
let requestGeneration = 0

function routeId(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

function display(value: string | null | undefined) {
  return value?.trim() || '未填写'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', { hour12: false })
}

async function load(value: unknown) {
  const generation = ++requestGeneration
  tenant.value = null
  state.value = 'loading'
  const id = routeId(value)
  if (!id) {
    state.value = 'missing'
    return
  }
  try {
    const response = await http.get(`/tenants/${id}`)
    if (generation !== requestGeneration) return
    tenant.value = response.data.data
    state.value = tenant.value ? 'ready' : 'empty'
  } catch (error) {
    if (generation !== requestGeneration) return
    const status = (error as { response?: { status?: number } }).response?.status
    state.value = status === 404 ? 'missing' : 'error'
  }
}

watch(
  () => route.params.id,
  (id) => void load(id),
  { immediate: true },
)
</script>

<template>
  <main class="tenant-detail-page">
    <header class="detail-head">
      <div>
        <el-button data-test="back-to-tenants" text @click="router.push({ name: 'tenants' })">← 返回承租人列表</el-button>
        <h1>承租人详情</h1>
        <p>展示系统保存的脱敏资料及相关物业办事。</p>
      </div>
    </header>

    <el-card v-if="state === 'loading'" class="state-card" shadow="never">
      <p>正在加载承租人详情…</p>
    </el-card>
    <el-empty v-else-if="state === 'empty'" description="暂无承租人详情" />
    <el-result v-else-if="state === 'missing'" icon="warning" title="未找到该承租人" sub-title="该承租人可能不存在或已被删除" />
    <el-alert v-else-if="state === 'error'" title="承租人详情加载失败，请稍后重试" type="error" :closable="false" show-icon />

    <template v-else-if="tenant">
      <el-card class="profile-card" shadow="never">
        <template #header>
          <div class="profile-head">
            <div>
              <h2>{{ tenant.name }}</h2>
              <small>承租人编号 {{ tenant.id }}</small>
            </div>
            <el-tag effect="light">{{ tenantStatusLabel(tenant.status) }}</el-tag>
          </div>
        </template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名/单位">{{ tenant.name }}</el-descriptions-item>
          <el-descriptions-item label="承租人类型">{{ tenantTypeLabel(tenant.tenantType) }}</el-descriptions-item>
          <el-descriptions-item label="联系电话">{{ display(tenant.phone) }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ tenantStatusLabel(tenant.status) }}</el-descriptions-item>
          <el-descriptions-item label="证件类型">{{ tenantIdTypeLabel(tenant.idType) }}</el-descriptions-item>
          <el-descriptions-item label="证件号码（脱敏）">{{ display(tenant.maskedIdNo) }}</el-descriptions-item>
          <el-descriptions-item label="联系地址" :span="2">{{ display(tenant.contactAddress) }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ display(tenant.remark) }}</el-descriptions-item>
          <el-descriptions-item v-if="tenant.createdAt" label="创建时间">{{ formatDate(tenant.createdAt) }}</el-descriptions-item>
          <el-descriptions-item v-if="tenant.updatedAt" label="更新时间">{{ formatDate(tenant.updatedAt) }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <RelatedPropertyAffairs :tenant-id="tenant.id" />
    </template>
  </main>
</template>

<style scoped>
.tenant-detail-page { max-width:1200px; margin:0 auto; padding:24px; color:#253247; }
.detail-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:16px; }
.detail-head h1 { margin:8px 0 5px; font-size:26px; }
.detail-head p { margin:0; color:#748196; }
.state-card { color:#748196; text-align:center; }
.profile-card { border:1px solid #e7ecf3; border-radius:12px; }
.profile-head { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.profile-head h2 { margin:0; font-size:20px; }
.profile-head small { display:block; margin-top:5px; color:#8792a2; }
@media (max-width:760px) { .tenant-detail-page { padding:16px; } .detail-head,.profile-head { align-items:flex-start; flex-direction:column; } }
</style>
