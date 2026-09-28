// Portal del paciente — las DECISIONES de la página «Tu ortodoncia» y de la
// cita nueva cuando una cuenta lleva a varios pacientes (ws1-t5, ronda 6,
// hallazgos 93 a 96 y fila 16 del mapa de la revisión de lógica de uso).
//
// PURO: sin Prisma, sin "server-only", sin `new Date()` implícito. Quien lo
// conecta a la base es `GET /api/paciente/ortodoncia`, las dos acciones del
// portal (`alineadores/_patient-context.ts`) y `POST /api/paciente/appointments`.
//
// Reglas de visibilidad (contrato del portal, `types.ts`): al paciente NUNCA
// se le enseña la nota clínica del control (S, O, A, P). Lo que sale de aquí
// son las INDICACIONES que la doctora escribió para él y los elásticos que
// le dejó puestos.

import { differenceInMonths } from "date-fns";
import { dateISOInTz } from "@/lib/agenda/legacy-helpers";
import { ESTADOS_CASO_ABIERTO } from "./ortodoncia-menu";

// ── El día de la clínica ─────────────────────────────────────────────────────

const ZONA_POR_DEFECTO = "America/Mexico_City";

/**
 * "YYYY-MM-DD" del día que es AHORA en la clínica. El registro diario de
 * elásticos se guardaba con el día en UTC: en México, después de las 18:00,
 * «hoy» ya contaba para mañana.
 */
export function diaDeLaClinica(ahora: Date, zonaHoraria: string | null | undefined): string {
  try {
    return dateISOInTz(ahora, zonaHoraria || ZONA_POR_DEFECTO);
  } catch {
    // Una zona mal escrita en la clínica no puede tumbar el portal.
    return dateISOInTz(ahora, ZONA_POR_DEFECTO);
  }
}

