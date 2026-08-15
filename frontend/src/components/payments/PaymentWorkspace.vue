<script setup lang="ts">
import PaymentTopNav from './PaymentTopNav.vue'

defineProps<{ title: string; description: string }>()
</script>

<template>
  <section class="payment-workspace">
    <header class="workspace-header">
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </header>
    <PaymentTopNav />
    <slot />
  </section>
</template>

<style scoped>
.payment-workspace { display:grid; gap:18px; }
.workspace-header { display:grid; gap:7px; }
h1 { margin:0; color:#17243a; font-size:25px; }
p { margin:0; color:#78879d; font-size:14px; }
</style>
