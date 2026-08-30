<script setup lang="ts">
import type { CheckoutTab } from './checkout-types'

defineProps<{ activeTab: CheckoutTab }>()
const emit = defineEmits<{ change: [tab: CheckoutTab] }>()

const tabs: Array<{ key: CheckoutTab; label: string }> = [
  { key: 'initiate', label: '\u0031 \u53d1\u8d77\u9000\u79df' },
  { key: 'settlement', label: '\u0032 \u9000\u79df\u7ed3\u7b97' },
  { key: 'refund', label: '\u0033 \u9000\u79df\u9000\u6b3e\u786e\u8ba4' },
  { key: 'completed', label: '\u0034 \u5df2\u9000\u79df\u5408\u540c' },
]
</script>

<template>
  <nav class="contract-top-nav checkout-top-nav" :aria-label="'\u9000\u79df\u7ed3\u7b97\u6d41\u7a0b'">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="checkout-top-nav__item"
      :class="{ active: activeTab === tab.key, 'is-active': activeTab === tab.key }"
      :data-test="'checkout-tab-' + tab.key"
      :aria-current="activeTab === tab.key ? 'page' : undefined"
      @click="emit('change', tab.key)"
    >
      {{ tab.label }}
    </button>
  </nav>
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
  font: inherit;
  white-space: nowrap;
}

.contract-top-nav button.active {
  color: #246bfd;
  font-weight: 700;
  background: #fff;
  box-shadow: 0 3px 10px rgb(31 55 86 / 10%);
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
