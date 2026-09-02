// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElDialog, ElMessageBox, ElOption, ElSelect } from 'element-plus'
import { createPinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/property-affairs'
import { useSessionStore } from '../stores/session'
import type { PropertyAffairDetail } from '../types/property-affairs'
import PropertyAffairTimeline from '../components/property-affairs/PropertyAffairTimeline.vue'
import PropertyAffairDetailView from './PropertyAffairDetailView.vue'

vi.mock('../services/property-affairs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/property-affairs')>()
  return {
    ...actual,
    getPropertyAffair: vi.fn(),
    appendPropertyAffairProgress: vi.fn(),
    softDeletePropertyAffair: vi.fn(),
    uploadPropertyAffairFile: vi.fn(),
    previewPropertyAffairFile: vi.fn(),
    downloadPropertyAffairFile: vi.fn(),
    unlinkPropertyAffairFile: vi.fn(),
  }
})

const detail: PropertyAffairDetail = {
  id: 7,
  affairNo: 'WY202609020001',
  title: '走廊照明维修',
  category: null,
  priority: 'URGENT',
  status: 'COMPLETED',
  content: '更换损坏灯具',
  responsibleUserId: 2,
  responsibleSnapshot: '王管理员',
  externalHandlerName: '海口维修公司',
  externalPhone: '0898-12345678',
  externalContact: null,
  completedAt: '2026-09-02T03:00:00.000Z',
  cancelledAt: null,
  createdBy: 1,
  updatedBy: 2,
  deletedAt: null,
  deletedBy: null,
  version: 6,
  createdAt: '2026-09-02T01:00:00.000Z',
  updatedAt: '2026-09-02T03:00:00.000Z',
  buildings: [{ id: 1, snapshotLabel: '旧1栋', currentLabel: '1栋', currentStatus: 'ACTIVE', available: true }],
  rooms: [{ id: 11, snapshotLabel: '旧1栋101', currentLabel: '1栋101', currentStatus: 'RENTED', available: true }],
  tenants: [{ id: 21, snapshotLabel: '原承租人张三', currentLabel: '张三', currentStatus: null, available: false }],
  contracts: [{ id: 31, snapshotLabel: '旧合同号', currentLabel: 'HT202609020001', currentStatus: 'ACTIVE', available: true }],
  progresses: [
    { id: 1, affairId: 7, content: '事项已创建', statusBefore: null, statusAfter: 'PENDING', createdBy: 1, createdBySnapshot: '李管理员', createdAt: '2026-09-02T01:00:00.000Z' },
    { id: 2, affairId: 7, content: '维修完成', statusBefore: 'IN_PROGRESS', statusAfter: 'COMPLETED', createdBy: 2, createdBySnapshot: '王管理员', createdAt: '2026-09-02T03:00:00.000Z' },
  ],
  files: [
    { id: 9, originalName: '现场.jpg', mimeType: 'image/jpeg', extension: '.jpg', sizeBytes: '10', uploadedAt: '2026-09-02T03:00:00.000Z' },
    { id: 10, originalName: '方案.pdf', mimeType: 'application/pdf', extension: '.pdf', sizeBytes: '20', uploadedAt: '2026-09-02T03:00:00.000Z' },
    { id: 11, originalName: '..\\报价.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx', sizeBytes: '30', uploadedAt: '2026-09-02T03:00:00.000Z' },
  ],
}

