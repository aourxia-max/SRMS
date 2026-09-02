<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listContracts } from '../services/contracts'
import { http } from '../services/http'
import {
  extractPropertyAffairErrorMessage,
  listPropertyAffairCategories,
  listPropertyAffairResponsibleUsers,
  listPropertyAffairs,
  listPropertyAffairsRecycleBin,
  permanentlyDeletePropertyAffair,
  restorePropertyAffair,
  softDeletePropertyAffair,
} from '../services/property-affairs'
import { useSessionStore } from '../stores/session'
import type {
  PropertyAffairListQuery,
  PropertyAffairPriority,
  PropertyAffairResponsibleUserOption,
  PropertyAffairStatus,
  PropertyAffairSummary,
} from '../types/property-affairs'
import { propertyAffairPriorityLabel, propertyAffairStatusLabel } from '../utils/property-affair-labels'

type BuildingOption = { id: number; buildingNo: string; buildingName?: string | null }
type RoomOption = { id: number; fullHouseNo: string }
type TenantOption = { id: number; name: string; phone?: string | null }
type ContractOption = { id: number; contractNo: string; room?: { fullHouseNo?: string }; members?: Array<{ memberRole: string; tenant: { name: string } }> }

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const recycleMode = computed(() => route.name === 'property-affairs-recycle-bin' || route.path.endsWith('/recycle-bin'))
const isSuperAdmin = computed(() => session.user?.role === 'SUPER_ADMIN')
const loading = ref(false)
const loadError = ref('')
const items = ref<PropertyAffairSummary[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const mutatingIds = ref(new Set<number>())
const filters = reactive({
  keyword: '',
  category: '',
  priority: '' as PropertyAffairPriority | '',
  status: '' as PropertyAffairStatus | '',
  responsibleUserId: null as number | null,
  buildingId: null as number | null,
  roomId: null as number | null,
  tenantId: null as number | null,
  contractId: null as number | null,
})
const counts = reactive<Record<'ALL' | PropertyAffairStatus, number>>({ ALL: 0, PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 })
const categories = ref<string[]>([])
const responsibleUsers = ref<PropertyAffairResponsibleUserOption[]>([])
const buildings = ref<BuildingOption[]>([])
const rooms = ref<RoomOption[]>([])
const tenants = ref<TenantOption[]>([])
const contracts = ref<ContractOption[]>([])

const statusOptions: PropertyAffairStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
const priorityOptions: PropertyAffairPriority[] = ['NORMAL', 'IMPORTANT', 'URGENT']

function queryParams(): PropertyAffairListQuery {
  return {
    ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.responsibleUserId ? { responsibleUserId: filters.responsibleUserId } : {}),
    ...(filters.buildingId ? { buildingId: filters.buildingId } : {}),
    ...(filters.roomId ? { roomId: filters.roomId } : {}),
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...(filters.contractId ? { contractId: filters.contractId } : {}),
    page: page.value,
    pageSize: pageSize.value,
  }
}

async function loadCounts() {
  const statuses: Array<'ALL' | PropertyAffairStatus> = ['ALL', ...statusOptions]
  const responses = await Promise.all(statuses.map((status) => listPropertyAffairs({ ...(status === 'ALL' ? {} : { status }), page: 1, pageSize: 1 })))
  responses.forEach((response, index) => { counts[statuses[index]] = response.total })
}

async function loadList() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await (recycleMode.value ? listPropertyAffairsRecycleBin(queryParams()) : listPropertyAffairs(queryParams()))
    items.value = response.items
    total.value = response.total
    if (!recycleMode.value) await loadCounts()
  } catch (error) {
    items.value = []
    total.value = 0
    loadError.value = extractPropertyAffairErrorMessage(error, recycleMode.value ? '回收站加载失败，请稍后重试' : '物业办事加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  try {
    const [categoryData, userData, buildingData, roomData, tenantData, contractData] = await Promise.all([
      listPropertyAffairCategories(),
      listPropertyAffairResponsibleUsers(),
      http.get('/properties/buildings'),
      http.get('/properties/rooms'),
      http.get('/tenants', { params: { page: 1, pageSize: 100 } }),
      listContracts(),
    ])
    categories.value = categoryData
    responsibleUsers.value = userData
    buildings.value = buildingData.data.data
    rooms.value = roomData.data.data
    tenants.value = tenantData.data.data.items
    contracts.value = contractData as ContractOption[]
  } catch {
    ElMessage.warning('部分筛选选项加载失败，您仍可使用其他条件查询')
  }
}

