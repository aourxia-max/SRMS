# 退租结算取消与工单归档报告

## 实现内容

- `GET /checkout-settlements` 默认仅返回 `DRAFT`、`PENDING`、`REJECTED`，避免已确认、已完成或已取消工单堆积在“退租结算”卡片区。
- 新增 `POST /checkout-settlements/:id/cancel`，仅 `ADMIN`、`SUPER_ADMIN` 可调用。
- 取消支持 `DRAFT`、`PENDING`、`REJECTED`，不要求原因；后端事务内将结算单标记为 `CANCELLED`，合同恢复 `ACTIVE`，房源恢复发起退租前房态，并写入“取消退租结算”房态历史。
- 后端拒绝 `APPROVED`、`COMPLETED` 等已进入账务或完成阶段的工单取消，避免回滚财务和合同历史。
- 前端“退租结算”卡片区只显示可处理工单，草稿、待确认、已驳回均显示“取消退租结算”按钮并二次确认。
- 已确认工单继续在“押金退还确认”处理；已完成工单继续进入“已退租合同”。

## TDD 记录

- 后端 RED：新增取消与列表过滤测试后，`service.cancel is not a function`，列表缺少状态过滤。
- 前端 RED：已确认工单仍显示在卡片区，取消按钮和 API 调用缺失。
- GREEN 后新增测试全部通过。

## 验证结果

- `npm --prefix backend run test -- --runInBand`：45 suites / 222 tests 通过。
- `npm --prefix frontend run test:unit`：10 files / 71 tests 通过。
- `npm --prefix backend run build`：通过。
- `npm --prefix frontend run build`：通过，仅保留既有 Vite chunk > 500 kB 警告。
- `git diff --check`：通过。
- `npm --prefix backend run lint:check`：失败仅来自既有未改动文件 `backend/src/contracts/contract-schema.spec.ts` 的 12 条 Prettier 问题，本次退租文件未报错。

## 未解决问题

- 既有 `backend/src/contracts/contract-schema.spec.ts` 格式问题仍然存在，本次未触碰。
- 本次只实现取消/归档行为，未新增专门的“已取消工单审计查询”页面。