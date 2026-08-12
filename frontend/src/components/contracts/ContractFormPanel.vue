<script setup lang="ts">
import type { FormInstance, FormRules, UploadFile } from 'element-plus'
import { reactive, ref, watch } from 'vue'
import { contractConcessionError, normalizeConcessionType, toContractPayload } from '../../services/contracts'
import { roomStatusLabel } from '../../utils/status-labels'
import type {
  ContractFormModel,
  ContractPayload,
  ContractRole,
  ContractRoom,
  ContractTenant,
} from '../../types/contracts'

const props = withDefaults(defineProps<{
  modelValue: ContractFormModel
  role: ContractRole
  rooms: ContractRoom[]
  tenants: ContractTenant[]
  saving?: boolean
}>(), { saving: false })

const emit = defineEmits<{
  'update:modelValue': [value: ContractFormModel]
  'save-draft': [payload: ContractPayload]
  confirm: [payload: ContractPayload]
  cancel: []
  'upload-file': [file: File]
}>()

const copyForm = (source: ContractFormModel): ContractFormModel => ({
  ...source,
  secondaryTenantIds: [...source.secondaryTenantIds],
  concessions: source.concessions.map((item) => ({ ...item })),
  fileAssetIds: [...source.fileAssetIds],
  commission: source.commission ? { ...source.commission } : { recipientName: '', amount: '' },
})

const contractFormSnapshot = (source: ContractFormModel) => JSON.stringify(copyForm(source))

const form = reactive(copyForm(props.modelValue))
const formRef = ref<FormInstance>()
const concessionError = ref('')

let lastSynchronizedSnapshot = contractFormSnapshot(form)

watch(() => props.modelValue, (next) => {
  const nextForm = copyForm(next)
  const nextSnapshot = contractFormSnapshot(nextForm)
  const currentSnapshot = contractFormSnapshot(form)
  lastSynchronizedSnapshot = nextSnapshot
  if (nextSnapshot !== currentSnapshot) Object.assign(form, nextForm)
}, { deep: true })

watch(form, () => {
  const nextForm = copyForm(form)
  const nextSnapshot = contractFormSnapshot(nextForm)
  if (nextSnapshot === lastSynchronizedSnapshot) return
  lastSynchronizedSnapshot = nextSnapshot
  emit('update:modelValue', nextForm)
}, { deep: true })

const nonNegativeMoney = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) callback(new Error('请输入不小于0的金额'))
  else callback()
}

const endDateValidator = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) callback(new Error('请选择合同结束日期'))
  else if (form.startDate && value < form.startDate) callback(new Error('结束日期不能早于开始日期'))
  else callback()
}

const plannedMoveInValidator = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (value && form.startDate && value < form.startDate) callback(new Error('计划入住日期不能早于合同开始日期'))
  else if (value && form.endDate && value > form.endDate) callback(new Error('计划入住日期不能晚于合同结束日期'))
  else callback()
}

const rules: FormRules<ContractFormModel> = {
  roomId: [{ required: true, message: '请选择房源', trigger: 'change' }],
  primaryTenantId: [{ required: true, message: '请选择主承租人', trigger: 'change' }],
  startDate: [{ required: true, message: '请选择合同开始日期', trigger: 'change' }],
  endDate: [{ required: true, validator: endDateValidator, trigger: 'change' }],
  plannedMoveInDate: [{ validator: plannedMoveInValidator, trigger: 'change' }],
  monthlyRent: [{ required: true, validator: nonNegativeMoney, trigger: 'blur' }],
  depositRequired: [{ required: true, validator: nonNegativeMoney, trigger: 'blur' }],
  paymentCycleMonths: [{ required: true, message: '请选择租缴周期', trigger: 'change' }],
}

function addConcession() {
  form.concessions.push({
    concessionType: 'RENT_FREE',
    applyMode: 'DATE_RANGE',
    startDate: '',
    endDate: '',
    reason: '',
  })
}

function changeConcession(item: ContractFormModel['concessions'][number]) {
  const normalized = normalizeConcessionType(item, item.concessionType)
  Object.assign(item, {
    startDate: undefined, endDate: undefined, billingPeriodCount: undefined,
    fixedAmount: undefined, discountRate: undefined,
  }, normalized)
  concessionError.value = ''
}

function removeConcession(index: number) {
  form.concessions.splice(index, 1)
}

function saveDraft() {
  emit('save-draft', toContractPayload(copyForm(form), props.role))
}

