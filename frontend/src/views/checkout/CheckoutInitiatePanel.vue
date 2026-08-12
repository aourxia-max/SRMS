<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { CheckoutContract } from "./checkout-types";

type CheckoutSnapshot = {
  depositBalance: string;
  rentOutstanding: string;
  prepaymentBalance: string;
  futureBillCount: number;
};
const props = defineProps<{
  contracts: CheckoutContract[];
  loading?: boolean;
  snapshot?: CheckoutSnapshot;
  selectedContractId?: number | null;
}>();
const emit = defineEmits<{
  submit: [contractId: number, payload: Record<string, string>];
  contractChange: [contractId: number];
}>();

const today = new Date().toISOString().slice(0, 10);
const form = reactive({
  contractId: "",
  checkoutType: "提前退租",
  plannedCheckoutDate: today,
  handoverDate: today,
  inspectionAt: today,
  checkoutReason: "",
  targetRoomStatus: "EMPTY",
});
const errors = ref<string[]>([]);
const activeContracts = computed(() =>
  props.contracts.filter((item) => item.status === "ACTIVE"),
);

watch(
  () => [props.selectedContractId, props.contracts] as const,
  ([contractId]) => {
    if (!contractId) return;
    const exists = props.contracts.some((item) => item.id === contractId && item.status === "ACTIVE");
    if (!exists || form.contractId === String(contractId)) return;
    form.contractId = String(contractId);
    emit("contractChange", contractId);
  },
  { immediate: true },
);

function contractChange() {
  if (form.contractId) emit("contractChange", Number(form.contractId));
}

function formatMoney(value: string) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function submit() {
  errors.value = [];
  if (!form.contractId) errors.value.push("请选择正在履行的合同");
  if (!form.checkoutReason.trim()) errors.value.push("请填写退租原因");
  if (errors.value.length) return;
  emit("submit", Number(form.contractId), {
    ...form,
    contractId: undefined as never,
  });
}
</script>

<template>
  <section class="initiate-panel">
    <div class="initiate-panel__title">
      <div>
        <h2>发起退租</h2>
        <p>发起后合同与房源进入“待退租”，不会提前结束合同。</p>
      </div>
    </div>

    <div v-if="errors.length" class="initiate-panel__errors" role="alert">
      <p v-for="error in errors" :key="error">{{ error }}</p>
    </div>

    <aside
      v-if="snapshot"
      class="initiate-panel__snapshot"
      aria-label="财务快照"
    >
      <strong>财务快照</strong>
      <div>
        <span>押金余额</span><b>¥{{ formatMoney(snapshot.depositBalance) }}</b>
      </div>
      <div>
        <span>当前欠租</span><b>¥{{ formatMoney(snapshot.rentOutstanding) }}</b>
      </div>
      <div>
        <span>预收款余额</span
        ><b>¥{{ formatMoney(snapshot.prepaymentBalance) }}</b>
      </div>
      <div>
        <span>未来账单</span><b>{{ snapshot.futureBillCount }} 期</b>
      </div>
    </aside>
    <div class="initiate-panel__card">
      <div class="initiate-panel__grid">
        <label class="form-field form-field--wide">
          <span><i>*</i>退租合同</span>
          <select
            data-test="checkout-contract-select"
            v-model="form.contractId"
            :disabled="loading"
            @change="contractChange"
          >
            <option value="">请选择正在履行的合同</option>
            <option
              v-for="contract in activeContracts"
              :key="contract.id"
              :value="String(contract.id)"
            >
              {{ contract.contractNo
              }}{{
                contract.room?.fullHouseNo
                  ? `｜${contract.room.fullHouseNo}`
                  : ""
              }}
            </option>
          </select>
        </label>
        <label class="form-field">
          <span><i>*</i>退租类型</span>
          <select v-model="form.checkoutType">
            <option>提前退租</option>
            <option>到期退租</option>
          </select>
        </label>
        <label class="form-field">
          <span><i>*</i>计划退房日期</span>
          <input v-model="form.plannedCheckoutDate" type="date" lang="zh-CN" />
        </label>
        <label class="form-field">
          <span><i>*</i>交接日期</span>
          <input v-model="form.handoverDate" type="date" lang="zh-CN" />
        </label>
        <label class="form-field">
          <span><i>*</i>验房日期</span>
          <input v-model="form.inspectionAt" type="date" lang="zh-CN" />
        </label>
        <label class="form-field">
          <span><i>*</i>退租后房态</span>
          <select v-model="form.targetRoomStatus">
            <option value="EMPTY">空置</option>
            <option value="MAINTENANCE">维修中</option>
            <option value="DISABLED">停用</option>
          </select>
        </label>
        <label class="form-field form-field--wide">
          <span><i>*</i>退租原因</span>
          <textarea
            v-model="form.checkoutReason"
            rows="4"
            maxlength="500"
            placeholder="请填写退租原因"
          />
        </label>
      </div>
      <div class="initiate-panel__actions">
        <button
          data-test="initiate-submit"
          type="button"
          class="primary-button"
          @click="submit"
        >
          发起退租
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.initiate-panel {
  display: grid;
  gap: 16px;
}
.initiate-panel__title h2 {
  margin: 0 0 6px;
  font-size: 20px;
}
.initiate-panel__title p {
  margin: 0;
  color: #66758b;
}
.initiate-panel__card {
  padding: 24px;
  border: 1px solid #e4eaf3;
  border-radius: 12px;
  background: #fff;
}
.initiate-panel__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px 20px;
}
.form-field {
  display: grid;
  gap: 7px;
  color: #39465a;
  font-size: 14px;
}
.form-field--wide {
  grid-column: span 3;
}
.form-field span i {
  margin-right: 4px;
  color: #f05252;
  font-style: normal;
}
.form-field select,
.form-field input,
.form-field textarea {
  width: 100%;
  min-height: 40px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #d9e1ec;
  border-radius: 6px;
  color: #233044;
  background: #fff;
  font: inherit;
}
.form-field textarea {
  min-height: 92px;
  resize: vertical;
}
.initiate-panel__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 22px;
}
.primary-button {
  min-height: 40px;
  padding: 0 20px;
  border: 0;
  border-radius: 6px;
  color: #fff;
  background: #246bfd;
  font: inherit;
  cursor: pointer;
}
.initiate-panel__errors {
  padding: 10px 14px;
  border: 1px solid #ffc5c5;
  border-radius: 8px;
  color: #d9363e;
  background: #fff2f0;
}
.initiate-panel__errors p {
  margin: 2px 0;
}
.initiate-panel__snapshot {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
  border: 1px solid #dce7f7;
  border-radius: 10px;
  background: #f7faff;
}
.initiate-panel__snapshot > strong {
  grid-column: 1 / -1;
}
.initiate-panel__snapshot div {
  display: grid;
  gap: 4px;
}
.initiate-panel__snapshot span {
  color: #66758b;
  font-size: 13px;
}
.initiate-panel__snapshot b {
  font-size: 17px;
  color: #1d5ccf;
}
@media (max-width: 760px) {
  .initiate-panel__card {
    padding: 16px;
  }
  .initiate-panel__grid {
    grid-template-columns: 1fr;
  }
  .form-field--wide {
    grid-column: auto;
  }
  .initiate-panel__snapshot {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
