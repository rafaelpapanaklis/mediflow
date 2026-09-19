// Nota de evolución como DOCUMENTO (plantilla de la clínica → texto → firma).
//
// Es un camino NUEVO al lado de la nota de evolución de siempre (el formulario
// dental sobre `medical_records`). Aquello no se toca desde aquí.
//
// Toda la lógica vive en este archivo y no en los route handlers para poder
// probarla sin base: `db` es cualquier cosa con la forma de los cinco modelos
// de Prisma que se usan. Mismo patrón que `@/lib/document-templates/service`.
//
// Cuatro leyes:
//  · SOLO `kind = NOTA_EVOLUCION`. El consentimiento comparte tabla pero es de
//    otra pantalla: aquí ni se lista, ni se abre, ni se firma.
//  · TODA consulta lleva `clinicId` (y `patientId` cuando hay paciente), y si
//    falta se corta ANTES de consultar: `clinicId: undefined` en Prisma no
//    filtra nada, devuelve las filas de todas las clínicas.
//  · El documento CONGELA sus datos al firmarse. `body` es el HTML final y
//    `encabezado` la foto de paciente/clínica/doctor en ese momento. Leer una
//    nota es devolver esas dos columnas tal cual: jamás se vuelve a consultar la
//    plantilla, el doctor ni la clínica para pintarla.
//  · Lo firmado no se reescribe: editar y firmar solo encuentran filas `DRAFT`.
//
// La visibilidad por paciente (`assertPatientVisible`) NO vive aquí: necesita el
// Prisma real y la hacen los route handlers ANTES de llamar a este servicio.

import type { PrismaClient } from "@prisma/client";
import { formatConsentDate, consentTimeZone } from "@/lib/consent/dates";
import { interpolateDocumentHtml } from "@/lib/document-templates/interpolate";
import { isBlankHtml, MAX_BODY_LENGTH, MAX_INPUT_LENGTH } from "@/lib/document-templates/sanitize";
import { getTemplate, listTemplates } from "@/lib/document-templates/service";
// Mismo helper de edad que las cartas de consentimiento: [EDAD_PACIENTE] no
// puede decir una cosa en la carta y otra en la nota.
import { calculateAge } from "@/lib/pediatrics/age";
// El aviso de lo que falta es el MISMO que el de la carta de consentimiento.
import { datosFaltantes, type DatoFaltante } from "@/lib/patient-documents/faltantes";

export const NOTA_KIND = "NOTA_EVOLUCION" as const;

export type NotaDb = Pick<
  PrismaClient,
  "patientDocument" | "documentTemplate" | "patient" | "clinic" | "user"
>;

/** Lo que puede faltar en la cabecera sin impedir la firma (común con el consentimiento). */
export type Faltante = DatoFaltante;

/**
 * La foto de la cabecera. Los datos que la clínica puede no tener (logo,
 * cédula) van como `null`, NUNCA como un texto de relleno: quien pinta la nota
 * omite la línea en vez de imprimir un dato inventado.
 */
export interface EncabezadoNota {
  pacienteNombre: string;
  /** Fecha larga ya formateada en la zona de la clínica ("19 de septiembre de 2026"). */
  fecha: string;
  clinicaNombre: string;
  logoUrl: string | null;
  doctorNombre: string;
  cedula: string | null;
  // Lo que sigue se añadió el 19-sep-2026. Una nota firmada ANTES no lo tiene en
  // su foto: se lee como `null` y no se pinta — jamás se rellena con el dato de hoy.
  clinicaDireccion: string | null;
  clinicaTelefono: string | null;
  doctorEspecialidad: string | null;
  doctorCedulaEspecialidad: string | null;
  /** `Patient.patientNumber`, el folio del expediente. Nunca el id interno. */
  pacienteNumero: string | null;
  pacienteCurp: string | null;
  /** `curpStatus = FOREIGN`: no tiene CURP que capturar, así que no «falta». */
  pacienteSinCurp: boolean;
}

