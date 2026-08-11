<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type {
  CheckoutSettlement,
  CheckoutSettlementItem,
} from "./checkout-types";

const props = defineProps<{
  settlements: CheckoutSettlement[];
  isSuper?: boolean;
}>();
const emit = defineEmits<{
  approve: [id: number];
  submit: [id: number, payload: Record<string, unknown>];
  returnToDraft: [id: number];
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
const selected = computed(
  () =>
    props.settlements.find((item) => item.id === selectedId.value) ??
    props.settlements[0],
);

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
function removeItem(index: number) {
  items.value.splice(index, 1);
}
function submit() {
  errors.value = [];
  if (!selected.value) return;
  if (!form.actualCheckoutDate || !form.handoverDate || !form.inspectionAt)
    errors.value.push("请完整填写实际退房、交接和验房日期");
  items.value.forEach((item, index) => {
    if (!Number(item.amount) || Number(item.amount) <= 0)
      errors.value.push(`第 ${index + 1} 项结算金额必须大于 0`);
    if (!item.description.trim())
      errors.value.push(`请填写第 ${index + 1} 项结算说明`);
    if (item.itemType === "RENT_ARREARS" && !item.rentBillId)
      errors.value.push(`请选择第 ${index + 1} 项关联的欠租账单`);
    if (item.itemType !== "RENT_ARREARS" && !item.inspectionRecordRef?.trim())
      errors.value.push(`请填写第 ${index + 1} 项验房记录编号`);
  });
  if (errors.value.length) return;
  emit("submit", selected.value.id, {
    ...form,
    items: items.value.map((item) => ({
      ...item,
      amount: Number(item.amount).toFixed(2),
      rentBillId: item.rentBillId ? Number(item.rentBillId) : undefined,
      inspectionRecordRef: item.inspectionRecordRef?.trim() || undefined,
      description: item.description.trim(),
    })),
  });
}
function amount(value: string) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function totalRefund(settlement: CheckoutSettlement) {
  return amount(
    String(
      Number(settlement.depositRefundableAmount || 0) +
        Number(settlement.prepaymentRefundableAmount || 0),
    ),
  );
}
function statusText(status: CheckoutSettlement["status"]) {
  return {
    DRAFT: "待录入结算",
    PENDING: "等待结算确认",
    APPROVED: "等待最终退款确认",
    REJECTED: "已驳回",
    COMPLETED: "已完成",
  }[status];
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
    <div v-if="!settlements.length" class="settlement-panel__empty">
      暂无已发起的退租结算单。
    </div>
    <template v-else>
      <div class="settlement-panel__list">
        <button
          v-for="item in settlements"
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
            >结算已锁定，请前往“押金退还确认”完成最终处理。</span
          ><span v-else-if="selected.status === 'REJECTED'">{{
            selected.rejectedReason || "请修改结算内容后重新提交。"
          }}</span>
        </div>
        <div class="settlement-panel__summary">
          <div>
            <span>应退押金</span
            ><strong>¥{{ amount(selected.depositRefundableAmount) }}</strong>
          </div>
          <div>
            <span>应退预收款</span
            ><strong>¥{{ amount(selected.prepaymentRefundableAmount) }}</strong>
          </div>
          <div>
            <span>合计应退</span><strong>¥{{ totalRefund(selected) }}</strong>
          </div>
          <div>
            <span>待补收金额</span
            ><strong>¥{{ amount(selected.finalReceivable) }}</strong>
          </div>
        </div>
        <template v-if="selected.status === 'DRAFT'">
          <div
            v-if="errors.length"
            class="settlement-panel__errors"
            role="alert"
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
            </div>
          </div>
          <div v-if="!items.length" class="settlement-panel__empty-items">
            暂无结算项目，请按实际情况添加欠租或验房扣款。
          </div>
          <div
            v-for="(item, index) in items"
            :key="index"
            class="settlement-item"
          >
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
            <input
              v-if="item.itemType === 'RENT_ARREARS'"
              v-model.number="item.rentBillId"
              inputmode="numeric"
              placeholder="关联账单 ID"
            />
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
          </div>
          <div class="settlement-panel__actions">
            <button
              data-test="settlement-submit"
              type="button"
              class="primary-button"
              @click="submit"
            >
              提交结算
            </button>
          </div>
        </template>
        <div
          v-else-if="selected.status === 'PENDING' && isSuper"
          class="settlement-panel__actions"
        >
          <button
            type="button"
            class="primary-button"
            @click="emit('approve', selected.id)"
          >
            确认结算
          </button>
        </div>
        <div
          v-else-if="selected.status === 'REJECTED'"
          class="settlement-panel__actions"
        >
          <button
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
.settlement-item {
  display: grid;
  grid-template-columns: 120px 110px minmax(150px, 1fr) minmax(180px, 2fr) auto;
  gap: 8px;
  margin-top: 10px;
}
.settlement-item__description {
  min-width: 0;
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
