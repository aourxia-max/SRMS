// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElOption, ElSelect } from 'element-plus'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { listContracts } from '../services/contracts'
import * as api from '../services/property-affairs'
import type { PropertyAffairDetail, PropertyAffairFormModel } from '../types/property-affairs'
import PropertyAffairForm, { mergePropertyAffairCategories } from '../components/property-affairs/PropertyAffairForm.vue'
import PropertyAffairRelationPicker from '../components/property-affairs/PropertyAffairRelationPicker.vue'
import PropertyAffairFormView from './PropertyAffairFormView.vue'

vi.mock('../services/http', () => ({ http: { get: vi.fn() } }))
vi.mock('../services/contracts', () => ({
  listContracts: vi.fn().mockResolvedValue([
    { id: 31, contractNo: 'HT202609020001', room: { fullHouseNo: '1栋101' }, members: [{ memberRole: 'PRIMARY', tenant: { name: '张三' } }] },
  ]),
}))
vi.mock('../services/property-affairs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/property-affairs')>()
  return {
    ...actual,
    listPropertyAffairCategories: vi.fn(),
    listPropertyAffairResponsibleUsers: vi.fn(),
    getPropertyAffair: vi.fn(),
    createPropertyAffair: vi.fn(),
    updatePropertyAffair: vi.fn(),
    uploadPropertyAffairFile: vi.fn(),
  }
})

const detail: PropertyAffairDetail = {
  id: 7,
  affairNo: 'WY202609020001',
  title: '走廊照明维修',
  category: '公共维修',
  priority: 'URGENT',
  status: 'COMPLETED',
  content: '更换损坏灯具',
  responsibleUserId: 2,
  responsibleSnapshot: '王管理员',
  externalHandlerName: '海口维修公司',
  externalPhone: '0898-12345678',
  externalContact: '微信同号',
  completedAt: '2026-09-02T02:00:00.000Z',
  cancelledAt: null,
  createdBy: 1,
  updatedBy: 2,
  deletedAt: null,
  deletedBy: null,
  version: 6,
  createdAt: '2026-09-02T01:00:00.000Z',
  updatedAt: '2026-09-02T02:00:00.000Z',
  buildings: [{ id: 1, snapshotLabel: '旧1栋', currentLabel: '1栋', currentStatus: 'ACTIVE', available: true }],
  rooms: [{ id: 11, snapshotLabel: '旧1栋101', currentLabel: '1栋101', currentStatus: 'RENTED', available: true }],
  tenants: [{ id: 21, snapshotLabel: '张三', currentLabel: '张三', currentStatus: 'ACTIVE', available: true }],
  contracts: [{ id: 31, snapshotLabel: '旧合同', currentLabel: 'HT202609020001', currentStatus: 'ACTIVE', available: true }],
  progresses: [],
  files: [],
}

const validModel: PropertyAffairFormModel = {
  title: '走廊照明维修',
  category: '公共维修',
  priority: 'URGENT',
  content: '更换损坏灯具',
  responsibleUserId: 2,
  externalHandlerName: '海口维修公司',
  externalPhone: '0898-12345678',
  externalContact: '微信同号',
  buildingIds: [1],
  roomIds: [11],
  tenantIds: [21],
  contractIds: [31],
}

function selectByTest(wrapper: VueWrapper, testId: string) {
  const select = wrapper.findAllComponents(ElSelect).find((item) => item.attributes('data-test') === testId)
  if (!select) throw new Error(`未找到选择器：${testId}`)
  return select
}

