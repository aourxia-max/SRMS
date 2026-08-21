<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "../services/http";
import { useSessionStore } from "../stores/session";
import {
  tenantFormFromListItem,
  tenantUpdatePayload,
  type TenantFormModel,
  type TenantListItem,
  type TenantType,
} from "./tenant-form";

const session = useSessionStore();
const canManage = computed(() =>
  ["SUPER_ADMIN", "ADMIN"].includes(session.user?.role ?? ""),
);
const tenants = ref<TenantListItem[]>([]);
const total = ref(0);
const keyword = ref("");
const dialog = ref(false);
const editingId = ref<number | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const form = reactive<TenantFormModel>(tenantFormFromListItem());
const defaultTenantType = ref<TenantType>("INDIVIDUAL");

function errorMessage(error: unknown, fallback: string) {
  const message = (
    error as { response?: { data?: { message?: string | string[] } } }
  ).response?.data?.message;
  return Array.isArray(message) ? message.join("；") : message || fallback;
}

async function load() {
  const response = await http.get("/tenants", {
    params: { keyword: keyword.value || undefined },
  });
  tenants.value = response.data.data.items;
  total.value = response.data.data.total;
}

function open(tenant?: TenantListItem) {
  editingId.value = tenant?.id ?? null;
  Object.assign(form, tenantFormFromListItem(tenant, defaultTenantType.value));
  dialog.value = true;
}

async function save() {
  try {
    const data = tenantUpdatePayload(form);
    if (editingId.value) {
      await http.patch(`/tenants/${editingId.value}`, data);
    } else {
      await http.post("/tenants", data);
    }
    await load();
    dialog.value = false;
    ElMessage.success("承租人信息已保存");
  } catch (error) {
    ElMessage.error(errorMessage(error, "承租人信息保存失败，请检查填写内容"));
  }
}

async function removeTenant() {
  if (!editingId.value) return;
  try {
    await ElMessageBox.confirm(
      "删除后无法恢复。仅未关联合同且没有证件附件的承租人可以删除。",
      "确认删除承租人",
      {
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    await http.delete(`/tenants/${editingId.value}`);
    dialog.value = false;
    await load();
    ElMessage.success("承租人已删除");
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(errorMessage(error, "承租人删除失败，请稍后重试"));
  }
}

async function viewId(tenant: TenantListItem) {
  const result = await http.get(`/tenants/${tenant.id}/sensitive`);
  ElMessage.success(`完整证件号码：${result.data.data.idNo ?? "未登记"}`);
}

async function upload(tenant: TenantListItem, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const data = new FormData();
  data.append("file", file);
  await http.post(`/tenants/${tenant.id}/files`, data);
  ElMessage.success("证件附件已上传");
  (event.target as HTMLInputElement).value = "";
}

onMounted(async () => {
  const settings = await http.get("/system/defaults").catch(() => null);
  const configuredType = settings?.data?.data?.defaultTenantType;
  if (configuredType === "INDIVIDUAL" || configuredType === "COMPANY") {
    defaultTenantType.value = configuredType;
  }
  await load();
});
</script>

<template>
  <main class="users-page">
    <header>
      <div>
        <el-tag>Task005</el-tag>
        <h1>承租人管理</h1>
        <p>证件号码加密保存，列表始终只显示脱敏信息。</p>
      </div>
      <el-button v-if="canManage" type="primary" @click="open()"
        >新增承租人</el-button
      >
    </header>
    <el-card>
      <div class="filters">
        <el-input
          v-model="keyword"
          placeholder="姓名或联系电话"
          clearable
          @keyup.enter="load"
        />
        <el-button @click="load">查询</el-button>
      </div>
      <p>共 {{ total }} 名承租人</p>
      <el-table :data="tenants" stripe>
        <el-table-column prop="name" label="姓名/单位" />
        <el-table-column label="类型">
          <template #default="{ row }">{{
            row.tenantType === "COMPANY" ? "单位" : "个人"
          }}</template>
        </el-table-column>
        <el-table-column prop="phone" label="联系电话" />
        <el-table-column prop="idType" label="证件类型" />
        <el-table-column prop="maskedIdNo" label="证件号码（脱敏）" />
        <el-table-column label="状态">
          <template #default="{ row }">{{
            row.status === "ACTIVE" ? "启用" : "停用"
          }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230">
          <template #default="{ row }">
            <el-button v-if="canManage" size="small" @click="open(row)"
              >编辑</el-button
            >
            <el-button v-if="canManage" size="small" @click="viewId(row)"
              >查看证件</el-button
            >
            <el-button v-if="canManage" size="small" @click="fileInput?.click()"
              >上传附件</el-button
            >
            <input
              ref="fileInput"
              hidden
              type="file"
              accept="image/jpeg,image/png,image/heic,application/pdf"
              @change="upload(row, $event)"
            />
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialog"
      :title="editingId ? '编辑承租人' : '新增承租人'"
      width="620"
    >
      <el-form :model="form" label-position="top">
        <el-row :gutter="16">
          <el-col :span="12"
            ><el-form-item label="类型"
              ><el-select v-model="form.tenantType"
                ><el-option label="个人" value="INDIVIDUAL" /><el-option
                  label="单位"
                  value="COMPANY" /></el-select></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="姓名/单位名称"
              ><el-input v-model="form.name" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="联系电话"
              ><el-input v-model="form.phone" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="证件类型"
              ><el-input v-model="form.idType" /></el-form-item
          ></el-col>
          <el-col :span="24"
            ><el-form-item
              :label="editingId ? '证件号码（留空表示不修改）' : '证件号码'"
              ><el-input v-model="form.idNo" /></el-form-item
          ></el-col>
          <el-col :span="24"
            ><el-form-item label="联系地址"
              ><el-input v-model="form.contactAddress" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="状态"
              ><el-select v-model="form.status"
                ><el-option label="启用" value="ACTIVE" /><el-option
                  label="停用"
                  value="INACTIVE" /></el-select></el-form-item
          ></el-col>
          <el-col :span="24"
            ><el-form-item label="备注"
              ><el-input v-model="form.remark" type="textarea" /></el-form-item
          ></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button
            v-if="editingId"
            data-test="delete-tenant"
            type="danger"
            plain
            @click="removeTenant"
            >删除承租人</el-button
          >
          <span class="dialog-footer__spacer" />
          <el-button @click="dialog = false">取消</el-button>
          <el-button type="primary" @click="save">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </main>
</template>

<style scoped>
.filters,
.dialog-footer {
  display: flex;
  gap: 12px;
}
.filters {
  margin-bottom: 16px;
}
.dialog-footer {
  align-items: center;
}
.dialog-footer__spacer {
  flex: 1;
}
</style>
