<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CheckoutSettlement } from './checkout-types'

const props = defineProps<{ settlements: CheckoutSettlement[]; isSuper?: boolean }>()
const emit = defineEmits<{ approve: [id: number] }>()
const selectedId = ref<number | null>(null)
const selected = computed(() => props.settlements.find((item) => item.id === selectedId.value) ?? props.settlements[0])

function amount(value: string) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function totalRefund(settlement: CheckoutSettlement) {
  return amount(
    String(
      Number(settlement.depositRefundableAmount || 0) +
        Number(settlement.prepaymentRefundableAmount || 0),
    ),
  )
}
function statusText(status: CheckoutSettlement['status']) {
  return { DRAFT: '待录入结算', PENDING: '等待结算确认', APPROVED: '等待最终退款确认', REJECTED: '已驳回', COMPLETED: '已完成' }[status]
}
</script>

<template>
  <section class="settlement-panel">
    <div class="settlement-panel__title"><div><h2>退租结算</h2><p>验房并核对结算项目；确认结算不会直接结束合同或释放房源。</p></div></div>
    <div v-if="!settlements.length" class="settlement-panel__empty">暂无已发起的退租结算单。</div>
    <template v-else>
      <div class="settlement-panel__list">
        <button v-for="item in settlements" :key="item.id" type="button" :class="{ active: selected?.id === item.id }" @click="selectedId = item.id">
          <strong>{{ item.settlementNo }}</strong><span>{{ statusText(item.status) }}</span>
        </button>
      </div>
      <article v-if="selected" class="settlement-panel__detail">
        <div class="settlement-panel__banner" :class="`status-${selected.status.toLowerCase()}`"><strong>{{ statusText(selected.status) }}</strong><span v-if="selected.status === 'APPROVED'">结算已锁定，请前往“押金退还确认”完成最终处理。</span></div>
        <div class="settlement-panel__summary">
          <div><span>应退押金</span><strong>¥{{ amount(selected.depositRefundableAmount) }}</strong></div>
          <div><span>应退预收款</span><strong>¥{{ amount(selected.prepaymentRefundableAmount) }}</strong></div>
          <div><span>合计应退</span><strong>¥{{ totalRefund(selected) }}</strong></div>
          <div><span>待补收金额</span><strong>¥{{ amount(selected.finalReceivable) }}</strong></div>
        </div>
        <div v-if="selected.status === 'PENDING' && isSuper" class="settlement-panel__actions"><button type="button" class="primary-button" @click="emit('approve', selected.id)">确认结算</button></div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.settlement-panel{display:grid;gap:16px}.settlement-panel__title h2{margin:0 0 6px;font-size:20px}.settlement-panel__title p{margin:0;color:#66758b}.settlement-panel__empty,.settlement-panel__detail{padding:24px;border:1px solid #e4eaf3;border-radius:12px;background:#fff}.settlement-panel__list{display:flex;gap:10px;overflow-x:auto}.settlement-panel__list button{min-width:220px;padding:14px;border:1px solid #e0e7f1;border-radius:8px;color:#415168;background:#fff;text-align:left;cursor:pointer}.settlement-panel__list button.active{border-color:#246bfd;background:#f3f7ff}.settlement-panel__list strong,.settlement-panel__list span{display:block}.settlement-panel__list span{margin-top:5px;color:#66758b;font-size:13px}.settlement-panel__banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:8px;color:#1d5ccf;background:#edf4ff}.settlement-panel__banner.status-completed{color:#18805a;background:#eaf8f1}.settlement-panel__banner.status-rejected{color:#c43c3c;background:#fff1f0}.settlement-panel__summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:18px}.settlement-panel__summary div{padding:16px;border-radius:8px;background:#f7f9fc}.settlement-panel__summary span,.settlement-panel__summary strong{display:block}.settlement-panel__summary span{color:#66758b;font-size:13px}.settlement-panel__summary strong{margin-top:8px;font-size:20px}.settlement-panel__actions{display:flex;justify-content:flex-end;margin-top:20px}.primary-button{min-height:40px;padding:0 20px;border:0;border-radius:6px;color:#fff;background:#246bfd;font:inherit;cursor:pointer}@media(max-width:760px){.settlement-panel__detail,.settlement-panel__empty{padding:16px}.settlement-panel__banner{align-items:flex-start;flex-direction:column}.settlement-panel__summary{grid-template-columns:1fr}}
</style>