async function search() {
  page.value = 1
  await loadList()
}

async function resetFilters() {
  Object.assign(filters, { keyword: '', category: '', priority: '', status: '', responsibleUserId: null, buildingId: null, roomId: null, tenantId: null, contractId: null })
  await search()
}

async function changePage(value: number) {
  page.value = value
  await loadList()
}

async function changePageSize(value: number) {
  pageSize.value = value
  page.value = 1
  await loadList()
}

async function reloadAfterRemoval() {
  if (items.value.length === 1 && page.value > 1) page.value -= 1
  await loadList()
}

function isCancelled(error: unknown) {
  return error === 'cancel' || error === 'close'
}

async function remove(row: PropertyAffairSummary) {
  if (mutatingIds.value.has(row.id)) return
  mutatingIds.value.add(row.id)
  try {
    await ElMessageBox.confirm(`确认将“${row.title}”移入回收站吗？`, '删除确认', { confirmButtonText: '移入回收站', cancelButtonText: '取消', type: 'warning' })
    await softDeletePropertyAffair(row.id, row.version)
    await reloadAfterRemoval()
    ElMessage.success('办事事项已移入回收站')
  } catch (error) {
    if (!isCancelled(error)) ElMessage.error(extractPropertyAffairErrorMessage(error, '删除失败，请稍后重试'))
  } finally {
    mutatingIds.value.delete(row.id)
  }
}

async function restore(row: PropertyAffairSummary) {
  if (mutatingIds.value.has(row.id)) return
  mutatingIds.value.add(row.id)
  try {
    await restorePropertyAffair(row.id, row.version)
    await reloadAfterRemoval()
    ElMessage.success('办事事项已恢复')
  } catch (error) {
    ElMessage.error(extractPropertyAffairErrorMessage(error, '恢复失败，请稍后重试'))
  } finally {
    mutatingIds.value.delete(row.id)
  }
}

async function permanentDelete(row: PropertyAffairSummary) {
  if (!isSuperAdmin.value || mutatingIds.value.has(row.id)) return
  mutatingIds.value.add(row.id)
  try {
    await ElMessageBox.confirm(`即将永久删除“${row.title}”。永久删除后不可恢复，请谨慎操作。`, '永久删除确认', { confirmButtonText: '确认永久删除', cancelButtonText: '取消', type: 'error' })
    await permanentlyDeletePropertyAffair(row.id, row.version)
    await reloadAfterRemoval()
    ElMessage.success('办事事项已永久删除')
  } catch (error) {
    if (!isCancelled(error)) ElMessage.error(extractPropertyAffairErrorMessage(error, '永久删除失败，请稍后重试'))
  } finally {
    mutatingIds.value.delete(row.id)
  }
}

function relationSummary(row: PropertyAffairSummary) {
  const labels = [...row.buildings, ...row.rooms, ...row.tenants, ...row.contracts].map((item) => item.currentLabel || item.snapshotLabel)
  return labels.length ? labels.join('、') : '未关联业务对象'
}

function responsibleName(id: number | null) {
  if (!id) return '未记录'
  return responsibleUsers.value.find((user) => user.id === id)?.displayName ?? '未知管理员'
}

function formatDate(value: string | null) {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false })
}

function contractLabel(contract: ContractOption) {
  const tenant = contract.members?.find((member) => member.memberRole === 'PRIMARY')?.tenant.name
  return [contract.contractNo, contract.room?.fullHouseNo, tenant].filter(Boolean).join('｜')
}

