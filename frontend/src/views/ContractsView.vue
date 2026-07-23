<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { http } from '../services/http'

type Concession = {
  concessionType: 'RENT_FREE' | 'FIXED_AMOUNT' | 'PERCENTAGE'
  applyMode: 'DATE_RANGE' | 'BILLING_PERIODS' | 'ONE_TIME'
  startDate: string
  endDate: string
  fixedAmount: string
  discountRate: string
  billingPeriodCount?: number
  reason: string
}

const rooms = ref<any[]>([])
const tenants = ref<any[]>([])
const contracts = ref<any[]>([])
const bills = ref<any[]>([])
const pricingMode = ref<'FIXED' | 'TIERED_RETROACTIVE'>('FIXED')
const tiers = ref([{ tierName: '基础档', thresholdMonths: 0, monthlyRent: '', requiresFullyPaid: true }])
const concessions = ref<Concession[]>([])
const form = reactive({
  contractNo: '', roomId: 0, startDate: '', endDate: '', monthlyRent: '',
  depositRequired: '0', paymentCycleMonths: 1, primaryTenantId: 0, secondaryTenantIds: [] as number[],
})
const cycleMonths: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 }

async function load() {
  rooms.value = (await http.get('/properties/rooms')).data.data
    .filter((room: any) => !['SOLD', 'FOR_SALE', 'DISABLED'].includes(room.roomStatus))
  tenants.value = (await http.get('/tenants')).data.data.items
  contracts.value = (await http.get('/contracts')).data.data
}

function concessionValid(item: Concession) {
  if (!item.reason) return false
  if (item.applyMode === 'DATE_RANGE') return !!item.startDate && !!item.endDate && item.endDate >= item.startDate
  if (item.applyMode === 'BILLING_PERIODS') return Number.isInteger(item.billingPeriodCount) && Number(item.billingPeriodCount) > 0
  return true
}

async function submit() {
  if (!form.contractNo || !form.roomId || !form.primaryTenantId || !form.startDate || !form.endDate || Number(form.monthlyRent) < 0 || form.endDate < form.startDate) {
    return alert('请完整填写合同基本信息')
  }
  if (pricingMode.value === 'TIERED_RETROACTIVE' && (tiers.value.some((tier) => !tier.tierName || Number(tier.monthlyRent) < 0) || new Set(tiers.value.map((tier) => tier.thresholdMonths)).size !== tiers.value.length)) {
    return alert('阶梯档位无效')
  }
  if (!concessions.value.every(concessionValid)) return alert('请完整填写每条优惠规则的原因与适用范围')
  const payload = pricingMode.value === 'FIXED'
    ? { ...form, concessions: concessions.value }
    : { ...form, tiers: tiers.value, concessions: concessions.value }
  await http.post(pricingMode.value === 'FIXED' ? '/contracts/fixed' : '/contracts/tiered', payload)
  await load()
}

function addTier() {
  tiers.value.push({ tierName: `档位${tiers.value.length + 1}`, thresholdMonths: 0, monthlyRent: '', requiresFullyPaid: true })
}
function removeTier(index: number) { if (tiers.value.length > 1) tiers.value.splice(index, 1) }
function addConcession() {
  concessions.value.push({ concessionType: 'RENT_FREE', applyMode: 'DATE_RANGE', startDate: '', endDate: '', fixedAmount: '', discountRate: '', billingPeriodCount: undefined, reason: '' })
}
function changeConcessionType(item: Concession) {
  item.applyMode = item.concessionType === 'RENT_FREE' ? 'DATE_RANGE' : 'BILLING_PERIODS'
}
function removeConcession(index: number) { concessions.value.splice(index, 1) }
async function showBills(row: any) { bills.value = (await http.get(`/contracts/${row.id}/bills`)).data.data }
onMounted(async () => { const settings = await http.get('/system/defaults').catch(() => null); const cycle = settings?.data?.data?.defaultPaymentCycle; if (cycle && cycleMonths[cycle]) form.paymentCycleMonths = cycleMonths[cycle]; await load() })
</script>

