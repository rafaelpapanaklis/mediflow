/**
 * DaleControl INSTITUCIONAL — el aviso del contrato. Módulo PURO
 * (client-safe, sin prisma, sin fechas implícitas del sistema salvo el
 * `now` que se le pasa) para poder probarlo sin base de datos.
 *
 * 🔴 ESTO AVISA, NO CORTA. El contrato del instituto se administra a mano
 * (no pasa por Stripe ni por el gate de plan del dental) y una fecha
 * vencida en una hoja de cálculo no puede dejar a 120 alumnos con
 * pacientes en el sillón sin su panel. Por eso este archivo devuelve un
 * TEXTO y nada más: no hay un redirect ni un 403 que dependa de él, y
 * ninguna ola futura debe cablearle uno.
 *
 * Lo mismo aplica a `isActive`: se avisa, no se echa a nadie. Dar de baja
 * un instituto de verdad es desactivar a sus usuarios (EduUser.isActive),
 * que es lo que sí mira getEduContext.
 */
import type { EduRole } from "@/lib/edu/types";

export type EduContractLevel = "inactive" | "expired" | "ending-soon" | "not-started";

export interface EduContractNotice {
  level: EduContractLevel;
  /** Titular corto del banner. */
  title: string;
  /** Una línea que dice qué pasa y qué NO pasa. */
  detail: string;
  /** Días que faltan (ending-soon) o que sobran (expired). Absoluto. */
  days: number;
}

/** Lo mínimo del instituto que necesita este helper. */
export interface EduContractInput {
  isActive: boolean;
  contractStartsAt: Date | string | null;
  contractEndsAt: Date | string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cuántos días faltan para el contrato antes de empezar a avisar. */
export const EDU_CONTRACT_WARN_DAYS = 30;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Formatea una fecha de CALENDARIO del contrato.
 *
 * 🔴 timeZone "UTC" a propósito. Estas fechas se capturan como día suelto y
 * quedan guardadas a medianoche; pintarlas en America/Tijuana (UTC−7)
 * restaría siete horas y el 31 de diciembre saldría "30 de diciembre".
 * Es el mismo error que ya se pagó en el calendario del dental.
 */
export function formatEduContractDate(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * El aviso a pintar, o null si no hay nada que decir.
 *
 * El contrato vale durante TODO su último día: se considera vencido a
 * partir del día siguiente a contractEndsAt. Redondear al revés haría
 * aparecer el aviso la mañana misma del último día válido.
 */
export function eduContractNotice(
  institution: EduContractInput,
  now: Date = new Date(),
): EduContractNotice | null {
  if (!institution.isActive) {
    return {
      level: "inactive",
      title: "Instituto marcado como inactivo",
      detail:
        "Tu panel sigue funcionando igual. Es una marca administrativa de DaleControl: escríbenos para reactivarlo.",
      days: 0,
    };
  }

  const t = now.getTime();

  const startsAt = toDate(institution.contractStartsAt);
  if (startsAt && startsAt.getTime() > t) {
    return {
      level: "not-started",
      title: `El contrato empieza el ${formatEduContractDate(startsAt)}`,
      detail: "Puedes usar el panel desde hoy; la fecha de inicio es solo administrativa.",
      days: Math.ceil((startsAt.getTime() - t) / DAY_MS),
    };
  }

  const endsAt = toDate(institution.contractEndsAt);
  if (!endsAt) return null;

  // Fin del último día válido.
  const validUntil = endsAt.getTime() + DAY_MS;
  if (validUntil <= t) {
    return {
      level: "expired",
      title: `El contrato venció el ${formatEduContractDate(endsAt)}`,
      detail:
        "Nadie se queda fuera: el panel sigue abierto y tus datos intactos. Ponte en contacto con DaleControl para renovarlo.",
      days: Math.floor((t - validUntil) / DAY_MS) + 1,
    };
  }

  const daysLeft = Math.ceil((validUntil - t) / DAY_MS);
  if (daysLeft <= EDU_CONTRACT_WARN_DAYS) {
    return {
      level: "ending-soon",
      title:
        daysLeft <= 1
          ? "El contrato vence hoy"
          : `El contrato vence en ${daysLeft} días (${formatEduContractDate(endsAt)})`,
      detail: "Aunque venza, el panel no se cierra. Avísanos para renovarlo con tiempo.",
      days: daysLeft,
    };
  }

  return null;
}

/**
 * Quién ve el aviso. Un alumno no puede hacer nada con el contrato de su
 * escuela y sí puede asustarse: el banner es para quien lo administra.
 */
export function eduContractNoticeIsFor(role: EduRole): boolean {
  return role === "DIRECCION";
}
