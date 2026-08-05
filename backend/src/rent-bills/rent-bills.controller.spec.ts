import { RentBillsController } from './rent-bills.controller';

describe('RentBillsController', () => {
  it('wraps list results in the standard response envelope', async () => {
    const service = { list: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, summary: { payable: '0.00', received: '0.00', outstanding: '0.00', count: 0, overdueCount: 0 } }) } as any;
    const result = await new RentBillsController(service).list({ page: 1, pageSize: 20 });

    expect(service.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(result).toEqual({ code: 200, message: 'success', data: expect.objectContaining({ total: 0 }) });
  });

  it('passes a numeric id to the detail service', async () => {
    const service = { detail: jest.fn().mockResolvedValue({ id: 9 }) } as any;
    const result = await new RentBillsController(service).detail(9);

    expect(service.detail).toHaveBeenCalledWith(9);
    expect(result).toEqual({ code: 200, message: 'success', data: { id: 9 } });
  });
});
