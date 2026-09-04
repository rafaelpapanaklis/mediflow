/**
 * DaleControl INSTITUCIONAL — los CONSENTIMIENTOS contra la base de datos.
 *
 * SERVIDOR: importa prisma, node:crypto y el helper del bucket. Lo puro
 * (estado derivado, texto canónico, topes, paths) vive en
 * consentimientos-core.ts; aquí solo hay consultas y escrituras.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA VISIBILIDAD DE UN CONSENTIMIENTO ES LA DEL RECURSO "patients",
 * NO LA DEL EXPEDIENTE. Esta es LA decisión de seguridad del archivo y hay
 * que leerla antes de tocar nada.
 *
 * Las notas, el odontograma y los estudios se leen con el recurso "cases"
 * (expediente-core.ts), y para CAJA eso es "none": caja no abre expediente
 * clínico. Aquí es distinto A PROPÓSITO, porque el contrato de esta ola lo
 * pide con todas sus letras: «CAJA: solo view (recepción entrega la
 * carta)». Y es correcto:
 *
 *   · el consentimiento es un documento que el paciente FIRMA y se LLEVA;
 *   · quien se lo imprime, se lo entrega y le explica dónde firmar es
 *     recepción, que es quien está en el mostrador;
 *   · lo que contiene es el acto que se autoriza y sus riesgos — no la
 *     nota clínica, no el diagnóstico, no el odontograma.
 *
 * Con el alcance del expediente, caja no vería ni una carta y no podría
 * hacer su trabajo. Con el de "patients", ve las de los pacientes que ya
 * ve (todos), y sigue sin ver una sola nota clínica.
 *
 * ⚠️ Lo que NO cambia: el ALUMNO sigue viendo solo lo de SUS pacientes y
 * el DOCENTE lo de sus alumnos VIGENTES, porque para ellos "patients" y
 * "cases" recortan igual. La única diferencia entre los dos recursos es
 * caja, y es justo la que aquí queremos.
 *
 * 🔴 Y el permiso es OTRO candado: `consentimientos.view` para leer,
 * `.create` para emitir y `.revoke` para revocar. Caja solo tiene el
 * primero: recibe y entrega, no emite consentimientos.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { validateSignatureDataUrl } from "@/lib/consent/signature";
import {
  eduCleanId,
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import { eduAgeYears } from "@/lib/edu/pacientes-core";
import {
  EDU_CONSENT_CONTENT_MAX,
  EDU_CONSENT_MAX_ROWS,
  EDU_CONSENT_NAME_MAX,
  EDU_CONSENT_PROCEDURE_MAX,
  EDU_CONSENT_REASON_MAX,
  EDU_CONSENT_RELATION_MAX,
  EDU_CONSENT_TOKEN_BYTES,
  EDU_CONSENT_TTL_DAYS,
  eduConsentCanonicalText,
  eduConsentEstado,
  eduConsentPublicPath,
  eduConsentSePuedeFirmar,
  eduConsentSePuedeRevocar,
  eduConsentSignaturePath,
  eduConsentTemplateExists,
  eduConsentTexto,
  eduConsentText,
  eduConsentTokenIsValid,
  type EduConsentIntegridad,
  type EduConsentPublicView,
  type EduConsentRow,
  type EduConsentSlot,
} from "@/lib/edu/consentimientos-core";
import { eduSignRead, eduStorageConfigured, eduStorageUpload } from "@/lib/edu/storage";
import {
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import { eduClinicalScope } from "@/lib/edu/expediente-core";

export { EduPadronError as EduConsentError };

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function personName(u: { firstName: string; lastName: string; email?: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

function stampLabel(d: Date | null, timeZone: string): string | null {
  if (!d) return null;
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/**
 * SHA-256 del texto canónico.
 *
 * El `createHash` vive aquí y NO en el módulo puro a propósito:
 * `node:crypto` importado desde un componente "use client" rompe el
 * bundle, y `eduConsentCanonicalText` la importa la pantalla para poder
 * previsualizar la carta. La receta (normalización NFC/CRLF y el orden de
 * los campos) está allá, probada sin Node; aquí solo se digiere.
 */
export function eduConsentHash(procedure: string, content: string): string {
  return createHash("sha256")
    .update(eduConsentCanonicalText({ procedure, content }), "utf8")
    .digest("hex");
}

// ═══════════════════════════════════════════════════════════════════════
// EL ALCANCE
// ═══════════════════════════════════════════════════════════════════════

/**
 * El paciente, buscado DENTRO del alcance de "patients".
 *
 * Ver la nota de arriba: es el único sitio del vertical que lee un
 * documento del paciente con este recurso en vez de con el del
 * expediente, y es para que recepción pueda entregar la carta.
 */
