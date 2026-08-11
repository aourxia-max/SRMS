<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CompletedCheckoutContractsResult } from "./checkout-types";

const props = defineProps<{
  result: CompletedCheckoutContractsResult;
  loading?: boolean;
}>();
const emit = defineEmits<{
  search: [keyword: string];
  pageChange: [page: number];
  select: [settlementId: number];
}>();

const keyword = ref("");
const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.result.total / props.result.pageSize)),
);

watch(
  () => props.result.page,
  () => window.scrollTo?.({ top: 0, behavior: "smooth" }),
);

function submitSearch() {
  emit("search", keyword.value.trim());
}
function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
function formatMoney(value: string) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
</script>

<template>
  <section class="completed-contracts-panel">
    <div class="completed-contracts-panel__title">
      <div>
        <h2>已退租合同</h2>
        <p>仅展示退租结算已完成且合同已结束的记录。</p>
      </div>
      <form class="completed-contracts-panel__search" @submit.prevent="submitSearch">
        <input
          v-model="keyword"
          data-test="completed-contract-search"
          type="search"
          placeholder="搜索合同编号、楼栋房号或租户姓名"
        />
        <button
          data-test="completed-contract-search-submit"
          type="button"
          class="primary-button"
          @click="submitSearch"
        >
          搜索
        </button>
      </form>
    </div>

    <div v-if="loading" class="completed-contracts-panel__empty">正在加载已退租合同…</div>
    <div v-else-if="!result.items.length" class="completed-contracts-panel__empty">
      暂无符合条件的已退租合同
    </div>
    <div v-else class="completed-contracts-panel__table-wrap">
      <table>
        <thead>
          <tr>
            <th>合同编号</th>
            <th>房源</th>
            <th>租户</th>
            <th>实际退房日期</th>
            <th>结算单号</th>
            <th>退款金额</th>
            <th>完成时间</th>
            <th aria-label="操作"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in result.items" :key="item.settlementId">
            <td>{{ item.contractNo }}</td>
            <td>{{ item.roomFullHouseNo }}</td>
            <td>{{ item.tenantName || "—" }}</td>
            <td>{{ formatDate(item.actualCheckoutDate) }}</td>
            <td>{{ item.settlementNo }}</td>
            <td class="completed-contracts-panel__money">¥{{ formatMoney(item.refundAmount) }}</td>
            <td>{{ formatDate(item.completedAt) }}</td>
            <td>
              <button
                :data-test="`completed-contract-detail-${item.settlementId}`"
                type="button"
                class="link-button"
                @click="emit('select', item.settlementId)"
              >
                查看详情
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer v-if="result.total > result.pageSize" class="completed-contracts-panel__pagination">
      <span>共 {{ result.total }} 条</span>
      <button
        type="button"
        :disabled="result.page <= 1"
        @click="emit('pageChange', result.page - 1)"
      >
        上一页
      </button>
      <span>第 {{ result.page }} / {{ totalPages }} 页</span>
      <button
        type="button"
        :disabled="result.page >= totalPages"
        @click="emit('pageChange', result.page + 1)"
      >
        下一页
      </button>
    </footer>
  </section>
</template>

<style scoped>
.completed-contracts-panel { display: grid; gap: 16px; }
.completed-contracts-panel__title { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.completed-contracts-panel__title h2 { margin: 0 0 6px; font-size: 20px; }
.completed-contracts-panel__title p { margin: 0; color: #66758b; }
.completed-contracts-panel__search { display: flex; gap: 8px; }
.completed-contracts-panel__search input { min-width: 280px; min-height: 40px; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d9e1ec; border-radius: 6px; font: inherit; }
.completed-contracts-panel__empty, .completed-contracts-panel__table-wrap { border: 1px solid #e4eaf3; border-radius: 12px; background: #fff; }
.completed-contracts-panel__empty { padding: 40px 24px; color: #66758b; text-align: center; }
.completed-contracts-panel__table-wrap { overflow-x: auto; }
table { width: 100%; min-width: 980px; border-collapse: collapse; }
th, td { padding: 14px 16px; border-bottom: 1px solid #eef2f7; text-align: left; white-space: nowrap; }
th { color: #66758b; background: #f8fafc; font-size: 13px; font-weight: 500; }
td { color: #27354a; font-size: 14px; }
tbody tr:last-child td { border-bottom: 0; }
.completed-contracts-panel__money { color: #c97a13; font-weight: 600; }
.primary-button, .link-button, .completed-contracts-panel__pagination button { min-height: 36px; padding: 0 14px; border-radius: 6px; font: inherit; cursor: pointer; }
.primary-button { border: 0; color: #fff; background: #246bfd; }
.link-button { padding: 0; border: 0; color: #246bfd; background: transparent; }
.completed-contracts-panel__pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; color: #66758b; font-size: 14px; }
.completed-contracts-panel__pagination button { border: 1px solid #d9e1ec; color: #39465a; background: #fff; }
.completed-contracts-panel__pagination button:disabled { cursor: not-allowed; opacity: .5; }
@media (max-width: 760px) { .completed-contracts-panel__title { align-items: stretch; flex-direction: column; } .completed-contracts-panel__search input { min-width: 0; width: 100%; } }
</style>
