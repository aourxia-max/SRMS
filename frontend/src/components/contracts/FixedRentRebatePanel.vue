<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, type UploadFile } from 'element-plus'
import {
  buildFixedRentRebatePayload,
  filterFixedRentRebateContracts,
  fixedRentRebateContractLabel,
  isFixedRentRebateEligible,
  uploadPricingRebateProof,
} from '../../services/contracts'
import type { ContractDetail, ContractListItem, ContractRole, PricingRebate, RentBill } from '../../types/contracts'

const props = withDefaults(defineProps<{
  contract?: ContractDetail | null
  bills?: RentBill[]
  rebates?: PricingRebate[]
  contracts?: ContractListItem[]
  role: ContractRole
  saving?: boolean
}>(), { contract: null, bills: () => [], rebates: () => [], contracts: () => [], saving: false })

const emit = defineEmits<{
  back: []
  submit: [payload: Record<string, unknown>]
  approve: [id: number]
  reject: [id: number]
  'select-contract': [id: number]
}>()

const proofUploading = ref(false)
const contractKeyword = ref('')
const searchContractId = ref<number | null>(null)
const form = reactive({
  rentBillId: null as number | null,
  periodStart: '', periodEnd: '', actualAmount: '', differenceReason: '',
  settlementMethod: 'ACTUAL_REFUND' as 'ACTUAL_REFUND' | 'PREPAYMENT_CREDIT',
  refundDate: '', refundMethod: 'WECHAT', remark: '', proofFileIds: [] as number[],
})