async function getEduConsentPatient(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date,
): Promise<
  | { id: string; folio: string; firstName: string; lastName: string; birthDate: Date | null }
  | null
> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(patientId);
  if (!id) return null;

  return prisma.eduPatient.findFirst({
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: { id: true, folio: true, firstName: true, lastName: true, birthDate: true },
  });
}

const CONSENT_SELECT = {
  id: true,
  patientId: true,
  caseId: true,
  procedure: true,
  procedureKey: true,
  token: true,
  expiresAt: true,
  studentUserId: true,
  studentName: true,
  studentMatricula: true,
  supervisorUserId: true,
  supervisorName: true,
  createdByName: true,
  signerName: true,
  signerRelation: true,
  signedAt: true,
  viewedAt: true,
  witness1Name: true,
  witness1SignedAt: true,
  witness2Name: true,
  witness2SignedAt: true,
  studentSignedAt: true,
  supervisorSignedAt: true,
  supervisorSignedByName: true,
  revokedAt: true,
  revokedByName: true,
  revokedReason: true,
  createdAt: true,
  case: { select: { program: { select: { name: true } } } },
} satisfies Prisma.EduConsentSelect;

type ConsentPayload = Prisma.EduConsentGetPayload<{ select: typeof CONSENT_SELECT }>;

/**
 * userId (EduUser) → id (EduStudent), para las filas de la pantalla.
 *
 * Una consulta por página, no una por fila. Sale del `studentUserId` que
 * guarda la CARTA —no de `case.student`— porque esa es la columna de la que
 * salen también `studentName` y `studentMatricula`: si el id viniera del
 * caso, el enlace podría abrir la ficha de alguien distinto del nombre que
 * se está leyendo el día que las dos columnas no coincidan.
 *
 * `userId` es `@unique` en EduStudent, así que el mapa es uno a uno.
 * `institutionId` va en el where aunque `userId` ya sea único: un id de otra
 * institución tiene que devolver vacío, no la fila de la vecina.
 */
async function mapaEstudiantePorUsuario(
  institutionId: string,
  userIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((v): v is string => typeof v === "string" && v !== "")));
  const mapa = new Map<string, string>();
  if (ids.length === 0) return mapa;
  const filas = await prisma.eduStudent.findMany({
    where: { institutionId, userId: { in: ids } },
    select: { id: true, userId: true },
  });
  for (const f of filas) mapa.set(f.userId, f.id);
  return mapa;
}

