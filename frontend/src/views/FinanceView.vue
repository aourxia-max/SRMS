<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { http } from '../services/http'

type ReportType = 'overview' | 'rent-collection' | 'cash-flows' | 'commissions'
type ExportFormat = 'XLSX' | 'PDF'

const collection = ref<any>({ rows: [], total: {} })
const overview = ref({ depositBalanceTotal: '0.00' })
const cash = ref<any>({ flows: [] })
const commissions = ref<any[]>([])
const contracts = ref<any[]>([])
const exportTasks = ref<any[]>([])
const activeSection = ref<'rent' | 'cash' | 'commissions' | 'exports'>('rent')
const filters = reactive({ from: '', to: '' })
const commissionForm = reactive({ contractId: undefined as number | undefined, recipientName: '', amount: '' })

const reportLabels: Record<string, string> = {
  overview: '财务总览',
  'rent-collection': '租金收缴',
  'cash-flows': '资金流水',
  commissions: '提成台账',
}
const statusLabels: Record<string, { label: string; type: 'success' | 'warning' | 'danger' | 'info' | 'primary' }> = {
  PENDING: { label: '排队中', type: 'warning' },
  RUNNING: { label: '处理中', type: 'primary' },
  SUCCESS: { label: '成功', type: 'success' },
  FAILED: { label: '失败', type: 'danger' },
}
const billStatusLabels: Record<string, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  PENDING: { label: '待支付', type: 'info' },
  PARTIAL: { label: '部分支付', type: 'warning' },
  PAID: { label: '已支付', type: 'success' },
  OVERDUE: { label: '已逾期', type: 'danger' },
  VOIDED: { label: '已作废', type: 'info' },
  REFUNDED: { label: '已退款', type: 'info' },
}
const cashSummary = computed(() => [
  { label: '外部流入', value: cash.value.inflow, tone: 'green' },
  { label: '外部流出', value: cash.value.outflow, tone: 'red' },
  { label: '净资金流', value: cash.value.netCashFlow, tone: 'blue' },
])
const kpis = computed(() => [
  { label: '租金及押金入账合计', value: cash.value.rentAndDepositReceivedTotal, hint: '已扣除退款和回冲', tone: 'green' },
  { label: '有效实收', value: collection.value.total?.validReceived, hint: '已分配租金', tone: 'green' },
  { label: '押金余额总额', value: overview.value.depositBalanceTotal, hint: '当前实际保管押金', tone: 'green' },
  { label: '原应收', value: collection.value.total?.originalReceivable, hint: '账期口径', tone: 'blue' },
  { label: '优惠减免', value: collection.value.total?.concessionAmount, hint: '免租和折扣', tone: 'orange' },
  { label: '退租扣款', value: cash.value.operatingIncome, hint: '已确认的验房等扣款', tone: 'green' },
])

