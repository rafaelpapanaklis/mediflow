/**
 * De la cita REAL (`AgendaAppointmentDTO`) a lo que pintan las tres vistas.
 *
 * Una sola función (`aCitaVista`) decide el chip, el detalle y los colores.
 * Día, Semana y Mes consumen el resultado y no vuelven a derivar nada: si el
 * texto de «esperando 24 min» se calculara en tres sitios, tarde o temprano
 * los tres dirían cosas distintas.
 *
 * Nada de datos del prototipo: aquí entran doctores, unidades y citas de
 * verdad. Lo que el diseño enseña y el sistema no tiene (el importe de la
 * cita, «paciente desde 2023») simplemente no se pinta — ver el reporte.
 *
 * 🔴 Toda hora sale de la zona de la CLÍNICA (`timezone` de la sesión), nunca
 * del navegador ni del servidor.
 */

import { formatTimeInTz } from "@/lib/agenda/date-ranges";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import type {
  AgendaAppointmentDTO,
  AppointmentStatus,
  DoctorColumnDTO,
  ResourceDTO,
} from "@/lib/agenda/types";
import { PINTA_POR_ESTADO, type PintaEstado } from "./estados";
import { minutosEnTz } from "./geometria";
import { AGENDA_TOKENS } from "./tokens";

/** Un responsable tal y como lo pintan las tres vistas. */
export interface ResponsableVista {
  id: string;
  /** Nombre completo, para el encabezado de columna y el panel. */
  nombre: string;
  /** Nombre corto, para chips y leyendas. */
  nombreCorto: string;
  color: string;
  iniciales: string;
}

/** Una cita, ya masticada para pintar. */
export interface CitaVista {
  id: string;
  /** Minutos desde medianoche, hora de pared de la clínica. */
  inicioMin: number;
  /** Duración en minutos (mínimo 5, para que una cita rota no salga invisible). */
  duracionMin: number;
  /** `HH:MM–HH:MM`. */
  rango: string;
  /** `HH:MM` de inicio, para la tarjeta compacta de Semana. */
  horaInicio: string;
  nombrePaciente: string;
  /** `null` cuando el paciente está restringido para quien mira. */
  pacienteId: string | null;
  /** El motivo/tratamiento. Cadena vacía si la cita no lo tiene. */
  tratamiento: string;
  /** La segunda línea del diseño: «Resina · desde 11:04 · 16 min». */
  detalle: string;
  estado: AppointmentStatus;
  pinta: PintaEstado;
  /** El chip ya con sus minutos: «Esperando · 24 min». */
  chip: string;
  responsableId: string | null;
  responsableNombre: string;
  colorResponsable: string;
  unidadId: string | null;
  unidadNombre: string | null;
  esTeleconsulta: boolean;
  /** La cita venía del portal/web y espera que recepción la valide. */
  esperaValidacion: boolean;
  /** Minutos que lleva esperando (llegó y aún no entró). `null` si no aplica. */
  minutosEsperando: number | null;
  /** Minutos que lleva en consulta. `null` si no aplica. */
  minutosEnConsulta: number | null;
  motivoCancelacion: string | null;
  /** El DTO crudo, por si el panel necesita algo que no está aquí. */
  dto: AgendaAppointmentDTO;
}

export interface ContextoVista {
  timezone: string;
  doctores: readonly DoctorColumnDTO[];
  unidades: readonly ResourceDTO[];
  /** El reloj. Se inyecta para poder probarlo; en la UI es `new Date()`. */
  ahora: Date;
}

/** Los responsables visibles, en el orden en que los da el servidor. */
export function aResponsablesVista(doctores: readonly DoctorColumnDTO[]): ResponsableVista[] {
  return doctores.map((d) => ({
    id: d.id,
    nombre: d.displayName,
    nombreCorto: d.shortName,
    // El color de un doctor es un dato de la clínica (se edita en Equipo), no
    // una decisión de esta pantalla: manda `doctorColorFor`, que es el mismo
    // que usa la agenda de siempre. Sin color propio, cae en la paleta por
    // hash del id — estable entre recargas y entre vistas.
    color: doctorColorFor(d.id, d.color),
    iniciales: doctorInitials(d.shortName || d.displayName),
  }));
}

