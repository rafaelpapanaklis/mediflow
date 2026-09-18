/**
 * `cumpleanos` — quién cumple años en un rango de días (por defecto, los
 * próximos siete).
 *
 * ── DE DÓNDE VIENE ─────────────────────────────────────────────────────
 * Sustituye a la chip «Cumple esta semana» de /dashboard/patients, que se
 * quitó de la lista (ws1-t5). El criterio es el mismo que tenía esa chip
 * (`isBirthdayThisWeek` en src/app/api/patients/route.ts): el mes y el día de
 * `dob`, sin mirar el año, caen dentro de la ventana. Con dos mejoras que la
 * chip no tenía: se puede pedir CUALQUIER rango («este mes», «la semana que
 * viene») y devuelve la edad que cumple y el teléfono, que es lo que hace falta
 * para felicitar.
 *
 * ── EL DÍA Y EL MES SE LEEN EN UTC, Y NO ES UN DESCUIDO ────────────────
 * `dob` se guarda como el instante `Date.UTC(año, mes, día)` (ver
 * `patient-create-core.ts`): la medianoche UTC del día que escribió recepción.
 * Leerlo con `getMonth()`/`getDate()` en un proceso con otra zona correría el
 * cumpleaños un día; con `getUTC*` sale el día que se capturó, siempre.
 *
 * ── 29 DE FEBRERO ──────────────────────────────────────────────────────
 * En un año no bisiesto se felicita el 28: es lo que hace cualquier registro
 * civil, y la alternativa —saltarse al paciente tres años de cada cuatro— es
 * la que no se puede defender.
 *
 * ── EL SCOPE SALE DE `buildPatientWhere` ───────────────────────────────
 * El clinicId de la sesión, la visibilidad por paciente y el `deletedAt: null`
 * de ARCO. Sin filtro de estado, igual que la chip con «Todos» puesto: un
 * inactivo que cumple años es una razón para llamarlo. El estado viaja en la
 * fila para que Sabina lo pueda decir.
 */

import { z } from "zod";
import { buildPatientWhere } from "@/lib/auth-context";
import {
  comoAuthContext,
  dbDe,
  definirHerramienta,
  fraseRecorte,
  lineasDeLista,
  plural,
  recortar,
  type Lista,
} from "./base";
import { MAX_DIAS_RANGO, diasDelRango, esquemaFecha, hoyEnClinica, sumarDias } from "./fechas";
import type { SabinaCtx } from "../tipos";

/** Mismo orden de magnitud que el post-fetch de /api/patients. */
const TOPE_CANDIDATOS = 5000;

const parametros = z.object({
  /** Primer día del rango, inclusivo. Sin él, hoy (en la clínica). */
  desde: esquemaFecha.optional(),
  /** Último día del rango, inclusivo. Sin él, `desde` + 6 días: una semana. */
  hasta: esquemaFecha.optional(),
});

export type ParamsCumpleanos = z.infer<typeof parametros>;

export interface CumpleFila {
  paciente: string;
  folio: string | null;
  telefono: string | null;
  /** El día que cumple, `YYYY-MM-DD`, dentro del rango pedido. */
  fecha: string;
  /** La edad que cumple ese día. */
  cumple: number;
  /** ACTIVE | INACTIVE | ARCHIVED, tal cual en la ficha. */
  estado: string;
}

export interface DatosCumpleanos {
  desde: string;
  hasta: string;
  /** Hoy en la clínica, para que el resumen pueda decir «hoy». */
  hoy: string;
  cumpleanos: Lista<CumpleFila>;
  /** `true` si la población de candidatos tocó el tope y el total es un mínimo. */
  totalAproximado: boolean;
}