onMounted(() => {
  void Promise.all([loadList(), loadOptions()])
})

watch(recycleMode, async () => {
  page.value = 1
  await loadList()
})
</script>

<template>
  <main class="property-affairs-page">
    <header class="page-header">
      <div>
        <el-tag type="primary">物业办事</el-tag>
        <h1>{{ recycleMode ? '物业办事回收站' : '物业办事' }}</h1>
        <p>{{ recycleMode ? '恢复误删事项，超级管理员可执行永久删除。' : '集中记录、关联和持续跟进物业日常事项。' }}</p>
      </div>
      <div class="header-actions">
        <el-button v-if="recycleMode" @click="router.push({ name: 'property-affairs' })">返回事项列表</el-button>
        <template v-else>
          <el-button @click="router.push({ name: 'property-affairs-recycle-bin' })">回收站</el-button>
          <el-button type="primary" @click="router.push({ name: 'property-affair-create' })">新建办事事项</el-button>
        </template>
      </div>
    </header>

    <section v-if="!recycleMode" class="summary-grid" aria-label="事项状态统计">
      <el-card><span>全部事项</span><strong>{{ counts.ALL }}</strong></el-card>
      <el-card><span>待办理</span><strong>{{ counts.PENDING }}</strong></el-card>
      <el-card><span>办理中</span><strong>{{ counts.IN_PROGRESS }}</strong></el-card>
      <el-card><span>已完成</span><strong>{{ counts.COMPLETED }}</strong></el-card>
      <el-card><span>已取消</span><strong>{{ counts.CANCELLED }}</strong></el-card>
    </section>

    <el-card class="list-card" v-loading="loading">
      <div class="filters">
        <el-input data-test="affair-keyword" v-model="filters.keyword" clearable placeholder="搜索编号、标题、内容或外部办理人" @keyup.enter="search" @clear="search" />
        <el-select v-model="filters.category" clearable filterable placeholder="全部分类" @change="search"><el-option v-for="item in categories" :key="item" :label="item" :value="item" /></el-select>
        <el-select data-test="affair-priority" v-model="filters.priority" clearable placeholder="全部优先级" @change="search"><el-option v-for="item in priorityOptions" :key="item" :label="propertyAffairPriorityLabel(item)" :value="item" /></el-select>
        <el-select v-model="filters.status" clearable placeholder="全部状态" @change="search"><el-option v-for="item in statusOptions" :key="item" :label="propertyAffairStatusLabel(item)" :value="item" /></el-select>
        <el-select v-model="filters.responsibleUserId" clearable filterable placeholder="全部负责人" @change="search"><el-option v-for="item in responsibleUsers" :key="item.id" :label="item.displayName" :value="item.id" /></el-select>
        <el-select v-model="filters.buildingId" clearable filterable placeholder="全部楼栋" @change="search"><el-option v-for="item in buildings" :key="item.id" :label="item.buildingNo" :value="item.id" /></el-select>
        <el-select v-model="filters.roomId" clearable filterable placeholder="全部房源" @change="search"><el-option v-for="item in rooms" :key="item.id" :label="item.fullHouseNo" :value="item.id" /></el-select>
        <el-select v-model="filters.tenantId" clearable filterable placeholder="全部承租人" @change="search"><el-option v-for="item in tenants" :key="item.id" :label="`${item.name}${item.phone ? `｜${item.phone}` : ''}`" :value="item.id" /></el-select>
        <el-select v-model="filters.contractId" clearable filterable placeholder="全部合同" @change="search"><el-option v-for="item in contracts" :key="item.id" :label="contractLabel(item)" :value="item.id" /></el-select>
        <div class="filter-actions"><el-button data-test="search-affairs" type="primary" @click="search">查询</el-button><el-button @click="resetFilters">重置</el-button></div>
      </div>

      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
      <el-empty v-else-if="!loading && items.length === 0" :description="recycleMode ? '回收站暂无办事事项' : '暂无物业办事事项'" />
      <el-table v-else :data="items" stripe>
        <el-table-column prop="affairNo" label="事项编号" min-width="154" />
        <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
        <el-table-column label="分类" min-width="110"><template #default="{ row }">{{ row.category || '未分类' }}</template></el-table-column>
        <el-table-column v-if="!recycleMode" label="关联对象" min-width="210" show-overflow-tooltip><template #default="{ row }">{{ relationSummary(row) }}</template></el-table-column>
        <el-table-column v-if="!recycleMode" label="负责人" min-width="110"><template #default="{ row }">{{ row.responsibleSnapshot || '未指定' }}</template></el-table-column>
        <el-table-column label="优先级" width="90"><template #default="{ row }"><el-tag :type="row.priority === 'URGENT' ? 'danger' : row.priority === 'IMPORTANT' ? 'warning' : 'info'">{{ propertyAffairPriorityLabel(row.priority) }}</el-tag></template></el-table-column>
        <el-table-column :label="recycleMode ? '删除前状态' : '状态'" width="100"><template #default="{ row }"><el-tag>{{ propertyAffairStatusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column v-if="recycleMode" label="删除人" min-width="110"><template #default="{ row }">{{ responsibleName(row.deletedBy) }}</template></el-table-column>
        <el-table-column :label="recycleMode ? '删除时间' : '最近更新'" min-width="170"><template #default="{ row }">{{ formatDate(recycleMode ? row.deletedAt : row.updatedAt) }}</template></el-table-column>
        <el-table-column label="操作" :width="recycleMode ? 190 : 230" fixed="right">
          <template #default="{ row }">
            <template v-if="recycleMode">
              <el-button :data-test="`restore-affair-${row.id}`" :loading="mutatingIds.has(row.id)" size="small" type="primary" plain @click="restore(row)">恢复</el-button>
              <el-button v-if="isSuperAdmin" :data-test="`permanent-delete-affair-${row.id}`" :loading="mutatingIds.has(row.id)" size="small" type="danger" plain @click="permanentDelete(row)">永久删除</el-button>
            </template>
            <template v-else>
              <el-button size="small" type="primary" link @click="router.push({ name: 'property-affair-detail', params: { id: row.id } })">详情</el-button>
              <el-button size="small" link @click="router.push({ name: 'property-affair-edit', params: { id: row.id } })">编辑</el-button>
              <el-button :data-test="`delete-affair-${row.id}`" :loading="mutatingIds.has(row.id)" size="small" type="danger" link @click="remove(row)">删除</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination v-if="total > 0" class="pagination" :current-page="page" :page-size="pageSize" :page-sizes="[10, 20, 50, 100]" :total="total" layout="total, sizes, prev, pager, next, jumper" @current-change="changePage" @size-change="changePageSize" />
    </el-card>
  </main>
</template>

<style scoped>
.property-affairs-page { display: grid; gap: 18px; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.page-header h1 { margin: 10px 0 6px; color: #1e293b; font-size: 28px; }
.page-header p { margin: 0; color: #64748b; }
.header-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
.summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.summary-grid :deep(.el-card__body) { display: flex; align-items: center; justify-content: space-between; padding: 18px; }
.summary-grid span { color: #64748b; font-size: 13px; }
.summary-grid strong { color: #1d4ed8; font-size: 24px; }
.filters { display: grid; grid-template-columns: repeat(4, minmax(170px, 1fr)); gap: 12px; margin-bottom: 18px; }
.filter-actions { display: flex; gap: 8px; }
.pagination { justify-content: flex-end; margin-top: 18px; }
@media (max-width: 1180px) { .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .filters { grid-template-columns: repeat(3, minmax(160px, 1fr)); } }
@media (max-width: 760px) { .page-header { flex-direction: column; } .header-actions { width: 100%; justify-content: flex-start; } .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .filters { grid-template-columns: 1fr; } .filter-actions, .filter-actions .el-button { width: 100%; } .pagination { justify-content: flex-start; overflow-x: auto; } }
</style>