function installMocks() {
  vi.mocked(api.listPropertyAffairCategories).mockResolvedValue(['公共维修', '历史分类', '公共维修'])
  vi.mocked(api.listPropertyAffairResponsibleUsers).mockResolvedValue([
    { id: 1, displayName: '超级管理员', role: 'SUPER_ADMIN' },
    { id: 2, displayName: '王管理员', role: 'ADMIN' },
  ])
  vi.mocked(api.getPropertyAffair).mockResolvedValue(detail)
  vi.mocked(api.createPropertyAffair).mockResolvedValue(detail)
  vi.mocked(api.updatePropertyAffair).mockResolvedValue({ ...detail, version: 7 })
  vi.mocked(api.uploadPropertyAffairFile).mockResolvedValue({ id: 9, originalName: '现场.jpg', mimeType: 'image/jpeg', sizeBytes: '10', uploadedAt: '2026-09-02T03:00:00.000Z' })
  vi.mocked(listContracts).mockResolvedValue([
    { id: 31, contractNo: 'HT202609020001', room: { fullHouseNo: '1栋101' }, members: [{ memberRole: 'PRIMARY', tenant: { name: '张三' } }] },
  ] as never)
  vi.mocked(http.get).mockImplementation(async (url: string) => {
    if (url === '/properties/buildings') return { data: { data: [{ id: 1, buildingNo: '1栋' }, { id: 2, buildingNo: '2栋' }] } }
    if (url === '/properties/rooms') return { data: { data: [{ id: 11, fullHouseNo: '1栋101' }, { id: 12, fullHouseNo: '2栋201' }] } }
    if (url === '/tenants') return { data: { data: { items: [{ id: 21, name: '张三', phone: '13800000000' }, { id: 22, name: '李四', phone: '' }] } } }
    throw new Error(`unexpected endpoint ${url}`)
  })
}

