<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { UploadRequestOptions } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import PaymentWorkspace from '../../components/payments/PaymentWorkspace.vue'
import { createLatestRequestGuard } from '../../services/contracts'
import { paymentApi } from '../../services/payments'
import { useSessionStore } from '../../stores/session'
import type { ContractSummary, PaymentMethod, RentBill } from '../../types/payments'
import { allocationSummary, eligibleAdjustmentBillIds, isPrefixSelection, nextSuggestedPaymentAmount, selectedBillIdsThroughTarget, selectedBillsOutstandingAmount } from './payment-collection'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const contracts = ref<ContractSummary[]>([])
const bills = ref<RentBill[]>([])
const prepayments = ref({ balance: '0.00', items: [] as Record<string, unknown>[] })
const selectedBillIds = ref<number[]>([])
const proofFiles = ref<Array<{ id: number; originalName: string }>>([])
const loading = ref(false)
const submitting = ref(false)
const autoSuggestedPaymentAmount = ref('')
const contractLoadRequests = createLatestRequestGuard()
const form = reactive({ contractId: undefined as number | undefined, paymentDate: new Date().toISOString().slice(0, 10), amount: '', method: 'WECHAT' as PaymentMethod, externalReference: '', remark: '', manualAllocationReason: '' })
const adjustment = reactive({ enabled: false, rentBillId: undefined as number | undefined, adjustmentType: 'DISCOUNT' as 'DISCOUNT' | 'WAIVER', amount: '', reason: '' })
const isSuperAdmin = computed(() => session.user?.role === 'SUPER_ADMIN')
const selectedContract = computed(() => contracts.value.find((item) => item.id === form.contractId))
const summary = computed(() => allocationSummary(bills.value, selectedBillIds.value, adjustment.enabled ? adjustment.amount : 0, form.amount))
const manualAllocation = computed(() => !isPrefixSelection(bills.value, selectedBillIds.value))
const eligibleAdjustmentBills = computed(() => {
  const ids = new Set(eligibleAdjustmentBillIds(bills.value, selectedBillIds.value, form.amount, adjustment.amount))
  return bills.value.filter((bill) => ids.has(bill.id))
})

watch(
  [() => adjustment.enabled, () => adjustment.amount, () => selectedBillIds.value.join(',')],
  () => {
    if (!adjustment.enabled) return
    if (form.amount !== autoSuggestedPaymentAmount.value) return
    const nextAmount = nextSuggestedPaymentAmount(form.amount, autoSuggestedPaymentAmount.value, summary.value.effectiveOutstanding)
    form.amount = nextAmount
    autoSuggestedPaymentAmount.value = nextAmount
  },
)

watch(
  [() => adjustment.enabled, () => adjustment.amount, () => form.amount, () => selectedBillIds.value.join(',')],
  () => {
    if (!adjustment.enabled) return
    const allowed = eligibleAdjustmentBills.value
    if (!allowed.some((bill) => bill.id === adjustment.rentBillId))
      adjustment.rentBillId = allowed[0]?.id
  },
)
function money(value: number | string | undefined) { return `¥${Number(value ?? 0).toFixed(2)}` }
function roomLabel(contract: ContractSummary) { return contract.room?.fullHouseNo ? `${contract.contractNo} · ${contract.room.fullHouseNo}` : contract.contractNo }

function applySelectedBillsAmount(ids: number[]) {
  const original = selectedBillsOutstandingAmount(bills.value, ids)
  const adjustmentAmount = adjustment.enabled ? Math.max(0, Number(adjustment.amount) || 0) : 0
  const suggested = original ? Math.max(0, Number(original) - adjustmentAmount).toFixed(2) : ''
  form.amount = suggested
  autoSuggestedPaymentAmount.value = suggested
}

