/**
 * DaleControl INSTITUCIONAL — EL CONSENTIMIENTO INFORMADO, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin node:crypto,
 * sin `new Date()` escondido: el `now` siempre se pasa). Lo importan el
 * servidor, la pantalla del panel y la página PÚBLICA de firma, para que los
 * tres digan exactamente lo mismo sobre el mismo documento.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTO NO SE IMPORTA DEL DENTAL: LLEVA TABLA PROPIA.
 *
 * El módulo de consentimientos del dental (modelo ConsentForm, rutas
 * /api/consent/**, página /consentimiento/[token]) resuelve contra
 * `Clinic` y `Patient`, guarda las firmas en el bucket `patient-files` y
 * sus endpoints se autentican con getAuthContext. Nada de eso existe aquí.
 *
 * Lo que SÍ se reusa —importado, no copiado— es lo PURO y lo bueno:
 *
 *   · src/lib/consent/templates.ts   → `buildConsentContent`, la redacción
 *     completa que sigue la NOM-004-SSA3-2012 10.1.1 y la NOM-013-SSA2-2015
 *     9.6.9, con sus riesgos, alternativas, curso sin tratamiento y cláusula
 *     de revocabilidad. Copiarla habría significado tener dos textos
 *     médico-legales que empiezan iguales y terminan distintos, y el
 *     paciente firmando el que se quedó atrás.
 *   · src/lib/consent/dates.ts       → fechas en la zona del establecimiento
 *   · src/components/ui/signature-pad.tsx → captura de firma en canvas
 *   · src/lib/consent/signature.ts   → `validateSignatureDataUrl` (magic
 *     number: que los bytes sean de verdad una imagen). Su `uploadSignature`
 *     NO se usa: escribe en el bucket del dental.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE UNA ESCUELA TIENE Y UNA CLÍNICA NO: DOS PROFESIONALES.
 *
 * En un consultorio hay un estomatólogo: explica, trata y firma. En una
 * escuela son dos personas distintas y las dos tienen que quedar escritas:
 *
 *   · el ALUMNO   explica el procedimiento y lo va a realizar;
 *   · el DOCENTE  es el responsable del acto y lo autoriza.
 *
 * Por eso el documento tiene DOS contrafirmas y no una, y por eso la carta
 * lleva un bloque propio —antes de todo lo demás— que le dice al paciente,
 * con todas sus letras, que quien lo va a atender es un alumno y quién lo
 * supervisa. Un consentimiento de clínica universitaria que no dice eso no
 * está informando de lo que más le importa saber a quien firma.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL ESTADO SE DERIVA, NO SE GUARDA.
 *
 * No hay columna `status`. El estado sale de (signedAt, revokedAt,
 * expiresAt, now) y por una razón concreta: "vencido" depende de la HORA,
 * así que una columna guardada estaría mintiendo desde el segundo
 * siguiente a escribirla. Es la misma regla que `EduCase.closedAt` y
 * `eduRecordStamps`: lo que se deduce no se captura.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { buildConsentContent, listConsentTemplates } from "@/lib/consent/templates";

// ═══════════════════════════════════════════════════════════════════════
// 1 · CATÁLOGO Y TOPES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los procedimientos que ofrece el selector. Salen del catálogo del dental
 * (nueve procedimientos + la carta de atención general), que es puro.
 *
 * `null` como clave = texto libre: el alumno redacta la carta él. Existe
 * porque una escuela de especialidades hace cosas que un catálogo general
 * no contempla, y obligar a elegir "atención general" para una cirugía
 * periapical sería obligar a mentir en el documento.
 */
export function eduConsentTemplates(): { key: string; label: string }[] {
  return listConsentTemplates();
}

export function eduConsentTemplateExists(key: string | null | undefined): boolean {
  if (!key) return false;
  return eduConsentTemplates().some((t) => t.key === key);
}

export const EDU_CONSENT_PROCEDURE_MAX = 200;
export const EDU_CONSENT_CONTENT_MAX = 20000;
export const EDU_CONSENT_NAME_MAX = 160;
export const EDU_CONSENT_RELATION_MAX = 60;
export const EDU_CONSENT_REASON_MAX = 500;
export const EDU_CONSENT_MAX_ROWS = 200;