function installMocks() {
  vi.mocked(api.getPropertyAffair).mockResolvedValue(detail)
  vi.mocked(api.appendPropertyAffairProgress).mockResolvedValue({ ...detail, status: 'IN_PROGRESS', version: 7 })
  vi.mocked(api.softDeletePropertyAffair).mockResolvedValue({ ...detail, deletedAt: '2026-09-02T04:00:00.000Z', version: 7 })
  vi.mocked(api.uploadPropertyAffairFile).mockResolvedValue({ id: 12, originalName: '补充.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: '40', uploadedAt: '2026-09-02T04:00:00.000Z' })
  vi.mocked(api.previewPropertyAffairFile).mockImplementation(async (_id, fileId) => new Blob([String(fileId)], { type: fileId === 10 ? 'application/pdf' : 'image/jpeg' }))
  vi.mocked(api.downloadPropertyAffairFile).mockResolvedValue(new Blob(['download'], { type: 'application/octet-stream' }))
  vi.mocked(api.unlinkPropertyAffairFile).mockResolvedValue({ id: 9 })
}

async function mountDetail() {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.accessToken = 'test-token'
  session.initialized = true
  session.user = { id: 2, username: 'admin', displayName: '王管理员', role: 'ADMIN' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/property-affairs/:id', name: 'property-affair-detail', component: PropertyAffairDetailView },
      { path: '/property-affairs/:id/edit', name: 'property-affair-edit', component: defineComponent({ template: '<div />' }) },
      { path: '/property-affairs', name: 'property-affairs', component: defineComponent({ template: '<div />' }) },
      { path: '/properties', name: 'properties', component: defineComponent({ template: '<div />' }) },
      { path: '/properties/:id', name: 'room-detail', component: defineComponent({ template: '<div />' }) },
      { path: '/contracts', name: 'contracts', component: defineComponent({ template: '<div />' }) },
      { path: '/tenants/:id', name: 'tenant-detail-placeholder', component: defineComponent({ template: '<div />' }) },
    ],
  })
  await router.push('/property-affairs/7')
  await router.isReady()
  const wrapper = mount(PropertyAffairDetailView, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('物业办事详情、进度与附件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    installMocks()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => `blob:${blob.type}`) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  it('时间线按最新在前显示中文状态变化且不提供编辑删除控件', () => {
    const source = [...detail.progresses]
    const wrapper = mount(PropertyAffairTimeline, { props: { progresses: source }, global: { plugins: [ElementPlus] } })

    const entries = wrapper.findAll('[data-test="timeline-entry"]')
    expect(entries[0].text()).toContain('维修完成')
    expect(entries[0].text()).toContain('王管理员')
    expect(entries[0].text()).toContain('办理中 → 已完成')
    expect(entries[1].text()).toContain('事项已创建')
    expect(source.map((item) => item.id)).toEqual([1, 2])
    expect(wrapper.text()).not.toContain('IN_PROGRESS')
    expect(wrapper.find('[data-test="edit-progress"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="delete-progress"]').exists()).toBe(false)
  })

  it('详情使用中文标签并呈现四类可读关联、快照、可用性和正确链接', async () => {
    const { wrapper } = await mountDetail()

    expect(wrapper.text()).toContain('紧急')
    expect(wrapper.text()).toContain('已完成')
    expect(wrapper.text()).not.toContain('URGENT')
    expect(wrapper.text()).not.toContain('COMPLETED')
    expect(wrapper.text()).toContain('关联时：原承租人张三')
    expect(wrapper.text()).toContain('不可用')
    expect(wrapper.get('[data-test="building-link-1"]').attributes('href')).toContain('/properties?buildingId=1')
    expect(wrapper.get('[data-test="room-link-11"]').attributes('href')).toBe('/properties/11')
    expect(wrapper.get('[data-test="tenant-link-21"]').attributes('href')).toBe('/tenants/21')
    expect(wrapper.get('[data-test="contract-link-31"]').attributes('href')).toContain('/contracts?tab=detail&contractId=31')
    expect(wrapper.find('[data-test="edit-affair"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="delete-affair"]').exists()).toBe(true)
  })

  it('创建人只取唯一初始进度快照，不受乱序及同一人员后来改名影响', async () => {
    vi.mocked(api.getPropertyAffair).mockResolvedValue({
      ...detail,
      progresses: [
        { id: 3, affairId: 7, content: '后续跟进', statusBefore: 'PENDING', statusAfter: 'IN_PROGRESS', createdBy: 1, createdBySnapshot: '李管理员（后来名称）', createdAt: '2026-09-02T02:00:00.000Z' },
        { id: 2, affairId: 7, content: '其他人处理', statusBefore: 'IN_PROGRESS', statusAfter: 'COMPLETED', createdBy: 2, createdBySnapshot: '王管理员', createdAt: '2026-09-02T03:00:00.000Z' },
        { id: 1, affairId: 7, content: '事项已创建', statusBefore: null, statusAfter: 'PENDING', createdBy: 1, createdBySnapshot: '李管理员（创建时）', createdAt: '2026-09-02T01:00:00.000Z' },
      ],
    })
    const { wrapper } = await mountDetail()

    const creator = wrapper.findAll('.info-grid > div').find((item) => item.find('dt').text() === '创建人')
    expect(creator?.find('dd').text()).toBe('李管理员（创建时）')
  })

  it('终态允许通过追加进度重新开启，发送精确当前版本并在成功后重载详情', async () => {
    const { wrapper } = await mountDetail()
    await wrapper.get('[data-test="open-progress-dialog"]').trigger('click')
    const status = wrapper.findAllComponents(ElSelect).find((item) => item.attributes('data-test') === 'progress-next-status')!
    expect(status.findAllComponents(ElOption).map((option) => option.props('value'))).toContain('IN_PROGRESS')
    await wrapper.get('[data-test="progress-content"]').setValue('现场复查后需要返工')
    status.vm.$emit('update:modelValue', 'IN_PROGRESS')
    await wrapper.get('[data-test="submit-progress"]').trigger('click')
    await flushPromises()

    expect(api.appendPropertyAffairProgress).toHaveBeenCalledWith(7, { version: 6, content: '现场复查后需要返工', nextStatus: 'IN_PROGRESS' })
    expect(api.getPropertyAffair).toHaveBeenCalledTimes(2)
  })

  it('进度内容必填且不能超过2000字符', async () => {
    const { wrapper } = await mountDetail()
    await wrapper.get('[data-test="open-progress-dialog"]').trigger('click')
    await wrapper.get('[data-test="submit-progress"]').trigger('click')
    expect(wrapper.text()).toContain('请输入办理进度')
    await wrapper.get('[data-test="progress-content"]').setValue('进'.repeat(2001))
    await wrapper.get('[data-test="submit-progress"]').trigger('click')
    expect(wrapper.text()).toContain('办理进度不能超过2000个字符')
    expect(api.appendPropertyAffairProgress).not.toHaveBeenCalled()
  })

  it('每次成功上传和解除附件后均重载详情，解除前要求中文确认', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper } = await mountDetail()
    const file = new File(['doc'], '补充.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const input = wrapper.get('[data-test="detail-file-input"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(api.uploadPropertyAffairFile).toHaveBeenCalledWith(7, file)
    expect(api.getPropertyAffair).toHaveBeenCalledTimes(2)

    await wrapper.get('[data-test="unlink-file-9"]').trigger('click')
    await flushPromises()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('解除附件“现场.jpg”'), '解除附件确认', expect.any(Object))
    expect(api.unlinkPropertyAffairFile).toHaveBeenCalledWith(7, 9)
    expect(api.getPropertyAffair).toHaveBeenCalledTimes(3)
  })

  it('图片和 PDF 使用预览接口并替换时回收旧 URL；下载使用安全文件名并立即回收 URL', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { wrapper } = await mountDetail()
    await wrapper.get('[data-test="preview-file-9"]').trigger('click')
    await flushPromises()
    expect(api.previewPropertyAffairFile).toHaveBeenCalledWith(7, 9)
    expect(wrapper.find('img[data-test="image-preview"]').exists()).toBe(true)

    await wrapper.get('[data-test="preview-file-10"]').trigger('click')
    await flushPromises()
    expect(api.previewPropertyAffairFile).toHaveBeenCalledWith(7, 10)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image/jpeg')
    expect(wrapper.find('[data-test="pdf-preview"]').exists()).toBe(true)

    await wrapper.get('[data-test="download-file-11"]').trigger('click')
    await flushPromises()
    expect(api.downloadPropertyAffairFile).toHaveBeenCalledWith(7, 11)
    expect(anchorClick).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:application/octet-stream')
    expect(document.querySelector('a[download="报价.xlsx"]')).toBeNull()

    wrapper.findAllComponents(ElDialog)[1].vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:application/pdf')
  })

  it('组件卸载时回收仍打开的预览 URL', async () => {
    const { wrapper } = await mountDetail()
    await wrapper.get('[data-test="preview-file-9"]').trigger('click')
    await flushPromises()
    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image/jpeg')
  })

  it('组件卸载后到达的预览响应不会再创建泄漏的 URL', async () => {
    let release!: (blob: Blob) => void
    vi.mocked(api.previewPropertyAffairFile).mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const { wrapper } = await mountDetail()
    await wrapper.get('[data-test="preview-file-9"]').trigger('click')
    wrapper.unmount()
    release(new Blob(['late'], { type: 'image/jpeg' }))
    await flushPromises()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('软删除要求中文确认并在成功后返回普通列表', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper, router } = await mountDetail()
    await wrapper.get('[data-test="delete-affair"]').trigger('click')
    await flushPromises()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('移入回收站'), '删除确认', expect.any(Object))
    expect(api.softDeletePropertyAffair).toHaveBeenCalledWith(7, 6)
    expect(router.currentRoute.value.name).toBe('property-affairs')
  })
})
