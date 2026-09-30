// ═══════════════════════════════════════════════════════════════════════════
// Soporte — editar / retirar / adjuntar a una respuesta YA enviada.
// Reglas puras (sin prisma, sin React): las comparten el service, el test y la
// pantalla /admin/soporte/[id].
//
// Principio: el aviso a la clínica ya salió con el texto original, así que
// NADA se borra en silencio.
//   · editar  → el mensaje queda con «(editado)» y la fecha del último cambio
//   · retirar → en su lugar queda «Respuesta retirada por soporte»; el texto y
//               los archivos originales se conservan en support_message_revisions
//   · adjuntar a una respuesta enviada cuenta como editarla
// Solo mensajes de SOPORTE (authorType = "support"): los de la clínica y los
// del sistema no se tocan desde aquí.
// ═══════════════════════════════════════════════════════════════════════════

import {
  SUPPORT_MAX_BODY_CHARS,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  SupportError,
  type SupportAttachment,
} from "./types";
import { sanitizeSupportText } from "./texto";

/** Lo que la clínica (y soporte) lee en lugar de una respuesta retirada. */
export const SUPPORT_RETRACTED_TEXT = "Respuesta retirada por soporte";
/** Igual, para una nota interna (la clínica nunca la vio; solo lo ve soporte). */
export const SUPPORT_RETRACTED_NOTE_TEXT = "Nota interna retirada por soporte";

export type SupportRevisionKind = "edit" | "attach" | "retract";

export function retractedText(internalNote: boolean): string {
  return internalNote ? SUPPORT_RETRACTED_NOTE_TEXT : SUPPORT_RETRACTED_TEXT;
}

// ── Estado visible de un mensaje, deducido de sus revisiones ────────────────

export interface RevisionLite {
  messageId: string;
  kind: string;
  createdAt: Date;
}

export interface EstadoEdicion {
  /** Fecha del último «edit» o «attach»; null si nunca se tocó. */
  editedAt: Date | null;
  /** Fecha en que se retiró; null si sigue vigente. */
  retractedAt: Date | null;
}

const SIN_CAMBIOS: EstadoEdicion = { editedAt: null, retractedAt: null };

/** Un mapa messageId → estado. Los mensajes sin revisiones no aparecen. */
export function estadosDeEdicion(revisiones: RevisionLite[]): Map<string, EstadoEdicion> {
  const mapa = new Map<string, EstadoEdicion>();
  for (const r of revisiones) {
    const actual = mapa.get(r.messageId) ?? { ...SIN_CAMBIOS };
    if (r.kind === "retract") {
      if (!actual.retractedAt || r.createdAt > actual.retractedAt) actual.retractedAt = r.createdAt;
    } else if (r.kind === "edit" || r.kind === "attach") {
      if (!actual.editedAt || r.createdAt > actual.editedAt) actual.editedAt = r.createdAt;
    }
    mapa.set(r.messageId, actual);
  }
  return mapa;
}

// ── Cómo lo ve quien lee el hilo (clínica y soporte) ────────────────────────

export type CambioVisible =
  | { tipo: "retirada"; fecha: string; texto: string }
  | { tipo: "editada"; fecha: string };

/** Qué etiqueta lleva un mensaje del hilo: retirada (con su aviso), editada (con fecha) o ninguna. */
export function cambioDelMensaje(m: {
  editedAt?: string | null;
  retractedAt?: string | null;
  internalNote?: boolean;
}): CambioVisible | null {
  if (m.retractedAt) {
    return { tipo: "retirada", fecha: m.retractedAt, texto: retractedText(Boolean(m.internalNote)) };
  }
  if (m.editedAt) return { tipo: "editada", fecha: m.editedAt };
  return null;
}

// ── Planes de cambio (validan y dicen QUÉ escribir; no escriben) ─────────────

export interface MensajeParaCambio {
  authorType: string;
  internalNote: boolean;
  body: string;
  attachments: SupportAttachment[];
}

export interface PlanDeEdicion {
  kind: "edit" | "attach";
  body: string;
  attachments: SupportAttachment[];
  /** Cuántos archivos se agregaron. */
  archivosNuevos: number;
}

export interface PlanDeRetiro {
  kind: "retract";
  body: string;
  attachments: SupportAttachment[];
}

function assertEsDeSoporte(m: MensajeParaCambio): void {
  if (m.authorType !== "support") {
    throw new SupportError("Solo se pueden cambiar los mensajes de soporte", 403);
  }
}

function assertVigente(estado: EstadoEdicion | undefined): void {
  if (estado?.retractedAt) {
    throw new SupportError("Esa respuesta ya fue retirada y no se puede modificar", 409);
  }
}

/**
 * Edita el texto y/o agrega archivos. `body` undefined = no tocar el texto.
 * `archivosNuevos` ya viene validado contra el clinicId del ticket (mismo
 * validador que al enviar). Lanza SupportError si no procede.
 */
export function planearEdicion(
  mensaje: MensajeParaCambio,
  estado: EstadoEdicion | undefined,
  input: { body?: unknown; archivosNuevos?: SupportAttachment[] },
): PlanDeEdicion {
  assertEsDeSoporte(mensaje);
  assertVigente(estado);

  const nuevos = input.archivosNuevos ?? [];
  const cambiaTexto = input.body !== undefined;
  const body = cambiaTexto ? sanitizeSupportText(input.body, SUPPORT_MAX_BODY_CHARS) : mensaje.body;
  const textoDistinto = cambiaTexto && body !== mensaje.body;

  if (!textoDistinto && nuevos.length === 0) {
    throw new SupportError("No hay cambios que guardar");
  }
  const adjuntos = [...mensaje.attachments, ...nuevos];
  if (adjuntos.length > SUPPORT_MAX_FILES_PER_MESSAGE) {
    throw new SupportError(`Máximo ${SUPPORT_MAX_FILES_PER_MESSAGE} adjuntos por mensaje`);
  }
  // Igual que al enviar: un mensaje puede ir sin texto solo si lleva archivos.
  if (!body && adjuntos.length === 0) {
    throw new SupportError("El mensaje no puede quedar vacío");
  }
  return {
    kind: textoDistinto ? "edit" : "attach",
    body,
    attachments: adjuntos,
    archivosNuevos: nuevos.length,
  };
}

/** Retira el mensaje: queda el aviso en su lugar y sin archivos. */
export function planearRetiro(
  mensaje: MensajeParaCambio,
  estado: EstadoEdicion | undefined,
): PlanDeRetiro {
  assertEsDeSoporte(mensaje);
  assertVigente(estado);
  return { kind: "retract", body: retractedText(mensaje.internalNote), attachments: [] };
}
