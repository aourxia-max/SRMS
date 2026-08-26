// @vitest-environment happy-dom

import ElementPlus, { ElMessage, ElMessageBox, ElSelect, ElUpload } from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as contractService from '../../../services/contracts'
import type {
  ContractListItem,
  ContractRole,
  ContractVoidImpact,
  ContractVoidRequest,
  ContractVoidRequestStatus,
} from '../../../types/contracts'
import ContractVoidPanel from './ContractVoidPanel.vue'

vi.mock('../../../services/contracts', () => ({
  approveContractVoidRequest: vi.fn(),
  cancelContractVoidRequest: vi.fn(),
  downloadContractVoidProof: vi.fn(),
  getContractVoidRequest: vi.fn(),
  listContractVoidRequests: vi.fn(),
  previewContractVoid: vi.fn(),
  rejectContractVoidRequest: vi.fn(),
  submitContractVoidRequest: vi.fn(),
  uploadContractVoidProof: vi.fn(),
}))

const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)

const contracts: ContractListItem[] = [
  {
    id: 86,
    contractNo: 'HT202608260086 | 8栋1203 | 陈晨',
    externalContractNo: '纸合-2026-086',
    roomId: 803,
    room: { id: 803, fullHouseNo: '8栋1203' },
    members: [{ memberRole: 'PRIMARY', tenant: { id: 305, name: '陈晨' } }],
    startDate: '2026-08-01',
    endDate: '2027-07-31',
    monthlyRent: '4680.00',
    depositRequired: '9360.00',
    status: 'ACTIVE',
    pricingMode: 'FIXED',
  },
  {
    id: 87,
    contractNo: 'HT202608260087 | 9栋501 | 李兰',
    roomId: 905,
    room: { id: 905, fullHouseNo: '9栋501' },
    members: [{ memberRole: 'PRIMARY', tenant: { id: 306, name: '李兰' } }],
    startDate: '2026-07-01',
    endDate: '2027-06-30',
    monthlyRent: '5200.00',
    status: 'VOIDED',
    pricingMode: 'FIXED',
  },
]

function impact(impactHash = hashA): ContractVoidImpact {
  return {
    contract: { id: 86, status: 'ACTIVE', roomId: 803 },
    summary: {
      rentBillPayable: '99999999999999999999.12',
      effectivePayment: '8800.10',
      depositBalance: '9360.00',
      prepaymentBalance: '123.45',
      refundNet: '80.05',
      currentNetImpact: '18203.50',
      plannedReversal: '-18203.50',
      postReversalNetImpact: '0.00',
    },
    rows: [{
      category: 'PAYMENT',
      originalEntityType: 'Payment',
      originalEntityId: 701,
      amount: '-8800.10',
      balanceBefore: '8800.10',
      balanceAfter: '0.00',
      originalOccurredAt: '2026-08-03T09:10:00.000Z',
      affectsNetImpact: true,
      metadata: {},
    }],
    pending: { adjustments: [31], refunds: [32], voidRequests: [], depositRefunds: [], changes: [33], rebates: [], checkouts: [] },
    completedCheckoutIds: [902],
    room: { currentStatus: 'RENTED', hasLaterContract: true, action: 'KEEP_CURRENT_STATUS' },
    flags: { hasPendingWorkflows: true, hasCompletedCheckout: true, hasLaterContract: true },
    sourceSnapshot: {
      prepaymentBalanceSource: null,
      depositBalanceSource: null,
      contractMembers: [],
      paymentAllocations: [],
      adjustments: [],
      rebates: [],
      checkoutSettlements: [],
      commissions: [],
    },
    impactHash,
  }
}

