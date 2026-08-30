<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { CheckoutSettlement } from "./checkout-types";

const props = defineProps<{
  settlement?: CheckoutSettlement;
  role: "SUPER_ADMIN" | "ADMIN" | "VISITOR";
  uploading?: boolean;
  submitting?: boolean;
  approving?: boolean;
}>();
const emit = defineEmits<{
  upload: [file: File];
  submit: [payload: Record<string, unknown>];
  approve: [refundId: number];
  previewProof: [refundId: number, fileId: number];
  completeZero: [settlementId: number];
  collectSupplemental: [settlementId: number];
}>();

const today = new Date().toISOString().slice(0, 10);
const form = reactive({
  refundDate: today,
  refundMethod: "WECHAT",
  remark: "",
});
const proofFileIds = ref<number[]>([]);
const errors = ref<string[]>([]);
const total = computed(() => Number(props.settlement?.totalRefundAmount ?? 0));
const isRefundViewable = computed(
  () =>
    props.settlement?.status === "APPROVED" ||
    props.settlement?.status === "COMPLETED",
);
watch(
  () => props.settlement?.id,
  () => {
    proofFileIds.value = [];
    errors.value = [];
    form.remark = "";
  },
);
const hasSupplementalReceivable = computed(() => {
  if (props.settlement?.supplementalRequired) {
    return Number(props.settlement.supplementalOutstandingAmount || 0) > 0;
  }
  return Number(props.settlement?.finalReceivable || 0) > 0;
});
const supplementalOutstandingAmount = computed(() =>
  props.settlement?.supplementalRequired
    ? Number(props.settlement.supplementalOutstandingAmount || 0)
    : Number(props.settlement?.finalReceivable || 0),
);
const pendingRefund = computed(() =>
  props.settlement?.depositRefunds?.find(
    (item) => item.approvalStatus === "PENDING",
  ),
);
const approvedRefund = computed(() =>
  props.settlement?.depositRefunds?.find(
    (item) => item.approvalStatus === "APPROVED",
  ),
);

function format(value: number) {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function selectFile(event: Event) {
  if (props.uploading || props.submitting || props.role === "VISITOR") return;
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) emit("upload", file);
}
function addProof(id: number) {
  if (!proofFileIds.value.includes(id)) proofFileIds.value.push(id);
}
function submit() {
  if (props.uploading || props.submitting || props.role === "VISITOR") return;
  errors.value = [];
  if (!form.refundDate) errors.value.push("请选择退款日期");
  if (!form.refundMethod) errors.value.push("请选择退款方式");
  if (!proofFileIds.value.length) errors.value.push("请上传退款凭证");
  if (errors.value.length || !props.settlement) return;
  const { remark, ...requiredFields } = form;
  emit("submit", {
    checkoutSettlementId: props.settlement.id,
    refundAmount: total.value.toFixed(2),
    ...requiredFields,
    ...(remark.trim() ? { remark: remark.trim() } : {}),
    proofFileIds: proofFileIds.value,
  });
}
defineExpose({ addProof });
</script>