export interface NotaResumen {
  id: string;
  title: string;
  status: string;
  signedAt: Date | null;
  createdAt: Date;
  doctorId: string;
  /** Quién la firmó (o la está redactando), leído de la foto, no del usuario de hoy. */
  doctorNombre: string;
  /** La fecha de la foto, ya formateada en la zona de la clínica. */
  fecha: string;
}

export interface NotaCompleta extends NotaResumen {
  body: string;
  encabezado: EncabezadoNota;
  faltantes: Faltante[];
}

export type NotaErrorCode =
  | "PATIENT_NOT_FOUND"
  | "DOCTOR_NOT_FOUND"
  | "TEMPLATE_NOT_FOUND"
  | "BODY_REQUIRED"
  | "BODY_TOO_LONG"
  | "NOT_FOUND"
  | "NOT_AUTHOR"
  | "ALREADY_SIGNED";

const MENSAJES: Record<NotaErrorCode, { status: number; error: string }> = {
  PATIENT_NOT_FOUND: { status: 404, error: "Paciente no encontrado" },
  DOCTOR_NOT_FOUND: { status: 403, error: "Tu usuario no está activo en esta clínica" },
  TEMPLATE_NOT_FOUND: { status: 404, error: "La plantilla no existe o no es de nota de evolución" },
  BODY_REQUIRED: { status: 400, error: "La nota está vacía" },
  BODY_TOO_LONG: { status: 400, error: "La nota es demasiado larga" },
  NOT_FOUND: { status: 404, error: "Nota no encontrada" },
  NOT_AUTHOR: { status: 403, error: "Solo quien redactó la nota puede editarla o firmarla" },
  ALREADY_SIGNED: { status: 409, error: "La nota ya está firmada y no se puede modificar" },
};

export type NotaFallo = { ok: false; code: NotaErrorCode; status: number; error: string };
export type NotaResult<T> = { ok: true; value: T } | NotaFallo;

const falla = (code: NotaErrorCode): NotaFallo => ({ ok: false, code, ...MENSAJES[code] });
const bien = <T,>(value: T): NotaResult<T> => ({ ok: true, value });

function exigir(nombre: string, valor: string): void {
  if (typeof valor !== "string" || valor.length === 0) {
    throw new Error(`patient-documents: ${nombre} ausente — se corta antes de consultar`);
  }
}

/* ─── cabecera ─────────────────────────────────────────────────────────── */

export function faltantesDe(e: EncabezadoNota): Faltante[] {
  return datosFaltantes({
    clinicAddress: e.clinicaDireccion,
    clinicLogoUrl: e.logoUrl,
    doctorLicense: e.cedula,
    doctorSpecialty: e.doctorEspecialidad,
    patientCurp: e.pacienteCurp,
    patientCurpStatus: e.pacienteSinCurp ? "FOREIGN" : null,
  });
}

/** Lee la foto guardada. Tolera un JSON viejo o incompleto sin inventar datos. */
export function leerEncabezado(json: unknown): EncabezadoNota {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const texto = (v: unknown): string => (typeof v === "string" ? v : "");
  const opcional = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
  return {
    pacienteNombre: texto(o.pacienteNombre),
    fecha: texto(o.fecha),
    clinicaNombre: texto(o.clinicaNombre),
    logoUrl: opcional(o.logoUrl),
    doctorNombre: texto(o.doctorNombre),
    cedula: opcional(o.cedula),
    clinicaDireccion: opcional(o.clinicaDireccion),
    clinicaTelefono: opcional(o.clinicaTelefono),
    doctorEspecialidad: opcional(o.doctorEspecialidad),
    doctorCedulaEspecialidad: opcional(o.doctorCedulaEspecialidad),
    pacienteNumero: opcional(o.pacienteNumero),
    pacienteCurp: opcional(o.pacienteCurp),
    pacienteSinCurp: o.pacienteSinCurp === true,
  };
}

