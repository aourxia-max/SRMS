<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const contracts = ref<any[]>([])
const bills = ref<any[]>([])
const payments = ref<any[]>([])
const prepayments = ref<any>({ balance: '0.00', items: [] })
const adjustments = ref<any[]>([])
const refunds = ref<any[]>([])
const voidRequests = ref<any[]>([])
const adjustmentForm = reactive({ rentBillId: undefined as number | undefined, adjustmentType: 'WAIVER', direction: 'DECREASE', amount: '', reason: '' })
const refundForm = reactive({ paymentId: undefined as number | undefined, refundDate: new Date().toISOString().slice(0, 10), refundMethod: 'WECHAT', reason: '' })
const refundAmounts = reactive<Record<number, string>>({})
const voidForm = reactive({ paymentId: undefined as number | undefined, reason: '' })
const isSuperAdmin = computed(() => session.user?.role === 'SUPER_ADMIN')
const selectedBillIds = ref<number[]>([])
const form = reactive({ contractId: undefined as number | undefined, paymentDate: new Date().toISOString().slice(0, 10), amount: '', method: 'WECHAT', externalReference: '', remark: '' })
const selectedBills = computed(() => bills.value.filter((bill) => selectedBillIds.value.includes(bill.id)))
const selectedOutstanding = computed(() => selectedBills.value.reduce((sum, bill) => sum + Number(bill.outstandingAmount), 0))
const previewPrepayment = computed(() => Math.max(0, Number(form.amount || 0) - selectedOutstanding.value))

async function loadContracts() { contracts.value = (await http.get('/contracts')).data.data }
async function selectContract() {
  if (!form.contractId) return
  bills.value = (await http.get(`/contracts/${form.contractId}/bills`)).data.data.filter((bill: any) => !['VOIDED', 'REFUNDED'].includes(bill.status) && Number(bill.outstandingAmount) > 0)
  payments.value = (await http.get('/payments', { params: { contractId: form.contractId } })).data.data
  prepayments.value = (await http.get('/payments/prepayments', { params: { contractId: form.contractId } })).data.data
  adjustments.value = []
  selectedBillIds.value = []
}
async function submit() {
  if (!form.contractId || !form.amount || Number(form.amount) <= 0) return alert('请选择合同并填写大于零的收款金额')
  await http.post('/payments', { ...form, selectedBillIds: selectedBillIds.value.length ? selectedBillIds.value : undefined })
  await selectContract()
  form.amount = ''
  alert('收款登记成功')
}
async function loadAdjustments() {
  if (!adjustmentForm.rentBillId) return
  adjustments.value = (await http.get('/bill-adjustments', { params: { rentBillId: adjustmentForm.rentBillId } })).data.data
}
async function submitAdjustment() {
  if (!adjustmentForm.rentBillId || !adjustmentForm.amount || !adjustmentForm.reason) return alert('请选择账单，并填写金额和原因')
  await http.post('/bill-adjustments', adjustmentForm)
  await loadAdjustments()
  adjustmentForm.amount = ''
  adjustmentForm.reason = ''
  alert('优惠/减免申请已提交，等待超级管理员确认')
}
async function approveAdjustment(id: number) { await http.post(`/bill-adjustments/${id}/approve`); await loadAdjustments(); await selectContract() }
async function rejectAdjustment(id: number) { const reason = window.prompt('请输入驳回原因'); if (reason) { await http.post(`/bill-adjustments/${id}/reject`, { reason }); await loadAdjustments() } }
const selectedPayment = computed(() => payments.value.find((payment) => payment.id === refundForm.paymentId))
const refundTotal = computed(() => Object.values(refundAmounts).reduce((sum, amount) => sum + Number(amount || 0), 0))
async function selectRefundPayment() {
  Object.keys(refundAmounts).forEach((key) => delete refundAmounts[Number(key)])
  if (refundForm.paymentId) refunds.value = (await http.get('/payment-refunds', { params: { paymentId: refundForm.paymentId } })).data.data
}
async function submitRefund() {
  if (!refundForm.paymentId || !refundForm.reason || refundTotal.value <= 0) return alert('请选择原收款，填写回退金额和退款原因')
  const allocations = Object.entries(refundAmounts).filter(([, amount]) => Number(amount) > 0).map(([paymentAllocationId, amount]) => ({ paymentAllocationId: Number(paymentAllocationId), amount }))
  await http.post('/payment-refunds', { ...refundForm, refundAmount: refundTotal.value.toFixed(2), allocations })
  await selectRefundPayment()
  alert('退款申请已提交，等待超级管理员确认')
}
async function approveRefund(id: number) { await http.post(`/payment-refunds/${id}/approve`); await selectRefundPayment(); await selectContract() }
async function rejectRefund(id: number) { const reason = window.prompt('请输入驳回原因'); if (reason) { await http.post(`/payment-refunds/${id}/reject`, { reason }); await selectRefundPayment() } }
async function selectVoidPayment() { if (voidForm.paymentId) voidRequests.value = (await http.get('/payment-void-requests', { params: { paymentId: voidForm.paymentId } })).data.data }
async function submitVoidRequest() { if (!voidForm.paymentId || !voidForm.reason) return alert('请选择原收款并填写作废原因'); await http.post('/payment-void-requests', voidForm); await selectVoidPayment(); voidForm.reason = ''; alert('作废申请已提交，等待超级管理员确认') }
async function approveVoidRequest(id: number) { await http.post(`/payment-void-requests/${id}/approve`); await selectVoidPayment(); await selectContract() }
async function rejectVoidRequest(id: number) { const reason = window.prompt('请输入驳回原因'); if (reason) { await http.post(`/payment-void-requests/${id}/reject`, { reason }); await selectVoidPayment() } }
function allocationSummary(payment: any) { return payment.allocations?.reduce((sum: number, item: any) => sum + Number(item.allocatedAmount), 0)?.toFixed(2) ?? '0.00' }
onMounted(loadContracts)
</script>

