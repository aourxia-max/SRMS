<script setup lang="ts">
import { ElMessageBox } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const canManage = computed(() => ['SUPER_ADMIN', 'ADMIN'].includes(session.user?.role ?? ''))
const buildings = ref<any[]>([])
const rooms = ref<any[]>([])
const buildingDialog = ref(false)
const roomDialog = ref(false)
const editingBuildingId = ref<number | null>(null)
const editingRoomId = ref<number | null>(null)
const historyDialog = ref(false)
const histories = ref<any[]>([])
const buildingFilter = ref<number | null>(null)
const statusFilter = ref<string | null>(null)
const statusOptions = ['EMPTY', 'PENDING_MOVE_IN', 'RENTED', 'PENDING_CHECKOUT', 'MAINTENANCE', 'FOR_SALE', 'SOLD', 'DISABLED', 'OTHER']
const statusLabels: Record<string, string> = { EMPTY: '空置', PENDING_MOVE_IN: '待入住', RENTED: '已出租', PENDING_CHECKOUT: '待退房', MAINTENANCE: '维修中', FOR_SALE: '待出售', SOLD: '已出售', DISABLED: '停用', OTHER: '其他' }
const buildingForm = reactive({ buildingNo: '', buildingName: '', floorCount: 6, sortOrder: 0, status: 'ACTIVE', remark: '' })
const roomForm = reactive({ buildingId: 0, houseNo: '', floorNo: 1, roomType: 'RESIDENTIAL', area: undefined as number | undefined, decorationStatus: 'UNKNOWN', usageType: 'RESIDENCE', ownerName: '', ownerPhone: '', ownerRemark: '', remark: '' })
const withoutEmptyFields = (form: Record<string, unknown>) => Object.fromEntries(Object.entries(form).filter(([, value]) => value !== '' && value !== undefined))

async function reload() {
  const [buildingResponse, roomResponse] = await Promise.all([http.get('/properties/buildings'), http.get('/properties/rooms')])
  buildings.value = buildingResponse.data.data
  rooms.value = roomResponse.data.data
}
function resetBuildingForm() { Object.assign(buildingForm, { buildingNo: '', buildingName: '', floorCount: 6, sortOrder: 0, status: 'ACTIVE', remark: '' }); editingBuildingId.value = null }
function resetRoomForm() { Object.assign(roomForm, { buildingId: 0, houseNo: '', floorNo: 1, roomType: 'RESIDENTIAL', area: undefined, decorationStatus: 'UNKNOWN', usageType: 'RESIDENCE', ownerName: '', ownerPhone: '', ownerRemark: '', remark: '' }); editingRoomId.value = null }
function openBuilding(building?: any) { resetBuildingForm(); if (building) { editingBuildingId.value = building.id; Object.assign(buildingForm, building) }; buildingDialog.value = true }
function openRoom(room?: any) { resetRoomForm(); if (room) { editingRoomId.value = room.id; Object.assign(roomForm, room) }; roomDialog.value = true }
async function saveBuilding() { const payload = withoutEmptyFields(buildingForm); if (editingBuildingId.value) await http.patch(`/properties/buildings/${editingBuildingId.value}`, payload); else await http.post('/properties/buildings', payload); await reload(); buildingDialog.value = false }
async function saveRoom() { const payload = withoutEmptyFields(roomForm); if (editingRoomId.value) await http.patch(`/properties/rooms/${editingRoomId.value}`, payload); else await http.post('/properties/rooms', payload); await reload(); roomDialog.value = false }
async function changeStatus(room: any, status: string) { await http.patch(`/properties/rooms/${room.id}/status`, { roomStatus: status }); await reload() }
async function showHistory(room: any) { histories.value = (await http.get(`/properties/rooms/${room.id}/history`)).data.data; historyDialog.value = true }
async function removeRoom(room: any) { await ElMessageBox.confirm(`确认删除房源 ${room.fullHouseNo} 吗？`, '删除确认', { type: 'warning' }); await http.delete(`/properties/rooms/${room.id}`); await reload() }
onMounted(reload)
</script>

