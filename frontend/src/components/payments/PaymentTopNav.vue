<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()

const items = [
  { label: '\u6536\u6b3e\u767b\u8bb0', path: '/payments/collect', match: '/payments/collect' },
  { label: '\u6536\u6b3e\u8be6\u60c5', path: '/payments/detail', match: '/payments/detail' },
  { label: '\u9000\u6b3e/\u4f5c\u5e9f\u786e\u8ba4', path: '/payments/reviews', match: '/payments/reviews' },
]
</script>

<template>
  <nav class="contract-top-nav payment-top-nav" :aria-label="'\u6536\u6b3e\u7ba1\u7406\u5bfc\u822a'">
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

.contract-top-nav a {
  flex: none;
  padding: 8px 20px;
  color: #566478;
  text-decoration: none;
  white-space: nowrap;
  background: transparent;
  border-radius: 7px;
}

.contract-top-nav a:hover { color: #246bfd; }

.contract-top-nav a.active {
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

  .contract-top-nav a {
    min-height: 40px;
    padding-inline: 16px;
  }
}
</style>
