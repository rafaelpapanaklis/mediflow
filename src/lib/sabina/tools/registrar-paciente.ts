/**
 * `registrar_paciente` — PROPONE dar de alta a un paciente. NO lo crea.
 *
 * Es la fase 1 del contrato de escritura: resuelve los datos, comprueba si ya
 * existe alguien igual y devuelve QUÉ se daría de alta y QUÉ puede elegir el
 * usuario. Escribir es de la fase 2 (`confirmarRegistroPaciente`, en
 * ./registrar-paciente-confirmar), que solo corre cuando el usuario toca un
 * botón y que llama a POST /api/patients —el mismo endpoint de la pantalla—.
 * Este archivo no importa ese endpoint ni el prisma real: por aquí no se puede
 * escribir ni por descuido (lo vigila registrar-paciente.test.ts).
 *
 * ── QUÉ DATOS PIDE, Y POR QUÉ ──────────────────────────────────────────
 * Obligatorios: nombre, apellidos, TELÉFONO y ALERGIAS («ninguna» vale).
 *  · nombre y apellidos — los únicos que exige el servidor.
 *  · teléfono — con el nombre de pila es lo que identifica sin ambigüedad (es
 *    la mitad del criterio de duplicado del servidor), y sin él los
 *    recordatorios de WhatsApp se saltan EN SILENCIO (`reminders/enqueue.ts`).
 *  · alergias — una ficha con `allergies: []` pinta en la cabecera un chip
 *    VERDE con palomita, «Sin alergias registradas» (`hero-card.tsx`): parece
 *    que alguien preguntó. Un alta desde el chat sin preguntar sembraría justo
 *    esa falsa tranquilidad. El modal de la pantalla también la exige. Y
 *    «ninguna» se guarda como la guarda el modal (`["N/A"]`), para no inventar
 *    una tercera convención.
 * Opcionales —solo si el usuario los dio—: fecha de nacimiento, género, correo.
 * Sin ellos nada se rompe (la edad se oculta, el género sale «Otro»), pero la
 * tarjeta dice qué queda sin capturar para completarlo en la ficha.
 * Lo demás (CURP, visibilidad restringida, doctor de cabecera) no se pide por
 * chat: el servidor pone sus valores por defecto, igual que con el modal.
 *
 * ── EL DUPLICADO ES EL CASO CENTRAL ────────────────────────────────────
 * Un gemelo parte un expediente clínico en dos. La propuesta lo busca ANTES de
 * enseñar la tarjeta, con las MISMAS piezas que POST /api/patients:
 * `isProbablePatientDuplicate` decide qué es duplicado y
 * `splitPatientDuplicates` qué se puede decir de él. Si lo hay, no ofrece
 * «crear»: ofrece los tres caminos —es ese (usarlo), es otra persona (crear a
 * sabiendas), cancelar— y el usuario elige.
 *
 * Dos cosas en las que la propuesta es MÁS cuidadosa que el servidor, sin
 * inventar un criterio nuevo:
 *  · busca candidatos también por TELÉFONO, así que «Juan Peres» con el
 *    teléfono de «Juan Pérez» avisa (el POST solo busca por nombre y no lo ve);
 *  · a quien no tiene `patients.view` no le enseña ninguna ficha, solo que
 *    existe alguien.
 * La última palabra sigue siendo del servidor: al confirmar vuelve a mirar y
 * un 409 se convierte otra vez en la pregunta.
 *
 * ── NO FUGA ────────────────────────────────────────────────────────────
 * Del gemelo que el usuario no puede ver solo sale un booleano: ni id, ni
 * folio, ni nombre, ni teléfono, ni cuántos. De los que sí puede ver, folio,
 * nombre y los CUATRO últimos dígitos del teléfono, que bastan para reconocer.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { buildPatientWhere } from "@/lib/auth-context";
import { canSeePatient } from "@/lib/patient-visibility";
import {
  splitPatientDuplicates,
  validatePatientCreateBody,
  type DuplicateCandidate,
} from "@/lib/patients/patient-create-core";
import {
  normalizePatientText,
  patientPhoneLast10,
  patientSearchTokens,
  type PatientSearchToken,
} from "@/lib/patients/patient-search-core";
import { buildPatientSearchSql } from "@/lib/patients/patient-search";
import { comoAuthContext, dbDe, definirHerramienta, exigirSesion, tienePermiso, visorDe } from "./base";
import type { SabinaCtx, SabinaDb } from "../tipos";

/** Candidatos por búsqueda. Más que los 50 del POST: afinar lo hace el criterio. */
const TOPE_CANDIDATOS = 200;
/** Fichas que se enseñan como «¿es este?». Más ya no es una pregunta. */
const TOPE_VISIBLES = 5;

