// ─────────────────────────────────────────────────────────────────────────
// «Cambiar método de pago» de un ticket ya cobrado (lógica L2, ronda 2,
// decisión del gerente sobre D2). Parte PURA: reglas y bitácora.
//
//   · Solo mientras el turno del ticket siga ABIERTO. Después del corte, lo
//     único que hay es cancelar (como siempre): el corte ya se contó.
//   · Solo entre los métodos del mostrador (Efectivo, Tarjeta, SPEI). Un cobro
//     en línea (STRIPE) no se toca, ni se puede «convertir» en uno.
//   · Bitácora (quién, cuándo, de qué a qué): una línea interna al FINAL de
//     `notes`, como la marca de cancelación (que va al principio). Nunca se le
//     enseña a nadie como nota: stripSaleTag la quita junto con el sello #dcb.
//     El corte por método NO se guarda: se calcula de `paymentMethod` de cada
//     ticket, así que cambiarlo ya lo recalcula (esperado en efectivo incluido).
// ─────────────────────────────────────────────────────────────────────────
import type { BarberPaymentMethod } from "@/lib/barber/types";

export const METHOD_CHANGE_PREFIX = "#dcm ";

/** Métodos que se pueden elegir al corregir (los del mostrador). */
export const COUNTER_METHODS: readonly BarberPaymentMethod[] = ["CASH", "CARD", "SPEI"];

export interface MethodChange {
  /** ISO del cambio. */
  at: string;
  /** Nombre de quien lo cambió. */
  by: string;
  from: BarberPaymentMethod;
  to: BarberPaymentMethod;
}

const ALL: readonly string[] = ["CASH", "CARD", "SPEI", "STRIPE"];

export function buildMethodChangeLine(c: MethodChange): string {
  // Orden de llaves fijo: la línea se lee igual en cualquier lado.
  return `${METHOD_CHANGE_PREFIX}${JSON.stringify({ at: c.at, by: c.by, from: c.from, to: c.to })}`;
}

/** Cambios de método del ticket, en el orden en que se hicieron. */
export function parseMethodChanges(notes: string | null | undefined): MethodChange[] {
  if (typeof notes !== "string" || notes.indexOf(METHOD_CHANGE_PREFIX) < 0) return [];
  const out: MethodChange[] = [];
  for (const line of notes.split("\n")) {
    if (!line.startsWith(METHOD_CHANGE_PREFIX)) continue;
    try {
      const raw = JSON.parse(line.slice(METHOD_CHANGE_PREFIX.length)) as Record<string, unknown>;
      if (typeof raw.at === "string" && typeof raw.by === "string" && ALL.includes(String(raw.from)) && ALL.includes(String(raw.to))) {
        out.push({ at: raw.at, by: raw.by, from: raw.from as BarberPaymentMethod, to: raw.to as BarberPaymentMethod });
      }
    } catch {
      /* línea dañada: se ignora */
    }
  }
  return out;
}

/** Las notas con la bitácora de método añadida al final. */
export function appendMethodChange(notes: string | null | undefined, c: MethodChange): string {
  const line = buildMethodChangeLine(c);
  return typeof notes === "string" && notes.length > 0 ? `${notes}\n${line}` : line;
}

export type MethodChangeError =
  | "INVALID_METHOD"
  | "SAME_METHOD"
  | "ALREADY_CANCELLED"
  | "NO_SESSION"
  | "SESSION_CLOSED"
  | "ONLINE_PAYMENT";

/** ¿Se puede pasar este ticket a `next`? null = sí; si no, el motivo. */
export function methodChangeBlocker(args: {
  current: BarberPaymentMethod;
  next: unknown;
  cancelled: boolean;
  /** El ticket pertenece a un turno (los cobros en línea pueden no tenerlo). */
  hasSession: boolean;
  sessionClosed: boolean;
}): MethodChangeError | null {
  if (typeof args.next !== "string" || !COUNTER_METHODS.includes(args.next as BarberPaymentMethod)) return "INVALID_METHOD";
  if (args.cancelled) return "ALREADY_CANCELLED";
  if (args.current === "STRIPE") return "ONLINE_PAYMENT";
  if (!args.hasSession) return "NO_SESSION";
  if (args.sessionClosed) return "SESSION_CLOSED";
  if (args.next === args.current) return "SAME_METHOD";
  return null;
}

/** Texto del error para la API (español, como el resto de la caja). */
export const METHOD_CHANGE_MESSAGES: Record<MethodChangeError, { status: number; message: string }> = {
  INVALID_METHOD: { status: 400, message: "Elige Efectivo, Tarjeta o Transferencia (SPEI)." },
  SAME_METHOD: { status: 409, message: "El ticket ya está con ese método." },
  ALREADY_CANCELLED: { status: 409, message: "Ese ticket está cancelado." },
  NO_SESSION: { status: 409, message: "Ese ticket no pertenece a un turno de Caja." },
  SESSION_CLOSED: { status: 409, message: "El turno de ese ticket ya se cerró: después del corte solo se puede cancelar." },
  ONLINE_PAYMENT: { status: 409, message: "Ese ticket se pagó en línea; su método no se cambia." },
};
