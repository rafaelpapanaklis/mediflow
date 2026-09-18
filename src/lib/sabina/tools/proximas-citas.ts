/**
 * `proximas_citas` — quién tiene cita en los próximos días, un paciente por
 * línea con su cita más cercana.
 *
 * ── DE DÓNDE VIENE ─────────────────────────────────────────────────────
 * Sustituye a la chip «Próxima cita» de /dashboard/patients, que se quitó de la
 * lista (ws1-t5). Esa chip dejaba a los pacientes con `nextAppointment`: su
 * primera cita con `startsAt >= ahora` y `status NOT IN (CANCELLED, NO_SHOW)`,
 * en la sede activa (src/app/api/patients/route.ts). Aquí es el mismo criterio
 * acotado a un rango de días (por defecto, de hoy a dentro de una semana),
 * porque «próximamente» sin fecha no es una pregunta que se pueda contestar
 * con 5 000 filas.
 *
 * `citas_del_dia` contesta por UN día y con todas las citas; ésta contesta por
 * varios días y por PACIENTE: si Ana tiene cita el martes y el jueves, sale una
 * vez, con la del martes. El número de citas total viaja aparte.
 *
 * ── EL SCOPE SALE DE `buildAppointmentWhere` ───────────────────────────
 * Igual que la agenda: a un DOCTOR se le dan SUS citas. Y el nombre del
 * paciente se enmascara con `canSeePatient` —«Paciente privado»—, el mismo
 * criterio que `citas_del_dia` y que `maskedPatient` en @/lib/agenda/server.
 */

import { z } from "zod";
import { buildAppointmentWhere } from "@/lib/auth-context";
import { canSeePatient } from "@/lib/patient-visibility";
import {
  comoAuthContext,
  dbDe,
  definirHerramienta,
  fraseRecorte,
  lineasDeLista,
  plural,
  recortar,
  visorDe,
  type Lista,
} from "./base";
import {
  MAX_DIAS_RANGO,
  diasDelRango,
  esquemaFecha,
  fechaDe,
  horaDe,
  hoyEnClinica,
  sumarDias,
  ventanaDeRango,
} from "./fechas";
import { ESTADOS_ACTIVOS, etiquetaEstado } from "./estados";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  /** Primer día del rango, inclusivo. Sin él, hoy (en la clínica). */
  desde: esquemaFecha.optional(),
  /** Último día del rango, inclusivo. Sin él, `desde` + 6 días: una semana. */
  hasta: esquemaFecha.optional(),
});

export type ParamsProximasCitas = z.infer<typeof parametros>;

export interface ProximaCitaFila {
  paciente: string;
  folio: string | null;
  telefono: string | null;
  /** Día de la cita, en el calendario de la clínica. */
  fecha: string;
  /** `HH:mm` en la zona de la clínica. */
  hora: string;
  doctor: string;
  estado: string;
  motivo: string | null;
}

export interface DatosProximasCitas {
  desde: string;
  hasta: string;
  /** "clinica" = todas las citas; "propio" = solo las de quien pregunta (rol DOCTOR). */
  alcance: "clinica" | "propio";
  /** Un paciente por fila, con su cita más cercana dentro del rango. */
  pacientes: Lista<ProximaCitaFila>;
  /** Cuántas citas activas hay en el rango, contando todas (un paciente puede tener varias). */
  citas: number;
}