<template>
  <section class="refund-panel">
    <div class="refund-panel__title">
      <div>
        <h2>退租退款确认</h2>
        <p>
          退款金额由已确认结算单锁定；最终确认后合同结束，并按结算房态释放房源。
        </p>
      </div>
    </div>
    <div v-if="!settlement" class="refund-panel__empty">
      请选择已确认的退租结算单。
    </div>
    <div v-else-if="!isRefundViewable" class="refund-panel__empty">
      当前结算单尚未确认，暂不能进行最终退款处理。
    </div>
    <article
      v-else-if="hasSupplementalReceivable"
      class="refund-panel__card refund-panel__supplemental"
    >
      <span class="refund-panel__badge refund-panel__badge--warning"
        >待补收</span
      >
      <h3>请先收清退租补收款</h3>
      <p>
        本次退租尚有待补收 ¥{{
          format(supplementalOutstandingAmount)
        }}。收清前不能确认退款或完成退租。
      </p>
      <dl
        v-if="settlement.supplementalRequired"
        class="refund-panel__supplemental-breakdown"
      >
        <div>
          <dt>欠租补收</dt>
          <dd>
            ¥{{ format(Number(settlement.supplementalArrearsAmount || 0)) }}
          </dd>
        </div>
        <div>
          <dt>验房扣款</dt>
          <dd>
            ¥{{ format(Number(settlement.supplementalInspectionAmount || 0)) }}
          </dd>
        </div>
        <div>
          <dt>本次已收</dt>
          <dd>
            ¥{{ format(Number(settlement.supplementalReceivedAmount || 0)) }}
          </dd>
        </div>
      </dl>
      <button
        v-if="role !== 'VISITOR'"
        data-test="supplemental-collect"
        type="button"
        class="primary-button"
        @click="emit('collectSupplemental', settlement.id)"
      >
        前往收款登记
      </button>
      <p v-else class="refund-panel__hint">访客仅可查看，不可登记补收款。</p>
    </article>
    <article
      v-else-if="total === 0"
      class="refund-panel__card refund-panel__zero"
    >
      <span class="refund-panel__badge">无需退款确认</span>
      <h3>本次退租无需退款</h3>
      <p>
        应退押金、应退预收款、应退租金和待补收金额均为零。最终确认后合同结束，房源更新为结算单指定房态。
      </p>
      <button
        v-if="role === 'SUPER_ADMIN'"
        data-test="zero-complete"
        type="button"
        class="primary-button"
        @click="emit('completeZero', settlement.id)"
      >
        最终确认并完成退租
      </button>
      <p v-else class="refund-panel__hint">
        仅超级管理员可以完成零金额最终确认。
      </p>
    </article>
    <article v-else class="refund-panel__card">
      <div class="refund-panel__amounts">
        <div>
          <span>应退押金</span
          ><strong
            >¥{{
              format(Number(settlement.depositRefundableAmount || 0))
            }}</strong
          >
        </div>
        <div>
          <span>应退预收款</span
          ><strong
            >¥{{
              format(Number(settlement.prepaymentRefundableAmount || 0))
            }}</strong
          >
        </div>
        <div>
          <span>应退租金</span
          ><strong
            >¥{{ format(Number(settlement.rentRefundableAmount || 0)) }}</strong
          >
        </div>
        <div class="refund-panel__total">
          <span>合计退款金额</span><strong>¥{{ format(total) }}</strong>
        </div>
      </div>
      <section
        v-if="settlement.rentRefundAllocations?.length"
        class="refund-panel__allocations"
      >
        <h3>系统自动回冲明细</h3>
        <ul>
          <li
            v-for="allocation in settlement.rentRefundAllocations"
            :key="allocation.paymentAllocationId"
          >
            {{ allocation.billNo }} · {{ allocation.periodStart }} 至
            {{ allocation.periodEnd }} · ¥{{
              format(Number(allocation.amount))
            }}
          </li>
        </ul>
      </section>
      <section v-if="approvedRefund" class="refund-panel__status">
        <strong>退款已确认</strong
        ><span
          >{{ approvedRefund.refundNo || `退款单 #${approvedRefund.id}` }} · ¥{{
            format(Number(approvedRefund.refundAmount))
          }}</span
        >
      </section>
      <section v-else-if="pendingRefund" class="refund-panel__status">
        <strong>退款已登记，等待最终确认</strong
        ><span
          >{{ pendingRefund.refundNo || `退款单 #${pendingRefund.id}` }} · ¥{{
            format(Number(pendingRefund.refundAmount))
          }}</span
        >
        <div v-if="pendingRefund.files?.length" class="refund-panel__proofs">
          <button
            v-for="file in pendingRefund.files"
            :key="file.fileAssetId"
            :data-test="`refund-proof-preview-${pendingRefund.id}-${file.fileAssetId}`"
            type="button"
            class="refund-panel__proof-button"
            @click="emit('previewProof', pendingRefund.id, file.fileAssetId)"
          >
            预览凭证：{{ file.originalName || `凭证 #${file.fileAssetId}` }}
          </button>
        </div>
        <button
          v-if="role === 'SUPER_ADMIN'"
          data-test="refund-approve"
          type="button"
          class="primary-button"
          :disabled="approving"
          @click="emit('approve', pendingRefund.id)"
        >
          确认退款并完成退租
        </button>
        <p v-else>仅超级管理员可以进行最终确认。</p>
      </section>
      <template v-else>
        <div
          v-if="role !== 'VISITOR' && errors.length"
          class="refund-panel__errors"
          role="alert"
        >
          <p v-for="error in errors" :key="error">{{ error }}</p>
        </div>
        <div v-if="role !== 'VISITOR'" class="refund-panel__grid">
          <label
            ><span><i>*</i>退款日期</span
            ><input v-model="form.refundDate" type="date" lang="zh-CN" /></label
          ><label
            ><span><i>*</i>退款方式</span
            ><select v-model="form.refundMethod">
              <option value="WECHAT">微信</option>
              <option value="ALIPAY">支付宝</option>
              <option value="BANK_TRANSFER">银行转账</option>
              <option value="CASH">现金</option>
            </select></label
          ><label class="refund-panel__wide"
            ><span><i>*</i>上传退款凭证</span
            ><input
              type="file"
              :disabled="uploading || submitting"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              @change="selectFile"
            /><small
              >已上传 {{ proofFileIds.length }} 份凭证<span
                v-if="proofFileIds.length"
                >（{{
                  proofFileIds.map((id) => `凭证 #${id}`).join("、")
                }}）</span
              ></small
            ></label
          ><label class="refund-panel__wide"
            ><span>备注</span
            ><textarea v-model="form.remark" rows="3" maxlength="1000" />
          </label>
        </div>
        <div v-if="role !== 'VISITOR'" class="refund-panel__actions">
          <button
            data-test="refund-submit"
            type="button"
            class="primary-button"
            :disabled="uploading || submitting || !proofFileIds.length"
            @click="submit"
          >
            登记合并退款
          </button>
        </div>
        <p v-if="role === 'VISITOR'" class="refund-panel__hint">
          访客仅可查看，不能登记退款或上传凭证。
        </p>
      </template>
    </article>
  </section>
