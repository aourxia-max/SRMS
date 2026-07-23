<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const contracts = ref<any[]>([])
const bills = ref<any[]>([])
const preview = ref<any>({ completeMonths: 0, tiers: [] })
const rebates = ref<any[]>([])
const proofFileIds = ref<number[]>([])
const form = reactive({
  contractId: undefined as number | undefined,
  sourceType: 'TIER_MILESTONE', rebateType: 'MILESTONE', pricingTierId: undefined as number | undefined,
  rentBillId: undefined as number | undefined, parentRebateId: undefined as number | undefined,
  periodStart: '', periodEnd: '', actualAmount: '', settlementMethod: 'ACTUAL_REFUND',
  refundDate: new Date().toISOString().slice(0, 10), refundMethod: 'WECHAT', differenceReason: '', remark: '',
})
const isSuperAdmin = computed(() => session.user?.role === 'SUPER_ADMIN')
const selectedContract = computed(() => contracts.value.find((item) => item.id === form.contractId))

async function loadContracts() { contracts.value = (await http.get('/contracts')).data.data }
async function selectContract() {
  bills.value = []; rebates.value = []; preview.value = { completeMonths: 0, tiers: [] }
  form.pricingTierId = undefined; form.rentBillId = undefined; form.parentRebateId = undefined
  if (!form.contractId) return
  const [billResult, previewResult, rebateResult] = await Promise.all([
    http.get(`/contracts/${form.contractId}/bills`), http.get(`/pricing-rebates/preview/${form.contractId}`), http.get('/pricing-rebates', { params: { contractId: form.contractId } }),
  ])
  bills.value = billResult.data.data
  preview.value = previewResult.data.data
  rebates.value = rebateResult.data.data
}
function chooseTier(tier: any) {
  form.sourceType = 'TIER_MILESTONE'; form.rebateType = 'MILESTONE'; form.pricingTierId = tier.id
  form.periodStart = selectedContract.value?.startDate?.slice(0, 10) ?? ''
  form.periodEnd = tier.qualificationDate?.slice(0, 10) ?? ''
  form.actualAmount = Number(tier.referenceAmount).toFixed(2)
  form.differenceReason = ''
}
async function uploadProof(file: any) {
  const data = new FormData(); data.append('file', file.file)
  const result = await http.post('/pricing-rebates/proof-files', data)
  proofFileIds.value.push(result.data.data.id)
  return false
}
async function submit() {
  if (!form.contractId || !form.periodStart || !form.periodEnd || form.actualAmount === '') return alert('请完整填写合同、退差期间和实际退差金额')
  if (form.sourceType === 'TIER_MILESTONE' && !form.pricingTierId) return alert('请选择已达标的阶梯档位')
  if (form.sourceType === 'FIXED_RENT_MANUAL' && !form.rentBillId) return alert('固定租金手工退差必须关联一笔有效租金账单')
  const payload: any = { ...form, proofFileIds: proofFileIds.value }
  if (payload.sourceType === 'FIXED_RENT_MANUAL' && payload.rebateType === 'MILESTONE') payload.rebateType = 'MANUAL'
  if (form.settlementMethod === 'PREPAYMENT_CREDIT') { delete payload.refundDate; delete payload.refundMethod; delete payload.proofFileIds }
  await http.post('/pricing-rebates', payload)
  proofFileIds.value = []; form.actualAmount = ''; form.differenceReason = ''; form.remark = ''
  await selectContract(); alert('退差单已提交，等待超级管理员确认')
}
async function approve(id: number) { await http.post(`/pricing-rebates/${id}/approve`); await selectContract() }
async function reject(id: number) { const reason = window.prompt('请输入驳回原因'); if (reason) { await http.post(`/pricing-rebates/${id}/reject`, { reason }); await selectContract() } }
onMounted(loadContracts)
</script>