/**
 * Lo que el usuario dice cuando el paciente NO tiene alergias, ya normalizado:
 * «ninguna», «no tiene», «sin alergias conocidas», «niega alergias», «NKA»…
 */
const SIN_ALERGIAS =
  /^(ningun[ao]?|nada|no|n\/?a|nka|niega|negad[ao]s|sin|no tiene|no presenta|no conocidas?)( (alergias?|conocidas?|ningun[ao]))*$/;

const parametros = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "falta el nombre")
    .max(80)
    .describe("Nombre(s) de pila, tal como lo dijo el usuario. Ej.: «Juan Carlos»."),
  apellidos: z
    .string()
    .trim()
    .min(1, "faltan los apellidos")
    .max(80)
    .describe("Apellido(s). Ej.: «Pérez López»."),
  telefono: z
    .string()
    .trim()
    .max(30)
    .refine((t) => patientPhoneLast10(t).length === 10, "el teléfono necesita al menos 10 dígitos")
    .describe("Teléfono del paciente, en cualquier formato, con al menos 10 dígitos."),
  alergias: z
    .array(z.string().trim().min(1).max(80))
    .min(1, "hace falta saber si tiene alergias («ninguna» vale)")
    .max(20)
    .describe(
      "Alergias que dijo el usuario. Si dijo que NO tiene, manda [\"ninguna\"]. Si nadie lo sabe, NO llames: pregúntalo primero.",
    ),
  fechaNacimiento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "formato AAAA-MM-DD")
    .optional()
    .describe("AAAA-MM-DD. Solo si el usuario la dio."),
  genero: z
    .enum(["M", "F", "OTHER"])
    .optional()
    .describe("Solo si el usuario lo dijo. No lo deduzcas del nombre."),
  correo: z.string().trim().email("correo inválido").max(120).optional().describe("Solo si el usuario lo dio."),
});

export type ParamsAlta = z.infer<typeof parametros>;

/**
 * Lo que viajará a POST /api/patients. Lista blanca: nunca lleva
 * `allowDuplicate`, `clinicId`, `visibleUserIds` ni `primaryDoctorId`.
 */
export interface CuerpoAlta {
  firstName: string;
  lastName: string;
  phone: string;
  allergies: string[];
  dob?: string;
  gender?: "M" | "F" | "OTHER";
  email?: string;
}

export interface DuplicadoVisible {
  pacienteId: string;
  folio: string | null;
  nombre: string;
  /** "…5678": para reconocer, no para marcar. */
  telefonoFinal: string | null;
}

export interface Duplicados {
  /** `parcial` = la búsqueda sin acentos no respondió y se buscó con `contains`. */
  comprobacion: "completa" | "parcial";
  /** Solo pacientes que este usuario ya puede listar. Como mucho 5. */
  visibles: DuplicadoVisible[];
  /** Cuántos más hay A SU ALCANCE que no caben en la tarjeta. */
  masVisibles: number;
  /** Existe al menos uno que NO puede ver. Sí/no, ni siquiera cuántos. */
  hayOcultos: boolean;
  /**
   * Huella del conjunto COMPLETO de duplicados —visibles, los que no caben y
   * los ocultos—: un sha-256 de sus ids. No dice quiénes ni cuántos, pero cambia
   * si aparece uno. Con ella la confirmación sabe si lo que el usuario aceptó
   * («es otra persona») sigue siendo lo que hay. `null` si no se pudo calcular
   * (la lista vino del 409 del servidor).
   */
  huella: string | null;
}

