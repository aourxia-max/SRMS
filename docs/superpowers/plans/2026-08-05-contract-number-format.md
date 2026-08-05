# 合同编号格式调整实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将新建合同的系统编号统一生成为 `HTYYYYMMDDNNNN | 楼栋房号 | 住户姓名`，序号全局连续递增，并让账单继续引用最终合同编号。

**Architecture:** 后端在合同创建事务中取得合同自增 ID 后生成最终编号；历史合同不改写。前端移除可编辑合同编号输入框，创建请求只提交业务字段；账单编号继续以最终合同编号追加期次后缀。

**Tech Stack:** NestJS、Prisma、MySQL、Vue 3、TypeScript、Jest、Vitest、Element Plus。

## Global Constraints

- 序号全局连续递增，从 `0001` 起，超过四位保留完整数字。
- 日期使用合同开始日期 `YYYYMMDD`。
- 房源使用完整房号，住户使用主承租人姓名；姓名为空时使用“未登记住户”。
- 历史合同编号和历史账单编号不修改。
- 编号由后端生成，客户端不得覆盖。
- 合同编号完整保存，并用于账单编号前缀。

---

### Task 1: 编号生成器

**Files:**
- Create: `backend/src/contracts/contract-number.ts`
- Test: `backend/src/contracts/contract-number.spec.ts`

- [x] 编写覆盖日期、序号补零、房号和姓名清理、40 字符上限的失败测试。
- [x] 实现 `buildContractNumber(contractId, startDate, fullHouseNo, tenantName)`。
- [x] 运行专项测试并确认通过。

### Task 2: 合同创建事务

**Files:**
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/contracts/dto/create-fixed-contract.dto.ts`
- Modify: `backend/src/contracts/dto/create-tiered-contract.dto.ts`
- Modify: `backend/src/contracts/contracts.service.spec.ts`

- [x] 创建合同先使用临时唯一编号取得自增 ID，再更新最终编号。
- [x] 固定月租和阶梯合同均使用楼栋房号与主承租人姓名生成编号。
- [x] 所有账单编号、房态历史和返回值使用最终编号。
- [x] DTO 和白名单禁止客户端提交 `contractNo`。
- [x] 补充固定合同、阶梯合同和 DTO 校验测试。

### Task 3: 前端合同表单

**Files:**
- Modify: `frontend/src/views/ContractsView.vue`

- [x] 移除合同编号可编辑字段、必填校验和请求字段。
- [x] 显示“保存后由系统自动生成”。
- [x] 合同列表继续显示后端返回的完整编号。
- [x] 运行前端单元测试和构建。

### Task 4: 全量验证与测试环境

- [ ] 运行 Prisma 校验、后端 lint、构建、单元测试和接口测试。
- [x] 运行前端单元测试和构建。
- [ ] 重建本地测试环境并检查新合同编号展示、账单编号前缀和历史编号不变。
- [ ] 更新验收文档并提交变更。
