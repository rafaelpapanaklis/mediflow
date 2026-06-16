// ═══════════════════════════════════════════════════════════════════
// Contrato TS del módulo Marketing (WS-MKT-T1 foundation).
// Fuente de verdad: prompts/marketing/_ORQUESTA_PLAN.md §3.
// Lo consumen todas las terminales (T2–T6). No editar fuera de foundation.
// ═══════════════════════════════════════════════════════════════════

export type Channel = "FACEBOOK" | "INSTAGRAM" | "BOTH";
export type PostStatus = "DRAFT" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED";
export type Provider = "FACEBOOK" | "INSTAGRAM";

// Estudio IA
export type StudioMode = "ideas" | "caption" | "calendar" | "hashtags" | "image_brief";
export interface StudioRequest {
  mode: StudioMode;
  topic?: string;
  tone?: string;
  channel?: Channel;
  count?: number;
}
export interface StudioResult {
  mode: StudioMode;
  items: string[];
  raw?: string;
  tokensUsed?: number;
}

// Publicación (lo implementa T4 en meta.ts; T1 deja stub que lanza "NOT_IMPLEMENTED")
export interface PublishInput {
  caption: string;
  mediaUrls: string[];
  channel: Channel;
}
export interface PublishResult {
  facebook?: string;
  instagram?: string;
}
