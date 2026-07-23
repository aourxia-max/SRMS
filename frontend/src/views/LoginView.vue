<script setup lang="ts">
import { Lock, User } from '@element-plus/icons-vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session'
import { useAppStore } from '../stores/app'

const router = useRouter()
const route = useRoute()
const session = useSessionStore()
const appStore = useAppStore()
const formRef = ref<FormInstance>()
const submitting = ref(false)
const form = reactive({ username: '', password: '' })
const rules: FormRules = {
  username: [{ required: true, message: '请输入登录名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}
onMounted(() => appStore.loadProjectName())

async function submit() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  submitting.value = true
  try {
    await session.login(form.username, form.password)
    await router.replace((route.query.redirect as string) || '/')
  } catch {
    ElMessage.error('登录失败，请检查登录名、密码或账户状态')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <div class="login-heading">
        <span>SRMS</span>
        <h1>{{ appStore.projectName }}</h1>
        <p>请输入您的系统登录凭据</p>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="登录名" prop="username">
          <el-input v-model="form.username" :prefix-icon="User" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" :prefix-icon="Lock" type="password" show-password autocomplete="current-password" @keyup.enter="submit" />
        </el-form-item>
        <el-button class="login-button" type="primary" native-type="submit" :loading="submitting">登录</el-button>
      </el-form>
    </section>
  </main>
</template>
