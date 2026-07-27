# 驾驶舱本月租金收缴概览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用冻结的账期经营口径在驾驶舱展示直观的本月租金收缴概览。

**Architecture:** Dashboard 模块导入并调用 FinanceService，传入当前自然月的账期起止日。前端仅消费新增的只读汇总字段，不修改现有收款流程。

**Tech Stack:** NestJS、Prisma Decimal、Vue 3、Element Plus。

## Global Constraints

- 收租率固定为有效实收 ÷ 租金净应收；净应收为零时不进入分母。
- 按账期开始日的当前自然月统计，不能混入实际收付日期口径。
- 不展示或返回提成字段。

---

### Task 1: 驾驶舱收缴概览接口

**Files:**
- Create: `backend/src/dashboard/rent-collection-overview.spec.ts`
- Create: `backend/src/dashboard/rent-collection-overview.ts`
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/dashboard.module.ts`
- Modify: `backend/src/finance/finance.module.ts`

- [x] 写入并运行当前自然月边界的失败测试。
- [x] 实现自然月范围函数，开始日为当月 1 日，结束日为下月 1 日之前一天。
- [x] DashboardService 调用 FinanceService.rentCollection 并返回 `rentCollectionOverview`。
- [x] 运行新增单元测试和后端构建。

### Task 2: 驾驶舱界面

**Files:**
- Modify: `frontend/src/views/DashboardView.vue`
- Modify: `docs/task012-acceptance.md`

- [x] 用应收、已收、未收、逾期欠租和收缴率进度条替换原趋势条。
- [x] 保持所有金额格式化为人民币，非超级管理员不展示现有受限字段。
- [x] 运行前端构建、后端静态检查与接口核验。
