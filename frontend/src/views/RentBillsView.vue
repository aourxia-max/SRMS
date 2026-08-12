<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { fetchRentBill, fetchRentBills, http, type RentBillDetail, type RentBillListItem, type RentBillQuery } from '../services/http'
import { currentRentBillMonth, rentBillStatusInfo, rentBillStatusMap } from '../services/rentBillDisplay'
import { approvalStatusLabel, billAdjustmentTypeLabel } from '../utils/status-labels'

const router = useRouter()
const loading = ref(false)
const detailLoading = ref(false)
const buildings = ref<any[]>([])
const items = ref<RentBillListItem[]>([])
const detail = ref<RentBillDetail | null>(null)
const drawer = ref(false)
const total = ref(0)
const summary = ref({ payable: '0.00', received: '0.00', outstanding: '0.00', count: 0, overdueCount: 0 })
const filters = reactive<RentBillQuery>({ keyword: '', buildingId: undefined, status: undefined, month: currentRentBillMonth(), page: 1, pageSize: 20 })

const monthLabel = computed(() => filters.month ? `${filters.month.slice(0, 4)}年${Number(filters.month.slice(5, 7))}月` : '全部月份')
const statusMap = rentBillStatusMap
const statusInfo = rentBillStatusInfo
const money = (value: unknown) => `¥ ${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (value: string | Date | null | undefined) => value ? new Date(value).toLocaleDateString('zh-CN') : '-'
const period = (row: RentBillListItem) => `${date(row.periodStart)} 至 ${date(row.periodEnd)}`

async function loadBuildings() {
  buildings.value = (await http.get('/properties/buildings')).data.data
}
async function loadBills() {
  loading.value = true
  try {
    const data = await fetchRentBills({ ...filters, keyword: filters.keyword?.trim() || undefined })
    items.value = data.items; total.value = data.total; summary.value = data.summary
  } catch (error) {
    ElMessage.error('租金账单加载失败，请稍后重试')
  } finally { loading.value = false }
}
async function search() { filters.page = 1; await loadBills() }
async function openDetail(row: RentBillListItem) {
  drawer.value = true; detailLoading.value = true; detail.value = null
  try { detail.value = await fetchRentBill(row.id) } catch { ElMessage.error('账单详情加载失败') } finally { detailLoading.value = false }
}
function goCollect() { if (detail.value) router.push({ path: '/payments', query: { rentBillId: detail.value.id } }) }
function goContract() { if (detail.value) router.push(`/contracts?contractId=${detail.value.contract.id}`) }
function resetFilters() { filters.keyword = ''; filters.buildingId = undefined; filters.status = undefined; filters.month = currentRentBillMonth(); search() }

onMounted(async () => { await Promise.all([loadBuildings(), loadBills()]) })
</script>

<template>
  <main class="rent-bills-page">
    <header class="page-head"><div><el-tag type="primary" effect="light">租赁财务</el-tag><h1>租金账单</h1><p>集中查看租赁账期、应收与实收，快速定位待收和逾期账单。</p></div><div class="head-actions"><el-button @click="resetFilters">重置筛选</el-button><el-button type="primary" @click="router.push('/contracts')">进入合同管理</el-button></div></header>

    <section class="metrics-grid">
      <el-card shadow="never"><span>本月应收</span><strong>{{ money(summary.payable) }}</strong><small>{{ monthLabel }}</small></el-card>
      <el-card shadow="never"><span>本月已收</span><strong>{{ money(summary.received) }}</strong><small>收缴率 {{ summary.payable === '0.00' ? '0.0' : (Number(summary.received) / Number(summary.payable) * 100).toFixed(1) }}%</small></el-card>
      <el-card shadow="never"><span>待收账单</span><strong>{{ summary.count }} <em>笔</em></strong><small class="danger-text">含逾期 {{ summary.overdueCount }} 笔</small></el-card>
      <el-card shadow="never"><span>本月新增 / 退租</span><strong>— <em>/ —</em></strong><small>以驾驶舱实际操作统计</small></el-card>
    </section>

    <el-card class="filter-card" shadow="never"><el-form :inline="true" @submit.prevent="search"><el-form-item><el-input v-model="filters.keyword" clearable placeholder="搜索房号、合同编号、承租人" @keyup.enter="search" /></el-form-item><el-form-item><el-select v-model="filters.buildingId" clearable placeholder="全部楼栋"><el-option v-for="building in buildings" :key="building.id" :label="building.buildingNo" :value="building.id" /></el-select></el-form-item><el-form-item><el-select v-model="filters.status" clearable placeholder="全部账单状态"><el-option v-for="(value, key) in statusMap" :key="key" :label="value.label" :value="key" /></el-select></el-form-item><el-form-item><el-date-picker v-model="filters.month" type="month" value-format="YYYY-MM" placeholder="选择账期月份" /></el-form-item><el-form-item><el-button type="primary" :loading="loading" @click="search">查询</el-button></el-form-item></el-form></el-card>

    <el-card shadow="never" class="table-card"><el-table v-loading="loading" :data="items" stripe empty-text="暂无符合条件的租金账单"><el-table-column prop="billNo" label="账单编号" min-width="145" fixed="left" /><el-table-column label="房源" min-width="110"><template #default="{ row }"><b>{{ row.room.fullHouseNo }}</b><small>{{ row.room.buildingName }}</small></template></el-table-column><el-table-column label="承租人 / 合同" min-width="150"><template #default="{ row }"><span>{{ row.tenant?.name || '未填写' }}</span><small>{{ row.contract.contractNo }}</small></template></el-table-column><el-table-column label="账期" min-width="180"><template #default="{ row }">{{ period(row) }}</template></el-table-column><el-table-column label="应收" min-width="110"><template #default="{ row }">{{ money(row.payableAmount) }}</template></el-table-column><el-table-column label="已收" min-width="110"><template #default="{ row }">{{ money(row.receivedAmount) }}</template></el-table-column><el-table-column label="未收" min-width="110"><template #default="{ row }">{{ money(row.outstandingAmount) }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusInfo(String(row.status)).type" effect="light">{{ statusInfo(String(row.status)).label }}</el-tag></template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">查看详情</el-button></template></el-table-column></el-table><div class="table-footer"><span>共 {{ total }} 条账单</span><el-pagination v-model:current-page="filters.page" v-model:page-size="filters.pageSize" background layout="sizes, prev, pager, next" :page-sizes="[10, 20, 50, 100]" :total="total" @current-change="loadBills" @size-change="search" /></div></el-card>

    <el-drawer v-model="drawer" title="账单详情" size="520px"><el-skeleton v-if="detailLoading" :rows="8" animated /><template v-else-if="detail"><div class="detail-grid"><div><span>账单编号</span><b>{{ detail.billNo }}</b></div><div><span>账单状态</span><el-tag :type="statusMap[detail.status].type">{{ statusMap[detail.status].label }}</el-tag></div><div><span>房源</span><b>{{ detail.room.fullHouseNo }}</b></div><div><span>承租人</span><b>{{ detail.tenant?.name || '未填写' }}</b></div><div><span>账期</span><b>{{ period(detail) }}</b></div><div><span>应缴日期</span><b>{{ date(detail.dueDate) }}</b></div></div><el-divider content-position="left">金额核对</el-divider><div class="amount-list"><div><span>原始租金</span><b>{{ money(detail.baseRentAmount) }}</b></div><div><span>已确认优惠 / 减免</span><b class="discount">- {{ money(Number(detail.rentFreeAmount) + Number(detail.discountAmount)) }}</b></div><div><span>最终应收</span><b>{{ money(detail.payableAmount) }}</b></div><div><span>已收 / 未收</span><b>{{ money(detail.receivedAmount) }} / {{ money(detail.outstandingAmount) }}</b></div></div><el-divider content-position="left">关联操作</el-divider><div class="drawer-actions"><el-button type="primary" @click="goCollect">登记收款</el-button><el-button @click="goContract">查看合同</el-button></div><el-divider content-position="left">账单调整记录</el-divider><el-empty v-if="!detail.adjustments.length" description="暂无账单调整" :image-size="56" /><el-timeline v-else><el-timeline-item v-for="item in detail.adjustments" :key="String(item.id)" :timestamp="date(item.submittedAt as string)"><b>{{ billAdjustmentTypeLabel(String(item.adjustmentType)) }}</b><span> {{ approvalStatusLabel(String(item.approvalStatus)) }}</span><p>{{ item.reason }}</p></el-timeline-item></el-timeline><el-divider content-position="left">收款分配</el-divider><el-empty v-if="!detail.allocations.length" description="暂无收款分配" :image-size="56" /><el-table v-else :data="detail.allocations" size="small"><el-table-column prop="payment.receiptNo" label="收据" /><el-table-column prop="allocatedAmount" label="分配金额" /><el-table-column prop="reversedAmount" label="已回退" /></el-table></template></el-drawer>
  </main>
</template>

<style scoped>
.rent-bills-page{max-width:1500px;margin:0 auto;padding:0 0 28px}.page-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:16px}.page-head h1{margin:8px 0 4px;font-size:24px}.page-head p{margin:0;color:#7c8799}.head-actions{display:flex;gap:8px}.metrics-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}.metrics-grid .el-card{border-color:#e7ecf3}.metrics-grid span,.metrics-grid small{display:block;color:#7c8799;font-size:12px}.metrics-grid strong{display:block;margin:8px 0;font-size:23px;color:#24324a}.metrics-grid em{font-size:12px;color:#8190a4;font-style:normal}.danger-text{color:#c24d4d!important}.filter-card{margin-bottom:14px}.filter-card :deep(.el-form-item){margin-bottom:0}.table-card :deep(.el-table){font-size:13px}.table-card small{display:block;color:#8793a6;font-size:11px;margin-top:3px}.table-footer{display:flex;justify-content:space-between;align-items:center;padding-top:14px;color:#8390a2;font-size:12px}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.detail-grid>div{padding:10px;background:#f8fafc;border-radius:8px}.detail-grid span,.amount-list span{display:block;color:#8290a3;font-size:11px}.detail-grid b{display:block;margin-top:5px;font-size:13px}.amount-list{display:grid;gap:10px}.amount-list>div{display:flex;justify-content:space-between;border-bottom:1px dashed #e4e8ee;padding-bottom:9px}.amount-list b{font-size:13px}.amount-list .discount{color:#bc6c14}.drawer-actions{display:flex;gap:10px}.drawer-actions .el-button{flex:1}@media(max-width:900px){.metrics-grid{grid-template-columns:repeat(2,1fr)}.page-head{align-items:flex-start;gap:12px;flex-direction:column}.filter-card :deep(.el-form){display:grid;grid-template-columns:1fr 1fr}.filter-card :deep(.el-form-item){margin-right:0}.table-footer{align-items:flex-start;gap:10px;flex-direction:column}}
</style>
