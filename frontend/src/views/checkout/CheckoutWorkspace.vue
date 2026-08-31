<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
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
  CheckoutSettlementPreview,
  CheckoutSettlementPayload,
  CompletedCheckoutContractsResult,
} from "./checkout-types";

const route = useRoute() || { query: {} };
const router = useRouter();
const session = useSessionStore();
const activeTab = ref<CheckoutTab>("initiate");
const contracts = ref<CheckoutContract[]>([]);
const settlements = ref<CheckoutSettlement[]>([]);
const refundSettlements = ref<CheckoutSettlement[]>([]);
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
const settlementPreview = ref<CheckoutSettlementPreview>();
const previewLoading = ref(false);
let previewRequestVersion = 0;
let refundRequestVersion = 0;
let refundProofPreviewVersion = 0;
let completedDetailRequestVersion = 0;
const actionError = ref("");
const previewError = ref("");
const settlementMutationPending = ref(false);
const refundUploading = ref(false);
const refundSubmitting = ref(false);
const refundApproving = ref(false);
const refundCancelling = ref(false);
const selectedInitiateContractId = ref<number | null>(null);
const refundPanel = ref<{ addProof: (id: number) => void } | null>(null);
const refundProofPreview = ref<{
  url: string;
  mimeType: string;
  fileName: string;
}>();
const refundRole = computed<"SUPER_ADMIN" | "ADMIN" | "VISITOR">(
  () => session.user?.role ?? "VISITOR",
);
applyRouteState();
const approvedSettlement = computed(() => refundSettlement.value);
function setRefundSettlement(next?: CheckoutSettlement) {
  if (refundSettlement.value?.id !== next?.id) {
    refundRequestVersion += 1;
    closeRefundProofPreview();
  }
  refundSettlement.value = next;
}
function message(error: unknown, fallback: string) {
  const backendMessage = (
    error as { response?: { data?: { message?: string | string[] } } }
  )?.response?.data?.message;
  const messages = Array.isArray(backendMessage)
    ? backendMessage
    : backendMessage
      ? [backendMessage]
      : [];
  const chineseMessages = messages.filter((item) =>
    /[\u3400-\u9fff]/u.test(item),
  );
  return chineseMessages.length ? chineseMessages.join("；") : fallback;
}
function positiveQueryId(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
function applyRouteState() {
  const requestedTab = String(route.query.tab || "");
  if (
    ["initiate", "settlement", "refund", "completed"].includes(requestedTab)
  ) {
    activeTab.value = requestedTab as CheckoutTab;
  }
  if (positiveQueryId(route.query.settlementId)) {
    activeTab.value = "completed";
  }
  const contractId = Number(route.query.contractId);
  selectedInitiateContractId.value =
    Number.isInteger(contractId) && contractId > 0 ? contractId : null;
}

async function loadData() {
  loadingContracts.value = true;
  try {
    const [loadedContracts, loadedSettlements, refundPending] =
      await Promise.all([
        checkoutApi.contracts(),
        checkoutApi.settlements(),
        checkoutApi.refundPendingSettlements(),
      ]);
    contracts.value = loadedContracts;
    settlements.value = loadedSettlements;
    refundSettlements.value = refundPending;
    const selectedId = refundPending.some(
      (item) => item.id === refundSettlement.value?.id,
    )
      ? refundSettlement.value?.id
      : refundPending[0]?.id;
    await selectRefundSettlement(selectedId);
  } catch (error) {
    actionError.value = message(error, "退租数据加载失败，请稍后重试");
  } finally {
    loadingContracts.value = false;
  }
}
async function selectRefundSettlement(settlementId?: number) {
  if (!settlementId) {
    setRefundSettlement(undefined);
    return;
  }
  const summary = refundSettlements.value.find(
    (item) => item.id === settlementId,
  );
  setRefundSettlement(summary);
  const requestVersion = refundRequestVersion;
  try {
    const detail = await checkoutApi.detail(settlementId);
    if (
      requestVersion === refundRequestVersion &&
      refundSettlement.value?.id === settlementId
    )
      refundSettlement.value = detail;
  } catch (error) {
    if (requestVersion === refundRequestVersion)
      actionError.value = message(error, "退租退款详情加载失败，请稍后重试");
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
  closeRefundProofPreview();
  completedDetail.value = undefined;
  const requestVersion = ++completedDetailRequestVersion;
  actionError.value = "";
  try {
    const detail = await checkoutApi.detail(settlementId);
    if (requestVersion === completedDetailRequestVersion)
      completedDetail.value = detail;
  } catch (error) {
    if (requestVersion === completedDetailRequestVersion)
      actionError.value = message(error, "退租结算详情加载失败，请稍后重试");
  }
}
function changeTab(tab: CheckoutTab) {
  activeTab.value = tab;
  closeRefundProofPreview();
  clearSettlementPreview();
  completedDetailRequestVersion += 1;
  completedDetail.value = undefined;
  if (tab === "completed") void loadCompletedContracts();
}
const roomStatusLabels: Record<string, string> = {
  EMPTY: "空置",
  MAINTENANCE: "维修中",
  DISABLED: "停用",
};
const refundApprovalStatusLabels: Record<string, string> = {
  PENDING: "待确认",
  APPROVED: "已确认",
  REJECTED: "已驳回",
};
function roomStatusLabel(status?: string) {
  return status ? roomStatusLabels[status] || status : "—";
}
function refundApprovalStatusLabel(status: string) {
  return refundApprovalStatusLabels[status] || status;
}
function formatMoney(value: string) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function refundProofFilename(disposition: unknown, fileId: number) {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(String(disposition || ""));
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      // Fall back to a safe Chinese filename if the server header is malformed.
    }
  }
  return "退款凭证-" + fileId;
}
function isCompletedDetailContextCurrent(
  settlementId?: number,
  requestVersion?: number,
) {
  return (
    settlementId === undefined ||
    (completedDetail.value?.id === settlementId &&
      completedDetailRequestVersion === requestVersion)
  );
}
async function downloadRefundProof(
  refundId: number,
  fileId: number,
  completedSettlementId?: number,
) {
  const contextVersion = completedSettlementId
    ? completedDetailRequestVersion
    : undefined;
  if (!isCompletedDetailContextCurrent(completedSettlementId, contextVersion))
    return;
  actionError.value = "";
  try {
    const response = await checkoutApi.downloadRefundProof(refundId, fileId);
    if (!isCompletedDetailContextCurrent(completedSettlementId, contextVersion))
      return;
    const url = URL.createObjectURL(response.data);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = refundProofFilename(
        response.headers["content-disposition"],
        fileId,
      );
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    if (isCompletedDetailContextCurrent(completedSettlementId, contextVersion))
      actionError.value = message(error, "退款凭证下载失败，请稍后重试");
  }
}
function closeRefundProofPreview() {
  refundProofPreviewVersion += 1;
  if (refundProofPreview.value?.url) {
    URL.revokeObjectURL(refundProofPreview.value.url);
  }
  refundProofPreview.value = undefined;
}
function previewCompletedRefundProof(
  settlementId: number | undefined,
  refundId: number,
  fileId: number,
) {
  if (!settlementId) return;
  return previewRefundProof(refundId, fileId, settlementId);
}
function downloadCompletedRefundProof(
  settlementId: number | undefined,
  refundId: number,
  fileId: number,
) {
  if (!settlementId) return;
  return downloadRefundProof(refundId, fileId, settlementId);
}
async function previewRefundProof(
  refundId: number,
  fileId: number,
  completedSettlementId?: number,
) {
  const contextVersion = completedSettlementId
    ? completedDetailRequestVersion
    : undefined;
  if (!isCompletedDetailContextCurrent(completedSettlementId, contextVersion))
    return;
  actionError.value = "";
  closeRefundProofPreview();
  const requestVersion = refundProofPreviewVersion;
  try {
    const response = await checkoutApi.downloadRefundProof(refundId, fileId);
    const mimeType = String(
      response.headers["content-type"] || response.data.type || "",
    ).toLowerCase();
    if (!mimeType.startsWith("image/") && mimeType !== "application/pdf") {
      if (
        requestVersion === refundProofPreviewVersion &&
        isCompletedDetailContextCurrent(completedSettlementId, contextVersion)
      )
        actionError.value = "该凭证格式暂不支持在线预览，请下载后查看";
      return;
    }
    const url = URL.createObjectURL(response.data);
    if (
      requestVersion !== refundProofPreviewVersion ||
      !isCompletedDetailContextCurrent(completedSettlementId, contextVersion)
    ) {
      URL.revokeObjectURL(url);
      return;
    }
    refundProofPreview.value = {
      url,
      mimeType,
      fileName: refundProofFilename(
        response.headers["content-disposition"],
        fileId,
      ),
    };
  } catch (error) {
    if (
      requestVersion === refundProofPreviewVersion &&
      isCompletedDetailContextCurrent(completedSettlementId, contextVersion)
    )
      actionError.value = message(error, "退款凭证预览失败，请稍后重试");
  }
}
onBeforeUnmount(() => {
  completedDetailRequestVersion += 1;
  completedDetail.value = undefined;
  closeRefundProofPreview();
});

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
async function submitSettlement(
  id: number,
  payload: CheckoutSettlementPayload,
) {
  if (settlementMutationPending.value) return;
  settlementMutationPending.value = true;
  actionError.value = "";
  try {
    await checkoutApi.submit(id, payload);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "提交结算失败，请检查填写内容后重试");
  } finally {
    settlementMutationPending.value = false;
  }
}
function clearSettlementPreview() {
  previewRequestVersion += 1;
  settlementPreview.value = undefined;
  previewError.value = "";
  previewLoading.value = false;
}

