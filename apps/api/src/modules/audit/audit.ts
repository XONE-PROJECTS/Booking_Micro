import { auditLogs, type Tx } from '@universal-booking/database';
import type { AppContext } from '../../context';

export interface AuditEntry {
  tenantId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: Record<string, unknown>;
  actorType?: string;
  actorId?: string | null;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

const secretKeys = /password|secret|token|credential|key_hash|apikey/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, secretKeys.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

export async function writeAudit(app: AppContext, entry: AuditEntry, tx?: Tx): Promise<void> {
  const row = {
    tenantId: entry.tenantId,
    actorType: entry.actorType ?? 'system',
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    changes: entry.changes ? (redact(entry.changes) as Record<string, unknown>) : null,
    requestId: entry.requestId,
    ip: entry.ip,
    userAgent: entry.userAgent?.slice(0, 300),
  };
  if (tx) await tx.insert(auditLogs).values(row);
  else await app.db.system((t) => t.insert(auditLogs).values(row));
}
