// ──────────────────────────────────────────────
// Types for the entire Agent Infra platform
// ──────────────────────────────────────────────

/**
 * Unique identifier for an agent making a request.
 * Typically derived from the API key.
 */
export type AgentId = string;

/**
 * Unique identifier for a customer / tenant who
 * owns the MCP server subscription.
 */
export type TenantId = string;

/**
 * Unique identifier for a single tool invocation.
 */
export type CallId = string;

// ──────────────────────────────────────────────
// Tool call event — the core analytics unit
// ──────────────────────────────────────────────

export interface ToolCallEvent {
  /** Unique call ID (UUID) */
  callId: CallId;
  /** Which tenant owns this server */
  tenantId: TenantId;
  /** Which agent (derived from API key) */
  agentId: AgentId;
  /** Name of the MCP server (e.g. "stripe") */
  serverName: string;
  /** Tool name (e.g. "create_invoice") */
  toolName: string;
  /** Parameters passed (sanitised — secrets stripped) */
  parameters: Record<string, unknown>;
  /** Status of the call */
  status: 'success' | 'error' | 'timeout';
  /** Error message if status === 'error' */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** ISO-8601 timestamp */
  timestamp: string;
}

// ──────────────────────────────────────────────
// Analytics query results
// ──────────────────────────────────────────────

export interface AgentAnalyticsSummary {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgDurationMs: number;
  topTools: { toolName: string; count: number }[];
  topAgents: { agentId: string; count: number }[];
  callsOverTime: { period: string; count: number }[];
}

// ──────────────────────────────────────────────
// Tool definition — what every MCP tool returns
// ──────────────────────────────────────────────

export type ToolResult =
  | { success: true; data: unknown }
  | { success: false; error: string };