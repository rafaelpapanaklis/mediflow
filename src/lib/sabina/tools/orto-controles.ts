/**
 * `orto_controles` — los controles de ortodoncia y los casos del módulo.
 *
 *   «¿qué controles tengo hoy?» ............... que: "hoy"
 *   «¿y esta semana?» ......................... que: "semana"
 *   «¿quién se pasó de su control?» ........... que: "sin_control"
 *   «¿cuántos casos activos / terminados?» .... que: "casos"
 *
 * Todo sale de los cargadores del módulo (ver ./orto-motor): las tres primeras
 * son la pantalla «Controles / agenda» (`loadOrthoControles`) y la cuarta, los
 * casos de «Pacientes en tratamiento» (`loadOrthoCases`), contados. «Se pasó de
 * su control» es el criterio de esa pantalla y de la alerta «Falta de control»:
 * caso ACTIVO sin ningún control futuro en la agenda; urgente a los 45 días.
 *
 * 🔴 SOLO LECTURA. No confirma ni registra un control: el enlace lleva a la
 * pantalla donde eso se hace. Agendar un control sí se puede, pero lo hace
 * `agendar_cita` (decisión de Rafael del 28-sep-2026), no esta herramienta.
 *
 * ── PERMISOS ────────────────────────────────────────────────────────────
 * La key del módulo la mira el runner. Las listas de controles piden además
 * `agenda.view` (son citas con nombre y hora); contar casos, no. Lo que falta se
 * DICE en `omitidas`. La visibilidad de paciente es la del panel: un doctor con
 * pacientes restringidos no ve aquí los controles ni los casos de los demás.
 */

import { z } from "zod";
import {
  DIAS_SIN_CONTROL_URGENTE,
  estadoDeCita,
  fraseSinControl,
  rotuloDelDia,
} from "@/lib/orthodontics/controles-modulo";
import { definirHerramienta, fraseRecorte, lineasDeLista, plural, recortar, type Lista } from "./base";
import { fechaDe, horaDe } from "./fechas";
import {
  ENLACES_ORTO,
  PERMISO_ORTO,
  anotador,
  avisoEnlace,
  avisoSinModulo,
  fechaCorta,
  fraseOmitidas,
  sinModulo,
  type EstadoModulo,
  type OmitidaOrto,
} from "./orto-comun";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  /**
   * "hoy" = controles de hoy · "semana" = de hoy a siete días · "sin_control" =
   * quién se pasó de su control · "casos" = cuántos casos hay, por estado.
   */
  que: z.enum(["hoy", "semana", "sin_control", "casos"]).optional(),
});

export type ParamsOrtoControles = z.infer<typeof parametros>;

export interface ControlFila {
  /** AAAA-MM-DD, en la zona de la clínica. */
  dia: string;
  /** «Hoy · lunes 28 sep», «Mañana · martes 29 sep», «jueves 1 oct». */
  rotulo: string;
  hora: string;
  paciente: string;
  doctor: string | null;
  /** «Confirmada», «Por confirmar», «Atendida», «No se presentó», «Cancelada»… */
  estado: string;
  /** La hoja de ese control: "firmada", "borrador" o `null` si aún no se registra. */
  hoja: string | null;
}

export interface SinControlFila {
  paciente: string;
  doctor: string | null;
  /** «Su último control fue hace 52 días · faltó a su última cita». */
  situacion: string;
  diasSinControl: number | null;
  urgente: boolean;
}

export interface DatosOrtoControles {
  modulo: EstadoModulo;
  que: "hoy" | "semana" | "sin_control" | "casos";
  /** AAAA-MM-DD de hoy en la clínica. */
  hoy: string;
  controles: Lista<ControlFila> | null;
  /** De HOY: los que siguen en pie, los atendidos, las faltas y los cancelados. */
  resumenHoy: { enPie: number; atendidos: number; faltaron: number; cancelados: number } | null;
  /** De mañana a siete días, sin los cancelados: el total de la pantalla, no el de la lista recortada. */
  proximos: number | null;
  sinControl: Lista<SinControlFila> | null;
  urgentes: number;
  casos: {
    activos: number;
    /** COMPLETED: los que terminaron su tratamiento. */
    terminados: number;
    abandonaron: number;
    /** Cuántos hay en cada estado, con el nombre que les da el panel. */
    porEstado: Array<{ estado: string; casos: number }>;
    total: number;
  } | null;
  /** Casos activos: el total contra el que se lee «N sin control». */
  casosActivos: number | null;
  omitidas: OmitidaOrto[];
  enlace: string;
}