interface Contexto {
  encabezado: EncabezadoNota;
  timezone: string;
  patientNumber: string | null;
  /** Años cumplidos; `null` sin fecha de nacimiento. Alimenta [EDAD_PACIENTE]. */
  patientAge: number | null;
  /** Ciudad de la clínica. Alimenta [LUGAR]. */
  clinicCity: string | null;
}

/**
 * Los datos de HOY de paciente, clínica y doctor. Se llama al previsualizar,
 * al crear y al firmar — nunca al leer.
 *
 * `ahora` lo pasa quien llama y se formatea SIEMPRE con la zona de la clínica:
 * el servidor corre en UTC y una nota firmada de noche en México no puede
 * fechar el día siguiente.
 */
async function cargarContexto(
  db: NotaDb,
  clinicId: string,
  patientId: string,
  doctorId: string,
  ahora: Date,
): Promise<NotaResult<Contexto>> {
  exigir("clinicId", clinicId);
  exigir("patientId", patientId);
  exigir("doctorId", doctorId);

  const [patient, clinic, doctor] = await Promise.all([
    // La visibilidad por paciente ya la comprobó el route handler
    // (assertPatientVisible) antes de llegar aquí.
    db.patient.findFirst({
      where: { id: patientId, clinicId },
      select: { firstName: true, lastName: true, patientNumber: true, dob: true, curp: true, curpStatus: true },
    }),
    db.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true, logoUrl: true, timezone: true, city: true, address: true, state: true, phone: true },
    }),
    db.user.findFirst({
      where: { id: doctorId, clinicId, isActive: true },
      select: {
        firstName: true, lastName: true, cedulaProfesional: true,
        // `especialidad` es la de Equipo; `specialty` es el módulo del panel y no va aquí.
        especialidad: true, cedulaEspecialidad: true,
      },
    }),
  ]);
  if (!patient || !clinic) return falla("PATIENT_NOT_FOUND");
  if (!doctor) return falla("DOCTOR_NOT_FOUND");

  const timezone = consentTimeZone(clinic.timezone);
  const limpio = (v: string | null | undefined): string | null => (v ?? "").trim() || null;
  // Calle + ciudad + estado, solo con lo que haya. Sin calle NO hay dirección:
  // «Mérida, Yucatán» a secas no le dice a nadie dónde queda la clínica.
  const direccion = limpio(clinic.address)
    ? [clinic.address, clinic.city, clinic.state].map(limpio).filter(Boolean).join(", ")
    : null;
  return bien({
    timezone,
    patientNumber: patient.patientNumber ?? null,
    patientAge: patient.dob ? calculateAge(patient.dob, ahora).years : null,
    clinicCity: (clinic.city ?? "").trim() || null,
    encabezado: {
      pacienteNombre: `${patient.firstName ?? ""} ${patient.lastName ?? ""}`.trim(),
      fecha: formatConsentDate(ahora, timezone),
      clinicaNombre: clinic.name ?? "",
      logoUrl: (clinic.logoUrl ?? "").trim() || null,
      doctorNombre: `${doctor.firstName ?? ""} ${doctor.lastName ?? ""}`.trim(),
      cedula: (doctor.cedulaProfesional ?? "").trim() || null,
      clinicaDireccion: direccion,
      clinicaTelefono: limpio(clinic.phone),
      doctorEspecialidad: limpio(doctor.especialidad),
      doctorCedulaEspecialidad: limpio(doctor.cedulaEspecialidad),
      pacienteNumero: limpio(patient.patientNumber),
      pacienteCurp: limpio(patient.curp)?.toUpperCase() ?? null,
      pacienteSinCurp: patient.curpStatus === "FOREIGN",
    },
  });
}

