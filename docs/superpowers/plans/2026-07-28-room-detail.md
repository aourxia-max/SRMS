# 房源 360°详情页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从驾驶舱点击房间进入受后端权限保护的只读房源 360°详情页。

**Architecture:** 新建 `RoomDetailsService` 聚合单一房源及其合同、成员和状态历史；超级管理员额外获得当前/最近合同的财务汇总与收款明细。Vue 页面按模块展示，历史区默认折叠，操作跳转至既有页面。

**Tech Stack:** NestJS、Prisma、Vue 3、Element Plus、Vue Router。

## Global Constraints

- 不在详情页直接变更房态、合同、账单或收款。
- 财务字段必须由后端按超级管理员角色过滤，管理员和游客响应中不得包含 `financial`。
- 风险提示只使用当前房态、当前合同账单和合同结束日期，不创造新业务状态。

---

### Task 1: 聚合详情接口与权限测试

**Files:**
- Create: `backend/src/properties/room-details.service.ts`
- Create: `backend/src/properties/room-details.service.spec.ts`
- Modify: `backend/src/properties/properties.controller.ts`
- Modify: `backend/src/properties/properties.module.ts`

- [x] 写出管理员不返回 `financial` 的失败测试。
- [x] 实现房源、楼栋、房态历史、合同和租户基础资料聚合。
- [x] 实现超级管理员的账单、收款、预收款与退款只读财务汇总。
- [x] 增加 `GET /api/properties/rooms/:id/detail` 并运行后端测试与构建。

### Task 2: 详情页和驾驶舱跳转

**Files:**
- Create: `frontend/src/views/RoomDetailView.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/views/DashboardView.vue`
- Modify: `docs/task012-acceptance.md`

- [x] 增加受登录保护的详情路由。
- [x] 点击驾驶舱房间格跳转到对应详情页。
- [x] 展示现状、业主、合同/租户、风险提示、折叠历史及超级管理员财务区域。
- [x] 运行前端构建、后端静态检查和接口验证。
