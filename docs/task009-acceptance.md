# Task009 阶梯退差验收记录

## 已实现

- 新增 `pricing_rebates`、`pricing_rebate_files`，以及合同当前档位、已完成整月、下一档日期字段；固定租金手工退差强制关联有效租金账单。
- 阶梯合同按合同开始日计算完整自然月；对于 `requiresFullyPaid=true` 的档位，阶段内账单必须全部为 `PAID` 才能达标。
- 系统参考额按“阶段原始租金 - 档位月租 × 门槛整月数 - 已确认退差”计算；实际退差不同于参考额时必须填写差异原因。
- 仅 `ACTIVE` 合同可提交；实际退差不能超过累计有效实收租金。实际退款必须有退款日期、退款方式和 `PRICING_REBATE_PROOF` 凭证；确认后凭证锁定。
- 转预收款无需退款凭证，超级管理员确认后新增一笔正向 `ADJUSTMENT` 预收款流水；原账单和原收款不被修改。
- 管理员/超级管理员可提交；仅超级管理员可确认或驳回。后端 JWT 与角色守卫强制校验。
- 前端入口：`/pricing-rebates`，包含合同选择、达档预览、退差提交、凭证上传、记录查看与审批入口。

## 数据库

- MySQL 已成功应用 `20260723140000_task009_pricing_rebates` 与 `20260723141000_task009_rebate_bill_link`，当前共 12 个 migration。

## 已验证

- `npm --prefix backend run build` 通过。
- `npm --prefix backend run lint` 通过。
- `npm --prefix backend test -- --runInBand` 通过：10 个测试套件、30 个测试。
- `npm --prefix frontend run build` 通过。
- Prisma schema 校验、Client 生成与 migration deploy 通过。

## 待手工验收

1. 创建一份已生效的阶梯合同及已付清账单，验证达档预览和参考额。
2. 分别测试实际退款（必须上传凭证）与转预收款（确认后检查预收款流水）。
3. 用管理员账号提交，再用超级管理员确认/驳回，验证权限和留痕。

## 已知边界

- 阶梯完成度以完整自然月和阶段账单状态计算；实际业务首份阶梯合同录入后应按冻结需求逐项人工验收。