/**
 * Cuánto vive la liga para FIRMAR: 30 días.
 *
 * Vencer NO es perder el documento. Un consentimiento ya firmado se puede
 * seguir consultando para siempre —es la copia del paciente y no se le
 * esconde— y lo que caduca es la posibilidad de firmarlo. Es la misma
 * regla del dental y la razón por la que `eduConsentEstado` mira
 * `signedAt` ANTES que `expiresAt`.
 */
export const EDU_CONSENT_TTL_DAYS = 30;

/** El token de la liga pública: 43 caracteres base64url de 32 bytes. */
export const EDU_CONSENT_TOKEN_BYTES = 32;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * ¿Ese token tiene la forma de uno nuestro?
 *
 * Se comprueba ANTES de consultar la base para que un token basura no
 * llegue a Postgres, y para que la respuesta a "token con forma inválida"
 * sea idéntica —404— a la de "token que no existe". Cualquier diferencia
 * entre esos dos casos es un oráculo para adivinar tokens.
 */
export function eduConsentTokenIsValid(raw: unknown): raw is string {
  return typeof raw === "string" && TOKEN_RE.test(raw);
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL ESTADO, DERIVADO
// ═══════════════════════════════════════════════════════════════════════

export type EduConsentEstado = "PENDIENTE" | "FIRMADO" | "REVOCADO" | "VENCIDO";

export const EDU_CONSENT_ESTADO_LABELS: Record<EduConsentEstado, string> = {
  PENDIENTE: "Pendiente de firma",
  FIRMADO: "Firmado",
  REVOCADO: "Revocado",
  VENCIDO: "Liga vencida",
};

export const EDU_CONSENT_ESTADO_TAGS: Record<EduConsentEstado, string> = {
  PENDIENTE: "edu-tag--warn",
  FIRMADO: "edu-tag--ok",
  REVOCADO: "edu-tag--danger",
  VENCIDO: "edu-tag--muted",
};

export const EDU_CONSENT_ESTADO_DESCRIPTIONS: Record<EduConsentEstado, string> = {
  PENDIENTE: "La carta está lista y el paciente todavía no la firma.",
  FIRMADO: "El paciente aceptó. La carta ya no se edita.",
  REVOCADO: "El paciente retiró su consentimiento. La carta queda como constancia.",
  VENCIDO: "La liga caducó sin firma. Genera una carta nueva.",
};

export interface EduConsentEstadoInput {
  signedAt: Date | string | null;
  revokedAt: Date | string | null;
  expiresAt: Date | string;
}

function ms(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * El estado del documento.
 *
 * 🔴 El ORDEN de las tres preguntas es la regla, no un detalle:
 *   1. ¿Revocado?  → REVOCADO gana sobre todo. Un consentimiento firmado y
 *      después revocado NO es un consentimiento: el paciente se retractó, y
 *      pintarlo como "Firmado" es exactamente el error que haría que
 *      alguien se metiera a la boca de una persona que dijo que no.
 *   2. ¿Firmado?   → FIRMADO, aunque la liga haya vencido. Lo que caduca es
 *      la posibilidad de firmar, no la firma.
 *   3. ¿Vencido?   → VENCIDO. Si no, PENDIENTE.
 */
export function eduConsentEstado(
  c: EduConsentEstadoInput,
  now: Date = new Date(),
): EduConsentEstado {
  if (typeof c !== "object" || c === null) return "VENCIDO";
  if (ms(c.revokedAt) !== null) return "REVOCADO";
  if (ms(c.signedAt) !== null) return "FIRMADO";
  const exp = ms(c.expiresAt);
  if (exp === null) return "VENCIDO";
  return exp > now.getTime() ? "PENDIENTE" : "VENCIDO";
}

/** ¿Se puede firmar ahora mismo? Lo preguntan la página pública y el endpoint. */
export function eduConsentSePuedeFirmar(
  c: EduConsentEstadoInput,
  now: Date = new Date(),
): boolean {
  return eduConsentEstado(c, now) === "PENDIENTE";
}

/**
 * ¿Se puede revocar?
 *
 * Sí mientras no esté ya revocado — INCLUIDO cuando está pendiente o
 * vencido. No se exige que esté firmado a propósito: "el paciente dijo que
 * no" es una constancia que hay que poder dejar aunque la carta nunca se
 * llegara a firmar, y es también como se anula una carta emitida por error
 * sin borrar nada.
 */
export function eduConsentSePuedeRevocar(c: { revokedAt: Date | string | null }): boolean {
  return typeof c === "object" && c !== null && ms(c.revokedAt) === null;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL TEXTO CANÓNICO Y SU HASH
// ═══════════════════════════════════════════════════════════════════════

/**
 * Versión de la receta del hash. VA DENTRO del texto a propósito: el día
 * que alguien cambie cómo se arma este texto, tiene que cambiar también
 * este número, y entonces TODOS los hashes guardados dejan de coincidir de
 * golpe y a la vista — en un diff de una línea. Cambiar la receta sin tocar
 * la versión es cómo se llega a que unas firmas validen y otras no, sin
 * patrón visible.
 */
export const EDU_CONSENT_HASH_VERSION = "edu-consent-v1";

/**
 * Normaliza un texto ANTES de resumirlo.
 *
 * 🔴 Las tres cosas que hace, y por qué cada una:
 *
 *   · `\r\n` → `\n`  · el mismo párrafo escrito en Windows y pegado desde
 *     un móvil tiene bytes distintos y se lee idéntico.
 *   · `.normalize("NFC")` · en español la "í" se guarda como UN carácter
 *     (U+00ED) o como DOS (i + U+0301) según el sistema del teclado: macOS
 *     produce una forma y Windows/iOS la otra. Sin normalizar, copiar y
 *     pegar la carta sin cambiar una palabra cambia el hash y la firma se
 *     "vence" sola. Eso no se ve como un bug: se ve como que el sistema
 *     miente.
 *   · trim de los extremos · un salto de línea final que agregó un editor
 *     no es un cambio del documento.
 *
 * ⚠️ Lo que NO hace, también a propósito: no colapsa espacios interiores ni
 * baja a minúsculas. Ahí sí hay contenido — "no extraer" y "NO EXTRAER" no
 * son la misma instrucción en una carta que alguien va a firmar.
 */
export function eduNormalizeConsentText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").normalize("NFC").trim();
}

export interface EduConsentHashInput {
  procedure: string;
  content: string;
}

/**
 * El TEXTO CANÓNICO que se resume. Se serializa a mano, con el nombre de
 * cada campo dentro y en un orden fijo.
 *
 * 🔴 NO es un `JSON.stringify` del objeto: el orden de las claves de un
 * objeto de JavaScript depende de cómo se construyó, así que dos lecturas
 * de la MISMA fila pueden producir dos JSON distintos y dos hashes
 * distintos. Con los nombres escritos aquí, el orden lo decide este
 * archivo y nada más.
 *
 * Está en el módulo PURO —y el `createHash` no— porque `node:crypto` en un
 * componente "use client" rompe el bundle, y esta función tiene que poder
 * probarse sin Node y sin navegador.
 */
export function eduConsentCanonicalText(input: EduConsentHashInput): string {
  return [
    EDU_CONSENT_HASH_VERSION,
    `procedimiento: ${eduNormalizeConsentText(input.procedure)}`,
    "texto:",
    eduNormalizeConsentText(input.content),
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA CARTA, CON EL BLOQUE DE LA ESCUELA
// ═══════════════════════════════════════════════════════════════════════

export interface EduConsentTextoInput {
  /** Clave del catálogo del dental, o null para texto libre. */
  procedureKey: string | null;
  /** Cómo se llama el acto. Con catálogo se ignora (manda la plantilla). */
  procedure: string;
  institutionName: string;
  institutionCity?: string | null;
  timezone?: string | null;

  patientName: string;
  patientAge?: number | null;
  patientFolio?: string | null;

  /** El ALUMNO que explica y va a tratar. */
  studentName: string;
  studentMatricula?: string | null;
  /** La especialidad del caso, si el consentimiento cuelga de uno. */
  programName?: string | null;
  /** El DOCENTE responsable. */
  supervisorName?: string | null;

  /** Representante legal, si el paciente es menor o no puede decidir. */
  signerName?: string | null;
  signerRelation?: string | null;
}

/**
 * El bloque que el dental no puede escribir porque en el dental no existe:
 * quién te va a atender de verdad.
 *
 * Va PRIMERO, antes de la carta. Un anexo al final sería técnicamente
 * correcto y prácticamente inútil: el dato más importante para quien firma
 * —que quien le va a meter la mano en la boca es un alumno— no puede estar
 * detrás del bloque de firmas.
 */
export function eduConsentBloqueEscuela(input: EduConsentTextoInput): string {
  const alumno = [input.studentName, input.studentMatricula ? `matrícula ${input.studentMatricula}` : ""]
    .filter(Boolean)
    .join(", ");
  const especialidad = input.programName ? ` de la especialidad de ${input.programName}` : "";
  const docente = input.supervisorName
    ? `bajo la supervisión y la responsabilidad del docente ${input.supervisorName}, que revisa y autoriza el acto y firma también este documento`
    : "bajo la supervisión de un docente del instituto, que revisa y autoriza el acto y firma también este documento";

  return [
    `CARTA DE CONSENTIMIENTO INFORMADO · CLÍNICA UNIVERSITARIA`,
    input.institutionName,
    "",
    "0. QUIÉN TE VA A ATENDER — LÉELO ANTES QUE NADA",
    `Este establecimiento es la clínica de enseñanza de ${input.institutionName}. ` +
      `El procedimiento que se describe abajo lo realiza ${alumno}${especialidad}, ` +
      `estudiante en formación, ${docente}. ` +
      "Se me explicó esta circunstancia ANTES de firmar, pude preguntar lo que quise y la acepto.",
    "",
    "─────────────────────────────────────────────",
  ].join("\n");
}

/** El título que el generador del dental pone en la primera línea. */
const TITULO_DENTAL = "CARTA DE CONSENTIMIENTO INFORMADO";

/**
 * La carta completa: bloque de la escuela + la carta del catálogo.
 *
 * ⚠️ Al cuerpo del dental se le quita SU primera línea cuando es
 * exactamente el título —que ya lo pusimos arriba, con el apellido de
 * "clínica universitaria"—. Es una comprobación de igualdad exacta y no una
 * expresión regular: si el generador del dental cambia esa línea, el título
 * saldrá dos veces, que es feo y no rompe nada. Cualquier otra cirugía
 * sobre ese texto sí podría romper algo, y este documento lo firma alguien.
 *
 * 🔴 `doctorName` recibe al DOCENTE y no al alumno: la sección 2 de la
 * carta se titula "ESTOMATÓLOGO RESPONSABLE" y el responsable es el
 * docente. Quién ejecuta ya quedó dicho en el bloque 0, con su nombre y su
 * matrícula.
 */
export function eduConsentTexto(input: EduConsentTextoInput): string {
  const cuerpoBruto = buildConsentContent(input.procedureKey ?? "", {
    clinicName: input.institutionName,
    clinicCity: input.institutionCity ?? null,
    timezone: input.timezone ?? null,
    patientName: input.patientName,
    patientAge: input.patientAge ?? null,
    patientNumber: input.patientFolio ?? null,
    doctorName: input.supervisorName ?? null,
    signerName: input.signerName ?? null,
    signerRelation: input.signerRelation ?? null,
  });

  const lineas = cuerpoBruto.split("\n");
  const cuerpo = lineas[0] === TITULO_DENTAL ? lineas.slice(1).join("\n").trimStart() : cuerpoBruto;

  return `${eduConsentBloqueEscuela(input)}\n\n${cuerpo}`.slice(0, EDU_CONSENT_CONTENT_MAX);
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · SANEO DE LO QUE MANDA UN NAVEGADOR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Texto obligatorio, recortado. Devuelve null si no vino nada útil — el
 * caller decide si eso es un error.
 */
export function eduConsentText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\r\n/g, "\n").trim();
  if (!v) return null;
  return v.slice(0, max);
}

/**
 * Quién firma: el paciente, o uno de los dos testigos.
 *
 * Es un conjunto CERRADO y lo decide el servidor mirando este valor, nunca
 * una columna que mande el cliente. Con un campo libre, un `campo:
 * "supervisorSignatureUrl"` en el cuerpo dejaría a un tercero
 * contrafirmando como si fuera el docente.
 */
export type EduConsentFirmante = "paciente" | "testigo1" | "testigo2";

export const EDU_CONSENT_FIRMANTES: EduConsentFirmante[] = ["paciente", "testigo1", "testigo2"];

export function parseEduConsentFirmante(raw: unknown): EduConsentFirmante | null {
  if (typeof raw !== "string") return null;
  return (EDU_CONSENT_FIRMANTES as string[]).includes(raw) ? (raw as EduConsentFirmante) : null;
}

/** Quién contrafirma desde el panel. Lo decide la SESIÓN, no el cuerpo. */
export type EduConsentContrafirmante = "alumno" | "docente";

// ═══════════════════════════════════════════════════════════════════════
// 6 · LAS FORMAS QUE VIAJAN A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

/** Lo que ve el PANEL (dirección, docente, alumno y caja). */
export interface EduConsentRow {
  id: string;
  estado: EduConsentEstado;

  procedure: string;
  procedureKey: string | null;

  patientId: string;
  caseId: string | null;
  caseProgramName: string | null;

  /**
   * 🔴 LOS DOS IDS DEL ALUMNO, Y NO SON INTERCAMBIABLES.
   *
   * `studentUserId` es el de **EduUser** (la cuenta): es con el que se
   * compara `ctx.eduUserId` para decidir si esta sesión puede contrafirmar.
   * `studentId` es el de **EduStudent** (la inscripción): es el ÚNICO que
   * abre /instituto/estudiantes/{id}.
   *
   * Meter el primero donde va el segundo da un 404 mudo —ningún error en
   * consola, simplemente no existe esa ficha—, así que están juntos y
   * nombrados a propósito para que la confusión salte a la vista.
   *
   * `studentId` puede venir `null` aunque `studentUserId` no lo esté: la
   * carta guarda el nombre del alumno como INSTANTÁNEA y su inscripción
   * pudo desaparecer después. El nombre se sigue leyendo; el enlace no.
   */
  studentUserId: string | null;
  studentId: string | null;
  studentName: string;
  studentMatricula: string | null;
  supervisorUserId: string | null;
  supervisorName: string | null;

  createdByName: string;

  /** La liga para firmar. Solo se arma cuando todavía se puede firmar. */
  publicPath: string | null;

  signerName: string | null;
  signerRelation: string | null;
  signedAt: string | null;
  signedLabel: string | null;
  viewedAt: string | null;
  viewedLabel: string | null;

  witness1Name: string | null;
  witness1SignedAt: string | null;
  witness2Name: string | null;
  witness2SignedAt: string | null;

  studentSignedAt: string | null;
  supervisorSignedAt: string | null;
  supervisorSignedByName: string | null;

  revokedAt: string | null;
  revokedLabel: string | null;
  revokedByName: string | null;
  revokedReason: string | null;

  createdAt: string;
  createdLabel: string;
  expiresAt: string;
  expiresLabel: string;

  /** Lo que hace ESTA sesión: se calcula en el servidor, no en el navegador. */
  puedeContrafirmarComoAlumno: boolean;
  puedeContrafirmarComoDocente: boolean;
}

/**
 * Lo que ve el PACIENTE en la página pública.
 *
 * 🔴 Nunca lleva ids internos, ni el caso, ni una sola línea del expediente.
 * Quien tiene el token tiene esto y nada más: el token es la credencial, y
 * una credencial que se manda por WhatsApp no puede abrir un expediente.
 */
/**
 * ¿El texto guardado sigue coincidiendo con su huella?
 *
 * 🔴 Esto es lo que hace que `contentHash` NO sea una columna decorativa.
 * Se recalcula AL LEER y se compara con lo que se guardó al emitir: si
 * alguien tocó el texto de una carta ya firmada —por una consulta directa
 * a la base, por una migración mal hecha— el hash deja de cuadrar y se ve.
 * Un documento firmado que cambia sin dejar rastro es exactamente el
 * problema que un consentimiento existe para no tener.
 *
 * "sin_hash" es el caso de una carta emitida antes de que existiera la
 * columna: no se puede afirmar nada, y decirlo es más honesto que pintar
 * un check verde.
 */
export type EduConsentIntegridad = "ok" | "alterado" | "sin_hash";

export const EDU_CONSENT_INTEGRIDAD_LABELS: Record<EduConsentIntegridad, string> = {
  ok: "El texto de esta carta no ha cambiado desde que se emitió.",
  alterado:
    "⚠️ El texto guardado ya no coincide con la huella que se calculó al emitir esta carta. Avísale al instituto antes de firmarla.",
  sin_hash: "Esta carta se emitió antes de que se guardara la huella del texto.",
};

export interface EduConsentPublicView {
  procedure: string;
  content: string;
  /** Ver EduConsentIntegridad: se recalcula al leer, no se lee de la fila. */
  integridad: EduConsentIntegridad;
  institutionName: string;
  institutionPhone: string | null;
  patientName: string;
  studentName: string;
  supervisorName: string | null;

  estado: EduConsentEstado;
  puedeFirmar: boolean;

  signedAt: string | null;
  /**
   * P2-14 · La fecha de firma YA FORMATEADA, en la zona del INSTITUTO.
   * Era la única fecha del vertical que formateaba el navegador
   * (`toLocaleString` en un componente server-rendereado): el servidor la
   * pintaba en SU zona (UTC en Vercel) y el navegador en la del paciente —
   * hydration mismatch en un documento legal, y una hora que no era la de
   * la escuela. Como todo lo demás: la etiqueta la hace el servidor.
   */
  signedLabel: string | null;
  signerName: string | null;
  signerRelation: string | null;
  /** URL firmada de la imagen, generada al leer. Nunca se guarda. */
  signatureUrl: string | null;

  witness1Name: string | null;
  witness1SignedAt: string | null;
  witness2Name: string | null;
  witness2SignedAt: string | null;

  studentSignedAt: string | null;
  supervisorSignedAt: string | null;

  revokedAt: string | null;
  revokedReason: string | null;
  expiresAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · DÓNDE VIVEN LAS FIRMAS
// ═══════════════════════════════════════════════════════════════════════

/** Los cinco sitios donde se puede firmar un consentimiento. */
export type EduConsentSlot = "paciente" | "testigo1" | "testigo2" | "alumno" | "docente";

/**
 * El PATH de una firma dentro del bucket privado `edu-files`.
 *
 * 🔴 Lleva el institutionId delante, igual que los estudios: el bucket
 * queda particionado por escuela y un listado por prefijo nunca cruza
 * institutos.
 *
 * Es determinista (no lleva UUID) a propósito: firmar dos veces el mismo
 * hueco sobrescribe la imagen en vez de dejar huérfanos, y quien firma dos
 * veces el mismo hueco es alguien que repitió el trazo porque le salió mal
 * el primero. La fecha de la firma sí es de solo-una-vez, y eso lo
 * garantiza el `where` de la escritura, no el path.
 */
export function eduConsentSignaturePath(
  institutionId: string,
  consentId: string,
  slot: EduConsentSlot,
): string {
  return `${institutionId}/consentimientos/${consentId}/${slot}.png`;
}

/** La ruta pública de la carta. Punto único: la pinta el panel y la abre el paciente. */
export function eduConsentPublicPath(token: string): string {
  return `/instituto/consentimiento/${token}`;
}
