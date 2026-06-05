import { z } from 'zod';

// ──────────────────────────────────────────────
// Mock balance data
// ──────────────────────────────────────────────

interface MockBalance {
  available: number;      // in cents
  pending: number;        // in cents
  currency: string;
}

const balance: MockBalance = {
  available: 1250000,    // $12,500
  pending: 340000,       // $3,400
  currency: 'usd',
};

// ──────────────────────────────────────────────

export const GetBalanceSchema = z.object({});

export async function getBalance() {
  return { success: true as const, data: balance };
}