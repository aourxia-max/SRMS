<script setup lang="ts">
import { computed, ref } from 'vue'
import { isFixedRentRebateEligible } from '../../services/contracts'
import type { ContractDetail, ContractFile, ContractRole, RentBill } from '../../types/contracts'
import type { PaymentListItem } from '../../types/payments'

const props = withDefaults(defineProps<{
  contract?: ContractDetail | null
  bills?: RentBill[]
  files?: ContractFile[]
  changes?: unknown[]
  payments?: PaymentListItem[]
  role: ContractRole
  loading?: boolean
}>(), { contract: null, bills: () => [], files: () => [], changes: () => [], payments: () => [], loading: false })

const emit = defineEmits<{ back: []; rebate: [contractId: number]; checkout: [contractId: number]; download: [file: ContractFile] }>()
const activeSection = ref('overview')
const primaryTenant = computed(() => props.contract?.members?.find((item) => item.memberRole === 'PRIMARY')?.tenant)
const money = (value?: string | null) => value ? `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '—'
const date = (value?: string | null) => value ? String(value).slice(0, 10) : '—'
const statusLabel: Record<string, string> = { DRAFT: '??', PENDING_START: '???', ACTIVE: '???', PENDING_CHECKOUT: '???', ENDED: '???', VOIDED: '???' }
const paidBillCount = computed(() => props.bills.filter((item) => item.status === 'PAID').length)
const canInitiateCheckout = computed(() => props.contract?.status === 'ACTIVE')
</script>

<template>
  <section v-loading="loading">
    <el-empty v-if="!contract" description="请先从合同列表选择合同">
      <el-button type="primary" @click="emit('back')">返回合同列表</el-button>
    </el-empty>
    <template v-else>
      <div class="status-banner">
        <div><h1>{{ contract.contractNo }}</h1><p>{{ contract.room?.fullHouseNo || `房源${contract.roomId}` }}｜{{ primaryTenant?.name || '未记录承租人' }}｜合同期 {{ date(contract.startDate) }} 至 {{ date(contract.endDate) }}</p></div>
        <el-tag effect="dark">{{ statusLabel[contract.status] || contract.status }}</el-tag>
      </div>
      <header class="page-head">
        <div><h1>合同详情</h1><p>固定月租合同履行、账单、成员、附件和变更记录</p></div>
        <div class="actions">
          <el-button @click="emit('back')">返回列表</el-button>
          <el-button
            v-if="canInitiateCheckout"
            data-test="open-checkout"
            type="primary"
            @click="emit('checkout', contract.id)"
          >
            ????
          </el-button>
          <el-button
            v-if="isFixedRentRebateEligible(contract)"
            data-test="open-fixed-rent-rebate"
            type="primary"
            plain
            @click="emit('rebate', contract.id)"
          >
            固定月租退差
          </el-button>
        </div>
      </header>
      <div class="metrics">
        <div><span>固定月租</span><b class="money-blue">{{ money(contract.monthlyRent) }}</b></div>
        <div><span>租缴周期</span><b>{{ contract.paymentCycleMonths || 1 }}个月</b></div>
        <div><span>账单期数</span><b>{{ bills.length }}期</b></div>
        <div><span>已结清账单</span><b>{{ paidBillCount }}期</b></div>
      </div>
      <div class="detail-grid">
        <section class="contract-card detail-main">
          <el-tabs v-model="activeSection">
            <el-tab-pane label="合同概况" name="overview">
              <el-descriptions :column="2" border>
                <el-descriptions-item label="系统合同编号">{{ contract.contractNo }}</el-descriptions-item>
                <el-descriptions-item label="纸质合同编号">{{ contract.externalContractNo || '—' }}</el-descriptions-item>
                <el-descriptions-item label="合同开始日期">{{ date(contract.startDate) }}</el-descriptions-item>
                <el-descriptions-item label="合同结束日期">{{ date(contract.endDate) }}</el-descriptions-item>
                <el-descriptions-item label="计划入住日期">{{ date(contract.plannedMoveInDate) }}</el-descriptions-item>
                <el-descriptions-item label="押金">{{ money(contract.depositRequired) }}</el-descriptions-item>
                <el-descriptions-item label="合同备注" :span="2">{{ contract.remark || '—' }}</el-descriptions-item>
              </el-descriptions>
            </el-tab-pane>
            <el-tab-pane label="租金账单" name="bills">
              <el-table :data="bills" empty-text="暂无租金账单">
                <el-table-column prop="billNo" label="账单编号" min-width="220" />
                <el-table-column label="账期" min-width="210"><template #default="{ row }">{{ date(row.periodStart) }} 至 {{ date(row.periodEnd) }}</template></el-table-column>
                <el-table-column label="应收"><template #default="{ row }">{{ money(row.payableAmount) }}</template></el-table-column>
                <el-table-column label="未收"><template #default="{ row }">{{ money(row.outstandingAmount) }}</template></el-table-column>
                <el-table-column prop="status" label="状态" />
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="收款记录" name="payments">
              <el-table :data="payments" empty-text="当前合同暂无收款记录">
                <el-table-column prop="receiptNo" label="收款单号" min-width="170" />
                <el-table-column label="收款日期" width="130"><template #default="{ row }">{{ date(row.paymentDate) }}</template></el-table-column>
                <el-table-column label="金额" width="130"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column>
                <el-table-column prop="method" label="支付方式" width="120" />
                <el-table-column prop="status" label="状态" width="120" />
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="合同成员" name="members">
              <el-table :data="contract.members" empty-text="暂无合同成员"><el-table-column label="成员角色"><template #default="{ row }">{{ row.memberRole === 'PRIMARY' ? '主承租人' : '副承租人' }}</template></el-table-column><el-table-column prop="tenant.name" label="姓名" /><el-table-column prop="tenant.phone" label="电话" /></el-table>
            </el-tab-pane>
            <el-tab-pane label="附件" name="files">
              <el-table :data="files" empty-text="暂无合同附件">
                <el-table-column prop="originalName" label="文件名" />
                <el-table-column prop="mimeType" label="类型" />
                <el-table-column label="大小"><template #default="{ row }">{{ row.sizeBytes ? `${Math.ceil(Number(row.sizeBytes) / 1024)} KB` : '—' }}</template></el-table-column>
                <el-table-column label="操作" width="100"><template #default="{ row }"><el-button :data-test="`download-contract-file-${row.id}`" type="primary" link @click="emit('download', row)">下载</el-button></template></el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="变更记录" name="changes"><el-empty v-if="!changes.length" :image-size="64" description="暂无合同变更记录" /><pre v-else class="change-data">{{ changes }}</pre></el-tab-pane>
          </el-tabs>
        </section>
        <aside>
          <section class="contract-card">
            <header class="card-head"><h2>合同财务概况</h2></header>
            <div class="summary-list">
              <div><span>计价方式</span><b>固定月租</b></div>
              <div><span>固定月租</span><b class="money-blue">{{ money(contract.monthlyRent) }}</b></div>
              <div><span>押金</span><b>{{ money(contract.depositRequired) }}</b></div>
              <div v-if="role === 'SUPER_ADMIN' && contract.commissions?.length"><span>租房提成</span><b class="commission">{{ contract.commissions[0].recipientName }} · {{ money(contract.commissions[0].amount) }}</b></div>
            </div>
          </section>
          <section class="notice">已确认合同的关键金额和日期不能直接编辑。如需调整，请进入合同变更流程。</section>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.status-banner { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 18px; margin-bottom: 15px; color: #fff; background: linear-gradient(120deg, #1d5fd8, #2f82f7); border-radius: 12px; }
.status-banner h1 { margin: 0 0 5px; font-size: 21px; }
.status-banner p { margin: 0; color: #dce9ff; }
.page-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 5px; font-size: 22px; }.page-head p { margin: 0; color: #748196; }.actions { display: flex; gap: 8px; }
.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 15px; }
.metrics > div { padding: 14px 15px; background: #fff; border: 1px solid #e7ecf3; border-radius: 11px; box-shadow: 0 10px 28px rgb(28 52 84 / 7%); }
.metrics span { color: #748196; font-size: 12px; }.metrics b { display: block; margin-top: 7px; font-size: 21px; }
.detail-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 15px; }
.contract-card { overflow: hidden; background: #fff; border: 1px solid #e7ecf3; border-radius: 12px; box-shadow: 0 10px 28px rgb(28 52 84 / 7%); }
.detail-main { min-height: 420px; padding: 0 17px 17px; }
.detail-main :deep(.el-tabs__header) { margin-bottom: 17px; }
.card-head { padding: 14px 17px; border-bottom: 1px solid #edf1f5; }.card-head h2 { margin: 0; font-size: 16px; }
.summary-list { display: grid; gap: 12px; padding: 17px; }.summary-list > div { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 1px dashed #e2e7ee; }.summary-list span { color: #748196; }.summary-list b { text-align: right; }.money-blue { color: #246bfd; }.commission { color: #6848c2; }
.notice { padding: 12px; margin-top: 15px; color: #46648e; font-size: 12px; background: #eef4ff; border: 1px solid #ccdcfb; border-radius: 8px; }.change-data { white-space: pre-wrap; }
</style>
