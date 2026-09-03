<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { ElOption, ElSelect } from "element-plus";
import type {
  CheckoutArrearsBill,
  CheckoutSettlement,
  CheckoutSettlementPreview,
  CheckoutSettlementItem,
  CheckoutSettlementPayload,
} from "./checkout-types";

const props = defineProps<{
  settlements: CheckoutSettlement[];
  role?: "SUPER_ADMIN" | "ADMIN" | "VISITOR";
  preview?: CheckoutSettlementPreview;
  previewLoading?: boolean;
  submitting?: boolean;
  cancelling?: boolean;
}>();
const emit = defineEmits<{
  approve: [id: number];
  submit: [id: number, payload: CheckoutSettlementPayload];
  returnToDraft: [id: number];
  cancel: [id: number];
  preview: [id: number, payload: CheckoutSettlementPayload];
  clearPreview: [];
}>();

const selectedId = ref<number | null>(null);
const errors = ref<string[]>([]);
const form = reactive({
  actualCheckoutDate: "",
  handoverDate: "",
  inspectionAt: "",
  targetRoomStatus: "EMPTY",
  remark: "",
});
const items = ref<CheckoutSettlementItem[]>([]);
const rentRefundAmountInput = ref<HTMLInputElement[]>([]);
const actionableSettlements = computed(() =>
  props.settlements.filter((item) =>
    ["DRAFT", "PENDING", "REJECTED"].includes(item.status),
  ),
);
const canOperate = computed(() => props.role !== "VISITOR");
const canApprove = computed(() => props.role === "SUPER_ADMIN");
const selected = computed(
  () =>
    actionableSettlements.value.find((item) => item.id === selectedId.value) ??
    actionableSettlements.value[0],
);
const eligibleArrearsBills = computed(() =>
  (selected.value?.arrearsBills || []).filter(
    (bill) => !form.actualCheckoutDate || bill.periodStart <= form.actualCheckoutDate,
  ),
);

function arrearsBillLabel(bill: CheckoutArrearsBill) {
  const periodStart = bill.periodStart.replaceAll("-", "/");
  const periodEnd = bill.periodEnd.replaceAll("-", "/");
  return `${bill.billNo}｜${periodStart}–${periodEnd}｜未收 ${formatMoney(bill.outstandingAmount)}`;
}

function selectArrearsBill(
  item: CheckoutSettlementItem,
  billId: number | undefined,
) {
  const bill = eligibleArrearsBills.value.find((value) => value.id === billId);
  if (bill) item.amount = bill.outstandingAmount;
}

function arrearsBillDisabled(billId: number, itemIndex: number) {
  return items.value.some(
    (item, index) =>
      index !== itemIndex &&
      item.itemType === "RENT_ARREARS" &&
      item.rentBillId === billId,
  );
}

function isoDate(value?: string) {
  return value ? value.slice(0, 10) : new Date().toISOString().slice(0, 10);
}
function resetForm(settlement?: CheckoutSettlement) {
  form.actualCheckoutDate = isoDate(settlement?.actualCheckoutDate);
  form.handoverDate = isoDate(settlement?.handoverDate);
  form.inspectionAt = isoDate(settlement?.inspectionAt);
  form.targetRoomStatus = settlement?.targetRoomStatus || "EMPTY";
  form.remark = settlement?.remark || "";
  items.value = (settlement?.items || []).map((item) => ({
    ...item,
    amount: String(item.amount),
  }));
  errors.value = [];
}
watch(selected, resetForm, { immediate: true });

function addItem(type: CheckoutSettlementItem["itemType"] = "REPAIR") {
  items.value.push({
    itemType: type,
    amount: "",
    inspectionRecordRef: "",
    description: "",
    evidenceRequired: false,
    confirmedByTenant: false,
  });
}
async function addRentRefund() {
  const existing = items.value.find((item) => item.itemType === "RENT_REFUND");
  if (!existing) {
    items.value.push({
      itemType: "RENT_REFUND",
      amount: "",
      description: "",
    });
  }
  await nextTick();
  rentRefundAmountInput.value[0]?.focus();
}