export const proximasCitas = definirHerramienta<ParamsProximasCitas, DatosProximasCitas>({
  nombre: "proximas_citas",
  descripcion:
    "Los pacientes que tienen cita agendada en los próximos días (por defecto de hoy a dentro de una " +
    "semana), uno por línea con su cita más cercana: día, hora, doctor, estado y teléfono; más el total " +
    "de citas del rango. Úsala para «¿quién tiene cita próximamente?», «¿quién viene esta semana?» o " +
    "«¿qué pacientes tengo agendados hasta el viernes?». Para la agenda completa de UN día usa " +
    "citas_del_dia; para saber si UNA persona tiene cita usa buscar_paciente.",
  parametros,
  permiso: "agenda.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosProximasCitas> {
    const db = dbDe(ctx);
    const visor = visorDe(ctx);
    const hoy = hoyEnClinica(ctx.timezone);
    const desde = params.desde ?? hoy;
    const hasta = params.hasta ?? sumarDias(desde, 6);
    const dias = diasDelRango(desde, hasta);
    if (dias <= 0) {
      throw new Error(`rango_invalido: "desde" (${desde}) es posterior a "hasta" (${hasta})`);
    }
    if (dias > MAX_DIAS_RANGO) {
      throw new Error(
        `rango_demasiado_grande: ${dias} días (el tope es ${MAX_DIAS_RANGO}); pídelo por trozos más cortos`,
      );
    }

    const ventana = ventanaDeRango(desde, hasta, ctx.timezone);
    const ahora = new Date();
    // «Próxima» empieza ahora, no a las 00:00: la cita de las 9 que ya pasó no
    // es una cita próxima (mismo `startsAt >= ahora` que la chip).
    const inicio = ahora.getTime() > ventana.desde.getTime() ? ahora : ventana.desde;

    // clinicId (y el scope del rol DOCTOR) SIEMPRE desde la sesión.
    const where = buildAppointmentWhere(comoAuthContext(ctx), {
      startsAt: { gte: inicio, lt: ventana.hasta },
      status: { notIn: [...ESTADOS_ACTIVOS] },
    });

    const seleccion = {
      startsAt: true,
      status: true,
      type: true,
      // Nada de `notes`: el contrato prohíbe datos clínicos en un listado.
      patient: {
        select: { firstName: true, lastName: true, patientNumber: true, phone: true, visibleUserIds: true },
      },
      doctor: { select: { firstName: true, lastName: true } },
    };

    const [citas, distintos, filas] = await Promise.all([
      // 🔴 Los conteos salen de la base, no de las filas leídas (que van a 51).
      db.appointment.count({ where }),
      db.appointment.findMany({ where, select: { patientId: true }, distinct: ["patientId"] }),
      // Ordenadas por fecha y una por paciente: la primera de cada uno es su
      // cita más cercana, que es la que se enseña.
      db.appointment.findMany({
        where,
        orderBy: { startsAt: "asc" },
        distinct: ["patientId"],
        take: 51,
        select: seleccion,
      }),
    ]);

    const pacientes: ProximaCitaFila[] = (filas as any[]).map((a) => {
      const inicio = new Date(a.startsAt);
      const visible = canSeePatient(visor, a.patient?.visibleUserIds);
      return {
        paciente: visible ? nombre(a.patient) : "Paciente privado",
        folio: visible ? a.patient?.patientNumber ?? null : null,
        telefono: visible ? a.patient?.phone ?? null : null,
        fecha: fechaDe(inicio, ctx.timezone),
        hora: horaDe(inicio, ctx.timezone),
        doctor: nombre(a.doctor) || "sin doctor",
        estado: etiquetaEstado(a.status),
        motivo: a.type ?? null,
      };
    });

    return {
      desde,
      hasta,
      alcance: ctx.role === "DOCTOR" ? "propio" : "clinica",
      pacientes: recortar(pacientes, distintos.length),
      citas,
    };
  },

  vacio: (d) => d.pacientes.total === 0,

  resumir(d) {
    const de = d.alcance === "propio" ? "contigo" : "en la clínica";
    const rango = d.desde === d.hasta ? `el ${d.desde}` : `entre ${d.desde} y ${d.hasta}`;
    const cab =
      `${plural(d.pacientes.total, "paciente con cita", "pacientes con cita")} ${de} ${rango}` +
      `${d.citas !== d.pacientes.total ? ` (${plural(d.citas, "cita", "citas")} en total)` : ""}`;
    const linea = (c: ProximaCitaFila) => {
      const quien = d.alcance === "propio" ? c.estado : `${c.doctor}, ${c.estado}`;
      return `${c.fecha} ${c.hora} ${c.paciente}${c.motivo ? ` — ${c.motivo}` : ""} (${quien}${c.telefono ? `, tel. ${c.telefono}` : ""})`;
    };
    const lista = lineasDeLista(d.pacientes.filas, linea);
    const primero = d.pacientes.filas[0];
    const cola = lista ? " Del más próximo al más lejano:" : primero ? ` Es ${linea(primero)}.` : "";
    return `${cab}${fraseRecorte(d.pacientes, "pacientes")}.${cola}${lista}`;
  },
});

function nombre(p: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  return [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();
}
