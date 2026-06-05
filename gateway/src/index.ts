import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface ApiKey {
  tenantId: string;
  key: string;
  label: string;
  createdAt: string;
  lastUsed?: string;
}

interface ToolCallEvent {
  callId: string;
  tenantId: string;
  agentId: string;
  serverName: string;
  toolName: string;
  parameters: Record<string, unknown>;
  status: 'success' | 'error' | 'timeout';
  error?: string;
  durationMs: number;
  timestamp: string;
}

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || process.env.GATEWAY_PORT || '3456', 10);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_SCRIPT = path.resolve(__dirname, '../../packages/stripe-mcp/dist/index.js');
const DASHBOARD_DIR = path.resolve(__dirname, '../../dashboard/public');

// ──────────────────────────────────────────────
// In-memory stores
// ──────────────────────────────────────────────

let callCounter = 0;
const events: ToolCallEvent[] = [];
const apiKeys: Map<string, ApiKey> = new Map([
  [
    'ski_demo_key_001',
    {
      tenantId: 'demo_tenant',
      key: 'ski_demo_key_001',
      label: 'Demo API Key',
      createdAt: '2026-06-01T00:00:00Z',
    },
  ],
]);

function generateCallId(): string {
  callCounter++;
  return `call_${Date.now()}_${callCounter}`;
}

// ──────────────────────────────────────────────
// API Key validation
// ──────────────────────────────────────────────

function validateApiKey(header: string | undefined): ApiKey | null {
  if (!header) return null;
  const key = header.replace(/^Bearer\s+/i, '').trim();
  const entry = apiKeys.get(key);
  if (entry) entry.lastUsed = new Date().toISOString();
  return entry ?? null;
}

function generateApiKey(tenantId: string, label: string): ApiKey {
  const raw = `ski_${randomBytes(16).toString('hex')}`;
  const key: ApiKey = { tenantId, key: raw, label, createdAt: new Date().toISOString() };
  apiKeys.set(raw, key);
  return key;
}

// ──────────────────────────────────────────────
// MCP invocation via child process
// ──────────────────────────────────────────────

interface McpResponse { result?: unknown; error?: { message: string } }

function callMcpTool(
  tenantId: string,
  agentId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpResponse> {
  return new Promise((resolve) => {
    const child = spawn('node', [MCP_SERVER_SCRIPT], {
      env: {
        ...process.env,
        AGENT_INFRA_TENANT_ID: tenantId,
        AGENT_INFRA_AGENT_ID: agentId,
        MCP_SERVER_NAME: 'stripe',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill(); resolve({ error: { message: 'MCP call timed out after 15s' } }); }
    }, 15_000);

    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stderrMsg = stderr.trim();
      if (stderrMsg) console.error(`[MCP:${toolName}] ${stderrMsg}`);

      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve({ error: { message: `MCP produced no output. stderr: ${stderrMsg.slice(0, 300)}` } });
        return;
      }

      try {
        const parsed = JSON.parse(trimmed);
        resolve(parsed.error ? { error: parsed.error } : { result: parsed.result });
      } catch {
        const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed.result || parsed.error) {
              resolve(parsed.error ? { error: parsed.error } : { result: parsed.result });
              return;
            }
          } catch { /* skip */ }
        }
        resolve({ error: { message: `MCP parse error. stdout: ${trimmed.slice(0, 300)}` } });
      }
    });

    child.on('error', () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ error: { message: 'Failed to spawn MCP process' } }); }
    });

    // Send request once the server is ready (stderr emits "✅ running")
    let started = false;
    const sendRequest = () => {
      if (started) return;
      started = true;
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: toolName, arguments: args },
      }) + '\n');
      child.stdin.end();
    };

    child.stderr.on('data', () => sendRequest());
    setTimeout(sendRequest, 2000);
  });
}

// ──────────────────────────────────────────────
// Analytics helpers
// ──────────────────────────────────────────────

function recordEvent(event: Omit<ToolCallEvent, 'callId'>): ToolCallEvent {
  const full: ToolCallEvent = { callId: generateCallId(), ...event };
  events.push(full);
  if (events.length > 10_000) events.splice(0, events.length - 10_000);
  return full;
}

