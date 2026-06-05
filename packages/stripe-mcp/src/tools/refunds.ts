import { z } from 'zod';

// ──────────────────────────────────────────────
// Mock refund data
// ──────────────────────────────────────────────

interface MockRefund {
  id: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'pending' | 'failed';
  reason: string;
  created: string;
}

const refunds: MockRefund[] = [
  {
    id: 're_mock_001',
    paymentIntentId: 'pi_mock_001',
    amount: 2999,
    currency: 'usd',
    status: 'succeeded',
    reason: 'customer_request',
    created: '2026-05-20T11:00:00Z',
  },
];

let nextId = 2;

// ──────────────────────────────────────────────

export const RefundPaymentSchema = z.object({
  paymentIntentId: z.string().min(1, 'paymentIntentId is required'),
  amount: z.number().positive('amount must be positive').optional(),
  reason: z.enum(['duplicate', 'fraudulent', 'customer_request']).default('customer_request'),
});

export type RefundPaymentParams = z.infer<typeof RefundPaymentSchema>;

export async function refundPayment(params: RefundPaymentParams) {
  const id = `re_mock_${String(nextId++).padStart(3, '0')}`;

  // Simulate occasional failure (10%)
  if (Math.random() < 0.1) {
    return {
      success: false as const,
      error: 'Refund failed: insufficient balance in merchant account.',
    };
  }

  const refund: MockRefund = {
    id,
    paymentIntentId: params.paymentIntentId,
    amount: params.amount ?? 0, // 0 means full refund in real Stripe
    currency: 'usd',
    status: 'succeeded',
    reason: params.reason,
    created: new Date().toISOString(),
  };
  refunds.push(refund);
  return { success: true as const, data: refund };
}