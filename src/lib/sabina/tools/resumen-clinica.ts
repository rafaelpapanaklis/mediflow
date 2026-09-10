/**
 * `resumen_clinica` — la foto de hoy, en una sola llamada.
 *
 * ── LA HERRAMIENTA COMPUESTA DEL CONTRATO ──────────────────────────────
 * Llama a las demás y **omite las partes sin permiso DICIÉNDOLO**. Ese "y
 * diciéndolo" es la regla 3 y el motivo entero de que `omitidas` exista:
 *
 *   ❌ callarse la facturación → el doctor entiende que la clínica no facturó.
 *   ✅ «no tienes acceso a facturación, esa parte no te la puedo dar».
 *
 * En una pregunta abierta esto es peor que en una directa: Sabina daría un
 * consejo sobre medio cuadro con el mismo tono de seguridad. Por eso `omitidas`
 * viaja en los datos Y en el `resumen`, no en un log.
 *
 * ── EL PERMISO DE ESTA HERRAMIENTA ─────────────────────────────────────
 * El catálogo del contrato dice "compuesta *" en la columna de permiso, pero la
 * interfaz exige una `PermissionKey`. Se declara `today.view` («Ver pestaña
 * Hoy»): es la pantalla de la que esta herramienta es el equivalente, la tiene
 * por default TODO rol —incluido READONLY— y las cuatro secciones se vuelven a
 * gatear una por una con su propia key. Así ningún dato sale sin su permiso y
 * nadie se queda sin poder preguntar "¿cómo va la clínica?". Queda anotado en el
 * reporte por si Rafael prefiere otra key.
 *
 * ── POR QUÉ NO PASA POR `correrHerramienta` ────────────────────────────
 * Porque necesita los NÚMEROS incluso cuando son cero: un día sin citas es un
 * dato («hoy no tienes citas»), y el runner lo convertiría en `sin_datos` y
 * perdería el resto de la foto. El permiso se comprueba con el MISMO helper
 * (`tienePermiso`) y con la key que declara cada herramienta, así que el criterio
 * es idéntico al del runner; lo único que cambia es qué se hace con el vacío.
 *
 * ── EL POOLER ──────────────────────────────────────────────────────────
 * Las secciones se piden en TRES tandas y no todas a la vez: juntas pasarían de
 * 12 consultas en paralelo y la regla de la casa es menos de 7 por `Promise.all`
 * (el pooler de Supabase se satura y empiezan los timeouts).
 */

import { z } from "zod";
import { definirHerramienta, pesos, tienePermiso } from "./base";
import { citasDelDia, type DatosCitasDelDia } from "./citas-del-dia";
import { ingresosPorPeriodo, type DatosIngresos } from "./ingresos-por-periodo";
import { pacientesConDeuda, type DatosDeuda } from "./pacientes-con-deuda";
import { pacientesNuevos, type DatosNuevos } from "./pacientes-nuevos";
import { fechaDe, hoyEnClinica, ventanaDelMes } from "./fechas";
import type { PermissionKey, SabinaCtx } from "../tipos";

const parametros = z.object({});

export type ParamsResumen = z.infer<typeof parametros>;

/** Una parte de la foto que no se pudo dar, y por qué. Nunca se omite en silencio. */
export interface SeccionOmitida {
  seccion: string;
  /** Qué habría hecho falta. El motor lo convierte en una frase explícita. */
  permiso: PermissionKey;
}

export interface DatosResumen {
  fecha: string;
  /** Primer y último día del mes en curso, en el calendario de la clínica. */
  mes: { desde: string; hasta: string };
  citasHoy: {
    activas: number;
    canceladas: number;
    noAsistieron: number;
    proxima: DatosCitasDelDia["proxima"];
  } | null;
  ingresosDelMes: {
    netos: number;
    brutos: number;
    reembolsos: number;
    cobros: number;
  } | null;
  deuda: {
    pacientes: number;
    total: number;
    vencido: number;
  } | null;
  pacientesDelMes: {
    nuevos: number;
    periodoAnterior: number;
    variacionPct: number | null;
  } | null;
  omitidas: SeccionOmitida[];
}

