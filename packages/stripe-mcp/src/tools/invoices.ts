import { z } from 'zod';

// ──────────────────────────────────────────────
// Mock data store — replaces Stripe API for MVP
// ──────────────────────────────────────────────

interface MockInvoice {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'overdue' | 'void';
  description: string;
  created: string;
}

const invoices: MockInvoice[] = [
  {
    id: 'in_mock_001',
    customerId: 'cus_mock_001',
    amount: 4999,
    currency: 'usd',
    status: 'paid',
    description: 'Monthly subscription — Growth plan',
    created: '2026-06-01T10:00:00Z',
  },
  {
    id: 'in_mock_002',
    customerId: 'cus_mock_002',
    amount: 19900,
    currency: 'usd',
    status: 'open',
    description: 'Annual subscription — Scale plan',
    created: '2026-06-03T14:30:00Z',
  },
  {
    id: 'in_mock_003',
    customerId: 'cus_mock_001',
    amount: 1200,
    currency: 'usd',
    status: 'overdue',
    description: 'Additional API credits',
    created: '2026-05-28T09:15:00Z',
  },
];

let nextId = 4;

// Schema for the create_invoice tool
export const CreateInvoiceSchema = z.object({
  customerId: z.string().min(1, 'customerId is required'),
  amount: z.number().positive('amount must be positive'),
  currency: z.string().length(3).default('usd'),
  description: z.string().optional().default(''),
});

export type CreateInvoiceParams = z.infer<typeof CreateInvoiceSchema>;

export async function createInvoice(params: CreateInvoiceParams) {
  const id = `in_mock_${String(nextId++).padStart(3, '0')}`;
  const invoice: MockInvoice = {
    id,
    customerId: params.customerId,
    amount: params.amount,
    currency: params.currency,
    status: 'open',
    description: params.description,
    created: new Date().toISOString(),
  };
  invoices.push(invoice);
  return { success: true as const, data: invoice };
}

// ──────────────────────────────────────────────

export const GetInvoiceStatusSchema = z.object({
  invoiceId: z.string().min(1, 'invoiceId is required'),
});

export type GetInvoiceStatusParams = z.infer<typeof GetInvoiceStatusSchema>;

export async function getInvoiceStatus(params: GetInvoiceStatusParams) {
  const invoice = invoices.find((inv) => inv.id === params.invoiceId);
  if (!invoice) {
    return { success: false as const, error: `Invoice ${params.invoiceId} not found` };
  }
  return { success: true as const, data: { id: invoice.id, status: invoice.status } };
}

// ──────────────────────────────────────────────

export const ListInvoicesSchema = z.object({
  customerId: z.string().optional(),
  status: z.enum(['draft', 'open', 'paid', 'overdue', 'void']).optional(),
  limit: z.number().int().positive().default(10),
});

export type ListInvoicesParams = z.infer<typeof ListInvoicesSchema>;

export async function listInvoices(params: ListInvoicesParams) {
  let results = [...invoices];
  if (params.customerId) {
    results = results.filter((inv) => inv.customerId === params.customerId);
  }
  if (params.status) {
    results = results.filter((inv) => inv.status === params.status);
  }
  return { success: true as const, data: results.slice(0, params.limit) };
}