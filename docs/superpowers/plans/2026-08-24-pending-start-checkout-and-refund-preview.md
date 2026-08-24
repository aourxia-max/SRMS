# 待开始合同退租与退款凭证预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许待开始合同安全走完整退租流程，提供结算金额实时预估，并支持押金退款凭证在线预览。

**Architecture:** 在退租结算表保存发起前合同状态，后端统一复用一套无副作用金额计算逻辑供预估和正式确认使用。前端扩大合同可退租范围、展示后端预估结果，并通过已有受保护下载接口生成本地 Blob URL 预览图片和 PDF。

**Tech Stack:** NestJS、Prisma/MySQL、Vue 3、TypeScript、Vitest、Jest。

**Spec:** `docs/superpowers/specs/2026-08-24-pending-start-checkout-and-refund-preview-design.md`

## Global Constraints

- 不新增合同状态，不修改既有合同和历史财务数据。
- 预估不得写入账务；正式金额只在超级管理员确认结算时锁定。
- 后端强制执行合同状态、金额、附件归属和权限校验。
- 所有用户可见提示使用中文。

---

### Task 1: 待开始合同退租与安全恢复

**Files:** `backend/prisma/schema.prisma`、新 migration、`backend/src/checkout/checkout.service.ts` 及测试、前端发起退租与合同详情组件及测试。

- [ ] 先写失败测试，覆盖待开始合同发起、开始日前后退租日期以及取消后恢复原合同/房态。
- [ ] 增加原合同状态字段与迁移，最小修改后端状态规则并跑绿测试。
- [ ] 先写前端失败测试，再开放待开始合同入口并跑绿测试。

### Task 2: 结算金额实时预估

**Files:** 退租 controller/service 及测试、前端 checkout service/types/workspace/settlement panel 及测试。

- [ ] 先写失败测试，覆盖预估金额、无写入副作用、非法扣款和未入住日期。
- [ ] 增加 `POST /api/checkout-settlements/:id/preview`，与正式确认复用计算规则但不写账。
- [ ] 先写前端失败测试，再展示四项实时预估和中文错误提示。

### Task 3: 押金退款凭证在线预览

**Files:** `frontend/src/views/checkout/CheckoutWorkspace.vue`、类型和测试；仅在响应头不足时修改后端凭证下载接口。

- [ ] 先写失败测试，覆盖图片/PDF预览、关闭清理、不支持格式回退和保留下载。
- [ ] 用短生命周期 Blob URL 实现预览并跑绿测试。

### Task 4: 回归验证与交付检查

- [ ] 执行 Prisma 校验、后端 Lint/单测/构建/接口测试、前端单测/构建。
- [ ] 检查 diff、秘密信息和无关文件，记录准确测试结果。
