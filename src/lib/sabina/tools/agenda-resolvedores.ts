/**
 * Los resolvedores — de «María García», «el Dr. Salas», «el sillón 2» o «la
 * cita de mañana de Juan» a un id.
 *
 * Sin ids no se puede escribir, y las herramientas de lectura no los devuelven.
 * Cada resolvedor contesta UNA de tres cosas:
 *   · `ok`       — exactamente uno, con su id;
 *   · `pregunta` — hay varios, o falta el dato: Sabina PREGUNTA cuál. 🔴 Nunca
 *                  elige. Equivocarse de paciente es peor que no agendar.
 *   · `no`       — no hay ninguno que se pueda usar, con la frase de por qué.
 *
 * Todo id que llega del modelo se vuelve a comprobar contra la sesión (clínica,
 * visibilidad, activo): un id inventado, o de otra clínica, es «no lo
 * encuentro», jamás un atajo.
 *
 * Para ws1-t3 (alta de pacientes): `resolverPaciente` es el resolvedor de
 * paciente por nombre; no hace falta otro.
 */

import { buildAppointmentWhere } from "@/lib/auth-context";
import { canSeePatient, patientVisibilityAnd } from "@/lib/patient-visibility";
import { patientSearchTokens } from "@/lib/patients/patient-search-core";
import { buildPatientSearchSql } from "@/lib/patients/patient-search";
import { comoAuthContext, visorDe } from "./base";
import { etiquetaEstado } from "./estados";
import { horaDe, inicioDeHoy, ventanaDelDia } from "./fechas";
import {
  fechaLarga,
  nombreDe,
  normal,
  telefonoParcial,
  type AgendaDb,
  type OpcionAgenda,
  type PreguntaAgenda,
} from "./agenda-comun";
import type { SabinaCtx } from "../tipos";

export type Resuelto<T> =
  | { tipo: "ok"; valor: T }
  | { tipo: "pregunta"; pregunta: PreguntaAgenda }
  | { tipo: "no"; causa: string; frase: string };

/** Cuántos candidatos se enseñan en una pregunta. Más que esto no es una pregunta, es una lista. */
const TOPE_OPCIONES = 8;

/* ═══════════════════════════════════════════════════════════════════════
   PACIENTE — con el criterio del buscador de «Nueva cita»
   ═══════════════════════════════════════════════════════════════════════ */

export interface PacienteResuelto {
  id: string;
  nombre: string;
  folio: string | null;
  status: string;
  tieneCorreo: boolean;
  /** Solo para avisar si agendar le abrirá la ficha a un doctor. No viaja al modelo. */
  visibleUserIds: string[];
}

/** Mismo tope que `GET /api/patients/search` pide a la consulta normalizada. */
const TOPE_CANDIDATOS = 200;

const SELECT_PACIENTE = {
  id: true,
  firstName: true,
  lastName: true,
  patientNumber: true,
  phone: true,
  email: true,
  status: true,
  visibleUserIds: true,
} as const;

/**
 * El paciente, por id o por nombre / teléfono / folio.
 *
 * 🔴 El criterio es el de `GET /api/patients/search` (el buscador de «Nueva
 * cita»), NO el de `buscar_paciente`: la regla PURA de visibilidad
 * (`patientVisibilityAnd`) en vez de `buildPatientWhere`. A propósito, y lo dice
 * la propia ruta: «agendar exige poder buscar a quien todavía no es tuyo». Con
 * `buildPatientWhere`, un DOCTOR no encontraría al paciente de otro doctor y
 * acabaría dándolo de alta otra vez (N8). Las piezas son las mismas que usa la
 * ruta: `patientSearchTokens` + `buildPatientSearchSql` (sin acentos, teléfono
 * normalizado, folio) y, si esa consulta falla, el `contains` de siempre.
 */