<template>
  <main class="users-page">
    <header>
      <div><el-tag>Task004</el-tag><h1>楼栋与房源管理</h1><p>维护已冻结的房源资料、当前房态和状态历史。</p></div>
      <div v-if="canManage"><el-button @click="openBuilding()">新增楼栋</el-button><el-button type="primary" @click="openRoom()">新增房源</el-button></div>
    </header>
    <el-card class="building-card">
      <template #header>楼栋</template>
      <el-table :data="buildings" stripe>
        <el-table-column prop="buildingNo" label="楼栋编号" /><el-table-column prop="buildingName" label="楼栋名称" /><el-table-column prop="floorCount" label="楼层数" /><el-table-column prop="status" label="状态" />
        <el-table-column v-if="canManage" label="操作" width="100"><template #default="{ row }"><el-button size="small" @click="openBuilding(row)">编辑</el-button></template></el-table-column>
      </el-table>
    </el-card>
    <el-card>
      <p>楼栋数量：{{ buildings.length }}　房源数量：{{ rooms.length }}</p>
      <div class="filters"><el-select v-model="buildingFilter" clearable placeholder="全部楼栋"><el-option v-for="b in buildings" :key="b.id" :label="b.buildingNo" :value="b.id" /></el-select><el-select v-model="statusFilter" clearable placeholder="全部房态"><el-option v-for="s in statusOptions" :key="s" :label="statusLabels[s]" :value="s" /></el-select></div>
      <el-table :data="rooms.filter(r => (!buildingFilter || r.buildingId === buildingFilter) && (!statusFilter || r.roomStatus === statusFilter))" stripe>
        <el-table-column prop="fullHouseNo" label="完整房号" /><el-table-column label="楼栋"><template #default="{ row }">{{ row.building?.buildingNo }}</template></el-table-column><el-table-column prop="floorNo" label="楼层" /><el-table-column prop="roomType" label="类型" /><el-table-column prop="area" label="面积（㎡）" /><el-table-column prop="ownerName" label="业主" />
        <el-table-column label="房态" width="150"><template #default="{ row }"><el-select v-if="canManage" :model-value="row.roomStatus" size="small" @change="changeStatus(row, String($event))"><el-option v-for="s in statusOptions" :key="s" :label="statusLabels[s]" :value="s" /></el-select><span v-else>{{ statusLabels[row.roomStatus] }}</span></template></el-table-column>
        <el-table-column label="操作" width="210"><template #default="{ row }"><el-button size="small" @click="showHistory(row)">历史</el-button><el-button v-if="canManage" size="small" @click="openRoom(row)">编辑</el-button><el-button v-if="canManage" size="small" type="danger" plain @click="removeRoom(row)">删除</el-button></template></el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="buildingDialog" :title="editingBuildingId ? '编辑楼栋' : '新增楼栋'" width="520"><el-form :model="buildingForm" label-position="top"><el-form-item label="楼栋编号"><el-input v-model="buildingForm.buildingNo" placeholder="例如：1栋" /></el-form-item><el-form-item label="楼栋名称"><el-input v-model="buildingForm.buildingName" /></el-form-item><el-form-item label="楼层数"><el-input-number v-model="buildingForm.floorCount" :min="1" /></el-form-item><el-form-item label="显示顺序"><el-input-number v-model="buildingForm.sortOrder" /></el-form-item><el-form-item label="状态"><el-select v-model="buildingForm.status"><el-option label="启用" value="ACTIVE" /><el-option label="停用" value="DISABLED" /></el-select></el-form-item><el-form-item label="备注"><el-input v-model="buildingForm.remark" type="textarea" /></el-form-item></el-form><template #footer><el-button @click="buildingDialog = false">取消</el-button><el-button type="primary" @click="saveBuilding">保存</el-button></template></el-dialog>
    <el-dialog v-model="roomDialog" :title="editingRoomId ? '编辑房源' : '新增房源'" width="620"><el-form :model="roomForm" label-position="top"><el-row :gutter="16"><el-col :span="12"><el-form-item label="所属楼栋"><el-select v-model="roomForm.buildingId"><el-option v-for="b in buildings" :key="b.id" :label="b.buildingNo" :value="b.id" /></el-select></el-form-item></el-col><el-col :span="12"><el-form-item label="房号"><el-input v-model="roomForm.houseNo" /></el-form-item></el-col><el-col :span="12"><el-form-item label="楼层"><el-input-number v-model="roomForm.floorNo" :min="1" /></el-form-item></el-col><el-col :span="12"><el-form-item label="面积（㎡）"><el-input-number v-model="roomForm.area" :min="0" :precision="2" /></el-form-item></el-col><el-col :span="12"><el-form-item label="类型"><el-select v-model="roomForm.roomType"><el-option label="住宅" value="RESIDENTIAL" /><el-option label="商铺" value="SHOP" /></el-select></el-form-item></el-col><el-col :span="12"><el-form-item label="装修状态"><el-select v-model="roomForm.decorationStatus"><el-option label="未知" value="UNKNOWN" /><el-option label="已装修" value="RENOVATED" /><el-option label="未装修" value="UNRENOVATED" /><el-option label="装修中" value="RENOVATING" /></el-select></el-form-item></el-col><el-col :span="12"><el-form-item label="用途"><el-select v-model="roomForm.usageType"><el-option label="居住" value="RESIDENCE" /><el-option label="商铺" value="SHOP" /><el-option label="办公" value="OFFICE" /><el-option label="仓储" value="STORAGE" /><el-option label="其他" value="OTHER" /></el-select></el-form-item></el-col><el-col :span="12"><el-form-item label="业主姓名"><el-input v-model="roomForm.ownerName" /></el-form-item></el-col><el-col :span="12"><el-form-item label="业主电话"><el-input v-model="roomForm.ownerPhone" /></el-form-item></el-col><el-col :span="12"><el-form-item label="业主备注"><el-input v-model="roomForm.ownerRemark" /></el-form-item></el-col></el-row><el-form-item label="房源备注"><el-input v-model="roomForm.remark" type="textarea" /></el-form-item></el-form><template #footer><el-button @click="roomDialog = false">取消</el-button><el-button type="primary" @click="saveRoom">保存</el-button></template></el-dialog>
    <el-dialog v-model="historyDialog" title="房态历史" width="620"><el-table :data="histories"><el-table-column prop="fromStatus" label="原状态" /><el-table-column prop="toStatus" label="新状态" /><el-table-column prop="changeReason" label="原因" /><el-table-column prop="changedAt" label="时间" /></el-table></el-dialog>
  </main>
</template>

<style scoped>
.building-card { margin-bottom: 16px; }
.filters { display: flex; gap: 12px; margin-bottom: 16px; }
</style>