/** El día guardado en la base (medianoche UTC del día de la clínica) → "YYYY-MM-DD". */
export function diaDelRegistro(logDate: Date): string {
  return logDate.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → la fecha que se guarda (medianoche UTC de ese día). */
export function fechaDeRegistro(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}

/** El primer día de la ventana de `dias` que termina hoy (incluido). */
export function inicioDeVentana(hoy: string, dias: number): Date {
  const d = fechaDeRegistro(hoy);
  d.setUTCDate(d.getUTCDate() - dias);
  return d;
}

// ── Qué puede hacer el paciente con su caso ──────────────────────────────────

export interface PermisosDelCaso {
  /** Caso cerrado o módulo apagado: el paciente lee, pero no registra ni manda fotos. */
  soloLectura: boolean;
  /** Frase para el paciente cuando es de solo lectura; `null` si no lo es. */
  aviso: string | null;
}

/**
 * El paciente SIEMPRE puede leer su caso (es su expediente, NOM-004), esté
 * abierto, terminado o con el módulo de la clínica vencido. Lo que se apaga
 * es lo que ESCRIBE: el registro diario y las fotos, que nadie revisaría.
 */
export function permisosDelCaso(estado: string, moduloActivo: boolean): PermisosDelCaso {
  if (estado === "COMPLETED") {
    return { soloLectura: true, aviso: "Este caso ya terminó. Aquí queda tu información para consultarla." };
  }
  if (estado === "DROPPED_OUT") {
    return { soloLectura: true, aviso: "Este caso está cerrado. Si quieres retomarlo, ponte en contacto con tu clínica." };
  }
  if (!(ESTADOS_CASO_ABIERTO as readonly string[]).includes(estado)) {
    return { soloLectura: true, aviso: "Este caso está cerrado." };
  }
  if (!moduloActivo) {
    return {
      soloLectura: true,
      aviso: "Por ahora tu clínica no recibe registros ni fotos por aquí. Tu información sigue disponible.",
    };
  }
  return { soloLectura: false, aviso: null };
}

/** Cómo se le dice al paciente en qué va su caso. */
export function estadoDelCasoParaPaciente(estado: string): string {
  switch (estado) {
    case "PLANNED":
      return "Por iniciar";
    case "IN_PROGRESS":
      return "En tratamiento";
    case "ON_HOLD":
      return "En pausa";
    case "RETENTION":
      return "En retención";
    case "COMPLETED":
      return "Terminado";
    case "DROPPED_OUT":
      return "Cerrado";
    default:
      return "Sin estado";
  }
}

// ── El registro diario: solo a quien lleva elásticos o alineadores ──────────

export interface RegistroDiario {
  /** false = no se le pregunta nada. */
  preguntar: boolean;
  /** La pregunta exacta, según lo que lleva. */
  pregunta: string;
}

export interface LoQueLleva {
  estado: string;
  soloLectura: boolean;
  /** Elásticos que dejó puestos el último control FIRMADO. */
  elasticosVigentes: number;
  /** Estado del caso de alineadores ("ACTIVE" | "PAUSED" | "FINISHED") o `null` si no tiene. */
  estadoAlineador: string | null;
}

const SIN_PREGUNTA: RegistroDiario = { preguntar: false, pregunta: "" };

/**
 * «¿Usaste tus elásticos o tu alineador hoy?» se le preguntaba a todos: al
 * que lleva brackets sin elásticos, al que está en pausa y al que ya terminó.
 */
export function registroDiario(c: LoQueLleva): RegistroDiario {
  if (c.soloLectura) return SIN_PREGUNTA;
  // En pausa no hay nada que usar; en retención lo que lleva es un retenedor.
  if (c.estado !== "IN_PROGRESS" && c.estado !== "PLANNED") return SIN_PREGUNTA;

  const elasticos = c.elasticosVigentes > 0;
  const alineador = c.estadoAlineador === "ACTIVE";
  if (elasticos && alineador) return { preguntar: true, pregunta: "¿Usaste hoy tus alineadores y tus elásticos?" };
  if (elasticos) return { preguntar: true, pregunta: "¿Usaste tus elásticos hoy?" };
  if (alineador) return { preguntar: true, pregunta: "¿Usaste tus alineadores hoy?" };
  return SIN_PREGUNTA;
}

// ── Avance: «Mes 2 de 18 · Alineación» ───────────────────────────────────────

export const FASES_PARA_PACIENTE: Record<string, string> = {
  ALIGNMENT: "Alineación",
  LEVELING: "Nivelación",
  SPACE_CLOSURE: "Cierre de espacios",
  DETAILS: "Detalles",
  FINISHING: "Finalización",
  RETENTION: "Retención",
};

export interface AvanceDelCaso {
  /** Mes en el que va, contado como lo cuenta la ficha de la clínica. `null` = aún no se colocan los aparatos. */
  mes: number | null;
  /** Duración estimada, en meses. */
  de: number;
  /** Fase en curso, en español; `null` si no hay ninguna en curso. */
  fase: string | null;
  /** La frase completa, lista para pintar. */
  texto: string;
}

export function avanceDelCaso(args: {
  installedAt: Date | null;
  estimatedDurationMonths: number | null;
  fases: Array<{ phaseKey: string; status: string; orderIndex: number }>;
  ahora: Date;
}): AvanceDelCaso {
  const de = Math.max(0, args.estimatedDurationMonths ?? 0);
  const enCurso = [...args.fases]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .find((f) => f.status === "IN_PROGRESS");
  const fase = enCurso ? (FASES_PARA_PACIENTE[enCurso.phaseKey] ?? null) : null;

  // La MISMA cuenta que la ficha (`load-data.ts`): meses cumplidos desde la colocación.
  const mes = args.installedAt ? Math.max(0, differenceInMonths(args.ahora, args.installedAt)) : null;

  let texto: string;
  if (mes === null) {
    texto = de > 0 ? `Duración estimada: ${de} ${de === 1 ? "mes" : "meses"}` : "Tu tratamiento está por iniciar";
  } else if (mes === 0) {
    texto = de > 0 ? `Primer mes de ${de}` : "Primer mes";
  } else {
    texto = de > 0 ? `Mes ${mes} de ${de}` : `Mes ${mes}`;
  }
  if (fase) texto += ` · ${fase}`;

  return { mes, de, fase, texto };
}

/** 0–100 para la barra de avance; `null` si no hay con qué calcularlo. */
export function porcentajeDeAvance(a: Pick<AvanceDelCaso, "mes" | "de">): number | null {
  if (a.mes === null || a.de <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((a.mes / a.de) * 100)));
}