async function loadContracts() {
  contracts.value = await paymentApi.contracts()
  const requested = Number(route.query.contractId)
  if (requested > 0 && contracts.value.some((item) => item.id === requested)) { form.contractId = requested; await selectContract() }
}
function clearContractPaymentState() {
  bills.value = []
  prepayments.value = { balance: '0.00', items: [] }
  selectedBillIds.value = []
  adjustment.enabled = false
  adjustment.rentBillId = undefined
  adjustment.adjustmentType = 'DISCOUNT'
  adjustment.amount = ''
  adjustment.reason = ''
  form.amount = ''
  form.manualAllocationReason = ''
  autoSuggestedPaymentAmount.value = ''
}
async function selectContract(contractId = form.contractId) {
  const request = contractLoadRequests.next()
  clearContractPaymentState()
  if (!contractId) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const [billRows, prep] = await Promise.all([paymentApi.bills(contractId), paymentApi.prepayments(contractId)])
    if (!contractLoadRequests.isCurrent(request)) return
    bills.value = billRows.filter((bill) => !['VOIDED', 'REFUNDED'].includes(bill.status ?? '') && Number(bill.outstandingAmount) > 0).sort((a, b) => a.periodSeq - b.periodSeq)
    prepayments.value = prep
    selectedBillIds.value = selectedBillIdsThroughTarget(bills.value, Number(route.query.rentBillId))
    adjustment.rentBillId = bills.value[0]?.id
    applySelectedBillsAmount(selectedBillIds.value)
  } catch {
    if (contractLoadRequests.isCurrent(request)) ElMessage.error('合同账单加载失败，请稍后重试')
  } finally {
    if (contractLoadRequests.isCurrent(request)) loading.value = false
  }
}
function toggleBill(bill: RentBill, checked: boolean) {
  const current = [...selectedBillIds.value]
  if (checked) current.push(bill.id); else current.splice(current.indexOf(bill.id), 1)
  const unique = [...new Set(current)]
  if (!isSuperAdmin.value && !isPrefixSelection(bills.value, unique)) { ElMessage.warning('普通管理员只能从最早未结账期连续选择'); return }
  selectedBillIds.value = unique
  applySelectedBillsAmount(selectedBillIds.value)
}
async function uploadProof(options: UploadRequestOptions) {
  try {
    const result = await paymentApi.uploadProof(options.file)
    proofFiles.value.push(result); options.onSuccess(result); ElMessage.success('凭证上传成功')
  } catch (error) { ElMessage.error('凭证上传失败'); throw error }
}
async function submit() {
  if (!form.contractId || !form.amount || selectedBillIds.value.length === 0) return ElMessage.warning('请完整填写合同、金额并选择账期')
  if (Number(form.amount) <= 0) return ElMessage.warning('收款金额必须大于 0')
  if (manualAllocation.value && !form.manualAllocationReason.trim()) return ElMessage.warning('跳期分配必须填写人工分配原因')
  if (adjustment.enabled && (!adjustment.rentBillId || Number(adjustment.amount) <= 0 || !adjustment.reason.trim())) return ElMessage.warning('请完整填写优惠/减免信息')
  if (adjustment.enabled && !eligibleAdjustmentBills.value.some((bill) => bill.id === adjustment.rentBillId)) return ElMessage.warning('优惠/减免金额需不大于归属账期在本次收款后的未收金额')
  submitting.value = true
  try {
    const result = await paymentApi.record({
      contractId: form.contractId, paymentDate: form.paymentDate, amount: form.amount, method: form.method,
      selectedBillIds: selectedBillIds.value, externalReference: form.externalReference || undefined, remark: form.remark || undefined,
      manualAllocationReason: manualAllocation.value ? form.manualAllocationReason : undefined,
      proofFileIds: proofFiles.value.map((file) => file.id),
      adjustments: adjustment.enabled ? [{ rentBillId: adjustment.rentBillId!, adjustmentType: adjustment.adjustmentType, amount: adjustment.amount, reason: adjustment.reason }] : undefined,
    })
    ElMessage.success(`收款登记成功，票据号 ${result.receiptNo}`)
    await router.push(`/payments/detail/${result.id}`)
  } catch { ElMessage.error('收款登记失败，请核对账期、金额和凭证后重试') } finally { submitting.value = false }
}
onMounted(() => void loadContracts())
</script>

