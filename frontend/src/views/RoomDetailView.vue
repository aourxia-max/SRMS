<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const detail = ref<any>(null)
const loading = ref(true)
const isSuper = computed(() => session.user?.role === 'SUPER_ADMIN')
const canManage = computed(() => ['SUPER_ADMIN', 'ADMIN'].includes(session.user?.role ?? ''))
const room = computed(() => detail.value?.room)
const focusContract = computed(() => room.value?.contracts?.find((item: any) => item.id === detail.value?.focusContractId) ?? null)
const financial = computed(() => detail.value?.financial)
const editDialog = ref(false)
const editSaving = ref(false)
const editForm = reactive({
  houseNo: '',
  floorNo: 1,
  area: undefined as number | undefined,
  roomType: 'RESIDENTIAL',
  roomStatus: 'EMPTY',
  decorationStatus: 'UNKNOWN',
  usageType: 'RESIDENCE',
  ownerName: '',
  ownerPhone: '',
  ownerRemark: '',
  remark: '',
})

const statusLabels: Record<string, string> = { EMPTY: '空置', PENDING_MOVE_IN: '待入住', RENTED: '已出租', PENDING_CHECKOUT: '待退房', MAINTENANCE: '维修中', FOR_SALE: '待出售', SOLD: '已出售', DISABLED: '停用', OTHER: '其他' }
const decorationLabels: Record<string, string> = { RENOVATED: '已装修', UNRENOVATED: '未装修', RENOVATING: '装修中', UNKNOWN: '未知' }
const contractLabels: Record<string, string> = { DRAFT: '草稿', PENDING_START: '待生效', ACTIVE: '履行中', PENDING_CHECKOUT: '待退房', ENDED: '已结束', TERMINATED: '已终止' }
function date(value: string | null | undefined) { return value ? new Date(value).toLocaleDateString('zh-CN') : '-' }
function money(value: unknown) { return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function statusLabel(value: string) { return statusLabels[value] ?? value }
async function load() { loading.value = true; try { detail.value = (await http.get(`/properties/rooms/${route.params.id}/detail`)).data.data } finally { loading.value = false } }
const withoutEmptyFields = (form: Record<string, unknown>) => Object.fromEntries(Object.entries(form).filter(([, value]) => value !== '' && value !== undefined))
function openEdit() {
  if (!room.value) return
  Object.assign(editForm, {
    houseNo: room.value.houseNo ?? '',
    floorNo: room.value.floorNo ?? 1,
    area: room.value.area === null || room.value.area === undefined ? undefined : Number(room.value.area),
    roomType: room.value.roomType ?? 'RESIDENTIAL',
    roomStatus: room.value.roomStatus ?? 'EMPTY',
    decorationStatus: room.value.decorationStatus ?? 'UNKNOWN',
    usageType: room.value.usageType ?? 'RESIDENCE',
    ownerName: room.value.ownerName ?? '',
    ownerPhone: room.value.ownerPhone ?? '',
    ownerRemark: room.value.ownerRemark ?? '',
    remark: room.value.remark ?? '',
  })
  editDialog.value = true
}
async function saveEdit() {
  editSaving.value = true
  try {
    await http.patch(`/properties/rooms/${route.params.id}`, withoutEmptyFields({
      houseNo: editForm.houseNo,
      floorNo: editForm.floorNo,
      area: editForm.area,
      roomType: editForm.roomType,
      roomStatus: editForm.roomStatus,
      decorationStatus: editForm.decorationStatus,
      usageType: editForm.usageType,
      ownerName: editForm.ownerName,
      ownerPhone: editForm.ownerPhone,
      ownerRemark: editForm.ownerRemark,
      remark: editForm.remark,
    }))
    editDialog.value = false
    ElMessage.success('房源信息已保存')
    await load()
  } catch {
    ElMessage.error('保存房源信息失败，请稍后重试')
  } finally {
    editSaving.value = false
  }
}
onMounted(load)
</script>

<template>
  <main v-loading="loading" class="room-detail-page">
    <template v-if="room">
      <header class="detail-head">
        <div>
          <el-button text @click="router.push('/')">← 返回驾驶舱</el-button>
          <div class="title-row"><h1>{{ room.fullHouseNo }}</h1><el-tag effect="light" type="success">{{ statusLabel(room.roomStatus) }}</el-tag></div>
          <p>{{ room.building?.buildingName || room.building?.buildingNo }} · {{ room.floorNo }} 层 · 状态更新于 {{ date(room.statusChangedAt) }}</p>
        </div>
        <div class="detail-actions"><el-button @click="router.push('/properties')">前往房源管理</el-button><el-button v-if="canManage" @click="openEdit">编辑房源</el-button><el-button @click="router.push({ path: '/contracts', query: { roomId: room.id } })">合同管理</el-button><el-button type="primary" @click="router.push(focusContract ? { path: '/payments', query: { contractId: focusContract.id } } : '/payments')">收款登记</el-button></div>
      </header>

      <section class="risk-row"><el-tag v-for="label in detail.riskLabels" :key="label" :type="label === '当前无待办' ? 'success' : 'warning'" effect="light">{{ label }}</el-tag></section>

      <section class="detail-grid">
        <el-card shadow="never"><template #header><h2>房屋现状</h2></template><dl class="info-grid"><dt>房源类型</dt><dd>{{ room.roomType === 'SHOP' ? '商铺' : '住宅' }}</dd><dt>面积</dt><dd>{{ room.area ? `${room.area} ㎡` : '-' }}</dd><dt>装修状态</dt><dd>{{ decorationLabels[room.decorationStatus] ?? room.decorationStatus }}</dd><dt>使用用途</dt><dd>{{ room.usageType === 'RESIDENCE' ? '居住' : room.usageType }}</dd><dt>房源备注</dt><dd>{{ room.remark || '-' }}</dd></dl></el-card>
        <el-card shadow="never"><template #header><h2>业主信息</h2></template><dl class="info-grid"><dt>业主姓名</dt><dd>{{ room.ownerName || '-' }}</dd><dt>联系电话</dt><dd>{{ room.ownerPhone || '-' }}</dd><dt>业主备注</dt><dd>{{ room.ownerRemark || '-' }}</dd></dl></el-card>
      </section>

      <el-card shadow="never" class="contract-card"><template #header><div class="card-head"><div><h2>合同与租户</h2><small>{{ focusContract ? '优先展示当前合同；可展开查看历史合同' : '当前暂无合同记录' }}</small></div><el-button text type="primary" @click="router.push('/contracts')">查看合同管理</el-button></div></template>
        <el-empty v-if="!focusContract" description="暂无生效合同 / 暂无租客" />
        <template v-else><div class="contract-summary"><div><span>合同编号</span><b>{{ focusContract.contractNo }}</b></div><div><span>合同状态</span><b>{{ contractLabels[focusContract.status] ?? focusContract.status }}</b></div><div><span>租期</span><b>{{ date(focusContract.startDate) }} 至 {{ date(focusContract.endDate) }}</b></div><div><span>月租金</span><b>{{ money(focusContract.monthlyRent) }}</b></div></div><div class="tenant-list"><article v-for="member in focusContract.members" :key="member.id"><b>{{ member.tenant?.name || '-' }}</b><span>{{ member.memberRole === 'PRIMARY' ? '主承租人' : '共同承租人' }}</span><small>{{ member.tenant?.phone || '未填写联系电话' }}</small></article></div></template>
      </el-card>

      <el-card v-if="isSuper" shadow="never" class="financial-card"><template #header><div class="card-head"><div><h2>财务与收款</h2><small>仅超级管理员可见；数据按当前/最近合同汇总</small></div><el-button text type="primary" @click="router.push('/finance')">查看财务中心</el-button></div></template>
        <el-empty v-if="!financial" description="该房源暂无可展示的合同财务信息" />
        <template v-else><div class="financial-summary"><div><span>账单应收</span><b>{{ money(financial.summary.payable) }}</b></div><div><span>账单已收</span><b>{{ money(financial.summary.received) }}</b></div><div><span>账单未收</span><b>{{ money(financial.summary.outstanding) }}</b></div><div><span>预收款余额</span><b>{{ money(financial.prepaymentBalance) }}</b></div></div><el-table :data="financial.bills" size="small" max-height="260"><el-table-column prop="periodSeq" label="账期" width="70" /><el-table-column label="应缴日期"><template #default="{ row }">{{ date(row.dueDate) }}</template></el-table-column><el-table-column prop="payableAmount" label="应收" /><el-table-column prop="receivedAmount" label="已收" /><el-table-column prop="outstandingAmount" label="未收" /><el-table-column prop="status" label="状态" /></el-table><el-divider content-position="left">收款记录</el-divider><el-empty v-if="!financial.payments.length" description="暂无收款记录" /><el-table v-else :data="financial.payments" size="small" max-height="220"><el-table-column prop="receiptNo" label="收据编号" /><el-table-column label="日期"><template #default="{ row }">{{ date(row.paymentDate) }}</template></el-table-column><el-table-column prop="amount" label="金额" /><el-table-column prop="method" label="方式" /><el-table-column prop="status" label="状态" /></el-table></template>
      </el-card>

      <el-collapse class="history-panel"><el-collapse-item title="历史信息（房态变更与历史合同）" name="history"><section class="history-grid"><div><h3>房态变更</h3><el-empty v-if="!room.histories.length" description="暂无房态变更记录" /><el-timeline v-else><el-timeline-item v-for="item in room.histories" :key="item.id" :timestamp="date(item.changedAt)">{{ item.fromStatus ? `${statusLabel(item.fromStatus)} → ${statusLabel(item.toStatus)}` : statusLabel(item.toStatus) }}<small>{{ item.changeReason || '房源建档' }}</small></el-timeline-item></el-timeline></div><div><h3>历史合同</h3><el-empty v-if="!room.contracts.length" description="暂无合同记录" /><el-timeline v-else><el-timeline-item v-for="contract in room.contracts" :key="contract.id" :timestamp="`${date(contract.startDate)} 至 ${date(contract.endDate)}`"><b>{{ contract.contractNo }}</b><small>{{ contractLabels[contract.status] ?? contract.status }} · {{ contract.hasOverdueBill ? '存在逾期账单' : '无逾期账单' }}</small></el-timeline-item></el-timeline></div></section></el-collapse-item></el-collapse>
      <el-dialog v-model="editDialog" title="编辑房源" width="680">
        <el-form :model="editForm" label-position="top">
          <el-row :gutter="16">
            <el-col :span="12"><el-form-item label="房号"><el-input v-model="editForm.houseNo" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="楼层"><el-input-number v-model="editForm.floorNo" :min="1" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="面积（㎡）"><el-input-number v-model="editForm.area" :min="0" :precision="2" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="房源类型"><el-select v-model="editForm.roomType"><el-option label="住宅" value="RESIDENTIAL" /><el-option label="商铺" value="SHOP" /></el-select></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="房态"><el-select v-model="editForm.roomStatus"><el-option v-for="(label, value) in statusLabels" :key="value" :label="label" :value="value" /></el-select></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="装修状态"><el-select v-model="editForm.decorationStatus"><el-option label="未知" value="UNKNOWN" /><el-option label="已装修" value="RENOVATED" /><el-option label="未装修" value="UNRENOVATED" /><el-option label="装修中" value="RENOVATING" /></el-select></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="使用用途"><el-select v-model="editForm.usageType"><el-option label="居住" value="RESIDENCE" /><el-option label="商铺" value="SHOP" /><el-option label="办公" value="OFFICE" /><el-option label="仓储" value="STORAGE" /><el-option label="其他" value="OTHER" /></el-select></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="业主姓名"><el-input v-model="editForm.ownerName" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="业主电话"><el-input v-model="editForm.ownerPhone" /></el-form-item></el-col>
            <el-col :span="24"><el-form-item label="业主备注"><el-input v-model="editForm.ownerRemark" /></el-form-item></el-col>
          </el-row>
          <el-form-item label="房源备注"><el-input v-model="editForm.remark" type="textarea" :rows="3" /></el-form-item>
        </el-form>
        <template #footer><el-button @click="editDialog = false">取消</el-button><el-button type="primary" :loading="editSaving" @click="saveEdit">保存</el-button></template>
      </el-dialog>
    </template>
  </main>
</template>

<style scoped>
.room-detail-page { max-width:1440px; margin:0 auto; padding:24px; color:#253247; }.detail-head,.card-head,.detail-actions,.title-row,.risk-row { display:flex; align-items:center; }.detail-head,.card-head { justify-content:space-between; gap:16px; }.title-row { gap:12px; }.title-row h1 { margin:8px 0; font-size:30px; }.detail-head p,.card-head small { margin:0; color:#718096; font-size:13px; }.detail-actions,.risk-row { flex-wrap:wrap; gap:8px; }.risk-row { margin:16px 0; }.detail-grid,.history-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }.contract-card,.financial-card,.history-panel { margin-top:16px; }h2,h3 { margin:0; font-size:16px; }.info-grid { display:grid; grid-template-columns:100px 1fr; gap:12px 16px; margin:0; font-size:14px; }.info-grid dt { color:#7b8798; }.info-grid dd { margin:0; word-break:break-word; }.contract-summary,.financial-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:16px; }.contract-summary div,.financial-summary div { padding:12px; border-radius:9px; background:#f7f9fc; }.contract-summary span,.financial-summary span { display:block; color:#748197; font-size:12px; }.contract-summary b,.financial-summary b { display:block; margin-top:6px; overflow:hidden; font-size:14px; text-overflow:ellipsis; white-space:nowrap; }.tenant-list { display:flex; flex-wrap:wrap; gap:10px; }.tenant-list article { min-width:190px; padding:11px 13px; border:1px solid #e8edf4; border-radius:9px; }.tenant-list b,.tenant-list span,.tenant-list small,.history-grid small { display:block; }.tenant-list span,.tenant-list small,.history-grid small { margin-top:4px; color:#758196; font-size:12px; }.financial-summary div:nth-child(2) b { color:#168765; }.financial-summary div:nth-child(3) b { color:#d1494e; }.history-panel :deep(.el-collapse-item__header) { font-weight:650; }.history-grid h3 { margin-bottom:14px; }@media (max-width:760px) { .room-detail-page { padding:16px; }.detail-head,.card-head { align-items:flex-start; flex-direction:column; }.detail-grid,.history-grid,.contract-summary,.financial-summary { grid-template-columns:1fr; } }
</style>
