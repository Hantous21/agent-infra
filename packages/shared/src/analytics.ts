import { ToolCallEvent, TenantId, AgentId, CallId } from './index.js';

// ──────────────────────────────────────────────
// In-memory store for analytics events.
// MVP: simple array. Production: ClickHouse / Tinybird.
// ──────────────────────────────────────────────

const events: ToolCallEvent[] = [];

let callCounter = 0;

/**
 * Generate a unique call ID.
 */
function generateCallId(): CallId {
  callCounter++;
  return `call_${Date.now()}_${callCounter}`;
}

// ──────────────────────────────────────────────
// Analytics instrumentor
// ──────────────────────────────────────────────

export interface AnalyticsContext {
  tenantId: TenantId;
  agentId: AgentId;
  serverName: string;
}

/**
 * Wraps a tool handler with analytics instrumentation.
 * Measures duration, captures success/error, logs the event.
 */
export function withAnalytics<T extends unknown[], R>(
  ctx: AnalyticsContext,
  toolName: string,
  handler: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const callId = generateCallId();
    const start = performance.now();
    const timestamp = new Date().toISOString();

    try {
      const result = await handler(...args);
      const durationMs = Math.round(performance.now() - start);

      // Sanitise parameters: strip anything that looks like a secret
      const sanitisedParams = sanitiseParams(args);

      events.push({
        callId,
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        serverName: ctx.serverName,
        toolName,
        parameters: sanitisedParams,
        status: 'success',
        durationMs,
        timestamp,
      });

      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const errorMessage = err instanceof Error ? err.message : String(err);

      events.push({
        callId,
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        serverName: ctx.serverName,
        toolName,
        parameters: { _error: true },
        status: 'error',
        error: errorMessage,
        durationMs,
        timestamp,
      });

      throw err;
    }
  };
}

// ──────────────────────────────────────────────
// Query helpers for the analytics dashboard
// ──────────────────────────────────────────────

export function getEventsForTenant(tenantId: TenantId): ToolCallEvent[] {
  return events.filter((e) => e.tenantId === tenantId);
}

export function getAllEvents(): ToolCallEvent[] {
  return events;
}

/**
 * Simple sanitisation — removes fields with key names
 * that look like secrets (key, secret, token, password, apiKey).
 */
function sanitiseParams(args: unknown[]): Record<string, unknown> {
  if (args.length === 0) return {};
  const first = args[0];
  if (typeof first !== 'object' || first === null) return { _value: first };

  const sanitised: Record<string, unknown> = {};
  const secretFields = new Set(['key', 'secret', 'token', 'password', 'apiKey', 'api_key', 'apikey']);

  for (const [key, value] of Object.entries(first as Record<string, unknown>)) {
    if (secretFields.has(key)) {
      sanitised[key] = '***REDACTED***';
    } else {
      sanitised[key] = value;
    }
  }
  return sanitised;
}