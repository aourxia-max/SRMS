# 收款详情记录局部分页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为收款详情左侧记录列表增加每页 10 条的服务端局部分页。

**Architecture:** 后端列表接口统一返回分页对象，并在同一筛选条件下并行执行 `findMany` 和 `count`。前端用独立的记录列表组件承载列表、总数和分页事件，页面负责请求数据并保持右侧详情状态。

**Tech Stack:** NestJS、Prisma、Vue 3、Element Plus、Jest、Vitest

**Spec:** `docs/superpowers/specs/2026-08-21-payment-detail-record-pagination-design.md`

## Global Constraints

- 每页固定 10 条，不提供每页条数切换。
- 搜索回到第 1 页，翻页保留右侧详情。
- 不改变现有权限、脱敏、筛选和收款业务规则。

---

### Task 1: 后端分页查询

**Files:**
- Modify: `backend/src/payments/dto/payment-list-query.dto.ts`
- Modify: `backend/src/payments/payments.service.ts`
- Test: `backend/src/payments/payments.service.spec.ts`

**Interfaces:**
- Consumes: 现有 `PaymentListQueryDto` 搜索条件和当前用户角色。
- Produces: `list()` 返回 `{ items, page, pageSize, total }`。

- [ ] **Step 1: 写服务端分页失败测试**
- [ ] **Step 2: 运行测试并确认因缺少分页返回结构而失败**
- [ ] **Step 3: 为 DTO 增加页码校验，为查询增加 `skip`、`take` 和 `count`**
- [ ] **Step 4: 运行收款服务测试并确认通过**

### Task 2: 前端局部分页组件与页面接入

**Files:**
- Create: `frontend/src/components/payments/PaymentRecordList.vue`
- Create: `frontend/src/components/payments/payment-record-list.spec.ts`
- Modify: `frontend/src/types/payments.ts`
- Modify: `frontend/src/services/payments.ts`
- Modify: `frontend/src/views/payments/PaymentDetailView.vue`

**Interfaces:**
- Consumes: 后端 `{ items, page, pageSize, total }`。
- Produces: `select(id)` 和 `page-change(page)` 事件。

- [ ] **Step 1: 写分页组件失败测试，覆盖总数、每页 10 条与翻页事件**
- [ ] **Step 2: 运行测试并确认组件缺失导致失败**
- [ ] **Step 3: 实现组件并接入页面请求；搜索重置页码，翻页不清空详情**
- [ ] **Step 4: 运行前端相关测试并确认通过**

### Task 3: 回归验证

**Files:**
- Modify: `docs/superpowers/plans/2026-08-21-payment-detail-record-pagination.md`

**Interfaces:**
- Consumes: 完成的后端接口和前端页面。
- Produces: 可交付的测试证据。

- [ ] **Step 1: 运行后端收款测试、后端 Lint 与构建**
- [ ] **Step 2: 运行前端单元测试与构建**
- [ ] **Step 3: 检查 Git 差异，确认无无关文件被修改**

