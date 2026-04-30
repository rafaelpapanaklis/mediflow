import "server-only";

export type BugSeverity = "critical" | "high" | "medium" | "low";

export type BugCategory =
  | "auth"
  | "idor"
  | "mass-assignment"
  | "sql-injection"
  | "xss"
  | "secrets"
  | "ssrf"
  | "rate-limit"
  | "headers"
  | "cors"
  | "cookies"
  | "passwords"
  | "tokens"
  | "uploads"
  | "open-redirect"
  | "pii-logging"
  | "audit-log"
  | "fiel"
  | "schema-drift"
  | "rls"
  | "fk-orphans"
  | "deps"
  | "n-plus-one"
  | "no-select"
  | "indexes"
  | "pool"
  | "bundle"
  | "images"
  | "dynamic-imports"
  | "cache"
  | "useeffect-leak"
  | "virtualization"
  | "ts-any"
  | "fire-and-forget"
  | "swallowed-error"
  | "race-condition"
  | "react-hooks"
  | "console-log"
  | "todo"
  | "dead-code"
  | "broken-button"
  | "broken-link"
  | "broken-modal"
  // Extras (originalmente en src/lib/audit/types.ts antes del merge).
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

export interface BugItem {
  category: BugCategory;
  severity: BugSeverity;
  file: string;
  line: number | null;
  title: string;
  description: string;
  suggestion: string;
  /** Snippet del código relevante. Truncado a 240 chars y con secrets enmascarados. */
  code_snippet: string | null;
  /** Hash estable para dedup + dismiss tracking. */
  fingerprint: string;
}

export interface BugSummary {
  total: number;
  bySeverity: Record<BugSeverity, number>;
  byCategory: Partial<Record<BugCategory, number>>;
  /** Score 0..100 — heurística simple basada en pesos por severidad. */
  healthScore: number;
}

export type ScannerSection = "backend" | "security" | "performance" | "quality" | "frontend";

export interface ScannerResult {
  section: ScannerSection;
  items: BugItem[];
  durationMs: number;
}

export interface RunOptions {
  sections?: ScannerSection[];
}

export interface RunResult {
  id: string;
  runAt: string;
  triggeredBy: string;
  durationMs: number;
  status: "completed" | "partial" | "failed";
  summary: BugSummary;
  items: BugItem[];
}
