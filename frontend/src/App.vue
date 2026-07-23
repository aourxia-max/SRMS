<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from './stores/app'
import { useSessionStore } from './stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const app = useAppStore()
const collapsed = ref(false)
const isPublicPage = computed(() => route.name === 'login' || route.name === 'task001-preview')
const isSuperAdmin = computed(() => session.user?.role === 'SUPER_ADMIN')
const isAdmin = computed(() => ['SUPER_ADMIN', 'ADMIN'].includes(session.user?.role ?? ''))
const pageNames: Record<string, string> = {
  session: '经营驾驶舱', properties: '房源管理', tenants: '承租人管理', contracts: '合同管理',
  'contract-changes': '合同变更', payments: '收款管理', 'pricing-rebates': '阶梯退差',
  checkout: '退租结算', finance: '财务中心', users: '用户管理', 'system-management': '系统管理',
}
const currentPage = computed(() => pageNames[String(route.name)] ?? 'SRMS')
const initial = computed(() => session.user?.displayName?.slice(0, 1) ?? '我')

async function logout() {
  await session.logout()
  await router.push({ name: 'login' })
}
onMounted(() => void app.loadProjectName())
</script>

<template>
  <router-view v-if="isPublicPage || !session.isAuthenticated" />
  <div v-else class="srms-shell" :class="{ 'is-collapsed': collapsed }">
    <aside class="srms-sidebar">
      <div class="srms-brand"><div class="srms-logo">S</div><div v-show="!collapsed"><b>SRMS</b><small>{{ app.projectName }}</small></div></div>
      <nav class="srms-nav">
        <p v-show="!collapsed">工作台</p>
        <router-link to="/" class="srms-nav-item"><span>▦</span><b v-show="!collapsed">经营驾驶舱</b></router-link>
        <router-link to="/properties" class="srms-nav-item"><span>⌂</span><b v-show="!collapsed">房源管理</b></router-link>
        <router-link to="/tenants" class="srms-nav-item"><span>♙</span><b v-show="!collapsed">承租人管理</b></router-link>
        <router-link to="/contracts" class="srms-nav-item"><span>▤</span><b v-show="!collapsed">合同管理</b></router-link>
        <router-link v-if="isAdmin" to="/contracts/changes" class="srms-nav-item srms-subnav"><span>↻</span><b v-show="!collapsed">合同变更</b></router-link>
        <p v-show="!collapsed">租赁财务</p>
        <router-link to="/payments" class="srms-nav-item"><span>✓</span><b v-show="!collapsed">收款管理</b></router-link>
        <router-link v-if="isAdmin" to="/pricing-rebates" class="srms-nav-item"><span>≈</span><b v-show="!collapsed">阶梯退差</b></router-link>
        <router-link v-if="isAdmin" to="/checkout" class="srms-nav-item"><span>↩</span><b v-show="!collapsed">退租结算</b></router-link>
        <router-link v-if="isSuperAdmin" to="/finance" class="srms-nav-item"><span>¥</span><b v-show="!collapsed">财务中心</b></router-link>
        <p v-if="isSuperAdmin" v-show="!collapsed">系统</p>
        <router-link v-if="isSuperAdmin" to="/admin/users" class="srms-nav-item"><span>♧</span><b v-show="!collapsed">用户管理</b></router-link>
        <router-link v-if="isSuperAdmin" to="/admin/system" class="srms-nav-item"><span>⚙</span><b v-show="!collapsed">系统管理</b></router-link>
      </nav>
    </aside>
    <section class="srms-main"><header class="srms-topbar"><button class="collapse-button" @click="collapsed = !collapsed">☰</button><span class="srms-crumb">首页 / <b>{{ currentPage }}</b></span><div class="srms-user"><span class="srms-avatar">{{ initial }}</span><span>{{ session.user?.displayName }}</span><el-button link type="primary" @click="logout">退出登录</el-button></div></header><main class="srms-content"><router-view /></main></section>
  </div>
</template>

<style>
.srms-shell { min-height:100vh; background:#f3f6fb; color:#233044; }
.srms-sidebar { position:fixed; inset:0 auto 0 0; z-index:50; width:222px; overflow-y:auto; background:#162338; color:#c6d1e2; padding:22px 14px; transition:width .2s ease; }
.srms-brand { display:flex; align-items:center; gap:10px; min-height:56px; padding:0 8px 18px; border-bottom:1px solid rgba(255,255,255,.09); }
.srms-logo { display:grid; width:36px; height:36px; place-items:center; flex:none; border-radius:10px; background:#347af6; color:white; font-size:18px; font-weight:800; }
.srms-brand b { display:block; color:white; font-size:16px; }.srms-brand small { display:block; max-width:130px; overflow:hidden; color:#8296b4; font-size:10px; text-overflow:ellipsis; white-space:nowrap; }
.srms-nav { padding-top:12px; }.srms-nav p { margin:15px 12px 7px; color:#7085a5; font-size:11px; }.srms-nav-item { display:flex; align-items:center; gap:11px; min-height:42px; margin:4px 0; padding:0 13px; border-radius:9px; color:#b9c7db; text-decoration:none; }.srms-nav-item span { width:18px; text-align:center; font-size:16px; }.srms-nav-item b { font-size:14px; font-weight:500; }.srms-nav-item:hover { background:rgba(255,255,255,.08); color:#fff; }.srms-nav-item.router-link-exact-active { background:#246bfd; color:#fff; box-shadow:0 7px 16px rgba(36,107,253,.25); }.srms-subnav { margin-left:8px; }
.srms-main { width:calc(100% - 222px); min-height:100vh; margin-left:222px; transition:margin .2s ease,width .2s ease; }.srms-topbar { position:sticky; top:0; z-index:40; display:flex; height:68px; align-items:center; gap:14px; padding:0 28px; border-bottom:1px solid #e5eaf1; background:#fff; }.collapse-button { border:0; background:transparent; color:#526075; cursor:pointer; font-size:20px; }.srms-crumb { color:#8390a2; }.srms-crumb b { color:#344257; }.srms-user { display:flex; align-items:center; gap:9px; margin-left:auto; color:#526075; }.srms-avatar { display:grid; width:32px; height:32px; place-items:center; border-radius:50%; background:#e2ecff; color:#246bfd; font-weight:700; }.srms-content { max-width:1500px; margin:auto; padding:24px 28px 40px; }.srms-content .users-page { width:100%; margin:0; padding:0 0 32px; }
.is-collapsed .srms-sidebar { width:64px; padding-inline:10px; }.is-collapsed .srms-brand { padding-inline:4px; }.is-collapsed .srms-nav-item { justify-content:center; padding-inline:0; }.is-collapsed .srms-subnav { margin-left:0; }.is-collapsed .srms-main { width:calc(100% - 64px); margin-left:64px; }
@media (max-width:760px) { .srms-sidebar { width:64px; padding-inline:10px; }.srms-brand { padding-inline:4px; }.srms-brand > div:last-child,.srms-nav p,.srms-nav-item b { display:none; }.srms-nav-item { justify-content:center; padding-inline:0; }.srms-main { width:calc(100% - 64px); margin-left:64px; }.srms-content { padding:18px 14px 28px; }.srms-crumb { display:none; }.srms-user > span:not(.srms-avatar) { display:none; } }
</style>
