<script setup lang="ts">
import type { PaymentListItem } from '../../types/payments'

defineProps<{
  rows: PaymentListItem[]
  total: number
  currentPage: number
  pageSize: number
  selectedId: number | null
}>()

const emit = defineEmits<{
  select: [id: number]
  'page-change': [page: number]
}>()

function money(value: unknown) {
  return `\u00a5${Number(value ?? 0).toFixed(2)}`
}

function date(value: unknown) {
  return value ? String(value).slice(0, 10) : '\u2014'
}
</script>

<template>
  <el-card shadow="never" class="payment-record-list">
    <template #header>
      <b>&#25910;&#27454;&#35760;&#24405;&#65288;&#20849; {{ total }} &#31508;&#65289;</b>
    </template>
    <button
      v-for="row in rows"
      :key="row.id"
      :data-test="`payment-record-${row.id}`"
      class="record-item"
      :class="{ active: selectedId === row.id }"
      @click="emit('select', row.id)"
    >
      <span>
        <b>{{ row.receiptNo }}</b>
        <small>{{ row.contract.room?.fullHouseNo }} &#183; {{ row.tenant?.name ?? '\u672a\u767b\u8bb0\u79df\u6237' }}</small>
      </span>
      <span>
        <b>{{ money(row.amount) }}</b>
        <small>{{ date(row.paymentDate) }}</small>
      </span>
    </button>
    <el-empty v-if="!rows.length" description="&#27809;&#26377;&#21305;&#37197;&#30340;&#25910;&#27454;&#35760;&#24405;" />
    <div v-if="total > pageSize" class="record-pagination">
      <el-pagination
        :current-page="currentPage"
        :page-size="pageSize"
        :total="total"
        background
        layout="prev, pager, next"
        small
        @current-change="emit('page-change', $event)"
      />
    </div>
  </el-card>
</template>

<style scoped>
.payment-record-list{position:sticky;top:88px}
.payment-record-list :deep(.el-card__body){padding:0}
.record-item{display:flex;width:100%;justify-content:space-between;gap:10px;padding:14px 16px;border:0;border-bottom:1px solid #edf0f4;background:#fff;color:#344258;text-align:left;cursor:pointer}
.record-item:hover,.record-item.active{background:#edf4ff}
.record-item span{display:grid;gap:5px}
.record-item span:last-child{text-align:right}
.record-item small{color:#8b98aa}
.record-pagination{display:flex;justify-content:center;padding:14px 8px;border-top:1px solid #edf0f4;background:#fff}
@media(max-width:1100px){.payment-record-list{position:static}}
</style>
