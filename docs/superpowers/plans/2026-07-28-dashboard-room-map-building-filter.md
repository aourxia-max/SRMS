# 驾驶舱楼栋房态图楼栋筛选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让驾驶舱房态图可独立按楼栋筛选，且不改变全局经营指标。

**Architecture:** `DashboardView.vue` 保留现有 `data` 作为全局驾驶舱数据，新增仅供房态图使用的 `roomMapData` 和 `roomMapFilters`。筛选变更时仅调用已有驾驶舱接口并替换 `roomMapData`。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Axios。

## Global Constraints

- 使用现有后端接口，不修改冻结业务规则、数据库或权限。
- 卡片筛选仅影响房态图、房态图图例和数量。
- 所有中文文案使用中文。

---

### Task 1: 独立房态图状态与加载逻辑

**Files:**
- Modify: `frontend/src/views/DashboardView.vue`

- [x] **Step 1: 建立失败前验证点**

运行 `npm --prefix frontend run build`，确认修改前前端可构建。

- [x] **Step 2: 添加独立状态和请求函数**

新增 `roomMapData`、`roomMapFilters` 与 `loadRoomMap()`；`loadRoomMap()` 仅将卡片的 `buildingId` 和多选 `statuses` 传给 `/dashboard`，不改写全局 `data`。

- [x] **Step 3: 将房态图计算属性改为读取独立数据**

将房源列表、房态数量、房态构成等房态图专用计算逻辑改读 `roomMapData.roomSummary`。

- [x] **Step 4: 构建验证**

运行 `npm --prefix frontend run build`，预期退出码为 0。

### Task 2: 卡片内楼栋筛选与手工验收

**Files:**
- Modify: `frontend/src/views/DashboardView.vue`

- Modify: `docs/task012-acceptance.md`

- [x] **Step 1: 增加卡片内下拉框**

在“楼栋房态图”的工具栏中，放在房态多选前，新增 `el-select`；标签为楼栋名称，清空时恢复全部楼栋，变化时调用 `loadRoomMap()`。

- [x] **Step 2: 页面初始化加载两类数据**

在 `init()` 保持全局 `load()` 后追加 `loadRoomMap()`，确保初始图与全局筛选互不依赖。

- [ ] **Step 3: 浏览器验收**

登录后进入驾驶舱，选择“测试 1 号楼”应显示 120 套；选择“测试 2 号楼”应显示 72 套；清空后显示全部房源。顶部经营指标在三次操作中保持不变。

- [x] **Step 4: 记录验收与最终构建**

更新 `docs/task012-acceptance.md`，运行 `npm --prefix frontend run build` 和 `npm --prefix backend run lint:check`。
