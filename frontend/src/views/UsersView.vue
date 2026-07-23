<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { http } from '../services/http'
type User = { id: number; username: string; displayName: string; role: string; phone: string | null; status: string }
const users = ref<User[]>([])
const dialog = ref(false)
const editing = ref<User | null>(null)
const form = reactive({ username: '', displayName: '', role: 'ADMIN', phone: '', password: '' })
async function load() { users.value = (await http.get('/admin/users')).data.data }
function openCreate() { editing.value = null; Object.assign(form, { username: '', displayName: '', role: 'ADMIN', phone: '', password: '' }); dialog.value = true }
function openEdit(user: User) { editing.value = user; Object.assign(form, { username: user.username, displayName: user.displayName, role: user.role, phone: user.phone ?? '', password: '' }); dialog.value = true }
async function save() { if (editing.value) await http.patch(`/admin/users/${editing.value.id}`, { displayName: form.displayName, role: form.role, phone: form.phone || null }); else await http.post('/admin/users', form); ElMessage.success(editing.value ? '用户已更新' : '用户已创建'); dialog.value = false; await load() }
async function toggle(user: User) { try { await http.patch(`/admin/users/${user.id}`, { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }); await load() } catch { ElMessage.error('操作被拒绝，请确认系统仍保留启用的超级管理员') } }
async function resetPassword(user: User) { const { value } = await ElMessageBox.prompt(`为“${user.displayName}”设置新密码`, '重置密码', { inputType: 'password', inputValidator: (v) => v.length >= 8 || '密码至少需要 8 位' }); await http.post(`/admin/users/${user.id}/reset-password`, { password: value }); ElMessage.success('密码已重置，该用户需要重新登录') }
onMounted(load)
</script>
<template><main class="users-page"><header><div><el-tag>Task003</el-tag><h1>用户管理</h1><p>仅超级管理员可管理系统用户、角色和账号状态。</p></div><el-button type="primary" @click="openCreate">新增用户</el-button></header><el-table :data="users" stripe><el-table-column prop="username" label="登录名"/><el-table-column prop="displayName" label="显示姓名"/><el-table-column prop="role" label="角色"/><el-table-column prop="phone" label="联系电话"/><el-table-column prop="status" label="账号状态"/><el-table-column label="操作" width="270"><template #default="{row}"><el-button size="small" @click="openEdit(row)">编辑</el-button><el-button size="small" @click="resetPassword(row)">重置密码</el-button><el-button size="small" @click="toggle(row)">{{ row.status === 'ACTIVE' ? '停用' : '启用' }}</el-button></template></el-table-column></el-table><el-dialog v-model="dialog" :title="editing ? '编辑用户' : '新增用户'" width="440"><el-form :model="form" label-position="top"><el-form-item label="登录名"><el-input v-model="form.username" :disabled="Boolean(editing)"/></el-form-item><el-form-item label="显示姓名"><el-input v-model="form.displayName"/></el-form-item><el-form-item label="角色"><el-select v-model="form.role"><el-option label="超级管理员" value="SUPER_ADMIN"/><el-option label="管理员" value="ADMIN"/><el-option label="游客" value="VISITOR"/></el-select></el-form-item><el-form-item label="联系电话"><el-input v-model="form.phone"/></el-form-item><el-form-item v-if="!editing" label="初始密码"><el-input v-model="form.password" type="password" show-password/></el-form-item></el-form><template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template></el-dialog></main></template>