export const cumpleanos = definirHerramienta<ParamsCumpleanos, DatosCumpleanos>({
  nombre: "cumpleanos",
  descripcion:
    "Los pacientes que cumplen años en un rango de fechas (por defecto los próximos 7 días), con el día " +
    "exacto, la edad que cumplen y su teléfono, ordenados por fecha. Úsala para «¿quién cumple años esta " +
    "semana?», «¿quién cumple este mes?», «¿a quién felicito hoy?» o para armar los mensajes de " +
    "cumpleaños. Para «este mes» pasa desde el día 1 hasta el último día del mes.",
  parametros,
  permiso: "patients.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosCumpleanos> {
    const db = dbDe(ctx);
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

    // Solo quien tiene fecha de nacimiento capturada puede cumplir años aquí.
    const where = buildPatientWhere(comoAuthContext(ctx), { dob: { not: null } });
    const candidatos = await db.patient.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: TOPE_CANDIDATOS + 1,
      select: {
        firstName: true,
        lastName: true,
        patientNumber: true,
        phone: true,
        dob: true,
        status: true,
      },
    });

    const tocoTope = candidatos.length > TOPE_CANDIDATOS;
    const anioDesde = anioDe(desde);
    const anioHasta = anioDe(hasta);

    const filas: CumpleFila[] = [];
    for (const p of (candidatos as any[]).slice(0, TOPE_CANDIDATOS)) {
      const dob = p.dob ? new Date(p.dob) : null;
      if (!dob || isNaN(dob.getTime())) continue;
      const mes = dob.getUTCMonth() + 1;
      const dia = dob.getUTCDate();
      // Un rango puede cruzar el fin de año («del 28 de diciembre al 3 de
      // enero»): se prueba el cumpleaños en cada año que toca la ventana.
      for (let anio = anioDesde; anio <= anioHasta; anio++) {
        const fecha = fechaDelCumple(anio, mes, dia);
        if (fecha < desde || fecha > hasta) continue;
        filas.push({
          paciente: [p.firstName, p.lastName].filter(Boolean).join(" ").trim(),
          folio: p.patientNumber ?? null,
          telefono: p.phone ?? null,
          fecha,
          cumple: anio - dob.getUTCFullYear(),
          estado: p.status ?? "ACTIVE",
        });
      }
    }
    filas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.paciente.localeCompare(b.paciente)));

    return {
      desde,
      hasta,
      hoy,
      cumpleanos: recortar(filas, filas.length),
      totalAproximado: tocoTope,
    };
  },

  vacio: (d) => d.cumpleanos.total === 0,

  resumir(d) {
    const aprox = d.totalAproximado ? "al menos " : "";
    const rango = d.desde === d.hasta ? `el ${d.desde}` : `entre ${d.desde} y ${d.hasta}`;
    const primero = d.cumpleanos.filas[0];
    const linea = (f: CumpleFila) =>
      `${f.paciente} — ${f.fecha === d.hoy ? "HOY" : f.fecha}, cumple ${f.cumple}` +
      `${f.telefono ? ` (tel. ${f.telefono})` : ""}${f.estado !== "ACTIVE" ? ` [${etiquetaEstadoPaciente(f.estado)}]` : ""}`;
    const lista = lineasDeLista(d.cumpleanos.filas, linea);
    const cola = lista ? " Por fecha:" : primero ? ` Es ${linea(primero)}.` : "";
    return (
      `${aprox}${plural(d.cumpleanos.total, "paciente cumple años", "pacientes cumplen años")} ${rango}` +
      `${fraseRecorte(d.cumpleanos, "pacientes")}.${cola}${lista}`
    );
  },
});

function anioDe(fechaISO: string): number {
  return parseInt(fechaISO.slice(0, 4), 10);
}

/** `YYYY-MM-DD` del cumpleaños en ese año; el 29 de febrero cae al 28 si no es bisiesto. */
function fechaDelCumple(anio: number, mes: number, dia: number): string {
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate(); // día 0 del mes siguiente = último de este
  const d = Math.min(dia, ultimo);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Estado de la FICHA del paciente (no de una cita), en español. */
export function etiquetaEstadoPaciente(status: string): string {
  if (status === "INACTIVE") return "inactivo";
  if (status === "ARCHIVED") return "archivado";
  if (status === "ACTIVE") return "activo";
  return status.toLowerCase();
}
