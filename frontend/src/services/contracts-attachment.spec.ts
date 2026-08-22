import { describe, expect, it } from 'vitest'
import { isPreviewableContractImage } from './contracts'

describe('合同附件在线预览', () => {
  it('只允许浏览器支持的合同图片在线预览', () => {
    expect(isPreviewableContractImage({ mimeType: 'image/jpeg' })).toBe(true)
    expect(isPreviewableContractImage({ mimeType: 'image/png' })).toBe(true)
    expect(isPreviewableContractImage({ mimeType: 'image/webp' })).toBe(true)
    expect(isPreviewableContractImage({ mimeType: 'image/gif' })).toBe(true)
    expect(isPreviewableContractImage({ mimeType: 'image/heic' })).toBe(false)
    expect(isPreviewableContractImage({ mimeType: 'application/pdf' })).toBe(false)
  })
})