/** Minutos enteros entre dos instantes, nunca negativos. */
function minutosDesde(iso: string | null | undefined, ahora: Date): number | null {
  if (!iso) return null;
  const ms = ahora.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 60_000));
}

/**
 * La segunda línea de la tarjeta y el subtítulo del panel.
 *
 * El diseño pone aquí cosas que el sistema sí sabe (la hora de llegada, los
 * minutos en consulta) y una que no (el importe: «Por cobrar $850»). Lo que no
 * sabemos no se inventa: se omite.
 */
function detalleDe(args: {
  estado: AppointmentStatus;
  timezone: string;
  checkedInAt?: string | null;
  startedAt?: string | null;
  cancelReason?: string | null;
  minutosEsperando: number | null;
  minutosEnConsulta: number | null;
}): string {
  const { estado, timezone } = args;
  switch (estado) {
    case "SCHEDULED":
      return "Pendiente de confirmar";
    case "CONFIRMED":
      return "Confirmada";
    // Los minutos solo se dicen cuando hay minutos: «espera 0 min» y «0 min en
    // la clínica» se leen mal y no aportan nada — el paciente acaba de llegar.
    case "CHECKED_IN": {
      const hora = args.checkedInAt ? formatTimeInTz(args.checkedInAt, timezone) : null;
      const esp = args.minutosEsperando;
      if (hora && esp !== null && esp > 0) return `llegó ${hora} · espera ${esp} min`;
      if (hora) return `llegó ${hora}`;
      return "En sala de espera";
    }
    case "IN_CHAIR": {
      const hora = args.checkedInAt ? formatTimeInTz(args.checkedInAt, timezone) : null;
      const esp = args.minutosEsperando;
      if (hora && esp !== null && esp > 0) return `en el sillón · llegó ${hora} · ${esp} min`;
      if (hora) return `en el sillón · llegó ${hora}`;
      return "En el sillón";
    }
    case "IN_PROGRESS": {
      const hora = args.startedAt ? formatTimeInTz(args.startedAt, timezone) : null;
      const run = args.minutosEnConsulta;
      if (hora && run !== null && run > 0) return `desde ${hora} · ${run} min`;
      if (hora) return `desde ${hora}`;
      return "En consulta";
    }
    case "COMPLETED":
      return "Consulta terminada";
    case "CHECKED_OUT":
      return "El paciente ya salió";
    case "CANCELLED":
      return args.cancelReason ? `Cancelada · ${args.cancelReason}` : "Cancelada";
    case "NO_SHOW":
      return "El paciente no asistió";
  }
}

/** El texto del chip, con los minutos cuando el estado los pide. */
function chipDe(estado: AppointmentStatus, pinta: PintaEstado, minutosEsperando: number | null): string {
  if (estado === "CHECKED_IN" && minutosEsperando !== null && minutosEsperando > 0) {
    return `${pinta.chipTexto} · ${minutosEsperando} min`;
  }
  return pinta.chipTexto;
}

