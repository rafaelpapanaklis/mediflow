/**
 * Tipos compartidos del sistema de bug-audit.
 *
 * Esta forma `AuditItem` la consume tanto el orquestador "extras"
 * (lo que vive en este branch) como el orquestador principal de Git 1
 * (branch bug-audit-report). La UI de /dashboard/admin/bug-audit muestra
 * runs guardados en la tabla `bug_audit_runs` independiente de la fuente.
 */

export type AuditSeverity = "critical" | "high" | "medium" | "low";

/**
 * Categorías son strings libres pero documentamos las que usa el orquestador
 * extras. Git 1 puede agregar más sin chocar.
 */
export type AuditCategory =
  | "webhooks"
  | "crons"
  | "storage"
  | "ai"
  | "env"
  | "arco"
  | "backups"
  | "tests"
  | "a11y"
  | "migrations";

export interface AuditItem {
  category: AuditCategory | string;
  severity: AuditSeverity;
  /** Path relativo a la raíz del repo. Vacío si es transversal. */
  file: string;
  /** Línea 1-based. 0 si no aplica (recomendaciones globales). */
  line: number;
  title: string;
  description: string;
  suggestion: string;
  /** Snippet relevante (max 200 chars). Truncado para no exponer secrets. */
  code_snippet: string;
}

export interface ScanResult {
  items: AuditItem[];
  duration_ms: number;
}

/**
 * Resumen agregado por severidad — lo que Git 1 espera en `summary`.
 */
export interface AuditSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  source: "extras" | "main";
  generated_at: string;
}

export function emptyResult(): ScanResult {
  return { items: [], duration_ms: 0 };
}

export function summarize(items: AuditItem[], source: "extras" | "main" = "extras"): AuditSummary {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const it of items) counts[it.severity]++;
  return { ...counts, total: items.length, source, generated_at: new Date().toISOString() };
}

/**
 * Trunca un snippet de código para no filtrar secretos largos en el reporte.
 * Si detecta patrón típico de token/JWT/key, lo reemplaza por `[REDACTED]`.
 */
const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /sk_(live|test)_[A-Za-z0-9]{20,}/g,                   // Stripe secret
  /pk_(live|test)_[A-Za-z0-9]{20,}/g,                   // Stripe public (no critical, igual truncamos)
  /SUPABASE_SERVICE_ROLE_KEY[^\n]{0,200}/g,             // si alguien dejó comentado el valor
];

export function safeSnippet(raw: string, maxLen = 200): string {
  let out = raw;
  for (const pat of SECRET_PATTERNS) out = out.replace(pat, "[REDACTED]");
  if (out.length > maxLen) out = out.slice(0, maxLen) + "…";
  return out;
}