/** Rellena los marcadores con los mismos datos de la cabecera. Sanea siempre. */
function rellenar(html: string, c: Contexto): string {
  return interpolateDocumentHtml(html, {
    clinicName: c.encabezado.clinicaNombre,
    patientName: c.encabezado.pacienteNombre,
    patientNumber: c.patientNumber,
    patientAge: c.patientAge,
    clinicCity: c.clinicCity,
    doctorName: c.encabezado.doctorNombre,
    doctorLicense: c.encabezado.cedula,
    date: c.encabezado.fecha,
    timezone: c.timezone,
  });
}

/**
 * El saneado CORTA en silencio lo que pase de MAX_INPUT_LENGTH. Una nota pegada
 * desde Word (con sus `<span style>`) podía pasar de ahí, salir corta tras
 * sanear y firmarse TRUNCADA. Se rechaza antes, mirando la entrada cruda.
 */
function entradaDemasiadoLarga(crudo: unknown): NotaFallo | null {
  return typeof crudo === "string" && crudo.length > MAX_INPUT_LENGTH ? falla("BODY_TOO_LONG") : null;
}

function validarCuerpo(body: string): NotaFallo | null {
  if (isBlankHtml(body)) return falla("BODY_REQUIRED");
  if (body.length > MAX_BODY_LENGTH) return falla("BODY_TOO_LONG");
  return null;
}

/* ─── plantillas de «Nueva nota» ───────────────────────────────────────── */

/** SOLO las de nota de evolución, activas y de ESTA clínica. Sin el cuerpo. */
export async function listNotaTemplates(
  db: NotaDb,
  clinicId: string,
): Promise<{ id: string; name: string }[]> {
  const todas = await listTemplates(db, clinicId, { kind: NOTA_KIND });
  // `listTemplates` ya filtra; se vuelve a mirar el tipo por si algún día deja
  // de hacerlo: aquí un consentimiento colado es una nota firmada con su texto.
  return todas.filter((t) => t.kind === NOTA_KIND).map((t) => ({ id: t.id, name: t.name }));
}

async function plantillaDeNota(db: NotaDb, clinicId: string, templateId: string) {
  const t = await getTemplate(db, clinicId, templateId);
  if (!t || t.kind !== NOTA_KIND || !t.isActive) return null;
  return t;
}

/* ─── leer ─────────────────────────────────────────────────────────────── */

const SELECT_RESUMEN = {
  id: true,
  title: true,
  status: true,
  signedAt: true,
  createdAt: true,
  doctorId: true,
  encabezado: true,
} as const;

function aResumen(f: {
  id: string; title: string; status: string; signedAt: Date | null;
  createdAt: Date; doctorId: string; encabezado: unknown;
}): NotaResumen {
  const foto = leerEncabezado(f.encabezado);
  return {
    id: f.id,
    title: f.title,
    status: f.status,
    signedAt: f.signedAt,
    createdAt: f.createdAt,
    doctorId: f.doctorId,
    doctorNombre: foto.doctorNombre,
    fecha: foto.fecha,
  };
}

function aCompleta(f: Parameters<typeof aResumen>[0] & { body: string }): NotaCompleta {
  const encabezado = leerEncabezado(f.encabezado);
  return { ...aResumen(f), body: f.body, encabezado, faltantes: faltantesDe(encabezado) };
}

/** Tope de la lista: las más nuevas. Sin él un paciente crónico se trae cientos de filas. */
export const MAX_NOTAS_LISTA = 200;

/** De la más nueva a la más vieja. */
export async function listNotas(db: NotaDb, clinicId: string, patientId: string): Promise<NotaResumen[]> {
  exigir("clinicId", clinicId);
  exigir("patientId", patientId);
  const filas = await db.patientDocument.findMany({
    where: { clinicId, patientId, kind: NOTA_KIND },
    orderBy: { createdAt: "desc" },
    take: MAX_NOTAS_LISTA,
    select: SELECT_RESUMEN,
  });
  return filas.map(aResumen);
}