function formatMoney(value: unknown) {
  const amount = Number(value || 0)
  return `￥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function formatDate(value: string | Date | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('zh-CN')
}
function exportStatus(task: any) {
  return statusLabels[task.status] ?? { label: task.status, type: 'info' as const }
}
function billStatus(status: string) {
  return billStatusLabels[status] ?? { label: '未知状态', type: 'info' as const }
}
function flowDirection(row: any) {
  if (row.direction === 'IN') return { label: '流入', type: 'success' as const }
  return { label: '流出', type: 'danger' as const }
}
async function loadExportTasks() {
  const response = await http.get('/finance/export-tasks')
  exportTasks.value = response.data.data
}
async function load() {
  const params = { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) }
  const [overviewResponse, a, b, c, d] = await Promise.all([
    http.get('/finance/overview'),
    http.get('/finance/rent-collection', { params }),
    http.get('/finance/cash-flows', { params }),
    http.get('/commissions'),
    http.get('/contracts'),
  ])
  overview.value = overviewResponse.data.data
  collection.value = a.data.data
  cash.value = b.data.data
  commissions.value = c.data.data
  contracts.value = d.data.data
  await loadExportTasks()
}
function refreshAfterExternalChange() {
  void load()
}
async function createCommission() {
  if (!commissionForm.contractId || !commissionForm.recipientName || commissionForm.amount === '') {
    ElMessage.warning('请完整填写提成信息')
    return
  }
  await http.post('/commissions', commissionForm)
  commissionForm.recipientName = ''
  commissionForm.amount = ''
  ElMessage.success('提成登记已保存')
  await load()
}
async function removeCommission(id: number) {
  await ElMessageBox.confirm('确认删除该提成登记吗？', '删除确认', { type: 'warning' })
  await http.delete(`/commissions/${id}`)
  ElMessage.success('提成登记已删除')
  await load()
}
async function createExportTask(reportType: ReportType, format: ExportFormat) {
  await http.post('/finance/export-tasks', {
    reportType,
    format,
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  })
  ElMessage.success('导出任务已创建，请在任务列表下载')
  activeSection.value = 'exports'
  await loadExportTasks()
}
async function downloadTask(id: number, name: string) {
  const response = await http.get(`/finance/export-tasks/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

let exportTaskTimer: number | undefined
onMounted(async () => {
  window.addEventListener('focus', refreshAfterExternalChange)
  await load()
  exportTaskTimer = window.setInterval(() => {
    if (exportTasks.value.some((task: any) => task.status === 'PENDING' || task.status === 'RUNNING')) void loadExportTasks()
  }, 3000)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshAfterExternalChange)
  if (exportTaskTimer) window.clearInterval(exportTaskTimer)
})
</script>

