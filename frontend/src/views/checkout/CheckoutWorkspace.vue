<script setup lang="ts">
import { ref } from 'vue'
import CheckoutTopNav from './CheckoutTopNav.vue'
import type { CheckoutTab } from './checkout-types'

const activeTab = ref<CheckoutTab>('initiate')
</script>

<template>
  <main class="checkout-workspace">
    <header class="checkout-workspace__header">
      <div>
        <el-tag effect="light">退租结算</el-tag>
        <h1>退租结算</h1>
        <p>按发起退租、退租结算、押金退还确认三个步骤完成交接。</p>
      </div>
      <CheckoutTopNav :active-tab="activeTab" @change="activeTab = $event" />
    </header>

    <section v-if="activeTab === 'initiate'" class="checkout-workspace__empty">
      <h2>发起退租</h2>
      <p>请选择正在履行的合同，填写退租信息后发起流程。</p>
    </section>
    <section v-else-if="activeTab === 'settlement'" class="checkout-workspace__empty">
      <h2>退租结算</h2>
      <p>选择已发起的退租单，录入验房和结算信息。</p>
    </section>
    <section v-else class="checkout-workspace__empty">
      <h2>押金退还确认</h2>
      <p>确认结算后，登记合并退款或完成零金额最终确认。</p>
    </section>
  </main>
</template>

<style scoped>
.checkout-workspace { min-height: 100%; padding: 24px; color: #233044; background: #f3f6fb; }
.checkout-workspace__header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.checkout-workspace__header h1 { margin: 8px 0 4px; font-size: 24px; line-height: 32px; }
.checkout-workspace__header p { margin: 0; color: #66758b; }
.checkout-workspace__empty { min-height: 360px; padding: 32px; border: 1px solid #e4eaf3; border-radius: 12px; background: #fff; box-shadow: 0 4px 14px rgb(35 67 120 / 6%); }
.checkout-workspace__empty h2 { margin: 0 0 8px; font-size: 20px; }
.checkout-workspace__empty p { margin: 0; color: #66758b; }
@media (max-width: 760px) { .checkout-workspace { padding: 16px; } .checkout-workspace__header { align-items: stretch; flex-direction: column; } }
</style>
