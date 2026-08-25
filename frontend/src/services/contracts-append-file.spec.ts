import { describe, expect, it, vi } from 'vitest'
import { http } from './http'
import { appendContractFile } from './contracts'

vi.mock('./http', () => ({ http: { post: vi.fn() } }))

describe('appendContractFile', () => {
  it('uploads and links a new file to the selected contract', async () => {
    vi.mocked(http.post).mockResolvedValue({ data: { data: { id: 41, originalName: '补充合同.pdf' } } })
    const file = new File(['%PDF-1.7'], '补充合同.pdf', { type: 'application/pdf' })

    await appendContractFile(12, file)

    expect(http.post).toHaveBeenCalledWith('/contracts/12/files', expect.any(FormData))
  })
})
