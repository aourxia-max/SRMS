<script setup lang="ts">
import { computed } from 'vue'
import { roomStatusLabel } from '../../../utils/status-labels'
import type { ContractVoidImpact, ContractVoidImpactSnapshot, ContractVoidPendingWorkflows } from '../../../types/contracts'
import { contractVoidRoomActionLabel, contractVoidWorkflowLabel } from './contract-void-presentation'

const props = defineProps<{ impact: ContractVoidImpact | ContractVoidImpactSnapshot }>()

const exactMoney = (value?: string | null) => {
  if (!value) return '—'
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value)
  if (!match) return '金额格式异常'
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${match[1]}¥${grouped}${match[3] ?? ''}`
}

const cards = computed(() => [
  { label: '账单应收', value: props.impact.summary.rentBillPayable },
  { label: '有效收款', value: props.impact.summary.effectivePayment },
  { label: '押金余额', value: props.impact.summary.depositBalance },
  { label: '预收余额', value: props.impact.summary.prepaymentBalance },
  { label: '退款净额', value: props.impact.summary.refundNet },
  { label: '作废后净影响', value: props.impact.summary.postReversalNetImpact },
])

const workflowEntries = computed(() => Object.entries(props.impact.pending) as Array<[keyof ContractVoidPendingWorkflows, number[]]>)
const pendingItems = computed(() => workflowEntries.value.flatMap(([key, ids]) => ids.map((id) => `${contractVoidWorkflowLabel(key)} #${id}`)))
const impactHash = computed(() => 'impactHash' in props.impact ? props.impact.impactHash : undefined)
const roomConclusion = computed(() => `${props.impact.room.hasLaterContract ? '存在' : '无'}后续合同，${contractVoidRoomActionLabel(props.impact.room.action)}`)
</script>

<template>
  <section class="impact" data-test="void-impact-cards" :data-impact-hash="impactHash">
    <header><div><h3>关联影响预览</h3><p>金额按后端精确字符串展示，不在页面参与业务计算</p></div><el-tag type="warning" effect="light">高风险操作</el-tag></header>
    <div class="impact__cards">
      <div v-for="card in cards" :key="card.label"><span>{{ card.label }}</span><b>{{ exactMoney(card.value) }}</b></div>
    </div>
    <div class="impact__net">
      <span>当前净影响 <b>{{ exactMoney(impact.summary.currentNetImpact) }}</b></span>
      <span>计划冲销 <b>{{ exactMoney(impact.summary.plannedReversal) }}</b></span>
    </div>
    <div class="impact__risks">
      <section><h4>待处理流程</h4><el-empty v-if="!pendingItems.length" :image-size="38" description="无待处理流程" /><div v-else class="chips"><el-tag v-for="item in pendingItems" :key="item" type="warning">{{ item }}</el-tag></div></section>
      <section><h4>已完成退租</h4><span v-if="!impact.completedCheckoutIds.length">无已完成退租</span><div v-else class="chips"><el-tag v-for="id in impact.completedCheckoutIds" :key="id" type="danger">已完成退租 #{{ id }}</el-tag></div></section>
      <section><h4>房态结论</h4><p>{{ roomConclusion }}</p><small>当前房态：{{ roomStatusLabel(impact.room.currentStatus) }}</small></section>
    </div>
  </section>
</template>

<style scoped>
.impact { overflow: hidden; background: #fff; border: 1px solid #e7ecf3; border-radius: 12px; box-shadow: 0 10px 28px rgb(28 52 84 / 7%); }
.impact > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 17px; border-bottom: 1px solid #edf1f5; }
.impact h3, .impact h4, .impact p { margin: 0; }
.impact header h3 { font-size: 16px; }
.impact header p { margin-top: 3px; color: #748196; font-size: 12px; }
.impact__cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: #edf1f5; }
.impact__cards > div { padding: 13px 15px; background: #fff; }
.impact__cards span { display: block; color: #748196; font-size: 12px; }
.impact__cards b { display: block; margin-top: 5px; color: #1d5fd8; font-size: 17px; font-variant-numeric: tabular-nums; }
.impact__net { display: flex; gap: 24px; padding: 11px 15px; color: #526075; background: #f7f9fc; border-top: 1px solid #edf1f5; }
.impact__net b { margin-left: 5px; color: #233044; }
.impact__risks { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 0; border-top: 1px solid #edf1f5; }
.impact__risks section { min-width: 0; padding: 13px 15px; border-right: 1px solid #edf1f5; }
.impact__risks section:last-child { border-right: 0; }
.impact__risks h4 { margin-bottom: 8px; color: #526075; font-size: 13px; }
.impact__risks span, .impact__risks p, .impact__risks small { color: #65738a; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
@media (max-width: 980px) { .impact__cards, .impact__risks { grid-template-columns: 1fr 1fr; } }
</style>
