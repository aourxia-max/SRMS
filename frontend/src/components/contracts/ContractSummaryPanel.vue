<script setup lang="ts">
import { computed } from 'vue'
import type { ContractFormModel, ContractPreview, ContractRole, ContractRoom, ContractTenant } from '../../types/contracts'

const props = defineProps<{
  form: ContractFormModel
  rooms: ContractRoom[]
  tenants: ContractTenant[]
  role: ContractRole
  preview?: ContractPreview | null
  previewLoading?: boolean
}>()

const roomName = computed(() => props.rooms.find((item) => item.id === props.form.roomId)?.fullHouseNo || '待选择')
const tenantName = computed(() => props.tenants.find((item) => item.id === props.form.primaryTenantId)?.name || '待选择')
const duration = computed(() => {
  if (!props.form.startDate || !props.form.endDate) return '待填写'
  const start = new Date(`${props.form.startDate}T00:00:00`)
  const end = new Date(`${props.form.endDate}T00:00:00`)
  return `${Math.max(1, Math.ceil((end.getTime() - start.getTime() + 86400000) / 2629800000))}个月`
})

const money = (value?: string) => value ? `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '—'
</script>

<template>
  <aside class="summary-column">
    <section class="contract-card">
      <header class="card-head">
        <h2>合同摘要</h2>
        <el-tag effect="light">待确认</el-tag>
      </header>
      <div class="summary-list">
        <div><span>房源</span><b>{{ roomName }}</b></div>
        <div><span>主承租人</span><b>{{ tenantName }}</b></div>
        <div><span>合同租期</span><b>{{ duration }}</b></div>
        <div><span>计价方式</span><b>固定月租</b></div>
        <div><span>固定月租</span><b class="primary-money">{{ money(form.monthlyRent) }}</b></div>
        <div><span>押金</span><b>{{ money(form.depositRequired) }}</b></div>
        <div><span>租缴周期</span><b>{{ form.paymentCycleMonths }}个月</b></div>
        <div v-if="role === 'SUPER_ADMIN' && form.commission?.recipientName">
          <span>租房提成</span>
          <b class="commission">{{ form.commission.recipientName }} · {{ money(form.commission.amount) }}</b>
        </div>
      </div>
    </section>

    <section class="contract-card">
      <header class="card-head">
        <h2>账单价格预览</h2>
        <span v-if="previewLoading" class="muted">计算中…</span>
      </header>
      <div class="preview-body">
        <template v-if="preview">
          <div class="preview-total">
            <span>预计 {{ preview.billCount }} 期</span>
            <b>{{ money(preview.totalPayable) }}</b>
          </div>
          <div class="preview-periods">
            <span v-for="bill in preview.bills" :key="bill.sequence">
              {{ bill.sequence }}期 {{ money(bill.payableAmount) }}
            </span>
          </div>
          <div class="preview-meta">
            <span>原始租金 {{ money(preview.totalBaseRent) }}</span>
            <span>优惠 {{ money(preview.totalDiscount) }}</span>
          </div>
        </template>
        <el-empty v-else :image-size="56" description="填写租期与月租后自动预览" />
        <p class="preview-tip">预览仅供确认，正式账单由后端在合同确认事务中重新计算；尾期按固定30天计租。</p>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.summary-column { min-width: 0; }
.contract-card { margin-bottom: 15px; overflow: hidden; background: #fff; border: 1px solid #e7ecf3; border-radius: 12px; box-shadow: 0 10px 28px rgb(28 52 84 / 7%); }
.card-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 17px; border-bottom: 1px solid #edf1f5; }
.card-head h2 { margin: 0; font-size: 16px; }
.summary-list { display: grid; gap: 12px; padding: 17px; }
.summary-list > div { display: flex; justify-content: space-between; gap: 18px; padding-bottom: 10px; border-bottom: 1px dashed #e2e7ee; }
.summary-list > div:last-child { padding-bottom: 0; border-bottom: 0; }
.summary-list span, .muted { color: #748196; }
.summary-list b { text-align: right; }
.primary-money { color: #246bfd; }
.commission { color: #6848c2; }
.preview-body { padding: 17px; }
.preview-total { display: flex; align-items: end; justify-content: space-between; margin-bottom: 12px; color: #748196; }
.preview-total b { color: #246bfd; font-size: 22px; }
.preview-periods { display: flex; flex-wrap: wrap; gap: 6px; }
.preview-periods span { padding: 7px 9px; color: #3564b5; font-size: 12px; background: #eef4ff; border-radius: 7px; }
.preview-meta { display: flex; justify-content: space-between; margin-top: 14px; color: #748196; font-size: 12px; }
.preview-tip { padding: 10px 12px; margin: 14px 0 0; color: #46648e; font-size: 12px; background: #eef4ff; border: 1px solid #ccdcfb; border-radius: 8px; }
</style>