function removeItem(index: number) {
  items.value.splice(index, 1);
}
const amountPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
function parseAmount(value: unknown) {
  const raw = String(value).trim();
  if (!amountPattern.test(raw)) return undefined;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : undefined;
}
function formatAmount(value: unknown) {
  const amount = parseAmount(value);
  return amount === undefined ? "" : amount.toFixed(2);
}
function payload(): CheckoutSettlementPayload {
  const { remark, ...requiredFields } = form;
  return {
    ...requiredFields,
    ...(remark.trim() ? { remark: remark.trim() } : {}),
    items: items.value.map((item) => {
      const amount = formatAmount(item.amount);
      const description = item.description.trim();
      if (item.itemType === "RENT_REFUND")
        return { itemType: item.itemType, amount, description };
      return {
        ...item,
        amount,
        rentBillId: item.rentBillId ? Number(item.rentBillId) : undefined,
        inspectionRecordRef: item.inspectionRecordRef?.trim() || undefined,
        description,
      };
    }),
  };
}
function previewReady() {
  return Boolean(
    selected.value &&
    form.actualCheckoutDate &&
    form.handoverDate &&
    form.inspectionAt &&
    items.value.every((item) => {
      const amount = parseAmount(item.amount);
      return Boolean(
        amount !== undefined &&
        amount > 0 &&
        item.description.trim() &&
        (item.itemType === "RENT_REFUND" ||
          (item.itemType === "RENT_ARREARS"
            ? item.rentBillId
            : item.inspectionRecordRef?.trim())),
      );
    }),
  );
}
let previewTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  [selected, form, items],
  () => {
    if (previewTimer) clearTimeout(previewTimer);
    emit("clearPreview");
    if (!previewReady() || !selected.value) return;
    previewTimer = setTimeout(
      () => emit("preview", selected.value!.id, payload()),
      250,
    );
  },
  { deep: true },
);
onBeforeUnmount(() => previewTimer && clearTimeout(previewTimer));

function submit() {
  errors.value = [];
  if (!selected.value) return;
  if (!form.actualCheckoutDate || !form.handoverDate || !form.inspectionAt)
    errors.value.push("请完整填写实际退房、交接和验房日期");
  items.value.forEach((item, index) => {
    const amount = parseAmount(item.amount);
    if (amount === undefined)
      errors.value.push(`第 ${index + 1} 项结算金额格式不正确`);
    else if (amount <= 0)
      errors.value.push(`第 ${index + 1} 项结算金额必须大于 0`);
    if (!item.description.trim())
      errors.value.push(`请填写第 ${index + 1} 项结算说明`);
    if (item.itemType === "RENT_ARREARS" && !item.rentBillId)
      errors.value.push(`请选择第 ${index + 1} 项关联的欠租账单`);
    if (
      !["RENT_ARREARS", "RENT_REFUND"].includes(item.itemType) &&
      !item.inspectionRecordRef?.trim()
    )
      errors.value.push(`请填写第 ${index + 1} 项验房记录编号`);
    const maxRentRefundAmount = parseAmount(props.preview?.maxRentRefundAmount);
    if (
      item.itemType === "RENT_REFUND" &&
      (props.previewLoading || maxRentRefundAmount === undefined)
    )
      errors.value.push("正在获取当前可回冲金额，请稍候再提交。");
    if (
      item.itemType === "RENT_REFUND" &&
      amount !== undefined &&
      maxRentRefundAmount !== undefined &&
      amount > maxRentRefundAmount
    )
      errors.value.push(
        `退还租金不能超过当前可回冲金额 ${formatMoney(props.preview!.maxRentRefundAmount)}。`,
      );
  });
  if (errors.value.length) return;
  emit("submit", selected.value.id, payload());
}
function statusText(status: CheckoutSettlement["status"]) {
  return {
    DRAFT: "待录入结算",
    PENDING: "等待结算确认",
    APPROVED: "等待最终退款确认",
    REJECTED: "已驳回",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
  }[status];
}
function formatMoney(value: string) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
const summaryCards = computed(() => [
  { label: "应退押金", value: props.preview?.depositRefundableAmount },
  { label: "应退预收款", value: props.preview?.prepaymentRefundableAmount },
  { label: "应退租金", value: props.preview?.rentRefundableAmount },
  { label: "合计应退", value: props.preview?.totalRefundAmount },
  { label: "待补收金额", value: props.preview?.finalReceivable },
]);
function cancelSelected() {
  if (!selected.value) return;
  if (!window.confirm("确定取消该退租结算工单吗？取消后会恢复合同和房态。"))
    return;
  emit("cancel", selected.value.id);
}
</script>

