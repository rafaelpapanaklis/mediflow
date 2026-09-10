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

/**
 * 🔴 LA MAYORÍA DE EDAD, escrita una vez (H-08).
 *
 * Debajo de esto, el consentimiento lo firma el REPRESENTANTE LEGAL y no
 * el paciente (NOM-004 10.1.1.3). Antes no existía este número en ninguna
 * parte del vertical: la edad se calculaba solo para imprimirla dentro del
 * texto de la carta, y no había un solo `if` sobre los 18 años. Se emitía
 * la carta de un paciente de nueve años sin representante y el niño la
 * firmaba desde el teléfono.
 *
 * Vive en el módulo PURO para que el servidor (que bloquea) y la pantalla
 * (que marca el campo como obligatorio antes de dejar pulsar) contesten con
 * el mismo número. Dos copias es cómo se llega a una pantalla que exige lo
 * que el servidor no, o al revés.
 *
 * ⚠️ Es la mitad comprobable del problema. La otra mitad —el paciente
 * mayor de edad SIN capacidad para decidir— no la puede saber el sistema:
 * no hay columna que lo diga, y el campo del representante sigue estando
 * ahí, libre, para esos casos.
 */
export const EDU_CONSENT_EDAD_MAYORIA = 18;

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

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * H-12 · PODER RELEER LA CARTA FIRMADA, desde el panel.
   *
   * `EduConsent.content` se guardaba, se hasheaba y NO VOLVÍA NUNCA a una
   * pantalla del instituto: firmada la carta, la liga pública se apaga y no
   * quedaba ninguna otra vía. Y el permiso de caja está justificado
   * precisamente en que "la carta se imprime y se entrega en el mostrador".
   * No había nada que imprimir, y el paciente que pedía su copia se iba sin
   * ella.
   *
   * Viaja SOLO cuando la carta ya está firmada o revocada. Antes de firmar,
   * el documento vivo es la liga —y ahí se lee entero—; mandar el texto en
   * la lista de todas las cartas de un paciente serían decenas de KB por
   * fila que nadie va a mirar.
   * ═══════════════════════════════════════════════════════════════════════
   */
  content: string | null;
  /**
   * ═══════════════════════════════════════════════════════════════════════
   * 🔴 N-6 · ¿HAY PDF QUE SERVIR? Es `signedAt !== null`, y NADA MÁS.
   *
   * Existe porque `content` NO era esa condición y la pantalla creía que sí.
   * `content` viaja «firmada O revocada»; el gate del PDF mira `signedAt`.
   * Una carta emitida por error y revocada ANTES de firmarse —flujo querido
   * y documentado: «el paciente dijo que no» es una constancia que hay que
   * poder dejar— tiene `content` y no tiene firma. Con el botón colgando de
   * `content`, recepción pulsaba «PDF» con el paciente delante y se le abría
   * una pestaña con el JSON del 409.
   *
   * Un `<a target="_blank">` no tiene manejo de error: o el enlace no se
   * pinta, o el fallo se ve en crudo. Por eso la condición viaja como
   * BANDERA PROPIA desde el servidor —el único que sabe cuál es el gate— y
   * no como una segunda lectura de `content` en el navegador.
   * ═══════════════════════════════════════════════════════════════════════
   */
  imprimible: boolean;
  /**
   * 🔴 RECALCULADA al leer, nunca leída de una columna. Es la MISMA
   * comprobación que ya hacía la página del paciente: si alguien tocó el
   * texto de una carta ya firmada, deja de cuadrar y se ve. `null` = la
   * carta todavía no es un documento firmado.
   */
  integridad: EduConsentIntegridad | null;

  /**
   * Las URLs FIRMADAS de los PNG de cada firma, generadas al leer y nunca
   * guardadas. `null` = esa firma no existe, o Storage no está configurado,
   * o el objeto se perdió — la constancia jurídica es la fecha y la
   * evidencia de la fila; la imagen la acompaña.
   */
  signatureUrl: string | null;
  witness1SignatureUrl: string | null;
  witness2SignatureUrl: string | null;
  studentSignatureUrl: string | null;
  supervisorSignatureUrl: string | null;

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

/**
 * ═══════════════════════════════════════════════════════════════════════
 * N-16 · EL NOMBRE DEL PDF, CON EL FOLIO SANEADO TAMBIÉN.
 *
 * Se saneaba el procedimiento y NO el folio, y los dos acaban en la misma
 * cabecera HTTP (`Content-Disposition: inline; filename="…"`). El techo del
 * daño era pequeño —`normalizeEduFolio` ya quita CR/LF, así que la cabecera
 * no se puede partir en dos—, pero una escuela con numeración propia puede
 * tener folios con acentos, comillas o barras, y con cualquiera de los tres
 * el navegador guarda el archivo con un nombre roto o lo trocea por la
 * barra. Dos campos que salen por la misma cabecera se sanean con la MISMA
 * función; que uno de ellos «no llegue a ser peligroso» no es una razón
 * para tratarlo distinto — es cómo el siguiente hereda medio saneo.
 *
 * Vive en el módulo puro para que se pueda probar sin base de datos.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function eduConsentFileSlug(raw: string, max: number): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .toLowerCase();
}

export function eduConsentPdfFileName(
  folio: string,
  procedure: string,
  consentId: string,
): string {
  const f = eduConsentFileSlug(folio, 30);
  const p = eduConsentFileSlug(procedure, 40);
  return `consentimiento-${f || "paciente"}-${p || "carta"}-${String(consentId).slice(0, 8)}.pdf`;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * N-16 · EL `data:` URI DE UNA FIRMA, O NULL SI EL PDF NO SABE PINTARLA.
 *
 * 🔴 SE MIRA EL MAGIC NUMBER, no la extensión ni el content-type con el que
 * se subió. `validateSignatureDataUrl` acepta PNG, JPEG y WEBP —la
 * comprobación de entrada es de magic number, a propósito— y `guardarFirma`
 * los sube TODOS con extensión y content-type `.png`: en el bucket hay
 * archivos `.png` que no son PNG. Al armar el PDF se les pegaba encima un
 * `data:image/png` y el renderer lanzaba. Resultado: 500 genérico, y esa
 * carta no se podía imprimir NUNCA MÁS.
 *
 * 🔴 Y DEVOLVER NULL ES LA RESPUESTA CORRECTA, no un error. El hueco de la
 * firma ya sabe pintarse sin imagen («firma registrada; la imagen no está
 * disponible»): es el mismo camino que ya se recorre cuando Storage no está
 * o el objeto se perdió. La constancia jurídica es la fecha y la evidencia
 * de la fila; la imagen la acompaña. Perder el documento entero por una
 * imagen sería peor — que es exactamente lo que pasaba.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function eduSignatureDataUrl(buf: Buffer | Uint8Array | null): string | null {
  if (!buf || buf.length < 4) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const esPng =
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a;
  if (esPng) return `data:image/png;base64,${b.toString("base64")}`;
  const esJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (esJpeg) return `data:image/jpeg;base64,${b.toString("base64")}`;
  return null;
}
