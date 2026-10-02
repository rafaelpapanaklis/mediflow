// ws1-t8 (ticket 3 de BEVADENT, mejoras 3b y 9b): una cita de ortodoncia se ATIENDE con la hoja de control.
//
// Antes, «Pasar a consulta» de una cita «Control de ortodoncia» abría la ficha en «Nueva consulta → Dental
// general» (la pantalla dependía de la CLÍNICA, consult-landing.ts) y el doctor tenía que cambiar el tipo a mano;
// desde la cita solo se podía abrir el cajón rápido de la hoja (BotonHojaControl), sin el caso alrededor.
//
// Ahora la decide la CITA. Si es de ortodoncia con hoja (control, urgencia, colocación, retiro o retención: la
// misma lista con la que el panel de la cita ofrece la hoja), la sede tiene el módulo, quien atiende puede usarlo
// y el paciente tiene el caso en marcha, la ficha cae en Ortodoncia y abre la hoja ligada a esa cita — la misma
// hoja que, al firmarse, adopta la nota de la consulta y cierra la cita (ligar-hoja-firmada, una nota por visita).
// En cualquier otro caso, lo de siempre.
//
// PURO: sin React ni Prisma; lo prueba consulta-de-cita-orto.test.ts.

import { esCitaOrtoConHoja } from "./agenda-constants";
import { esCitaDeHoy } from "@/lib/patients/proxima-cita";

/** Pestaña Ortodoncia de la ficha. */
export const TAB_ORTODONCIA = "ortodoncia";
/** `?hoja=1`: la ficha abre la hoja de control de la cita al llegar (lo pone «Abrir atención completa»). */
export const PARAM_ABRIR_HOJA = "hoja";

const ANULADA = new Set(["CANCELLED", "NO_SHOW"]);
const ATENDIDA = new Set(["COMPLETED", "CHECKED_OUT"]);

export interface CitaParaAtender {
  type?: string | null;
  status?: string | null;
  startsAt: string | Date;
}

/**
 * ¿Esta cita se atiende con la hoja de control de ortodoncia?
 *
 * Una cita cancelada o sin asistencia, no. Una ya atendida de OTRO día tampoco: abrir «la hoja» ahí crearía un
 * control nuevo de hoy que nadie pidió (su hoja, si la tiene, se ve en el historial del caso). La de hoy ya
 * atendida sí: la ficha enseña su control firmado.
 */
export function seAtiendeConLaHoja(p: {
  cita: CitaParaAtender | null | undefined;
  /** La sede tiene el módulo y la sesión puede registrar controles (no solo leer). */
  moduloOrtodoncia: boolean;
  /** Hay caso y ya no está «sin iniciar»: el mismo criterio que «Registrar control». */
  casoActivo: boolean;
  ahora: Date;
  zona: string;
}): boolean {
  const { cita } = p;
  if (!cita || !p.moduloOrtodoncia || !p.casoActivo) return false;
  if (!esCitaOrtoConHoja(cita.type ?? null)) return false;
  const estado = cita.status ?? "";
  if (ANULADA.has(estado)) return false;
  if (ATENDIDA.has(estado) && !esCitaDeHoy(cita.startsAt, p.ahora, p.zona)) return false;
  return true;
}

/** La ficha del paciente en Ortodoncia, con la cita y su hoja abierta: «Abrir atención completa» de la cita. */
export function enlaceAtencionCompleta(patientId: string, appointmentId: string): string {
  const qs = new URLSearchParams({ tab: TAB_ORTODONCIA, appointment: appointmentId, [PARAM_ABRIR_HOJA]: "1" });
  return `/dashboard/patients/${encodeURIComponent(patientId)}?${qs.toString()}`;
}

/**
 * La ficha llegó con `?hoja=1`: ¿abre la hoja? Solo dentro de Ortodoncia y si la cita de la dirección se atiende
 * con la hoja; si no, se queda en la pestaña sin abrir nada (un enlace viejo o manipulado no crea controles).
 */
export function abrirHojaAlLlegar(p: { tabDeLaDireccion: string | null; hoja: string | null; seAtiendeConLaHoja: boolean }): boolean {
  return p.tabDeLaDireccion === TAB_ORTODONCIA && p.hoja === "1" && p.seAtiendeConLaHoja;
}
