<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'

type RoomStatus =
  | 'EMPTY'
  | 'PENDING_MOVE_IN'
  | 'RENTED'
  | 'PENDING_CHECKOUT'
  | 'MAINTENANCE'
  | 'FOR_SALE'
  | 'SOLD'
  | 'DISABLED'
  | 'OTHER'

type DashboardRoom = {
  id: number
  fullHouseNo: string
  houseNo: string
  floorNo?: number | null
  roomStatus: RoomStatus
  decorationStatus?: string | null
  statusChangedAt?: string | null
  building?: { id: number; buildingName: string }
}

const router = useRouter()
const session = useSessionStore()
const data = ref<any>({
  roomSummary: { statusCounts: {}, rooms: [] },
  rentReminders: [],
  arrears: [],
  expiringContracts: [],
  approvals: {},
  rentCollectionOverview: null,
  monthlyMoveInCount: 0,
  monthlyCheckoutCount: 0,
})
const roomMapData = ref<any>({
  roomSummary: { statusCounts: {}, rooms: [] },
})
const buildings = ref<any[]>([])
const filters = reactive({
  buildingId: undefined as number | undefined,
})
const roomMapFilters = reactive({
  buildingId: undefined as number | undefined,
  statuses: [] as RoomStatus[],
})

const isSuper = computed(() => session.user?.role === 'SUPER_ADMIN')
const statusMeta: Record<RoomStatus, { label: string; className: string; color: string }> = {
  EMPTY: { label: '空置', className: 'empty', color: '#20a37a' },
  PENDING_MOVE_IN: { label: '待入住', className: 'movein', color: '#7d5ce7' },
  RENTED: { label: '已出租', className: 'rented', color: '#246bfd' },
  PENDING_CHECKOUT: { label: '待退租', className: 'checkout', color: '#e98216' },
  MAINTENANCE: { label: '维修中', className: 'repair', color: '#d4b52a' },
  FOR_SALE: { label: '待出售', className: 'forsale', color: '#7d5ce7' },
  SOLD: { label: '已出售', className: 'sold', color: '#8c95a3' },
  DISABLED: { label: '停用', className: 'disabled', color: '#737981' },
  OTHER: { label: '其他', className: 'disabled', color: '#8c95a3' },
}
const statusOptions = Object.entries(statusMeta).map(([value, item]) => ({ value, ...item }))

const rooms = computed<DashboardRoom[]>(() => roomMapData.value.roomSummary?.rooms ?? [])
const monthValue = computed(() => new Date().toISOString().slice(0, 7))
const totalApprovals = computed(() =>
  Number(data.value.approvals?.billAdjustments || 0) +
  Number(data.value.approvals?.paymentRefunds || 0) +
  Number(data.value.approvals?.pricingRebates || 0),
)
const rentCollection = computed(() => data.value.rentCollectionOverview)
const collectionRate = computed(() => {
  const value = rentCollection.value?.collectionRate
  return value === null || value === undefined ? null : Number(value)
})
const collectionProgress = computed(() => Math.min(Math.max(collectionRate.value ?? 0, 0), 100))
const collectionMonth = computed(() => {
  const from = rentCollection.value?.period?.from as string | undefined
  return from ? `${from.slice(0, 4)}年${Number(from.slice(5, 7))}月` : '本月'
})
const collectionState = computed(() => {
  if (!rentCollection.value || Number(rentCollection.value.netReceivable || 0) === 0) return '本月暂无应收租金'
  if (data.value.arrears?.length) return '存在逾期欠租，请优先跟进'
  if (collectionRate.value === 100) return '本月租金已全部收齐'
  return '仍有本月租金待收'
})
const todoItems = computed(() => [
  {
    title: '逾期未收',
    desc: '仍有未结清的逾期账单',
    count: data.value.arrears?.length || 0,
    tone: 'danger',
    path: '/payments',
  },
  {
    title: `${data.value.rentReminderDays || 7} 天内应缴`,
    desc: '即将到期的租金账单',
    count: data.value.rentReminders?.length || 0,
    tone: 'warning',
    path: '/payments',
  },
  {
    title: '合同即将到期',
    desc: `未来 ${data.value.contractExpiryDays || 30} 天内到期`,
    count: data.value.expiringContracts?.length || 0,
    tone: 'primary',
    path: '/contracts',
  },
  {
    title: '审批待处理',
    desc: '账单、退款、阶梯退差待审批',
    count: totalApprovals.value,
    tone: 'purple',
    path: '/contracts/changes',
  },
  {
    title: '长期空置',
    desc: `连续空置超过 ${data.value.longVacancyDays || 30} 天`,
    count: data.value.longVacancyRooms?.length || 0,
    tone: 'green',
    path: '/properties',
  },
])
const floorGroups = computed(() => {
  const grouped = new Map<string, DashboardRoom[]>()
  for (const room of rooms.value) {
    const floor = room.floorNo === null || room.floorNo === undefined ? '未分层' : `${room.floorNo}F`
    grouped.set(floor, [...(grouped.get(floor) ?? []), room])
  }
  return [...grouped.entries()].sort((a, b) => {
    const av = Number.parseInt(a[0])
    const bv = Number.parseInt(b[0])
    if (Number.isNaN(av) || Number.isNaN(bv)) return a[0].localeCompare(b[0], 'zh-CN')
    return bv - av
  })
})
const composition = computed(() => {
  const counts = data.value.roomSummary?.statusCounts ?? {}
  const operating = Number(data.value.roomSummary?.operating || 0)
  const forSale = Number(counts.FOR_SALE || 0)
  const sold = Number(counts.SOLD || 0)
  const other = Math.max(Number(data.value.roomSummary?.total || 0) - operating - forSale - sold, 0)
  return { operating, forSale, sold, other }
})

