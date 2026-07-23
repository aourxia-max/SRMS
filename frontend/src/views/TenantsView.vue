<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const canManage = computed(() => ['SUPER_ADMIN', 'ADMIN'].includes(session.user?.role ?? ''))
const tenants = ref<any[]>([])
const total = ref(0)
const keyword = ref('')
const dialog = ref(false)
const editingId = ref<number | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const form = reactive({ tenantType: 'INDIVIDUAL', name: '', phone: '', idType: 'ID_CARD', idNo: '', contactAddress: '', status: 'ACTIVE', remark: '' })
const defaultTenantType = ref('INDIVIDUAL')
const withoutEmptyFields = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== ''))
async function load() { const response = await http.get('/tenants', { params: { keyword: keyword.value || undefined } }); tenants.value = response.data.data.items; total.value = response.data.data.total }
function open(tenant?: any) { editingId.value = tenant?.id ?? null; Object.assign(form, tenant ?? { tenantType: defaultTenantType.value, name: '', phone: '', idType: 'ID_CARD', idNo: '', contactAddress: '', status: 'ACTIVE', remark: '' }); dialog.value = true }
async function save() { const data = withoutEmptyFields(form) as Partial<typeof form>; if (editingId.value && !data.idNo) delete data.idNo; if (editingId.value) await http.patch(`/tenants/${editingId.value}`, data); else await http.post('/tenants', data); await load(); dialog.value = false }
async function viewId(tenant: any) { const result = await http.get(`/tenants/${tenant.id}/sensitive`); ElMessage.success(`完整证件号码：${result.data.data.idNo ?? '未登记'}`) }
async function upload(tenant: any, event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; const data = new FormData(); data.append('file', file); await http.post(`/tenants/${tenant.id}/files`, data); ElMessage.success('证件附件已上传'); (event.target as HTMLInputElement).value = '' }
onMounted(async () => { const settings = await http.get('/system/defaults').catch(() => null); if (settings?.data?.data?.defaultTenantType) defaultTenantType.value = settings.data.data.defaultTenantType; await load() })
</script>

<template>
  <main class="users-page">
    <header><div><el-tag>Task005</el-tag><h1>承租人管理</h1><p>证件号码加密保存，列表始终只显示脱敏信息。</p></div><el-button v-if="canManage" type="primary" @click="open()">新增承租人</el-button></header>
    <el-card><div class="filters"><el-input v-model="keyword" placeholder="姓名或联系电话" clearable @keyup.enter="load" /><el-button @click="load">查询</el-button></div><p>共 {{ total }} 名承租人</p><el-table :data="tenants" stripe><el-table-column prop="name" label="姓名/单位" /><el-table-column label="类型"><template #default="{ row }">{{ row.tenantType === 'COMPANY' ? '单位' : '个人' }}</template></el-table-column><el-table-column prop="phone" label="联系电话" /><el-table-column prop="idType" label="证件类型" /><el-table-column prop="maskedIdNo" label="证件号码（脱敏）" /><el-table-column prop="status" label="状态" /><el-table-column label="操作" width="230"><template #default="{ row }"><el-button v-if="canManage" size="small" @click="open(row)">编辑</el-button><el-button v-if="canManage" size="small" @click="viewId(row)">查看证件</el-button><el-button v-if="canManage" size="small" @click="fileInput?.click()">上传附件</el-button><input ref="fileInput" hidden type="file" accept="image/jpeg,image/png,image/heic,application/pdf" @change="upload(row, $event)" /></template></el-table-column></el-table></el-card>
    <el-dialog v-model="dialog" :title="editingId ? '编辑承租人' : '新增承租人'" width="620"><el-form :model="form" label-position="top"><el-row :gutter="16"><el-col :span="12"><el-form-item label="类型"><el-select v-model="form.tenantType"><el-option label="个人" value="INDIVIDUAL" /><el-option label="单位" value="COMPANY" /></el-select></el-form-item></el-col><el-col :span="12"><el-form-item label="姓名/单位名称"><el-input v-model="form.name" /></el-form-item></el-col><el-col :span="12"><el-form-item label="联系电话"><el-input v-model="form.phone" /></el-form-item></el-col><el-col :span="12"><el-form-item label="证件类型"><el-input v-model="form.idType" /></el-form-item></el-col><el-col :span="24"><el-form-item :label="editingId ? '证件号码（留空表示不修改）' : '证件号码'"><el-input v-model="form.idNo" /></el-form-item></el-col><el-col :span="24"><el-form-item label="联系地址"><el-input v-model="form.contactAddress" /></el-form-item></el-col><el-col :span="12"><el-form-item label="状态"><el-select v-model="form.status"><el-option label="启用" value="ACTIVE" /><el-option label="停用" value="INACTIVE" /></el-select></el-form-item></el-col><el-col :span="24"><el-form-item label="备注"><el-input v-model="form.remark" type="textarea" /></el-form-item></el-col></el-row></el-form><template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template></el-dialog>
  </main>
</template>

<style scoped>.filters { display:flex; gap:12px; margin-bottom:16px; }</style>