/** La nota tal y como se guardó. No consulta nada más que su propia fila. */
export async function getNota(db: NotaDb, clinicId: string, id: string): Promise<NotaCompleta | null> {
  exigir("clinicId", clinicId);
  if (typeof id !== "string" || id.length === 0) return null;
  const f = await db.patientDocument.findFirst({
    where: { id, clinicId, kind: NOTA_KIND },
    select: { ...SELECT_RESUMEN, body: true },
  });
  return f ? aCompleta(f) : null;
}

/**
 * Un borrador PROPIO abierto para seguir escribiéndolo: el mismo texto, pero con
 * la cabecera y el aviso de HOY, que son los que se van a congelar al firmar.
 * Sin esto el editor enseñaba la foto del día en que se creó el borrador («no
 * tienes cédula», fecha de ayer) y el doctor firmaba otra cosa. No guarda nada.
 * Si no es un borrador de quien pregunta, devuelve la nota tal cual se guardó.
 */
export async function getNotaParaEditar(
  db: NotaDb, clinicId: string, id: string, doctorId: string, ahora: Date,
): Promise<NotaCompleta | null> {
  const nota = await getNota(db, clinicId, id);
  if (!nota || nota.status !== "DRAFT" || nota.doctorId !== doctorId) return nota;
  const fila = await db.patientDocument.findFirst({
    where: { id, clinicId, kind: NOTA_KIND },
    select: { patientId: true },
  });
  if (!fila) return nota;
  const c = await cargarContexto(db, clinicId, fila.patientId, doctorId, ahora);
  if (c.ok === false) return nota;
  return { ...nota, fecha: c.value.encabezado.fecha, doctorNombre: c.value.encabezado.doctorNombre,
    encabezado: c.value.encabezado, faltantes: faltantesDe(c.value.encabezado) };
}

/* ─── previsualizar, crear, editar, firmar ─────────────────────────────── */

export interface PreviewNota {
  templateId: string;
  title: string;
  body: string;
  encabezado: EncabezadoNota;
  faltantes: Faltante[];
}

/** La plantilla ya rellenada con los datos de hoy. No guarda nada. */
export async function previewNota(
  db: NotaDb,
  clinicId: string,
  input: { patientId: string; doctorId: string; templateId: string },
  ahora: Date,
): Promise<NotaResult<PreviewNota>> {
  const c = await cargarContexto(db, clinicId, input.patientId, input.doctorId, ahora);
  if (c.ok === false) return c;
  const plantilla = await plantillaDeNota(db, clinicId, input.templateId);
  if (!plantilla) return falla("TEMPLATE_NOT_FOUND");
  return bien({
    templateId: plantilla.id,
    title: plantilla.name,
    body: rellenar(plantilla.body, c.value),
    encabezado: c.value.encabezado,
    faltantes: faltantesDe(c.value.encabezado),
  });
}

export interface CreateNotaInput {
  patientId: string;
  doctorId: string;
  templateId: string;
  /** El texto ya rellenado por el doctor. Sin él se usa el de la plantilla. */
  body?: unknown;
  /** `true` = crear y firmar en un solo paso. */
  sign?: boolean;
}