function request(status: ContractVoidRequestStatus = 'PENDING', overrides: Partial<ContractVoidRequest> = {}): ContractVoidRequest {
  const { impactHash, ...impactSnapshot } = impact()
  return {
    id: 901,
    requestNo: 'HTZF20260826000901',
    contractId: 86,
    status,
    reason: '纸质合同与系统合同主体不一致',
    impactSnapshot,
    impactHash,
    activeContractKey: status === 'PENDING' ? 'contract:86' : null,
    completedContractKey: status === 'COMPLETED' ? 'contract:86' : null,
    executionBatchNo: status === 'COMPLETED' ? 'HTZXP202608260901' : null,
    submissionIdempotencyKey: 'submit-contract-void-0901',
    executionIdempotencyKey: status === 'COMPLETED' ? 'execute-contract-void-0901' : null,
    resultSnapshot: null,
    submittedBy: 7,
    submittedAt: '2026-08-26T08:00:00.000Z',
    completedBy: status === 'COMPLETED' ? 1 : null,
    completedAt: status === 'COMPLETED' ? '2026-08-26T09:00:00.000Z' : null,
    rejectedBy: null,
    rejectedAt: null,
    rejectedReason: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: '2026-08-26T08:00:00.000Z',
    updatedAt: '2026-08-26T08:00:00.000Z',
    contract: {
      id: 86,
      contractNo: contracts[0].contractNo,
      roomId: 803,
      status: 'ACTIVE',
      room: { id: 803, fullHouseNo: '8栋1203' },
      members: [{ id: 401, tenantId: 305, memberRole: 'PRIMARY', isCurrent: true, tenant: { id: 305, name: '陈晨' } }],
    },
    files: [],
    reversals: [],
    ...overrides,
  }
}

function mountPanel(role: ContractRole = 'ADMIN', selectedContractId: number | null = 86, currentUserId = 7) {
  return mount(ContractVoidPanel, {
    props: { contracts, role, selectedContractId, currentUserId },
    global: { plugins: [ElementPlus] },
  })
}

async function setReason(wrapper: ReturnType<typeof mount>, value = '纸质合同主体录入错误') {
  await wrapper.get('[data-test="void-reason"]').setValue(value)
}

