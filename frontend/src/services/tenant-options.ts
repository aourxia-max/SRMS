import { http } from './http'

export type TenantOption = {
  id: number
  name: string
  phone?: string | null
}

type TenantPage = {
  items: TenantOption[]
  total: number
  page: number
  pageSize: number
}

const TENANT_OPTION_PAGE_SIZE = 100

export async function listAllTenantOptions(): Promise<TenantOption[]> {
  const options: TenantOption[] = []
  const seen = new Set<number>()
  let page = 1

  while (true) {
    const response = await http.get<{ data: TenantPage }>('/tenants', {
      params: { page, pageSize: TENANT_OPTION_PAGE_SIZE },
    })
    const data = response.data.data
    const pageItems = Array.isArray(data.items) ? data.items : []
    if (pageItems.length === 0) break

    let added = 0
    for (const item of pageItems) {
      if (!Number.isSafeInteger(item.id) || item.id <= 0 || seen.has(item.id)) continue
      seen.add(item.id)
      options.push(item)
      added += 1
    }

    const total = Number(data.total)
    if (Number.isFinite(total) && total >= 0 && page * TENANT_OPTION_PAGE_SIZE >= total) break
    if ((!Number.isFinite(total) || total < 0) && pageItems.length < TENANT_OPTION_PAGE_SIZE) break
    if (added === 0) break
    page += 1
  }

  return options
}
