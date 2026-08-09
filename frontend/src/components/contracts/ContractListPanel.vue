<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ContractListItem } from '../../types/contracts'

const props = withDefaults(defineProps<{
  contracts: ContractListItem[]
  selectedContractId?: number | null
  loading?: boolean
  draftId?: number | null
}>(), { selectedContractId: null, loading: false, draftId: null })

const emit = defineEmits<{ select: [contract: ContractListItem]; create: []; 'continue-draft': [] }>()
const keyword = ref('')
const status = ref('')
const roomId = ref<number | ''>('')

const roomOptions = computed(() => {
  const seen = new Map<number, string>()
  props.contracts.forEach((item) => seen.set(item.roomId, item.room?.fullHouseNo || `房源${item.roomId}`))
  return [...seen].map(([id, label]) => ({ id, label }))
})

const filtered = computed(() => props.contracts.filter((item) => {
  if (item.pricingMode !== 'FIXED') return false
  if (status.value && item.status !== status.value) return false
  if (roomId.value && item.roomId !== roomId.value) return false
  const primary = item.members?.find((member) => member.memberRole === 'PRIMARY')?.tenant.name || ''
  const haystack = [item.contractNo, item.externalContractNo, item.room?.fullHouseNo, primary].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(keyword.value.trim().toLowerCase())
}))

const statusLabel: Record<string, string> = {
  PENDING_START: '待开始', ACTIVE: '履行中', PENDING_CHECKOUT: '待退租', TERMINATED: '已终止', EXPIRED: '已到期', VOIDED: '已作废',
}
</script>

<template>
  <section>
    <header class="page-head">
      <div><h1>合同列表</h1><p>搜索固定月租合同并进入详情、账单或退差处理</p></div>
      <el-button type="primary" @click="emit('create')">新增合同</el-button>
    </header>
    <section class="contract-card">
      <div class="filters">
        <el-input v-model="keyword" clearable placeholder="搜索合同编号、纸质编号、房源或主承租人" />
        <el-select v-model="status" clearable placeholder="全部状态">
          <el-option v-for="(label, value) in statusLabel" :key="value" :label="label" :value="value" />
        </el-select>
        <el-select v-model="roomId" clearable filterable placeholder="全部房源">
          <el-option v-for="room in roomOptions" :key="room.id" :label="room.label" :value="room.id" />
        </el-select>
      </div>
      <el-alert v-if="draftId" class="draft-alert" type="info" :closable="false" show-icon>
        <template #title>尚有未确认合同草稿 #{{ draftId }}</template>
        <el-button type="primary" link @click="emit('continue-draft')">继续编辑并确认</el-button>
      </el-alert>
      <el-table v-loading="loading" :data="filtered" stripe empty-text="暂无符合条件的固定月租合同" row-key="id">
        <el-table-column prop="contractNo" label="合同编号" min-width="240" />
        <el-table-column label="房源" min-width="110"><template #default="{ row }">{{ row.room?.fullHouseNo || `房源${row.roomId}` }}</template></el-table-column>
        <el-table-column label="主承租人" min-width="110"><template #default="{ row }">{{ row.members?.find((item: any) => item.memberRole === 'PRIMARY')?.tenant.name || '—' }}</template></el-table-column>
        <el-table-column label="合同期" min-width="205"><template #default="{ row }">{{ String(row.startDate).slice(0, 10) }} 至 {{ String(row.endDate).slice(0, 10) }}</template></el-table-column>
        <el-table-column label="月租" width="120"><template #default="{ row }">¥{{ Number(row.monthlyRent).toLocaleString('zh-CN') }}</template></el-table-column>
        <el-table-column label="状态" width="105"><template #default="{ row }"><el-tag effect="light">{{ statusLabel[row.status] || row.status }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button :type="row.id === selectedContractId ? 'primary' : 'default'" link @click="emit('select', row)">查看详情</el-button></template></el-table-column>
      </el-table>
    </section>
  </section>
</template>

<style scoped>
.page-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 5px; font-size: 22px; }
.page-head p { margin: 0; color: #748196; }
.contract-card { overflow: hidden; background: #fff; border: 1px solid #e7ecf3; border-radius: 12px; box-shadow: 0 10px 28px rgb(28 52 84 / 7%); }
.draft-alert { margin: 12px 17px 0; }
.filters { display: grid; grid-template-columns: minmax(300px, 1fr) 180px 220px; gap: 10px; padding: 16px 17px; border-bottom: 1px solid #edf1f5; }
.filters :deep(.el-input__wrapper), .filters :deep(.el-select__wrapper) { min-height: 38px; }
</style>