function statusLabel(status: string) {
  return statusMeta[status as RoomStatus]?.label ?? status
}
function statusClass(status: string) {
  return statusMeta[status as RoomStatus]?.className ?? 'disabled'
}
function statusCount(status: string) {
  return roomMapData.value.roomSummary?.statusCounts?.[status] ?? 0
}
function formatMoney(value: unknown) {
  const amount = Number(value || 0)
  return `￥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function formatDate(value: string | Date | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('zh-CN')
}
function tenantName(row: any) {
  return row.contract?.members?.[0]?.tenant?.name || '-'
}
async function load() {
  const params: any = {}
  if (filters.buildingId) params.buildingId = filters.buildingId
  data.value = (await http.get('/dashboard', { params })).data.data
}
async function loadRoomMap() {
  const params: any = {}
  if (roomMapFilters.buildingId) params.buildingId = roomMapFilters.buildingId
  if (roomMapFilters.statuses.length) params.statuses = roomMapFilters.statuses.join(',')
  roomMapData.value = (await http.get('/dashboard', { params })).data.data
}
async function init() {
  buildings.value = (await http.get('/properties/buildings')).data.data
  await Promise.all([load(), loadRoomMap()])
}
onMounted(init)
</script>

<template>
  <main class="dashboard-page">
    <header class="page-head">
      <div>
        <el-tag type="primary" effect="light">经营驾驶舱</el-tag>
        <h1>经营概览</h1>
        <p>按房源状态、租金待办和合同履行情况快速判断今日重点。</p>
      </div>
      <div class="head-actions">
        <el-date-picker :model-value="monthValue" type="month" disabled format="YYYY年MM月" />
        <el-select v-model="filters.buildingId" clearable placeholder="全部楼栋" @change="load">
          <el-option v-for="item in buildings" :key="item.id" :label="item.buildingName" :value="item.id" />
        </el-select>
        <el-button type="primary" @click="load">刷新数据</el-button>
      </div>
    </header>

    <section class="metrics">
      <article class="metric">
        <span>房源总数</span>
        <b>{{ data.roomSummary.total || 0 }}</b>
        <small>当前筛选范围内全部有效房源</small>
      </article>
      <article class="metric">
        <span>可经营房源</span>
        <b>{{ data.roomSummary.operating || 0 }}</b>
        <small>空置、已租、待入住、待退租、维修</small>
      </article>
      <article class="metric">
        <span>出租率</span>
        <b>{{ data.roomSummary.occupancyRate === null ? '-' : `${data.roomSummary.occupancyRate}%` }}</b>
        <small>已出租 / 可经营房源</small>
      </article>
      <article class="metric fin">
        <span>催租事项</span>
        <b>{{ data.rentReminders.length }}</b>
        <small>未来 {{ data.rentReminderDays || 7 }} 天待收</small>
      </article>
      <article class="metric fin">
        <span>合同到期</span>
        <b>{{ data.expiringContracts.length }}</b>
        <small>未来 {{ data.contractExpiryDays || 30 }} 天到期</small>
      </article>
      <article class="metric alert">
        <span>累计欠租</span>
        <b>{{ isSuper ? formatMoney(data.arrearsTotal) : data.arrears.length }}</b>
        <small>{{ isSuper ? `涉及 ${data.arrears.length} 份账单` : '待跟进账单' }}</small>
      </article>
    </section>

    <section class="cockpit-grid">
      <div class="left-stack">
        <el-card class="panel-card" shadow="never">
          <template #header>
            <div class="panel-head">
              <div>
                <h2>本月租金收缴概览</h2>
                <small>按账期经营口径统计 · {{ collectionMonth }}</small>
              </div>
              <el-button text type="primary" @click="router.push('/finance')">查看财务中心</el-button>
            </div>
          </template>
          <div v-if="isSuper && rentCollection" class="collection-overview">
            <div class="collection-metrics">
              <div class="collection-metric primary"><span>本月应收</span><b>{{ formatMoney(rentCollection.netReceivable) }}</b></div>
              <div class="collection-metric success"><span>本月已收</span><b>{{ formatMoney(rentCollection.validReceived) }}</b></div>
              <div class="collection-metric warning"><span>本月未收</span><b>{{ formatMoney(rentCollection.outstanding) }}</b></div>
              <div class="collection-metric danger"><span>逾期欠租</span><b>{{ formatMoney(data.arrearsTotal) }}</b></div>
              <div class="collection-metric move-in"><span>本月新增租房</span><b>{{ data.monthlyMoveInCount || 0 }}</b><small>合同开始日期在本月</small></div>
              <div class="collection-metric checkout-count"><span>本月实际退租</span><b>{{ data.monthlyCheckoutCount || 0 }}</b><small>已完成退租结算</small></div>
            </div>
            <div class="collection-progress-head">
              <span>本月收缴率 <b>{{ collectionRate === null ? '-' : `${collectionRate}%` }}</b></span>
              <small>{{ collectionState }}</small>
            </div>
            <el-progress :percentage="collectionProgress" :show-text="false" :stroke-width="10" :color="data.arrears.length ? '#e5484d' : '#25a26f'" />
          </div>
          <div v-else class="collection-safe-summary">
            <div><span>待收提醒</span><b>{{ data.rentReminders.length }} 笔</b></div>
            <div><span>逾期欠租</span><b>{{ data.arrears.length }} 笔</b></div>
            <div><span>本月新增租房</span><b>{{ data.monthlyMoveInCount || 0 }}</b></div>
            <div><span>本月实际退租</span><b>{{ data.monthlyCheckoutCount || 0 }}</b></div>
            <small>金额与收缴率仅对超级管理员展示。</small>
          </div>
        </el-card>

        <el-card class="panel-card room-map-card" shadow="never">
          <template #header>
            <div class="panel-head">
              <div>
                <h2>楼栋房态图</h2>
                <small>颜色表示房源状态，点击房间进入房源管理。</small>
              </div>
              <div class="room-tools">
                <el-select
                  v-model="roomMapFilters.buildingId"
                  clearable
                  placeholder="筛选楼栋"
                  @change="loadRoomMap"
                >
                  <el-option
                    v-for="item in buildings"
                    :key="item.id"
                    :label="item.buildingName || item.buildingNo"
                    :value="item.id"
                  />
                </el-select>
                <el-select
                  v-model="roomMapFilters.statuses"
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  clearable
                  placeholder="全部房态"
                  @change="loadRoomMap"
                >
                  <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
                <el-button @click="router.push('/properties')">房源管理</el-button>
              </div>
            </div>
          </template>

          <div class="legend">
            <span v-for="item in statusOptions" :key="item.value">
              <i :style="{ background: item.color }"></i>{{ item.label }} <strong>{{ statusCount(item.value) }}</strong>
            </span>
          </div>
          <el-empty v-if="!rooms.length" description="当前筛选下暂无房源" />
          <div v-else class="building-map">
            <div v-for="[floor, floorRooms] in floorGroups" :key="floor" class="floor-row">
              <div class="floor-name">{{ floor }}</div>
              <button
                v-for="room in floorRooms"
                :key="room.id"
                class="room-cell"
                :class="statusClass(room.roomStatus)"
                @click="router.push({ name: 'room-detail', params: { id: room.id } })"
              >
                <b>{{ room.fullHouseNo || room.houseNo }}</b>
                <span class="room-status">{{ statusLabel(room.roomStatus) }}</span>
                <span class="room-owner">{{ room.building?.buildingName || '未设置楼栋' }}</span>
              </button>
            </div>
          </div>
        </el-card>

      </div>

      <aside class="right-stack">
        <el-card class="panel-card" shadow="never">
          <template #header>
            <div class="panel-head">
              <div>
                <h2>今日待办</h2>
                <small>需要优先处理的业务</small>
              </div>
            </div>
          </template>
          <div class="todo-list">
            <button v-for="item in todoItems" :key="item.title" class="todo" :class="item.tone" @click="router.push(item.path)">
              <span class="todo-icon">{{ item.count }}</span>
              <span><b>{{ item.title }}</b><small>{{ item.desc }}</small></span>
              <strong>{{ item.count }}</strong>
            </button>
          </div>
        </el-card>

        <el-card class="panel-card" shadow="never">
          <template #header>
            <div class="panel-head">
              <div>
                <h2>房源构成</h2>
                <small>全部 {{ data.roomSummary.total || 0 }} 套房源</small>
              </div>
            </div>
          </template>
          <div class="composition">
            <div class="donut">
              <span>{{ data.roomSummary.total || 0 }}</span>
              <small>房源总数</small>
            </div>
            <ul>
              <li><i class="green"></i>经营房源 <b>{{ composition.operating }}</b></li>
              <li><i class="purple"></i>待出售 <b>{{ composition.forSale }}</b></li>
              <li><i class="gray"></i>已出售 <b>{{ composition.sold }}</b></li>
              <li><i class="muted"></i>其他 <b>{{ composition.other }}</b></li>
            </ul>
          </div>
        </el-card>
      </aside>
    </section>

    <section class="table-grid">
      <el-card class="panel-card" shadow="never">
        <template #header>未来 {{ data.rentReminderDays || 7 }} 天催租</template>
        <el-empty v-if="!data.rentReminders.length" description="暂无催租事项" />
        <el-table v-else :data="data.rentReminders" size="small">
          <el-table-column prop="contract.room.fullHouseNo" label="房号" min-width="110" />
          <el-table-column label="承租人" min-width="110"><template #default="{ row }">{{ tenantName(row) }}</template></el-table-column>
          <el-table-column label="应缴日" min-width="110"><template #default="{ row }">{{ formatDate(row.dueDate) }}</template></el-table-column>
          <el-table-column label="未收金额" align="right" min-width="120"><template #default="{ row }">{{ formatMoney(row.outstandingAmount) }}</template></el-table-column>
        </el-table>
      </el-card>
      <el-card class="panel-card" shadow="never">
        <template #header>逾期欠租</template>
        <el-empty v-if="!data.arrears.length" description="暂无逾期欠租" />
        <el-table v-else :data="data.arrears" size="small">
          <el-table-column prop="contract.room.fullHouseNo" label="房号" min-width="110" />
          <el-table-column label="承租人" min-width="110"><template #default="{ row }">{{ tenantName(row) }}</template></el-table-column>
          <el-table-column label="应缴日" min-width="110"><template #default="{ row }">{{ formatDate(row.dueDate) }}</template></el-table-column>
          <el-table-column label="未收金额" align="right" min-width="120"><template #default="{ row }">{{ formatMoney(row.outstandingAmount) }}</template></el-table-column>
        </el-table>
      </el-card>
    </section>

    <el-card class="panel-card" shadow="never">
      <template #header>长期空置预警（超过 {{ data.longVacancyDays || 30 }} 天）</template>
      <el-empty v-if="!data.longVacancyRooms?.length" description="暂无长期空置房源" />
      <el-table v-else :data="data.longVacancyRooms" size="small">
        <el-table-column prop="fullHouseNo" label="房号" min-width="120" />
        <el-table-column prop="building.buildingName" label="楼栋" min-width="120" />
        <el-table-column label="空置起始时间" min-width="140"><template #default="{ row }">{{ formatDate(row.statusChangedAt) }}</template></el-table-column>
      </el-table>
    </el-card>
  </main>
</template>

<style scoped>
.dashboard-page { color:#233044; }
.page-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:18px; }
.page-head h1 { margin:7px 0 6px; font-size:24px; font-weight:750; }
.page-head p { margin:0; color:#748196; }
.head-actions { display:flex; align-items:center; gap:8px; }
.head-actions :deep(.el-select) { width:160px; }
.metrics { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
.metric { min-height:94px; padding:15px 16px; border:1px solid #e7ecf3; border-radius:12px; background:#fff; box-shadow:0 10px 28px rgba(28,52,84,.07); }
.metric span { color:#748196; font-size:12px; }
.metric b { display:block; margin-top:8px; color:#233044; font-size:24px; font-weight:760; }
.metric small { display:block; margin-top:5px; color:#8a96a7; font-size:11px; }
.metric.fin b { color:#246bfd; }
.metric.alert b { color:#d64949; }
.cockpit-grid { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(330px,.7fr); gap:16px; margin-bottom:16px; }
.left-stack,.right-stack { display:grid; gap:16px; align-content:start; }
.panel-card { border:1px solid #e7ecf3; border-radius:12px; box-shadow:0 10px 28px rgba(28,52,84,.07); }
.panel-head { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.panel-head h2 { margin:0; font-size:16px; }
.panel-head small { color:#8792a2; }
.room-tools { display:flex; gap:8px; align-items:center; }
.room-tools :deep(.el-select) { width:210px; }
.legend { display:flex; flex-wrap:wrap; gap:13px; margin-bottom:14px; color:#647085; font-size:12px; }
.legend i { display:inline-block; width:9px; height:9px; margin-right:5px; border-radius:3px; }
.legend strong { margin-left:3px; color:#334155; }
.building-map { display:grid; gap:8px; max-height:430px; overflow:auto; }
.floor-row { display:grid; grid-template-columns:58px repeat(auto-fill,minmax(112px,1fr)); gap:8px; align-items:stretch; }
.floor-name { display:grid; place-items:center; min-height:76px; border-radius:8px; background:#f2f5f9; color:#6a778a; font-weight:700; }
.room-cell { min-height:76px; padding:9px 10px; border:1px solid transparent; border-radius:9px; cursor:pointer; text-align:left; transition:.18s; }
.room-cell:hover { transform:translateY(-2px); box-shadow:0 7px 16px rgba(30,50,80,.13); }
.room-cell b { display:block; font-size:13px; }
.room-status,.room-owner { display:block; margin-top:5px; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.room-owner { color:#68758a; }
.rented { background:#eaf1ff; border-color:#9dbbf7; color:#174ea6; }
.empty { background:#e8f7f2; border-color:#91d5c1; color:#116c52; }
.movein { background:#f1edff; border-color:#c9bdf6; color:#6543c4; }
.checkout { background:#fff1df; border-color:#f5c98f; color:#b76112; }
.repair { background:#fff8d9; border-color:#eedc7b; color:#8b7114; }
.sold { background:#eceff3; border-color:#cbd2dc; color:#5c6572; }
.forsale { background:#f1edff; border-color:#c9bdf6; color:#6543c4; }
.disabled { background:#e8eaed; border-color:#c8cbd1; color:#737981; }
.todo-list { display:grid; gap:1px; }
.todo { display:grid; grid-template-columns:42px 1fr auto; gap:11px; align-items:center; width:100%; padding:12px 0; border:0; border-bottom:1px solid #edf1f5; background:transparent; text-align:left; cursor:pointer; }
.todo:last-child { border-bottom:0; }
.todo-icon { display:grid; width:38px; height:38px; place-items:center; border-radius:10px; font-weight:750; }
.todo b { display:block; color:#233044; font-size:13px; }
.todo small { display:block; margin-top:3px; color:#7b8798; font-size:11px; }
.todo strong { font-size:18px; }
.todo.danger .todo-icon { background:#fff0f0; color:#d64545; }
.todo.warning .todo-icon { background:#fff5e8; color:#d87714; }
.todo.primary .todo-icon { background:#eef3ff; color:#246bfd; }
.todo.purple .todo-icon { background:#f3efff; color:#7654d7; }
.todo.green .todo-icon { background:#eef8f5; color:#208262; }
.composition { display:grid; grid-template-columns:132px 1fr; gap:18px; align-items:center; }
.donut { display:grid; width:132px; height:132px; place-items:center; align-content:center; border:20px solid #e9f0ff; border-top-color:#22a06b; border-right-color:#7d5ce7; border-radius:50%; }
.donut span { color:#273449; font-size:25px; font-weight:760; }
.donut small { color:#7b8798; font-size:11px; }
.composition ul { display:grid; gap:9px; margin:0; padding:0; list-style:none; color:#657185; font-size:12px; }
.composition li { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.composition i { width:9px; height:9px; border-radius:50%; }
.composition .green { background:#22a06b; }
.composition .purple { background:#7d5ce7; }
.composition .gray { background:#8c95a3; }
.composition .muted { background:#c4ccd8; }
.collection-overview { display:grid; gap:17px; padding:2px 0 4px; }
.collection-metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.collection-metric { min-width:0; padding:12px; border:1px solid #e8edf4; border-radius:10px; background:#f8fafc; }
.collection-metric span { display:block; color:#748197; font-size:12px; }
.collection-metric b { display:block; margin-top:7px; overflow:hidden; color:#24334a; font-size:18px; text-overflow:ellipsis; white-space:nowrap; }
.collection-metric.primary { background:#f0f5ff; border-color:#d9e6ff; }.collection-metric.success { background:#effaf5; border-color:#d7f0e4; }.collection-metric.warning { background:#fff8ea; border-color:#f8e5b7; }.collection-metric.danger { background:#fff2f2; border-color:#ffd9da; }.collection-metric.danger b { color:#d33f46; }
.collection-metric.move-in { background:#eef9f5; border-color:#ccebdd; }.collection-metric.move-in b { color:#14795b; }
.collection-metric.checkout-count { background:#f2f5ff; border-color:#d8e1ff; }.collection-metric.checkout-count b { color:#315fc4; }
.collection-progress-head { display:flex; align-items:center; justify-content:space-between; gap:12px; color:#506078; font-size:12px; }.collection-progress-head b { color:#24334a; font-size:16px; }.collection-progress-head small { color:#7b8798; }
.collection-safe-summary { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }.collection-safe-summary > div { padding:12px; border-radius:10px; background:#f8fafc; }.collection-safe-summary span,.collection-safe-summary b { display:block; }.collection-safe-summary span,.collection-safe-summary small { color:#748197; font-size:12px; }.collection-safe-summary b { margin-top:6px; color:#24334a; font-size:19px; }.collection-safe-summary small { grid-column:1/-1; }
.table-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
@media (max-width:1200px) { .metrics { grid-template-columns:repeat(3,1fr); } .cockpit-grid,.table-grid { grid-template-columns:1fr; } .collection-safe-summary { grid-template-columns:repeat(2,1fr); } }
@media (max-width:760px) { .page-head,.head-actions,.panel-head,.room-tools { align-items:stretch; flex-direction:column; } .metrics { grid-template-columns:1fr; } .floor-row { grid-template-columns:1fr 1fr; } .floor-name { min-height:36px; grid-column:1/-1; } .composition,.collection-metrics,.collection-safe-summary { grid-template-columns:1fr; }.collection-progress-head { align-items:flex-start; flex-direction:column; gap:4px; } }
</style>
