<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { checkoutApi } from "../../services/checkout";
import { useSessionStore } from "../../stores/session";
import CheckoutInitiatePanel from "./CheckoutInitiatePanel.vue";
import CheckoutRefundPanel from "./CheckoutRefundPanel.vue";
import CompletedCheckoutContractsPanel from "./CompletedCheckoutContractsPanel.vue";
import CheckoutSettlementPanel from "./CheckoutSettlementPanel.vue";
import CheckoutTopNav from "./CheckoutTopNav.vue";
import type {
  CheckoutContract,
  CheckoutSettlement,
  CheckoutTab,
  CompletedCheckoutContractsResult,
  DepositRefund,
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
const completedContracts = ref<CompletedCheckoutContractsResult>({
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
});
const completedKeyword = ref("");
const completedDetail = ref<CheckoutSettlement>();
const loadingCompletedContracts = ref(false);
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
async function loadCompletedContracts(
  page = 1,
  keyword = completedKeyword.value,
) {
  loadingCompletedContracts.value = true;
  actionError.value = "";
  try {
    completedKeyword.value = keyword;
    completedContracts.value = await checkoutApi.completedContracts({
      keyword: keyword || undefined,
      page,
      pageSize: completedContracts.value.pageSize,
    });
  } catch (error) {
    actionError.value = message(error, "已退租合同加载失败，请稍后重试");
  } finally {
    loadingCompletedContracts.value = false;
  }
}
async function openCompletedDetail(settlementId: number) {
  actionError.value = "";
  try {
    completedDetail.value = await checkoutApi.detail(settlementId);
  } catch (error) {
    actionError.value = message(error, "退租结算详情加载失败，请稍后重试");
  }
}
function changeTab(tab: CheckoutTab) {
  activeTab.value = tab;
  completedDetail.value = undefined;
  if (tab === "completed") void loadCompletedContracts();
}
function refundProofIds(refund: DepositRefund) {
  return refund.files?.map((file) => file.fileAssetId).join("、") || "无";
}
function formatMoney(value: string) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
      <CheckoutTopNav :active-tab="activeTab" @change="changeTab" />
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
      v-else-if="activeTab === 'refund'"
      ref="refundPanel"
      :settlement="approvedSettlement"
      :role="isSuper ? 'SUPER_ADMIN' : 'ADMIN'"
      @upload="uploadRefundProof"
      @submit="submitRefund"
      @approve="approveRefund"
      @complete-zero="completeZeroRefund"
    />
    <template v-else>
      <CompletedCheckoutContractsPanel
        :result="completedContracts"
        :loading="loadingCompletedContracts"
        @search="loadCompletedContracts(1, $event)"
        @page-change="loadCompletedContracts($event)"
        @select="openCompletedDetail"
      />
      <section v-if="completedDetail" class="checkout-workspace__readonly-detail">
        <header>
          <div>
            <span>只读详情</span>
            <h2>{{ completedDetail.settlementNo }}</h2>
          </div>
          <button type="button" @click="completedDetail = undefined">关闭</button>
        </header>
        <div class="checkout-workspace__readonly-grid">
          <article>
            <h3>合同与房源</h3>
            <p>合同编号：{{ completedDetail.contract?.contractNo || "—" }}</p>
            <p>房源：{{ completedDetail.contract?.room?.fullHouseNo || "—" }}</p>
            <p>房态结果：{{ completedDetail.targetRoomStatus || "—" }}</p>
          </article>
          <article>
            <h3>结算项目</h3>
            <p v-if="!completedDetail.items?.length">本次无结算项目</p>
            <p v-for="item in completedDetail.items" :key="item.id || item.description">
              {{ item.description || item.itemType }}：¥{{ formatMoney(item.amount) }}
            </p>
          </article>
          <article>
            <h3>退款凭证</h3>
            <p v-if="!completedDetail.depositRefunds?.length">本次无退款</p>
            <p v-for="refund in completedDetail.depositRefunds" :key="refund.id">
              {{ refund.refundNo || `退款单 #${refund.id}` }}：¥{{ formatMoney(refund.refundAmount) }}，凭证编号：{{ refundProofIds(refund) }}
            </p>
          </article>
        </div>
      </section>
    </template>
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
.checkout-workspace__readonly-detail {
  margin-top: 16px;
  padding: 20px;
  border: 1px solid #e4eaf3;
  border-radius: 12px;
  background: #fff;
}
.checkout-workspace__readonly-detail header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.checkout-workspace__readonly-detail h2 { margin: 6px 0 0; font-size: 18px; }
.checkout-workspace__readonly-detail header span { color: #66758b; font-size: 13px; }
.checkout-workspace__readonly-detail header button { min-height: 34px; padding: 0 12px; border: 1px solid #d9e1ec; border-radius: 6px; color: #39465a; background: #fff; font: inherit; cursor: pointer; }
.checkout-workspace__readonly-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }
.checkout-workspace__readonly-grid article { padding: 16px; border-radius: 8px; background: #f7f9fc; }
.checkout-workspace__readonly-grid h3 { margin: 0 0 10px; font-size: 15px; }
.checkout-workspace__readonly-grid p { margin: 6px 0; color: #526178; font-size: 14px; line-height: 1.55; }
@media (max-width: 760px) {
  .checkout-workspace {
    padding: 16px;
  }
  .checkout-workspace__header {
    align-items: stretch;
    flex-direction: column;
  }
  .checkout-workspace__readonly-grid { grid-template-columns: 1fr; }
}
</style>