export interface OpcionAlta {
  id: string;
  tipo: "crear" | "crear_a_sabiendas" | "usar_existente" | "cancelar";
  etiqueta: string;
  /** Solo en `usar_existente`. `null` = el que existe está fuera de su alcance. */
  pacienteId?: string | null;
}

/** La propuesta: todo lo que la tarjeta necesita, y todo lo que la fase 2 ejecuta. */
export interface PropuestaAlta {
  accion: "registrar_paciente";
  permiso: "patients.create";
  /** Para quién se armó. La confirmación la rechaza en otra sesión o en otra sede. */
  emitidaPara: { clinicId: string; userId: string };
  cuerpo: CuerpoAlta;
  /** Los datos en palabras, para la tarjeta. */
  ficha: {
    nombre: string;
    telefono: string;
    alergias: string;
    fechaNacimiento: string | null;
    genero: string | null;
    correo: string | null;
  };
  sinCapturar: string[];
  duplicados: Duplicados;
  /** La pregunta cuando hay duplicado; `null` si no lo hay. */
  pregunta: string | null;
  opciones: OpcionAlta[];
  /** Qué pasa al confirmar. */
  efectos: string[];
  reversible: { reversible: false; como: string };
  avisos: string[];
}

export const registrarPaciente = definirHerramienta<ParamsAlta, PropuestaAlta>({
  nombre: "registrar_paciente",
  descripcion:
    "PROPONE dar de alta a un paciente nuevo; NO lo crea. Úsala cuando el usuario pida registrar a alguien " +
    "(«es nuevo», «da de alta a…»). Necesitas nombre, apellidos, teléfono y alergias («ninguna» vale): " +
    "pide los que falten en UNA sola pregunta antes de llamarla. Fecha de nacimiento, género y correo, solo " +
    "si el usuario los dio. Comprueba si ya existe alguien igual; si lo hay, NO lo des de alta: pregúntale " +
    "al usuario si es la misma persona. El alta solo ocurre cuando el usuario confirma en pantalla.",
  parametros,
  permiso: "patients.create",

  async ejecutar(ctx: SabinaCtx, params): Promise<PropuestaAlta> {
    const cuerpo = armarCuerpo(params);
    // El MISMO validador que el POST: lo que aquí pasa, allí pasa. Va antes de
    // consultar nada.
    const check = validatePatientCreateBody(cuerpo);
    if (check.ok === false) {
      throw new Error(`parametros_invalidos: ${check.field}: ${check.error}`);
    }
    const duplicados = await buscarDuplicados(ctx, cuerpo);
    return armarPropuesta(ctx, cuerpo, duplicados);
  },

  // Una propuesta nunca es «sin datos».
  vacio: () => false,

  resumir(p) {
    const quien = `${p.ficha.nombre}, tel. ${telefonoFinal(p.cuerpo.phone) ?? p.cuerpo.phone}`;
    if (p.pregunta) {
      const cuantos = p.duplicados.visibles.length;
      const hay = cuantos > 0
        ? `ya existe${cuantos === 1 ? " 1 paciente" : `n ${cuantos} pacientes`} con esos datos (${p.duplicados.visibles
            .map((v) => `${v.nombre}, ${v.folio ?? "sin folio"}`)
            .join("; ")})${p.duplicados.hayOcultos ? " y otro fuera de su alcance" : ""}`
        : "ya existe en la clínica un paciente con esos datos fuera de su alcance";
      return `NO lo des de alta todavía: ${hay}. Pregunta al usuario si ${quien} es la misma persona; las opciones están en pantalla.`;
    }
    return `Propuesta lista, SIN confirmar: dar de alta a ${quien}. El usuario tiene que confirmarlo en pantalla; todavía no está hecho.`;
  },
});

/* ── el cuerpo ─────────────────────────────────────────────────────── */

function armarCuerpo(params: ParamsAlta): CuerpoAlta {
  const cuerpo: CuerpoAlta = {
    firstName: params.nombre,
    lastName: params.apellidos,
    phone: params.telefono,
    allergies: normalizarAlergias(params.alergias),
  };
  if (params.fechaNacimiento) cuerpo.dob = params.fechaNacimiento;
  if (params.genero) cuerpo.gender = params.genero;
  if (params.correo) cuerpo.email = params.correo;
  return cuerpo;
}