async function mountView(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/property-affairs/new', name: 'property-affair-create', component: PropertyAffairFormView },
      { path: '/property-affairs/:id/edit', name: 'property-affair-edit', component: PropertyAffairFormView },
      { path: '/property-affairs/:id', name: 'property-affair-detail', component: defineComponent({ template: '<div />' }) },
      { path: '/property-affairs', name: 'property-affairs', component: defineComponent({ template: '<div />' }) },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(PropertyAffairFormView, { global: { plugins: [createPinia(), router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('物业办事表单与关联选择器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installMocks()
  })

  it('合并内置和历史分类并去重，同时保留自由输入能力', async () => {
    expect(mergePropertyAffairCategories(['公共维修', '历史分类', '公共维修'])).toEqual([
      '公共维修', '住户沟通', '证件办理', '现场处理', '外部协调', '历史分类',
    ])
    const wrapper = mount(PropertyAffairForm, {
      props: { mode: 'create', categories: ['历史分类'], responsibleUsers: [], saving: false },
      global: { plugins: [ElementPlus], stubs: { PropertyAffairRelationPicker: true } },
    })
    const category = selectByTest(wrapper, 'affair-category')
    expect(category.props('allowCreate')).toBe(true)
    expect(wrapper.findAllComponents(ElOption).map((option) => option.props('label'))).toContain('历史分类')
  })

  it('四类关联可同时选择，发出完整、去重的数字 ID 数组', async () => {
    const wrapper = mount(PropertyAffairRelationPicker, {
      props: { modelValue: { buildingIds: [1], roomIds: [], tenantIds: [], contractIds: [] }, initialRelations: detail },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    selectByTest(wrapper, 'relation-buildings').vm.$emit('update:modelValue', [1, 2, 2])
    selectByTest(wrapper, 'relation-rooms').vm.$emit('update:modelValue', [11, 12])
    selectByTest(wrapper, 'relation-tenants').vm.$emit('update:modelValue', [21, 22])
    selectByTest(wrapper, 'relation-contracts').vm.$emit('update:modelValue', [31])
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({
      buildingIds: [1, 2], roomIds: [11, 12], tenantIds: [21, 22], contractIds: [31],
    })
    expect(wrapper.text()).toContain('1栋101')
    expect(wrapper.text()).toContain('张三')
    expect(wrapper.text()).toContain('HT202609020001')
  })

  it('网络选项未返回时先展示四类历史快照，不以原始 ID 作为标签', () => {
    vi.mocked(http.get).mockImplementation(() => new Promise(() => undefined))
    vi.mocked(listContracts).mockImplementation(() => new Promise(() => undefined))

    const wrapper = mount(PropertyAffairRelationPicker, {
      props: { modelValue: { buildingIds: [1], roomIds: [11], tenantIds: [21], contractIds: [31] }, initialRelations: detail },
      global: { plugins: [ElementPlus] },
    })

    const summary = wrapper.get('[data-test="relation-selection-summary"]').text()
    expect(summary).toContain('1栋')
    expect(summary).toContain('1栋101')
    expect(summary).toContain('张三')
    expect(summary).toContain('HT202609020001')
    expect(summary).not.toMatch(/楼栋：1(?:、|$)/)
    wrapper.unmount()
  })

  it('单个关联端点失败时保留该类历史标签并合并其他端点的成功选项', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    vi.mocked(http.get).mockImplementation(async (url: string) => {
      if (url === '/properties/buildings') return { data: { data: [{ id: 2, buildingNo: '2栋' }] } }
      if (url === '/properties/rooms') throw new Error('房源端点失败')
      if (url === '/tenants') return { data: { data: { items: [{ id: 22, name: '李四' }], total: 1, page: 1, pageSize: 100 } } }
      throw new Error(`unexpected endpoint ${url}`)
    })
    const wrapper = mount(PropertyAffairRelationPicker, {
      props: { modelValue: { buildingIds: [1], roomIds: [11], tenantIds: [21], contractIds: [31] }, initialRelations: detail },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(selectByTest(wrapper, 'relation-buildings').findAllComponents(ElOption).map((item) => item.props('label'))).toEqual(expect.arrayContaining(['1栋', '2栋']))
    expect(selectByTest(wrapper, 'relation-rooms').findAllComponents(ElOption).map((item) => item.props('label'))).toContain('1栋101')
    expect(selectByTest(wrapper, 'relation-tenants').findAllComponents(ElOption).map((item) => item.props('label'))).toEqual(expect.arrayContaining(['张三', '李四']))
    expect(selectByTest(wrapper, 'relation-contracts').findAllComponents(ElOption).map((item) => item.props('label'))).toContain('HT202609020001｜1栋101｜张三')
    expect(warning).toHaveBeenCalledWith('部分关联对象加载失败，已保留当前关联信息')

    selectByTest(wrapper, 'relation-rooms').vm.$emit('update:modelValue', [11, 999])
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({ buildingIds: [1], roomIds: [11, 999], tenantIds: [21], contractIds: [31] })
    expect(wrapper.get('[data-test="relation-selection-summary"]').text()).toContain('名称暂不可用')
    expect(wrapper.get('[data-test="relation-selection-summary"]').text()).not.toContain('999')
  })

  it('多个关联端点失败时仍保留全部历史 ID 和可读快照，不清空成功的房源选项', async () => {
    vi.mocked(http.get).mockImplementation(async (url: string) => {
      if (url === '/properties/buildings' || url === '/tenants') throw new Error(`${url} 失败`)
      if (url === '/properties/rooms') return { data: { data: [{ id: 12, fullHouseNo: '2栋201' }] } }
      throw new Error(`unexpected endpoint ${url}`)
    })
    vi.mocked(listContracts).mockRejectedValue(new Error('合同端点失败'))
    const wrapper = mount(PropertyAffairRelationPicker, {
      props: { modelValue: { buildingIds: [1], roomIds: [11], tenantIds: [21], contractIds: [31] }, initialRelations: detail },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const summary = wrapper.get('[data-test="relation-selection-summary"]').text()
    expect(summary).toContain('1栋')
    expect(summary).toContain('1栋101')
    expect(summary).toContain('张三')
    expect(summary).toContain('HT202609020001')
    expect(selectByTest(wrapper, 'relation-rooms').findAllComponents(ElOption).map((item) => item.props('label'))).toEqual(expect.arrayContaining(['1栋101', '2栋201']))

    selectByTest(wrapper, 'relation-buildings').vm.$emit('update:modelValue', [1])
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({ buildingIds: [1], roomIds: [11], tenantIds: [21], contractIds: [31] })
  })

  it('关联选择器中的承租人选项跨页加载到 total，而非只取前 100 条', async () => {
    vi.mocked(http.get).mockImplementation(async (url: string, config) => {
      if (url === '/properties/buildings' || url === '/properties/rooms') return { data: { data: [] } }
      if (url === '/tenants' && config?.params?.page === 1) {
        return { data: { data: { items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `承租人${index + 1}` })), total: 101, page: 1, pageSize: 100 } } }
      }
      if (url === '/tenants' && config?.params?.page === 2) {
        return { data: { data: { items: [{ id: 101, name: '第101位承租人' }], total: 101, page: 2, pageSize: 100 } } }
      }
      throw new Error(`unexpected endpoint ${url}`)
    })
    const wrapper = mount(PropertyAffairRelationPicker, {
      props: { modelValue: { buildingIds: [], roomIds: [], tenantIds: [], contractIds: [] } },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/tenants', { params: { page: 2, pageSize: 100 } })
    expect(selectByTest(wrapper, 'relation-tenants').findAllComponents(ElOption).map((item) => item.props('label'))).toContain('第101位承租人')
  })

  it('编辑时完整回填编号、字段、关联和版本，并只允许终态重新开启', async () => {
    const wrapper = mount(PropertyAffairForm, {
      props: { mode: 'edit', initial: detail, categories: ['公共维修'], responsibleUsers: [{ id: 2, displayName: '王管理员', role: 'ADMIN' }], saving: false },
      global: { plugins: [ElementPlus], stubs: { PropertyAffairRelationPicker: true } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('WY202609020001')
    expect((wrapper.get('[data-test="affair-title"]').element as HTMLInputElement).value).toBe('走廊照明维修')
    expect((wrapper.get('[data-test="affair-content"]').element as HTMLTextAreaElement).value).toBe('更换损坏灯具')
    const status = selectByTest(wrapper, 'affair-status')
    expect(status.findAllComponents(ElOption).map((option) => option.props('value'))).toEqual(['COMPLETED', 'IN_PROGRESS'])
    status.vm.$emit('update:modelValue', 'IN_PROGRESS')
    await flushPromises()
    expect(selectByTest(wrapper, 'affair-status').findAllComponents(ElOption).map((option) => option.props('value'))).toEqual(['COMPLETED', 'IN_PROGRESS'])
    status.vm.$emit('update:modelValue', 'COMPLETED')
    await wrapper.get('[data-test="submit-affair-form"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('submit')).toHaveLength(1)
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({ model: validModel, status: 'COMPLETED', version: 6 })
  })

  it('以中文拦截必填项和所有后端长度上限', async () => {
    const wrapper = mount(PropertyAffairForm, {
      props: { mode: 'create', categories: [], responsibleUsers: [], saving: false },
      global: { plugins: [ElementPlus], stubs: { PropertyAffairRelationPicker: true } },
    })
    await wrapper.get('[data-test="submit-affair-form"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('请输入事项标题')
    expect(wrapper.text()).toContain('请输入事项内容')

    await wrapper.get('[data-test="affair-title"]').setValue('题'.repeat(201))
    selectByTest(wrapper, 'affair-category').vm.$emit('update:modelValue', '类'.repeat(81))
    await wrapper.get('[data-test="affair-content"]').setValue('内'.repeat(5001))
    await wrapper.get('[data-test="external-handler"]').setValue('人'.repeat(101))
    await wrapper.get('[data-test="external-phone"]').setValue('电'.repeat(51))
    await wrapper.get('[data-test="external-contact"]').setValue('联'.repeat(201))
    await wrapper.get('[data-test="submit-affair-form"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('标题不能超过200个字符')
    expect(wrapper.text()).toContain('分类不能超过80个字符')
    expect(wrapper.text()).toContain('内容不能超过5000个字符')
    expect(wrapper.text()).toContain('外部办理人不能超过100个字符')
    expect(wrapper.text()).toContain('联系电话不能超过50个字符')
    expect(wrapper.text()).toContain('其他联系方式不能超过200个字符')
  })

  it('编辑提交发送完整关联、清空字段的 null 和加载时版本，409 后保留输入且不跳转', async () => {
    vi.mocked(api.updatePropertyAffair).mockRejectedValue({ response: { status: 409, data: { message: '内容已被其他管理员更新，请刷新后重试' } } })
    const error = vi.spyOn(ElMessage, 'error')
    const { wrapper, router } = await mountView('/property-affairs/7/edit')
    const form = wrapper.findComponent(PropertyAffairForm)
    await form.get('[data-test="affair-title"]').setValue('现场输入不能丢')
    selectByTest(form, 'affair-category').vm.$emit('update:modelValue', '')
    selectByTest(form, 'responsible-user').vm.$emit('update:modelValue', null)
    await form.get('[data-test="external-handler"]').setValue('')
    await form.get('[data-test="external-phone"]').setValue('')
    await form.get('[data-test="external-contact"]').setValue('')
    selectByTest(form, 'affair-status').vm.$emit('update:modelValue', 'IN_PROGRESS')
    await form.get('[data-test="submit-affair-form"]').trigger('click')
    await flushPromises()

    expect(api.updatePropertyAffair).toHaveBeenCalledWith(7, {
      title: '现场输入不能丢', category: null, priority: 'URGENT', content: '更换损坏灯具', responsibleUserId: null,
      externalHandlerName: null, externalPhone: null, externalContact: null, status: 'IN_PROGRESS', version: 6,
      buildingIds: [1], roomIds: [11], tenantIds: [21], contractIds: [31],
    })
    expect(error).toHaveBeenCalledWith('内容已被其他管理员更新，请刷新后重试')
    expect(router.currentRoute.value.fullPath).toBe('/property-affairs/7/edit')
    expect((form.get('[data-test="affair-title"]').element as HTMLInputElement).value).toBe('现场输入不能丢')
  })

  it('创建后逐个上传附件；部分失败时列出文件名、保留事项并进入详情', async () => {
    const warning = vi.spyOn(ElMessage, 'warning')
    const { wrapper, router } = await mountView('/property-affairs/new')
    const first = new File(['a'], '现场.jpg', { type: 'image/jpeg' })
    const second = new File(['b'], '报价.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    vi.mocked(api.uploadPropertyAffairFile).mockResolvedValueOnce({ id: 9, originalName: '现场.jpg', mimeType: 'image/jpeg', sizeBytes: '1', uploadedAt: '2026-09-02T03:00:00.000Z' }).mockRejectedValueOnce(new Error('failed'))
    wrapper.findComponent(PropertyAffairForm).vm.$emit('submit', { model: validModel, status: 'PENDING', files: [first, second] })
    await flushPromises()

    expect(api.createPropertyAffair).toHaveBeenCalledWith({
      ...validModel,
      category: '公共维修', responsibleUserId: 2, externalHandlerName: '海口维修公司', externalPhone: '0898-12345678', externalContact: '微信同号',
    })
    expect(api.uploadPropertyAffairFile).toHaveBeenNthCalledWith(1, 7, first)
    expect(api.uploadPropertyAffairFile).toHaveBeenNthCalledWith(2, 7, second)
    expect(warning).toHaveBeenCalledWith('办事事项已创建，但以下附件上传失败：报价.xlsx。可在详情页重试上传。')
    expect(router.currentRoute.value.name).toBe('property-affair-detail')
  })

  it('创建附件全部成功时只报告完整成功并进入详情', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const warning = vi.spyOn(ElMessage, 'warning')
    const { wrapper, router } = await mountView('/property-affairs/new')
    const file = new File(['a'], '现场.jpg', { type: 'image/jpeg' })
    wrapper.findComponent(PropertyAffairForm).vm.$emit('submit', { model: validModel, status: 'PENDING', files: [file] })
    await flushPromises()

    expect(success).toHaveBeenCalledWith('办事事项及附件已创建')
    expect(warning).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('property-affair-detail')
  })

  it('创建附件全部失败时列出全部失败文件且不宣称成功，保留事项并进入详情', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const warning = vi.spyOn(ElMessage, 'warning')
    vi.mocked(api.uploadPropertyAffairFile).mockRejectedValue(new Error('上传失败'))
    const { wrapper, router } = await mountView('/property-affairs/new')
    const first = new File(['a'], '现场.jpg', { type: 'image/jpeg' })
    const second = new File(['b'], '报价.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

    wrapper.findComponent(PropertyAffairForm).vm.$emit('submit', { model: validModel, status: 'PENDING', files: [first, second] })
    await flushPromises()

    expect(api.createPropertyAffair).toHaveBeenCalledTimes(1)
    expect(api.uploadPropertyAffairFile).toHaveBeenNthCalledWith(1, 7, first)
    expect(api.uploadPropertyAffairFile).toHaveBeenNthCalledWith(2, 7, second)
    expect(warning).toHaveBeenCalledWith('办事事项已创建，但以下附件上传失败：现场.jpg、报价.xlsx。可在详情页重试上传。')
    expect(success).not.toHaveBeenCalled()
    expect(router.currentRoute.value.fullPath).toBe('/property-affairs/7')
  })
})