/** Una cita real → el modelo que pintan las tres vistas. */
export function aCitaVista(dto: AgendaAppointmentDTO, ctx: ContextoVista): CitaVista {
  const { timezone } = ctx;
  const inicioMin = minutosEnTz(dto.startsAt, timezone);

  // Sin `endsAt` la cita duraría 0 px y sería inclicable. 30 min es el mismo
  // fallback que usa `assignLanes`, para que el carril y la tarjeta coincidan.
  const finMs = dto.endsAt ? new Date(dto.endsAt).getTime() : new Date(dto.startsAt).getTime() + 30 * 60_000;
  const duracionCruda = (finMs - new Date(dto.startsAt).getTime()) / 60_000;
  const duracionMin = Math.max(5, Number.isFinite(duracionCruda) ? duracionCruda : 30);

  const pinta = PINTA_POR_ESTADO[dto.status];

  // Los minutos de espera solo tienen sentido mientras se espera: una vez
  // terminada la cita, «espera 240 min» sería ruido (y crecería solo).
  const enEspera = dto.status === "CHECKED_IN" || dto.status === "IN_CHAIR";
  const minutosEsperando = enEspera ? minutosDesde(dto.checkedInAt, ctx.ahora) : null;
  const minutosEnConsulta = dto.status === "IN_PROGRESS" ? minutosDesde(dto.startedAt, ctx.ahora) : null;

  const responsableId = dto.doctor?.id ?? null;
  const responsable = responsableId ? ctx.doctores.find((d) => d.id === responsableId) : undefined;
  const unidad = dto.resourceId ? ctx.unidades.find((r) => r.id === dto.resourceId) : undefined;

  return {
    id: dto.id,
    inicioMin,
    duracionMin,
    rango: dto.endsAt
      ? `${formatTimeInTz(dto.startsAt, timezone)}–${formatTimeInTz(dto.endsAt, timezone)}`
      : formatTimeInTz(dto.startsAt, timezone),
    horaInicio: formatTimeInTz(dto.startsAt, timezone),
    nombrePaciente: dto.patient.name,
    // `maskedPatient` devuelve id vacío cuando el paciente está restringido
    // para quien mira: sin esto, el panel enlazaría a /dashboard/patients/.
    pacienteId: dto.patient.id ? dto.patient.id : null,
    tratamiento: dto.reason ?? "",
    detalle: detalleDe({
      estado: dto.status,
      timezone,
      checkedInAt: dto.checkedInAt,
      startedAt: dto.startedAt,
      cancelReason: dto.cancelReason,
      minutosEsperando,
      minutosEnConsulta,
    }),
    estado: dto.status,
    pinta,
    chip: chipDe(dto.status, pinta, minutosEsperando),
    responsableId,
    responsableNombre: responsable?.displayName ?? dto.doctor?.shortName ?? "Sin responsable",
    colorResponsable: responsableId
      ? doctorColorFor(responsableId, responsable?.color ?? null)
      : AGENDA_TOKENS.texto2,
    unidadId: dto.resourceId,
    unidadNombre: unidad?.name ?? null,
    esTeleconsulta: dto.isTeleconsult === true,
    esperaValidacion: dto.requiresValidation === true && dto.status === "SCHEDULED",
    minutosEsperando,
    minutosEnConsulta,
    motivoCancelacion: dto.cancelReason ?? null,
    dto,
  };
}

/**
 * El subtítulo del encabezado de columna: «7 citas · Unidad 1».
 *
 * El diseño ata cada responsable a UNA unidad porque su prototipo es así. En
 * la realidad un doctor puede pasar por varias en el mismo día, así que se
 * listan las que de verdad usa ese día (y si son más de dos, se resumen).
 *
 * 🔢 Qué cuenta «N citas»: todo lo que NO está cancelado, incluidos los
 * plantones (`NO_SHOW`). Dos razones: la columna dibuja esas tarjetas, así
 * que el número tiene que cuadrar con lo que se ve; y para el dueño «18
 * citas» que acaban en 15 atendidas es justo el dato. Los minutos ocupados
 * son otra cuenta y ésa sí usa `citaViva` (un plantón no ocupa el sillón).
 * Mismo criterio que la vista Mes de ws1-t2, acordado para que las tres
 * vistas no se contradigan en la misma pantalla.
 */
export function resumenDeColumna(citas: readonly CitaVista[]): string {
  const contadas = citas.filter((c) => c.estado !== "CANCELLED");
  const nCitas = contadas.length;
  const texto = nCitas === 1 ? "1 cita" : `${nCitas} citas`;

  const unidades: string[] = [];
  for (const c of contadas) {
    if (c.unidadNombre && !unidades.includes(c.unidadNombre)) unidades.push(c.unidadNombre);
  }
  if (unidades.length === 0) return texto;
  if (unidades.length <= 2) return `${texto} · ${unidades.join(" · ")}`;
  return `${texto} · ${unidades.length} unidades`;
}
