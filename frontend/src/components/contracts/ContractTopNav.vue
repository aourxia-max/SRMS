<script setup lang="ts">
import { computed } from 'vue'
import PendingCountBadge from '../PendingCountBadge.vue'
import { useApprovalTasksStore } from '../../stores/approval-tasks'
import type { ContractRole, ContractWorkspaceTab } from '../../types/contracts'

const props = withDefaults(defineProps<{
  modelValue: ContractWorkspaceTab
  selectedContractId?: number | null
  role?: ContractRole
}>(), { selectedContractId: null, role: 'VISITOR' })

const emit = defineEmits<{ 'update:modelValue': [value: ContractWorkspaceTab] }>()
const approvalTasks = useApprovalTasksStore()

const items: Array<{ value: ContractWorkspaceTab; label: string }> = [
  { value: 'list', label: '合同列表' },
  { value: 'create', label: '新增合同' },
  { value: 'detail', label: '合同详情' },
  { value: 'fixed-rebate', label: '固定月租退差' },
  { value: 'void-correction', label: '合同作废／纠错' },
]

const visibleItems = computed(() => items.filter((item) => (
  item.value !== 'void-correction' || props.role === 'ADMIN' || props.role === 'SUPER_ADMIN'
)))

const needsSelection = computed(() => ['detail', 'fixed-rebate'].includes(props.modelValue) && !props.selectedContractId)

function badgeCount(tab: ContractWorkspaceTab) {
  if (props.role === 'VISITOR') return 0
  if (tab === 'fixed-rebate') return approvalTasks.counts.fixedRentRebates
  if (tab === 'void-correction') return approvalTasks.counts.contractVoidRequests
  return 0
}
</script>

<template>
  <div>
    <nav class="contract-top-nav" aria-label="合同工作区导航">
      <button
        v-for="item in visibleItems"
        :key="item.value"
        type="button"
        :class="{ active: modelValue === item.value }"
        @click="emit('update:modelValue', item.value)"
      >
        {{ item.label }}
        <span v-if="badgeCount(item.value)" :data-test="`badge-${item.value}`" class="top-nav-badge">
          <PendingCountBadge :count="badgeCount(item.value)" />
        </span>
      </button>
    </nav>
    <p v-if="needsSelection" class="selection-hint">请先从合同列表选择合同</p>
  </div>
</template>

<style scoped>
.contract-top-nav {
  position: sticky;
  top: 72px;
  z-index: 12;
  display: flex;
  width: max-content;
  max-width: 100%;
  gap: 7px;
  margin: 0 auto 18px;
  padding: 5px;
  overflow-x: auto;
  background: #e7edf6;
  border-radius: 10px;
}

.contract-top-nav button {
  position: relative;
  flex: none;
  padding: 8px 20px;
  color: #566478;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
}

.top-nav-badge {
  position: absolute;
  top: 1px;
  right: 2px;
}

.contract-top-nav button.active {
  color: #246bfd;
  font-weight: 700;
  background: #fff;
  box-shadow: 0 3px 10px rgb(31 55 86 / 10%);
}

.selection-hint {
  margin: -8px 0 16px;
  color: #748196;
  text-align: center;
}
@media (max-width: 760px) {
  .contract-top-nav {
    width: 100%;
    justify-content: flex-start;
    margin-bottom: 14px;
    overscroll-behavior-inline: contain;
  }

  .contract-top-nav button {
    min-height: 40px;
    padding-inline: 16px;
  }
}
</style>
