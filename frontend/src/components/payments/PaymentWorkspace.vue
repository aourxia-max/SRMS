<script setup lang="ts">
import PaymentTopNav from './PaymentTopNav.vue'

defineProps<{ title: string; description: string }>()
</script>

<template>
  <section class="payment-workspace">
    <header class="workspace-header">
      <div><h1>{{ title }}</h1><p>{{ description }}</p></div>
      <PaymentTopNav />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.payment-workspace { display:grid; gap:18px; }
.workspace-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }
h1 { margin:0; color:#17243a; font-size:25px; } p { margin:7px 0 0; color:#78879d; font-size:14px; }
@media (max-width:880px) { .workspace-header { flex-direction:column; } }
</style>
