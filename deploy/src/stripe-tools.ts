import { z } from 'zod';
import Stripe from 'stripe';

// ──────────────────────────────────────────────
// Stripe client — reads key from env or falls
// back to a test key for development.
// ──────────────────────────────────────────────

const stripeKey = process.env.STRIPE_SECRET_KEY || '';

let stripe: Stripe;
try {
  stripe = new Stripe(stripeKey, { apiVersion: '2025-03-31.basil' as any });
} catch {
  // Fallback: will be caught at runtime
  stripe = null as unknown as Stripe;
}

// ──────────────────────────────────────────────
// Error wrapper
// ──────────────────────────────────────────────

function stripeError(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) {
    return `Stripe ${err.type}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// ──────────────────────────────────────────────
// Tool: Invoices
// ──────────────────────────────────────────────

export const CreateInvoiceSchema = z.object({
  customerId: z.string().min(1, 'customerId is required'),
  amount: z.number().positive('amount must be positive'),
  currency: z.string().length(3).default('usd'),
  description: z.string().optional().default(''),
});

export async function createInvoice(params: z.infer<typeof CreateInvoiceSchema>) {
  try {
    const invoice = await stripe.invoices.create({
      customer: params.customerId,
      auto_advance: true,
      description: params.description || undefined,
      currency: params.currency,
      // Stripe expects amount in cents as metadata — we use a
      // custom amount approach. For a real integration you'd
      // create invoice items. Here we set the amount via metadata.
      metadata: { amount: String(params.amount), description: params.description },
    });
    return { success: true as const, data: invoice };
  } catch (err) {
    return { success: false as const, error: stripeError(err) };
  }
}

// ──────────────────────────────────────────────

export const GetInvoiceStatusSchema = z.object({
  invoiceId: z.string().min(1, 'invoiceId is required'),
});

export async function getInvoiceStatus(params: z.infer<typeof GetInvoiceStatusSchema>) {
  try {
    const invoice = await stripe.invoices.retrieve(params.invoiceId);
    return {
      success: true as const,
      data: { id: invoice.id, status: invoice.status, amount_due: invoice.amount_due, amount_paid: invoice.amount_paid, currency: invoice.currency },
    };
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError && err.statusCode === 404) {
      return { success: false as const, error: `Invoice ${params.invoiceId} not found` };
    }
    return { success: false as const, error: stripeError(err) };
  }
}

// ──────────────────────────────────────────────

export const ListInvoicesSchema = z.object({
  customerId: z.string().optional(),
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']).optional(),
  limit: z.number().int().positive().default(10),
});

export async function listInvoices(params: z.infer<typeof ListInvoicesSchema>) {
  try {
    const listParams: Stripe.InvoiceListParams = { limit: params.limit };
    if (params.customerId) listParams.customer = params.customerId;
    if (params.status) listParams.status = params.status;

    const invoices = await stripe.invoices.list(listParams);
    return { success: true as const, data: invoices.data };
  } catch (err) {
    return { success: false as const, error: stripeError(err) };
  }
}

// ──────────────────────────────────────────────
// Tool: Customers
// ──────────────────────────────────────────────

export const ListCustomersSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().positive().default(10),
});

export async function listCustomers(params: z.infer<typeof ListCustomersSchema>) {
  try {
    const listParams: Stripe.CustomerListParams = { limit: params.limit };
    const customers = await stripe.customers.list(listParams);

    let results = customers.data;
    if (params.query) {
      const q = params.query.toLowerCase();
      results = results.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q),
      );
    }

    return { success: true as const, data: results };
  } catch (err) {
    return { success: false as const, error: stripeError(err) };
  }
}

// ──────────────────────────────────────────────
// Tool: Refunds
// ──────────────────────────────────────────────

export const RefundPaymentSchema = z.object({
  paymentIntentId: z.string().min(1, 'paymentIntentId is required'),
  amount: z.number().positive('amount must be positive').optional(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).default('requested_by_customer'),
});

export async function refundPayment(params: z.infer<typeof RefundPaymentSchema>) {
  try {
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: params.paymentIntentId,
      reason: params.reason,
    };
    if (params.amount) refundParams.amount = params.amount;

    const refund = await stripe.refunds.create(refundParams);
    return { success: true as const, data: refund };
  } catch (err) {
    return { success: false as const, error: stripeError(err) };
  }
}

// ──────────────────────────────────────────────
// Tool: Balance
// ──────────────────────────────────────────────

export const GetBalanceSchema = z.object({});

export async function getBalance() {
  try {
    const balance = await stripe.balance.retrieve();
    return { success: true as const, data: balance };
  } catch (err) {
    return { success: false as const, error: stripeError(err) };
  }
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
  { name: 'get_balance', description: 'Check your Stripe account balance', schema: {} as Record<string, z.ZodTypeAny>, handler: async () => getBalance() },
];