/**
 * La lista de PENDIENTES del Dashboard — módulo PURO.
 *
 * Junta en una sola lista, ordenada por gravedad, las dos fuentes de «esto
 * exige una acción»:
 *  · las señales de negocio de `atencion-core` (cobro fallido, usando sin
 *    plan, trial por vencer, apagada, nadie entra, sin estado), que salen de
 *    `evaluarSaludClinica`, el mismo cálculo que Clínicas y Clientes;
 *  · las señales de cupo y cobro de `@/lib/admin/uso-core` (pago por
 *    verificar, renovación manual, almacenamiento, tokens, CFDI, usuarios,
 *    saldo IA).
 * No decide nada nuevo: agrupa, ordena y cuenta para las cuatro tarjetas.
 */
import type { Portada, MotivoAtencion, SeveridadAtencion } from "./atencion-core";
import type { SenalCupo, MotivoCupo } from "@/lib/admin/uso-core";

export type Severidad = SeveridadAtencion;
export type MotivoPendiente = MotivoAtencion | MotivoCupo;

export interface Pendiente {
  clave: string;
  severidad: Severidad;
  clinicaId: string;
  clinicaNombre: string;
  motivo: MotivoPendiente;
  /** Rótulo del chip (dos o tres palabras). */
  titulo: string;
  /** La cifra o el porqué, corto. */
  dato: string;
  monto: number;
  /** Cuántas cosas son (pagos por verificar); 1 si no aplica. */
  cantidad: number;
  /** A dónde lleva la fila. */
  href: string;
}

export const TITULO_MOTIVO_ATENCION: Record<MotivoAtencion, string> = {
  cobro_fallido: "Cobro fallido",
  usando_sin_plan: "Usa sin plan",
  trial_por_vencer: "Trial vence",
  apagada: "Apagada",
  sin_login: "Nadie entra",
  estado_desconocido: "Sin estado",
};

export type TonoMotivo = "danger" | "warning" | "info" | "brand" | "neutral";

export const TONO_MOTIVO: Record<MotivoPendiente, TonoMotivo> = {
  cobro_fallido: "danger",
  usando_sin_plan: "danger",
  trial_por_vencer: "warning",
  apagada: "warning",
  sin_login: "info",
  estado_desconocido: "neutral",
  "pago-por-verificar": "warning",
  "renovacion-manual": "warning",
  "almacenamiento": "info",
  "tokens": "info",
  "cfdi": "info",
  "usuarios": "info",
  "saldo-ia": "warning",
};

const PESO: Record<Severidad, number> = { critico: 0, alto: 1, medio: 2 };

/** Motivos que significan «esta clínica está cerca de un tope del plan». */
export const MOTIVOS_TOPE: ReadonlySet<MotivoPendiente> = new Set(["almacenamiento", "tokens", "cfdi", "usuarios", "saldo-ia"]);

export interface ConteosTiles {
  /** Pagos registrados a mano que nadie ha verificado: cuántos pagos, de cuántas clínicas, cuánto dinero. */
  porVerificar: { pagos: number; clinicas: number; monto: number };
  /** Cobros fallidos + clínicas usando sin plan vigente (lo crítico). */
  cobrosRotos: number;
  /**
   * Renovaciones que se cobran A MANO (transferencia, SPEI, OXXO, depósito,
   * efectivo, sin método) en ≤ 7 días. Las suscripciones de tarjeta viva en
   * Stripe o PayPal se cobran solas y, si fallan, ya salen en «Cobros
   * fallidos» (ajuste 2 de Rafael). Los trials que vencen tampoco entran: no
   * son una renovación (siguen en la lista como «Trial vence»).
   */
  renovaciones: number;
  /** Clínicas con al menos un cupo cerca del tope o saldo IA en problemas. */
  cercaDelTope: number;
}

export function unirPendientes(portada: Portada, cupos: SenalCupo[]): Pendiente[] {
  const out: Pendiente[] = [];
  for (const g of portada.grupos) {
    for (const s of g.senales) {
      out.push({
        clave: s.clave,
        severidad: s.severidad,
        clinicaId: s.clinicaId,
        clinicaNombre: s.clinicaNombre,
        motivo: s.motivo,
        titulo: TITULO_MOTIVO_ATENCION[s.motivo],
        dato: s.dato ?? s.porQue,
        monto: s.montoEnRiesgo,
        cantidad: 1,
        href: `/admin/clinics/${s.clinicaId}`,
      });
    }
  }
  for (const c of cupos) {
    out.push({
      clave: c.clave,
      severidad: c.severidad,
      clinicaId: c.clinicaId,
      clinicaNombre: c.clinicaNombre,
      motivo: c.motivo,
      titulo: c.titulo,
      dato: c.dato,
      monto: c.monto,
      cantidad: c.cantidad,
      href: c.motivo === "pago-por-verificar" ? "/admin/payments" : `/admin/clinics/${c.clinicaId}`,
    });
  }
  return out.sort((a, b) => {
    if (PESO[a.severidad] !== PESO[b.severidad]) return PESO[a.severidad] - PESO[b.severidad];
    if (a.monto !== b.monto) return b.monto - a.monto;
    return a.clinicaNombre.localeCompare(b.clinicaNombre, "es");
  });
}

/** Los números de las cuatro tarjetas. Cuentan CLÍNICAS, salvo la de pagos, que cuenta pagos. */
export function contarTiles(pendientes: Pendiente[]): ConteosTiles {
  const clinicas = (f: (p: Pendiente) => boolean) => new Set(pendientes.filter(f).map((p) => p.clinicaId)).size;
  const verificar = pendientes.filter((p) => p.motivo === "pago-por-verificar");
  return {
    porVerificar: {
      pagos: verificar.reduce((s, p) => s + p.cantidad, 0),
      clinicas: new Set(verificar.map((p) => p.clinicaId)).size,
      monto: verificar.reduce((s, p) => s + p.monto, 0),
    },
    cobrosRotos: clinicas((p) => p.motivo === "cobro_fallido" || p.motivo === "usando_sin_plan"),
    renovaciones: clinicas((p) => p.motivo === "renovacion-manual"),
    cercaDelTope: clinicas((p) => MOTIVOS_TOPE.has(p.motivo)),
  };
}