</template>

<style scoped>
.refund-panel {
  display: grid;
  gap: 16px;
}
.refund-panel__title h2 {
  margin: 0 0 6px;
  font-size: 20px;
}
.refund-panel__title p {
  margin: 0;
  color: #66758b;
}
.refund-panel__empty,
.refund-panel__card {
  padding: 24px;
  border: 1px solid #e4eaf3;
  border-radius: 12px;
  background: #fff;
}
.refund-panel__supplemental-breakdown {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.refund-panel__supplemental-breakdown div {
  padding: 12px;
  border-radius: 8px;
  background: #fff8e8;
}
.refund-panel__supplemental-breakdown dt {
  color: #8a6516;
  font-size: 13px;
}
.refund-panel__supplemental-breakdown dd {
  margin: 6px 0 0;
  color: #7a4c00;
  font-weight: 700;
}
.refund-panel__amounts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.refund-panel__amounts div {
  padding: 16px;
  border-radius: 8px;
  background: #f7f9fc;
}
.refund-panel__amounts span,
.refund-panel__amounts strong {
  .refund-panel__allocations {
    margin-top: 20px;
    padding: 16px;
    border: 1px solid #dce7f8;
    border-radius: 8px;
    background: #f7faff;
  }
  .refund-panel__allocations h3 {
    margin: 0;
    font-size: 15px;
  }
  .refund-panel__allocations ul {
    display: grid;
    gap: 8px;
    margin: 12px 0 0;
    padding-left: 20px;
    color: #4a5b72;
    font-size: 14px;
  }
  display: block;
}
.refund-panel__amounts span {
  color: #66758b;
  font-size: 13px;
}
.refund-panel__amounts strong {
  margin-top: 8px;
  font-size: 20px;
}
.refund-panel__amounts .refund-panel__total {
  color: #fff;
  background: #246bfd;
}
.refund-panel__total span {
  color: #dce9ff;
}
.refund-panel__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 20px;
  margin-top: 20px;
}
.refund-panel__grid label {
  display: grid;
  gap: 7px;
  color: #39465a;
  font-size: 14px;
}
.refund-panel__grid span i {
  margin-right: 4px;
  color: #f05252;
  font-style: normal;
}
.refund-panel__grid input,
.refund-panel__grid select,
.refund-panel__grid textarea {
  width: 100%;
  min-height: 40px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #d9e1ec;
  border-radius: 6px;
  background: #fff;
  font: inherit;
}
.refund-panel__grid textarea {
  min-height: 80px;
}
.refund-panel__wide {
  grid-column: span 2;
}
.refund-panel__grid small {
  color: #66758b;
}
.refund-panel__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
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
.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.refund-panel__badge {
  display: inline-flex;
  padding: 4px 8px;
  border-radius: 4px;
  color: #1d5ccf;
  background: #edf4ff;
  font-size: 13px;
}
.refund-panel__zero h3 {
  margin: 14px 0 8px;
}
.refund-panel__zero p {
  max-width: 680px;
  color: #66758b;
  line-height: 1.7;
}
.refund-panel__hint {
  color: #66758b;
}
.refund-panel__errors {
  margin-top: 16px;
  padding: 10px 14px;
  border: 1px solid #ffc5c5;
  border-radius: 8px;
  color: #d9363e;
  background: #fff2f0;
}
.refund-panel__errors p {
  margin: 2px 0;
}
.refund-panel__status {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 20px;
  padding: 16px;
  border: 1px solid #cfe5d8;
  border-radius: 8px;
  color: #206940;
  background: #f2fbf5;
}
.refund-panel__status strong {
  font-size: 16px;
}
.refund-panel__status span {
  color: #4e705b;
}
.refund-panel__proofs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.refund-panel__proof-button {
  border: 0;
  color: #246bfd;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.refund-panel__status p {
  margin: 0;
  color: #66758b;
}
.refund-panel > .refund-panel__allocations {
  display: grid;
  grid-column: 1 / -1;
  gap: 10px;
  margin-top: 20px;
  padding: 16px;
  border: 1px solid #dce7f8;
  border-radius: 8px;
  background: #f7faff;
}
.refund-panel > .refund-panel__allocations h3,
.refund-panel > .refund-panel__allocations ul {
  margin: 0;
}
.refund-panel > .refund-panel__allocations ul {
  display: grid;
  gap: 8px;
  padding-left: 20px;
  color: #4a5b72;
  font-size: 14px;
}
@media (max-width: 760px) {
  .refund-panel__card,
  .refund-panel__empty {
    padding: 16px;
  }
  .refund-panel__amounts,
  .refund-panel__grid {
    grid-template-columns: 1fr;
  }
  .refund-panel__wide {
    grid-column: auto;
  }
}
</style>
