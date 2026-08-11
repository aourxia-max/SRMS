<script setup lang="ts">
import type { CheckoutTab } from "./checkout-types";

defineProps<{ activeTab: CheckoutTab }>()
const emit = defineEmits<{ change: [tab: CheckoutTab] }>()

const tabs: Array<{ key: CheckoutTab; label: string }> = [
  { key: 'initiate', label: '1 发起退租' },
  { key: 'settlement', label: '2 退租结算' },
  { key: 'refund', label: '3 押金退还确认' },
  { key: 'completed', label: '4 已退租合同' },
]
</script>

<template>
  <nav class="checkout-top-nav" aria-label="退租结算流程">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="checkout-top-nav__item"
      :class="{ 'is-active': activeTab === tab.key }"
      :data-test="`checkout-tab-${tab.key}`"
      :aria-current="activeTab === tab.key ? 'page' : undefined"
      @click="emit('change', tab.key)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>

<style scoped>
.checkout-top-nav {
  display: inline-flex;
  max-width: 100%;
  gap: 4px;
  overflow-x: auto;
  padding: 4px;
  border-radius: 10px;
  background: #e8eef8;
}

.checkout-top-nav__item {
  min-height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 8px;
  color: #5d6b82;
  background: transparent;
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.checkout-top-nav__item.is-active {
  color: #246bfd;
  background: #fff;
  box-shadow: 0 2px 8px rgb(35 67 120 / 12%);
  font-weight: 600;
}
</style>
