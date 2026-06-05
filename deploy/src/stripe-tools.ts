import { z } from 'zod';

// ──────────────────────────────────────────────
// In-memory mock data
// ──────────────────────────────────────────────

interface Invoice {
  id: string; customerId: string; amount: number; currency: string;
  status: 'draft' | 'open' | 'paid' | 'overdue' | 'void';
  description: string; created: string;
}

interface Customer {
  id: string; name: string; email: string; balance: number; created: string;
}

interface Refund {
  id: string; paymentIntentId: string; amount: number; currency: string;
  status: 'succeeded' | 'pending' | 'failed'; reason: string; created: string;
}

interface Balance {
  available: number; pending: number; currency: string;
}

// Seed data
const invoices: Invoice[] = [
  { id: 'in_mock_001', customerId: 'cus_mock_001', amount: 4999, currency: 'usd', status: 'paid', description: 'Monthly subscription — Growth plan', created: '2026-06-01T10:00:00Z' },
  { id: 'in_mock_002', customerId: 'cus_mock_002', amount: 19900, currency: 'usd', status: 'open', description: 'Annual subscription — Scale plan', created: '2026-06-03T14:30:00Z' },
  { id: 'in_mock_003', customerId: 'cus_mock_001', amount: 1200, currency: 'usd', status: 'overdue', description: 'Additional API credits', created: '2026-05-28T09:15:00Z' },
];

const customers: Customer[] = [
  { id: 'cus_mock_001', name: 'Acme Corp', email: 'billing@acme.com', balance: 0, created: '2026-01-15T08:00:00Z' },
  { id: 'cus_mock_002', name: 'Globex Inc', email: 'finance@globex.io', balance: -5000, created: '2026-03-22T12:00:00Z' },
  { id: 'cus_mock_003', name: 'Initech', email: 'ap@initech.com', balance: 15000, created: '2026-04-10T09:30:00Z' },
];

const refunds: Refund[] = [
  { id: 're_mock_001', paymentIntentId: 'pi_mock_001', amount: 2999, currency: 'usd', status: 'succeeded', reason: 'customer_request', created: '2026-05-20T11:00:00Z' },
];

const balance: Balance = { available: 1250000, pending: 340000, currency: 'usd' };
let nextInvoiceId = 4;
let nextRefundId = 2;

// ──────────────────────────────────────────────
// Tool implementations
// ──────────────────────────────────────────────

export const CreateInvoiceSchema = z.object({
  customerId: z.string().min(1), amount: z.number().positive(),
  currency: z.string().length(3).default('usd'), description: z.string().optional().default(''),
});

export async function createInvoice(params: z.infer<typeof CreateInvoiceSchema>) {
  const id = `in_mock_${String(nextInvoiceId++).padStart(3, '0')}`;
  const invoice: Invoice = { id, ...params, status: 'open', created: new Date().toISOString() };
  invoices.push(invoice);
  return { success: true as const, data: invoice };
}

export const GetInvoiceStatusSchema = z.object({ invoiceId: z.string().min(1) });

export async function getInvoiceStatus(params: z.infer<typeof GetInvoiceStatusSchema>) {
  const invoice = invoices.find(i => i.id === params.invoiceId);
  if (!invoice) return { success: false as const, error: `Invoice ${params.invoiceId} not found` };
  return { success: true as const, data: { id: invoice.id, status: invoice.status } };
}

export const ListInvoicesSchema = z.object({
  customerId: z.string().optional(), status: z.enum(['draft','open','paid','overdue','void']).optional(),
  limit: z.number().int().positive().default(10),
});

export async function listInvoices(params: z.infer<typeof ListInvoicesSchema>) {
  let results = [...invoices];
  if (params.customerId) results = results.filter(i => i.customerId === params.customerId);
  if (params.status) results = results.filter(i => i.status === params.status);
  return { success: true as const, data: results.slice(0, params.limit) };
}

export const ListCustomersSchema = z.object({ query: z.string().optional(), limit: z.number().int().positive().default(10) });

export async function listCustomers(params: z.infer<typeof ListCustomersSchema>) {
  let results = [...customers];
  if (params.query) {
    const q = params.query.toLowerCase();
    results = results.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }
  return { success: true as const, data: results.slice(0, params.limit) };
}

export const RefundPaymentSchema = z.object({
  paymentIntentId: z.string().min(1), amount: z.number().positive().optional(),
  reason: z.enum(['duplicate','fraudulent','customer_request']).default('customer_request'),
});

export async function refundPayment(params: z.infer<typeof RefundPaymentSchema>) {
  const id = `re_mock_${String(nextRefundId++).padStart(3, '0')}`;
  if (Math.random() < 0.1) return { success: false as const, error: 'Refund failed: insufficient balance.' };
  refunds.push({ id, paymentIntentId: params.paymentIntentId, amount: params.amount ?? 0, currency: 'usd', status: 'succeeded', reason: params.reason, created: new Date().toISOString() });
  return { success: true as const, data: { id, status: 'succeeded' } };
}

export const GetBalanceSchema = z.object({});

export async function getBalance() {
  return { success: true as const, data: balance };
}

// ──────────────────────────────────────────────
// Registered tools list — for MCP server setup
// ──────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export const tools: ToolDef[] = [
  { name: 'create_invoice', description: 'Create a new invoice for a customer', schema: CreateInvoiceSchema.shape as Record<string, z.ZodTypeAny>, handler: async (a) => createInvoice(CreateInvoiceSchema.parse(a)) },
  { name: 'get_invoice_status', description: 'Check the status of an existing invoice', schema: GetInvoiceStatusSchema.shape as Record<string, z.ZodTypeAny>, handler: async (a) => getInvoiceStatus(GetInvoiceStatusSchema.parse(a)) },
  { name: 'list_invoices', description: 'List invoices, optionally filtered by customer or status', schema: ListInvoicesSchema.shape as Record<string, z.ZodTypeAny>, handler: async (a) => listInvoices(ListInvoicesSchema.parse(a)) },
  { name: 'list_customers', description: 'Search customers by name, email, or ID', schema: ListCustomersSchema.shape as Record<string, z.ZodTypeAny>, handler: async (a) => listCustomers(ListCustomersSchema.parse(a)) },
  { name: 'refund_payment', description: 'Issue a refund for a payment intent', schema: RefundPaymentSchema.shape as Record<string, z.ZodTypeAny>, handler: async (a) => refundPayment(RefundPaymentSchema.parse(a)) },
  { name: 'get_balance', description: 'Check your account balance', schema: {} as Record<string, z.ZodTypeAny>, handler: async () => getBalance() },
];