<template>
  <main class="finance-page">
    <header class="page-head">
      <div>
        <el-tag type="primary" effect="light">财务中心</el-tag>
        <h1>财务总览</h1>
        <p>账期经营口径与资金收付口径分开展示，押金和未分配预收款不计入租金收入。</p>
      </div>
      <div class="filters">
        <el-date-picker v-model="filters.from" value-format="YYYY-MM-DD" format="YYYY年MM月DD日" type="date" placeholder="开始日期" />
        <el-date-picker v-model="filters.to" value-format="YYYY-MM-DD" format="YYYY年MM月DD日" type="date" placeholder="结束日期" />
        <el-button type="primary" @click="load">查询</el-button>
      </div>
    </header>

    <section class="metrics">
      <article v-for="item in kpis" :key="item.label" class="metric" :class="item.tone">
        <span>{{ item.label }}</span>
        <b>{{ formatMoney(item.value) }}</b>
        <small>{{ item.hint }}</small>
      </article>
    </section>

    <section class="finance-layout">
      <div class="main-stack">
        <el-card class="panel-card" shadow="never">
          <template #header>
            <div class="panel-head">
              <div>
                <h2>财务报表</h2>
                <small>按当前筛选条件查看和导出。</small>
              </div>
              <div class="quick-actions">
                <el-button type="primary" @click="createExportTask('overview', 'PDF')">导出总览 PDF</el-button>
                <el-button @click="createExportTask('rent-collection', 'XLSX')">租金 Excel</el-button>
                <el-button @click="createExportTask('cash-flows', 'XLSX')">流水 Excel</el-button>
              </div>
            </div>
          </template>
          <el-tabs v-model="activeSection">
            <el-tab-pane label="租金收缴" name="rent">
              <el-table :data="collection.rows" size="small" height="430">
                <el-table-column prop="billNo" label="账单" min-width="140" fixed />
                <el-table-column prop="contractNo" label="合同" min-width="140" />
                <el-table-column prop="houseNo" label="房号" min-width="100" />
                <el-table-column prop="tenantName" label="承租人" min-width="120" />
                <el-table-column label="原应收" align="right" min-width="110"><template #default="{ row }">{{ formatMoney(row.originalReceivable) }}</template></el-table-column>
                <el-table-column label="优惠减免" align="right" min-width="110"><template #default="{ row }">{{ formatMoney(row.concessionAmount) }}</template></el-table-column>
                <el-table-column label="净应收" align="right" min-width="110"><template #default="{ row }">{{ formatMoney(row.netReceivable) }}</template></el-table-column>
                <el-table-column label="有效实收" align="right" min-width="110"><template #default="{ row }">{{ formatMoney(row.validReceived) }}</template></el-table-column>
                <el-table-column label="未收" align="right" min-width="110"><template #default="{ row }">{{ formatMoney(row.outstanding) }}</template></el-table-column>
                <el-table-column label="状态" min-width="100">
                  <template #default="{ row }"><el-tag :type="billStatus(row.status).type" effect="light">{{ billStatus(row.status).label }}</el-tag></template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="资金流水" name="cash">
              <div class="cash-metrics">
                <article v-for="item in cashSummary" :key="item.label" :class="item.tone">
                  <span>{{ item.label }}</span>
                  <b>{{ formatMoney(item.value) }}</b>
                </article>
              </div>
              <el-table :data="cash.flows" size="small" height="360">
                <el-table-column label="日期" min-width="120"><template #default="{ row }">{{ formatDate(row.date) }}</template></el-table-column>
                <el-table-column prop="type" label="类型" min-width="140" />
                <el-table-column label="方向" min-width="90"><template #default="{ row }"><el-tag :type="flowDirection(row).type">{{ flowDirection(row).label }}</el-tag></template></el-table-column>
                <el-table-column label="金额" align="right" min-width="120"><template #default="{ row }">{{ formatMoney(row.amount) }}</template></el-table-column>
                <el-table-column label="外部现金流" min-width="120"><template #default="{ row }">{{ row.external ? '是' : '否（内部抵扣）' }}</template></el-table-column>
                <el-table-column label="计入租金实收" min-width="120"><template #default="{ row }">{{ row.countsAsRentReceipt ? '是' : '否' }}</template></el-table-column>
                <el-table-column prop="reference" label="业务编号" min-width="160" />
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="提成台账" name="commissions">
              <el-alert title="提成仅为内部登记，不代表已付款，不影响租金、押金、预收款或资金流水。" type="info" :closable="false" />
              <el-form class="commission-form" inline>
                <el-form-item label="合同">
                  <el-select v-model="commissionForm.contractId" filterable placeholder="选择合同">
                    <el-option v-for="item in contracts" :key="item.id" :label="item.contractNo" :value="item.id" />
                  </el-select>
                </el-form-item>
                <el-form-item label="所属对象"><el-input v-model="commissionForm.recipientName" placeholder="人员或渠道名称" /></el-form-item>
                <el-form-item label="金额"><el-input v-model="commissionForm.amount" placeholder="0.00" /></el-form-item>
                <el-button type="primary" @click="createCommission">新增登记</el-button>
                <el-button @click="createExportTask('commissions', 'XLSX')">导出 Excel</el-button>
              </el-form>
              <el-table :data="commissions" size="small" height="320">
                <el-table-column prop="contract.contractNo" label="合同" min-width="140" />
                <el-table-column prop="recipientName" label="所属对象" min-width="140" />
                <el-table-column label="金额" align="right" min-width="120"><template #default="{ row }">{{ formatMoney(row.amount) }}</template></el-table-column>
                <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link type="danger" @click="removeCommission(row.id)">删除</el-button></template></el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="导出任务" name="exports">
              <el-table :data="exportTasks" size="small" height="430">
                <el-table-column prop="taskNo" label="任务编号" min-width="190" />
                <el-table-column label="报表" min-width="110"><template #default="{ row }">{{ reportLabels[row.reportType] || row.reportType }}</template></el-table-column>
                <el-table-column prop="exportFormat" label="格式" width="90" />
                <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="exportStatus(row).type">{{ exportStatus(row).label }}</el-tag></template></el-table-column>
                <el-table-column label="创建时间" min-width="150"><template #default="{ row }">{{ formatDate(row.createdAt) }}</template></el-table-column>
                <el-table-column label="操作" min-width="180">
                  <template #default="{ row }">
                    <el-button v-if="row.status === 'SUCCESS'" link type="primary" @click="downloadTask(row.id, row.fileAsset.originalName)">下载</el-button>
                    <span v-else-if="row.status === 'FAILED'">失败：{{ row.failureReason }}</span>
                    <span v-else>处理中</span>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>

      <aside class="side-stack">
        <el-card class="panel-card" shadow="never">
          <template #header>
            <div class="panel-head">
              <div>
                <h2>常用导出</h2>
                <small>生成后在任务列表下载。</small>
              </div>
            </div>
          </template>
          <div class="export-buttons">
            <el-button @click="createExportTask('overview', 'PDF')">财务总览 PDF</el-button>
            <el-button @click="createExportTask('rent-collection', 'PDF')">租金收缴 PDF</el-button>
            <el-button @click="createExportTask('cash-flows', 'PDF')">资金流水 PDF</el-button>
            <el-button @click="createExportTask('commissions', 'XLSX')">提成台账 Excel</el-button>
          </div>
        </el-card>
        <el-card class="panel-card" shadow="never">
          <template #header>
            <div class="panel-head">
              <div>
                <h2>最近导出任务</h2>
                <small>{{ exportTasks.length }} 个任务</small>
              </div>
              <el-button text type="primary" @click="activeSection = 'exports'">全部</el-button>
            </div>
          </template>
          <div class="task-list">
            <div v-for="task in exportTasks.slice(0, 6)" :key="task.id" class="task-item">
              <span><b>{{ reportLabels[task.reportType] || task.reportType }}</b><small>{{ task.exportFormat }} · {{ formatDate(task.createdAt) }}</small></span>
              <el-tag :type="exportStatus(task).type">{{ exportStatus(task).label }}</el-tag>
            </div>
            <el-empty v-if="!exportTasks.length" description="暂无导出任务" />
          </div>
        </el-card>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.finance-page { color:#233044; }
.page-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:18px; }
.page-head h1 { margin:7px 0 6px; font-size:24px; font-weight:750; }
.page-head p { margin:0; color:#748196; }
.filters { display:flex; align-items:center; gap:8px; }
.metrics { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
.metric { min-height:92px; padding:14px 15px; border:1px solid #e7ecf3; border-radius:11px; background:#fff; box-shadow:0 10px 28px rgba(28,52,84,.07); }
.metric span { color:#748196; font-size:12px; }
.metric b { display:block; margin-top:7px; font-size:22px; font-weight:760; }
.metric small { display:block; margin-top:5px; color:#8a96a7; font-size:11px; }
.metric.blue b { color:#246bfd; }
.metric.green b { color:#18825a; }
.metric.red b { color:#d64949; }
.metric.orange b { color:#df7a16; }
.finance-layout { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:16px; }
.main-stack,.side-stack { display:grid; gap:16px; align-content:start; }
.panel-card { border:1px solid #e7ecf3; border-radius:12px; box-shadow:0 10px 28px rgba(28,52,84,.07); }
.panel-head { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.panel-head h2 { margin:0; font-size:16px; }
.panel-head small { color:#8792a2; }
.quick-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
.cash-metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:14px; }
.cash-metrics article { padding:12px 14px; border-radius:10px; background:#f7f9fc; }
.cash-metrics span { color:#748196; font-size:12px; }
.cash-metrics b { display:block; margin-top:6px; font-size:20px; }
.cash-metrics .green b { color:#18825a; }
.cash-metrics .red b { color:#d64949; }
.cash-metrics .blue b { color:#246bfd; }
.commission-form { margin:14px 0; padding:12px; border-radius:10px; background:#f7f9fc; }
.commission-form :deep(.el-select),.commission-form :deep(.el-input) { width:180px; }
.export-buttons { display:grid; gap:8px; }
.export-buttons :deep(.el-button) { justify-content:flex-start; margin-left:0; }
.task-list { display:grid; gap:10px; }
.task-item { display:flex; justify-content:space-between; gap:10px; align-items:center; padding-bottom:10px; border-bottom:1px solid #edf1f5; }
.task-item:last-child { border-bottom:0; padding-bottom:0; }
.task-item b { display:block; color:#233044; font-size:13px; }
.task-item small { display:block; margin-top:3px; color:#8792a2; font-size:11px; }
@media (max-width:1200px) { .metrics { grid-template-columns:repeat(3,1fr); } .finance-layout { grid-template-columns:1fr; } }
@media (max-width:760px) { .page-head,.filters,.panel-head { align-items:stretch; flex-direction:column; } .metrics,.cash-metrics { grid-template-columns:1fr; } .quick-actions { justify-content:flex-start; } }
</style>
