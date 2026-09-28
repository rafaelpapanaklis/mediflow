// Ortodoncia en la pantalla «Hoy» (ws1-t5, 28-sep-2026; revisión de lógica de
// uso, fila 8 del mapa). PURO: sin React, sin Prisma. Lo prueban los tests en
// node.
//
// Lo que había: un solo aviso («N mensualidades vencidas») que mandaba a
// Caja, solo en el Hoy de recepción y del dueño. El Hoy del doctor no sabía
// nada de ortodoncia: sus controles salían como una cita más y el nombre del
// paciente abría la ficha general, no su caso.
//
// Lo que decide este archivo:
//  · a dónde lleva una cita del Hoy (un control abre el CASO del paciente);
//  · a dónde lleva el aviso de mensualidades vencidas (a Ortodoncia →
//    Cobranza para quien puede entrar al módulo; a Caja para quien no);
//  · qué dice el aviso de los controles de hoy y a dónde lleva.
//
// Registrar el control NO se hace desde aquí: la hoja de control es una sola
// y la abren la ficha y la Agenda. El Hoy solo lleva hasta ella.

import { esCitaControlOrto } from "./agenda-constants";

export const RUTA_COBRANZA_ORTODONCIA = "/dashboard/orthodontics/cobranza";
export const RUTA_CONTROLES_ORTODONCIA = "/dashboard/orthodontics/controles";
/** El ancla de la lista de mensualidades en Caja → Facturas (la de siempre). */
export const RUTA_MENSUALIDADES_EN_CAJA = "/dashboard/caja?tab=facturas#mensualidades-ortodoncia";

/** La ficha del paciente, en su pestaña de Ortodoncia. */
export function fichaEnOrtodoncia(patientId: string): string {
  return `/dashboard/patients/${encodeURIComponent(patientId)}?tab=ortodoncia`;
}

/**
 * A dónde lleva el nombre del paciente en una cita de Hoy. Un control de
 * ortodoncia abre su caso; cualquier otra cita, la ficha de siempre. Si la
 * sede ya no tiene el módulo, la ficha ignora `tab=ortodoncia` y abre normal.
 */
export function destinoDeLaCitaEnHoy(cita: { patientId: string; motivo: string | null | undefined }): string {
  if (esCitaControlOrto(cita.motivo)) return fichaEnOrtodoncia(cita.patientId);
  return `/dashboard/patients/${encodeURIComponent(cita.patientId)}`;
}

/** Quien puede entrar al módulo cobra en Cobranza; quien no (recepción sin el permiso), en Caja. */
export function destinoDeMensualidadesVencidas(puedeVerModulo: boolean): string {
  return puedeVerModulo ? RUTA_COBRANZA_ORTODONCIA : RUTA_MENSUALIDADES_EN_CAJA;
}

export function subtituloDeMensualidadesVencidas(puedeVerModulo: boolean): string {
  return puedeVerModulo ? "Ortodoncia · ver quién debe en Cobranza" : "Ortodoncia · cobrar en Caja";
}

export interface ControlDeHoy {
  appointmentId: string;
  patientId: string;
  patientName: string;
  /** ISO completo. */
  startsAt: string;
  /** "HH:MM" en la zona de la clínica. */
  hora: string;
  /** `Appointment.status`. */
  status: string;
  /** La hoja de control de este control: sin abrir, en borrador o firmada. */
  hoja: "DRAFT" | "SIGNED" | null;
}

/** Una cita cancelada o a la que no vino el paciente ya no es un control por hacer. */
const ESTADOS_QUE_NO_CUENTAN = ["CANCELLED", "NO_SHOW"];

export interface ResumenControlesDeHoy {
  /** Controles de hoy que siguen en pie (sin cancelados ni inasistencias). */
  total: number;
  /** Con la hoja de control ya firmada. */
  registrados: number;
  /** Los que faltan por registrar, en orden de hora. */
  porRegistrar: ControlDeHoy[];
  titulo: string;
  sub: string;
  href: string;
}

/**
 * El aviso de los controles de hoy. `null` si hoy no hay ninguno en pie: el
 * aviso se calla, igual que el de mensualidades.
 *
 * Si solo falta UNO por registrar, lleva directo al caso de ese paciente; si
 * faltan varios (o ninguno), a Ortodoncia → Controles.
 */
export function resumirControlesDeHoy(controles: readonly ControlDeHoy[]): ResumenControlesDeHoy | null {
  const enPie = controles
    .filter((c) => !ESTADOS_QUE_NO_CUENTAN.includes(c.status))
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (enPie.length === 0) return null;

  const porRegistrar = enPie.filter((c) => c.hoja !== "SIGNED");
  const registrados = enPie.length - porRegistrar.length;

  const titulo =
    enPie.length === 1 ? "1 control de ortodoncia hoy" : `${enPie.length} controles de ortodoncia hoy`;

  let sub: string;
  if (porRegistrar.length === 0) {
    sub = enPie.length === 1 ? "Ya está registrado" : "Todos registrados";
  } else {
    const siguiente = porRegistrar[0];
    const faltan =
      porRegistrar.length === 1 ? "Falta 1 por registrar" : `Faltan ${porRegistrar.length} por registrar`;
    sub = `${faltan} · ${siguiente.hora} ${siguiente.patientName}`.trim();
  }

  const href =
    porRegistrar.length === 1 ? fichaEnOrtodoncia(porRegistrar[0].patientId) : RUTA_CONTROLES_ORTODONCIA;

  return { total: enPie.length, registrados, porRegistrar, titulo, sub, href };
}

/** A quién le toca ver qué en el Hoy. */
export function queEnsenarEnHoy(e: {
  esDental: boolean;
  moduloActivo: boolean;
  tienePermisoModulo: boolean;
  tienePermisoCobro: boolean;
}): { controles: boolean; mensualidades: boolean; puedeVerModulo: boolean } {
  const hayModulo = e.esDental && e.moduloActivo;
  const puedeVerModulo = hayModulo && e.tienePermisoModulo;
  return {
    // Los controles son del módulo: sin su permiso no se enseñan.
    controles: puedeVerModulo,
    // Las mensualidades son dinero: las ve quien puede ver facturación, como
    // hasta hoy (recepción incluida, que cobra en Caja).
    mensualidades: hayModulo && e.tienePermisoCobro,
    puedeVerModulo,
  };
}
