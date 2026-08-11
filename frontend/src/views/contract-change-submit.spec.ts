import { describe, expect, it } from 'vitest'
import { contractChangeSubmitErrorMessage } from './contract-change-submit'

describe('contract change submission errors', () => {
  it('shows the API rejection reason instead of hiding a failed submission', () => {
    const error = {
      response: {
        data: {
          message: '变更生效日期必须在当前合同租期内',
        },
      },
    }

    expect(contractChangeSubmitErrorMessage(error)).toBe(
      '变更生效日期必须在当前合同租期内',
    )
  })

  it('falls back to a clear Chinese message when the API response has no text', () => {
    expect(contractChangeSubmitErrorMessage(new Error('network failed'))).toBe(
      '合同变更提交失败，请检查填写内容后重试',
    )
  })
})