<template>
  <PaymentWorkspace title="收款登记" description="按账期核对应收、优惠和实收，登记完成后自动生成票据。">
    <el-alert title="金额口径：先确认原始应收，再扣减已确认优惠；超过账期实欠的金额计入预收款。" type="info" :closable="false" show-icon />
    <div class="collect-layout">
      <div class="collect-main">
        <el-card shadow="never">
          <template #header><div class="card-title"><span class="step">1</span><b>选择合同与收款信息</b></div></template>
          <el-form label-position="top">
            <el-row :gutter="16">
              <el-col :xs="24" :md="12"><el-form-item label="合同"><el-select v-model="form.contractId" filterable placeholder="合同编号 / 房号" style="width:100%" @change="selectContract"><el-option v-for="contract in contracts" :key="contract.id" :value="contract.id" :label="roomLabel(contract)" /></el-select></el-form-item></el-col>
              <el-col :xs="24" :md="12"><el-form-item label="收款日期"><el-date-picker v-model="form.paymentDate" type="date" value-format="YYYY-MM-DD" format="YYYY年MM月DD日" style="width:100%" /></el-form-item></el-col>
              <el-col :xs="24" :md="8"><el-form-item label="收款金额（元）"><el-input v-model="form.amount" inputmode="decimal" placeholder="0.00" /></el-form-item></el-col>
              <el-col :xs="24" :md="8"><el-form-item label="收款方式"><el-select v-model="form.method" style="width:100%"><el-option label="微信" value="WECHAT"/><el-option label="支付宝" value="ALIPAY"/><el-option label="银行转账" value="BANK_TRANSFER"/><el-option label="现金" value="CASH"/><el-option label="POS" value="POS"/><el-option label="其他" value="OTHER"/></el-select></el-form-item></el-col>
              <el-col :xs="24" :md="8"><el-form-item label="交易参考号（选填）"><el-input v-model="form.externalReference" /></el-form-item></el-col>
              <el-col :span="24"><el-form-item label="备注（选填）"><el-input v-model="form.remark" maxlength="500" show-word-limit /></el-form-item></el-col>
            </el-row>
          </el-form>
        </el-card>

        <el-card v-loading="loading" shadow="never">
          <template #header><div class="card-title"><span class="step">2</span><b>分配收款账期</b><small>普通管理员必须从最早未结账期连续选择</small></div></template>
          <el-empty v-if="!form.contractId" description="请先选择合同" />
          <el-empty v-else-if="!bills.length" description="该合同暂无未结账单" />
          <el-table v-else :data="bills" size="small">
            <el-table-column label="选择" width="62"><template #default="{ row }"><el-checkbox :model-value="selectedBillIds.includes(row.id)" @change="(checked: boolean) => toggleBill(row, checked)" /></template></el-table-column>
            <el-table-column prop="periodSeq" label="账期" width="72"><template #default="{ row }">第 {{ row.periodSeq }} 期</template></el-table-column>
            <el-table-column label="账期区间" min-width="180"><template #default="{ row }">{{ row.periodStart?.slice(0,10) }} 至 {{ row.periodEnd?.slice(0,10) }}</template></el-table-column>
            <el-table-column prop="dueDate" label="应缴日期" width="118"><template #default="{ row }">{{ row.dueDate?.slice(0,10) }}</template></el-table-column>
            <el-table-column label="应收" align="right"><template #default="{ row }">{{ money(row.payableAmount) }}</template></el-table-column>
            <el-table-column label="已收" align="right"><template #default="{ row }">{{ money(row.receivedAmount) }}</template></el-table-column>
            <el-table-column label="未收" align="right"><template #default="{ row }"><b class="danger">{{ money(row.outstandingAmount) }}</b></template></el-table-column>
          </el-table>
          <el-form v-if="isSuperAdmin && manualAllocation" label-position="top" class="manual-reason"><el-form-item label="人工分配原因（必填）"><el-input v-model="form.manualAllocationReason" maxlength="500" placeholder="说明为何跳过更早账期" /></el-form-item></el-form>
        </el-card>

        <el-card shadow="never">
          <template #header><div class="card-title"><span class="step">3</span><b>优惠、减免与凭证</b></div></template>
          <el-switch v-model="adjustment.enabled" active-text="本次同时提交优惠/减免申请" />
          <el-row v-if="adjustment.enabled" :gutter="16" class="adjustment-form">
            <el-col :xs="24" :md="8"><el-select v-model="adjustment.rentBillId" style="width:100%" placeholder="归属账期"><el-option v-for="bill in eligibleAdjustmentBills" :key="bill.id" :value="bill.id" :label="`第 ${bill.periodSeq} 期`" /></el-select></el-col>
            <el-col :xs="24" :md="6"><el-select v-model="adjustment.adjustmentType" style="width:100%"><el-option label="优惠" value="DISCOUNT"/><el-option label="减免" value="WAIVER"/></el-select></el-col>
            <el-col :xs="24" :md="5"><el-input v-model="adjustment.amount" placeholder="金额" /></el-col>
            <el-col :xs="24" :md="5"><el-input v-model="adjustment.reason" placeholder="原因（必填）" /></el-col>
          </el-row>
          <p v-if="adjustment.enabled" class="adjustment-tip">已按优惠后的应收金额自动更新本次实收；如需部分收款，可直接修改实收金额。</p>
          <el-upload :http-request="uploadProof" :show-file-list="false" accept="image/jpeg,image/png,image/webp"><el-button>上传收款凭证</el-button><template #tip><div class="el-upload__tip">支持 JPG、PNG、WebP；凭证会与本次收款永久关联。</div></template></el-upload>
          <div v-if="proofFiles.length" class="proof-list"><el-tag v-for="file in proofFiles" :key="file.id" closable @close="proofFiles = proofFiles.filter((item) => item.id !== file.id)">{{ file.originalName }}</el-tag></div>
        </el-card>
      </div>

      <aside class="summary-card">
        <div class="summary-contract"><small>当前合同</small><b>{{ selectedContract?.contractNo ?? '尚未选择' }}</b><span>{{ selectedContract?.room?.fullHouseNo ?? '—' }}</span></div>
        <dl><div><dt>所选账期原始未收</dt><dd>{{ money(summary.originalOutstanding) }}</dd></div><div><dt>本次优惠/减免</dt><dd class="discount">- {{ money(summary.adjustmentAmount) }}</dd></div><div><dt>有效应收</dt><dd>{{ money(summary.effectiveOutstanding) }}</dd></div><div class="primary"><dt>本次实收</dt><dd>{{ money(summary.paymentAmount) }}</dd></div><div><dt>预计转入预收款</dt><dd>{{ money(summary.prepaymentAmount) }}</dd></div><div><dt>现有预收款余额</dt><dd>{{ money(prepayments.balance) }}</dd></div></dl>
        <el-button type="primary" size="large" :loading="submitting" :disabled="session.user?.role === 'VISITOR'" style="width:100%" @click="submit">确认收款并生成票据</el-button>
        <p v-if="session.user?.role === 'VISITOR'" class="permission-tip">访客仅可查看，不可登记收款。</p>
      </aside>
    </div>
  </PaymentWorkspace>