/** «ninguna» → `["N/A"]`, como el modal. Una lista mezclada es contradictoria. */
function normalizarAlergias(lista: string[]): string[] {
  const limpias: string[] = [];
  for (const a of lista) {
    const t = a.trim();
    if (t && !limpias.some((x) => normalizePatientText(x) === normalizePatientText(t))) limpias.push(t);
  }
  const nada = limpias.filter((a) => SIN_ALERGIAS.test(normalizePatientText(a)));
  if (nada.length === limpias.length) return ["N/A"];
  if (nada.length > 0) {
    throw new Error("parametros_invalidos: alergias: dice «ninguna» y a la vez nombra alergias; pregunta cuál es");
  }
  return limpias;
}

/* ── los duplicados ────────────────────────────────────────────────── */

/**
 * Los homónimos de TODA la clínica, repartidos entre los que se pueden enseñar
 * y los que solo se pueden contar. Solo lectura, por `ctx.db`.
 *
 * Es el mismo recorrido que el POST (candidatos de la clínica → los que el
 * usuario puede listar → `splitPatientDuplicates`), con la red de candidatos
 * ampliada al teléfono. La confirmación lo vuelve a correr antes de mandar un
 * `allowDuplicate`.
 */
export async function buscarDuplicados(
  ctx: SabinaCtx,
  alta: Pick<CuerpoAlta, "firstName" | "lastName" | "phone">,
): Promise<Duplicados> {
  // Se exporta: la guarda del tenant va aquí también, no solo en el runner.
  exigirSesion(ctx);
  const db = dbDe(ctx);
  const ids: string[] = [];
  let comprobacion: Duplicados["comprobacion"] = "completa";

  const redes: Array<{ tokens: PatientSearchToken[]; degradado: () => Record<string, unknown> }> = [
    {
      tokens: patientSearchTokens(`${alta.firstName} ${alta.lastName}`),
      degradado: () => ({
        AND: `${alta.firstName} ${alta.lastName}`
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => ({
            OR: [
              { firstName: { contains: w, mode: "insensitive" } },
              { lastName: { contains: w, mode: "insensitive" } },
            ],
          })),
      }),
    },
    {
      tokens: patientSearchTokens(patientPhoneLast10(alta.phone)),
      // Degradado: el teléfono se guarda como se tecleó ("+52 55 1234 5678"),
      // así que solo los 4 últimos dígitos casan con seguridad. Red ancha a
      // propósito: el criterio de duplicado afina después.
      degradado: () => ({ phone: { contains: patientPhoneLast10(alta.phone).slice(-4) } }),
    },
  ];

  // En serie a propósito: son dos consultas y el pooler agradece no apilarlas.
  for (const red of redes) {
    if (red.tokens.length === 0) continue;
    let encontrados: string[] | null = await idsPorBusqueda(db, ctx.clinicId, red.tokens);
    if (encontrados === null) {
      comprobacion = "parcial";
      const filas = await db.patient.findMany({
        where: { clinicId: ctx.clinicId, deletedAt: null, ...red.degradado() },
        select: { id: true },
        take: TOPE_CANDIDATOS,
      });
      encontrados = (filas as Array<{ id: string }>).map((f) => f.id);
    }
    for (const id of encontrados) if (ids.indexOf(id) === -1) ids.push(id);
  }

  if (ids.length === 0) return { comprobacion, visibles: [], masVisibles: 0, hayOcultos: false, huella: huellaDe([]) };

  const candidatos = (await db.patient.findMany({
    where: { clinicId: ctx.clinicId, deletedAt: null, id: { in: ids } },
    select: { id: true, patientNumber: true, firstName: true, lastName: true, phone: true, visibleUserIds: true },
  })) as DuplicateCandidate[];

  // A su alcance = lo que puede LISTAR (`buildPatientWhere`, como el POST). Y sin
  // `patients.view` no lista nada: ninguna ficha se enseña, solo que existe.
  const auth = comoAuthContext(ctx);
  let enAlcance = new Set<string>();
  if (tienePermiso(ctx, "patients.view") && candidatos.length > 0) {
    if (auth.isAdmin) {
      enAlcance = new Set(candidatos.map((c) => c.id));
    } else {
      const listables = await db.patient.findMany({
        where: buildPatientWhere(auth, { id: { in: candidatos.map((c) => c.id) } }),
        select: { id: true },
      });
      enAlcance = new Set((listables as Array<{ id: string }>).map((c) => c.id));
    }
  }

  // Candidato por candidato, para saber QUÉ ids avisan (la huella los necesita
  // todos) sin dejar de decidir con `splitPatientDuplicates`.
  const visibles: DuplicateCandidate[] = [];
  const avisan: string[] = [];
  let ocultos = 0;
  for (const c of candidatos) {
    const r = splitPatientDuplicates({
      candidatos: [c],
      alta: { firstName: alta.firstName, lastName: alta.lastName, phone: alta.phone },
      enMiAlcance: (id) => enAlcance.has(id),
      puedeVer: (lista) => canSeePatient(visorDe(ctx), lista),
    });
    visibles.push(...r.visibles);
    ocultos += r.ocultos;
    if (r.visibles.length > 0 || r.ocultos > 0) avisan.push(c.id);
  }

  const ordenados = visibles
    .slice()
    .sort((a, b) => String(a.patientNumber ?? "").localeCompare(String(b.patientNumber ?? "")));
  return {
    comprobacion,
    visibles: ordenados.slice(0, TOPE_VISIBLES).map((d) => ({
      pacienteId: d.id,
      folio: d.patientNumber ?? null,
      nombre: `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim(),
      telefonoFinal: telefonoFinal(d.phone),
    })),
    masVisibles: Math.max(0, ordenados.length - TOPE_VISIBLES),
    hayOcultos: ocultos > 0,
    huella: huellaDe(avisan),
  };
}

function huellaDe(ids: string[]): string {
  return createHash("sha256").update(ids.slice().sort().join("|")).digest("hex");
}

/** `null` = «no pude preguntar»; el llamador cae al `contains`. */
async function idsPorBusqueda(db: SabinaDb, clinicId: string, tokens: PatientSearchToken[]): Promise<string[] | null> {
  try {
    const filas = await db.$queryRaw(buildPatientSearchSql({ clinicIds: [clinicId], tokens, limit: TOPE_CANDIDATOS }));
    return (filas as Array<{ id: string }>).map((f) => f.id);
  } catch (err) {
    console.error("[sabina/registrar_paciente] la búsqueda normalizada falló, uso el contains:", err);
    return null;
  }
}

/* ── la propuesta ──────────────────────────────────────────────────── */

/**
 * Arma la propuesta a partir del cuerpo y de lo que se sabe de duplicados. La
 * usan la fase 1 y la confirmación, cuando el servidor contesta 409 y hay que
 * volver a preguntar.
 */
export function armarPropuesta(ctx: SabinaCtx, cuerpo: CuerpoAlta, duplicados: Duplicados): PropuestaAlta {
  const nombre = `${cuerpo.firstName} ${cuerpo.lastName}`.trim();
  const hayDuplicado = duplicados.visibles.length > 0 || duplicados.masVisibles > 0 || duplicados.hayOcultos;

  const sinCapturar: string[] = [];
  if (!cuerpo.dob) sinCapturar.push("fecha de nacimiento");
  if (!cuerpo.gender) sinCapturar.push("género");
  if (!cuerpo.email) sinCapturar.push("correo");

  const avisos: string[] = [];
  if (!cuerpo.dob) {
    avisos.push("Sin fecha de nacimiento la ficha no muestra la edad, y el módulo pediátrico y los reportes de periodoncia la piden.");
  }
  if (!cuerpo.gender) avisos.push("Sin género, la ficha mostrará «Otro» hasta que se corrija.");
  if (duplicados.comprobacion === "parcial") {
    avisos.push("No pude comprobar del todo si ya existe (la búsqueda sin acentos no respondió): revisa que no esté registrado con otra grafía.");
  }

  let pregunta: string | null = null;
  const opciones: OpcionAlta[] = [];
  if (!hayDuplicado) {
    opciones.push({ id: "crear", tipo: "crear", etiqueta: `Dar de alta a ${nombre}` });
  } else {
    const partes: string[] = [];
    if (duplicados.visibles.length > 0) {
      const lista = duplicados.visibles
        .map((v) => `${v.nombre} (${v.folio ?? "sin folio"}${v.telefonoFinal ? `, tel. ${v.telefonoFinal}` : ""})`)
        .join("; ");
      partes.push(
        `Ya existe${duplicados.visibles.length === 1 ? " un paciente" : `n ${duplicados.visibles.length} pacientes`} con estos datos: ${lista}.`,
      );
    }
    if (duplicados.masVisibles > 0) {
      partes.push(
        `Y ${duplicados.masVisibles === 1 ? "otro más" : `${duplicados.masVisibles} más`} con el mismo nombre; si es uno de esos, búscalo en la lista de pacientes.`,
      );
    }
    if (duplicados.hayOcultos) {
      partes.push(
        duplicados.visibles.length > 0
          ? "Y hay otro en la clínica fuera de tu alcance."
          : "Ya existe en la clínica un paciente con estos datos fuera de tu alcance; no puedo decirte quién es.",
      );
    }
    partes.push(`¿${nombre} es la misma persona?`);
    pregunta = partes.join(" ");

    for (const v of duplicados.visibles) {
      opciones.push({
        id: `usar:${v.pacienteId}`,
        tipo: "usar_existente",
        etiqueta: `Es ${v.nombre} (${v.folio ?? "sin folio"}): usar ese expediente`,
        pacienteId: v.pacienteId,
      });
    }
    if (duplicados.hayOcultos) {
      opciones.push({
        id: "usar:fuera_de_alcance",
        tipo: "usar_existente",
        etiqueta: "Es el que ya existe: pedir a un administrador que lo revise",
        pacienteId: null,
      });
    }
    opciones.push({
      id: "crear_a_sabiendas",
      tipo: "crear_a_sabiendas",
      etiqueta: `Es otra persona: crear un expediente nuevo para ${nombre}`,
    });
  }
  opciones.push({ id: "cancelar", tipo: "cancelar", etiqueta: "Cancelar" });

  const efectos = [
    "Consume un folio y un lugar del cupo de pacientes del plan.",
    "No se le manda nada al paciente: ni WhatsApp, ni correo, ni invitación al portal.",
    "Si ese teléfono ya escribió por WhatsApp, la conversación queda ligada a la ficha nueva.",
  ];
  if (ctx.role === "DOCTOR") efectos.push("Quedarás como su doctor de cabecera.");

  return {
    accion: "registrar_paciente",
    permiso: "patients.create",
    emitidaPara: { clinicId: ctx.clinicId, userId: ctx.userId },
    cuerpo,
    ficha: {
      nombre,
      telefono: cuerpo.phone,
      alergias: cuerpo.allergies.length === 1 && cuerpo.allergies[0] === "N/A" ? "Ninguna" : cuerpo.allergies.join(", "),
      fechaNacimiento: cuerpo.dob ?? null,
      genero: cuerpo.gender === "M" ? "Masculino" : cuerpo.gender === "F" ? "Femenino" : cuerpo.gender ? "Otro" : null,
      correo: cuerpo.email ?? null,
    },
    sinCapturar,
    duplicados,
    pregunta,
    opciones,
    efectos,
    reversible: {
      reversible: false,
      como:
        "Un alta no se borra: solo se puede archivar desde la ficha, con el permiso «Archivar/eliminar pacientes» " +
        "(doctores y recepción no lo tienen por defecto), y archivar cancela sus citas futuras.",
    },
    avisos,
  };
}

/** "…5678", o `null` si no hay teléfono con al menos 4 dígitos. */
export function telefonoFinal(telefono: string | null | undefined): string | null {
  const digitos = String(telefono ?? "").replace(/\D/g, "");
  return digitos.length >= 4 ? `…${digitos.slice(-4)}` : null;
}
