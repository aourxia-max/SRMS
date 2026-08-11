import { http } from "./http";
import type {
  CheckoutContract,
  CheckoutSettlement,
} from "../views/checkout/checkout-types";

type Envelope<T> = { code: number; message: string; data: T };
const data = <T>(response: { data: Envelope<T> }) => response.data.data;

type CheckoutFinanceSnapshot = {
  depositBalance: string;
  rentOutstanding: string;
  prepaymentBalance: string;
  futureBillCount: number;
};

export const checkoutApi = {
  contracts: async () =>
    data(await http.get<Envelope<CheckoutContract[]>>("/contracts")),
  settlements: async () =>
    data(
      await http.get<Envelope<CheckoutSettlement[]>>("/checkout-settlements"),
    ),
  detail: async (id: number) =>
    data(
      await http.get<Envelope<CheckoutSettlement>>(
        `/checkout-settlements/${id}`,
      ),
    ),
  financeSnapshot: async (contractId: number) =>
    data(
      await http.get<Envelope<CheckoutFinanceSnapshot>>(
        `/checkout-settlements/contract/${contractId}/finance-snapshot`,
      ),
    ),
  initiate: async (contractId: number, payload: Record<string, unknown>) =>
    data(
      await http.post<Envelope<CheckoutSettlement>>(
        `/checkout-settlements/contract/${contractId}/initiate`,
        payload,
      ),
    ),
  submit: async (id: number, payload: Record<string, unknown>) =>
    data(
      await http.post<Envelope<CheckoutSettlement>>(
        `/checkout-settlements/${id}/submit`,
        payload,
      ),
    ),
  approve: async (id: number) =>
    data(
      await http.post<Envelope<CheckoutSettlement>>(
        `/checkout-settlements/${id}/approve`,
      ),
    ),
  returnToDraft: async (id: number) =>
    data(
      await http.post<Envelope<CheckoutSettlement>>(
        `/checkout-settlements/${id}/return-to-draft`,
      ),
    ),
  completeZeroRefund: async (id: number) =>
    data(
      await http.post<Envelope<CheckoutSettlement>>(
        `/checkout-settlements/${id}/complete-zero-refund`,
      ),
    ),
  uploadRefundProof: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return data(
      await http.post<Envelope<{ id: number }>>(
        "/deposit-refunds/proof-files",
        form,
      ),
    );
  },
  submitRefund: async (payload: Record<string, unknown>) =>
    data(
      await http.post<Envelope<Record<string, unknown>>>(
        "/deposit-refunds",
        payload,
      ),
    ),
  approveRefund: async (id: number) =>
    data(
      await http.post<Envelope<Record<string, unknown>>>(
        `/deposit-refunds/${id}/approve`,
      ),
    ),
};