// ── Indicaciones del último control ──────────────────────────────────────────

const CLASES_DE_ELASTICO: Record<string, string> = {
  CLASE_I: "Clase I",
  CLASE_II: "Clase II",
  CLASE_III: "Clase III",
  BOX: "En caja",
  CRISS_CROSS: "Cruzados",
  SETTLING: "De asentamiento",
};

const ZONAS_DE_ELASTICO: Record<string, string> = {
  ANTERIOR: "al frente",
  POSTERIOR: "atrás",
  INTERMAXILAR: "de arriba a abajo",
};

export interface ElasticoParaPaciente {
  /** «Clase II · 1/4" 6oz · de arriba a abajo» */
  texto: string;
}

export function elasticoParaPaciente(e: { elasticClass: string; config: string; zone: string }): ElasticoParaPaciente {
  const partes = [
    CLASES_DE_ELASTICO[e.elasticClass] ?? e.elasticClass,
    (e.config ?? "").trim(),
    ZONAS_DE_ELASTICO[e.zone] ?? "",
  ].filter((p) => p.length > 0);
  return { texto: partes.join(" · ") };
}

export interface UltimoControlParaPaciente {
  /** "YYYY-MM-DD", en el día de la clínica. */
  fecha: string;
  /** Lo que la doctora escribió PARA EL PACIENTE. Nunca la nota clínica. */
  indicaciones: string | null;
  elasticos: ElasticoParaPaciente[];
}

export function ultimoControlParaPaciente(
  hoja: {
    visitDate: Date;
    indications: string | null;
    elastics: Array<{ elasticClass: string; config: string; zone: string }>;
  } | null,
  zonaHoraria: string | null | undefined,
): UltimoControlParaPaciente | null {
  if (!hoja) return null;
  const indicaciones = (hoja.indications ?? "").trim();
  return {
    fecha: diaDeLaClinica(hoja.visitDate, zonaHoraria),
    indicaciones: indicaciones.length > 0 ? indicaciones : null,
    elasticos: hoja.elastics.map(elasticoParaPaciente),
  };
}

// ── Calendario de mensualidades ──────────────────────────────────────────────

export type EstadoDeMensualidad = "pagada" | "vencida" | "porVencer";

export interface MensualidadParaPaciente {
  /** «Enganche», «Mensualidad 3» o «Control». */
  etiqueta: string;
  /** "YYYY-MM-DD" o `null` si no tiene fecha. */
  vencimiento: string | null;
  importeMxn: number;
  /** Lo que le falta a ESTA mensualidad. 0 si está pagada. */
  faltaMxn: number;
  estado: EstadoDeMensualidad;
  /** La siguiente que toca pagar. */
  esLaQueSigue: boolean;
}

interface CuotaDeEntrada {
  numero: number;
  esEnganche: boolean;
  importe: number;
  vencimiento: string | null;
  falta: number;
  estado: EstadoDeMensualidad;
  invoiceId?: string;
}

/**
 * El calendario completo, en orden: lo pagado, lo vencido y lo que viene.
 * Sale del MISMO resumen que usa Cobranza en la clínica, así que el paciente
 * y recepción ven las mismas cifras.
 */
