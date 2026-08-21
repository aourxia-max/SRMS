export type TenantType = "INDIVIDUAL" | "COMPANY";
export type TenantStatus = "ACTIVE" | "INACTIVE";

export type TenantFormModel = {
  tenantType: TenantType;
  name: string;
  phone: string;
  idType: string;
  idNo: string;
  contactAddress: string;
  status: TenantStatus;
  remark: string;
};

export type TenantListItem = {
  id: number;
  tenantType: TenantType;
  name: string;
  phone: string | null;
  idType: string | null;
  contactAddress: string | null;
  status: TenantStatus;
  remark: string | null;
  maskedIdNo?: string | null;
  idNoLast4?: string | null;
};

export function tenantFormFromListItem(
  tenant?: TenantListItem,
  defaultTenantType: TenantType = "INDIVIDUAL",
): TenantFormModel {
  return {
    tenantType: tenant?.tenantType ?? defaultTenantType,
    name: tenant?.name ?? "",
    phone: tenant?.phone ?? "",
    idType: tenant?.idType ?? "ID_CARD",
    idNo: "",
    contactAddress: tenant?.contactAddress ?? "",
    status: tenant?.status ?? "ACTIVE",
    remark: tenant?.remark ?? "",
  };
}

export function tenantUpdatePayload(form: TenantFormModel) {
  const idNo = form.idNo.trim();
  return {
    tenantType: form.tenantType,
    name: form.name,
    phone: form.phone || null,
    idType: form.idType || null,
    ...(idNo ? { idNo } : {}),
    contactAddress: form.contactAddress || null,
    status: form.status,
    remark: form.remark || null,
  };
}
