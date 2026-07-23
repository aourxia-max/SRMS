<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useSessionStore } from '../stores/session'
import { http } from '../services/http'

type Concession = {
  concessionType: 'RENT_FREE' | 'FIXED_AMOUNT' | 'PERCENTAGE'
  applyMode: 'DATE_RANGE' | 'BILLING_PERIODS'
  startDate: string
  endDate: string
  fixedAmount: string
  discountRate: string
  billingPeriodCount?: number
  reason: string
}

const session = useSessionStore()
const contracts = ref<any[]>([])
const changes = ref<any[]>([])
const selectedContractId = ref<number>()
const currentConcessions = ref<Concession[]>([])
const isSuperAdmin = computed(() => session.user?.role === 'SUPER_ADMIN')
const form = reactive({
  changeType: 'RENT', effectiveDate: '', monthlyRent: '', endDate: '',
  primaryTenantId: undefined as number | undefined, reason: '',
})

async function loadContracts() { contracts.value = (await http.get('/contracts')).data.data }
async function loadChanges() {
  if (!selectedContractId.value) return
  changes.value = (await http.get(`/contracts/${selectedContractId.value}/changes`)).data.data
}
async function selectContract() {
  if (!selectedContractId.value) return
  const contract = (await http.get(`/contracts/${selectedContractId.value}`)).data.data
  currentConcessions.value = contract.concessions.map((item: any) => ({
    concessionType: item.concessionType, applyMode: item.applyMode,
    startDate: item.startDate?.slice(0, 10) ?? '', endDate: item.endDate?.slice(0, 10) ?? '',
    fixedAmount: item.fixedAmount ?? '', discountRate: item.discountRate ?? '',
    billingPeriodCount: item.billingPeriodCount ?? undefined, reason: item.reason,
  }))
  await loadChanges()
}
function changeConcessionType(item: Concession) { item.applyMode = item.concessionType === 'RENT_FREE' ? 'DATE_RANGE' : 'BILLING_PERIODS' }
function addConcession() { currentConcessions.value.push({ concessionType: 'RENT_FREE', applyMode: 'DATE_RANGE', startDate: '', endDate: '', fixedAmount: '', discountRate: '', reason: '' }) }
function removeConcession(index: number) { currentConcessions.value.splice(index, 1) }
function concessionsValid() {
  return currentConcessions.value.every((item) => item.reason && (item.applyMode === 'DATE_RANGE'
    ? item.startDate && item.endDate && item.endDate >= item.startDate
    : Number(item.billingPeriodCount) > 0) && (item.concessionType !== 'FIXED_AMOUNT' || Number(item.fixedAmount) >= 0) && (item.concessionType !== 'PERCENTAGE' || Number(item.discountRate) >= 0 && Number(item.discountRate) <= 1))
}
function afterSnapshot() {
  if (form.changeType === 'RENT') return { monthlyRent: form.monthlyRent }
  if (form.changeType === 'TERM') return { endDate: form.endDate }
  if (form.changeType === 'PRIMARY_TENANT') return { primaryTenantId: form.primaryTenantId }
  return { concessions: currentConcessions.value }
}
async function submit() {
  if (!selectedContractId.value || !form.effectiveDate || !form.reason) return alert('请选择合同，并填写生效日期和原因')
  if (form.changeType === 'CONCESSION' && !concessionsValid()) return alert('请完整填写每条优惠规则')
  await http.post(`/contracts/${selectedContractId.value}/changes`, { changeType: form.changeType, effectiveDate: form.effectiveDate, afterSnapshot: afterSnapshot(), reason: form.reason })
  await loadChanges()
  alert('变更已提交，等待超级管理员确认')
}
async function approve(id: number) { await http.post(`/contracts/changes/${id}/approve`); await loadChanges() }
async function reject(id: number) { const reason = window.prompt('请输入驳回原因'); if (reason) { await http.post(`/contracts/changes/${id}/reject`, { reason }); await loadChanges() } }
onMounted(loadContracts)
</script>