</template>

<style scoped>
.collect-layout { display:grid; grid-template-columns:minmax(0,1fr) 310px; gap:18px; align-items:start; }.collect-main { display:grid; gap:16px; }.card-title { display:flex; align-items:center; gap:9px; color:#27364c; }.card-title small { margin-left:auto; color:#8a97a9; font-weight:400; }.step { display:grid; width:23px; height:23px; place-items:center; border-radius:7px; background:#e8f0ff; color:#246bfd; font-size:12px; font-weight:700; }.danger { color:#e05252; }.manual-reason,.adjustment-form { margin-top:16px; }.proof-list { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }.summary-card { position:sticky; top:88px; padding:22px; border:1px solid #e2e7ef; border-radius:12px; background:#fff; box-shadow:0 8px 25px rgba(34,51,84,.07); }.summary-contract { display:grid; gap:4px; padding-bottom:17px; border-bottom:1px solid #edf0f5; }.summary-contract small,dt { color:#8491a5; }.summary-contract b { margin-top:4px; color:#1f2d42; }.summary-contract span { color:#5b6980; font-size:13px; }dl { margin:10px 0 20px; }dl div { display:flex; justify-content:space-between; padding:10px 0; }dt { font-size:13px; }dd { margin:0; color:#314058; font-weight:600; }.discount { color:#2f9e65; }.primary { margin:4px -10px; padding:13px 10px!important; border-radius:8px; background:#eef4ff; }.primary dd { color:#246bfd; font-size:20px; }.permission-tip { color:#d46b4c; font-size:12px; text-align:center; }
.adjustment-tip { margin:10px 0 0; color:#4f6380; font-size:12px; }
@media (max-width:1050px) { .collect-layout { grid-template-columns:1fr; }.summary-card { position:static; } }
</style>