export const resumenClinica = definirHerramienta<ParamsResumen, DatosResumen>({
  nombre: "resumen_clinica",
  descripcion:
    "La foto completa de la clínica en una sola llamada: citas de hoy, ingresos del mes en curso " +
    "(netos y brutos), deuda por cobrar y vencida, y pacientes nuevos del mes comparados con el mes " +
    "anterior. Úsala " +
    "para arrancar cualquier pregunta ABIERTA («¿cómo va mi clínica?», «¿qué hago para crecer?», " +
    "«¿por qué bajaron mis ingresos?») y para saber de un golpe dónde mirar después. Si a quien " +
    "pregunta le falta permiso para alguna parte, esa parte viene en `omitidas` y HAY QUE DECÍRSELO: " +
    "no es que no haya datos, es que no tiene acceso.",
  parametros,
  permiso: "today.view",

  async ejecutar(ctx: SabinaCtx): Promise<DatosResumen> {
    const hoy = hoyEnClinica(ctx.timezone);
    const mes = ventanaDelMes(ctx.timezone);
    const mesDesde = fechaDe(mes.desde, ctx.timezone);
    // El fin de la ventana es EXCLUSIVO (00:00 del mes siguiente): el último día
    // del mes es el instante anterior.
    const mesHasta = fechaDe(new Date(mes.hasta.getTime() - 1), ctx.timezone);

    const omitidas: SeccionOmitida[] = [];
    const puede = (nombre: string, permiso: PermissionKey): boolean => {
      if (tienePermiso(ctx, permiso)) return true;
      omitidas.push({ seccion: nombre, permiso });
      return false;
    };

    const verCitas = puede("citas de hoy", citasDelDia.permiso);
    const verDinero = puede("ingresos y deuda", ingresosPorPeriodo.permiso);
    const verPacientes = puede("pacientes nuevos", pacientesNuevos.permiso);

    // Tanda 1 — las dos ligeras (2 consultas cada una).
    const [citas, ingresos] = await Promise.all([
      verCitas ? citasDelDia.ejecutar(ctx, {}) : Promise.resolve(null),
      verDinero
        ? ingresosPorPeriodo.ejecutar(ctx, { desde: mesDesde, hasta: mesHasta, agrupar: "mes" })
        : Promise.resolve(null),
    ]);

    // Tanda 2 — pacientes nuevos del mes (4 consultas).
    const nuevos = verPacientes
      ? await pacientesNuevos.ejecutar(ctx, { desde: mesDesde, hasta: mesHasta })
      : null;

    // Tanda 3 — la deuda (4 consultas). Comparte permiso con los ingresos, así
    // que si aquél se omitió, ésta también, y ya está anotada una sola vez.
    const deuda = verDinero ? await pacientesConDeuda.ejecutar(ctx, {}) : null;

    return {
      fecha: hoy,
      mes: { desde: mesDesde, hasta: mesHasta },
      citasHoy: citas ? resumirCitas(citas) : null,
      ingresosDelMes: ingresos ? resumirIngresos(ingresos) : null,
      deuda: deuda ? resumirDeuda(deuda) : null,
      pacientesDelMes: nuevos ? resumirNuevos(nuevos) : null,
      omitidas,
    };
  },

  // Nunca es "sin datos": una clínica en calma es una respuesta, y si TODO está
  // omitido por permisos eso también hay que poder decirlo.
  vacio: () => false,

  resumir(d) {
    const partes: string[] = [];
    if (d.citasHoy) {
      const c = d.citasHoy;
      partes.push(
        c.activas === 0
          ? "hoy no hay citas activas"
          : `hoy ${c.activas} cita${c.activas === 1 ? "" : "s"}` +
            (c.noAsistieron > 0 ? ` (${c.noAsistieron} sin asistir)` : ""),
      );
    }
    if (d.ingresosDelMes) {
      partes.push(`${pesos(d.ingresosDelMes.netos)} netos en el mes`);
    }
    if (d.deuda) {
      partes.push(
        d.deuda.pacientes === 0
          ? "nada por cobrar"
          : `${pesos(d.deuda.total)} por cobrar de ${d.deuda.pacientes} paciente${d.deuda.pacientes === 1 ? "" : "s"}`,
      );
    }
    if (d.pacientesDelMes) {
      const v = d.pacientesDelMes.variacionPct;
      partes.push(
        `${d.pacientesDelMes.nuevos} paciente${d.pacientesDelMes.nuevos === 1 ? "" : "s"} nuevo${d.pacientesDelMes.nuevos === 1 ? "" : "s"}` +
          (v === null ? "" : ` (${v >= 0 ? "+" : ""}${v}%)`),
      );
    }

    const cuerpo = partes.length > 0 ? `${d.fecha}: ${partes.join("; ")}.` : `${d.fecha}.`;
    if (d.omitidas.length === 0) return cuerpo;
    const falta = d.omitidas.map((o) => `${o.seccion} (falta ${o.permiso})`).join(", ");
    return `${cuerpo} NO tienes acceso a: ${falta} — dilo, no lo presentes como que no hay datos.`;
  },
});

function resumirCitas(c: DatosCitasDelDia): DatosResumen["citasHoy"] {
  return {
    activas: c.activas,
    canceladas: c.canceladas,
    noAsistieron: c.noAsistieron,
    proxima: c.proxima,
  };
}

function resumirIngresos(i: DatosIngresos): DatosResumen["ingresosDelMes"] {
  return {
    netos: i.ingresosNetos,
    brutos: i.ingresosBrutos,
    reembolsos: i.reembolsos,
    cobros: i.cobros,
  };
}

function resumirDeuda(d: DatosDeuda): DatosResumen["deuda"] {
  return { pacientes: d.deudores.total, total: d.totalAdeudado, vencido: d.totalVencido };
}

function resumirNuevos(n: DatosNuevos): DatosResumen["pacientesDelMes"] {
  return {
    nuevos: n.nuevos.total,
    periodoAnterior: n.periodoAnterior,
    variacionPct: n.variacionPct,
  };
}
