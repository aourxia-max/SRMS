<script setup lang="ts">
import { ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const router = useRouter()

async function signOut(allDevices = false) {
  if (allDevices) await ElMessageBox.confirm('这将退出所有已登录设备，是否继续？', '退出全部设备', { type: 'warning' })
  await session.logout(allDevices)
  await router.replace('/login')
}
</script>

<template>
  <main class="session-page">
    <el-card class="session-card" shadow="never">
      <el-tag type="success">登录状态有效</el-tag>
      <h1>欢迎，{{ session.user?.displayName }}</h1>
      <p>当前角色：{{ session.user?.role }}；Task002 仅提供安全会话验证，不包含业务驾驶舱。</p>
      <div class="session-actions">
        <el-button type="primary" @click="router.push('/properties')">楼栋与房源</el-button>
        <el-button type="primary" plain @click="router.push('/')">驾驶舱</el-button>
        <el-button type="primary" @click="router.push('/tenants')">承租人管理</el-button>
        <el-button type="primary" @click="router.push('/contracts')">合同管理</el-button>
        <el-button type="primary" plain @click="router.push('/contracts/changes')">合同变更</el-button>
        <el-button type="primary" plain @click="router.push('/payments')">收款登记</el-button>
        <el-button type="primary" plain @click="router.push('/pricing-rebates')">租金退差</el-button>
        <el-button type="primary" plain @click="router.push('/checkout')">押金与退租</el-button>
        <el-button v-if="session.user?.role === 'SUPER_ADMIN'" type="primary" plain @click="router.push('/finance')">财务中心</el-button>
        <el-button v-if="session.user?.role === 'SUPER_ADMIN'" type="primary" @click="router.push('/admin/users')">用户管理</el-button>
        <el-button @click="signOut(false)">退出当前设备</el-button>
        <el-button type="danger" plain @click="signOut(true)">退出全部设备</el-button>
      </div>
    </el-card>
  </main>
</template>
