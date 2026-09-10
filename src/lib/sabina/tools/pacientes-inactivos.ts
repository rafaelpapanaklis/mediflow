/**
 * `pacientes_inactivos` — los que vinieron, no han vuelto y no tienen cita.
 *
 * ── EL CRITERIO ES EL DEL BARRIDO DE REACTIVACIÓN ──────────────────────
 * Copiado, no inventado, de `sweepClinic` en src/lib/recall/sweep.ts, que es lo
 * que la clínica ya usa para decidir a quién escribirle:
 *
 *   · al menos una VISITA CUMPLIDA — `status IN (COMPLETED, CHECKED_OUT)`;
 *     CHECKED_OUT entra porque cierra el ciclo DESPUÉS de COMPLETED, y dejarlo
 *     fuera volvería "inactivo" a quien estuvo la semana pasada;
 *   · su última visita cumplida es anterior al corte (`hoy − dias`);
 *   · y NO tiene ninguna cita futura no cancelada — quien ya está agendado no
 *     es un paciente perdido, es un paciente que vuelve el jueves;
 *   · paciente ACTIVE y no cancelado por ARCO.
 *
 * Ordenados por antigüedad de la última visita: primero el que lleva más tiempo
 * sin venir, que es el orden en el que se llama por teléfono.
 *
 * ── POR QUÉ NO SE USA `records.visitDate` ──────────────────────────────
 * La chip "Sin contacto 6 meses" de /dashboard/patients mira la última nota del
 * EXPEDIENTE. Aquí se mira la última CITA, que es lo que pide el contrato («sin
 * cita desde hace N días») y lo que mide el recall. Son dos poblaciones
 * parecidas y no idénticas: un paciente atendido sin nota firmada sale en una y
 * no en la otra. Queda dicho en el reporte.
 */

import { z } from "zod";
import { buildPatientWhere } from "@/lib/auth-context";
import {
  comoAuthContext,
  dbDe,
  definirHerramienta,
  fraseRecorte,
  plural,
  recortar,
  type Lista,
} from "./base";
import { fechaDe } from "./fechas";
import { ESTADOS_ACTIVOS, ESTADOS_CUMPLIDOS } from "./estados";
import type { SabinaCtx } from "../tipos";

/** Mismo orden de magnitud que el post-fetch de /api/patients. */
const TOPE_CANDIDATOS = 5000;

const parametros = z.object({
  /** Días sin venir a partir de los cuales cuenta como inactivo. Por defecto 180 (6 meses). */
  dias: z.number().int().min(1).max(3650).optional(),
});

export type ParamsInactivos = z.infer<typeof parametros>;

export interface InactivoFila {
  paciente: string;
  folio: string | null;
  telefono: string | null;
  /** Última visita cumplida, en el calendario de la clínica. */
  ultimaVisita: string;
  diasSinVenir: number;
}

export interface DatosInactivos {
  dias: number;
  /** Fecha de corte: última visita anterior a este día cuenta como inactiva. */
  corte: string;
  inactivos: Lista<InactivoFila>;
  /** `true` si la población de candidatos tocó el tope y el total es un mínimo. */
  totalAproximado: boolean;
}

