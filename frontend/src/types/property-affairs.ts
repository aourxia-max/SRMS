export type PropertyAffairStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
export type PropertyAffairPriority = 'NORMAL' | 'IMPORTANT' | 'URGENT'
export type PropertyAffairRelationType = 'building' | 'room' | 'tenant' | 'contract'

export type PropertyAffairBuildingStatus = 'ACTIVE' | 'DISABLED'
export type PropertyAffairRoomStatus = 'EMPTY' | 'PENDING_MOVE_IN' | 'RENTED' | 'PENDING_CHECKOUT' | 'MAINTENANCE' | 'FOR_SALE' | 'SOLD' | 'DISABLED' | 'OTHER'
export type PropertyAffairTenantStatus = 'ACTIVE' | 'INACTIVE'
export type PropertyAffairContractStatus = 'DRAFT' | 'PENDING_START' | 'ACTIVE' | 'PENDING_CHECKOUT' | 'ENDED' | 'VOIDED'

export type PropertyAffairRelation<TStatus extends string = string> = {
  id: number
  snapshotLabel: string
  currentLabel: string
  currentStatus: TStatus | null
  exists?: boolean
  available: boolean
}

export type PropertyAffairBuildingRelation = PropertyAffairRelation<PropertyAffairBuildingStatus>
export type PropertyAffairRoomRelation = PropertyAffairRelation<PropertyAffairRoomStatus>
export type PropertyAffairTenantRelation = PropertyAffairRelation<PropertyAffairTenantStatus>
export type PropertyAffairContractRelation = PropertyAffairRelation<PropertyAffairContractStatus>

export type PropertyAffairProgress = {
  id: number
  affairId: number
  content: string
  statusBefore: PropertyAffairStatus | null
  statusAfter: PropertyAffairStatus | null
  createdBy: number
  createdBySnapshot: string
  createdAt: string
}

export type PropertyAffairFile = {
  id: number
  originalName: string
  mimeType: string
  extension: string
  sizeBytes: string
  uploadedAt: string
}

export type PropertyAffairUploadFile = {
  id: number
  originalName: string
  mimeType: string
  sizeBytes: string
  uploadedAt: string
}

export type PropertyAffairSummary = {
  id: number
  affairNo: string
  title: string
  category: string | null
  priority: PropertyAffairPriority
  status: PropertyAffairStatus
  content: string
  responsibleUserId: number | null
  responsibleSnapshot: string | null
  externalHandlerName: string | null
  externalPhone: string | null
  externalContact: string | null
  completedAt: string | null
  cancelledAt: string | null
  createdBy: number
  updatedBy: number
  deletedAt: string | null
  deletedBy: number | null
  version: number
  createdAt: string
  updatedAt: string
  buildings: PropertyAffairBuildingRelation[]
  rooms: PropertyAffairRoomRelation[]
  tenants: PropertyAffairTenantRelation[]
  contracts: PropertyAffairContractRelation[]
}

export type PropertyAffairDetail = PropertyAffairSummary & {
  progresses: PropertyAffairProgress[]
  files: PropertyAffairFile[]
}

export type PropertyAffairRelationsPayload = {
  buildingIds: number[]
  roomIds: number[]
  tenantIds: number[]
  contractIds: number[]
}

export type PropertyAffairFormModel = PropertyAffairRelationsPayload & {
  title: string
  category: string
  priority: PropertyAffairPriority
  content: string
  responsibleUserId: number | null
  externalHandlerName: string
  externalPhone: string
  externalContact: string
}

export type PropertyAffairCreatePayload = PropertyAffairRelationsPayload & {
  title: string
  category?: string
  priority?: PropertyAffairPriority
  content: string
  responsibleUserId?: number
  externalHandlerName?: string
  externalPhone?: string
  externalContact?: string
}

export type PropertyAffairUpdatePayload = Partial<PropertyAffairRelationsPayload> & {
  version: number
  title?: string
  category?: string | null
  priority?: PropertyAffairPriority
  content?: string
  responsibleUserId?: number | null
  externalHandlerName?: string | null
  externalPhone?: string | null
  externalContact?: string | null
  status?: PropertyAffairStatus
}

export type PropertyAffairProgressPayload = {
  version: number
  content: string
  nextStatus?: PropertyAffairStatus
}

export type PropertyAffairListQuery = {
  keyword?: string
  category?: string
  status?: PropertyAffairStatus
  priority?: PropertyAffairPriority
  responsibleUserId?: number
  buildingId?: number
  roomId?: number
  tenantId?: number
  contractId?: number
  page?: number
  pageSize?: number
}

export type PropertyAffairPaginatedResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type PropertyAffairResponsibleUserOption = {
  id: number
  displayName: string
  role: 'SUPER_ADMIN' | 'ADMIN'
}
