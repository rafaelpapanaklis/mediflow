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
/**
 * Estados en que la consulta ya EMPEZÓ o TERMINÓ: solo entonces se puede hacer constar la asistencia (N-29, decisión
 * de Rafael). Antes bastaba «Registrado» (el paciente acababa de llegar) y salía un justificante de una consulta que
 * nadie había dado.
 */
export const ESTADOS_CON_CONSTANCIA = ["IN_PROGRESS", "COMPLETED", "CHECKED_OUT"] as const;

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
 * La hora que consta: la REAL (N-29, segunda auditoría; decisión de Rafael). Inicio = llegada registrada o, si no,
 * el inicio de la consulta; fin = fin de la consulta (el mismo día) o, con la consulta todavía en curso, la hora en
 * que se emite. `null` si el sistema no tiene ninguna hora real: entonces no se puede hacer constar nada.
 *
 * (En la primera ronda —C-60— constaba la hora de la agenda; la decisión de Rafael para la segunda es la real.)
 */
export function horarioQueConsta(c: CitaParaHoja, tz: string | null | undefined, ahora: Date = new Date()): { inicio: Date; fin: Date } | null {
  const inicio = c.checkedInAt ?? c.startedAt;
  if (!inicio) return null;
  const finReal = c.completedAt && c.completedAt > inicio && mismoDia(c.completedAt, inicio, tz) ? c.completedAt : null;
  if (finReal) return { inicio, fin: finReal };
  if (c.status === "IN_PROGRESS" && ahora > inicio && mismoDia(ahora, inicio, tz)) return { inicio, fin: ahora };
  return null;
}

const mismoDia = (a: Date, b: Date, tz: string | null | undefined) => fechaLarga(a, tz) === fechaLarga(b, tz);

/** Por qué NO se puede emitir la constancia de esta cita (o `null` si sí). N-29. */
export type MotivoSinConstancia = "ESTADO" | "DIA_FUTURO" | "SIN_HORA_REAL";

export const MENSAJE_SIN_CONSTANCIA: Record<MotivoSinConstancia, string> = {
  ESTADO: "La constancia se emite cuando la consulta ya empezó o terminó.",
  DIA_FUTURO: "Esta cita es de un día que todavía no llega: no se puede hacer constar la asistencia.",
  SIN_HORA_REAL: "La cita no tiene registrada la hora real de llegada o de inicio: no se puede hacer constar.",
};

export function motivoSinConstancia(c: CitaParaHoja, tz: string | null | undefined, ahora: Date = new Date()): MotivoSinConstancia | null {
  if (!admiteConstancia(c.status)) return "ESTADO";
  // Una cita de un día que no ha llegado no se atendió, aunque esté marcada «Completada».
  const dia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || TZ_POR_DEFECTO, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  if (dia(c.startsAt) > dia(ahora)) return "DIA_FUTURO";
  if (!horarioQueConsta(c, tz, ahora)) return "SIN_HORA_REAL";
  return null;
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
  // Sin hora real (o antes de pedir la constancia) se pinta la agendada solo para las INDICACIONES; la constancia la
  // corta antes `motivoSinConstancia`.
  const real = horarioQueConsta(d.cita, tz, ahora);
  const inicio = real?.inicio ?? d.cita.startsAt;
  const fin = real?.fin ?? d.cita.endsAt;
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
    horaFin: horaFinQueConsta(inicio, fin, tz),
    procedimiento: textoDeProcedimientos(d.procedimientos, d.cita.motivo),
    lugar,
    fecha: fechaLarga(ahora, tz),
  };
}

/**
 * N-C (comprobación final): una consulta de menos de un minuto salía «de las 06:16 a las 06:16». La plantilla dice
 * «de las {horaInicio} a las {horaFin}», así que el fin se muestra al menos un minuto después del inicio (06:16 →
 * 06:17). Solo cambia lo que se imprime cuando las dos horas caen en el mismo minuto.
 */
export function horaFinQueConsta(inicio: Date, fin: Date, tz: string | null | undefined): string {
  const h = horaCorta(fin, tz);
  return h === horaCorta(inicio, tz) ? horaCorta(new Date(inicio.getTime() + 60_000), tz) : h;
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