function getAnalyticsSummary(tenantId: string) {
  const tenantEvents = events.filter(e => e.tenantId === tenantId);
  if (tenantEvents.length === 0) return {
    totalCalls: 0, successfulCalls: 0, failedCalls: 0, avgDurationMs: 0,
    topTools: [], topAgents: [], recentCalls: [],
  };

  const totalCalls = tenantEvents.length;
  const successfulCalls = tenantEvents.filter(e => e.status === 'success').length;
  const failedCalls = tenantEvents.filter(e => e.status === 'error').length;
  const avgDurationMs = Math.round(tenantEvents.reduce((s, e) => s + e.durationMs, 0) / totalCalls);

  const toolCounts = new Map<string, number>();
  tenantEvents.forEach(e => toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1));
  const topTools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([toolName, count]) => ({ toolName, count }));

  const agentCounts = new Map<string, number>();
  tenantEvents.forEach(e => agentCounts.set(e.agentId, (agentCounts.get(e.agentId) || 0) + 1));
  const topAgents = [...agentCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([agentId, count]) => ({ agentId, count }));

  const recentCalls = [...tenantEvents].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 50);

  return { totalCalls, successfulCalls, failedCalls, avgDurationMs, topTools, topAgents, recentCalls };
}

const SECRET_FIELDS = new Set(['key', 'secret', 'token', 'password', 'apiKey', 'api_key', 'apikey']);
function sanitiseParams(params: Record<string, unknown>): Record<string, unknown> {
  const sanitised: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    sanitised[key] = SECRET_FIELDS.has(key) ? '***REDACTED***' : value;
  }
  return sanitised;
}

// ──────────────────────────────────────────────
// Express app
// ──────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Serve the dashboard as a static site
app.use(express.static(DASHBOARD_DIR));

// Request logging
app.use((req, _res, next) => {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ──────────────────────────────────────────────
// Routes — API Key management
// ──────────────────────────────────────────────

app.post('/api/keys', (req, res) => {
  const auth = validateApiKey(req.headers.authorization);
  if (!auth) { res.status(401).json({ error: 'Invalid or missing API key' }); return; }
  const { label } = req.body || {};
  const key = generateApiKey(auth.tenantId, label || 'unnamed key');
  res.json({ key: key.key, label: key.label, tenantId: key.tenantId, createdAt: key.createdAt, warning: 'Save this key — it will not be shown again.' });
});

app.get('/api/keys', (req, res) => {
  const auth = validateApiKey(req.headers.authorization);
  if (!auth) { res.status(401).json({ error: 'Invalid or missing API key' }); return; }
  const tenantKeys = [...apiKeys.values()].filter(k => k.tenantId === auth.tenantId)
    .map(k => ({ label: k.label, prefix: k.key.slice(0, 8) + '...', createdAt: k.createdAt, lastUsed: k.lastUsed || 'never' }));
  res.json({ keys: tenantKeys });
});

// ──────────────────────────────────────────────
// Routes — MCP Tool Invocation
// ──────────────────────────────────────────────

app.post('/mcp/:server/:tool', async (req, res) => {
  const auth = validateApiKey(req.headers.authorization);
  if (!auth) {
    res.status(401).json({
      error: 'Invalid or missing API key. Pass as: Authorization: Bearer <key>',
      hint: 'Demo key: ski_demo_key_001',
    });
    return;
  }

  const { tool } = req.params;
  const args = req.body || {};
  const agentId = (req.headers['x-agent-id'] as string) || `anon_agent_${auth.tenantId}`;
  const startTime = performance.now();

  try {
    const mcpResponse = await callMcpTool(auth.tenantId, agentId, tool, args);
    const durationMs = Math.round(performance.now() - startTime);

    if (mcpResponse.error) {
      recordEvent({ tenantId: auth.tenantId, agentId, serverName: 'stripe', toolName: tool, parameters: { _error: true }, status: 'error', error: mcpResponse.error.message, durationMs, timestamp: new Date().toISOString() });
      res.status(400).json({ error: mcpResponse.error.message });
      return;
    }

    recordEvent({ tenantId: auth.tenantId, agentId, serverName: 'stripe', toolName: tool, parameters: sanitiseParams(args), status: 'success', durationMs, timestamp: new Date().toISOString() });
    res.json(mcpResponse.result);
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    const errorMessage = err instanceof Error ? err.message : String(err);
    recordEvent({ tenantId: auth.tenantId, agentId, serverName: 'stripe', toolName: tool, parameters: { _error: true }, status: 'error', error: errorMessage, durationMs, timestamp: new Date().toISOString() });
    res.status(500).json({ error: errorMessage });
  }
});

// ──────────────────────────────────────────────
// Routes — Analytics
// ──────────────────────────────────────────────

app.get('/api/analytics', (req, res) => {
  const auth = validateApiKey(req.headers.authorization);
  if (!auth) { res.status(401).json({ error: 'Invalid or missing API key' }); return; }
  res.json(getAnalyticsSummary(auth.tenantId));
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    mcpServer: MCP_SERVER_SCRIPT,
    version: '0.1.0',
    apiKeys: apiKeys.size,
    events: events.length,
  });
});

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
  console.log(`║                                              ║`);
  console.log(`║  Dashboard: http://localhost:${PORT}          ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  console.log(`  🔑 Demo API Key: ski_demo_key_001\n`);
});