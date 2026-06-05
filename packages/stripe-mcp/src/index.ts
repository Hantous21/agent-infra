#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { withAnalytics } from '@agent-infra/shared/dist/analytics.js';

import {
  createInvoice,
  getInvoiceStatus,
  listInvoices,
  CreateInvoiceSchema,
  GetInvoiceStatusSchema,
  ListInvoicesSchema,
} from './tools/invoices.js';

import {
  listCustomers,
  ListCustomersSchema,
} from './tools/customers.js';

import {
  refundPayment,
  RefundPaymentSchema,
} from './tools/refunds.js';

import {
  getBalance,
  GetBalanceSchema,
} from './tools/balance.js';

// ──────────────────────────────────────────────
// Tenancy context — in production this comes
// from the API key / gateway.
// ──────────────────────────────────────────────

const analyticsCtx = {
  tenantId: process.env.AGENT_INFRA_TENANT_ID ?? 'demo_tenant',
  agentId: process.env.AGENT_INFRA_AGENT_ID ?? 'demo_agent',
  serverName: 'stripe',
};

// ──────────────────────────────────────────────
// Create MCP server
// ──────────────────────────────────────────────

const server = new McpServer({
  name: '@agent-infra/stripe-mcp',
  version: '0.1.0',
  description: 'MCP server for Stripe — invoices, customers, refunds, and balance. Built for the agent economy.',
});

// ──────────────────────────────────────────────
// Helper: extract schema shape safely
// ──────────────────────────────────────────────

import { z } from 'zod';

function shapeOf<T extends object>(schema: z.ZodType<T>): Record<string, z.ZodTypeAny> {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodEffects) {
    return {};
  }
  if ('shape' in schema && typeof (schema as any).shape === 'object') {
    return (schema as any).shape as Record<string, z.ZodTypeAny>;
  }
  return {};
}

// ──────────────────────────────────────────────
// Register tools with analytics instrumentation
// ──────────────────────────────────────────────

// --- Invoices ---

server.tool(
  'create_invoice',
  'Create a new invoice for a customer',
  shapeOf(CreateInvoiceSchema),
  withAnalytics(analyticsCtx, 'create_invoice', async (params: Record<string, unknown>) => {
    const result = await createInvoice(CreateInvoiceSchema.parse(params));
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }),
);

server.tool(
  'get_invoice_status',
  'Check the status of an existing invoice',
  shapeOf(GetInvoiceStatusSchema),
  withAnalytics(analyticsCtx, 'get_invoice_status', async (params: Record<string, unknown>) => {
    const result = await getInvoiceStatus(GetInvoiceStatusSchema.parse(params));
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }),
);

server.tool(
  'list_invoices',
  'List invoices, optionally filtered by customer or status',
  shapeOf(ListInvoicesSchema),
  withAnalytics(analyticsCtx, 'list_invoices', async (params: Record<string, unknown>) => {
    const result = await listInvoices(ListInvoicesSchema.parse(params));
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }),
);

// --- Customers ---

server.tool(
  'list_customers',
  'Search customers by name, email, or ID',
  shapeOf(ListCustomersSchema),
  withAnalytics(analyticsCtx, 'list_customers', async (params: Record<string, unknown>) => {
    const result = await listCustomers(ListCustomersSchema.parse(params));
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }),
);

// --- Refunds ---

server.tool(
  'refund_payment',
  'Issue a refund for a payment intent',
  shapeOf(RefundPaymentSchema),
  withAnalytics(analyticsCtx, 'refund_payment', async (params: Record<string, unknown>) => {
    const result = await refundPayment(RefundPaymentSchema.parse(params));
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }),
);

// --- Balance ---

server.tool(
  'get_balance',
  'Check your Stripe account balance',
  {},
  withAnalytics(analyticsCtx, 'get_balance', async () => {
    const result = await getBalance();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }),
);

// ──────────────────────────────────────────────
// Start the MCP server over stdio transport
// ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('✅ Stripe MCP server running (stdio transport)');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});