<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { checkoutApi } from "../../services/checkout";
import { useSessionStore } from "../../stores/session";
import CheckoutInitiatePanel from "./CheckoutInitiatePanel.vue";
import CheckoutRefundPanel from "./CheckoutRefundPanel.vue";
import CheckoutSettlementPanel from "./CheckoutSettlementPanel.vue";
import CheckoutTopNav from "./CheckoutTopNav.vue";
import type {
  CheckoutContract,
  CheckoutSettlement,
  CheckoutTab,
} from "./checkout-types";

const session = useSessionStore();
const activeTab = ref<CheckoutTab>("initiate");
const contracts = ref<CheckoutContract[]>([]);
const settlements = ref<CheckoutSettlement[]>([]);
const refundSettlement = ref<CheckoutSettlement>();
const financeSnapshot = ref<{
  depositBalance: string;
  rentOutstanding: string;
  prepaymentBalance: string;
  futureBillCount: number;
}>();
const loadingContracts = ref(false);
const actionError = ref("");
const refundPanel = ref<{ addProof: (id: number) => void } | null>(null);
const isSuper = computed(() => session.user?.role === "SUPER_ADMIN");
const approvedSettlement = computed(
  () =>
    refundSettlement.value ||
    settlements.value.find((item) => item.status === "APPROVED"),
);

function message(error: unknown, fallback: string) {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data
      ?.message || fallback
  );
}
async function loadData() {
  loadingContracts.value = true;
  try {
    const [loadedContracts, loadedSettlements] = await Promise.all([
      checkoutApi.contracts(),
      checkoutApi.settlements(),
    ]);
    contracts.value = loadedContracts;
    settlements.value = loadedSettlements;
    const approved = loadedSettlements.find(
      (item) => item.status === "APPROVED",
    );
    refundSettlement.value =
      approved && typeof checkoutApi.detail === "function"
        ? await checkoutApi.detail(approved.id)
        : approved;
  } catch (error) {
    actionError.value = message(error, "退租数据加载失败，请稍后重试");
  } finally {
    loadingContracts.value = false;
  }
}
async function loadFinanceSnapshot(contractId: number) {
  try {
    financeSnapshot.value = await checkoutApi.financeSnapshot(contractId);
  } catch (error) {
    actionError.value = message(error, "财务快照加载失败，请稍后重试");
  }
}
async function initiate(contractId: number, payload: Record<string, string>) {
  actionError.value = "";
  try {
    await checkoutApi.initiate(contractId, payload);
    await loadData();
    activeTab.value = "settlement";
  } catch (error) {
    actionError.value = message(error, "发起退租失败，请稍后重试");
  }
}
async function submitSettlement(id: number, payload: Record<string, unknown>) {
  actionError.value = "";
  try {
    await checkoutApi.submit(id, payload);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "提交结算失败，请稍后重试");
  }
}
async function returnToDraft(id: number) {
  actionError.value = "";
  try {
    await checkoutApi.returnToDraft(id);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "退回草稿失败，请稍后重试");
  }
}
async function approveSettlement(id: number) {
  actionError.value = "";
  try {
    await checkoutApi.approve(id);
    await loadData();
    activeTab.value = "refund";
  } catch (error) {
    actionError.value = message(error, "确认结算失败，请稍后重试");
  }
}
async function uploadRefundProof(file: File) {
  actionError.value = "";
  try {
    const result = await checkoutApi.uploadRefundProof(file);
    refundPanel.value?.addProof(result.id);
  } catch (error) {
    actionError.value = message(error, "退款凭证上传失败，请稍后重试");
  }
}
async function submitRefund(payload: Record<string, unknown>) {
  actionError.value = "";
  try {
    await checkoutApi.submitRefund(payload);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "登记退款失败，请稍后重试");
  }
}
async function approveRefund(id: number) {
  actionError.value = "";
  try {
    await checkoutApi.approveRefund(id);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "确认退款失败，请稍后重试");
  }
}
async function completeZeroRefund(id: number) {
  actionError.value = "";
  try {
    await checkoutApi.completeZeroRefund(id);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "最终确认失败，请稍后重试");
  }
}
onMounted(loadData);
</script>

<template>
  <main class="checkout-workspace">
    <header class="checkout-workspace__header">
      <div>
        <span class="checkout-workspace__tag">退租结算</span>
        <h1>退租结算</h1>
        <p>按发起退租、退租结算、押金退还确认三个步骤完成交接。</p>
      </div>
      <CheckoutTopNav :active-tab="activeTab" @change="activeTab = $event" />
    </header>
    <p v-if="actionError" class="checkout-workspace__error" role="alert">
      {{ actionError }}
    </p>
    <CheckoutInitiatePanel
      v-if="activeTab === 'initiate'"
      :contracts="contracts"
      :loading="loadingContracts"
      :snapshot="financeSnapshot"
      @contract-change="loadFinanceSnapshot"
      @submit="initiate"
    />
    <CheckoutSettlementPanel
      v-else-if="activeTab === 'settlement'"
      :settlements="settlements"
      :is-super="isSuper"
      @submit="submitSettlement"
      @approve="approveSettlement"
      @return-to-draft="returnToDraft"
    />
    <CheckoutRefundPanel
      v-else
      ref="refundPanel"
      :settlement="approvedSettlement"
      :role="isSuper ? 'SUPER_ADMIN' : 'ADMIN'"
      @upload="uploadRefundProof"
      @submit="submitRefund"
      @approve="approveRefund"
      @complete-zero="completeZeroRefund"
    />
  </main>
</template>

<style scoped>
.checkout-workspace {
  min-height: 100%;
  padding: 24px;
  color: #233044;
  background: #f3f6fb;
}
.checkout-workspace__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}
.checkout-workspace__tag {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  color: #246bfd;
  background: #edf4ff;
  font-size: 12px;
}
.checkout-workspace__header h1 {
  margin: 8px 0 4px;
  font-size: 24px;
  line-height: 32px;
}
.checkout-workspace__header p {
  margin: 0;
  color: #66758b;
}
.checkout-workspace__error {
  padding: 10px 14px;
  border: 1px solid #ffc5c5;
  border-radius: 8px;
  color: #d9363e;
  background: #fff2f0;
}
@media (max-width: 760px) {
  .checkout-workspace {
    padding: 16px;
  }
  .checkout-workspace__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