export function calendarioDeMensualidades(cobranza: {
  pagadas: CuotaDeEntrada[];
  vencidas: CuotaDeEntrada[];
  proximas: CuotaDeEntrada[];
  cuotaDeHoy: CuotaDeEntrada | null;
}): MensualidadParaPaciente[] {
  const todas = [...cobranza.pagadas, ...cobranza.vencidas, ...cobranza.proximas];
  // En «pago por control» cada cargo es una factura aparte y no lleva número de mensualidad.
  const porControl = todas.some((c) => c.invoiceId !== undefined);
  const laQueSigue = cobranza.cuotaDeHoy;

  return todas
    .slice()
    .sort((a, b) => {
      if (a.esEnganche !== b.esEnganche) return a.esEnganche ? -1 : 1;
      if (a.vencimiento && b.vencimiento && a.vencimiento !== b.vencimiento) {
        return a.vencimiento < b.vencimiento ? -1 : 1;
      }
      if (!!a.vencimiento !== !!b.vencimiento) return a.vencimiento ? -1 : 1;
      return a.numero - b.numero;
    })
    .map((c) => ({
      etiqueta: c.esEnganche ? "Enganche" : porControl ? "Control" : `Mensualidad ${c.numero}`,
      vencimiento: c.vencimiento,
      importeMxn: Math.round(c.importe * 100) / 100,
      faltaMxn: Math.round(c.falta * 100) / 100,
      estado: c.estado,
      esLaQueSigue:
        !!laQueSigue &&
        laQueSigue.numero === c.numero &&
        laQueSigue.esEnganche === c.esEnganche &&
        laQueSigue.invoiceId === c.invoiceId &&
        laQueSigue.vencimiento === c.vencimiento,
    }));
}

// ── Una cuenta, varios pacientes (la mamá con dos hijos) ─────────────────────

export interface VinculoConNombre {
  patientId: string;
  clinicId: string;
  nombre: string;
}

/**
 * ¿Hay que decir de quién es cada tarjeta? Sí, en cuanto la cuenta lleva a
 * más de un paciente: dos tarjetas «Clínica Sonrisa» iguales no dicen de cuál
 * hijo es cada una.
 */
export function hayQueNombrarAlPaciente(vinculos: Array<{ patientId: string }>): boolean {
  return new Set(vinculos.map((v) => v.patientId)).size > 1;
}

export type ResultadoDePaciente =
  | { ok: true; patientId: string }
  | { ok: false; motivo: "sin-vinculo" | "falta-elegir" | "ajeno" };

/**
 * Para quién es la cita. El `patientId` que manda el navegador SOLO vale si
 * es uno de los vínculos de la sesión EN ESA clínica. Si la cuenta tiene a
 * varios pacientes en la clínica y no dijo cuál, NO se adivina: antes la cita
 * del segundo hijo quedaba a nombre del primero.
 */
export function pacienteDeLaCita(
  vinculos: Array<{ patientId: string; clinicId: string }>,
  clinicId: string,
  pedido: string | null | undefined,
): ResultadoDePaciente {
  const enLaClinica = vinculos.filter((v) => v.clinicId === clinicId && v.patientId);
  if (enLaClinica.length === 0) return { ok: false, motivo: "sin-vinculo" };

  const elegido = (pedido ?? "").trim();
  if (elegido) {
    return enLaClinica.some((v) => v.patientId === elegido)
      ? { ok: true, patientId: elegido }
      : { ok: false, motivo: "ajeno" };
  }

  const distintos = Array.from(new Set(enLaClinica.map((v) => v.patientId)));
  if (distintos.length > 1) return { ok: false, motivo: "falta-elegir" };
  return { ok: true, patientId: distintos[0]! };
}

// ── Fechas para pintar ───────────────────────────────────────────────────────

/**
 * «5 oct 2026» a partir de "YYYY-MM-DD", SIN pasar por la zona del teléfono:
 * `new Date("2026-10-05")` es medianoche UTC y en México se pintaba «4 oct».
 */
export function fechaSinHora(dia: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia);
  if (!m) return dia;
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}

/** «martes 29 de septiembre a las 19:00» de un instante, en la hora de la CLÍNICA. */
export function fechaConHoraEnClinica(iso: string, zonaHoraria: string | null | undefined): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opciones: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = new Intl.DateTimeFormat("es-MX", { ...opciones, timeZone: zonaHoraria || ZONA_POR_DEFECTO }).formatToParts(d);
  } catch {
    partes = new Intl.DateTimeFormat("es-MX", { ...opciones, timeZone: ZONA_POR_DEFECTO }).formatToParts(d);
  }
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("weekday")} ${parte("day")} de ${parte("month")} a las ${parte("hour")}:${parte("minute")}`;
}
