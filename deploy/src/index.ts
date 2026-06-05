import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { tools } from './stripe-tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '10000', 10);
const DASHBOARD_DIR = path.resolve(__dirname, '../dashboard');

// ──────────────────────────────────────────────
// Analytics event store
// ──────────────────────────────────────────────

interface ToolCallEvent {
  callId: string; tenantId: string; agentId: string; serverName: string;
  toolName: string; status: 'success' | 'error' | 'timeout'; error?: string;
  durationMs: number; timestamp: string;
}

let counter = 0;
const events: ToolCallEvent[] = [];

// ──────────────────────────────────────────────
// API key store
// ──────────────────────────────────────────────

interface ApiKey { tenantId: string; key: string; label: string; createdAt: string; lastUsed?: string; }
const apiKeys = new Map<string, ApiKey>([
  ['ski_demo_key_001', { tenantId: 'demo', key: 'ski_demo_key_001', label: 'Demo Key', createdAt: '2026-06-01T00:00:00Z' }],
]);

function validateKey(header: string | undefined): ApiKey | null {
  if (!header) return null;
  const key = header.replace(/^Bearer\s+/i, '').trim();
  const entry = apiKeys.get(key);
  if (entry) entry.lastUsed = new Date().toISOString();
  return entry ?? null;
}

// ──────────────────────────────────────────────
// Tool execution
// ──────────────────────────────────────────────

async function executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = tools.find(t => t.name === toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  const result = await tool.handler(args);

  // Return just the content format the MCP protocol expects
  if (typeof result === 'object' && result !== null && 'success' in result) {
    const r = result as { success: boolean; data?: unknown; error?: string };
    if (r.success) return { content: [{ type: 'text' as const, text: JSON.stringify(r.data, null, 2) }] };
    throw new Error(r.error || 'Unknown error');
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

// ──────────────────────────────────────────────
// Express app
// ──────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Serve dashboard
app.use(express.static(DASHBOARD_DIR));

// Health
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok', uptime: process.uptime(), version: '0.1.0',
    apiKeys: apiKeys.size, events: events.length, tools: tools.map(t => t.name),
  });
});

// MCP tool invocation
app.post('/mcp/stripe/:tool', async (req, res) => {
  const auth = validateKey(req.headers.authorization);
  if (!auth) {
    res.status(401).json({ error: 'Invalid or missing API key. Try: ski_demo_key_001' });
    return;
  }

  const { tool } = req.params;
  const agentId = (req.headers['x-agent-id'] as string) || 'anon_agent';
  const start = performance.now();

  try {
    const result = await executeTool(tool, req.body || {});
    const durationMs = Math.round(performance.now() - start);
    events.push({
      callId: `call_${Date.now()}_${++counter}`, tenantId: auth.tenantId, agentId,
      serverName: 'stripe', toolName: tool, status: 'success',
      durationMs, timestamp: new Date().toISOString(),
    });
    res.json(result);
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    events.push({
      callId: `call_${Date.now()}_${++counter}`, tenantId: auth.tenantId, agentId,
      serverName: 'stripe', toolName: tool, status: 'error',
      error: err instanceof Error ? err.message : String(err),
      durationMs, timestamp: new Date().toISOString(),
    });
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// MCP tools list
app.get('/mcp/stripe/tools', (_req, res) => {
  res.json({
    tools: tools.map(t => ({
      name: t.name, description: t.description,
      inputSchema: { type: 'object', properties: buildJsonSchema(t.schema), additionalProperties: false },
    })),
  });
});

// Analytics
app.get('/api/analytics', (req, res) => {
  const auth = validateKey(req.headers.authorization);
  if (!auth) { res.status(401).json({ error: 'Invalid key' }); return; }

  const tenantEvents = events.filter(e => e.tenantId === auth.tenantId);
  if (tenantEvents.length === 0) {
    res.json({ totalCalls: 0, successfulCalls: 0, failedCalls: 0, avgDurationMs: 0, topTools: [], topAgents: [], recentCalls: [] });
    return;
  }

  const totalCalls = tenantEvents.length;
  const successfulCalls = tenantEvents.filter(e => e.status === 'success').length;
  const failedCalls = tenantEvents.filter(e => e.status === 'error').length;
  const avgDurationMs = Math.round(tenantEvents.reduce((s, e) => s + e.durationMs, 0) / totalCalls);

  const toolCounts = new Map<string, number>();
  tenantEvents.forEach(e => toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1));
  const topTools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([toolName, count]) => ({ toolName, count }));

  const agentCounts = new Map<string, number>();
  tenantEvents.forEach(e => agentCounts.set(e.agentId, (agentCounts.get(e.agentId) || 0) + 1));
  const topAgents = [...agentCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([agentId, count]) => ({ agentId, count }));

  const recentCalls = [...tenantEvents].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 50);

  res.json({ totalCalls, successfulCalls, failedCalls, avgDurationMs, topTools, topAgents, recentCalls });
});

// ──────────────────────────────────────────────
// Schema helper
// ──────────────────────────────────────────────

function buildJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, _val] of Object.entries(schema)) {
    props[key] = { type: 'string' };
  }
  return props;
}

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║        🚀 Agent Infra Gateway               ║`);
  console.log(`║                                              ║`);
  console.log(`║  Port:     ${String(PORT).padEnd(29)}║`);
  console.log(`║  Keys:     ${apiKeys.size} active${' '.repeat(24)}║`);
  console.log(`║  Events:   ${events.length} recorded${' '.repeat(23)}║`);
  console.log(`║  Tools:    ${tools.length} registered${' '.repeat(22)}║`);
  console.log(`║                                              ║`);
  console.log(`║  Dashboard: http://localhost:${PORT}          ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  console.log(`  🔑 Demo API Key: ski_demo_key_001\n`);
});