const eligibleContracts = computed(() => filterFixedRentRebateContracts(props.contracts, contractKeyword.value))
const eligibleContract = computed(() => isFixedRentRebateEligible(props.contract) ? props.contract : null)
const selectedBill = computed(() => props.bills.find((item) => item.id === form.rentBillId))
const eligibleBills = computed(() => props.bills.filter((item) => !['VOIDED', 'REFUNDED'].includes(item.status || '')))
const canSubmit = computed(() => Boolean(
  eligibleContract.value && form.rentBillId && form.periodStart && form.periodEnd &&
  form.periodEnd >= form.periodStart && form.actualAmount && Number(form.actualAmount) >= 0 && form.differenceReason.trim() &&
  (form.settlementMethod === 'PREPAYMENT_CREDIT' || (form.refundDate && form.refundMethod && form.proofFileIds.length)),
))
const money = (value?: string | null) => value ? `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '—'

watch(() => props.contract?.id, (id) => {
  searchContractId.value = id ?? null
}, { immediate: true })

function setContractKeyword(value: string) {
  contractKeyword.value = value
}

function selectSearchContract(id?: number) {
  if (id) emit('select-contract', id)
}

function applyBill() {
  if (!selectedBill.value) return
  form.periodStart = String(selectedBill.value.periodStart).slice(0, 10)
  form.periodEnd = String(selectedBill.value.periodEnd).slice(0, 10)
}

async function uploadProof(file: UploadFile) {
  if (!file.raw) return
  proofUploading.value = true
  try {
    const asset = await uploadPricingRebateProof(file.raw)
    if (!form.proofFileIds.includes(asset.id)) form.proofFileIds.push(asset.id)
    ElMessage.success('退款凭证“' + asset.originalName + '”上传成功')
  } catch {
    ElMessage.error('退款凭证上传失败，可单独重试')
  } finally {
    proofUploading.value = false
  }
}

function submit() {
  const contract = eligibleContract.value
  if (!contract || !canSubmit.value) {
    ElMessage.warning('请完整填写退差金额、原因、处理信息和退款凭证')
    return
  }
  emit('submit', buildFixedRentRebatePayload(contract, {
    rentBillId: form.rentBillId,
    periodStart: form.periodStart,
    periodEnd: form.periodEnd,
    actualAmount: form.actualAmount,
    differenceReason: form.differenceReason,
    settlementMethod: form.settlementMethod,
    ...(form.settlementMethod === 'ACTUAL_REFUND' ? {
      refundDate: form.refundDate,
      refundMethod: form.refundMethod,
      proofFileIds: form.proofFileIds,
    } : {}),
    ...(form.remark ? { remark: form.remark } : {}),
  }))
}
</script>

<template>
  <section>
    <div class="contract-search-card">
      <span>搜索可退差合同</span>
      <el-select
        v-model="searchContractId"
        data-test="fixed-rebate-contract-search"
        filterable
        clearable
        :filter-method="setContractKeyword"
        placeholder="搜索合同编号、楼栋房号或租户姓名"
        no-match-text="未找到符合退差条件的合同"
        @change="selectSearchContract"
      >
        <el-option
          v-for="item in eligibleContracts"
          :key="item.id"
          :value="item.id"
          :label="fixedRentRebateContractLabel(item)"
        />
      </el-select>
    </div>
    <el-empty v-if="!eligibleContract" description="请选择履行中的固定月租合同">
      <el-button type="primary" @click="emit('back')">返回合同列表</el-button>
    </el-empty>
    <template v-else>
      <header class="page-head"><div><h1>固定月租合同退差</h1><p>{{ eligibleContract.contractNo }}｜{{ eligibleContract.room?.fullHouseNo || `房源${eligibleContract.roomId}` }}</p></div><el-tag type="warning" effect="light">管理员提交 · 超级管理员确认</el-tag></header>
      <div class="rebate-grid">
        <div>
          <section class="contract-card">
            <header class="card-head"><h2>退差核验</h2><el-tag type="success">合同履行中</el-tag></header>
            <div class="checks"><span>✓ 仅适用于固定月租合同</span><span>✓ 必须关联有效租金账单</span><span>✓ 实际金额由管理员按真实协商填写</span></div>
          </section>
          <section class="contract-card">
            <header class="card-head"><div><h2>金额与原因</h2><span>固定月租不自动计算参考退差</span></div></header>
            <el-form class="rebate-form" label-position="top">
              <div class="form-grid">
                <el-form-item required label="关联租金账单">
                  <el-select v-model="form.rentBillId" filterable placeholder="请选择有效账单" @change="applyBill">
                    <el-option v-for="bill in eligibleBills" :key="bill.id" :value="bill.id" :label="`${bill.billNo || `${bill.periodSeq}期`}｜${String(bill.periodStart).slice(0, 10)}｜${money(bill.payableAmount)}`" />
                  </el-select>
                </el-form-item>
                <el-form-item required label="实际退差金额（元）"><el-input v-model="form.actualAmount" inputmode="decimal" placeholder="0.00" /></el-form-item>
                <el-form-item required label="适用开始日期"><el-date-picker v-model="form.periodStart" type="date" format="YYYY年MM月DD日" value-format="YYYY-MM-DD" /></el-form-item>
                <el-form-item required label="适用结束日期"><el-date-picker v-model="form.periodEnd" type="date" format="YYYY年MM月DD日" value-format="YYYY-MM-DD" /></el-form-item>
              </div>
              <el-form-item required label="退差原因"><el-input v-model="form.differenceReason" type="textarea" :rows="3" maxlength="500" placeholder="请填写真实协商原因" /></el-form-item>
            </el-form>
          </section>
          <section class="contract-card">
            <header class="card-head"><h2>退差处理</h2></header>
            <div class="card-body">
              <el-radio-group v-model="form.settlementMethod">
                <el-radio-button value="ACTUAL_REFUND">实际退款</el-radio-button><el-radio-button value="PREPAYMENT_CREDIT">转为预收款</el-radio-button>
              </el-radio-group>
              <div v-if="form.settlementMethod === 'ACTUAL_REFUND'" class="form-grid refund-fields">
                <el-form-item required label="退款日期"><el-date-picker v-model="form.refundDate" type="date" format="YYYY年MM月DD日" value-format="YYYY-MM-DD" /></el-form-item>
                <el-form-item required label="退款方式"><el-select v-model="form.refundMethod"><el-option label="微信" value="WECHAT" /><el-option label="支付宝" value="ALIPAY" /><el-option label="银行转账" value="BANK_TRANSFER" /><el-option label="现金" value="CASH" /></el-select></el-form-item>
              </div>
              <el-form-item v-if="form.settlementMethod === 'ACTUAL_REFUND'" required label="退款凭证">
                <el-upload :auto-upload="false" :show-file-list="false" accept=".png,.jpg,.jpeg,.webp" :on-change="uploadProof">
                  <el-button :loading="proofUploading">上传退款凭证</el-button>
                </el-upload>
                <span v-if="form.proofFileIds.length" class="proof-count">已上传 {{ form.proofFileIds.length }} 个凭证</span>
              </el-form-item>
              <el-form-item label="备注"><el-input v-model="form.remark" placeholder="选填" /></el-form-item>
              <div class="submit-row"><el-button @click="emit('back')">返回列表</el-button><el-button type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">提交退差申请</el-button></div>
            </div>
          </section>
        </div>
        <aside>
          <section class="contract-card"><header class="card-head"><h2>本次退差摘要</h2></header><div class="summary-list"><div><span>计价方式</span><b>固定月租</b></div><div><span>系统参考退差</span><b>—</b></div><div><span>实际退差</span><b class="money-blue">{{ money(form.actualAmount) }}</b></div><div><span>处理方式</span><b>{{ form.settlementMethod === 'ACTUAL_REFUND' ? '实际退款' : '转为预收款' }}</b></div></div></section>
          <section class="contract-card"><header class="card-head"><h2>退差记录</h2></header><div class="rebate-list"><el-empty v-if="!rebates.length" :image-size="52" description="暂无退差记录" /><div v-for="item in rebates" :key="item.id" class="rebate-item"><div><b>{{ item.rebateNo }}</b><span>{{ money(item.actualAmount) }}</span></div><small>{{ item.approvalStatus }}</small><div v-if="role === 'SUPER_ADMIN' && item.approvalStatus === 'PENDING'" class="review-actions"><el-button type="danger" link @click="emit('reject', item.id)">驳回</el-button><el-button type="primary" link @click="emit('approve', item.id)">确认</el-button></div></div></div></section>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.contract-search-card { display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: center; gap: 14px; margin-bottom: 16px; padding: 16px 18px; background: #fff; border: 1px solid #e7ecf3; border-radius: 12px; }
.contract-search-card > span { color: #344054; font-weight: 600; }
.contract-search-card :deep(.el-select) { width: 100%; }
@media (max-width: 760px) { .contract-search-card { grid-template-columns: 1fr; } }
.page-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 16px; }.page-head h1 { margin: 0 0 5px; font-size: 22px; }.page-head p { margin: 0; color: #748196; }
.rebate-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 15px; }.contract-card { margin-bottom: 15px; overflow: hidden; background: #fff; border: 1px solid #e7ecf3; border-radius: 12px; box-shadow: 0 10px 28px rgb(28 52 84 / 7%); }.card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 17px; border-bottom: 1px solid #edf1f5; }.card-head h2 { margin: 0; font-size: 16px; }.card-head span { color: #748196; font-size: 12px; }.card-body, .rebate-form { padding: 17px; }.checks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 17px; }.checks span { padding: 10px; color: #18825a; background: #e8f7f0; border-radius: 8px; }.form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 14px; }.rebate-form :deep(.el-select), .rebate-form :deep(.el-date-editor), .card-body :deep(.el-select), .card-body :deep(.el-date-editor) { width: 100%; }.refund-fields { margin-top: 16px; }.submit-row { display: flex; justify-content: flex-end; gap: 8px; }.summary-list, .rebate-list { display: grid; gap: 12px; padding: 17px; }.summary-list > div { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 1px dashed #e2e7ee; }.summary-list span { color: #748196; }.money-blue { color: #246bfd; }.rebate-item { padding: 10px; border: 1px solid #e7ecf3; border-radius: 8px; }.rebate-item > div:first-child { display: flex; justify-content: space-between; }.rebate-item small { color: #748196; }.review-actions { display: flex; justify-content: flex-end; }
</style>
