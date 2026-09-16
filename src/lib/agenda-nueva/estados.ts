/**
 * Los NUEVE estados de cita → cómo se pintan en la agenda nueva.
 *
 * ┌─ Por qué existe este archivo ───────────────────────────────────────────┐
 * │ El diseño de Claude Design enseña CINCO pintas (confirmada, sin         │
 * │ confirmar, esperando, en consulta, atendida). El sistema tiene NUEVE    │
 * │ estados. Los cuatro que sobran no pueden caer en un «no sé qué es esto» │
 * │ y pintarse mal — es exactamente el fallo que se arregló en la tabla de  │
 * │ citas de la ficha del paciente.                                         │
 * │                                                                         │
 * │ Por eso el mapa es un `Record<AppointmentStatus, …>` EXHAUSTIVO: si     │
 * │ mañana alguien añade un estado al TIPO, TypeScript rompe este archivo   │
 * │ antes de que la agenda lo pinte de gris por accidente.                  │
 * │                                                                         │
 * │ ⚠️ Pero el tipo es más estrecho que el enum de la base (ver `PENDING`,  │
 * │ más abajo), así que NO indexes el mapa a pelo: usa `pintaDeEstado`.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * El reparto, y por qué (va también en el reporte para Rafael):
 *
 *  · SCHEDULED    → «Sin confirmar». Es la cita agendada que todavía no
 *                   confirmó nadie: el borde PUNTEADO del diseño es justo eso.
 *  · CONFIRMED    → «Confirmada». Literal.
 *  · CHECKED_IN   → «Esperando» (ámbar). El paciente llegó y está en la sala
 *                   de espera; el ámbar del diseño significa «lleva esperando»
 *                   y el chip lleva los minutos.
 *  · IN_CHAIR     → familia MORADA, chip «En sillón». Ya no está en la sala de
 *                   espera, está en el consultorio; pintarlo de ámbar lo
 *                   confundiría con la sala. Comparte familia con «en consulta»
 *                   porque es el paso inmediatamente anterior, y se distingue
 *                   por el chip y por el ícono (`chair`, no `circle`).
 *                   [Acordado con ws1-t2 para que Día, Semana y Mes coincidan.]
 *  · IN_PROGRESS  → «En consulta». Literal.
 *  · COMPLETED    → «Atendida». Literal (opacidad 0.6 del diseño).
 *  · CHECKED_OUT  → «Atendida» con chip «Salió». El paciente ya se fue; misma
 *                   pinta apagada, distinto rótulo, porque para recepción son
 *                   dos cosas distintas («terminó» vs «ya no está aquí»).
 *  · CANCELLED    → PINTA NUEVA. El diseño no la tiene. Gris apagado, borde
 *                   punteado y el nombre tachado. Ojo: hoy las canceladas NO
 *                   se dibujan en la cuadrícula de Día (`assignLanes` las
 *                   descarta) — esta pinta la usan Semana, Mes y el panel.
 *  · NO_SHOW      → PINTA NUEVA. El diseño no la tiene y NO puede caer en
 *                   «atendida»: una cita a la que el paciente no vino no es
 *                   una cita atendida. Rojo suave, en la misma familia `oklch`
 *                   que el resto para que no desentone.
 */

import type { AppointmentStatus } from "@/lib/agenda/types";
import { AGENDA_TOKENS as T } from "./tokens";

/** El ícono de Material Symbols que resume el estado (lo usa la tarjeta compacta de Semana). */
export type IconoEstado = "check" | "schedule" | "circle" | "chair" | "cancel" | "person_off" | null;

export interface PintaEstado {
  /** Fondo de la tarjeta. */
  fondo: string;
  /** Color del borde. */
  borde: string;
  /** `solid` o `dashed` — el diseño usa punteado para «sin confirmar». */
  estiloBorde: "solid" | "dashed";
  /** Opacidad de la tarjeta entera. */
  opacidad: number;
  /** Texto del chip, sin los minutos (esos los añade `pintaDeCita`). */
  chipTexto: string;
  chipFondo: string;
  chipTinta: string;
  /** Ícono relleno de la variante compacta. */
  icono: IconoEstado;
  iconoColor: string;
  /** El nombre del paciente va tachado (solo canceladas). */
  tachado: boolean;
  /** Este estado ya no cuenta como cita viva (no ocupa hueco ni suma ocupación). */
  muerta: boolean;
}

