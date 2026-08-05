<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()

const items = [
  { label: '收款登记', path: '/payments/collect', match: '/payments/collect' },
  { label: '收款详情', path: '/payments/detail', match: '/payments/detail' },
  { label: '退款/作废确认', path: '/payments/reviews', match: '/payments/reviews' },
]
</script>

<template>
  <nav class="payment-top-nav" aria-label="收款管理导航">
    <router-link
      v-for="item in items"
      :key="item.path"
      :to="item.path"
      :class="{ active: route.path.startsWith(item.match) }"
    >
      {{ item.label }}
    </router-link>
  </nav>
</template>

<style scoped>
.payment-top-nav { display:flex; gap:4px; padding:5px; border:1px solid #e4e9f1; border-radius:10px; background:#f5f7fa; }
.payment-top-nav a { padding:8px 18px; border-radius:7px; color:#5d6b82; font-size:14px; text-decoration:none; }
.payment-top-nav a:hover { color:#246bfd; }
.payment-top-nav a.active { background:#fff; color:#246bfd; font-weight:600; box-shadow:0 2px 7px rgba(31,46,74,.08); }
@media (max-width:720px) { .payment-top-nav { width:100%; overflow-x:auto; }.payment-top-nav a { flex:none; } }
</style>
