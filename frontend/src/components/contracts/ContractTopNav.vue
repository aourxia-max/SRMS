<script setup lang="ts">
import { computed } from 'vue'
import type { ContractWorkspaceTab } from '../../types/contracts'

const props = withDefaults(defineProps<{
  modelValue: ContractWorkspaceTab
  selectedContractId?: number | null
}>(), { selectedContractId: null })

const emit = defineEmits<{ 'update:modelValue': [value: ContractWorkspaceTab] }>()

const items: Array<{ value: ContractWorkspaceTab; label: string }> = [
  { value: 'list', label: '合同列表' },
  { value: 'create', label: '新增合同' },
  { value: 'detail', label: '合同详情' },
  { value: 'fixed-rebate', label: '固定月租退差' },
]

const needsSelection = computed(() => ['detail', 'fixed-rebate'].includes(props.modelValue) && !props.selectedContractId)
</script>

<template>
  <div>
    <nav class="contract-top-nav" aria-label="合同工作区导航">
      <button
        v-for="item in items"
        :key="item.value"
        type="button"
        :class="{ active: modelValue === item.value }"
        @click="emit('update:modelValue', item.value)"
      >
        {{ item.label }}
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
  flex: none;
  padding: 8px 20px;
  color: #566478;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
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
</style>