/**
 * Los nueve, exhaustivo. No añadas un `default`: la gracia es que TypeScript
 * obligue a decidir cuando aparezca un estado nuevo.
 */
export const PINTA_POR_ESTADO: Record<AppointmentStatus, PintaEstado> = {
  SCHEDULED: {
    fondo: T.superficie,
    borde: T.bordeControl,
    estiloBorde: "dashed",
    opacidad: 1,
    chipTexto: "Sin confirmar",
    chipFondo: T.fondoApp,
    chipTinta: T.texto2,
    icono: null,
    iconoColor: T.texto2,
    tachado: false,
    muerta: false,
  },
  CONFIRMED: {
    fondo: T.superficie,
    borde: T.bordeControl,
    estiloBorde: "solid",
    opacidad: 1,
    chipTexto: "Confirmada",
    chipFondo: T.chipVerdeFondo,
    chipTinta: T.chipVerdeTinta,
    icono: "check",
    iconoColor: T.verde,
    tachado: false,
    muerta: false,
  },
  CHECKED_IN: {
    fondo: T.ambarClaro,
    borde: T.ambarBorde,
    estiloBorde: "solid",
    opacidad: 1,
    chipTexto: "Esperando",
    chipFondo: T.ambarFondo,
    chipTinta: T.ambarTexto,
    icono: "schedule",
    iconoColor: T.ambarIcono,
    tachado: false,
    muerta: false,
  },
  IN_CHAIR: {
    fondo: T.moradoTinte,
    borde: T.bordeConsulta,
    estiloBorde: "solid",
    opacidad: 1,
    chipTexto: "En sillón",
    chipFondo: T.moradoTinte,
    chipTinta: T.moradoTexto,
    icono: "chair",
    iconoColor: T.moradoTexto,
    tachado: false,
    muerta: false,
  },
  IN_PROGRESS: {
    fondo: T.moradoTinte,
    borde: T.bordeConsulta,
    estiloBorde: "solid",
    opacidad: 1,
    chipTexto: "En consulta",
    chipFondo: T.moradoTinte,
    chipTinta: T.moradoTexto,
    icono: "circle",
    iconoColor: T.verde,
    tachado: false,
    muerta: false,
  },
  COMPLETED: {
    fondo: T.superficie,
    borde: T.bordeControl,
    estiloBorde: "solid",
    opacidad: 0.6,
    chipTexto: "Atendida",
    chipFondo: T.fondoApp,
    chipTinta: T.texto2,
    icono: "check",
    iconoColor: T.texto2,
    tachado: false,
    muerta: false,
  },
  CHECKED_OUT: {
    fondo: T.superficie,
    borde: T.bordeControl,
    estiloBorde: "solid",
    opacidad: 0.6,
    chipTexto: "Salió",
    chipFondo: T.fondoApp,
    chipTinta: T.texto2,
    icono: "check",
    iconoColor: T.texto2,
    tachado: false,
    muerta: false,
  },
  // ── Las dos que el diseño no tiene ──────────────────────────────────────
  CANCELLED: {
    fondo: T.fondoCerrado,
    borde: T.bordeControl,
    estiloBorde: "dashed",
    opacidad: 0.55,
    chipTexto: "Cancelada",
    chipFondo: T.fondoApp,
    chipTinta: T.texto2,
    icono: "cancel",
    iconoColor: T.texto2,
    tachado: true,
    muerta: true,
  },
  NO_SHOW: {
    fondo: T.rojoFondo,
    borde: T.rojoBorde,
    estiloBorde: "solid",
    opacidad: 0.85,
    chipTexto: "No asistió",
    chipFondo: T.chipRojoFondo,
    chipTinta: T.rojoTexto,
    icono: "person_off",
    iconoColor: T.rojoTexto,
    tachado: false,
    muerta: true,
  },
};

