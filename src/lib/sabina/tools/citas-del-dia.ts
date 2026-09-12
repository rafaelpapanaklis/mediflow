/**
 * `citas_del_dia` — la agenda de una fecha, tal como la enseña /dashboard/agenda.
 *
 * Dos decisiones que la hacen coincidir con la pantalla, y que si se cambian
 * dejan de coincidir:
 *
 *  1. La ventana es el DÍA NATURAL de la clínica (`ventanaDelDia` →
 *     `calendarDayRangeUtc`), no el horario de atención. Leer con
 *     `[agendaDayStart, agendaDayEnd)` borraba de la agenda la urgencia de las
 *     07:30 y la de las 23:30 aunque el contador sí las contara — hallazgos 40
 *     y 32 del repo, y el comentario que lo explica está en
 *     `fetchAppointmentsForDay`.
 *  2. El scope sale de `buildAppointmentWhere(ctx)`: a un DOCTOR se le dan SUS
 *     citas, que es exactamente lo que le pinta la agenda (`doctorIdScope` en
 *     src/app/dashboard/agenda/page.tsx). Si Sabina le contestara con las de
 *     toda la clínica, le estaría enseñando la agenda de sus compañeros.
 */

import { z } from "zod";
import { buildAppointmentWhere } from "@/lib/auth-context";
import { canSeePatient } from "@/lib/patient-visibility";
import {
  comoAuthContext,
  dbDe,
  definirHerramienta,
  plural,
  recortar,
  visorDe,
  type Lista,
} from "./base";
import { esquemaFecha, hoyEnClinica, horaDe, ventanaDelDia } from "./fechas";
import { ESTADOS_ACTIVOS, etiquetaEstado } from "./estados";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  /** Día de calendario de la clínica. Sin fecha, hoy. */
  fecha: esquemaFecha.optional(),
});

export type ParamsCitasDelDia = z.infer<typeof parametros>;

export interface CitaFila {
  /** `HH:mm`–`HH:mm` en la zona de la clínica. */
  hora: string;
  minutos: number;
  /** Nombre del paciente, o "Paciente privado" si quien pregunta no puede verlo. */
  paciente: string;
  doctor: string;
  estado: string;
  /** Motivo/tipo de la cita tal como lo escribió el equipo. */
  motivo: string | null;
}

export interface DatosCitasDelDia {
  fecha: string;
  /** "clinica" = todas las citas del día; "propio" = solo las de quien pregunta (rol DOCTOR). */
  alcance: "clinica" | "propio";
  /** Todas las citas del día, canceladas incluidas. */
  citas: Lista<CitaFila>;
  /** Sin canceladas ni no-asistidas: el número del contador "CITAS HOY". */
  activas: number;
  canceladas: number;
  noAsistieron: number;
  /** Conteo por estado, con las etiquetas en español. */
  porEstado: Record<string, number>;
  /** La siguiente cita activa del día que aún no ha empezado, si la hay. */
  proxima: CitaFila | null;
}