export async function resolverPaciente(
  ctx: SabinaCtx,
  db: AgendaDb,
  args: { pacienteId?: string | null; paciente?: string | null },
): Promise<Resuelto<PacienteResuelto>> {
  const base = {
    clinicId: ctx.clinicId,
    // ARCO: un paciente cancelado no aparece en el buscador, igual que en la ruta.
    deletedAt: null,
  };
  const noEncontrado = (quien: string): Resuelto<PacienteResuelto> => ({
    tipo: "no",
    causa: "paciente_no_encontrado",
    // «Entre los que puedes ver», nunca «no existe»: el servidor responde igual
    // a propósito cuando el paciente es de acceso restringido.
    frase: `No encuentro a ${quien} entre los pacientes que puedes ver.`,
  });

  if (args.pacienteId) {
    const filas = await db.patient.findMany({
      where: { ...base, id: args.pacienteId, AND: patientVisibilityAnd(visorDe(ctx)) },
      select: SELECT_PACIENTE,
      take: 1,
    });
    if (filas.length === 0) return noEncontrado("ese paciente");
    return { tipo: "ok", valor: aPaciente(filas[0]) };
  }

  const termino = (args.paciente ?? "").trim();
  if (termino.length < 2) {
    return {
      tipo: "pregunta",
      pregunta: { falta: "paciente", texto: "¿Para qué paciente? Dime su nombre, teléfono o folio.", opciones: [] },
    };
  }

  const tokens = patientSearchTokens(termino);
  let ids: string[] | null = null;
  if (tokens.length > 0) {
    try {
      const filas = await db.$queryRaw(
        buildPatientSearchSql({ clinicIds: [ctx.clinicId], tokens, limit: TOPE_CANDIDATOS }),
      );
      ids = (filas as Array<{ id: string }>).map((f) => f.id);
    } catch (err) {
      console.error("[sabina/agenda] la búsqueda normalizada falló, uso el contains:", err);
      ids = null;
    }
  }
  // Término hecho solo de comodines de LIKE: sin tokens no se busca (si no,
  // saldría el padrón entero).
  if (tokens.length === 0) return noEncontrado(`«${termino}»`);

  const filtro =
    ids !== null
      ? [{ id: { in: ids } }]
      : termino.split(/\s+/).filter(Boolean).map((t) => ({
          OR: [
            { firstName: { contains: t, mode: "insensitive" } },
            { lastName: { contains: t, mode: "insensitive" } },
            { phone: { contains: t } },
            { email: { contains: t, mode: "insensitive" } },
            { patientNumber: { contains: t, mode: "insensitive" } },
          ],
        }));

  const filas = await db.patient.findMany({
    where: { ...base, AND: [...patientVisibilityAnd(visorDe(ctx)), ...filtro] },
    select: SELECT_PACIENTE,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: TOPE_OPCIONES + 1,
  });

  if (filas.length === 0) return noEncontrado(`«${termino}»`);
  if (filas.length === 1 && coincideFuerte(filas[0], termino)) return { tipo: "ok", valor: aPaciente(filas[0]) };
  if (filas.length === 1) {
    // Una sola coincidencia, pero por un pedazo de palabra («uan» → Juan,
    // «Ana» → Mariana): se confirma antes de darla por buena.
    return {
      tipo: "pregunta",
      pregunta: {
        falta: "paciente",
        texto: `¿Te refieres a ${nombreDe(filas[0])}?`,
        opciones: [opcionPaciente(filas[0])],
      },
    };
  }

  const muchos = filas.length > TOPE_OPCIONES;
  return {
    tipo: "pregunta",
    pregunta: {
      falta: "paciente",
      texto: muchos
        ? `Hay muchos pacientes que coinciden con «${termino}». ¿Me das el nombre completo, el teléfono o el folio?`
        : `Hay ${filas.length} pacientes que coinciden con «${termino}». ¿Cuál es?`,
      opciones: filas.slice(0, TOPE_OPCIONES).map(opcionPaciente),
    },
  };
}

function opcionPaciente(p: any): OpcionAgenda {
  return {
    id: p.id,
    etiqueta: nombreDe(p),
    detalle:
      [p.patientNumber ? `folio ${p.patientNumber}` : null, telefonoParcial(p.phone), p.status === "ARCHIVED" ? "archivado" : null]
        .filter(Boolean)
        .join(" · ") || null,
  };
}

/**
 * ¿El término nombra a este paciente sin ambigüedad? Cada pedazo tiene que ser
 * el principio de una palabra de su nombre, su folio, o al menos 4 dígitos de su
 * teléfono. «Juan Pér» sí; «uan» no.
 */