/**
 * 🔴 `PENDING`: el estado que el tipo de TypeScript NO tiene y la base SÍ.
 *
 * `AppointmentStatus` (la unión de `src/lib/home/types.ts`) declara nueve
 * valores, pero el enum de Postgres tiene DIEZ: `PENDING` sigue ahí, marcado
 * como legacy, y encima es el `@default` de la columna. Nadie lo normaliza por
 * el camino: `appointmentToDTO` hace `a.status as AppointmentStatus` y se lo
 * cree.
 *
 * Sin esto, UNA sola fila con `PENDING` dejaba `pinta` en `undefined` y la
 * primera lectura de `pinta.chipTexto` lanzaba dentro del render de la vista
 * Día: no es que esa cita se pintara mal, es que se caía la pantalla entera.
 * Lo encontró el revisor.
 *
 * `PENDING` es «agendada sin confirmar», que es exactamente `SCHEDULED` —
 * `STATUS_LABELS.SCHEDULED` ya se llama «Pendiente» y el panel de detalle de
 * siempre contempla la cadena "PENDING" a mano. Así que se normaliza a
 * `SCHEDULED` y se pinta como tal.
 */
export const ESTADO_LEGACY_PENDIENTE = "PENDING";

/**
 * La pinta de un estado, tolerando el `PENDING` legacy y cualquier valor que
 * llegue de la base sin estar en el tipo.
 *
 * ⚠️ Úsala SIEMPRE en vez de indexar `PINTA_POR_ESTADO` a pelo: el mapa es
 * exhaustivo sobre el TIPO, y el tipo es más estrecho que el enum.
 */
export function pintaDeEstado(status: AppointmentStatus | string): PintaEstado {
  return PINTA_POR_ESTADO[status as AppointmentStatus] ?? PINTA_POR_ESTADO.SCHEDULED;
}

/**
 * El estado, normalizado al conjunto de nueve que entiende la aplicación.
 * `PENDING` (y cualquier otro valor inesperado) se trata como `SCHEDULED`.
 */
export function estadoNormalizado(status: AppointmentStatus | string): AppointmentStatus {
  return status in PINTA_POR_ESTADO ? (status as AppointmentStatus) : "SCHEDULED";
}

/**
 * Los estados que NO cuentan como cita viva. Se deriva del mapa de arriba
 * para que no haya dos listas que se puedan desincronizar.
 */
export const ESTADOS_MUERTOS: readonly AppointmentStatus[] = (
  Object.keys(PINTA_POR_ESTADO) as AppointmentStatus[]
).filter((e) => PINTA_POR_ESTADO[e].muerta);

/**
 * ¿Esta cita está SIN CONFIRMAR?
 *
 * Existe para que nadie tenga que escribir `status === "SCHEDULED"` a mano: el
 * `PENDING` legacy también es una cita sin confirmar —es literalmente lo que
 * significa— y compararlo con una cadena suelta lo deja fuera de la cuenta.
 *
 * Lo encontró ws1-t2 en la nota ámbar del Mes («N sin confirmar»): con el
 * literal, un día con veinte citas y cinco en `PENDING` decía «20 citas» y
 * ninguna nota. Para un aviso cuya única razón de ser es «llama a estos
 * pacientes», el número mal es tan malo como no tenerlo.
 */
export function esSinConfirmar(status: AppointmentStatus | string): boolean {
  return estadoNormalizado(status) === "SCHEDULED";
}

/**
 * ¿Esta cita CUENTA en el «N citas» del día?
 *
 * Todo lo que no esté cancelado, incluidos los plantones: la agenda dibuja esas
 * tarjetas, así que el número tiene que cuadrar con lo que se ve, y para el
 * dueño «18 citas» que acaban en 15 atendidas es justo el dato. Los MINUTOS
 * ocupados son otra cuenta y ésa usa `citaViva` (un plantón no ocupa el sillón).
 * Criterio acordado con ws1-t2 para que Día, Semana y Mes no se contradigan.
 */
export function citaContada(status: AppointmentStatus | string): boolean {
  return estadoNormalizado(status) !== "CANCELLED";
}

/** ¿Esta cita sigue viva (ocupa sillón, cuenta para la ocupación)? */
export function citaViva(status: AppointmentStatus | string): boolean {
  return !pintaDeEstado(status).muerta;
}
