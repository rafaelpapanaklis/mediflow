// Helpers + tipos del chat in-app del portal del paciente (WS2-T2).
//
// Reusa el Inbox de la clínica (modelos InboxThread/InboxMessage) con un canal
// nuevo PORTAL: una conversación por (clínica, paciente), SIN entrega externa
// (la "entrega" es la propia DB; el paciente la lee por polling).
//
// Tenancy: la ÚNICA fuente de verdad es ctx.links (pares {patientId, clinicId})
// del guard del portal. JAMÁS se confía en clinicId/patientId del cliente.
//
// Este archivo NO importa nada de servidor (ni next/server ni el cliente de
// prisma): solo lógica pura + tipos. Así el componente cliente puede importar
// los tipos con `import type` sin arrastrar código de servidor al bundle.

/** Canal del chat in-app. Debe existir en el enum InboxChannel (ver sql/). */
export const PORTAL_CHANNEL = "PORTAL" as const;

/** Asunto por defecto de un hilo PORTAL recién creado. */
export const PORTAL_DEFAULT_SUBJECT = "Mensajes con tu clínica";

/** Vínculo cuenta ↔ expediente (subset de PatientPortalContext.links). */
export type PortalLink = { patientId: string; clinicId: string };

// ── DTOs paciente-safe (servidor → cliente) ─────────────────────────────────

export interface PortalAttachment {
  name: string;
  url: string;
  mime: string;
  size: number;
}

export interface PortalMessageDTO {
  id: string;
  /** IN = del paciente (derecha); OUT = de la clínica (izquierda). */
  direction: "IN" | "OUT";
  body: string;
  attachments: PortalAttachment[];
  sentAt: string; // ISO
}

export interface PortalThreadDTO {
  threadId: string;
  clinicId: string;
  clinicName: string;
  subject: string;
  lastMessageAt: string; // ISO
  /** Dirección del último mensaje visible (para el indicador "nuevo"). */
  lastDirection: "IN" | "OUT" | null;
  /** Vista previa del último mensaje visible (recortada, segura). */
  preview: string | null;
}

export interface PortalClinicRef {
  clinicId: string;
  clinicName: string;
}

export interface PortalThreadsResponse {
  /** Clínicas vinculadas a la cuenta (para iniciar conversación nueva). */
  clinics: PortalClinicRef[];
  /** Hilos PORTAL existentes del paciente, desc por lastMessageAt. */
  threads: PortalThreadDTO[];
}

export interface PortalMessagesResponse {
  messages: PortalMessageDTO[];
  /** Cursor del servidor para el polling de /since (evita clock skew). */
  serverTime: string;
}

export interface PortalSinceResponse {
  serverTime: string;
  threads: PortalThreadDTO[];
  messages: PortalMessageDTO[];
}

export interface PortalStartResponse {
  threadId: string;
}

export interface PortalSendResponse {
  message: PortalMessageDTO;
}

// ── Lógica de tenancy ────────────────────────────────────────────────────────

/**
 * Pares únicos {clinicId, patientId} de los links. Se usan como OR en Prisma:
 * cada par exige clinicId Y patientId del MISMO link → un hilo solo cuenta si su
 * (clinicId, patientId) coincide con un vínculo real de la cuenta.
 */
export function portalLinkPairs(links: PortalLink[]): { clinicId: string; patientId: string }[] {
  const seen = new Set<string>();
  const out: { clinicId: string; patientId: string }[] = [];
  for (const l of links) {
    if (!l?.clinicId || !l?.patientId) continue;
    const key = `${l.clinicId}::${l.patientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ clinicId: l.clinicId, patientId: l.patientId });
  }
  return out;
}

/**
 * ¿La cuenta es dueña del hilo? Exige que (clinicId, patientId) salgan del MISMO
 * link. Un hilo sin patientId nunca pertenece al paciente.
 */
export function portalOwnsThread(
  links: PortalLink[],
  thread: { clinicId: string; patientId: string | null },
): boolean {
  if (!thread.patientId) return false;
  return links.some((l) => l.clinicId === thread.clinicId && l.patientId === thread.patientId);
}

/** patientId vinculado a esa clínica para la cuenta, o null si no hay vínculo. */
export function portalPatientIdForClinic(links: PortalLink[], clinicId: string): string | null {
  const link = links.find((l) => l.clinicId === clinicId);
  return link?.patientId ?? null;
}

// ── Shaping seguro ───────────────────────────────────────────────────────────

/** Whitelist de adjuntos: solo {name,url,mime,size} y solo urls http(s). */
export function portalSanitizeAttachments(raw: unknown): PortalAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: PortalAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const url = typeof a.url === "string" ? a.url : "";
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      name: typeof a.name === "string" && a.name.trim() ? a.name : "Adjunto",
      url,
      mime: typeof a.mime === "string" ? a.mime : "application/octet-stream",
      size: typeof a.size === "number" && Number.isFinite(a.size) && a.size >= 0 ? a.size : 0,
    });
  }
  return out;
}

/** Recorta el cuerpo a una vista previa de una línea. */
export function portalPreview(body: string, max = 90): string {
  const s = (body || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Fila de InboxMessage → DTO paciente-safe. NUNCA expone isInternal, sentById ni
 * externalId. `direction` se normaliza a "IN" | "OUT".
 */
export function portalMessageToDTO(m: {
  id: string;
  direction: string;
  body: string;
  attachments: unknown;
  sentAt: Date;
}): PortalMessageDTO {
  return {
    id: m.id,
    direction: m.direction === "IN" ? "IN" : "OUT",
    body: m.body,
    attachments: portalSanitizeAttachments(m.attachments),
    sentAt: m.sentAt.toISOString(),
  };
}
