// Lo que se le manda al paciente (WhatsApp) y lo que se rellena en las hojas,
// a partir de los datos de UNA cita. PURO: sin Prisma, sin red, sin Meta.

import type { WhatsAppSendKind } from "@/lib/whatsapp/system-message";
import { PLANTILLA_INDICACIONES_ENCENDIDA } from "@/lib/whatsapp/templates-catalog";
import { decideSendMode } from "@/lib/whatsapp/send-mode";
import { parseWaTemplates } from "@/lib/whatsapp/template-config";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { hojaATextoWhatsApp } from "./cuerpo";
import { rellenarHoja, type ValoresHoja } from "./marcadores";
import { lugarDeLaClinica } from "@/lib/clinica/lugar-de-la-clinica";

/**
 * Con qué TIPO de mensaje sale el WhatsApp de indicaciones.
 *
 * Con la plantilla APAGADA (`PLANTILLA_INDICACIONES_ENCENDIDA` en templates-catalog.ts,
 * hoy así hasta que Rafael apruebe el texto) es "system": el único sin plantilla, como
 * los documentos del paciente (`/api/patient-documents/[id]/whatsapp`). Dentro de la
 * ventana de 24 h sale el texto; fuera de ella `sendWhatsAppLogged` lo BLOQUEA antes de
 * llamar a Meta (no se gasta nada) y la pantalla ofrece imprimir o el PDF.
 *
 * Con la bandera encendida pasa solo a "post_op_instructions": fuera de ventana, y con
 * la plantilla `dc_indicaciones_cuidado` aprobada en la clínica, sale esa plantilla con
 * los tres datos de `datosDePlantilla` (que se mandan siempre; con "system" se ignoran).
 */
export const KIND_ENVIO_INDICACIONES: WhatsAppSendKind = PLANTILLA_INDICACIONES_ENCENDIDA
  ? "post_op_instructions"
  : "system";

/** Estados en que la cita ya se atendió (o se está atendiendo): hay indicaciones que dar. */
export const ESTADOS_CON_INDICACIONES = ["IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT"] as const;
/** Estados en que el paciente ya llegó: se puede hacer constar su asistencia. */
export const ESTADOS_CON_CONSTANCIA = ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT"] as const;

export function admiteIndicaciones(status: string | null | undefined): boolean {
  return (ESTADOS_CON_INDICACIONES as readonly string[]).includes(String(status ?? ""));
}
export function admiteConstancia(status: string | null | undefined): boolean {
  return (ESTADOS_CON_CONSTANCIA as readonly string[]).includes(String(status ?? ""));
}

/**
 * ¿Este cambio de estado (visto con el panel de la cita abierto) es «se acaba de
 * terminar la consulta aquí»? Solo entonces se ofrecen las indicaciones: abrir una
 * cita que YA estaba completada no ofrece nada.
 */
export function seAcabaDeTerminar(antes: string | null, ahora: string): boolean {
  return ahora === "COMPLETED" && (antes === "IN_PROGRESS" || antes === "IN_CHAIR");
}