async function confirm() {
  if (!formRef.value) return
  concessionError.value = contractConcessionError(form.concessions) || ''
  if (concessionError.value) return
  try {
    await formRef.value.validate()
    emit('confirm', toContractPayload(copyForm(form), props.role))
  } catch {
    const firstInvalid = document.querySelector('.contract-form .is-error')
    firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function handleUpload(file: UploadFile) {
  if (file.raw) emit('upload-file', file.raw)
}
</script>

<template>
  <section class="form-panel">
    <header class="page-head">
      <div>
        <h1>新增合同</h1>
        <p>录入固定月租合同、承租人和履行约定</p>
      </div>
      <div class="head-actions">
        <el-button @click="emit('cancel')">取消</el-button>
        <el-button data-test="save-draft" :loading="saving" @click="saveDraft">保存草稿</el-button>
        <el-button data-test="confirm-contract" type="primary" :loading="saving" @click="confirm">确认并生成账单</el-button>
      </div>
    </header>

    <el-form ref="formRef" class="contract-form" :model="form" :rules="rules" label-position="top" status-icon>
      <section class="contract-card">
        <header class="card-head">
          <h2>基本信息</h2>
          <span>合同编号将在确认后自动生成</span>
        </header>
        <div class="card-body form-grid">
          <el-form-item label="房源" prop="roomId">
            <el-select v-model="form.roomId" filterable placeholder="请选择可签约房源">
              <el-option v-for="room in rooms" :key="room.id" :label="`${room.fullHouseNo}${room.roomStatus ? `｜${roomStatusLabel(room.roomStatus)}` : ''}`" :value="room.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="主承租人" prop="primaryTenantId">
            <el-select v-model="form.primaryTenantId" filterable placeholder="请选择主承租人">
              <el-option v-for="tenant in tenants" :key="tenant.id" :label="`${tenant.name}${tenant.phone ? `｜${tenant.phone}` : ''}`" :value="tenant.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="副承租人">
            <el-select v-model="form.secondaryTenantIds" multiple filterable collapse-tags placeholder="可选择多人">
              <el-option v-for="tenant in tenants.filter(item => item.id !== form.primaryTenantId)" :key="tenant.id" :label="tenant.name" :value="tenant.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="合同开始日期" prop="startDate">
            <el-date-picker v-model="form.startDate" type="date" format="YYYY年MM月DD日" value-format="YYYY-MM-DD" placeholder="请选择开始日期" />
          </el-form-item>
          <el-form-item label="合同结束日期" prop="endDate">
            <el-date-picker v-model="form.endDate" type="date" format="YYYY年MM月DD日" value-format="YYYY-MM-DD" placeholder="请选择结束日期" />
          </el-form-item>
          <el-form-item label="计划入住日期" prop="plannedMoveInDate">
            <el-date-picker v-model="form.plannedMoveInDate" type="date" format="YYYY年MM月DD日" value-format="YYYY-MM-DD" placeholder="选填" />
          </el-form-item>
          <el-form-item label="押金（元）" prop="depositRequired">
            <el-input v-model="form.depositRequired" inputmode="decimal" placeholder="0.00" />
          </el-form-item>
          <el-form-item label="租缴周期（月）" prop="paymentCycleMonths">
            <el-select v-model="form.paymentCycleMonths">
              <el-option v-for="month in 12" :key="month" :value="month" :label="`${month}个月${month === 1 ? '（每月）' : month === 3 ? '（每季度）' : month === 6 ? '（每半年）' : month === 12 ? '（每年）' : ''}`" />
            </el-select>
          </el-form-item>
          <el-form-item label="纸质合同编号">
            <el-input v-model="form.externalContractNo" maxlength="80" placeholder="选填" />
          </el-form-item>
        </div>
      </section>

      <section class="contract-card">
        <header class="card-head">
          <div><h2>租金计价</h2><span>价格方案只作用于当前合同</span></div>
          <el-tag effect="light">固定月租</el-tag>
        </header>
        <div class="card-body pricing-row">
          <el-form-item label="固定月租（元）" prop="monthlyRent">
            <el-input v-model="form.monthlyRent" inputmode="decimal" placeholder="0.00" />
          </el-form-item>
          <div class="pricing-tip">确认合同后保存固定月租和每期账单快照；后续变更需进入合同变更流程。</div>
        </div>
      </section>

      <section class="contract-card">
        <header class="card-head">
          <h2>其他约定</h2>
          <el-button size="small" @click="addConcession">添加免租或优惠</el-button>
        </header>
        <div class="card-body">
          <div v-if="form.concessions.length" class="concessions">
            <div v-for="(item, index) in form.concessions" :key="index" class="concession-row">
              <el-select v-model="item.concessionType" @change="changeConcession(item)">
                <el-option label="日期区间免租" value="RENT_FREE" />
                <el-option label="固定金额优惠" value="FIXED_AMOUNT" />
                <el-option label="比例优惠" value="PERCENTAGE" />
              </el-select>
              <template v-if="item.applyMode === 'DATE_RANGE'">
                <el-date-picker v-model="item.startDate" type="date" format="YYYY年MM月DD日" value-format="YYYY-MM-DD" placeholder="开始日期" />
                <el-date-picker v-model="item.endDate" type="date" format="YYYY年MM月DD日" value-format="YYYY-MM-DD" placeholder="结束日期" />
              </template>
              <el-input-number v-else v-model="item.billingPeriodCount" :min="1" placeholder="适用账期数" />
              <el-input v-if="item.concessionType === 'FIXED_AMOUNT'" v-model="item.fixedAmount" inputmode="decimal" placeholder="优惠金额（元）" />
              <el-input v-else-if="item.concessionType === 'PERCENTAGE'" v-model="item.discountRate" inputmode="decimal" placeholder="0.1 表示九折" />
              <el-input v-model="item.reason" placeholder="优惠原因" />
              <el-button type="danger" link @click="removeConcession(index)">删除</el-button>
            </div>
          </div>
          <el-empty v-else :image-size="44" description="暂无免租或优惠约定" />
          <el-alert v-if="concessionError" type="error" :closable="false" :title="concessionError" show-icon />
          <div class="other-grid">
            <el-form-item label="合同附件">
              <el-upload :auto-upload="false" :show-file-list="false" accept=".pdf,.png,.jpg,.jpeg,.webp" :on-change="handleUpload">
                <el-button>上传 PDF / 图片</el-button>
              </el-upload>
              <span v-if="form.fileAssetIds.length" class="file-count">已上传 {{ form.fileAssetIds.length }} 个附件</span>
            </el-form-item>
            <div class="checkout-note"><b>提前退租</b><span>租户可按实际情况发起退租，结算时按既有退租流程和金额口径处理。</span></div>
          </div>
          <el-form-item label="合同备注">
            <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="1000" show-word-limit placeholder="请输入特殊约定" />
          </el-form-item>
        </div>
      </section>

      <section v-if="role === 'SUPER_ADMIN'" class="contract-card commission-card">
        <header class="card-head">
          <h2>租房提成</h2>
          <el-tag color="#f0ebff" effect="light">仅超级管理员可见</el-tag>
        </header>
        <div class="card-body form-grid commission-grid">
          <el-form-item label="提成所属对象">
            <el-input v-model="form.commission!.recipientName" maxlength="100" placeholder="选填" />
          </el-form-item>
          <el-form-item label="提成金额（元）">
            <el-input v-model="form.commission!.amount" inputmode="decimal" placeholder="0.00" />
          </el-form-item>
        </div>
      </section>
    </el-form>
  </section>
</template>

<style scoped>
.page-head { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 5px; font-size: 22px; }
.page-head p { margin: 0; color: #748196; }
.head-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.contract-card { margin-bottom: 15px; overflow: hidden; background: #fff; border: 1px solid #e7ecf3; border-radius: 12px; box-shadow: 0 10px 28px rgb(28 52 84 / 7%); }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 52px; padding: 12px 17px; border-bottom: 1px solid #edf1f5; }
.card-head h2 { margin: 0; font-size: 16px; }
.card-head span { color: #748196; font-size: 12px; }
.card-body { padding: 17px; }
.form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 14px; }
.contract-form :deep(.el-form-item) { margin-bottom: 17px; }
.contract-form :deep(.el-form-item__label) { height: auto; padding-bottom: 6px; color: #526075; font-size: 14px; line-height: 1.4; }
.contract-form :deep(.el-input), .contract-form :deep(.el-select), .contract-form :deep(.el-date-editor) { width: 100%; }
.contract-form :deep(.el-input__wrapper), .contract-form :deep(.el-select__wrapper) { min-height: 38px; border-radius: 7px; }
.pricing-row { display: grid; grid-template-columns: minmax(220px, 1fr) 2fr; gap: 18px; align-items: center; }
.pricing-tip, .checkout-note { padding: 10px 12px; color: #46648e; font-size: 12px; background: #eef4ff; border: 1px solid #ccdcfb; border-radius: 8px; }
.concessions { display: grid; gap: 10px; margin-bottom: 16px; }
.concession-row { display: grid; grid-template-columns: 160px repeat(2, 1fr) 1.4fr auto; gap: 8px; align-items: center; }
.other-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 16px; align-items: center; }
.file-count { margin-left: 10px; color: #748196; font-size: 12px; }
.checkout-note { display: flex; gap: 12px; }
.checkout-note b { flex: none; color: #233044; }
.commission-card { border-color: #e5ddff; }
.commission-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 1100px) { .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .concession-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 760px) {
  .page-head { align-items: flex-start; flex-direction: column; }
  .head-actions { width: 100%; }
  .head-actions .el-button { min-height: 40px; flex: 1 1 132px; margin-left: 0; }
  .form-grid, .commission-grid, .pricing-row, .concession-row, .other-grid { grid-template-columns: minmax(0, 1fr); }
  .card-head { align-items: flex-start; flex-wrap: wrap; }
  .checkout-note { align-items: flex-start; flex-direction: column; }
}
</style>