export async function createNota(
  db: NotaDb,
  clinicId: string,
  input: CreateNotaInput,
  ahora: Date,
): Promise<NotaResult<NotaCompleta>> {
  const c = await cargarContexto(db, clinicId, input.patientId, input.doctorId, ahora);
  if (c.ok === false) return c;
  const plantilla = await plantillaDeNota(db, clinicId, input.templateId);
  if (!plantilla) return falla("TEMPLATE_NOT_FOUND");

  const largo = entradaDemasiadoLarga(input.body);
  if (largo) return largo;
  const origen = typeof input.body === "string" ? input.body : plantilla.body;
  const body = rellenar(origen, c.value);
  const malo = validarCuerpo(body);
  if (malo) return malo;

  const firmar = input.sign === true;
  const fila = await db.patientDocument.create({
    data: {
      clinicId,
      patientId: input.patientId,
      doctorId: input.doctorId,
      templateId: plantilla.id,
      kind: NOTA_KIND,
      title: plantilla.name, // COPIA: renombrar la plantilla no renombra la nota
      body,
      encabezado: { ...c.value.encabezado },
      status: firmar ? "SIGNED" : "DRAFT",
      signedAt: firmar ? ahora : null,
      modoFirma: firmar ? "DIGITAL" : null,
    },
    select: { ...SELECT_RESUMEN, body: true },
  });
  return bien(aCompleta(fila));
}

/**
 * Lo común de editar y firmar: la fila existe, es de esta clínica, es una nota
 * de evolución, sigue en borrador y es de quien la toca.
 */
async function borradorPropio(db: NotaDb, clinicId: string, id: string, doctorId: string) {
  exigir("clinicId", clinicId);
  exigir("doctorId", doctorId);
  if (typeof id !== "string" || id.length === 0) return falla("NOT_FOUND");
  const f = await db.patientDocument.findFirst({
    where: { id, clinicId, kind: NOTA_KIND },
    select: { id: true, patientId: true, doctorId: true, status: true, body: true },
  });
  if (!f) return falla("NOT_FOUND");
  if (f.status !== "DRAFT") return falla("ALREADY_SIGNED");
  if (f.doctorId !== doctorId) return falla("NOT_AUTHOR");
  return bien(f);
}

async function guardarBorrador(
  db: NotaDb,
  clinicId: string,
  id: string,
  doctorId: string,
  bodyNuevo: unknown,
  firmar: boolean,
  ahora: Date,
): Promise<NotaResult<NotaCompleta>> {
  const largo = entradaDemasiadoLarga(bodyNuevo);
  if (largo) return largo;
  const actual = await borradorPropio(db, clinicId, id, doctorId);
  if (actual.ok === false) return actual;

  // La foto se RENUEVA mientras sea borrador y se congela al firmar: un
  // borrador de ayer firmado hoy lleva la fecha y la cédula de hoy.
  const c = await cargarContexto(db, clinicId, actual.value.patientId, doctorId, ahora);
  if (c.ok === false) return c;

  const body = rellenar(typeof bodyNuevo === "string" ? bodyNuevo : actual.value.body, c.value);
  const malo = validarCuerpo(body);
  if (malo) return malo;

  // `status: "DRAFT"` en el WHERE, no solo en la lectura de arriba: si otra
  // pestaña la firmó entre medias, esta escritura no encuentra fila y lo
  // firmado se queda como estaba.
  const r = await db.patientDocument.updateMany({
    where: { id, clinicId, kind: NOTA_KIND, doctorId, status: "DRAFT" },
    data: {
      body,
      encabezado: { ...c.value.encabezado },
      ...(firmar ? { status: "SIGNED", signedAt: ahora, modoFirma: "DIGITAL" } : {}),
    },
  });
  if (r.count === 0) return falla("ALREADY_SIGNED");

  const nota = await getNota(db, clinicId, id);
  return nota ? bien(nota) : falla("NOT_FOUND");
}

export function updateNotaDraft(
  db: NotaDb, clinicId: string, id: string, doctorId: string, body: unknown, ahora: Date,
): Promise<NotaResult<NotaCompleta>> {
  return guardarBorrador(db, clinicId, id, doctorId, body, false, ahora);
}

/** Firma un borrador. `body` es opcional: lo último que había en el editor. */
export function signNota(
  db: NotaDb, clinicId: string, id: string, doctorId: string, body: unknown, ahora: Date,
): Promise<NotaResult<NotaCompleta>> {
  return guardarBorrador(db, clinicId, id, doctorId, body, true, ahora);
}