export const citasDelDia = definirHerramienta<ParamsCitasDelDia, DatosCitasDelDia>({
  nombre: "citas_del_dia",
  descripcion:
    "Las citas de un día concreto (por defecto hoy) con su hora, paciente, doctor y estado, " +
    "más el conteo de activas, canceladas y no asistidas. Úsala para «¿cuántas citas tengo hoy?», " +
    "«¿quién viene mañana?», «¿cómo está la agenda del viernes?» o para saber la próxima cita del día. " +
    "Para varios días o para medir qué tan llena está la agenda usa agenda_ocupacion; " +
    "para contar ausencias en un periodo usa ausencias.",
  parametros,
  permiso: "agenda.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosCitasDelDia> {
    const db = dbDe(ctx);
    const fecha = params.fecha ?? hoyEnClinica(ctx.timezone);
    const { desde, hasta } = ventanaDelDia(fecha, ctx.timezone);
    const visor = visorDe(ctx);

    // clinicId (y el scope del rol DOCTOR) SIEMPRE desde la sesión.
    const where = buildAppointmentWhere(comoAuthContext(ctx), {
      startsAt: { gte: desde, lt: hasta },
    });

    const ahora = new Date();
    // La próxima cita se pide APARTE, y no se busca dentro de la página.
    // Con más de 51 citas en el día, la siguiente puede estar en la fila 55 y
    // desde la página se contestaría «no te queda ninguna» — y «¿cuál es mi
    // próxima cita?» es de las preguntas que más se hacen.
    const desdeAhora = ahora.getTime() > desde.getTime() ? ahora : desde;

    const [porStatus, filas, proximas] = await Promise.all([
      // 🔴 Los conteos salen de un groupBy, NO de las filas leídas. Contarlos
      // sobre la página (51 como mucho) haría que un día de 60 citas dijera
      // «tienes 51»: un número plausible y falso, que es la peor clase.
      db.appointment.groupBy({ by: ["status"], where, _count: { _all: true } }),
      db.appointment.findMany({
        where,
        orderBy: { startsAt: "asc" },
        // 51 para poder distinguir "hay justo 50" de "hay más de 50"; el recorte
        // a 50 lo hace `recortar`.
        take: 51,
        select: {
          startsAt: true,
          endsAt: true,
          status: true,
          type: true,
          // Nada de `notes`: el contrato prohíbe datos clínicos en un listado.
          patient: { select: { firstName: true, lastName: true, visibleUserIds: true } },
          doctor: { select: { firstName: true, lastName: true } },
        },
      }),
      db.appointment.findMany({
        where: {
          ...where,
          status: { notIn: [...ESTADOS_ACTIVOS] },
          startsAt: { gte: desdeAhora, lt: hasta },
        },
        orderBy: { startsAt: "asc" },
        take: 1,
        select: {
          startsAt: true,
          endsAt: true,
          status: true,
          type: true,
          patient: { select: { firstName: true, lastName: true, visibleUserIds: true } },
          doctor: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    const citas: CitaFila[] = filas.map((a) => aFila(a, ctx, visor));

    const porEstado: Record<string, number> = {};
    let total = 0;
    let activas = 0;
    let canceladas = 0;
    let noAsistieron = 0;
    for (const g of porStatus as Array<{ status: string; _count: { _all: number } }>) {
      const n = g._count?._all ?? 0;
      total += n;
      porEstado[etiquetaEstado(g.status)] = n;
      if (g.status === "CANCELLED") canceladas = n;
      else if (g.status === "NO_SHOW") noAsistieron = n;
      else activas += n;
    }

    return {
      fecha,
      alcance: ctx.role === "DOCTOR" ? "propio" : "clinica",
      citas: recortar(citas, total),
      activas,
      canceladas,
      noAsistieron,
      porEstado,
      proxima: proximas[0] ? aFila(proximas[0], ctx, visor) : null,
    };
  },

  vacio: (d) => d.citas.total === 0,

  resumir(d) {
    const de = d.alcance === "propio" ? "tuyas" : "de la clínica";
    const partes = [`${plural(d.activas, "cita activa", "citas activas")} ${de} el ${d.fecha}`];
    if (d.canceladas > 0) partes.push(`${d.canceladas} cancelada${d.canceladas === 1 ? "" : "s"}`);
    if (d.noAsistieron > 0) partes.push(`${d.noAsistieron} sin asistir`);
    if (d.proxima) partes.push(`la próxima a las ${d.proxima.hora.split("–")[0]} con ${d.proxima.paciente}`);
    return `${partes.join("; ")}.`;
  },
});

function aFila(a: any, ctx: SabinaCtx, visor: ReturnType<typeof visorDe>): CitaFila {
  const inicio = new Date(a.startsAt);
  const fin = a.endsAt ? new Date(a.endsAt) : null;
  // Enmascarado, no ocultado: el hueco de la agenda existe igual y hay que
  // respetarlo; lo que no viaja es QUIÉN es. Mismo criterio que `maskedPatient`
  // de @/lib/agenda/server.
  const visible = canSeePatient(visor, a.patient?.visibleUserIds);
  return {
    hora: fin ? `${horaDe(inicio, ctx.timezone)}–${horaDe(fin, ctx.timezone)}` : horaDe(inicio, ctx.timezone),
    minutos: fin ? Math.max(0, Math.round((fin.getTime() - inicio.getTime()) / 60000)) : 0,
    paciente: visible ? nombre(a.patient) : "Paciente privado",
    doctor: nombre(a.doctor) || "sin doctor",
    estado: etiquetaEstado(a.status),
    motivo: a.type ?? null,
  };
}

function nombre(p: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  return [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();
}
