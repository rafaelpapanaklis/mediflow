/**
 * Frases de los movimientos que se repiten en varias rutas (citas, dinero,
 * archivos). Puras: reciben lo que ya tiene la ruta a la mano y devuelven texto
 * en español. NUNCA reciben ni imprimen contenido clínico: qué se hizo, no qué
 * contenía (una nota, un diagnóstico, el nombre de un archivo con el nombre de
 * una enfermedad… no entran aquí).
 */
import { NOMBRE_CATEGORIA_ES } from "@/lib/uploads/categorias-archivo";

const ZONA_POR_DEFECTO = "America/Mexico_City";

function zonaValida(tz?: string | null): string {
  const raw = (tz ?? "").trim();
  if (!raw) return ZONA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: raw }).format(new Date(0));
    return raw;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

/** «3 oct 2026, 10:00» en la zona de la clínica. */
export function fechaHoraParaTexto(d: Date | string | null | undefined, tz?: string | null): string {
  if (!d) return "fecha sin definir";
  const fecha = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(fecha.getTime())) return "fecha sin definir";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: zonaValida(tz),
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(fecha)
    .replace(",", "");
}

/** «14:13» en la zona de la clínica. */
export function horaParaTexto(d: Date | string | null | undefined, tz?: string | null): string {
  if (!d) return "hora sin definir";
  const fecha = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(fecha.getTime())) return "hora sin definir";
  return new Intl.DateTimeFormat("es-MX", { timeZone: zonaValida(tz), hour: "2-digit", minute: "2-digit", hour12: false }).format(fecha);
}

export const ESTADO_CITA: Record<string, string> = {
  PENDING: "Pendiente",
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  CHECKED_IN: "Registrado en recepción",
  IN_CHAIR: "En sillón",
  IN_PROGRESS: "En consulta",
  COMPLETED: "Completada",
  CHECKED_OUT: "Salió",
  CANCELLED: "Cancelada",
  NO_SHOW: "No asistió",
};

export function estadoDeCita(status: string | null | undefined): string {
  return (status && ESTADO_CITA[status]) || "otro estado";
}

export const textoCita = {
  agendada: (startsAt: Date | string, tz?: string | null) =>
    `Agendó una cita para el ${fechaHoraParaTexto(startsAt, tz)}`,
  movida: (antes: Date | string, despues: Date | string, tz?: string | null) =>
    `Movió una cita del ${fechaHoraParaTexto(antes, tz)} al ${fechaHoraParaTexto(despues, tz)}`,
  editada: (startsAt: Date | string, tz?: string | null) =>
    `Modificó la cita del ${fechaHoraParaTexto(startsAt, tz)}`,
  cancelada: (startsAt: Date | string, tz?: string | null) =>
    `Canceló la cita del ${fechaHoraParaTexto(startsAt, tz)}`,
  completada: (startsAt: Date | string, tz?: string | null) =>
    `Completó la consulta del ${fechaHoraParaTexto(startsAt, tz)}`,
  eliminada: (startsAt: Date | string, tz?: string | null) =>
    `Eliminó la cita del ${fechaHoraParaTexto(startsAt, tz)}`,
  // ws1-t8 (decisión 6): el paciente de una cita futura llegó hoy y la cita se trajo a hoy. «Hoy» es el día
  // del movimiento (cada fila lleva su fecha): la hora nueva sola se lee sin confundirla con la fecha vieja.
  adelantadaAHoy: (antes: Date | string, despues: Date | string, tz?: string | null) =>
    `Cita adelantada del ${fechaHoraParaTexto(antes, tz)} a hoy ${horaParaTexto(despues, tz)} porque el paciente llegó (sin avisar al paciente)`,
  estado: (startsAt: Date | string, de: string | null | undefined, a: string, tz?: string | null) =>
    `Cambió la cita del ${fechaHoraParaTexto(startsAt, tz)} de «${estadoDeCita(de)}» a «${estadoDeCita(a)}»`,
};

export function montoParaTexto(monto: number | string | { toString(): string } | null | undefined): string {
  const n = Number(monto);
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

/**
 * «una radiografía», «un modelo 3D»… según la categoría del archivo. NUNCA el
 * nombre del archivo: a menudo lleva el nombre de la persona o del estudio.
 */
export function sustantivoDeArchivo(category: string | null | undefined): string {
  const c = category ?? "";
  if (c === "XRAY_CBCT") return "una tomografía (CBCT)";
  if (c === "XRAY_CEPHALOMETRIC") return "una cefalometría";
  if (c.indexOf("XRAY_") === 0) return "una radiografía";
  if (c.indexOf("ORTHO_PHOTO") === 0) return "una foto de ortodoncia";
  if (c.indexOf("PHOTO_") === 0) return "una foto";
  if (c === "SCAN_STL") return "un modelo 3D";
  if (c === "CONSENT_FORM") return "un consentimiento firmado";
  if (c === "CEPH_ANALYSIS_PDF") return "un análisis cefalométrico";
  return "un documento";
}

export const textoArchivo = {
  subido: (category: string | null | undefined) => `Subió ${sustantivoDeArchivo(category)}`,
  quitado: (category: string | null | undefined) => `Quitó ${sustantivoDeArchivo(category)}`,
  anotado: (category: string | null | undefined) => `Actualizó las notas de ${sustantivoDeArchivo(category)}`,
  // Nunca el nombre del archivo: el tipo basta para saber qué se corrigió.
  tipoCambiado: (de: string | null | undefined, a: string | null | undefined) =>
    `Cambió el tipo de un estudio: de «${nombreDeTipo(de)}» a «${nombreDeTipo(a)}»`,
};

function nombreDeTipo(category: string | null | undefined): string {
  return (category && NOMBRE_CATEGORIA_ES[category]) || "Otro";
}

export const ESTADO_PRESUPUESTO: Record<string, string> = {
  DRAFT: "Borrador",
  PRESENTED: "Presentado",
  SENT: "Enviado",
  ACCEPTED: "Aceptado",
  REJECTED: "Rechazado",
  EXPIRED: "Vencido",
  INVOICED: "Facturado",
};

export function estadoDePresupuesto(status: string | null | undefined): string {
  return (status && ESTADO_PRESUPUESTO[status]) || "otro estado";
}