async function previewSettlement(
  id: number,
  payload: CheckoutSettlementPayload,
) {
  const requestVersion = ++previewRequestVersion;
  previewLoading.value = true;
  previewError.value = "";
  try {
    const preview = await checkoutApi.preview(id, payload);
    if (requestVersion === previewRequestVersion)
      settlementPreview.value = preview;
  } catch (error) {
    if (requestVersion === previewRequestVersion) {
      settlementPreview.value = undefined;
      previewError.value = message(error, "结算金额预估失败，请检查填写内容");
    }
  } finally {
    if (requestVersion === previewRequestVersion) previewLoading.value = false;
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
async function cancelSettlement(id: number) {
  if (settlementMutationPending.value) return;
  settlementMutationPending.value = true;
  actionError.value = "";
  try {
    await checkoutApi.cancel(id);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "取消退租结算失败，请稍后重试");
  } finally {
    settlementMutationPending.value = false;
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
  if (refundUploading.value || refundSubmitting.value) return;
  const requestVersion = refundRequestVersion;
  const settlementId = refundSettlement.value?.id;
  if (!settlementId) return;
  refundUploading.value = true;
  actionError.value = "";
  try {
    const result = await checkoutApi.uploadRefundProof(file);
    if (
      requestVersion === refundRequestVersion &&
      settlementId === refundSettlement.value?.id
    )
      refundPanel.value?.addProof(result.id);
  } catch (error) {
    actionError.value = message(error, "退款凭证上传失败，请稍后重试");
  } finally {
    refundUploading.value = false;
  }
}
async function submitRefund(payload: Record<string, unknown>) {
  if (refundUploading.value || refundSubmitting.value) return;
  refundSubmitting.value = true;
  actionError.value = "";
  try {
    await checkoutApi.submitRefund(payload);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "登记退款失败，请稍后重试");
  } finally {
    refundSubmitting.value = false;
  }
}
async function approveRefund(id: number) {
  if (refundApproving.value) return;
  refundApproving.value = true;
  actionError.value = "";
  try {
    await checkoutApi.approveRefund(id);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "确认退款失败，请稍后重试");
  } finally {
    refundApproving.value = false;
  }
}
async function cancelRefundApplication(id: number) {
  if (refundCancelling.value) return;
  if (
    !window.confirm(
      "仅取消本次退款申请，退租结算和租金预留将继续保留。确定继续吗？",
    )
  )
    return;
  refundCancelling.value = true;
  actionError.value = "";
  try {
    await checkoutApi.cancelRefund(id);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "取消退款申请失败，请稍后重试");
  } finally {
    refundCancelling.value = false;
  }
}
async function cancelApprovedCheckout(id: number) {
  if (refundCancelling.value) return;
  if (
    !window.confirm(
      "将取消整个退租，恢复合同、房态、押金抵扣和相关账单。确定继续吗？",
    )
  )
    return;
  refundCancelling.value = true;
  actionError.value = "";
  try {
    await checkoutApi.cancel(id);
    await loadData();
  } catch (error) {
    actionError.value = message(error, "取消整个退租失败，请稍后重试");
  } finally {
    refundCancelling.value = false;
  }
}
async function collectSupplemental(id: number) {
  const contractId = approvedSettlement.value?.contractId;
  if (!contractId) {
    actionError.value = "退租补收单缺少合同信息，请刷新后重试";
    return;
  }
  await router.push({
    path: "/payments/collect",
    query: { contractId: String(contractId), checkoutSettlementId: String(id) },
  });
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
async function initialize() {
  await loadData();
  const settlementId = positiveQueryId(route.query.settlementId);
  if (!settlementId) return;
  await Promise.all([
    loadCompletedContracts(),
    openCompletedDetail(settlementId),
  ]);
}
onMounted(initialize);
</script>

<template>
  <main class="checkout-workspace">
    <CheckoutTopNav :active-tab="activeTab" @change="changeTab" />
    <p
      v-if="actionError || previewError"
      class="checkout-workspace__error"
      role="alert"
    >
      {{ actionError || previewError }}
    </p>
    <CheckoutInitiatePanel
      v-if="activeTab === 'initiate'"
      :contracts="contracts"
      :loading="loadingContracts"
      :snapshot="financeSnapshot"
      :selected-contract-id="selectedInitiateContractId"
      @contract-change="loadFinanceSnapshot"
      @submit="initiate"
    />
    <CheckoutSettlementPanel
      v-else-if="activeTab === 'settlement'"
      :settlements="settlements"
      :role="refundRole"
      @submit="submitSettlement"
      :preview="settlementPreview"
      :preview-loading="previewLoading"
      :submitting="settlementMutationPending"
      :cancelling="settlementMutationPending"
      @preview="previewSettlement"
      @clear-preview="clearSettlementPreview"
      @approve="approveSettlement"
      @return-to-draft="returnToDraft"
      @cancel="cancelSettlement"
    />
    <CheckoutRefundPanel
      v-else-if="activeTab === 'refund'"
      ref="refundPanel"
      :settlement="approvedSettlement"
      :settlements="refundSettlements"
      :role="refundRole"
      :uploading="refundUploading"
      :submitting="refundSubmitting"
      :approving="refundApproving"
      :cancelling="refundCancelling"
      @select-settlement="selectRefundSettlement"
      @upload="uploadRefundProof"
      @submit="submitRefund"
      @approve="approveRefund"
      @cancel-refund="cancelRefundApplication"
      @cancel-checkout="cancelApprovedCheckout"
      @preview-proof="previewRefundProof"
      @collect-supplemental="collectSupplemental"
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
      <section
        v-if="completedDetail"
        class="checkout-workspace__readonly-detail"
      >
        <header>
          <div>
            <span>只读详情</span>
            <h2>{{ completedDetail.settlementNo }}</h2>
          </div>
          <button type="button" @click="completedDetail = undefined">
            关闭
          </button>
        </header>
        <div class="checkout-workspace__readonly-grid">
          <article>
            <h3>合同与房源</h3>
            <p>合同编号：{{ completedDetail.contract?.contractNo || "—" }}</p>
            <p>
              房源：{{ completedDetail.contract?.room?.fullHouseNo || "—" }}
            </p>
            <p>
              房态结果：{{ roomStatusLabel(completedDetail.targetRoomStatus) }}
            </p>
          </article>
          <article>
            <h3>结算项目</h3>
            <p v-if="!completedDetail.items?.length">本次无结算项目</p>
            <p
              v-for="item in completedDetail.items"
              :key="item.id || item.description"
            >
              {{ item.description || item.itemType }}：¥{{
                formatMoney(item.amount)
              }}
            </p>
          </article>
          <article>
            <h3>合并退款快照</h3>
            <p>
              应退押金：¥{{
                formatMoney(completedDetail.depositRefundableAmount)
              }}
            </p>
            <p>
              应退预收款：¥{{
                formatMoney(completedDetail.prepaymentRefundableAmount)
              }}
            </p>
            <p>
              应退租金：¥{{ formatMoney(completedDetail.rentRefundableAmount) }}
            </p>
            <p>
              合计退款：¥{{
                formatMoney(completedDetail.totalRefundAmount || "0.00")
              }}
            </p>
            <h3>退款凭证</h3>
            <p v-if="!completedDetail.depositRefunds?.length">本次无退款</p>
            <div
              v-for="refund in completedDetail.depositRefunds?.slice(0, 1)"
              :key="refund.id"
              class="checkout-workspace__refund-proof"
            >
              <p>
                {{ refund.refundNo || "退款单 #" + refund.id }}：¥{{
                  formatMoney(refund.refundAmount)
                }}，状态：{{ refundApprovalStatusLabel(refund.approvalStatus) }}
              </p>
              <p v-if="!refund.files?.length">未上传凭证</p>
              <template v-for="file in refund.files" :key="file.fileAssetId">
                <button
                  :data-test="
                    'refund-proof-preview-' + refund.id + '-' + file.fileAssetId
                  "
                  type="button"
                  class="checkout-workspace__proof-download"
                  @click="
                    previewCompletedRefundProof(
                      completedDetail?.id,
                      refund.id,
                      file.fileAssetId,
                    )
                  "
                >
                  在线预览
                </button>
                <button
                  :data-test="
                    'refund-proof-download-' +
                    refund.id +
                    '-' +
                    file.fileAssetId
                  "
                  type="button"
                  class="checkout-workspace__proof-download"
                  @click="
                    downloadCompletedRefundProof(
                      completedDetail?.id,
                      refund.id,
                      file.fileAssetId,
                    )
                  "
                >
                  下载凭证：{{
                    file.originalName || "退款凭证-" + file.fileAssetId
                  }}（凭证编号：{{ file.fileAssetId }}）
                </button>
              </template>
            </div>
          </article>
          <article v-if="completedDetail.rentRefundAllocations?.length">
            <h3>退还租金回冲明细</h3>
            <p
              v-for="allocation in completedDetail.rentRefundAllocations"
              :key="allocation.paymentAllocationId"
            >
              {{ allocation.billNo }}：¥{{
                formatMoney(allocation.amount)
              }}
              （{{ allocation.status === "APPLIED" ? "已回冲" : "已预留" }}）
            </p>
          </article>
        </div>
      </section>
    </template>
    <div
      v-if="refundProofPreview"
      class="checkout-workspace__preview-overlay"
      data-test="refund-proof-preview-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="`预览${refundProofPreview.fileName}`"
    >
      <div class="checkout-workspace__preview-dialog">
        <header>
          <strong>{{ refundProofPreview.fileName }}</strong>
          <button
            data-test="refund-proof-preview-close"
            type="button"
            @click="closeRefundProofPreview"
          >
            关闭
          </button>
        </header>
        <img
          v-if="refundProofPreview.mimeType.startsWith('image/')"
          :src="refundProofPreview.url"
          :alt="refundProofPreview.fileName"
        />
        <iframe
          v-else
          :src="refundProofPreview.url"
          :title="refundProofPreview.fileName"
        />
      </div>
    </div>
  </main>
</template>

<style scoped>
.checkout-workspace {
  min-height: 100%;
  padding: 24px;
  color: #233044;
  background: #f3f6fb;
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
.checkout-workspace__readonly-detail h2 {
  margin: 6px 0 0;
  font-size: 18px;
}
.checkout-workspace__readonly-detail header span {
  color: #66758b;
  font-size: 13px;
}
.checkout-workspace__readonly-detail header button {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid #d9e1ec;
  border-radius: 6px;
  color: #39465a;
  background: #fff;
  font: inherit;
  cursor: pointer;
}
.checkout-workspace__readonly-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 18px;
}
.checkout-workspace__readonly-grid article {
  padding: 16px;
  border-radius: 8px;
  background: #f7f9fc;
}
.checkout-workspace__readonly-grid h3 {
  margin: 0 0 10px;
  font-size: 15px;
}
.checkout-workspace__readonly-grid p {
  margin: 6px 0;
  color: #526178;
  font-size: 14px;
  line-height: 1.55;
}
.checkout-workspace__refund-proof + .checkout-workspace__refund-proof {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e4eaf3;
}
.checkout-workspace__proof-download {
  min-height: 32px;
  margin: 4px 8px 0 0;
  padding: 0;
  border: 0;
  color: #246bfd;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
@media (max-width: 760px) {
  .checkout-workspace {
    padding: 16px;
  }
  .checkout-workspace__readonly-grid {
    grid-template-columns: 1fr;
  }
}
.checkout-workspace__preview-overlay {
  position: fixed;
  z-index: 2000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(15 23 42 / 58%);
}
.checkout-workspace__preview-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(1000px, 92vw);
  height: min(760px, 88vh);
  overflow: hidden;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 24px 70px rgb(15 23 42 / 30%);
}
.checkout-workspace__preview-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid #e4eaf3;
}
.checkout-workspace__preview-dialog img,
.checkout-workspace__preview-dialog iframe {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 0;
  object-fit: contain;
  background: #f7f9fc;
}
</style>
