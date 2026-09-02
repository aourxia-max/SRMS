import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { PropertyAffairCreatePayload, PropertyAffairUpdatePayload, PropertyAffairUploadFile } from '../types/property-affairs'
import { http } from './http'
import {
  appendPropertyAffairProgress,
  createPropertyAffair,
  extractPropertyAffairErrorMessage,
  getPropertyAffair,
  listPropertyAffairCategories,
  listPropertyAffairResponsibleUsers,
  listPropertyAffairs,
  listPropertyAffairsRecycleBin,
  permanentlyDeletePropertyAffair,
  previewPropertyAffairFile,
  restorePropertyAffair,
  softDeletePropertyAffair,
  unlinkPropertyAffairFile,
  updatePropertyAffair,
  uploadPropertyAffairFile,
  downloadPropertyAffairFile,
} from './property-affairs'

const envelope = <T>(data: T) => ({ data: { code: 200, message: 'success', data } })
const affair = { id: 7, affairNo: 'WY202609020001', title: '走廊照明维修', version: 3 }

describe('物业办事 API', () => {
  afterEach(() => vi.restoreAllMocks())

  it('以查询参数加载分页事项并解包响应信封', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue(envelope({ items: [affair], total: 1, page: 2, pageSize: 10 }) as never)

    await expect(listPropertyAffairs({ keyword: '照明', status: 'IN_PROGRESS', page: 2, pageSize: 10 })).resolves.toEqual({ items: [affair], total: 1, page: 2, pageSize: 10 })
    expect(get).toHaveBeenCalledWith('/property-affairs', { params: { keyword: '照明', status: 'IN_PROGRESS', page: 2, pageSize: 10 } })
  })

  it('通过独立回收站端点加载已删除事项', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue(envelope({ items: [affair], total: 1, page: 1, pageSize: 20 }) as never)

    await expect(listPropertyAffairsRecycleBin({ keyword: '照明', page: 1, pageSize: 20 })).resolves.toEqual({ items: [affair], total: 1, page: 1, pageSize: 20 })
    expect(get).toHaveBeenCalledWith('/property-affairs/recycle-bin', { params: { keyword: '照明', page: 1, pageSize: 20 } })
  })

  it('加载详情、分类和可选负责人并解包响应信封', async () => {
    const get = vi.spyOn(http, 'get')
      .mockResolvedValueOnce(envelope(affair) as never)
      .mockResolvedValueOnce(envelope(['公共维修', '历史分类']) as never)
      .mockResolvedValueOnce(envelope([{ id: 2, displayName: '管理员', role: 'ADMIN' }]) as never)

    await expect(getPropertyAffair(7)).resolves.toEqual(affair)
    await expect(listPropertyAffairCategories()).resolves.toEqual(['公共维修', '历史分类'])
    await expect(listPropertyAffairResponsibleUsers()).resolves.toEqual([{ id: 2, displayName: '管理员', role: 'ADMIN' }])
    expect(get).toHaveBeenNthCalledWith(1, '/property-affairs/7')
    expect(get).toHaveBeenNthCalledWith(2, '/property-affairs/categories')
    expect(get).toHaveBeenNthCalledWith(3, '/property-affairs/responsible-users')
  })

  it('使用精确创建、更新和进度端点并保留版本号', async () => {
    const post = vi.spyOn(http, 'post')
      .mockResolvedValueOnce(envelope(affair) as never)
      .mockResolvedValueOnce(envelope({ ...affair, version: 4 }) as never)
    const patch = vi.spyOn(http, 'patch').mockResolvedValue(envelope({ ...affair, version: 5 }) as never)
    const create: PropertyAffairCreatePayload = {
      title: '走廊照明维修', content: '更换损坏灯具', priority: 'URGENT',
      buildingIds: [1], roomIds: [2], tenantIds: [], contractIds: [],
    }
    const update: PropertyAffairUpdatePayload = { version: 3, title: '走廊照明维修', buildingIds: [1], roomIds: [2], tenantIds: [], contractIds: [] }

    await createPropertyAffair(create)
    await updatePropertyAffair(7, update)
    await appendPropertyAffairProgress(7, { version: 4, content: '已联系维修人员', nextStatus: 'IN_PROGRESS' })
    expect(post).toHaveBeenNthCalledWith(1, '/property-affairs', create)
    expect(patch).toHaveBeenCalledWith('/property-affairs/7', expect.objectContaining({ version: 3, title: '走廊照明维修' }))
    expect(post).toHaveBeenNthCalledWith(2, '/property-affairs/7/progress', { version: 4, content: '已联系维修人员', nextStatus: 'IN_PROGRESS' })
  })

  it('通过 Axios DELETE config 发送乐观锁版本并解包写操作', async () => {
    const del = vi.spyOn(http, 'delete')
      .mockResolvedValueOnce(envelope({ ...affair, version: 4 }) as never)
      .mockResolvedValueOnce(envelope({ id: 7 }) as never)
    const post = vi.spyOn(http, 'post').mockResolvedValue(envelope({ ...affair, version: 5 }) as never)

    await softDeletePropertyAffair(7, 3)
    await restorePropertyAffair(7, 4)
    await permanentlyDeletePropertyAffair(7, 5)
    expect(del).toHaveBeenNthCalledWith(1, '/property-affairs/7', { data: { version: 3 } })
    expect(post).toHaveBeenCalledWith('/property-affairs/7/restore', { version: 4 })
    expect(del).toHaveBeenNthCalledWith(2, '/property-affairs/7/permanent', { data: { version: 5 } })
  })

  it('上传、预览、下载和解除附件时使用正确的端点、FormData 和 blob 响应', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(envelope({ id: 9, originalName: '维修单.pdf', mimeType: 'application/pdf', extension: '.pdf', sizeBytes: '123', uploadedAt: '2026-09-02T00:00:00.000Z' }) as never)
    const get = vi.spyOn(http, 'get')
      .mockResolvedValueOnce({ data: new Blob(['preview']) } as never)
      .mockResolvedValueOnce({ data: new Blob(['download']) } as never)
    const del = vi.spyOn(http, 'delete').mockResolvedValue(envelope({ id: 9 }) as never)
    const file = new File(['test'], '维修单.pdf', { type: 'application/pdf' })

    await uploadPropertyAffairFile(7, file)
    await previewPropertyAffairFile(7, 9)
    await downloadPropertyAffairFile(7, 9)
    await unlinkPropertyAffairFile(7, 9)
    expect(post).toHaveBeenCalledWith('/property-affairs/7/files', expect.any(FormData))
    const form = post.mock.calls[0]?.[1] as FormData
    expect(form.get('file')).toBe(file)
    expect(get).toHaveBeenNthCalledWith(1, '/property-affairs/7/files/9/preview', { responseType: 'blob' })
    expect(get).toHaveBeenNthCalledWith(2, '/property-affairs/7/files/9/download', { responseType: 'blob' })
    expect(del).toHaveBeenCalledWith('/property-affairs/7/files/9')
  })

  it('保留后端中文数组错误，非空字符串也原样保留，并在其他情况使用调用方中文回退', () => {
    expect(extractPropertyAffairErrorMessage({ response: { data: { message: ['标题不能为空', '内容不能为空'] } } }, '保存物业办事失败')).toBe('标题不能为空；内容不能为空')
    expect(extractPropertyAffairErrorMessage({ response: { data: { message: '内容已被其他管理员更新，请刷新后重试' } } }, '保存物业办事失败')).toBe('内容已被其他管理员更新，请刷新后重试')
    expect(extractPropertyAffairErrorMessage({ response: { data: { message: '   ' } } }, '保存物业办事失败')).toBe('保存物业办事失败')
    expect(extractPropertyAffairErrorMessage(new Error('network'), '保存物业办事失败')).toBe('保存物业办事失败')
  })

  it('将上传接口结果限制为后端实际返回的附件字段', () => {
    expectTypeOf<Awaited<ReturnType<typeof uploadPropertyAffairFile>>>()
      .toEqualTypeOf<PropertyAffairUploadFile>()
  })
})