export interface CitaParaHoja {
  status: string;
  motivo: string | null;
  startsAt: Date;
  endsAt: Date;
  checkedInAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface DatosParaHoja {
  cita: CitaParaHoja;
  paciente: { nombre: string };
  doctor: { nombre: string; cedula: string | null };
  clinica: {
    nombre: string;
    telefono: string | null;
    ciudad: string | null;
    estado: string | null;
    /** C-60: la dirección completa, para no imprimir una ciudad que la contradice. */
    direccion?: string | null;
    timezone: string | null;
  };
  /** Nombres de los procedimientos reconocidos (o vacío). */
  procedimientos: string[];
}

const TZ_POR_DEFECTO = "America/Mexico_City";

export function fechaLarga(d: Date, tz: string | null | undefined): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz || TZ_POR_DEFECTO,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

export function horaCorta(d: Date, tz: string | null | undefined): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz || TZ_POR_DEFECTO,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * La hora que consta: la de la AGENDA (auditoría de uso, C-60).
 *
 * Antes constaba la hora «real» (llegada y fin registrados en el sistema): una cita de 11:00 a 11:30 a la que
 * recepción le dio llegada a las 14:08 salía «de las 14:08 a las 14:38». La llegada que se marca en el sistema
 * es cuando alguien pulsó el botón, no cuando entró el paciente; lo que la clínica ve y puede sostener es la
 * cita de su agenda. Si la cita se movió, la agenda ya dice la hora nueva.
 */
export function horarioQueConsta(c: CitaParaHoja, _tz?: string | null): { inicio: Date; fin: Date } {
  const fin = c.endsAt > c.startsAt ? c.endsAt : new Date(c.startsAt.getTime() + 30 * 60 * 1000);
  return { inicio: c.startsAt, fin };
}

/** «Extracción simple y Endodoncia», o el motivo de la cita si ningún procedimiento se reconoció. */
export function textoDeProcedimientos(procedimientos: readonly string[], motivo: string | null): string {
  const p = procedimientos.map((x) => x.trim()).filter(Boolean);
  if (p.length === 0) return (motivo ?? "").trim();
  if (p.length === 1) return p[0];
  return `${p.slice(0, -1).join(", ")} y ${p[p.length - 1]}`;
}

export function valoresDeLaCita(d: DatosParaHoja, ahora: Date): ValoresHoja {
  const tz = d.clinica.timezone;
  const { inicio, fin } = horarioQueConsta(d.cita, tz);
  // C-60: la ciudad sale de la dirección cuando el campo ciudad la contradice («en Mérida» con dirección de CDMX).
  const lugar = lugarDeLaClinica({ ciudad: d.clinica.ciudad, estado: d.clinica.estado, direccion: d.clinica.direccion }).lugar;
  return {
    nombrePaciente: d.paciente.nombre,
    nombreClinica: d.clinica.nombre,
    telefonoClinica: d.clinica.telefono,
    nombreDoctor: d.doctor.nombre,
    cedulaDoctor: d.doctor.cedula,
    fechaCita: fechaLarga(inicio, tz),
    horaInicio: horaCorta(inicio, tz),
    horaFin: horaCorta(fin, tz),
    procedimiento: textoDeProcedimientos(d.procedimientos, d.cita.motivo),
    lugar,
    fecha: fechaLarga(ahora, tz),
  };
}

export interface SeccionHoja {
  titulo: string;
  /** Ya rellena. */
  cuerpo: string;
}

export function seccionesRellenas(
  hojas: ReadonlyArray<{ nombre: string; cuerpo: string }>,
  valores: ValoresHoja,
): SeccionHoja[] {
  return hojas.map((h) => ({ titulo: h.nombre, cuerpo: rellenarHoja(h.cuerpo, valores) }));
}

/** Tope de un texto de WhatsApp (4096) con margen para la firma. */
export const MAX_TEXTO_WHATSAPP = 3800;

/**
 * El WhatsApp con las indicaciones en el propio mensaje. Si no cabe, `null`: se
 * manda el aviso corto y el PDF adjunto (`mensajeCortoConPdf`).
 */
export function mensajeDeIndicaciones(secciones: readonly SeccionHoja[], clinica: string): string | null {
  const cuerpo = secciones
    .map((s) => (secciones.length > 1 ? `*${s.titulo}*\n\n` : "") + hojaATextoWhatsApp(s.cuerpo))
    .join("\n\n— — —\n\n");
  const firma = clinica.trim() ? `\n\n— ${clinica.trim()}` : "";
  const texto = `${cuerpo}${firma}`;
  return texto.length <= MAX_TEXTO_WHATSAPP ? texto : null;
}

export function mensajeCortoConPdf(paciente: string, clinica: string): string {
  return (
    `Hola ${paciente.trim() || "paciente"}, de parte de ${clinica.trim() || "tu clínica"} te compartimos tus ` +
    "indicaciones de cuidado en PDF por este mismo chat. Si no te llegan o tienes dudas, respóndenos por aquí."
  );
}

/**
 * {{1}} nombre del paciente, {{2}} clínica, {{3}} procedimiento — en ESE orden,
 * el de la plantilla propuesta `dc_indicaciones_cuidado`. Sin saltos de línea ni
 * vacíos (Meta rechaza los dos).
 */
export function datosDePlantilla(primerNombre: string, clinica: string, procedimiento: string): string[] {
  const limpio = (s: string) => s.replace(/\s+/g, " ").trim();
  return [limpio(primerNombre) || "paciente", limpio(clinica) || "tu clínica", limpio(procedimiento) || "tu consulta"];
}

export type MotivoSinWhatsApp =
  | "WA_SIN_CONECTAR"
  | "SIN_TELEFONO"
  | "FUERA_DE_VENTANA"
  | "PLANTILLA_EN_REVISION"
  | "PLANTILLA_RECHAZADA";

export interface VistaWhatsApp {
  /** text = el texto (o el aviso + PDF); template = solo el aviso de la plantilla; blocked = no sale. */
  modo: "text" | "template" | "blocked";
  motivo: MotivoSinWhatsApp | null;
}

export interface DatosVistaWhatsApp {
  clinica: { waConnected: boolean | null; waPhoneNumberId: string | null; conToken: boolean; waTemplates: unknown };
  telefono: string | null;
  ultimoEntrante: Date | null;
  ahora: Date;
  kind?: WhatsAppSendKind;
}

/** Por qué canal saldría, con las MISMAS piezas que el envío (`decideSendMode`). */
export function vistaWhatsAppIndicaciones(d: DatosVistaWhatsApp): VistaWhatsApp {
  if (!d.clinica.waConnected || !d.clinica.waPhoneNumberId || !d.clinica.conToken) {
    return { modo: "blocked", motivo: "WA_SIN_CONECTAR" };
  }
  if (!(d.telefono ?? "").trim()) return { modo: "blocked", motivo: "SIN_TELEFONO" };
  const decision = decideSendMode({
    kind: d.kind ?? KIND_ENVIO_INDICACIONES,
    windowOpen: isWithin24hWindow(d.ultimoEntrante, d.ahora),
    templates: parseWaTemplates(d.clinica.waTemplates ?? null),
    params: ["x", "x", "x"],
  });
  if (decision.mode === "blocked") {
    const r = decision.reason;
    if (/todavía no aprueba/i.test(r)) return { modo: "blocked", motivo: "PLANTILLA_EN_REVISION" };
    if (/rechazó/i.test(r)) return { modo: "blocked", motivo: "PLANTILLA_RECHAZADA" };
    return { modo: "blocked", motivo: "FUERA_DE_VENTANA" };
  }
  return { modo: decision.mode, motivo: null };
}