const ESTADO_DEL_CASO: Record<string, string> = {
  PLANNED: "Planeado",
  IN_PROGRESS: "En curso",
  ON_HOLD: "Pausado",
  RETENTION: "Retención",
  COMPLETED: "Completado",
  DROPPED_OUT: "Abandono",
};
/** Para la frase: «4 en curso, 2 pausados, 1 en retención». */
const ESTADO_EN_FRASE: Record<string, [string, string]> = {
  Planeado: ["planeado", "planeados"],
  "En curso": ["en curso", "en curso"],
  Pausado: ["pausado", "pausados"],
  Retención: ["en retención", "en retención"],
  Completado: ["completado", "completados"],
  Abandono: ["en abandono", "en abandono"],
};
const ORDEN_DE_ESTADOS = ["IN_PROGRESS", "PLANNED", "ON_HOLD", "RETENTION", "COMPLETED", "DROPPED_OUT"];

const HOJA: Record<string, string> = { SIGNED: "firmada", DRAFT: "borrador" };

export const ortoControles = definirHerramienta<ParamsOrtoControles, DatosOrtoControles>({
  nombre: "orto_controles",
  descripcion:
    "ORTODONCIA: los controles de hoy (que: \"hoy\") o de hoy a siete días (\"semana\"), quién se pasó de su " +
    "control y sigue sin cita (\"sin_control\"), y cuántos casos hay activos, terminados y por estado (\"casos\"). " +
    "Solo lee y da el enlace a la pantalla del módulo. Para agendar un control usa agendar_cita.",
  parametros,
  permiso: PERMISO_ORTO,

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosOrtoControles> {
    const motor = await import("./orto-motor");
    const que = params.que ?? "hoy";
    const enlace = que === "casos" ? ENLACES_ORTO.pacientes : ENLACES_ORTO.controles;
    const base: DatosOrtoControles = {
      modulo: "activo",
      que,
      hoy: "",
      controles: null,
      resumenHoy: null,
      proximos: null,
      sinControl: null,
      urgentes: 0,
      casos: null,
      casosActivos: null,
      omitidas: [],
      enlace,
    };

    const modulo = await motor.estadoDelModulo(ctx);
    if (modulo !== "activo") return { ...base, ...sinModulo(modulo) };

    const zona = motor.zonaDe(ctx);
    const hoy = fechaDe(new Date(), zona);

    if (que === "casos") {
      const c = await motor.leerCasos(ctx);
      return {
        ...base,
        hoy,
        casosActivos: c.activos,
        casos: {
          activos: c.activos,
          terminados: c.porEstado.COMPLETED ?? 0,
          abandonaron: c.porEstado.DROPPED_OUT ?? 0,
          porEstado: ORDEN_DE_ESTADOS.filter((e) => (c.porEstado[e] ?? 0) > 0).map((e) => ({
            estado: ESTADO_DEL_CASO[e] ?? e,
            casos: c.porEstado[e],
          })),
          total: c.total,
        },
      };
    }

    const omitidas: OmitidaOrto[] = [];
    if (!anotador(ctx, omitidas)("controles de ortodoncia", "agenda.view")) return { ...base, hoy, omitidas };

    const data = await motor.leerControles(ctx);
    const aFila = (dia: string) => (c: (typeof data.semana.hoy)[number]): ControlFila => ({
      dia,
      rotulo: rotuloDelDia(dia, data.hoy),
      hora: horaDe(c.startsAt, zona),
      paciente: c.patientName,
      doctor: c.doctorName,
      estado: estadoDeCita(c.status).texto,
      hoja: c.hoja ? HOJA[c.hoja] ?? null : null,
    });

    if (que === "sin_control") {
      const filas: SinControlFila[] = data.sinControl.map((s) => ({
        paciente: s.patientName,
        doctor: s.treatingDoctorName,
        situacion: fraseSinControl(s),
        diasSinControl: s.diasSinControl,
        urgente: s.urgente,
      }));
      return {
        ...base,
        hoy: data.hoy,
        sinControl: recortar(filas),
        urgentes: filas.filter((f) => f.urgente).length,
        casosActivos: data.casosActivos,
        omitidas,
      };
    }

    const deHoy = data.semana.hoy.map(aFila(data.hoy));
    const deLaSemana =
      que === "semana" ? data.semana.proximosDias.flatMap((d) => d.citas.map(aFila(d.dia))) : [];
    return {
      ...base,
      hoy: data.hoy,
      controles: recortar([...deHoy, ...deLaSemana]),
      resumenHoy: data.semana.resumenHoy,
      proximos: que === "semana" ? data.semana.totalProximos : null,
      omitidas,
    };
  },

  // Nunca es «sin datos»: un día sin controles es una respuesta, y «nadie se
  // pasó de su control» también.
  vacio: () => false,

  avisoObligatorio(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo);
    if (d.que === "casos") {
      return avisoEnlace("abrir un caso o entrar al de un paciente", "Pacientes en tratamiento", d.enlace);
    }
    return avisoEnlace("registrar la hoja de un control", "Controles de ortodoncia", d.enlace);
  },

  resumir(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo).frase;
    const cola = fraseOmitidas(d.omitidas);

    if (d.casos) {
      const c = d.casos;
      if (c.total === 0) {
        return `No hay casos de ortodoncia registrados. Yo no los abro: se abren en [Pacientes en tratamiento](${d.enlace}).`;
      }
      const detalle = c.porEstado
        .map((e) => {
          const [uno, varios] = ESTADO_EN_FRASE[e.estado] ?? [e.estado.toLowerCase(), e.estado.toLowerCase()];
          return `${e.casos} ${e.casos === 1 ? uno : varios}`;
        })
        .join(", ");
      return (
        `${plural(c.activos, "caso activo", "casos activos")} de ortodoncia, ${c.terminados} ` +
        `${c.terminados === 1 ? "terminado" : "terminados"} y ${c.abandonaron} en abandono (${detalle}). ` +
        `«Activo» cuenta planeado, en curso, pausado y retención, como el Tablero. ` +
        `La lista está en [Pacientes en tratamiento](${d.enlace}).`
      );
    }

    if (d.sinControl) {
      const s = d.sinControl;
      const pantalla = `[Controles de ortodoncia](${d.enlace})`;
      if (s.total === 0) {
        return `Nadie se pasó de su control: los ${d.casosActivos ?? 0} casos activos tienen su próximo control agendado. Se ve en ${pantalla}.`;
      }
      const lista = lineasDeLista(s.filas, (f) => `${f.paciente} — ${f.situacion}${f.urgente ? " (urgente)" : ""}`);
      const uno = !lista && s.filas[0] ? ` Es ${s.filas[0].paciente}: ${s.filas[0].situacion.toLowerCase()}.` : "";
      return (
        `${plural(s.total, "caso activo", "casos activos")} sin próximo control agendado, de ${d.casosActivos ?? 0} activos` +
        `${d.urgentes > 0 ? `; ${d.urgentes} con ${DIAS_SIN_CONTROL_URGENTE} días o más sin venir` : ""}${fraseRecorte(s, "casos")}.` +
        `${lista ? " Del que lleva más tiempo al que menos:" : uno}${lista}\n` +
        `Si quieres le preparo su cita de control: dime el día y la hora. La lista está en ${pantalla}.`
      );
    }

    if (d.controles && d.resumenHoy) {
      const pantalla = `[Controles de ortodoncia](${d.enlace})`;
      const r = d.resumenHoy;
      const deHoy = r.enPie + r.atendidos + r.faltaron;
      const cancelados = r.cancelados > 0 ? plural(r.cancelados, "cancelado", "cancelados") : "";
      const desglose = [
        r.enPie > 0 ? `${r.enPie} por atender` : "",
        r.atendidos > 0 ? plural(r.atendidos, "ya atendido", "ya atendidos") : "",
        r.faltaron > 0 ? plural(r.faltaron, "paciente que no se presentó", "pacientes que no se presentaron") : "",
      ].filter(Boolean);
      const hoyFrase =
        deHoy === 0
          ? `Hoy (${fechaCorta(d.hoy)}) no hay controles de ortodoncia${cancelados ? ` (${cancelados})` : ""}`
          : `Hoy (${fechaCorta(d.hoy)}) hay ${plural(deHoy, "control", "controles")} de ortodoncia: ${desglose.join(", ")}` +
            `${cancelados ? `; aparte, ${cancelados}` : ""}`;
      const semana =
        d.que === "semana" ? `; en los siete días siguientes, ${plural(d.proximos ?? 0, "control", "controles")}` : "";
      const lista = lineasDeLista(d.controles.filas, (f) =>
        `${d.que === "semana" ? `${f.rotulo}, ` : ""}${f.hora} ${f.paciente}${f.doctor ? ` con ${f.doctor}` : ""} — ${f.estado}` +
        `${f.hoja ? ` (hoja ${f.hoja})` : ""}`,
      );
      const f0 = d.controles.filas[0];
      const uno = !lista && f0 ? ` Es ${f0.paciente}, ${f0.rotulo.toLowerCase()} a las ${f0.hora} — ${f0.estado.toLowerCase()}.` : "";
      return (
        `${hoyFrase}${semana}${fraseRecorte(d.controles, "controles")}.${uno}${lista}\n` +
        `Yo no registro la hoja del control: eso se hace en ${pantalla}.`
      );
    }

    // Sin `agenda.view`: no se leyó nada, y se dice.
    return `No consulté los controles de ortodoncia.${cola}`;
  },
});