<template>
  <section class="settlement-panel">
    <div class="settlement-panel__title">
      <div>
        <h2>退租结算</h2>
        <p>
          录入实际退房、验房与结算项目；确认结算不会提前结束合同或释放房源。
        </p>
      </div>
    </div>
    <div v-if="!actionableSettlements.length" class="settlement-panel__empty">
      暂无已发起的退租结算单。
    </div>
    <template v-else>
      <div class="settlement-panel__list">
        <button
          v-for="item in actionableSettlements"
          :key="item.id"
          type="button"
          :class="{ active: selected?.id === item.id }"
          @click="selectedId = item.id"
        >
          <strong>{{ item.settlementNo }}</strong
          ><span>{{ statusText(item.status) }}</span>
        </button>
      </div>
      <article v-if="selected" class="settlement-panel__detail">
        <div
          class="settlement-panel__banner"
          :class="`status-${selected.status.toLowerCase()}`"
        >
          <strong>{{ statusText(selected.status) }}</strong
          ><span v-if="selected.status === 'APPROVED'"
            >结算已锁定，请前往“退租退款确认”完成最终处理。</span
          ><span v-else-if="selected.status === 'REJECTED'">{{
            selected.rejectedReason || "请修改结算内容后重新提交。"
          }}</span>
        </div>
        <div
          class="settlement-panel__summary"
          data-test="settlement-summary"
          aria-live="polite"
        >
          <div v-for="card in summaryCards" :key="card.label">
            <span>{{ card.label }}</span>
            <strong>{{
              card.value
                ? formatMoney(card.value)
                : previewLoading
                  ? "计算中…"
                  : "待计算"
            }}</strong>
            <small>{{
              card.value ? "实时预估，确认后锁定" : "填写完整后自动计算"
            }}</small>
          </div>
        </div>
        <template v-if="selected.status === 'DRAFT' && canOperate">
          <div
            v-if="errors.length"
            class="settlement-panel__errors"
            role="alert"
            aria-live="assertive"
          >
            <p v-for="error in errors" :key="error">{{ error }}</p>
          </div>
          <div class="settlement-panel__form-grid">
            <label
              ><span><i>*</i>实际退房日期</span
              ><input
                v-model="form.actualCheckoutDate"
                type="date"
                lang="zh-CN"
            /></label>
            <label
              ><span><i>*</i>交接日期</span
              ><input v-model="form.handoverDate" type="date" lang="zh-CN"
            /></label>
            <label
              ><span><i>*</i>验房日期</span
              ><input v-model="form.inspectionAt" type="date" lang="zh-CN"
            /></label>
            <label
              ><span><i>*</i>退租后房态</span
              ><select v-model="form.targetRoomStatus">
                <option value="EMPTY">空置</option>
                <option value="MAINTENANCE">维修中</option>
                <option value="DISABLED">停用</option>
              </select></label
            >
            <label class="wide"
              ><span>结算备注</span
              ><textarea v-model="form.remark" rows="3" maxlength="1000" />
            </label>
          </div>
          <div class="settlement-panel__items-title">
            <h3>结算项目</h3>
            <div>
              <button
                type="button"
                class="secondary-button"
                @click="addItem('RENT_ARREARS')"
              >
                添加欠租</button
              ><button
                type="button"
                class="secondary-button"
                @click="addItem()"
              >
                添加验房扣款
              </button>
              <button
                type="button"
                class="secondary-button"
                data-test="add-rent-refund"
                @click="addRentRefund"
              >
                添加退还租金
              </button>
            </div>
          </div>
          <div v-if="!items.length" class="settlement-panel__empty-items">
            暂无结算项目，请按实际情况添加欠租、验房扣款或退还租金。
          </div>
          <div
            v-for="(item, index) in items"
            :key="index"
            class="settlement-item"
            :data-test="
              item.itemType === 'RENT_REFUND' ? 'rent-refund-item' : undefined
            "
          >
            <template v-if="item.itemType === 'RENT_REFUND'">
              <span class="settlement-item__type">退还租金</span>
              <input
                v-model="item.amount"
                ref="rentRefundAmountInput"
                data-test="rent-refund-amount"
                aria-label="退还金额"
                aria-describedby="rent-refund-limit"
                inputmode="decimal"
                placeholder="退还金额"
              />
              <input
                v-model="item.description"
                data-test="rent-refund-description"
                aria-label="退还说明"
                aria-describedby="rent-refund-limit"
                class="settlement-item__description"
                placeholder="退还说明"
                maxlength="500"
              />
              <button
                type="button"
                class="danger-button"
                @click="removeItem(index)"
              >
                删除
              </button>
            </template>
            <template v-else>
              <select v-model="item.itemType">
                <option value="RENT_ARREARS">欠租</option>
                <option value="REPAIR">维修</option>
                <option value="DAMAGE">损坏</option>
                <option value="CLEANING">清洁</option>
                <option value="OTHER">其他</option>
              </select>
              <input
                v-model="item.amount"
                inputmode="decimal"
                placeholder="金额"
              />
              <ElSelect
                v-if="item.itemType === 'RENT_ARREARS'"
                v-model="item.rentBillId"
                class="settlement-item__bill-select"
                filterable
                clearable
                size="large"
                placeholder="选择关联欠租账单"
                no-data-text="当前没有可关联的欠租账单"
                no-match-text="未找到匹配的欠租账单"
                @change="selectArrearsBill(item, $event)"
              >
                <ElOption
                  v-for="bill in eligibleArrearsBills"
                  :key="bill.id"
                  :label="arrearsBillLabel(bill)"
                  :value="bill.id"
                  :disabled="arrearsBillDisabled(bill.id, index)"
                />
              </ElSelect>
              <input
                v-else
                v-model="item.inspectionRecordRef"
                placeholder="验房记录编号"
                maxlength="100"
              />
              <input
                v-model="item.description"
                class="settlement-item__description"
                placeholder="结算说明"
                maxlength="500"
              />
              <button
                type="button"
                class="danger-button"
                @click="removeItem(index)"
              >
                删除
              </button>
            </template>
          </div>
          <section
            v-if="items.some((item) => item.itemType === 'RENT_REFUND')"
            class="settlement-panel__rent-refund-preview"
          >
            <p
              id="rent-refund-limit"
              aria-live="polite"
              v-if="preview?.maxRentRefundAmount !== undefined"
            >
              当前最多可退租金
              <strong>{{ formatMoney(preview.maxRentRefundAmount) }}</strong>
            </p>
            <p id="rent-refund-limit" aria-live="polite" v-else>
              正在根据后端账务计算可退租金…
            </p>
            <template v-if="preview?.rentRefundAllocations?.length">
              <h4>系统自动回冲预览</h4>
              <p
                v-for="allocation in preview.rentRefundAllocations"
                :key="allocation.paymentAllocationId"
              >
                账单号 {{ allocation.billNo }} · 收款单号
                {{ allocation.receiptNo }}：{{ formatMoney(allocation.amount) }}
              </p>
            </template>
          </section>
          <div class="settlement-panel__actions">
            <button
              type="button"
              class="danger-button"
              data-test="settlement-cancel"
              :disabled="submitting || cancelling"
              @click="cancelSelected"
            >
              取消退租结算
            </button>
            <button
              data-test="settlement-submit"
              :disabled="submitting || cancelling"
              type="button"
              class="primary-button"
              @click="submit"
            >
              提交结算
            </button>
          </div>
        </template>
        <p v-else-if="selected.status === 'DRAFT'" class="settlement-panel__hint">
          访客仅可查看，不可编辑或提交退租结算。
        </p>
        <div
          v-else-if="selected.status === 'PENDING'"
          class="settlement-panel__actions"
        >
          <button
            v-if="canOperate"
            type="button"
            class="danger-button"
            data-test="settlement-cancel"
            :disabled="submitting || cancelling"
            @click="cancelSelected"
          >
            取消退租结算
          </button>
          <button
            v-if="canApprove"
            type="button"
            class="primary-button"
            @click="emit('approve', selected.id)"
          >
            确认结算
          </button>
          <p v-else class="settlement-panel__hint">
            仅超级管理员可以确认结算。
          </p>
        </div>
        <div
          v-else-if="selected.status === 'REJECTED'"
          class="settlement-panel__actions"
        >
          <button
            v-if="canOperate"
            type="button"
            class="danger-button"
            data-test="settlement-cancel"
            :disabled="submitting || cancelling"
            @click="cancelSelected"
          >
            取消退租结算
          </button>
          <button
            v-if="canApprove"
            type="button"
            class="secondary-button"
            @click="emit('returnToDraft', selected.id)"
          >
            退回草稿并编辑
          </button>
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.settlement-panel {
  display: grid;
  gap: 16px;
}
.settlement-panel__title h2 {
  margin: 0 0 6px;
  font-size: 20px;
}
.settlement-panel__title p {
  margin: 0;
  color: #66758b;
}
.settlement-panel__empty,
.settlement-panel__detail {
  padding: 24px;
  border: 1px solid #e4eaf3;
  border-radius: 12px;
  background: #fff;
}
.settlement-panel__list {
  display: flex;
  gap: 10px;
  overflow-x: auto;
}
.settlement-panel__list button {
  min-width: 220px;
  padding: 14px;
  border: 1px solid #e0e7f1;
  border-radius: 8px;
  color: #415168;
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.settlement-panel__list button.active {
  border-color: #246bfd;
  background: #f3f7ff;
}
.settlement-panel__list strong,
.settlement-panel__list span {
  display: block;
}
.settlement-panel__list span {
  margin-top: 5px;
  color: #66758b;
  font-size: 13px;
}
.settlement-panel__banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  color: #1d5ccf;
  background: #edf4ff;
}
.settlement-panel__banner.status-completed {
  color: #18805a;
  background: #eaf8f1;
}
.settlement-panel__banner.status-rejected {
  color: #c43c3c;
  background: #fff1f0;
}
.settlement-panel__summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
  margin-top: 18px;
}
.settlement-panel__summary div {
  padding: 16px;
  border-radius: 8px;
  background: #f7f9fc;
}
.settlement-panel__summary span,
.settlement-panel__summary strong {
  display: block;
}
.settlement-panel__summary span {
  color: #66758b;
  font-size: 13px;
}
.settlement-panel__summary strong {
  margin-top: 8px;
  font-size: 20px;
}
.settlement-panel__summary small {
  display: block;
  margin-top: 4px;
  color: #8a98ad;
  font-size: 12px;
}
.settlement-panel__form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 20px;
}
.settlement-panel__form-grid label {
  display: grid;
  gap: 7px;
  color: #39465a;
  font-size: 14px;
}
.settlement-panel__form-grid .wide {
  grid-column: span 2;
}
.settlement-panel__form-grid i {
  color: #f05252;
  font-style: normal;
}
.settlement-panel input,
.settlement-panel select,
.settlement-panel textarea {
  box-sizing: border-box;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid #d9e1ec;
  border-radius: 6px;
  background: #fff;
  font: inherit;
}
.settlement-panel textarea {
  min-height: 76px;
  resize: vertical;
}
.settlement-panel__items-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 24px;
}
.settlement-panel__items-title h3 {
  margin: 0;
  font-size: 16px;
}
.settlement-panel__items-title div {
  display: flex;
  gap: 8px;
}
.settlement-panel__empty-items {
  margin-top: 10px;
  padding: 14px;
  border-radius: 8px;
  color: #66758b;
  background: #f7f9fc;
}
.settlement-panel__rent-refund-preview {
  margin-top: 12px;
  padding: 14px;
  border: 1px solid #cfe0ff;
  border-radius: 8px;
  color: #31537e;
  background: #f3f7ff;
}
.settlement-panel__rent-refund-preview p,
.settlement-panel__rent-refund-preview h4 {
  margin: 4px 0;
}
.settlement-panel__rent-refund-preview h4 {
  margin-top: 10px;
  color: #1d5ccf;
  font-size: 14px;
}
.settlement-item {
  display: grid;
  grid-template-columns: 120px 110px minmax(150px, 1fr) minmax(180px, 2fr) auto;
  gap: 8px;
  margin-top: 10px;
}
.settlement-item__description {
  min-width: 0;
}
.settlement-item__bill-select {
  width: 100%;
}
.settlement-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
.primary-button,
.secondary-button,
.danger-button {
  min-height: 40px;
  padding: 0 16px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}
.primary-button {
  border: 0;
  color: #fff;
  background: #246bfd;
}
.secondary-button {
  border: 1px solid #cdd8e8;
  color: #31537e;
  background: #fff;
}
.danger-button {
  border: 1px solid #ffccc7;
  color: #cf3d3d;
  background: #fff5f4;
}
.settlement-panel__errors {
  margin-top: 16px;
  padding: 10px 14px;
  border: 1px solid #ffc5c5;
  border-radius: 8px;
  color: #d9363e;
  background: #fff2f0;
}
.settlement-panel__errors p {
  margin: 2px 0;
}
@media (max-width: 760px) {
  .settlement-panel__detail,
  .settlement-panel__empty {
    padding: 16px;
  }
  .settlement-panel__banner {
    align-items: flex-start;
    flex-direction: column;
  }
  .settlement-panel__summary,
  .settlement-panel__form-grid,
  .settlement-item {
    grid-template-columns: 1fr;
  }
  .settlement-panel__form-grid .wide {
    grid-column: auto;
  }
  .settlement-panel__items-title {
    align-items: flex-start;
    flex-direction: column;
  }
  .settlement-panel__items-title div {
    flex-wrap: wrap;
  }
}
</style>