<template>
  <main class="users-page">
    <header><div><el-tag>Task007</el-tag><h1>收款登记</h1><p>默认按最早未结清账单分配；手动勾选时可收取未来账期，超额金额自动转入预收款。</p></div></header>
    <el-card header="登记租金收款"><el-form :model="form" label-position="top"><el-row :gutter="16"><el-col :span="8"><el-form-item label="合同"><el-select v-model="form.contractId" @change="selectContract"><el-option v-for="contract in contracts" :key="contract.id" :label="contract.contractNo" :value="contract.id" /></el-select></el-form-item></el-col><el-col :span="8"><el-form-item label="收款日期"><el-date-picker v-model="form.paymentDate" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col><el-col :span="8"><el-form-item label="收款金额（元）"><el-input v-model="form.amount" /></el-form-item></el-col><el-col :span="8"><el-form-item label="收款方式"><el-select v-model="form.method"><el-option label="微信" value="WECHAT" /><el-option label="支付宝" value="ALIPAY" /><el-option label="银行转账" value="BANK_TRANSFER" /><el-option label="现金" value="CASH" /><el-option label="POS" value="POS" /><el-option label="其他" value="OTHER" /></el-select></el-form-item></el-col><el-col :span="8"><el-form-item label="交易参考号（选填）"><el-input v-model="form.externalReference" /></el-form-item></el-col><el-col :span="8"><el-form-item label="备注（选填）"><el-input v-model="form.remark" /></el-form-item></el-col></el-row></el-form>
      <el-alert v-if="!selectedBillIds.length" title="未手动选择账单：系统会自动按最早未结清账单分配。" type="info" :closable="false" />
      <el-alert v-else :title="`已选账单未收合计：${selectedOutstanding.toFixed(2)} 元；预计转预收款：${previewPrepayment.toFixed(2)} 元`" type="success" :closable="false" />
      <el-button style="margin-top: 16px" type="primary" @click="submit">确认登记收款</el-button>
    </el-card>
    <el-card header="未结账单（可选未来账期）" style="margin-top: 16px"><el-empty v-if="!form.contractId" description="请先选择合同" /><el-table v-else :data="bills" @selection-change="(rows: any[]) => selectedBillIds = rows.map((row) => row.id)"><el-table-column type="selection" width="48" /><el-table-column prop="periodSeq" label="账期" /><el-table-column prop="periodStart" label="开始日期" /><el-table-column prop="dueDate" label="应缴日期" /><el-table-column prop="payableAmount" label="应收" /><el-table-column prop="receivedAmount" label="已收" /><el-table-column prop="outstandingAmount" label="未收" /><el-table-column prop="status" label="状态" /></el-table></el-card>
    <el-card header="优惠 / 减免申请" style="margin-top: 16px"><el-alert title="申请提交后不会改变账单金额；只有超级管理员确认后才生效。" type="warning" :closable="false" /><el-form label-position="top" style="margin-top: 16px"><el-row :gutter="16"><el-col :span="8"><el-form-item label="归属账单"><el-select v-model="adjustmentForm.rentBillId" @change="loadAdjustments"><el-option v-for="bill in bills" :key="bill.id" :label="`第 ${bill.periodSeq} 期（未收 ${bill.outstandingAmount}）`" :value="bill.id" /></el-select></el-form-item></el-col><el-col :span="8"><el-form-item label="调整类型"><el-select v-model="adjustmentForm.adjustmentType"><el-option label="一次性优惠" value="DISCOUNT" /><el-option label="减免" value="WAIVER" /><el-option label="补收" value="INCREASE" /><el-option label="更正" value="CORRECTION" /></el-select></el-form-item></el-col><el-col :span="8"><el-form-item label="调整方向"><el-select v-model="adjustmentForm.direction"><el-option label="减少应收" value="DECREASE" /><el-option label="增加应收" value="INCREASE" /></el-select></el-form-item></el-col><el-col :span="8"><el-form-item label="金额（元）"><el-input v-model="adjustmentForm.amount" /></el-form-item></el-col><el-col :span="16"><el-form-item label="原因"><el-input v-model="adjustmentForm.reason" /></el-form-item></el-col></el-row></el-form><el-button type="primary" @click="submitAdjustment">提交申请</el-button><el-table v-if="adjustments.length" :data="adjustments" style="margin-top: 16px"><el-table-column prop="adjustmentNo" label="编号" /><el-table-column prop="adjustmentType" label="类型" /><el-table-column prop="direction" label="方向" /><el-table-column prop="amount" label="金额" /><el-table-column prop="approvalStatus" label="状态" /><el-table-column v-if="isSuperAdmin" label="审批"><template #default="{ row }"><el-button v-if="row.approvalStatus === 'PENDING'" size="small" type="primary" @click="approveAdjustment(row.id)">确认</el-button><el-button v-if="row.approvalStatus === 'PENDING'" size="small" type="danger" @click="rejectAdjustment(row.id)">驳回</el-button></template></el-table-column></el-table></el-card>
    <el-card header="该合同收款记录" style="margin-top: 16px"><el-table :data="payments"><el-table-column type="expand"><template #default="{ row }"><el-table :data="row.allocations" size="small"><el-table-column label="覆盖账期"><template #default="{ row: allocation }">第 {{ allocation.rentBill?.periodSeq }} 期</template></el-table-column><el-table-column label="账期开始"><template #default="{ row: allocation }">{{ allocation.rentBill?.periodStart }}</template></el-table-column><el-table-column prop="allocatedAmount" label="本次分配金额" /></el-table><el-empty v-if="!row.allocations?.length" description="本笔收款未分配至账单，已全部转入预收款" /></template></el-table-column><el-table-column prop="receiptNo" label="收据编号" /><el-table-column prop="paymentDate" label="收款日期" /><el-table-column prop="amount" label="金额" /><el-table-column prop="method" label="方式" /><el-table-column label="分配金额"><template #default="{ row }">{{ allocationSummary(row) }}</template></el-table-column><el-table-column prop="status" label="状态" /></el-table></el-card>
    <el-card header="退款申请" style="margin-top: 16px"><el-alert title="退款申请必须逐条填写原账单分配的回退金额；确认后原收款与原分配记录会保留。" type="warning" :closable="false" /><el-form label-position="top" style="margin-top: 16px"><el-row :gutter="16"><el-col :span="8"><el-form-item label="原收款"><el-select v-model="refundForm.paymentId" @change="selectRefundPayment"><el-option v-for="payment in payments.filter((item) => ['CONFIRMED', 'PARTIALLY_REFUNDED'].includes(item.status))" :key="payment.id" :label="`${payment.receiptNo}（${payment.amount} 元）`" :value="payment.id" /></el-select></el-form-item></el-col><el-col :span="8"><el-form-item label="退款日期"><el-date-picker v-model="refundForm.refundDate" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col><el-col :span="8"><el-form-item label="退款方式"><el-select v-model="refundForm.refundMethod"><el-option label="微信" value="WECHAT" /><el-option label="支付宝" value="ALIPAY" /><el-option label="银行转账" value="BANK_TRANSFER" /><el-option label="现金" value="CASH" /><el-option label="其他" value="OTHER" /></el-select></el-form-item></el-col><el-col :span="24"><el-form-item label="退款原因"><el-input v-model="refundForm.reason" /></el-form-item></el-col></el-row></el-form><el-table v-if="selectedPayment" :data="selectedPayment.allocations"><el-table-column label="账期"><template #default="{ row }">第 {{ row.rentBill?.periodSeq }} 期</template></el-table-column><el-table-column prop="allocatedAmount" label="原分配" /><el-table-column prop="reversedAmount" label="已回退" /><el-table-column label="本次回退"><template #default="{ row }"><el-input v-model="refundAmounts[row.id]" placeholder="0.00" /></template></el-table-column></el-table><p v-if="selectedPayment">本次退款合计：{{ refundTotal.toFixed(2) }} 元</p><el-button type="primary" @click="submitRefund">提交退款申请</el-button><el-table v-if="refunds.length" :data="refunds" style="margin-top: 16px"><el-table-column prop="refundNo" label="退款编号" /><el-table-column prop="refundAmount" label="退款金额" /><el-table-column prop="approvalStatus" label="状态" /><el-table-column v-if="isSuperAdmin" label="审批"><template #default="{ row }"><el-button v-if="row.approvalStatus === 'PENDING'" size="small" type="primary" @click="approveRefund(row.id)">确认</el-button><el-button v-if="row.approvalStatus === 'PENDING'" size="small" type="danger" @click="rejectRefund(row.id)">驳回</el-button></template></el-table-column></el-table></el-card>
    <el-card header="整笔收款作废申请" style="margin-top: 16px"><el-alert title="作废确认会回退本笔收款的全部账单分配和预收款入账，原收据仍会保留并标记作废。" type="error" :closable="false" /><el-form label-position="top" style="margin-top: 16px"><el-row :gutter="16"><el-col :span="8"><el-form-item label="原收款"><el-select v-model="voidForm.paymentId" @change="selectVoidPayment"><el-option v-for="payment in payments.filter((item) => item.status === 'CONFIRMED')" :key="payment.id" :label="`${payment.receiptNo}（${payment.amount} 元）`" :value="payment.id" /></el-select></el-form-item></el-col><el-col :span="16"><el-form-item label="作废原因"><el-input v-model="voidForm.reason" /></el-form-item></el-col></el-row></el-form><el-button type="danger" @click="submitVoidRequest">提交作废申请</el-button><el-table v-if="voidRequests.length" :data="voidRequests" style="margin-top: 16px"><el-table-column prop="requestNo" label="申请编号" /><el-table-column prop="reason" label="原因" /><el-table-column prop="approvalStatus" label="状态" /><el-table-column v-if="isSuperAdmin" label="审批"><template #default="{ row }"><el-button v-if="row.approvalStatus === 'PENDING'" size="small" type="primary" @click="approveVoidRequest(row.id)">确认作废</el-button><el-button v-if="row.approvalStatus === 'PENDING'" size="small" @click="rejectVoidRequest(row.id)">驳回</el-button></template></el-table-column></el-table></el-card>
    <el-card header="预收款余额与流水" style="margin-top: 16px"><el-statistic title="当前预收款余额（元）" :value="Number(prepayments.balance)" :precision="2" /><el-table :data="prepayments.items" style="margin-top: 16px"><el-table-column prop="transactionNo" label="流水编号" /><el-table-column prop="transactionType" label="类型" /><el-table-column prop="amount" label="金额" /><el-table-column prop="balanceAfter" label="余额" /><el-table-column prop="reason" label="原因" /></el-table></el-card>
  </main>
</template>
