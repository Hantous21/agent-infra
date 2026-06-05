import { z } from 'zod';

// ──────────────────────────────────────────────
// Mock customer data
// ──────────────────────────────────────────────

interface MockCustomer {
  id: string;
  name: string;
  email: string;
  balance: number;   // in cents (negative = credit owed)
  created: string;
}

const customers: MockCustomer[] = [
  {
    id: 'cus_mock_001',
    name: 'Acme Corp',
    email: 'billing@acme.com',
    balance: 0,
    created: '2026-01-15T08:00:00Z',
  },
  {
    id: 'cus_mock_002',
    name: 'Globex Inc',
    email: 'finance@globex.io',
    balance: -5000,   // $50 credit
    created: '2026-03-22T12:00:00Z',
  },
  {
    id: 'cus_mock_003',
    name: 'Initech',
    email: 'ap@initech.com',
    balance: 15000,   // $150 outstanding
    created: '2026-04-10T09:30:00Z',
  },
];

// ──────────────────────────────────────────────

export const ListCustomersSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().positive().default(10),
});

export type ListCustomersParams = z.infer<typeof ListCustomersSchema>;

export async function listCustomers(params: ListCustomersParams) {
  let results = [...customers];
  if (params.query) {
    const q = params.query.toLowerCase();
    results = results.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }
  return { success: true as const, data: results.slice(0, params.limit) };
}