<template>
  <main class="users-page">
    <header><div><el-tag>Task006</el-tag><h1>合同管理</h1><p>确认合同后生成完整租期账单；尾期按固定 30 天计算。</p></div></header>
    <el-card header="基本信息">
      <el-form :model="form" label-position="top">
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="计价方式"><el-radio-group v-model="pricingMode"><el-radio value="FIXED">固定月租</el-radio><el-radio value="TIERED_RETROACTIVE">阶梯计价</el-radio></el-radio-group></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="合同编号"><el-input v-model="form.contractNo" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="房源"><el-select v-model="form.roomId"><el-option v-for="room in rooms" :key="room.id" :label="room.fullHouseNo" :value="room.id" /></el-select></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="主承租人"><el-select v-model="form.primaryTenantId"><el-option v-for="tenant in tenants" :key="tenant.id" :label="tenant.name" :value="tenant.id" /></el-select></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="共同承租人"><el-select v-model="form.secondaryTenantIds" multiple><el-option v-for="tenant in tenants" :key="tenant.id" :label="tenant.name" :value="tenant.id" /></el-select></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="月租（元）"><el-input v-model="form.monthlyRent" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="押金（元）"><el-input v-model="form.depositRequired" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="缴费周期（月）"><el-input-number v-model="form.paymentCycleMonths" :min="1" :max="12" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="合同开始日期"><el-date-picker v-model="form.startDate" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="合同结束日期"><el-date-picker v-model="form.endDate" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col>
        </el-row>
      </el-form>
    </el-card>

    <el-card v-if="pricingMode === 'TIERED_RETROACTIVE'" header="合同级阶梯档位" style="margin-top: 16px">
      <el-button size="small" @click="addTier">新增档位</el-button>
      <el-table :data="tiers"><el-table-column label="名称"><template #default="{ row }"><el-input v-model="row.tierName" /></template></el-table-column><el-table-column label="达标月数"><template #default="{ row }"><el-input-number v-model="row.thresholdMonths" :min="0" /></template></el-table-column><el-table-column label="月租"><template #default="{ row }"><el-input v-model="row.monthlyRent" /></template></el-table-column><el-table-column label="操作"><template #default="{ $index }"><el-button size="small" :disabled="tiers.length === 1" @click="removeTier($index)">删除</el-button></template></el-table-column></el-table>
    </el-card>

    <el-card header="免租与优惠" style="margin-top: 16px">
      <p>选择日期区间或账期数后，系统会记录适用范围。固定金额与比例优惠的完整分摊/生效规则仍待业务确认。</p>
      <el-button size="small" @click="addConcession">新增规则</el-button>
      <el-table :data="concessions">
        <el-table-column label="类型"><template #default="{ row }"><el-select v-model="row.concessionType" @change="changeConcessionType(row)"><el-option label="日期区间免租" value="RENT_FREE" /><el-option label="固定金额" value="FIXED_AMOUNT" /><el-option label="比例优惠" value="PERCENTAGE" /></el-select></template></el-table-column>
        <el-table-column label="适用方式"><template #default="{ row }"><span>{{ row.applyMode === 'DATE_RANGE' ? '日期区间' : '指定账期数' }}</span></template></el-table-column>
        <el-table-column label="适用范围"><template #default="{ row }"><template v-if="row.applyMode === 'DATE_RANGE'"><el-date-picker v-model="row.startDate" value-format="YYYY-MM-DD" type="date" /><el-date-picker v-model="row.endDate" value-format="YYYY-MM-DD" type="date" /></template><el-input-number v-else-if="row.applyMode === 'BILLING_PERIODS'" v-model="row.billingPeriodCount" :min="1" /></template></el-table-column>
        <el-table-column label="金额/比例"><template #default="{ row }"><el-input v-if="row.concessionType === 'FIXED_AMOUNT'" v-model="row.fixedAmount" placeholder="金额（元）" /><el-input v-else-if="row.concessionType === 'PERCENTAGE'" v-model="row.discountRate" placeholder="0.1 表示九折" /><span v-else>按重叠天数计算</span></template></el-table-column>
        <el-table-column label="原因"><template #default="{ row }"><el-input v-model="row.reason" /></template></el-table-column>
        <el-table-column label="操作"><template #default="{ $index }"><el-button size="small" @click="removeConcession($index)">删除</el-button></template></el-table-column>
      </el-table>
    </el-card>
    <el-button style="margin-top: 16px" type="primary" @click="submit">确认并生成账单</el-button>
    <el-card header="已确认合同" style="margin-top: 16px"><el-table :data="contracts"><el-table-column prop="contractNo" label="合同编号" /><el-table-column label="房源"><template #default="{ row }">{{ row.room?.fullHouseNo }}</template></el-table-column><el-table-column prop="status" label="状态" /><el-table-column label="账单"><template #default="{ row }"><el-button size="small" @click="showBills(row)">查看</el-button></template></el-table-column></el-table><el-table v-if="bills.length" :data="bills" style="margin-top: 16px"><el-table-column prop="periodSeq" label="期数" /><el-table-column prop="baseRentAmount" label="原始租金" /><el-table-column prop="rentFreeAmount" label="免租" /><el-table-column prop="discountAmount" label="优惠" /><el-table-column prop="payableAmount" label="最终应收" /></el-table></el-card>
  </main>
</template>