<template>
  <main class="users-page">
    <header><div><el-tag>Task009</el-tag><h1>租金退差</h1><p>退差单独立留痕，不修改原账单或原收款；实际退款须上传凭证，转预收款将在确认后生成预收款流水。</p></div></header>
    <el-card header="选择合同与达档预览">
      <el-form label-position="top"><el-row :gutter="16"><el-col :span="8"><el-form-item label="合同"><el-select v-model="form.contractId" filterable @change="selectContract"><el-option v-for="contract in contracts" :key="contract.id" :label="`${contract.contractNo}（${contract.pricingMode}）`" :value="contract.id" /></el-select></el-form-item></el-col></el-row></el-form>
      <el-alert v-if="form.contractId" :title="`已完成整月：${preview.completeMonths} 个月。requiresFullyPaid 为“是”的档位，只有本阶段账单全部 PAID 才达标。`" type="info" :closable="false" />
      <el-table v-if="form.contractId && selectedContract?.pricingMode === 'TIERED_RETROACTIVE'" :data="preview.tiers" style="margin-top: 16px"><el-table-column prop="tierName" label="档位" /><el-table-column prop="thresholdMonths" label="门槛（月）" /><el-table-column prop="requiresFullyPaid" label="须全部付清"><template #default="{ row }">{{ row.requiresFullyPaid ? '是' : '否' }}</template></el-table-column><el-table-column prop="grossBilledAmount" label="阶段原始租金" /><el-table-column prop="targetNetRentAmount" label="目标净租金" /><el-table-column prop="previousRebateAmount" label="已确认退差" /><el-table-column prop="referenceAmount" label="系统参考额" /><el-table-column label="状态"><template #default="{ row }"><el-tag :type="row.qualified ? 'success' : 'info'">{{ row.qualified ? '已达标' : '未达标' }}</el-tag></template></el-table-column><el-table-column label="操作"><template #default="{ row }"><el-button v-if="row.qualified" size="small" type="primary" @click="chooseTier(row)">用于退差单</el-button></template></el-table-column></el-table>
    </el-card>
    <el-card header="提交退差单" style="margin-top: 16px">
      <el-alert title="实际退差金额与系统参考额不同必须说明原因；固定租金采用手工退差，无系统参考额；补充退差不会覆盖原退差单。" type="warning" :closable="false" />
      <el-form label-position="top" style="margin-top: 16px"><el-row :gutter="16"><el-col :span="8"><el-form-item label="来源"><el-select v-model="form.sourceType"><el-option label="阶梯达档退差" value="TIER_MILESTONE" /><el-option label="固定租金手工退差" value="FIXED_RENT_MANUAL" /></el-select></el-form-item></el-col><el-col :span="8"><el-form-item label="退差类型"><el-select v-model="form.rebateType"><el-option label="达档退差" value="MILESTONE" /><el-option label="手工退差" value="MANUAL" /><el-option label="补充退差" value="SUPPLEMENT" /></el-select></el-form-item></el-col><el-col v-if="form.sourceType === 'TIER_MILESTONE'" :span="8"><el-form-item label="达档"><el-select v-model="form.pricingTierId"><el-option v-for="tier in preview.tiers.filter((item: any) => item.qualified)" :key="tier.id" :label="tier.tierName" :value="tier.id" /></el-select></el-form-item></el-col><el-col v-else :span="8"><el-form-item label="关联租金账单"><el-select v-model="form.rentBillId"><el-option v-for="bill in bills.filter((item: any) => !['VOIDED', 'REFUNDED'].includes(item.status))" :key="bill.id" :label="`第 ${bill.periodSeq} 期：${bill.periodStart} 至 ${bill.periodEnd}`" :value="bill.id" /></el-select></el-form-item></el-col><el-col :span="8"><el-form-item label="退差开始日"><el-date-picker v-model="form.periodStart" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col><el-col :span="8"><el-form-item label="退差结束日"><el-date-picker v-model="form.periodEnd" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col><el-col :span="8"><el-form-item label="实际退差金额（元）"><el-input v-model="form.actualAmount" /></el-form-item></el-col><el-col :span="8"><el-form-item label="结算方式"><el-select v-model="form.settlementMethod"><el-option label="实际退款" value="ACTUAL_REFUND" /><el-option label="转入预收款" value="PREPAYMENT_CREDIT" /></el-select></el-form-item></el-col><el-col v-if="form.settlementMethod === 'ACTUAL_REFUND'" :span="8"><el-form-item label="退款日期"><el-date-picker v-model="form.refundDate" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col><el-col v-if="form.settlementMethod === 'ACTUAL_REFUND'" :span="8"><el-form-item label="退款方式"><el-select v-model="form.refundMethod"><el-option label="微信" value="WECHAT" /><el-option label="支付宝" value="ALIPAY" /><el-option label="银行转账" value="BANK_TRANSFER" /><el-option label="现金" value="CASH" /><el-option label="其他" value="OTHER" /></el-select></el-form-item></el-col><el-col :span="24"><el-form-item label="差异原因（与系统参考额不同时必填）"><el-input v-model="form.differenceReason" /></el-form-item></el-col><el-col :span="24"><el-form-item label="备注"><el-input v-model="form.remark" type="textarea" /></el-form-item></el-col></el-row></el-form>
      <div v-if="form.settlementMethod === 'ACTUAL_REFUND'"><el-upload :auto-upload="false" :show-file-list="false" :on-change="uploadProof"><el-button>上传退款凭证</el-button></el-upload><span style="margin-left: 12px">已上传 {{ proofFileIds.length }} 份凭证</span></div>
      <el-button type="primary" style="margin-top: 16px" @click="submit">提交退差单</el-button>
    </el-card>
    <el-card header="退差记录" style="margin-top: 16px"><el-table :data="rebates"><el-table-column prop="rebateNo" label="退差编号" /><el-table-column prop="sourceType" label="来源" /><el-table-column prop="referenceAmount" label="系统参考额" /><el-table-column prop="actualAmount" label="实际退差" /><el-table-column prop="settlementMethod" label="结算方式" /><el-table-column prop="approvalStatus" label="状态" /><el-table-column prop="differenceReason" label="差异原因" /><el-table-column v-if="isSuperAdmin" label="审批"><template #default="{ row }"><el-button v-if="row.approvalStatus === 'PENDING'" size="small" type="primary" @click="approve(row.id)">确认</el-button><el-button v-if="row.approvalStatus === 'PENDING'" size="small" type="danger" @click="reject(row.id)">驳回</el-button></template></el-table-column></el-table></el-card>
  </main>
</template>