function toRow(
  c: ConsentPayload,
  timeZone: string,
  meUserId: string,
  now: Date,
  estudiantePorUsuario: Map<string, string>,
): EduConsentRow {
  const estado = eduConsentEstado(c, now);
  const firmado = c.signedAt !== null;
  const vivo = c.revokedAt === null;
  return {
    id: c.id,
    estado,

    procedure: c.procedure,
    procedureKey: c.procedureKey,

    patientId: c.patientId,
    caseId: c.caseId,
    caseProgramName: c.case ? c.case.program.name : null,

    studentUserId: c.studentUserId,
    studentId: c.studentUserId ? estudiantePorUsuario.get(c.studentUserId) ?? null : null,
    studentName: c.studentName,
    studentMatricula: c.studentMatricula,
    supervisorUserId: c.supervisorUserId,
    supervisorName: c.supervisorName,

    createdByName: c.createdByName,

    // La liga solo se pinta mientras sirva para algo. Enseñar la de una
    // carta ya firmada invita a mandarla otra vez y a que el paciente
    // abra un documento que no puede tocar.
    publicPath: estado === "PENDIENTE" ? eduConsentPublicPath(c.token) : null,

    signerName: c.signerName,
    signerRelation: c.signerRelation,
    signedAt: iso(c.signedAt),
    signedLabel: stampLabel(c.signedAt, timeZone),
    viewedAt: iso(c.viewedAt),
    viewedLabel: stampLabel(c.viewedAt, timeZone),

    witness1Name: c.witness1Name,
    witness1SignedAt: iso(c.witness1SignedAt),
    witness2Name: c.witness2Name,
    witness2SignedAt: iso(c.witness2SignedAt),

    studentSignedAt: iso(c.studentSignedAt),
    supervisorSignedAt: iso(c.supervisorSignedAt),
    supervisorSignedByName: c.supervisorSignedByName,

    revokedAt: iso(c.revokedAt),
    revokedLabel: stampLabel(c.revokedAt, timeZone),
    revokedByName: c.revokedByName,
    revokedReason: c.revokedReason,

    createdAt: c.createdAt.toISOString(),
    createdLabel: stampLabel(c.createdAt, timeZone) ?? "",
    expiresAt: c.expiresAt.toISOString(),
    expiresLabel: stampLabel(c.expiresAt, timeZone) ?? "",

    // 🔴 Lo decide el SERVIDOR comparando con el id de la sesión, no el
    // navegador. Es una comodidad visual (el endpoint lo vuelve a exigir),
    // pero calcularla en el cliente exigiría mandarle los ids de las dos
    // personas y una regla que ahí se puede editar.
    puedeContrafirmarComoAlumno:
      firmado && vivo && c.studentSignedAt === null && c.studentUserId === meUserId,
    puedeContrafirmarComoDocente:
      firmado && vivo && c.supervisorSignedAt === null && c.supervisorUserId === meUserId,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURA (panel)
// ═══════════════════════════════════════════════════════════════════════

export async function listEduPatientConsents(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduConsentRow[]> {
  const institutionId = requireInstitution(ctx);
  const paciente = await getEduConsentPatient(ctx, patientId, now);
  if (!paciente) return [];

  const rows = await prisma.eduConsent.findMany({
    where: { institutionId, patientId: paciente.id },
    orderBy: [{ createdAt: "desc" }],
    take: EDU_CONSENT_MAX_ROWS,
    select: CONSENT_SELECT,
  });

  const estudiantePorUsuario = await mapaEstudiantePorUsuario(
    institutionId,
    rows.map((r) => r.studentUserId),
  );

  return rows.map((r) => toRow(r, timeZone, ctx.eduUserId, now, estudiantePorUsuario));
}

// ═══════════════════════════════════════════════════════════════════════
// ALTA
// ═══════════════════════════════════════════════════════════════════════

export interface EduConsentCreateInput {
  caseId?: unknown;
  procedureKey?: unknown;
  procedure?: unknown;
  content?: unknown;
  signerName?: unknown;
  signerRelation?: unknown;
}

/**
 * Emite una carta.
 *
 * 🔴 EL CASO ES OBLIGATORIO, y no es burocracia. La carta tiene que decir
 * QUIÉN te va a atender y QUIÉN responde, y en este vertical ese par ES el
 * caso: `EduCase.studentId` (el alumno) y `EduCase.supervisorUserId` (su
 * docente). Sin caso habría que teclear los dos nombres a mano, y un
 * documento legal cuyo responsable se escribió a mano no se puede
 * verificar contra nada.
 *
 * Consecuencia conocida y aceptada: no hay consentimiento para la cita de
 * TAMIZAJE, que ocurre antes de que exista el caso. Queda anotado en
 * ORQUESTA.md como pendiente, no escondido aquí.
 *
 * 🔴 SI EL CASO NO TIENE DOCENTE, NO HAY CARTA. Se rebota con un mensaje
 * que dice qué hacer (asignarle supervisor al caso). Aflojar la regla
 * —emitirla con el hueco vacío— produciría exactamente el documento que
 * esta ola existe para impedir: uno donde nadie responde.
 *
 * El TEXTO puede venir del cliente ya editado, y es a propósito: la
 * plantilla es una BASE que el alumno completa para el caso concreto
 * (mismo criterio que el modal del dental). Quien la edita está
 * autenticado y tiene `consentimientos.create`; lo que se guarda es lo que
 * el paciente va a firmar, y su hash queda congelado con ello.
 */
export async function createEduConsent(
  ctx: EduClinicaContext,
  patientId: string,
  input: EduConsentCreateInput,
  now: Date = new Date(),
): Promise<{ id: string; token: string }> {
  const institutionId = requireInstitution(ctx);

  const paciente = await getEduConsentPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no te toca.", 404);

  const caseId = eduCleanId(input.caseId);
  if (!caseId) {
    throw new EduPadronError(
      "Falta el caso. El consentimiento tiene que decir qué estudiante te va a atender y qué docente responde, y eso sale del caso.",
    );
  }

  // El caso se busca dentro del alcance CLÍNICO (recurso "cases"): quien
  // emite la carta es alguien que abre expediente, no recepción. Caja no
  // llega hasta aquí porque no tiene `consentimientos.create`, pero si un
  // día se lo dieran por error, este `where` no le devolvería ni un caso.
  const clinico = eduClinicalScope(ctx);
  const caso = eduScopeIsEmpty(clinico)
    ? null
    : await prisma.eduCase.findFirst({
        where: {
          ...eduCaseScopeWhere({ institutionId, scope: clinico, now }),
          id: caseId,
          patientId: paciente.id,
        },
        select: {
          id: true,
          supervisorUserId: true,
          program: { select: { name: true } },
          student: {
            select: {
              matricula: true,
              userId: true,
              user: { select: { firstName: true, lastName: true, email: true } },
            },
          },
          supervisor: { select: { firstName: true, lastName: true, email: true } },
        },
      });
  if (!caso) throw new EduPadronError("Ese caso no es de este paciente o no te toca.", 404);

  if (!caso.supervisorUserId || !caso.supervisor) {
    throw new EduPadronError(
      "Ese caso no tiene docente responsable. Un consentimiento informado tiene que decir quién responde del acto: asígnale supervisor al caso y vuelve a intentarlo.",
      409,
    );
  }

  const procedureKeyRaw = typeof input.procedureKey === "string" ? input.procedureKey.trim() : "";
  const procedureKey = eduConsentTemplateExists(procedureKeyRaw) ? procedureKeyRaw : null;

  const signerName = eduConsentText(input.signerName, EDU_CONSENT_NAME_MAX);
  const signerRelation = eduConsentText(input.signerRelation, EDU_CONSENT_RELATION_MAX);
  if (signerName && !signerRelation) {
    throw new EduPadronError(
      "Falta el parentesco del representante legal. La NOM-004 pide quién firma y qué relación tiene con el paciente.",
    );
  }

  const institution = await prisma.eduInstitution.findUnique({
    where: { id: institutionId },
    select: { name: true, city: true, timezone: true },
  });
  if (!institution) throw new EduPadronError("Instituto no encontrado.", 404);

  const studentName = personName(caso.student.user);
  const supervisorName = personName(caso.supervisor);

  const textoBase = eduConsentTexto({
    procedureKey,
    procedure: "",
    institutionName: institution.name,
    institutionCity: institution.city,
    timezone: institution.timezone,
    patientName: eduPatientFullName(paciente),
    patientAge: eduAgeYears(paciente.birthDate, now),
    patientFolio: paciente.folio,
    studentName,
    studentMatricula: caso.student.matricula,
    programName: caso.program.name,
    supervisorName,
    signerName,
    signerRelation,
  });

  const content = eduConsentText(input.content, EDU_CONSENT_CONTENT_MAX) ?? textoBase;
  if (content.trim().length < 80) {
    throw new EduPadronError(
      "El texto del consentimiento es demasiado corto. Una carta de consentimiento informado tiene que describir el acto, sus riesgos y las alternativas.",
    );
  }

  const procedure =
    eduConsentText(input.procedure, EDU_CONSENT_PROCEDURE_MAX) ??
    (procedureKey ? procedureKey : null);
  if (!procedure) {
    throw new EduPadronError("Falta el nombre del procedimiento que se consiente.");
  }

  const expiresAt = new Date(now.getTime() + EDU_CONSENT_TTL_DAYS * 24 * 60 * 60 * 1000);

  const created = await prisma.eduConsent.create({
    data: {
      institutionId,
      patientId: paciente.id,
      caseId: caso.id,
      procedureKey,
      procedure,
      content,
      contentHash: eduConsentHash(procedure, content),
      // 32 bytes de crypto, no Math.random(): el token ES la credencial de
      // la liga pública y un generador predecible es una carta ajena.
      token: randomBytes(EDU_CONSENT_TOKEN_BYTES).toString("base64url"),
      expiresAt,

      studentUserId: caso.student.userId,
      studentName,
      studentMatricula: caso.student.matricula,
      supervisorUserId: caso.supervisorUserId,
      supervisorName,
      createdByUserId: ctx.eduUserId,
      createdByName: ctx.eduUserId ? await nombreDeSesion(ctx) : "Sin nombre",

      signerName,
      signerRelation,
    },
    select: { id: true, token: true },
  });

  return created;
}

/** El nombre de quien está en la sesión, congelado en la fila. */
async function nombreDeSesion(ctx: EduClinicaContext): Promise<string> {
  const u = await prisma.eduUser.findFirst({
    where: { id: ctx.eduUserId, institutionId: ctx.institutionId },
    select: { firstName: true, lastName: true, email: true },
  });
  return u ? personName(u) : "Sin nombre";
}

// ═══════════════════════════════════════════════════════════════════════
// REVOCAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Revoca: NO borra, deja constancia.
 *
 * Se puede revocar una carta pendiente, una vencida y una firmada. No se
 * exige que esté firmada a propósito: "el paciente dijo que no" es una
 * constancia que hay que poder dejar aunque nunca llegara a firmar, y es
 * también como se anula una carta emitida por error sin borrar una fila.
 *
 * ⚠️ CONSECUENCIA CONOCIDA Y ACEPTADA, para que no se descubra sola: el
 * alcance es el del PACIENTE, así que un alumno puede revocar la carta de
 * OTRO caso del mismo paciente — la señora que lleva endodoncia con uno y
 * ortodoncia con otro tiene dos alumnos que la ven. Se aceptó porque:
 *   · no borra nada (la carta queda, marcada, con quién la revocó y por
 *     qué), así que el daño es ruido reversible con una carta nueva;
 *   · el estado peligroso es el contrario — un consentimiento VIVO para un
 *     procedimiento que el paciente ya rechazó, porque quien lo escuchó
 *     rechazarlo no podía anotarlo.
 * Si algún día se quiere estrechar, el sitio es este `where`: añadirle
 * `OR: [{ studentUserId: ctx.eduUserId }, { supervisorUserId: ctx.eduUserId }]`
 * para los roles que no son DIRECCION.
 */
export async function revokeEduConsent(
  ctx: EduClinicaContext,
  consentId: string,
  input: { reason?: unknown },
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(consentId);
  if (!id) throw new EduPadronError("Falta el consentimiento.", 400);

  const actual = await cargarEnAlcance(ctx, id, now);
  if (!eduConsentSePuedeRevocar(actual)) {
    throw new EduPadronError("Ese consentimiento ya estaba revocado.", 409);
  }

  const reason = eduConsentText(input.reason, EDU_CONSENT_REASON_MAX);
  if (!reason) {
    throw new EduPadronError(
      "Falta el motivo. Una revocación sin motivo no sirve de constancia: escribe quién la pidió y por qué.",
    );
  }

  // `revokedAt: null` en el where: dos clics seguidos no reescriben la
  // hora ni el motivo de la primera revocación.
  const res = await prisma.eduConsent.updateMany({
    where: { id, institutionId, revokedAt: null },
    data: {
      revokedAt: now,
      revokedByUserId: ctx.eduUserId,
      revokedByName: await nombreDeSesion(ctx),
      revokedReason: reason,
    },
  });
  if (res.count === 0) throw new EduPadronError("Ese consentimiento ya estaba revocado.", 409);
  return { ok: true };
}

/** Carga una carta comprobando el alcance del paciente. 404 si no toca. */
async function cargarEnAlcance(
  ctx: EduClinicaContext,
  consentId: string,
  now: Date,
): Promise<{
  id: string;
  patientId: string;
  signedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  studentUserId: string | null;
  supervisorUserId: string | null;
  studentSignedAt: Date | null;
  supervisorSignedAt: Date | null;
}> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) throw new EduPadronError("Ese consentimiento no existe.", 404);

  const row = await prisma.eduConsent.findFirst({
    where: {
      id: consentId,
      institutionId,
      // El recorte cuelga del PACIENTE, que es de donde cuelga la carta.
      patient: eduPatientScopeWhere({ institutionId, scope, now }),
    },
    select: {
      id: true,
      patientId: true,
      signedAt: true,
      revokedAt: true,
      expiresAt: true,
      studentUserId: true,
      supervisorUserId: true,
      studentSignedAt: true,
      supervisorSignedAt: true,
    },
  });
  if (!row) throw new EduPadronError("Ese consentimiento no existe.", 404);
  return row;
}

// ═══════════════════════════════════════════════════════════════════════
// CONTRAFIRMA (desde el panel, con sesión)
// ═══════════════════════════════════════════════════════════════════════

/**
 * La contrafirma del profesional (NOM-013 9.6.9), que aquí son DOS.
 *
 * 🔴 EL HUECO LO DECIDE LA SESIÓN, NUNCA EL CUERPO. Se compara el
 * `eduUserId` con las dos columnas de la carta:
 *   · es el alumno del caso  → firma el hueco del alumno;
 *   · es el docente responsable, o es DIRECCION → firma el del docente, y
 *     se guarda aparte QUIÉN firmó (supervisorSignedByName), que puede no
 *     ser el titular si ya rotó.
 * Si el cuerpo pudiera elegir el hueco, cualquiera con el permiso firmaría
 * como el docente responsable de un acto que no supervisó.
 *
 * 🔴 NO SE CONTRAFIRMA UNA CARTA QUE EL PACIENTE NO HA FIRMADO. Es la
 * regla que impide lo que de verdad pasa en una escuela con prisa: firmar
 * de antemano un fajo de cartas en blanco para "adelantar trámite". La
 * contrafirma acredita un acto que ya ocurrió.
 */
export async function countersignEduConsent(
  ctx: EduClinicaContext,
  consentId: string,
  input: { signatureDataUrl?: unknown },
  now: Date = new Date(),
): Promise<{ ok: true; slot: EduConsentSlot }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(consentId);
  if (!id) throw new EduPadronError("Falta el consentimiento.", 400);

  const actual = await cargarEnAlcance(ctx, id, now);

  if (actual.revokedAt) {
    throw new EduPadronError("Ese consentimiento está revocado: no se contrafirma.", 409);
  }
  if (!actual.signedAt) {
    throw new EduPadronError(
      "El paciente todavía no ha firmado. La contrafirma acredita un acto que ya ocurrió: no se firma una carta en blanco.",
      409,
    );
  }

  const esAlumno = Boolean(actual.studentUserId) && actual.studentUserId === ctx.eduUserId;
  const esDocente =
    (Boolean(actual.supervisorUserId) && actual.supervisorUserId === ctx.eduUserId) ||
    ctx.role === "DIRECCION";

  let slot: EduConsentSlot;
  if (esAlumno) slot = "alumno";
  else if (esDocente) slot = "docente";
  else {
    throw new EduPadronError(
      "Esta carta la contrafirman el estudiante que atiende y su docente responsable. Tú no eres ninguno de los dos.",
      403,
    );
  }

  if (slot === "alumno" && actual.studentSignedAt) {
    throw new EduPadronError("Ya contrafirmaste esta carta.", 409);
  }
  if (slot === "docente" && actual.supervisorSignedAt) {
    throw new EduPadronError("El docente responsable ya contrafirmó esta carta.", 409);
  }

  const path = await guardarFirma(institutionId, id, slot, input.signatureDataUrl);

  const data: Prisma.EduConsentUpdateManyMutationInput =
    slot === "alumno"
      ? { studentSignedAt: now, studentSignatureUrl: path }
      : {
          supervisorSignedAt: now,
          supervisorSignatureUrl: path,
          supervisorSignedByUserId: ctx.eduUserId,
          supervisorSignedByName: await nombreDeSesion(ctx),
        };

  // El guard en el `where` (el hueco todavía vacío) es lo que hace que dos
  // toques seguidos no reescriban la hora de la primera contrafirma.
  const where: Prisma.EduConsentWhereInput =
    slot === "alumno"
      ? { id, institutionId, revokedAt: null, studentSignedAt: null }
      : { id, institutionId, revokedAt: null, supervisorSignedAt: null };

  const res = await prisma.eduConsent.updateMany({ where, data });
  if (res.count === 0) throw new EduPadronError("Esa contrafirma ya estaba puesta.", 409);
  return { ok: true, slot };
}