<template>
  <main class="users-page">
    <header><div><el-tag>Task006</el-tag><h1>合同变更</h1><p>已收款账单金额锁定；变更只会重算生效账期起未收款的账单。</p></div></header>
    <el-card header="提交合同变更"><el-form label-position="top"><el-row :gutter="16"><el-col :span="8"><el-form-item label="合同"><el-select v-model="selectedContractId" @change="selectContract"><el-option v-for="contract in contracts" :key="contract.id" :label="contract.contractNo" :value="contract.id" /></el-select></el-form-item></el-col><el-col :span="8"><el-form-item label="变更类型"><el-select v-model="form.changeType"><el-option label="租金变更" value="RENT" /><el-option label="租期变更" value="TERM" /><el-option label="主承租人变更" value="PRIMARY_TENANT" /><el-option label="优惠变更" value="CONCESSION" /></el-select></el-form-item></el-col><el-col :span="8"><el-form-item label="生效日期（须为账期开始日）"><el-date-picker v-model="form.effectiveDate" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col><el-col v-if="form.changeType === 'RENT'" :span="8"><el-form-item label="新月租（元）"><el-input v-model="form.monthlyRent" /></el-form-item></el-col><el-col v-if="form.changeType === 'TERM'" :span="8"><el-form-item label="新结束日期"><el-date-picker v-model="form.endDate" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col><el-col v-if="form.changeType === 'PRIMARY_TENANT'" :span="8"><el-form-item label="新主承租人 ID"><el-input-number v-model="form.primaryTenantId" :min="1" /></el-form-item></el-col><el-col :span="24"><el-form-item label="变更原因"><el-input v-model="form.reason" type="textarea" /></el-form-item></el-col></el-row></el-form>
      <template v-if="form.changeType === 'CONCESSION'"><el-divider>完整优惠规则列表</el-divider><p>这里展示当前有效规则。可修改、删除或新增；提交后会替换该合同的有效优惠规则。</p><el-button size="small" @click="addConcession">新增优惠规则</el-button><el-table :data="currentConcessions"><el-table-column label="类型"><template #default="{ row }"><el-select v-model="row.concessionType" @change="changeConcessionType(row)"><el-option label="日期区间免租" value="RENT_FREE" /><el-option label="固定金额" value="FIXED_AMOUNT" /><el-option label="比例优惠" value="PERCENTAGE" /></el-select></template></el-table-column><el-table-column label="适用范围"><template #default="{ row }"><template v-if="row.applyMode === 'DATE_RANGE'"><el-date-picker v-model="row.startDate" value-format="YYYY-MM-DD" type="date" /><el-date-picker v-model="row.endDate" value-format="YYYY-MM-DD" type="date" /></template><el-input-number v-else v-model="row.billingPeriodCount" :min="1" /></template></el-table-column><el-table-column label="金额/比例"><template #default="{ row }"><el-input v-if="row.concessionType === 'FIXED_AMOUNT'" v-model="row.fixedAmount" /><el-input v-else-if="row.concessionType === 'PERCENTAGE'" v-model="row.discountRate" placeholder="0.1 表示九折" /><span v-else>按重叠天数计算</span></template></el-table-column><el-table-column label="原因"><template #default="{ row }"><el-input v-model="row.reason" /></template></el-table-column><el-table-column label="操作"><template #default="{ $index }"><el-button size="small" @click="removeConcession($index)">删除</el-button></template></el-table-column></el-table></template>
      <el-button style="margin-top: 16px" type="primary" @click="submit">提交变更</el-button>
    </el-card>
    <el-card header="变更记录" style="margin-top: 16px"><el-empty v-if="!selectedContractId" description="请先选择合同" /><el-table v-else :data="changes"><el-table-column prop="changeNo" label="变更编号" /><el-table-column prop="changeType" label="类型" /><el-table-column prop="effectiveDate" label="生效日期" /><el-table-column prop="reason" label="原因" /><el-table-column prop="approvalStatus" label="状态" /><el-table-column v-if="isSuperAdmin" label="审批"><template #default="{ row }"><el-button v-if="row.approvalStatus === 'PENDING'" size="small" type="primary" @click="approve(row.id)">确认</el-button><el-button v-if="row.approvalStatus === 'PENDING'" size="small" type="danger" @click="reject(row.id)">驳回</el-button></template></el-table-column></el-table></el-card>
  </main>
</template>
