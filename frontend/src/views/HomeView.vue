<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CircleCheck, Connection, DataBoard, Lock } from '@element-plus/icons-vue'
import { useAppStore } from '../stores/app'
import { http } from '../services/http'

const appStore = useAppStore()
const apiStatus = ref<'checking' | 'online' | 'offline'>('checking')

const apiStatusText = computed(() => ({
  checking: '检查中',
  online: '服务正常',
  offline: '等待启动',
})[apiStatus.value])

onMounted(async () => {
  try {
    await http.get('/health')
    apiStatus.value = 'online'
  } catch {
    apiStatus.value = 'offline'
  }
})
</script>

<template>
  <main class="bootstrap-page">
    <section class="hero-panel">
      <el-tag type="success" effect="light" round>Task001 已完成</el-tag>
      <h1>{{ appStore.projectName }}</h1>
      <p>项目工程已经就绪，下一步进入登录模块开发。</p>
    </section>

    <section class="status-grid">
      <el-card shadow="hover">
        <el-icon class="status-icon"><DataBoard /></el-icon>
        <h2>前端工程</h2>
        <p>Vue 3、TypeScript、Element Plus、Pinia 与路由已接入。</p>
      </el-card>
      <el-card shadow="hover">
        <el-icon class="status-icon"><Connection /></el-icon>
        <h2>后端接口</h2>
        <p>NestJS 健康检查：<el-tag size="small">{{ apiStatusText }}</el-tag></p>
      </el-card>
      <el-card shadow="hover">
        <el-icon class="status-icon"><Lock /></el-icon>
        <h2>权限基础</h2>
        <p>超级管理员、管理员与游客的数据库角色已建立。</p>
      </el-card>
      <el-card shadow="hover">
        <el-icon class="status-icon"><CircleCheck /></el-icon>
        <h2>需求基线</h2>
        <p>开发和验收统一以 SRMS-RB-1.0 冻结需求为准。</p>
      </el-card>
    </section>
  </main>
</template>