/**
 * Valida la firma y la guarda. Devuelve el PATH, o null si el guardado
 * falló.
 *
 * Best-effort en el GUARDADO y estricto en la VALIDACIÓN, y ese reparto es
 * a propósito: unos bytes que no son una imagen no entran nunca (la
 * comprobación es de magic number, no de extensión), pero si Storage está
 * caído, perder el PNG es malo y perder la aceptación que la persona acaba
 * de dar —y pedirle que vuelva a firmar— es peor. La constancia jurídica
 * es la fecha y la evidencia de la fila; la imagen la acompaña.
 */
async function guardarFirma(
  institutionId: string,
  consentId: string,
  slot: EduConsentSlot,
  dataUrl: unknown,
): Promise<string | null> {
  const check = await validateSignatureDataUrl(dataUrl);
  if (check.error) {
    throw new EduPadronError(
      check.detail ? `${check.error} (${check.detail})` : check.error,
      check.status,
    );
  }
  if (!eduStorageConfigured()) {
    console.warn("[instituto/consentimientos] sin Storage: la firma no se guarda como imagen");
    return null;
  }
  return eduStorageUpload(
    eduConsentSignaturePath(institutionId, consentId, slot),
    check.buffer,
    "image/png",
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LA PÁGINA PÚBLICA — SIN SESIÓN. EL TOKEN ES LA CREDENCIAL.
// ═══════════════════════════════════════════════════════════════════════

const PUBLIC_SELECT = {
  id: true,
  institutionId: true,
  procedure: true,
  content: true,
  contentHash: true,
  expiresAt: true,
  studentName: true,
  supervisorName: true,
  signerName: true,
  signerRelation: true,
  signedAt: true,
  signatureUrl: true,
  viewedAt: true,
  witness1Name: true,
  witness1SignedAt: true,
  witness2Name: true,
  witness2SignedAt: true,
  studentSignedAt: true,
  supervisorSignedAt: true,
  revokedAt: true,
  revokedReason: true,
  patient: { select: { firstName: true, lastName: true } },
  // `timezone` para P2-14: la fecha de firma viaja YA formateada en la zona
  // del instituto — nunca la formatea el navegador del paciente.
  institution: { select: { name: true, phone: true, timezone: true } },
} satisfies Prisma.EduConsentSelect;

/**
 * Lo que ve el paciente.
 *
 * Marca `viewedAt` la PRIMERA vez, con un `updateMany` guardado en
 * `viewedAt: null` — sin condición de carrera y una sola vez. Es la
 * evidencia de que el documento se abrió ANTES de firmarse, que es toda la
 * diferencia entre un consentimiento informado y una firma a ciegas. Es
 * best-effort: fallar aquí no puede impedirle al paciente leer su carta.
 */
export async function getEduConsentPublic(
  token: unknown,
  now: Date = new Date(),
): Promise<EduConsentPublicView | null> {
  if (!eduConsentTokenIsValid(token)) return null;

  const c = await prisma.eduConsent.findUnique({
    where: { token },
    select: PUBLIC_SELECT,
  });
  if (!c) return null;

  if (!c.viewedAt) {
    await prisma.eduConsent
      .updateMany({ where: { id: c.id, viewedAt: null }, data: { viewedAt: now } })
      .catch(() => undefined);
  }

  const firma =
    c.signatureUrl && eduStorageConfigured()
      ? await eduSignRead(c.signatureUrl).catch(() => "")
      : "";

  // 🔴 La huella se RECALCULA aquí y se compara con la que se guardó al
  // emitir. Es lo que convierte `contentHash` en una comprobación de
  // verdad en vez de una columna decorativa: si alguien tocó el texto de
  // una carta ya emitida —una consulta directa a la base, una migración
  // mal hecha— deja de cuadrar y se ve, en la pantalla del paciente y en
  // el log del servidor.
  let integridad: EduConsentIntegridad = "sin_hash";
  if (c.contentHash) {
    const recalculado = eduConsentHash(c.procedure, c.content);
    integridad = recalculado === c.contentHash ? "ok" : "alterado";
    if (integridad === "alterado") {
      console.error(
        "[instituto/consentimientos] HUELLA QUE NO CUADRA en el consentimiento",
        c.id,
        "— el texto guardado cambió después de emitirse",
      );
    }
  }

  return {
    procedure: c.procedure,
    content: c.content,
    integridad,
    institutionName: c.institution.name,
    institutionPhone: c.institution.phone,
    patientName: eduPatientFullName(c.patient),
    studentName: c.studentName,
    supervisorName: c.supervisorName,

    estado: eduConsentEstado(c, now),
    puedeFirmar: eduConsentSePuedeFirmar(c, now),

    signedAt: iso(c.signedAt),
    // P2-14: formateada AQUÍ, con la zona del instituto — igual que toRow
    // hace para el panel. Era la única fecha del vertical que formateaba el
    // navegador, y en el peor sitio posible: un documento legal.
    signedLabel: stampLabel(c.signedAt, c.institution.timezone),
    signerName: c.signerName,
    signerRelation: c.signerRelation,
    signatureUrl: firma || null,

    witness1Name: c.witness1Name,
    witness1SignedAt: iso(c.witness1SignedAt),
    witness2Name: c.witness2Name,
    witness2SignedAt: iso(c.witness2SignedAt),

    studentSignedAt: iso(c.studentSignedAt),
    supervisorSignedAt: iso(c.supervisorSignedAt),

    revokedAt: iso(c.revokedAt),
    revokedReason: c.revokedReason,
    expiresAt: c.expiresAt.toISOString(),
  };
}

export interface EduConsentSignInput {
  rol?: unknown;
  signatureDataUrl?: unknown;
  witnessName?: unknown;
}

export interface EduConsentSignMeta {
  ip: string | null;
  userAgent: string | null;
}

/**
 * El paciente (o un testigo) firma desde la página pública.
 *
 * 🔴 Aquí NO hay sesión ni permiso: el token es la credencial. Todo lo que
 * protege esta función es lo que comprueba ella misma, así que se
 * comprueba TODO otra vez aunque la página ya lo hubiera pintado:
 *
 *   · el token tiene forma válida y existe (si no: 404, el mismo para los
 *     dos casos — cualquier diferencia es un oráculo para adivinar tokens);
 *   · la carta se puede firmar AHORA (ni revocada, ni firmada, ni vencida);
 *   · los bytes de la firma son de verdad una imagen (magic number);
 *   · un testigo solo firma DESPUÉS del paciente: atestigua una firma que
 *     ya ocurrió, no una que va a ocurrir.
 *
 * La evidencia (IP y navegador) se toma de las cabeceras en el route
 * handler y llega aquí como dato: este módulo no conoce el objeto Request.
 */
export async function signEduConsentPublic(
  token: unknown,
  input: EduConsentSignInput,
  meta: EduConsentSignMeta,
  now: Date = new Date(),
): Promise<{ ok: true; rol: string }> {
  if (!eduConsentTokenIsValid(token)) {
    throw new EduPadronError("Esa carta no existe.", 404);
  }

  const c = await prisma.eduConsent.findUnique({
    where: { token },
    select: {
      id: true,
      institutionId: true,
      signedAt: true,
      revokedAt: true,
      expiresAt: true,
      witness1SignedAt: true,
      witness2SignedAt: true,
    },
  });
  if (!c) throw new EduPadronError("Esa carta no existe.", 404);

  if (c.revokedAt) {
    throw new EduPadronError("Este consentimiento fue revocado y ya no se puede firmar.", 409);
  }

  const rol = typeof input.rol === "string" ? input.rol : "paciente";

  if (rol === "paciente") {
    if (c.signedAt) throw new EduPadronError("Esta carta ya está firmada.", 409);
    if (now > c.expiresAt) {
      throw new EduPadronError(
        "La liga para firmar caducó. Pídele al instituto que te genere una carta nueva.",
        410,
      );
    }

    const path = await guardarFirma(c.institutionId, c.id, "paciente", input.signatureDataUrl);

    // `signedAt: null` en el where: dos toques seguidos en la tableta no
    // sobrescriben la hora de la primera firma.
    const res = await prisma.eduConsent.updateMany({
      where: { id: c.id, signedAt: null, revokedAt: null },
      data: {
        signedAt: now,
        signatureUrl: path,
        signedIp: meta.ip,
        signedUserAgent: (meta.userAgent ?? "").slice(0, 400) || null,
      },
    });
    if (res.count === 0) throw new EduPadronError("Esta carta ya está firmada.", 409);
    return { ok: true, rol };
  }

  if (rol !== "testigo1" && rol !== "testigo2") {
    throw new EduPadronError("Ese rol de firma no existe.", 400);
  }

  if (!c.signedAt) {
    throw new EduPadronError(
      "El paciente todavía no firma. Un testigo atestigua una firma que ya ocurrió.",
      409,
    );
  }

  const yaFirmo = rol === "testigo1" ? c.witness1SignedAt : c.witness2SignedAt;
  if (yaFirmo) throw new EduPadronError("Ese testigo ya firmó.", 409);

  const witnessName = eduConsentText(input.witnessName, EDU_CONSENT_NAME_MAX);
  if (!witnessName) {
    throw new EduPadronError("Falta el nombre del testigo. La NOM-004 pide nombre y firma.");
  }

  const slot: EduConsentSlot = rol === "testigo1" ? "testigo1" : "testigo2";
  const path = await guardarFirma(c.institutionId, c.id, slot, input.signatureDataUrl);

  const where: Prisma.EduConsentWhereInput =
    rol === "testigo1"
      ? { id: c.id, revokedAt: null, witness1SignedAt: null }
      : { id: c.id, revokedAt: null, witness2SignedAt: null };
  const data: Prisma.EduConsentUpdateManyMutationInput =
    rol === "testigo1"
      ? { witness1Name: witnessName, witness1SignedAt: now, witness1SignatureUrl: path }
      : { witness2Name: witnessName, witness2SignedAt: now, witness2SignatureUrl: path };

  const res = await prisma.eduConsent.updateMany({ where, data });
  if (res.count === 0) throw new EduPadronError("Ese testigo ya firmó.", 409);
  return { ok: true, rol };
}

// ═══════════════════════════════════════════════════════════════════════
// LO QUE NECESITA LA PANTALLA PARA PREVISUALIZAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * El DOCENTE responsable de cada caso del paciente, por id de caso.
 *
 * Existe porque la vista previa de la carta lo necesita —el bloque 0 dice
 * quién responde— y `EduCaseOption` (expediente-core.ts) no lo trae: se
 * definió en la Ola 3 para un `<select>` de notas, donde el supervisor no
 * pinta nada. Agregarle el campo allí habría cambiado la forma que ya
 * consumen tres pantallas por una necesidad de ésta.
 *
 * Un caso sin docente sale con `null`, y la pantalla lo dice ANTES de
 * dejar emitir — mismo mensaje que rebotaría el servidor, pero a tiempo.
 */
export async function getEduCaseSupervisorNames(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date = new Date(),
): Promise<Record<string, string | null>> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return {};
  const id = eduCleanId(patientId);
  if (!id) return {};

  const casos = await prisma.eduCase.findMany({
    where: {
      ...eduCaseScopeWhere({ institutionId, scope, now }),
      patientId: id,
    },
    select: {
      id: true,
      supervisor: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  const out: Record<string, string | null> = {};
  for (const c of casos) out[c.id] = c.supervisor ? personName(c.supervisor) : null;
  return out;
}