describe('合同作废纠错面板', () => {
  const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(contractService.listContractVoidRequests).mockResolvedValue([])
    vi.mocked(contractService.previewContractVoid).mockResolvedValue(impact())
    vi.mocked(contractService.getContractVoidRequest).mockResolvedValue(request())
    vi.mocked(contractService.submitContractVoidRequest).mockResolvedValue(request())
    vi.mocked(contractService.approveContractVoidRequest).mockResolvedValue({
      requestId: 901,
      requestNo: 'HTZF20260826000901',
      status: 'COMPLETED',
      contractId: 86,
      contractNo: contracts[0].contractNo,
      contractStatus: 'VOIDED',
      impactHash: hashA,
      executionBatchNo: 'HTZXP202608260901',
      reversalCount: 1,
      categoryTotals: { PAYMENT: '-8800.10' },
      roomAction: 'KEEP_CURRENT_STATUS',
      roomStatusBefore: 'RENTED',
      roomStatusAfter: 'RENTED',
    })
    vi.mocked(contractService.rejectContractVoidRequest).mockResolvedValue(request('REJECTED'))
    vi.mocked(contractService.cancelContractVoidRequest).mockResolvedValue(request('CANCELLED'))
    vi.mocked(contractService.downloadContractVoidProof).mockResolvedValue(new Blob(['history-proof'], { type: 'image/png' }))
    vi.mocked(contractService.uploadContractVoidProof).mockResolvedValue({
      id: 501,
      originalName: '作废证明.png',
      mimeType: 'image/png',
      sizeBytes: '11',
      uploadedAt: '2026-08-26T08:00:00.000Z',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
    else Reflect.deleteProperty(URL, 'createObjectURL')
    if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
    else Reflect.deleteProperty(URL, 'revokeObjectURL')
  })

  it('管理员核对影响后提交申请且金额字符串不会经过浮点数转换', async () => {
    const wrapper = mountPanel('ADMIN')
    await flushPromises()

    expect(wrapper.text()).toContain('¥99,999,999,999,999,999,999.12')
    expect(wrapper.text()).toContain('待处理账单调整 #31')
    expect(wrapper.text()).toContain('已完成退租 #902')
    expect(wrapper.text()).toContain('存在后续合同，保持当前房态')
    await setReason(wrapper)
    await wrapper.get('[data-test="submit-void-request"]').trigger('click')
    await flushPromises()

    expect(contractService.submitContractVoidRequest).toHaveBeenCalledWith({
      contractId: 86,
      reason: '纸质合同主体录入错误',
      impactHash: hashA,
      fileAssetIds: [],
      idempotencyKey: expect.stringMatching(/^contract-void-submit-/),
    })
    expect(contractService.approveContractVoidRequest).not.toHaveBeenCalled()
  })

  it('超级管理员可普通提交，也可用精确口令直接执行', async () => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '确认作废合同' } as never)
    const ordinary = mountPanel('SUPER_ADMIN')
    await flushPromises()
    await setReason(ordinary, '普通审批路径')
    await ordinary.get('[data-test="submit-void-request"]').trigger('click')
    await flushPromises()
    expect(contractService.submitContractVoidRequest).toHaveBeenCalledTimes(1)
    expect(contractService.approveContractVoidRequest).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(contractService.listContractVoidRequests).mockResolvedValue([])
    vi.mocked(contractService.previewContractVoid).mockResolvedValue(impact())
    vi.mocked(contractService.submitContractVoidRequest).mockResolvedValue(request())
    vi.mocked(contractService.getContractVoidRequest).mockResolvedValue(request('COMPLETED'))
    const direct = mountPanel('SUPER_ADMIN')
    await flushPromises()
    await setReason(direct, '确认直接冲销')
    await direct.get('[data-test="direct-execute-void"]').trigger('click')
    await flushPromises()

    expect(contractService.submitContractVoidRequest).toHaveBeenCalledTimes(1)
    expect(contractService.approveContractVoidRequest).toHaveBeenCalledWith(901, {
      previewHash: hashA,
      confirmation: '确认作废合同',
      idempotencyKey: expect.stringMatching(/^contract-void-execute-/),
    })
    const options = prompt.mock.calls.at(-1)![2]!
    const validator = options.inputValidator as (value: string) => boolean | string
    expect(validator('确认作废合同')).toBe(true)
    expect(validator(' 确认作废合同')).not.toBe(true)
    expect(validator('确认作废合同 ')).not.toBe(true)
    expect(validator('确认作废')).not.toBe(true)
  })

  it('超级管理员审批同样要求精确口令', async () => {
    vi.mocked(contractService.listContractVoidRequests).mockResolvedValue([request()])
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '确认作废合同' } as never)
    const wrapper = mountPanel('SUPER_ADMIN', null, 1)
    await flushPromises()
    await wrapper.get('[data-test="void-request-detail-901"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="approve-void-request"]').trigger('click')
    await flushPromises()

    expect(contractService.approveContractVoidRequest).toHaveBeenCalledWith(901, {
      previewHash: hashA,
      confirmation: '确认作废合同',
      idempotencyKey: expect.stringMatching(/^contract-void-execute-/),
    })
    const validator = prompt.mock.calls[0][2]!.inputValidator as (value: string) => boolean | string
    expect(validator('确认作废合同')).toBe(true)
    expect(validator('确认作废合同\n')).not.toBe(true)
  })

  it('超级管理员可驳回待确认申请', async () => {
    vi.mocked(contractService.listContractVoidRequests).mockResolvedValue([request()])
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '证明材料与合同不一致' } as never)
    const wrapper = mountPanel('SUPER_ADMIN', null, 1)
    await flushPromises()
    await wrapper.get('[data-test="void-request-detail-901"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="reject-void-request"]').trigger('click')
    await flushPromises()

    expect(contractService.rejectContractVoidRequest).toHaveBeenCalledWith(901, '证明材料与合同不一致')
  })

  it('管理员只能取消本人提交的待确认申请', async () => {
    vi.mocked(contractService.listContractVoidRequests).mockResolvedValue([request()])
    const own = mountPanel('ADMIN', null, 7)
    await flushPromises()
    await own.get('[data-test="void-request-detail-901"]').trigger('click')
    await flushPromises()
    await own.get('[data-test="cancel-void-request"]').trigger('click')
    await flushPromises()
    expect(contractService.cancelContractVoidRequest).toHaveBeenCalledWith(901)

    const others = mountPanel('ADMIN', null, 99)
    await flushPromises()
    await others.get('[data-test="void-request-detail-901"]').trigger('click')
    await flushPromises()
    expect(others.find('[data-test="cancel-void-request"]').exists()).toBe(false)
  })

  it('stale 响应只重新预览并替换 impactHash，不自动再次提交', async () => {
    vi.mocked(contractService.previewContractVoid).mockReset().mockResolvedValueOnce(impact(hashA)).mockResolvedValueOnce(impact(hashB))
    vi.mocked(contractService.submitContractVoidRequest).mockRejectedValue({
      response: { data: { code: 400, message: '合同关联数据已变化，请重新预览', data: null } },
    })
    const warning = vi.spyOn(ElMessage, 'warning')
    const wrapper = mountPanel('ADMIN')
    await flushPromises()
    await setReason(wrapper)
    await wrapper.get('[data-test="submit-void-request"]').trigger('click')
    await flushPromises()

    expect(contractService.submitContractVoidRequest).toHaveBeenCalledTimes(1)
    expect(contractService.previewContractVoid).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-test="void-impact-cards"]').attributes('data-impact-hash')).toBe(hashB)
    expect(warning).toHaveBeenCalledWith('合同关联数据已变化，已为你重新计算，请再次核对')
  })

  it('上传成功后才建立附件预览并将后端资产编号关联到申请', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:void-proof-501')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const wrapper = mountPanel('ADMIN')
    await flushPromises()
    const file = new File(['proof-image'], '作废证明.png', { type: 'image/png' })
    const upload = wrapper.findComponent(ElUpload)

    await (upload.props('onChange') as (value: { raw: File }) => Promise<void>)({ raw: file })
    await flushPromises()

    expect(contractService.uploadContractVoidProof).toHaveBeenCalledWith(file)
    expect(createObjectURL).toHaveBeenCalledWith(file)
    await wrapper.get('[data-test="preview-void-proof-501"]').trigger('click')
    expect(wrapper.get('[data-test="void-proof-preview"]').attributes('src')).toBe('blob:void-proof-501')
    await setReason(wrapper)
    await wrapper.get('[data-test="submit-void-request"]').trigger('click')
    await flushPromises()
    expect(contractService.submitContractVoidRequest).toHaveBeenCalledWith(expect.objectContaining({ fileAssetIds: [501] }))
    wrapper.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:void-proof-501')
  })

  it('终态申请只读并展示冲销来源、金额和原纠错日期', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:void-history-proof-501')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const completed = request('COMPLETED', {
      reversals: [{
        id: 9901,
        contractVoidRequestId: 901,
        category: 'PAYMENT',
        originalEntityType: 'Payment',
        originalEntityId: 701,
        amount: '-8800.10',
        balanceBefore: '8800.10',
        balanceAfter: '0.00',
        generatedEntityType: 'PaymentReversal',
        generatedEntityId: 9701,
        originalOccurredAt: '2026-08-03T09:10:00.000Z',
        correctionOccurredAt: '2026-08-26T09:00:00.000Z',
        idempotencyKey: 'contract-void:901:PAYMENT:701',
        metadata: null,
      }],
      files: [{ contractVoidRequestId: 901, fileAssetId: 501, createdAt: '2026-08-26T08:00:00.000Z', fileAsset: { id: 501, originalName: '作废证明.png', mimeType: 'image/png', uploadedAt: '2026-08-26T08:00:00.000Z' } }],
    })
    vi.mocked(contractService.listContractVoidRequests).mockResolvedValue([completed])
    vi.mocked(contractService.getContractVoidRequest).mockResolvedValue(completed)
    const wrapper = mountPanel('SUPER_ADMIN', null, 1)
    await flushPromises()
    await wrapper.get('[data-test="void-request-detail-901"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('终态申请仅可查看')
    expect(wrapper.text()).toContain('收款')
    expect(wrapper.text()).toContain('来源：收款')
    expect(wrapper.text()).toContain('金额：-¥8,800.10')
    expect(wrapper.text()).toContain('原业务日期：2026-08-03')
    expect(wrapper.text()).toContain('纠错日期：2026-08-26')
    expect(wrapper.text()).toContain('作废证明.png')
    await wrapper.get('[data-test="preview-void-request-file-501"]').trigger('click')
    await flushPromises()
    expect(contractService.downloadContractVoidProof).toHaveBeenCalledWith(901, 501)
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(wrapper.get('[data-test="void-proof-preview"]').attributes('src')).toBe('blob:void-history-proof-501')
    expect(wrapper.find('[data-test="approve-void-request"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="reject-void-request"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="cancel-void-request"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="submit-void-request"]').exists()).toBe(false)
  })

  it('保存期间禁用相关动作并阻止重复提交，失败后恢复', async () => {
    let rejectSubmit!: (reason: unknown) => void
    vi.mocked(contractService.submitContractVoidRequest).mockImplementation(() => new Promise((_resolve, reject) => { rejectSubmit = reject }))
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = mountPanel('ADMIN')
    await flushPromises()
    await setReason(wrapper)
    const submit = wrapper.get('[data-test="submit-void-request"]')

    await submit.trigger('click')
    await submit.trigger('click')
    expect(contractService.submitContractVoidRequest).toHaveBeenCalledTimes(1)
    expect(submit.attributes()).toHaveProperty('disabled')

    rejectSubmit({ response: { data: { code: 409, message: '该合同已有待确认的作废申请' } } })
    await flushPromises()
    expect(error).toHaveBeenCalledWith('该合同已有待确认的作废申请')
    expect(wrapper.get('[data-test="submit-void-request"]').attributes()).not.toHaveProperty('disabled')
  })

  it('按合同编号、楼栋房号、租户姓名和中文状态筛选申请', async () => {
    const wrapper = mountPanel('ADMIN', null)
    await flushPromises()
    await wrapper.get('[data-test="void-contract-no-filter"]').setValue('HT20260826')
    await wrapper.get('[data-test="void-room-filter"]').setValue('8栋1203')
    await wrapper.get('[data-test="void-tenant-filter"]').setValue('陈晨')
    const status = wrapper.findAllComponents(ElSelect).find((item) => item.attributes('data-test') === 'void-status-filter')!
    await status.vm.$emit('update:modelValue', 'REJECTED')
    await wrapper.get('[data-test="search-void-requests"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('待确认')
    expect(wrapper.text()).toContain('已完成')
    expect(wrapper.text()).toContain('已驳回')
    expect(wrapper.text()).toContain('已取消')
    expect(contractService.listContractVoidRequests).toHaveBeenLastCalledWith({
      contractNo: 'HT20260826',
      roomKeyword: '8栋1203',
      tenantKeyword: '陈晨',
      status: 'REJECTED',
    })
  })

  it('无申请时显示中文空状态且未选合同不能提交', async () => {
    const wrapper = mountPanel('ADMIN', null)
    await flushPromises()

    expect(wrapper.text()).toContain('暂无合同作废纠错申请')
    expect(wrapper.text()).toContain('请选择需要作废纠错的合同')
    expect(wrapper.text()).not.toContain('No Data')
    expect(wrapper.find('[data-test="submit-void-request"]').exists()).toBe(false)
  })
})