export const pacientesInactivos = definirHerramienta<ParamsInactivos, DatosInactivos>({
  nombre: "pacientes_inactivos",
  descripcion:
    "Los pacientes que ya se atendieron alguna vez, no han vuelto desde hace N días (180 por defecto) " +
    "y NO tienen ninguna cita futura agendada, ordenados del que lleva más tiempo sin venir. Incluye su " +
    "teléfono para poder contactarlos. Úsala para «¿a quién debería llamar?», «¿cuántos pacientes he " +
    "perdido?», «¿quién no vuelve?» o para armar una campaña de reactivación. " +
    "Para las altas recientes usa pacientes_nuevos.",
  parametros,
  permiso: "patients.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosInactivos> {
    const db = dbDe(ctx);
    const dias = params.dias ?? 180;
    const ahora = new Date();
    const corte = new Date(ahora.getTime() - dias * 86_400_000);

    // Paso 1 — la última visita cumplida de cada paciente, y quién tiene cita
    // futura. Las dos consultas van acotadas por el clinicId de la sesión: sin
    // eso, `patientId` de otra clínica entraría en el `in` del paso 3.
    const [ultimas, conFuturas] = await Promise.all([
      db.appointment.groupBy({
        by: ["patientId"],
        where: {
          clinicId: ctx.clinicId,
          status: { in: [...ESTADOS_CUMPLIDOS] },
        },
        _max: { startsAt: true },
      }),
      db.appointment.findMany({
        where: {
          clinicId: ctx.clinicId,
          startsAt: { gte: ahora },
          status: { notIn: [...ESTADOS_ACTIVOS] },
        },
        select: { patientId: true },
        distinct: ["patientId"],
      }),
    ]);

    const agendados: Record<string, true> = {};
    for (const a of conFuturas as any[]) if (a.patientId) agendados[a.patientId] = true;

    const candidatos = (ultimas as any[])
      .map((g) => ({ patientId: g.patientId as string, ultima: g._max?.startsAt ? new Date(g._max.startsAt) : null }))
      .filter((c) => c.patientId && c.ultima && c.ultima < corte && !agendados[c.patientId])
      .sort((a, b) => (a.ultima as Date).getTime() - (b.ultima as Date).getTime());

    const tocóTope = candidatos.length > TOPE_CANDIDATOS;
    const acotados = candidatos.slice(0, TOPE_CANDIDATOS);
    if (acotados.length === 0) {
      return { dias, corte: fechaDe(corte, ctx.timezone), inactivos: recortar([], 0), totalAproximado: false };
    }

    // Paso 2 — los nombres, SIEMPRE por `buildPatientWhere`: trae el clinicId de
    // la sesión, la visibilidad por paciente y el `deletedAt: null` de ARCO. Se
    // piden TODOS los visibles (no solo 50) porque el total honesto es el que
    // queda DESPUÉS de la visibilidad: a un doctor con pacientes restringidos no
    // se le puede decir "tienes 300" y enseñarle 40.
    const pacientes = await db.patient.findMany({
      where: buildPatientWhere(comoAuthContext(ctx), {
        id: { in: acotados.map((c) => c.patientId) },
        status: "ACTIVE",
      }),
      select: { id: true, firstName: true, lastName: true, patientNumber: true, phone: true },
    });

    const porId: Record<string, any> = {};
    for (const p of pacientes as any[]) porId[p.id] = p;

    const filas: InactivoFila[] = [];
    for (const c of acotados) {
      const p = porId[c.patientId];
      if (!p) continue; // no visible para quien pregunta, o no ACTIVE
      const ultima = c.ultima as Date;
      filas.push({
        paciente: [p.firstName, p.lastName].filter(Boolean).join(" ").trim(),
        folio: p.patientNumber ?? null,
        telefono: p.phone ?? null,
        ultimaVisita: fechaDe(ultima, ctx.timezone),
        diasSinVenir: Math.floor((ahora.getTime() - ultima.getTime()) / 86_400_000),
      });
    }

    return {
      dias,
      corte: fechaDe(corte, ctx.timezone),
      inactivos: recortar(filas, filas.length),
      totalAproximado: tocóTope,
    };
  },

  vacio: (d) => d.inactivos.total === 0,

  resumir(d) {
    const aprox = d.totalAproximado ? " al menos" : "";
    const primero = d.inactivos.filas[0];
    const cola = primero
      ? ` El que lleva más tiempo es ${primero.paciente}, ${primero.diasSinVenir} días desde el ${primero.ultimaVisita}.`
      : "";
    return (
      `Hay${aprox} ${plural(d.inactivos.total, "paciente sin volver", "pacientes sin volver")} en ` +
      `${d.dias} días y sin cita agendada${fraseRecorte(d.inactivos, "pacientes")}.${cola}`
    );
  },
});