function coincideFuerte(p: any, termino: string): boolean {
  const palabras = normal(nombreDe(p)).split(" ");
  const folio = normal(p.patientNumber);
  const telefono = String(p.phone ?? "").replace(/\D/g, "");
  const digitosTermino = termino.replace(/\D/g, "");
  // Un teléfono tecleado con espacios o lada («+52 55 1111 2222»): se compara entero.
  if (/^[\d\s+().-]+$/.test(termino.trim()) && digitosTermino.length >= 7) {
    return telefono.length > 0 && (telefono.includes(digitosTermino) || digitosTermino.endsWith(telefono.slice(-10)));
  }
  return normal(termino)
    .split(" ")
    .filter(Boolean)
    .every((t) => {
      if (/^\d+$/.test(t)) return t.length >= 4 && telefono.includes(t);
      if (folio && folio === t) return true;
      return palabras.some((w) => w.startsWith(t));
    });
}

function aPaciente(p: any): PacienteResuelto {
  return {
    id: p.id,
    nombre: nombreDe(p),
    folio: p.patientNumber ?? null,
    status: p.status ?? "ACTIVE",
    tieneCorreo: typeof p.email === "string" && p.email.trim().length > 0,
    visibleUserIds: Array.isArray(p.visibleUserIds) ? p.visibleUserIds : [],
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   DOCTOR — lo único que acepta el POST: rol DOCTOR, activo, de la clínica
   ═══════════════════════════════════════════════════════════════════════ */

export interface DoctorResuelto {
  id: string;
  nombre: string;
}

/** Palabras que no son parte del nombre: «el Dr. Salas», «la doctora Rojas». */
const TITULOS = new Set(["dr", "dra", "doctor", "doctora", "el", "la", "con"]);

/**
 * El doctor de la cita. Mismo filtro que `fetchActiveDoctors` y que la
 * validación del POST (`role: "DOCTOR", isActive: true`).
 *
 * Sin nombre: si quien pregunta es DOCTOR, él; si la clínica tiene uno solo,
 * ése; si no, se pregunta. Un ADMIN/SUPER_ADMIN no es doctor para el POST (N12):
 * si lo nombran, se dice por qué no, en vez de un «no lo encuentro» a secas.
 */
export async function resolverDoctor(
  ctx: SabinaCtx,
  db: AgendaDb,
  args: { doctorId?: string | null; doctor?: string | null },
): Promise<Resuelto<DoctorResuelto>> {
  const usuarios = await db.user.findMany({
    where: { clinicId: ctx.clinicId, isActive: true, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] } },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: { firstName: "asc" },
  });
  const doctores = usuarios.filter((u: any) => u.role === "DOCTOR");
  const aDoctor = (u: any): DoctorResuelto => ({ id: u.id, nombre: nombreDe(u) });
  const opciones = (lista: any[]): OpcionAgenda[] => lista.slice(0, TOPE_OPCIONES).map((u) => ({ id: u.id, etiqueta: nombreDe(u), detalle: null }));

  if (doctores.length === 0) {
    return {
      tipo: "no",
      causa: "sin_doctores",
      frase: "La clínica no tiene ningún usuario activo con rol de Doctor, y el sistema solo agenda citas con doctores.",
    };
  }

  if (args.doctorId) {
    const d = doctores.find((u: any) => u.id === args.doctorId);
    if (d) return { tipo: "ok", valor: aDoctor(d) };
    return { tipo: "no", causa: "doctor_no_disponible", frase: "Ese doctor no está disponible para agendar (no está activo o no es de esta clínica)." };
  }

  const buscado = normal(args.doctor)
    .split(" ")
    .filter((t) => t && !TITULOS.has(t.replace(/\.$/, "")));

  if (buscado.length === 0) {
    const yo = ctx.role === "DOCTOR" ? doctores.find((u: any) => u.id === ctx.userId) : null;
    if (yo) return { tipo: "ok", valor: aDoctor(yo) };
    if (doctores.length === 1) return { tipo: "ok", valor: aDoctor(doctores[0]) };
    return { tipo: "pregunta", pregunta: { falta: "doctor", texto: "¿Con qué doctor?", opciones: opciones(doctores) } };
  }

  const coincide = (u: any) => {
    const completo = normal(nombreDe(u));
    return buscado.every((t) => completo.split(" ").some((parte) => parte.startsWith(t)));
  };
  const hallados = doctores.filter(coincide);
  if (hallados.length === 1) return { tipo: "ok", valor: aDoctor(hallados[0]) };
  if (hallados.length > 1) {
    return { tipo: "pregunta", pregunta: { falta: "doctor", texto: `Hay ${hallados.length} doctores que coinciden. ¿Cuál?`, opciones: opciones(hallados) } };
  }

  const noDoctor = usuarios.filter((u: any) => u.role !== "DOCTOR" && coincide(u));
  if (noDoctor.length === 1) {
    return {
      tipo: "no",
      causa: "no_es_doctor",
      frase:
        `${nombreDe(noDoctor[0])} no tiene rol de Doctor en Equipo, y el sistema solo agenda citas con doctores. ` +
        `Los doctores activos son: ${doctores.map((u: any) => nombreDe(u)).join(", ")}.`,
    };
  }
  return {
    tipo: "pregunta",
    pregunta: {
      falta: "doctor",
      texto: `No encuentro a un doctor activo que se llame «${args.doctor}». ¿Con cuál de estos?`,
      opciones: opciones(doctores),
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   SILLÓN
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * El sillón pedido, dentro de los sillones activos de la clínica. Sin sillón
 * pedido devuelve `ok: null`: quien llama decide si hace falta preguntar (solo
 * cuando la clínica tiene sillones, igual que el modal «Nueva cita»).
 */
export function resolverSillon(
  sillones: Array<{ id: string; nombre: string }>,
  args: { sillonId?: string | null; sillon?: string | null },
): Resuelto<{ id: string; nombre: string } | null> {
  if (args.sillonId) {
    const s = sillones.find((x) => x.id === args.sillonId);
    if (s) return { tipo: "ok", valor: s };
    return { tipo: "no", causa: "sillon_no_encontrado", frase: "Ese sillón no está activo en esta clínica." };
  }
  const buscado = normal(args.sillon);
  if (!buscado) return { tipo: "ok", valor: null };
  const exactos = sillones.filter((s) => normal(s.nombre) === buscado);
  const hallados = exactos.length ? exactos : sillones.filter((s) => normal(s.nombre).includes(buscado));
  if (hallados.length === 1) return { tipo: "ok", valor: hallados[0] };
  return {
    tipo: "pregunta",
    pregunta: {
      falta: "sillon",
      texto: hallados.length ? `Hay ${hallados.length} sillones que coinciden. ¿Cuál?` : `No encuentro el sillón «${args.sillon}». ¿Cuál de estos?`,
      opciones: (hallados.length ? hallados : sillones).map((s) => ({ id: s.id, etiqueta: s.nombre, detalle: null })),
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   CITA — «la cita de mañana de Juan» → un id
   ═══════════════════════════════════════════════════════════════════════ */

export interface CitaResuelta {
  id: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  doctorId: string;
  doctor: string;
  resourceId: string | null;
  motivo: string | null;
  googleCalendarEventId: string | null;
  paciente: { id: string; nombre: string; status: string; tieneCorreo: boolean };
}

/**
 * La cita a mover o cancelar.
 *
 * Por `citaId`, o por paciente (+ fecha opcional). Siempre con
 * `buildAppointmentWhere`: a un DOCTOR solo le salen SUS citas, que es lo que le
 * enseña su agenda y lo único que el PATCH le deja mover. Y la cita de un
 * paciente que quien pregunta no puede ver no existe para él (el PATCH y el
 * DELETE responden 404 igual).
 *
 * `estados`: los que cuentan como candidatas cuando se busca por paciente. Por
 * `citaId` se devuelve la cita en cualquier estado, para que la acción pueda
 * explicar por qué no (ya cancelada, completada…).
 */
export async function resolverCita(
  ctx: SabinaCtx,
  db: AgendaDb,
  args: {
    citaId?: string | null;
    pacienteId?: string | null;
    paciente?: string | null;
    fecha?: string | null;
    estados: readonly string[];
    /** Sin fecha, las candidatas empiezan desde aquí. */
    desde: "ahora" | "hoy";
    /** Para las frases: «por mover», «por cancelar». */
    verbo: string;
  },
): Promise<Resuelto<CitaResuelta>> {
  const auth = comoAuthContext(ctx);
  const select = {
    id: true,
    status: true,
    startsAt: true,
    endsAt: true,
    doctorId: true,
    resourceId: true,
    type: true,
    googleCalendarEventId: true,
    patient: { select: { id: true, firstName: true, lastName: true, status: true, email: true, visibleUserIds: true, deletedAt: true } },
    doctor: { select: { firstName: true, lastName: true } },
  };
  const visible = (a: any) => a.patient && !a.patient.deletedAt && canSeePatient(visorDe(ctx), a.patient.visibleUserIds);
  const noEncontrada: Resuelto<CitaResuelta> = {
    tipo: "no",
    causa: "cita_no_encontrada",
    frase: ctx.role === "DOCTOR" ? "No encuentro esa cita entre las tuyas." : "No encuentro esa cita.",
  };

  if (args.citaId) {
    const filas = await db.appointment.findMany({ where: buildAppointmentWhere(auth, { id: args.citaId }), select, take: 1 });
    if (filas.length === 0 || !visible(filas[0])) return noEncontrada;
    return { tipo: "ok", valor: aCita(filas[0]) };
  }

  if (!args.pacienteId && !(args.paciente ?? "").trim()) {
    return { tipo: "pregunta", pregunta: { falta: "cita", texto: `¿Qué cita? Dime de qué paciente y de qué día.`, opciones: [] } };
  }

  const paciente = await resolverPaciente(ctx, db, { pacienteId: args.pacienteId, paciente: args.paciente });
  if (paciente.tipo !== "ok") return paciente;

  const ventana = args.fecha
    ? ventanaDelDia(args.fecha, ctx.timezone)
    : { desde: args.desde === "hoy" ? inicioDeHoy(ctx.timezone) : new Date(), hasta: null as Date | null };

  const filas = await db.appointment.findMany({
    where: buildAppointmentWhere(auth, {
      patientId: paciente.valor.id,
      status: { in: [...args.estados] },
      startsAt: ventana.hasta ? { gte: ventana.desde, lt: ventana.hasta } : { gte: ventana.desde },
    }),
    select,
    orderBy: { startsAt: "asc" },
    take: TOPE_OPCIONES + 1,
  });
  const citas = filas.filter(visible);

  if (citas.length === 0) {
    const cuando = args.fecha ? ` el ${fechaLarga(ventana.desde, ctx.timezone)}` : " próximas";
    const tuyas = ctx.role === "DOCTOR" ? " contigo" : "";
    return {
      tipo: "no",
      causa: "cita_no_encontrada",
      frase: `${paciente.valor.nombre} no tiene citas${tuyas}${cuando} ${args.verbo}.`,
    };
  }
  if (citas.length === 1) return { tipo: "ok", valor: aCita(citas[0]) };

  return {
    tipo: "pregunta",
    pregunta: {
      falta: "cita",
      texto: `${paciente.valor.nombre} tiene ${citas.length > TOPE_OPCIONES ? "varias" : citas.length} citas ${args.verbo}. ¿Cuál?`,
      opciones: citas.slice(0, TOPE_OPCIONES).map((a: any) => ({
        id: a.id,
        etiqueta: `${fechaLarga(new Date(a.startsAt), ctx.timezone)}, ${horaDe(new Date(a.startsAt), ctx.timezone)}`,
        detalle: `con ${nombreDe(a.doctor)} · ${etiquetaEstado(a.status)}`,
      })),
    },
  };
}

function aCita(a: any): CitaResuelta {
  return {
    id: a.id,
    status: a.status,
    startsAt: new Date(a.startsAt),
    endsAt: new Date(a.endsAt),
    doctorId: a.doctorId,
    doctor: nombreDe(a.doctor),
    resourceId: a.resourceId ?? null,
    motivo: a.type ?? null,
    googleCalendarEventId: a.googleCalendarEventId ?? null,
    paciente: {
      id: a.patient.id,
      nombre: nombreDe(a.patient),
      status: a.patient.status ?? "ACTIVE",
      tieneCorreo: typeof a.patient.email === "string" && a.patient.email.trim().length > 0,
    },
  };
}
