/**
 * DaleControl INSTITUCIONAL — el cerebro de PACIENTES, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only"). Lo que decide:
 * cómo se sanea lo que se captura en recepción, cómo se busca sin que el
 * buscador vuelque la tabla, y qué forma tiene la ficha que viaja a la
 * pantalla.
 *
 * 🔴 EL ORIGEN. `referredByStudentId` dice CUÁL alumno trajo al paciente, y
 * en la Ola 5 ese dato decide el precio. Por eso se guarda desde hoy
 * —reconstruirlo después, de memoria, no se puede— y por eso se guarda
 * también quién lo marcó y cuándo: es un dato con consecuencia económica.
 * Marcarlo exige el permiso `pacientes.origen`; a quien no lo tiene se le
 * PINTA, deshabilitado, en vez de escondérselo. Un alumno tiene derecho a
 * ver si su paciente cuenta como suyo.
 */
import type { Prisma } from "@prisma/client";
import type {
  EduContactPreference,
  EduHabitLevel,
  EduPatientStatus,
  EduPregnancy,
  EduSex,
} from "@/lib/edu/types";
import {
  EDU_CONTACT_PREFERENCES,
  EDU_HABIT_LEVELS,
  EDU_PATIENT_STATUSES,
  EDU_PATIENT_STATUS_LABELS,
  EDU_PREGNANCY_VALUES,
  EDU_SEXES,
  EDU_SEX_LABELS,
} from "@/lib/edu/types";
import { eduDateInputValue, eduSearchInput, eduSearchTokens } from "@/lib/edu/padron-core";
import { eduNormalizeSearch } from "@/lib/edu/search";
// 🔴 La regla del teléfono se IMPORTA, no se copia: `eduWaPhone` es la que
// decide si Meta puede entregar, y el saneo de la ficha tiene que ser
// exactamente la misma (H-09). whatsapp-core es puro y client-safe —solo
// importa tipos de Prisma— así que no arrastra runtime al navegador.
import { eduWaPhone } from "@/lib/edu/whatsapp-core";
import { EDU_CLINICA_MAX_ROWS } from "@/lib/edu/agenda-core";

/** El buscador y el saneo de texto se REUSAN del padrón en vez de
 *  escribirse otra vez: dos saneadores de búsqueda en el mismo vertical es
 *  como se acaba con uno que escapa los comodines de LIKE y otro que no. */
export { eduSearchInput, eduSearchTokens } from "@/lib/edu/padron-core";
export { formatEduContractDate as formatEduDate } from "@/lib/edu/contract";

// ═══════════════════════════════════════════════════════════════════════
// 1 · SANEO DE LA FICHA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Folio de la escuela: MAYÚSCULAS y sin espacios internos.
 *
 * Se normaliza porque el índice único es (institutionId, folio) y Postgres
 * distingue mayúsculas: sin esto, "p-01" y "P-01" serían dos pacientes con
 * el mismo folio impreso en el expediente de papel.
 */
export function normalizeEduFolio(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (v.length === 0 || v.length > 30) return null;
  return v;
}

/**
 * Teléfono, con SOLO los dígitos (y un "+" inicial si venía).
 *
 * 🔴 Se normaliza al guardar porque si no, buscar "5544332211" no
 * encuentra al que se capturó como "55 4433 2211" — el `contains` de Prisma
 * compara el texto tal cual. Ese bug ya se pagó en el dental.
 *
 * ⚠️ ESTA ES LA REGLA ANCHA, y lo es a propósito. La comparten el CONTACTO
 * DE EMERGENCIA (más abajo, en parseEduAntecedentes) y el teléfono de una
 * cuenta del equipo (equipo-core.ts). A esos dos números alguien los MARCA:
 * un número extranjero, uno con extensión o uno de casa siguen sirviendo
 * para llamar. Estrecharla aquí bloquearía el guardado ENTERO de los
 * antecedentes —el bloque de las alergias— de cualquier paciente viejo cuyo
 * contacto de emergencia no fueran diez dígitos exactos, que es lo contrario
 * de lo que ese bloque existe para hacer.
 *
 * Para el teléfono DEL PACIENTE, que es por donde sale el WhatsApp, la
 * regla estrecha es `normalizeEduWaPhone`, aquí debajo.
 */
export function normalizeEduPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const v = `${plus}${digits}`;
  return v.length > 30 ? null : v;
}

/**
 * El teléfono DEL PACIENTE: diez dígitos nacionales, o null. Sin término
 * medio (H-09 de la auditoría).
 *
 * 🔴 QUÉ ARREGLA. `normalizeEduPhone` acepta UN dígito: recepción tecleaba
 * "55", se guardaba, y a partir de ahí todo el WhatsApp de ese paciente
 * estaba muerto en silencio —el recordatorio de la cita, la carta de
 * consentimiento, el recibo—. El único sitio donde alguien se enteraba era
 * la pestaña WhatsApp, y ahí ya era tarde. El mensaje de error tampoco
 * decía la verdad ("no tiene números suficientes" para algo que se guardaba
 * igual).
 *
 * 🔴 LA REGLA NO SE ESCRIBE AQUÍ: es `eduWaPhone` (whatsapp-core.ts), la
 * misma que decide si Meta puede entregar. Duplicarla es cómo se llega a
 * que el saneo acepte lo que el envío rechaza — que es exactamente el
 * agujero que esto cierra. Como efecto, lo que se guarda son SIEMPRE los
 * diez dígitos nacionales: el "+52" y el "+521" se limpian igual que al
 * mandar, así que `eduWaPhone(paciente.phone)` nunca vuelve a dar null para
 * un teléfono capturado desde hoy.
 *
 * ⚠️ Se aplica SOLO a `EduPatient.phone`. Ver la nota de la función de
 * arriba: el contacto de emergencia y el del equipo se marcan, no se
 * whatsappean.
 */
export function normalizeEduWaPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return eduWaPhone(trimmed);
}

/** El motivo, escrito para una persona. Lo usan el servidor (al rechazar) y
 *  la pantalla (como pista bajo el campo): un mensaje único no puede
 *  contradecirse consigo mismo. */
export const EDU_PHONE_HELP =
  "Diez dígitos: lada y número, sin el +52. Es lo que WhatsApp necesita para poder entregar.";

/**
 * ¿Este teléfono YA GUARDADO sirve para WhatsApp? Devuelve el aviso escrito,
 * o null si sirve (o si no hay teléfono, que no es lo mismo que uno malo).
 *
 * Existe para las filas VIEJAS: `normalizeEduWaPhone` cierra la puerta desde
 * hoy, pero en la base ya hay pacientes con "55" guardado de antes, y la
 * ficha tiene que decirlo donde se ve —no en la pestaña WhatsApp, que es
 * adonde se llega cuando ya es tarde—.
 */
export function eduPhoneWaWarning(phone: string | null | undefined): string | null {
  if (!phone || !String(phone).trim()) return null;
  if (eduWaPhone(phone)) return null;
  return "Este teléfono no tiene 10 dígitos: WhatsApp no le puede entregar nada.";
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * CURP — Clave Única de Registro de Población (NOM-024).
 *
 * 🔴 LA REGLA SE ESCRIBE AQUÍ Y NO SE IMPORTA DEL DENTAL. Existe
 * `src/lib/validators/curp.ts` con la misma expresión, y traerla habría
 * atado la ficha del instituto a un archivo del producto dental: el día
 * que allá añadan `curpStatus`/`passportNo` —que ya tienen— esta pantalla
 * heredaría un contrato que nadie pidió. Son 18 caracteres y una
 * expresión; el coste de tenerla dos veces es menor que el de compartirla.
 *
 * Formato oficial RENAPO, 18 posiciones:
 *   1-4   cuatro letras (inicial y primera vocal del primer apellido,
 *         inicial del segundo, inicial del nombre)
 *   5-10  fecha de nacimiento AAMMDD
 *   11    H | M
 *   12-13 clave de entidad federativa (o NE, nacido en el extranjero)
 *   14-16 tres consonantes internas
 *   17    homoclave (letra para nacidos antes del 2000, dígito después)
 *   18    dígito verificador
 *
 * ⚠️ NO se comprueba el dígito verificador contra RENAPO: eso pide una
 * consulta en línea. Esto es formato, y el formato es lo que caza el
 * dedazo.
 *
 * 🔴 DÓNDE SE APRIETA Y DÓNDE NO, a propósito. Las cuatro primeras letras
 * se aceptan como `[A-Z]{4}` y no como "consonante + vocal + …": la
 * segunda posición es la primera vocal INTERNA del primer apellido, y
 * RENAPO la sustituye por X en los apellidos que no tienen ninguna. Apretar
 * ahí rechaza CURP legítimos, y el coste no es simétrico — un CURP con un
 * dedazo se corrige después; uno bueno rechazado deja a alguien sin poder
 * guardar la ficha del paciente que tiene delante. Lo que SÍ se aprieta es
 * lo que de verdad caza un dedazo y no rechaza a nadie: que las posiciones
 * 5-10 sean una FECHA que existe (no un "990231") y que las 12-13 sean una
 * clave de entidad REAL de las 33 (las 32 más NE, nacido en el extranjero).
 *
 * ⚠️ La columna NO tiene índice único ni CHECK, y es deliberado (está
 * escrito en el esquema): un CURP mal tecleado no puede impedir registrar
 * a un paciente que está en el sillón. Lo que hace esto es rebotar el
 * valor MALO al guardarlo, no impedir que la ficha exista sin él.
 */
const EDU_CURP_RE = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;

/** Las 32 entidades federativas más NE (nacido en el extranjero), tal como
 *  las escribe RENAPO en las posiciones 12-13. */
const EDU_CURP_ENTIDADES = [
  "AS", "BC", "BS", "CC", "CH", "CL", "CM", "CS", "DF", "DG", "GR", "GT",
  "HG", "JC", "MC", "MN", "MS", "NE", "NL", "NT", "OC", "PL", "QR", "QT",
  "SL", "SP", "SR", "TC", "TL", "TS", "VZ", "YN", "ZS",
] as const;

/** ¿Las posiciones 5-10 (AAMMDD) son un día que existe? "990231" no lo es,
 *  y es exactamente la forma que toma un dedazo en la fecha. */
function eduCurpFechaOk(aammdd: string): boolean {
  const mes = Number(aammdd.slice(2, 4));
  const dia = Number(aammdd.slice(4, 6));
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  // El año son dos dígitos y no dice el siglo, así que se prueba con un
  // año BISIESTO (2000): así el 29 de febrero pasa siempre y el 30 nunca.
  // Afinarlo con el siglo real exigiría leer la homoclave, que no es de
  // fiar en los CURP viejos.
  const dias = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
  return dia <= dias;
}

/** El motivo, escrito para una persona. Lo comparten el servidor (al
 *  rechazar) y la pantalla (como pista bajo el campo). */
export const EDU_CURP_HELP =
  "18 caracteres, como viene en el acta: cuatro letras, la fecha de nacimiento, H o M, el estado y tres consonantes.";

/** MAYÚSCULAS y sin espacios, que es como se compara y como se imprime. */
export function normalizeEduCurp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (v.length === 0) return null;
  return v;
}

/** ¿Este CURP tiene la forma oficial? Se le pasa el valor YA normalizado. */
export function eduCurpIsValid(raw: unknown): boolean {
  const v = normalizeEduCurp(raw);
  if (!v) return false;
  if (v.length !== 18 || !EDU_CURP_RE.test(v)) return false;
  if (!eduCurpFechaOk(v.slice(4, 10))) return false;
  return (EDU_CURP_ENTIDADES as readonly string[]).includes(v.slice(11, 13));
}

/**
 * El aviso para un CURP YA GUARDADO que no cuadra, o null si cuadra (o si
 * no hay CURP, que no es lo mismo que uno malo).
 *
 * Existe por lo mismo que `eduPhoneWaWarning`: desde hoy la puerta está
 * cerrada, pero en la base puede haber CURP escritos a mano antes de esta
 * ola, y la ficha tiene que decirlo DONDE SE EDITA.
 */
export function eduCurpWarning(curp: string | null | undefined): string | null {
  if (!curp || !String(curp).trim()) return null;
  if (eduCurpIsValid(curp)) return null;
  return "Este CURP no tiene la forma oficial de 18 caracteres. Revísalo contra el acta o la constancia.";
}

/** Correo, en minúsculas y con una forma mínimamente creíble. */
export function normalizeEduEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.length > 160) return null;
  // A propósito NO es la expresión "completa" del RFC: rechazar correos
  // válidos y raros en recepción es peor que aceptar uno con un dedazo.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export function parseEduSex(raw: unknown): EduSex | null {
  if (typeof raw !== "string") return null;
  return (EDU_SEXES as string[]).includes(raw) ? (raw as EduSex) : null;
}

export function parseEduPatientStatus(raw: unknown): EduPatientStatus | null {
  if (typeof raw !== "string") return null;
  return (EDU_PATIENT_STATUSES as string[]).includes(raw) ? (raw as EduPatientStatus) : null;
}

// ── Los tres enums de la Ola B ──────────────────────────────────────────
//
// 🔴 DEVUELVEN `null` PARA LO QUE NO RECONOCEN, y quien llama distingue el
// null de "no vino" mirando si la clave estaba en el body. No es una
// sutileza: `null` en estas columnas SIGNIFICA "nadie preguntó", así que un
// parser que convirtiera la basura en null estaría escribiendo "nadie
// preguntó" encima de un dato bueno cada vez que alguien mandara un valor
// mal escrito. Por eso el servidor comprueba las dos cosas por separado:
// que la clave venga, y que el valor sea del enum.

export function parseEduPregnancy(raw: unknown): EduPregnancy | null {
  if (typeof raw !== "string") return null;
  return (EDU_PREGNANCY_VALUES as string[]).includes(raw) ? (raw as EduPregnancy) : null;
}

export function parseEduContactPreference(raw: unknown): EduContactPreference | null {
  if (typeof raw !== "string") return null;
  return (EDU_CONTACT_PREFERENCES as string[]).includes(raw)
    ? (raw as EduContactPreference)
    : null;
}

export function parseEduHabitLevel(raw: unknown): EduHabitLevel | null {
  if (typeof raw !== "string") return null;
  return (EDU_HABIT_LEVELS as string[]).includes(raw) ? (raw as EduHabitLevel) : null;
}

/**
 * Edad en años cumplidos, a partir de una fecha de calendario guardada a
 * medianoche UTC. Se calcula en UTC de punta a punta.
 *
 * ⚠️ El off-by-one de la edad ya mordió una vez en este repo: comparar
 * `Date.now() - nacimiento` en milisegundos y dividir entre 365 días
 * equivoca el año en los bisiestos y el día del cumpleaños. Aquí se compara
 * año/mes/día, que es como cuenta la gente.
 */
export function eduAgeYears(
  birth: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!birth) return null;
  const d = birth instanceof Date ? birth : new Date(birth);
  if (Number.isNaN(d.getTime())) return null;

  let years = now.getUTCFullYear() - d.getUTCFullYear();
  const mes = now.getUTCMonth() - d.getUTCMonth();
  if (mes < 0 || (mes === 0 && now.getUTCDate() < d.getUTCDate())) years -= 1;
  if (years < 0 || years > 130) return null;
  return years;
}

/** Nombre completo, sin el espacio de más cuando falta el apellido. */
export function eduPatientFullName(p: { firstName: string; lastName: string }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || "Sin nombre";
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · FILTROS DE LA LISTA
// ═══════════════════════════════════════════════════════════════════════

export interface EduPatientFilters {
  status: EduPatientStatus | null;
  /** Solo los que trajo ESE alumno. Es el filtro que la Ola 5 va a cobrar. */
  referredByStudentId: string | null;
  q: string | null;
}

export const EDU_PATIENT_EMPTY_FILTERS: EduPatientFilters = {
  status: null,
  referredByStudentId: null,
  q: null,
};

export function eduHasPatientFilters(f: EduPatientFilters): boolean {
  return Boolean(f.status || f.referredByStudentId || f.q);
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  if (typeof value === "string") return value;
  return null;
}

function cleanId(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.length > 40) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

/**
 * Lee los filtros de la query string. Todo lo que no reconoce se descarta.
 *
 * 🔴 Aquí NO se lee ningún institutionId. El tenant sale de la sesión y de
 * ningún otro lado; si esta función lo aceptara, bastaría con teclear
 * `?institutionId=…` para leer los pacientes de otra escuela.
 */
export function parseEduPatientFilters(
  searchParams: Record<string, string | string[] | undefined> | undefined | null,
): EduPatientFilters {
  const sp = searchParams ?? {};
  return {
    status: parseEduPatientStatus(firstParam(sp.estado)),
    referredByStudentId: cleanId(sp.origen),
    q: eduSearchInput(firstParam(sp.q)),
  };
}

/**
 * Los términos con los que se busca un paciente, ya saneados para LIKE.
 *
 * Se busca por nombre, apellido, folio y teléfono. El teléfono va aparte
 * porque lo que la persona teclea ("55 4433") no es lo que está guardado
 * (solo dígitos): se le quitan los caracteres de adorno antes de comparar.
 */
export function eduPhoneSearchToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LAS FORMAS QUE VIAJAN A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

/** El origen del paciente, ya resuelto para pintarlo. */
export interface EduPatientOrigin {
  studentId: string | null;
  studentName: string | null;
  studentMatricula: string | null;
  setByName: string | null;
  setAt: string | null;
}

export interface EduPatientRow {
  id: string;
  folio: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  ageYears: number | null;
  sex: EduSex;
  notes: string | null;
  status: EduPatientStatus;
  origin: EduPatientOrigin;
  /** Ola de Casos: los antecedentes médicos, siempre presentes en la fila
   *  — la ficha los pinta como chips en TODAS las pestañas. */
  antecedentes: EduAntecedentes;
  /** Casos abiertos (no cerrados). Lo pinta la lista como "2 casos". */
  openCases: number;
  /** Total de casos, abiertos y cerrados. */
  totalCases: number;
  createdAt: string;

  // ═════════════════════════════════════════════════════════════════════
  // OLA B · LO QUE LE FALTABA A LA FICHA (ws2-t3)
  //
  // 🔴 PLANAS Y NO ANIDADAS, como el resto de esta fila. `phone`, `notes` y
  // `birthDate` ya viven aquí sueltas; meter el domicilio en un objeto
  // `address` y el tutor en otro `guardian` habría hecho que el formulario
  // necesitara dos formas de leer un campo según dónde estuviera, y ahí es
  // donde se pierde uno de los dos al añadir el siguiente.
  //
  // 🔴 NULL NO ES UNA RESPUESTA. `pregnancy`, `contactPreference` y los tres
  // hábitos son nullables Y tienen `DESCONOCIDO`/`NINGUNO` dentro del enum,
  // y no es redundancia (lo dejó escrito la casilla que creó las columnas):
  //   · null          = nadie preguntó        → la ficha dice «sin registrar»
  //   · DESCONOCIDO   = se preguntó y no se sabe
  //   · NO / NINGUNO  = se preguntó y la respuesta fue que no
  // Aplastar los tres en uno pierde justo la distinción que evita el chip
  // verde mentiroso, que es el mismo error que `historyRecordedAt` existe
  // para no cometer con los antecedentes.
  // ═════════════════════════════════════════════════════════════════════

  /** Identidad · CURP (NOM-024). */
  curp: string | null;

  /** Contacto · el segundo teléfono y por dónde quiere que le hablen. */
  phone2: string | null;
  contactPreference: EduContactPreference | null;

  /** Domicilio, en cinco columnas: la ciudad y el CP se agrupan después. */
  addressStreet: string | null;
  addressNeighborhood: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;

  /** Tutor o representante legal (H-08). Antes vivía en CADA carta. */
  guardianName: string | null;
  guardianRelation: string | null;
  guardianPhone: string | null;

  /** Seguro o convenio. */
  insuranceProvider: string | null;
  insurancePolicy: string | null;

  /** NOM-004 · heredofamiliares y personales no patológicos. */
  familyHistory: string | null;
  personalNonPathologicalHistory: string | null;

  /** Hábitos. Enum y no texto libre: lo escrito a mano no se filtra. */
  habitsTobacco: EduHabitLevel | null;
  habitsAlcohol: EduHabitLevel | null;
  habitsBruxism: EduHabitLevel | null;
  habitsNotes: string | null;

  /** Embarazo / lactancia: la columna que permite ALERTAR antes de una placa. */
  pregnancy: EduPregnancy | null;

  /** Dentición temporal. La ESCRIBE esta pantalla; la LEE el odontograma. */
  isChild: boolean;

  /** Aviso de privacidad (LFPDPPP): CUÁNDO lo aceptó. null = no consta. */
  privacyNoticeAcceptedAt: string | null;

  /** H-12b · quién tocó la ficha por última vez y cuándo. `updatedAt` ya
   *  existía en la tabla desde el primer día y no se pintaba en ninguna
   *  pantalla; sin el nombre al lado tampoco servía de mucho. */
  updatedAt: string;
  updatedByName: string | null;
}

export interface EduPatientsPage {
  rows: EduPatientRow[];
  /**
   * ¿Quedan más filas DESPUÉS de esta página? (H-06)
   *
   * ⚠️ Cambió de significado y hay que saberlo: hasta la Ola B quería decir
   * «la consulta se cortó en 300 y el resto no existe para ti». Ahora
   * quiere decir «hay página siguiente», y la pantalla ofrece «Ver más» en
   * vez de un aviso sin salida. El nombre se conserva porque lo leen el
   * endpoint y la pantalla, y renombrarlo no habría cambiado nada de lo
   * que hace.
   */
  truncated: boolean;
  /** El cursor de la SIGUIENTE página, o null si ya no hay más. */
  nextCursor: string | null;
}

/** Lo MÍNIMO para un <select> de pacientes (agendar una cita). */
export interface EduPatientOption {
  id: string;
  folio: string;
  name: string;
  status: EduPatientStatus;
}

export interface EduPatientOptionsPage {
  rows: EduPatientOption[];
  truncated: boolean;
}

/** Recorta lo que llegó con `take: <tope> + 1` al tope real y dice si
 *  sobraba — mismo patrón que `listEduAgenda`. El tope es un parámetro
 *  desde la Ola B: el desplegable de agendar puede pedir menos cuando está
 *  filtrando por texto, y una constante fija obligaría a repetir el
 *  `slice` en el llamador (que es donde se olvida). */
export function eduPatientOptionsPageOf(
  rows: EduPatientOption[],
  max: number = EDU_CLINICA_MAX_ROWS,
): EduPatientOptionsPage {
  return {
    truncated: rows.length > max,
    rows: rows.slice(0, max),
  };
}

/** El texto que se busca, sin comodines de LIKE. Se reexporta el del
 *  padrón para no tener dos. */
export function eduPatientSearchTokens(raw: string | null | undefined): string[] {
  return eduSearchTokens(raw);
}

/** El constructor del índice del paciente, reexportado desde el módulo puro
 *  del buscador para que quien ya importa de aquí no tenga que ir a otro
 *  archivo. */
export { eduPatientSearchIndex } from "@/lib/edu/search";

/**
 * Las cláusulas AND del buscador de pacientes.
 *
 * Vive AQUÍ, en el módulo puro, y no dentro de pacientes.ts, por una razón
 * concreta: pacientes.ts importa prisma y no se puede cargar en una prueba
 * sin base de datos. Este `where` es justo lo que se rompió en producción
 * —buscar "Rodriguez" no encontraba a "Rodríguez"— así que tiene que poder
 * probarse.
 *
 * 🔴 Solo mira `searchIndex`: es la columna con el texto ya en minúsculas y
 * sin acentos. Comparar contra `firstName` con `mode: "insensitive"` —que
 * es lo que había— arregla las mayúsculas y NO los acentos.
 */
export function eduPatientSearchAnd(
  q: string | null | undefined,
): Prisma.EduPatientWhereInput[] {
  const and: Prisma.EduPatientWhereInput[] = [];
  for (const token of eduSearchTokens(q)) {
    const or: Prisma.EduPatientWhereInput[] = [{ searchIndex: { contains: token } }];
    // El teléfono va en el índice SOLO con dígitos, así que un término con
    // adornos ("55-4433") se prueba también reducido a dígitos: quien
    // teclea el teléfono como se lo dictaron tiene que encontrar al que se
    // capturó como "5544332211".
    const digits = eduPhoneSearchToken(token);
    if (digits && digits !== token) or.push({ searchIndex: { contains: digits } });
    and.push({ OR: or });
  }
  return and;
}


// ═══════════════════════════════════════════════════════════════════════
// 3B · EL FORMULARIO DE LA FICHA — LOS NUEVE CAMPOS, UNA SOLA VEZ
//
// 🔴 QUÉ ARREGLA ESTO (H-01 de la auditoría). El servidor sabía editar los
// nueve campos desde la Ola 2 y NINGUNA pantalla le mandaba cuatro de
// ellos: nombre, apellidos, folio y sexo se capturaban una vez en el alta y
// no se corregían nunca, desde ningún sitio. Una "Maria Lopes" mal tecleada
// quedaba impresa para siempre en el expediente, en las cartas NOM-004, en
// las recetas y en los recibos.
//
// 🔴 POR QUÉ VIVE AQUÍ, EN EL MÓDULO PURO, Y NO EN EL COMPONENTE. La lista
// de campos la comparten DOS pantallas —el modal de /instituto/pacientes y
// la pestaña Datos de la ficha— y la razón por la que la pestaña Datos era
// de solo lectura estaba escrita y era buena: dos formularios para la misma
// ficha es cómo uno de los dos se queda sin el campo nuevo. La respuesta no
// es tener uno solo en un solo sitio: es tener una sola DEFINICIÓN montada
// en dos. Un campo nuevo se agrega a EDU_PATIENT_FORM_FIELDS y las dos
// pantallas lo mandan, o ninguna.
//
// 🔴 Y POR QUÉ EL DIFF (H-10). El modal pedía la ficha fresca al abrirse,
// tiraba la respuesta y guardaba con los valores viejos de la lista: a las
// 9:00 se pintó la lista, a las 9:20 el último caso cerrado puso al
// paciente en DISCHARGED, y a las 9:25 corregir el correo lo resucitaba a
// ACTIVE. La regla es la del `patient-update-core` del dental —reescrita
// aquí, sin importar nada de allá—: CAMPO AUSENTE NO SE ESCRIBE. Solo viaja
// lo que la persona cambió de verdad, así que dos personas que corrigen
// campos distintos no se pisan.
// ═══════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LOS 31 CAMPOS DE LA FICHA — nueve de la ola anterior, 22 de la Ola B.
 *
 * 🔴 EL ORDEN ES EL DE LA PANTALLA, y los grupos son los de abajo. Un campo
 * nuevo se agrega AQUÍ, se le asigna su grupo en EDU_PATIENT_FIELD_GROUP
 * (el compilador lo exige: el Record no admite huecos), y desde ese momento
 * lo mandan las dos pantallas o ninguna.
 *
 * ⚠️ `updatedById` NO está en esta lista y no es un olvido: no lo teclea
 * nadie, lo estampa el servidor en cada escritura. Un campo de auditoría
 * que el cliente pueda mandar no es auditoría.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const EDU_PATIENT_FORM_FIELDS = [
  // Identidad
  "folio",
  "firstName",
  "lastName",
  "sex",
  "birthDate",
  "curp",
  // Contacto
  "phone",
  "phone2",
  "email",
  "contactPreference",
  // Domicilio
  "addressStreet",
  "addressNeighborhood",
  "addressCity",
  "addressState",
  "addressZip",
  // Tutor / representante legal
  "guardianName",
  "guardianRelation",
  "guardianPhone",
  // Seguro
  "insuranceProvider",
  "insurancePolicy",
  // Antecedentes NOM-004
  "familyHistory",
  "personalNonPathologicalHistory",
  // Hábitos
  "habitsTobacco",
  "habitsAlcohol",
  "habitsBruxism",
  "habitsNotes",
  // Embarazo / lactancia y dentición
  "pregnancy",
  "isChild",
  // Administrativo
  "status",
  "notes",
  "privacyNoticeAcceptedAt",
] as const;

export type EduPatientFormField = (typeof EDU_PATIENT_FORM_FIELDS)[number];

/**
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ LLAVE ABRE CADA CAMPO — tres grupos, ninguna key nueva.
 *
 *   · "identidad" → `pacientes.manage`. Caja y dirección. Quién es el
 *     paciente y su papeleo: folio, nombre, apellidos, sexo, nacimiento,
 *     CURP, domicilio, tutor, seguro, estado, notas de recepción y la
 *     fecha del aviso de privacidad.
 *   · "contacto"  → `pacientes.manage` O `expediente.write`. Por dónde se
 *     le avisa: los dos teléfonos, el correo y la preferencia de contacto.
 *     Es la regla que ya existía para teléfono y correo (H-02); el segundo
 *     teléfono y la preferencia entran por la misma puerta porque son la
 *     MISMA decisión — el alumno tiene al paciente en el sillón y le dictan
 *     un número.
 *   · "clinico"   → `pacientes.manage` O `expediente.write`, exactamente
 *     como los ANTECEDENTES (el endpoint /antecedentes ya usa esas dos).
 *     NOM-004, hábitos, embarazo/lactancia y dentición temporal.
 *
 * 🔴 "contacto" y "clinico" resuelven HOY al mismo booleano, y están
 * separados a propósito. No es redundancia: lo que separa a los dos grupos
 * no es quién puede escribirlos hoy, es QUÉ SON — el día que una escuela
 * quiera que su recepción no toque el embarazo, o que el alumno no cambie
 * la preferencia de contacto, la línea ya está trazada y el cambio es una
 * condición, no una migración de 31 campos. Y mientras tanto la pantalla
 * ya explica cada bloque con su motivo propio.
 *
 * 🔴 NINGUNA KEY NUEVA, y es la misma decisión escrita de las dos olas
 * anteriores: una key nueva NO le llega a nadie que ya tenga
 * `permissionsOverride` guardado (el override REEMPLAZA al default), así
 * que habría exigido un backfill en SQL contra la base de cada escuela.
 * ═══════════════════════════════════════════════════════════════════════
 */
export type EduPatientFieldGroup = "identidad" | "contacto" | "clinico";

export const EDU_PATIENT_FIELD_GROUPS: readonly EduPatientFieldGroup[] = [
  "identidad",
  "contacto",
  "clinico",
];

/** El grupo de CADA campo. `Record` completo a propósito: el compilador no
 *  deja añadir un campo a EDU_PATIENT_FORM_FIELDS sin decidir su grupo, y
 *  un campo sin grupo sería un campo que cualquiera puede escribir. */
export const EDU_PATIENT_FIELD_GROUP: Record<EduPatientFormField, EduPatientFieldGroup> = {
  folio: "identidad",
  firstName: "identidad",
  lastName: "identidad",
  sex: "identidad",
  birthDate: "identidad",
  curp: "identidad",

  phone: "contacto",
  phone2: "contacto",
  email: "contacto",
  contactPreference: "contacto",

  addressStreet: "identidad",
  addressNeighborhood: "identidad",
  addressCity: "identidad",
  addressState: "identidad",
  addressZip: "identidad",

  guardianName: "identidad",
  guardianRelation: "identidad",
  guardianPhone: "identidad",

  insuranceProvider: "identidad",
  insurancePolicy: "identidad",

  familyHistory: "clinico",
  personalNonPathologicalHistory: "clinico",

  habitsTobacco: "clinico",
  habitsAlcohol: "clinico",
  habitsBruxism: "clinico",
  habitsNotes: "clinico",

  pregnancy: "clinico",
  isChild: "clinico",

  status: "identidad",
  notes: "identidad",
  privacyNoticeAcceptedAt: "identidad",
};

/** Los campos de CONTACTO, derivados del mapa de arriba y no escritos otra
 *  vez: dos listas que dicen lo mismo son dos listas que un día dejan de
 *  decirlo. */
export const EDU_PATIENT_CONTACT_FIELDS: readonly EduPatientFormField[] =
  EDU_PATIENT_FORM_FIELDS.filter((f) => EDU_PATIENT_FIELD_GROUP[f] === "contacto");

/** Los CLÍNICOS (NOM-004, hábitos, embarazo, dentición). */
export const EDU_PATIENT_CLINICAL_FIELDS: readonly EduPatientFormField[] =
  EDU_PATIENT_FORM_FIELDS.filter((f) => EDU_PATIENT_FIELD_GROUP[f] === "clinico");

/** Los de IDENTIDAD y papeleo (`pacientes.manage`). */
export const EDU_PATIENT_IDENTITY_FIELDS: readonly EduPatientFormField[] =
  EDU_PATIENT_FORM_FIELDS.filter((f) => EDU_PATIENT_FIELD_GROUP[f] === "identidad");

/** ¿Este campo lo puede tocar quien solo tiene la llave del contacto? */
export function eduPatientFieldIsContact(field: string): field is EduPatientFormField {
  return (EDU_PATIENT_CONTACT_FIELDS as readonly string[]).includes(field);
}

/** ¿Qué grupo abre este campo? `null` si el nombre no es un campo de la
 *  ficha (una clave suelta en el body). */
export function eduPatientFieldGroupOf(field: string): EduPatientFieldGroup | null {
  return (EDU_PATIENT_FORM_FIELDS as readonly string[]).includes(field)
    ? EDU_PATIENT_FIELD_GROUP[field as EduPatientFormField]
    : null;
}

/**
 * Los 31 campos tal como los teclea una persona: TODO cadena, incluidos los
 * `<select>` y la casilla de la dentición ("true"/"false"). Es lo que un
 * `<input>` devuelve, y mantenerlo así evita el baile de null/""/undefined
 * dentro del componente.
 *
 * 🔴 "" ES "SIN REGISTRAR" y no una respuesta. Los cinco campos de enum
 * (pregnancy, contactPreference y los tres hábitos) usan la cadena vacía
 * para el `null` de la columna, y sus `<option value="">` dicen «Sin
 * registrar» en pantalla. Elegir «No lo sabe» escribe `DESCONOCIDO`, que es
 * un dato distinto: alguien preguntó.
 */
export type EduPatientFormValues = Record<EduPatientFormField, string>;

/** El estado inicial del formulario, SIEMPRE a partir de la fila guardada. */
export function eduPatientFormValues(row: EduPatientRow): EduPatientFormValues {
  return {
    folio: row.folio,
    firstName: row.firstName,
    lastName: row.lastName,
    sex: row.sex,
    birthDate: eduDateInputValue(row.birthDate),
    curp: row.curp ?? "",

    phone: row.phone ?? "",
    phone2: row.phone2 ?? "",
    email: row.email ?? "",
    contactPreference: row.contactPreference ?? "",

    addressStreet: row.addressStreet ?? "",
    addressNeighborhood: row.addressNeighborhood ?? "",
    addressCity: row.addressCity ?? "",
    addressState: row.addressState ?? "",
    addressZip: row.addressZip ?? "",

    guardianName: row.guardianName ?? "",
    guardianRelation: row.guardianRelation ?? "",
    guardianPhone: row.guardianPhone ?? "",

    insuranceProvider: row.insuranceProvider ?? "",
    insurancePolicy: row.insurancePolicy ?? "",

    familyHistory: row.familyHistory ?? "",
    personalNonPathologicalHistory: row.personalNonPathologicalHistory ?? "",

    habitsTobacco: row.habitsTobacco ?? "",
    habitsAlcohol: row.habitsAlcohol ?? "",
    habitsBruxism: row.habitsBruxism ?? "",
    habitsNotes: row.habitsNotes ?? "",

    pregnancy: row.pregnancy ?? "",
    isChild: row.isChild ? "true" : "false",

    status: row.status,
    notes: row.notes ?? "",
    privacyNoticeAcceptedAt: eduDateInputValue(row.privacyNoticeAcceptedAt),
  };
}

/**
 * Los campos que NO se pueden vaciar: son obligatorios en la tabla y el
 * servidor rechaza dejarlos en blanco. Todo lo demás se vacía a `null`, que
 * es lo que devuelve la ficha a «sin registrar».
 *
 * `isChild` está aquí porque su columna es `NOT NULL DEFAULT false`: no
 * tiene un "sin registrar", tiene un false.
 */
const NO_ANULABLES: readonly EduPatientFormField[] = [
  "folio",
  "firstName",
  "lastName",
  "sex",
  "status",
  "isChild",
];

/**
 * SOLO lo que cambió. Un campo que no aparece en el objeto que devuelve
 * esta función no se escribe: es la regla entera de H-10.
 *
 * ⚠️ Compara contra la fila FRESCA que la pantalla acaba de leer, no contra
 * la que se pintó hace veinte minutos. Quien la llame con una fila vieja
 * vuelve a tener el bug, y por eso el modal ya no monta el formulario hasta
 * que la respuesta del GET llegó.
 */
export function eduPatientFormDiff(
  row: EduPatientRow,
  values: EduPatientFormValues,
): Partial<Record<EduPatientFormField, string | null>> {
  const base = eduPatientFormValues(row);
  const diff: Partial<Record<EduPatientFormField, string | null>> = {};
  for (const campo of EDU_PATIENT_FORM_FIELDS) {
    const antes = base[campo].trim();
    const ahora = (values[campo] ?? "").trim();
    if (antes === ahora) continue;
    diff[campo] = ahora === "" && !NO_ANULABLES.includes(campo) ? null : ahora;
  }
  return diff;
}

/** ¿Hay algo que mandar? Con el diff vacío no se llama al endpoint: el
 *  servidor contesta "No mandaste ningún cambio" y sería un error donde no
 *  hubo ninguno. */
export function eduPatientFormHasChanges(
  diff: Partial<Record<EduPatientFormField, string | null>>,
): boolean {
  return Object.keys(diff).length > 0;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LOS CAMPOS QUE EL SERVIDOR REBOTA: SE PARAN AQUÍ, NO EN ÁMBAR (N-16).
 *
 * 🔴 QUÉ ARREGLA. El CURP, el código postal y los dos teléfonos del
 * paciente los VALIDA el servidor y los RECHAZA con un 400. La pantalla
 * solo los avisaba en ámbar y dejaba pulsar Guardar. Y el PATCH es ATÓMICO:
 * un CURP de 17 caracteres tumbaba el guardado ENTERO —el apellido
 * corregido, el domicilio recién capturado, todo—, y el mensaje que subía
 * hablaba solo del CURP. La persona veía un error sobre un campo que ni
 * siquiera estaba mirando y volvía a pulsar.
 *
 * 🔴 SOLO SE MIRA LO QUE VIAJA (el diff), por la misma razón que la regla
 * del tutor y la del estado: en la base hay CURP escritos a mano antes de
 * que existiera la validación, y bloquear cualquier guardado suyo dejaría a
 * recepción sin poder corregir el teléfono de ese paciente. Lo que no
 * cambia no se manda, así que no puede rebotar.
 *
 * 🔴 Y EL MENSAJE NOMBRA EL CAMPO. Es la mitad del arreglo: "revisa el
 * código postal" es accionable; "no se pudo guardar" no lo es.
 *
 * ⚠️ El aviso ÁMBAR de arriba (`eduCurpWarning`, `eduPhoneWaWarning`) sigue
 * existiendo y NO es lo mismo: aquél habla del dato YA GUARDADO —el que
 * nadie está tocando— y ése no bloquea nada. Éste habla del que se está a
 * punto de mandar.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function eduPatientFormFieldError(
  diff: Partial<Record<EduPatientFormField, string | null>>,
): string | null {
  const val = (campo: EduPatientFormField): string => String(diff[campo] ?? "").trim();

  const curp = val("curp");
  if (diff.curp !== undefined && curp && !eduCurpIsValid(curp)) {
    return `El CURP no tiene la forma oficial y el guardado se rechazaría entero. ${EDU_CURP_HELP}`;
  }

  const zip = val("addressZip");
  if (diff.addressZip !== undefined && zip && !/^\d{5}$/.test(zip)) {
    return "El código postal son cinco dígitos, y el guardado se rechazaría entero. Complétalo o déjalo vacío.";
  }

  const phone = val("phone");
  if (diff.phone !== undefined && phone && !normalizeEduWaPhone(phone)) {
    return `El teléfono del paciente no sirve y el guardado se rechazaría entero. ${EDU_PHONE_HELP}`;
  }

  const phone2 = val("phone2");
  if (diff.phone2 !== undefined && phone2 && !normalizeEduWaPhone(phone2)) {
    return `El segundo teléfono no sirve y el guardado se rechazaría entero. ${EDU_PHONE_HELP}`;
  }

  // El del TUTOR va con la regla ANCHA, la misma que aplica el servidor: al
  // tutor se le LLAMA, así que un número de casa o con extensión sirve. Lo
  // único que rebota es uno sin un solo dígito.
  const guardianPhone = val("guardianPhone");
  if (diff.guardianPhone !== undefined && guardianPhone && !normalizeEduPhone(guardianPhone)) {
    return "El teléfono del tutor no tiene ningún número, y el guardado se rechazaría entero.";
  }

  return null;
}

/**
 * ¿Esta cuenta tiene ALGO que editar en la ficha del paciente? (N-9)
 *
 * 🔴 UNA SOLA FUNCIÓN PARA LOS DOS SITIOS, y existe porque los dos se
 * separaron. El botón «Editar» de la lista se pintaba con
 * `canManage || canOrigin` y el `soloLectura` del modal se calculaba con
 * los CUATRO permisos: un alumno o un docente (contacto y clínico, sin
 * manage ni origen) no veía ningún botón «Editar» en la lista —la promesa
 * de H-02 se cumplía solo por la pestaña Datos—, y el comentario de la
 * lista afirmaba que la condición ya era la misma en los dos sitios. Lo
 * era cuando se escribió; la del modal ganó dos términos en la Ola B y la
 * del botón no.
 *
 * Y al revés importa igual: ensanchar el botón sin tocar el modal abriría
 * un formulario con campos habilitados y sin botón de guardar.
 */
export function eduPatientCanEditFicha(abilities: {
  manage: boolean;
  contacto: boolean;
  clinico: boolean;
  origen: boolean;
}): boolean {
  return abilities.manage || abilities.contacto || abilities.clinico || abilities.origen;
}

// ── El estado del paciente contra sus casos (H-28) ──────────────────────

/**
 * Los dos estados que dicen "este paciente ya no está en tratamiento".
 * Ponerlos a mano con casos abiertos deja la etiqueta del encabezado y el
 * filtro de la lista mintiendo hasta que alguien mueva un caso.
 */
export const EDU_PATIENT_STATUSES_SIN_CASOS_ABIERTOS: readonly EduPatientStatus[] = [
  "DISCHARGED",
  "INACTIVE",
];

/**
 * El motivo escrito por el que ESTE estado no se puede poner, o null si se
 * puede.
 *
 * 🔴 Se comprueba en los DOS lados con esta misma función: la pantalla para
 * decirlo antes de pulsar Guardar, y el servidor al guardar —porque entre
 * que se pintó la pantalla y se pulsó Guardar alguien pudo abrir un caso, y
 * porque el endpoint no puede confiar en que el body venga de esa pantalla.
 *
 * ⚠️ NO bloquea el estado que ya trae la fila: si un paciente quedó
 * DISCHARGED con casos abiertos por un dato viejo, corregirle el teléfono no
 * puede quedar atrapado detrás de un estado que nadie está cambiando. Por
 * eso quien llama solo pasa el estado cuando de verdad lo está cambiando —y
 * el diff de arriba hace exactamente eso.
 */
export function eduPatientStatusConflict(
  status: EduPatientStatus,
  openCases: number,
): string | null {
  if (openCases <= 0) return null;
  if (!EDU_PATIENT_STATUSES_SIN_CASOS_ABIERTOS.includes(status)) return null;
  const label = EDU_PATIENT_STATUS_LABELS[status];
  const n = `${openCases} caso${openCases === 1 ? "" : "s"} abierto${openCases === 1 ? "" : "s"}`;
  // 🔴 NO dice "ciérralos tú". Quien edita el estado es CAJA (el campo es
  // `pacientes.manage`) y caja no puede cerrar un caso: no lleva ninguna key
  // de casos y su alcance para el recurso "cases" es "none". Un mensaje que
  // le manda a hacer lo único que no puede hacer es un callejón sin salida,
  // así que lo que dice es DE QUIÉN depende.
  return `No se puede poner «${label}»: el paciente tiene ${n}. El estado se pone solo cuando el docente responsable los cierra o los traspasa.`;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · ANTECEDENTES MÉDICOS (ola de Casos) — ES SEGURIDAD, NO ESTÉTICA
//
// Un alumno a punto de infiltrar anestesia tiene que poder ver que el
// paciente es cardiópata SIN abrir nada: los chips de alerta se pintan en
// el ENCABEZADO de la ficha, arriba de todas las pestañas.
//
// 🔴 EL ESTADO ES TRI-ESTADO, y confundir dos de ellos es como se mata a
// alguien:
//   · SIN_REGISTRAR — nadie ha preguntado. `[]` es el default de la fila,
//     NO una respuesta. La ficha lo AVISA en ámbar.
//   · NO_REFIERE    — se le preguntó y no refiere nada. Chip verde.
//   · CON_DATOS     — hay alergias/padecimientos/medicamentos capturados.
// Lo que separa el primero de los otros dos es `historyRecordedAt`: null =
// nadie los capturó; con fecha = alguien los revisó (y quedó quién).
// ═══════════════════════════════════════════════════════════════════════

/** Los ocho grupos ABO/Rh. El servidor NO acepta texto libre aquí: un
 *  "0+" (cero) tecleado donde debía decir "O+" es exactamente la clase de
 *  dato que no puede vivir en un campo de seguridad. */
export const EDU_BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type EduBloodType = (typeof EDU_BLOOD_TYPES)[number];

/** Tope de renglones por lista y de largo por renglón. Una "lista" de 200
 *  alergias no es una historia clínica, es un pegado accidental. */
export const EDU_ANTECEDENTES_MAX_ITEMS = 30;
export const EDU_ANTECEDENTES_MAX_ITEM_LENGTH = 120;

export interface EduAntecedentes {
  bloodType: string | null;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  /** null = nadie los ha capturado (la ficha lo AVISA). */
  recordedAt: string | null;
  recordedByName: string | null;
}

export type EduAntecedentesEstado = "SIN_REGISTRAR" | "NO_REFIERE" | "CON_DATOS";

export function eduAntecedentesEstado(a: {
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  recordedAt: string | Date | null;
}): EduAntecedentesEstado {
  const vacio =
    a.allergies.length === 0 &&
    a.chronicConditions.length === 0 &&
    a.currentMedications.length === 0;
  // 🔴 LOS DATOS MANDAN SOBRE LA FECHA. Una fila con alergias capturadas
  // pero sin fecha de revisión (un import a mano, una escritura vieja) es
  // CON_DATOS: pintarle "sin antecedentes registrados" ESCONDERÍA una
  // alergia que sí está en la base — el único error peor que confundir
  // los otros dos estados.
  if (!vacio) return "CON_DATOS";
  // Y con las tres listas vacías, la fecha es lo ÚNICO que separa "nadie
  // ha preguntado" (null) de "se le preguntó y no refiere" (con fecha):
  // en la base se ven idénticas.
  return a.recordedAt ? "NO_REFIERE" : "SIN_REGISTRAR";
}

export type EduAlertChipKind =
  | "sin-registrar"
  | "no-refiere"
  | "alergia"
  | "padecimiento"
  | "medicamento"
  | "sangre"
  | "mas";

export interface EduAlertChip {
  kind: EduAlertChipKind;
  /** El tono es el del sistema de tags del vertical (edu-tag--*). */
  tone: "danger" | "warn" | "info" | "ok" | "muted";
  text: string;
  /** Lo que no cupo en el chip "+N", para el title. */
  detail?: string;
}

/** Cuántos padecimientos/medicamentos se pintan antes del "+N". Las
 *  ALERGIAS no se recortan nunca: esconder la cuarta alergia detrás de un
 *  "+1" es esconder justo la que iba a importar. */
const CHIP_CAP = 3;

/**
 * Los chips del encabezado de la ficha, derivados de los antecedentes.
 *
 * Rojo = contraindica (alergias). Ámbar = a tener en cuenta
 * (padecimientos) y el aviso de "sin registrar". Info = medicamentos y
 * tipo de sangre. Verde = revisado y sin hallazgos.
 */
export function eduAntecedentesChips(a: EduAntecedentes): EduAlertChip[] {
  const estado = eduAntecedentesEstado(a);

  if (estado === "SIN_REGISTRAR") {
    // 🔴 CON ESTAS PALABRAS. "Sin antecedentes registrados" ≠ "sin
    // alergias": lo primero es una tarea pendiente, lo segundo una
    // respuesta clínica. Pintar aquí un chip verde mataría a alguien.
    return [{ kind: "sin-registrar", tone: "warn", text: "Sin antecedentes registrados" }];
  }

  const chips: EduAlertChip[] = [];

  for (const al of a.allergies) {
    chips.push({ kind: "alergia", tone: "danger", text: `Alergia: ${al}` });
  }

  for (const c of a.chronicConditions.slice(0, CHIP_CAP)) {
    chips.push({ kind: "padecimiento", tone: "warn", text: c });
  }
  if (a.chronicConditions.length > CHIP_CAP) {
    chips.push({
      kind: "mas",
      tone: "warn",
      text: `+${a.chronicConditions.length - CHIP_CAP} padecimientos`,
      detail: a.chronicConditions.slice(CHIP_CAP).join(", "),
    });
  }

  for (const m of a.currentMedications.slice(0, CHIP_CAP)) {
    chips.push({ kind: "medicamento", tone: "info", text: m });
  }
  if (a.currentMedications.length > CHIP_CAP) {
    chips.push({
      kind: "mas",
      tone: "info",
      text: `+${a.currentMedications.length - CHIP_CAP} medicamentos`,
      detail: a.currentMedications.slice(CHIP_CAP).join(", "),
    });
  }

  if (estado === "NO_REFIERE") {
    chips.push({
      kind: "no-refiere",
      tone: "ok",
      text: "Revisado: no refiere alergias ni padecimientos",
    });
  }

  if (a.bloodType) {
    chips.push({ kind: "sangre", tone: "muted", text: `Sangre ${a.bloodType}` });
  }

  return chips;
}

export interface EduAntecedentesInput {
  bloodType?: unknown;
  allergies?: unknown;
  chronicConditions?: unknown;
  currentMedications?: unknown;
  emergencyContactName?: unknown;
  emergencyContactPhone?: unknown;
  emergencyContactRelation?: unknown;
}

export interface EduAntecedentesData {
  bloodType: string | null;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
}

/**
 * El resultado del saneo, al estilo de EduGateVerdict: TODOS los campos
 * siempre presentes, nada de unión discriminada. Este repo compila con
 * `strict: false` y ahí `if (!r.ok)` NO estrecha la unión — el código que
 * la usara "bien" no compilaría, y el arreglo obvio (un cast) escondería
 * justo el error que el tipo existía para atrapar.
 *
 * Con ok=false, `error` trae el motivo y `data` viene NEUTRA (no usarla).
 * Con ok=true, `error` es "".
 */
export interface EduAntecedentesParse {
  ok: boolean;
  error: string;
  data: EduAntecedentesData;
}

const ANTECEDENTES_NEUTROS: EduAntecedentesData = {
  bloodType: null,
  allergies: [],
  chronicConditions: [],
  currentMedications: [],
  emergencyContactName: null,
  emergencyContactPhone: null,
  emergencyContactRelation: null,
};

function antecedentesError(error: string): EduAntecedentesParse {
  return { ok: false, error, data: ANTECEDENTES_NEUTROS };
}

interface ListaParse {
  ok: boolean;
  error: string;
  value: string[];
}

/** Una lista del formulario: acepta arreglo de strings o texto con comas
 *  (el patrón del dental), recorta, descarta vacíos y deduplica sin
 *  distinguir mayúsculas ni acentos — "Penicilina" y "penicilina" son la
 *  misma alergia, no dos. */
function parseLista(raw: unknown, nombre: string): ListaParse {
  let items: string[];
  if (raw === undefined || raw === null || raw === "") items = [];
  else if (typeof raw === "string") items = raw.split(",");
  else if (Array.isArray(raw)) {
    if (raw.some((x) => typeof x !== "string")) {
      return { ok: false, error: `La lista de ${nombre} trae algo que no es texto.`, value: [] };
    }
    items = raw as string[];
  } else {
    return { ok: false, error: `La lista de ${nombre} no tiene forma de lista.`, value: [] };
  }

  const vistos = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const v = item.trim().replace(/\s+/g, " ");
    if (!v) continue;
    if (v.length > EDU_ANTECEDENTES_MAX_ITEM_LENGTH) {
      return {
        ok: false,
        error: `Un renglón de ${nombre} pasa de ${EDU_ANTECEDENTES_MAX_ITEM_LENGTH} caracteres. Escribe el nombre, no la historia completa.`,
        value: [],
      };
    }
    // La llave de dedupe reusa el normalizador del buscador (minúsculas,
    // sin acentos): "Penicilina" y "penicilina" son la misma alergia.
    const llave = eduNormalizeSearch(v);
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    out.push(v);
  }
  if (out.length > EDU_ANTECEDENTES_MAX_ITEMS) {
    return {
      ok: false,
      error: `Son demasiados renglones de ${nombre} (máximo ${EDU_ANTECEDENTES_MAX_ITEMS}).`,
      value: [],
    };
  }
  return { ok: true, error: "", value: out };
}

function parseTextoOpcional(raw: unknown, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  return v.slice(0, max);
}

/**
 * Sanea el bloque COMPLETO de antecedentes. Es un REEMPLAZO, no un merge:
 * guardar antecedentes significa "revisé el bloque entero hoy", y por eso
 * el servidor estampa `historyRecordedAt`/`historyRecordedById` juntos en
 * la misma escritura. Un merge campo por campo dejaría una fecha de
 * revisión sobre datos que nadie revisó.
 */
export function parseEduAntecedentes(input: EduAntecedentesInput): EduAntecedentesParse {
  const alergias = parseLista(input.allergies, "alergias");
  if (!alergias.ok) return antecedentesError(alergias.error);
  const padecimientos = parseLista(input.chronicConditions, "padecimientos");
  if (!padecimientos.ok) return antecedentesError(padecimientos.error);
  const medicamentos = parseLista(input.currentMedications, "medicamentos");
  if (!medicamentos.ok) return antecedentesError(medicamentos.error);

  let bloodType: string | null = null;
  if (input.bloodType !== undefined && input.bloodType !== null && input.bloodType !== "") {
    if (typeof input.bloodType !== "string") {
      return antecedentesError("Ese tipo de sangre no existe.");
    }
    const v = input.bloodType.trim().toUpperCase();
    if (!(EDU_BLOOD_TYPES as readonly string[]).includes(v)) {
      // La letra es O (de la palabra), no cero — el dedazo clásico.
      return antecedentesError("Ese tipo de sangre no existe. Son A, B, AB u O, con + o −.");
    }
    bloodType = v;
  }

  const emergencyContactName = parseTextoOpcional(input.emergencyContactName, 120);

  let emergencyContactPhone: string | null = null;
  if (
    input.emergencyContactPhone !== undefined &&
    input.emergencyContactPhone !== null &&
    input.emergencyContactPhone !== ""
  ) {
    const v = normalizeEduPhone(input.emergencyContactPhone);
    if (!v) return antecedentesError("El teléfono de emergencia no tiene números suficientes.");
    emergencyContactPhone = v;
  }

  const emergencyContactRelation = parseTextoOpcional(input.emergencyContactRelation, 60);

  return {
    ok: true,
    error: "",
    data: {
      bloodType,
      allergies: alergias.value,
      chronicConditions: padecimientos.value,
      currentMedications: medicamentos.value,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LA FICHA COMPLETA (Ola B · ws2-t3)
//
// Lo que un dentista da por hecho al abrir un perfil y este vertical no
// capturaba: el tutor del menor, el domicilio, el seguro, el segundo
// teléfono, el CURP, los antecedentes que la NOM-004 pide por separado,
// los hábitos, el embarazo, la dentición y el aviso de privacidad.
//
// Todo lo de aquí abajo es PURO: se prueba sin base de datos y lo usan las
// dos puntas (el formulario en el navegador y el servidor al guardar).
// ═══════════════════════════════════════════════════════════════════════

/** La mayoría de edad, en años. El mismo número que usan los
 *  consentimientos (`EDU_CONSENT_EDAD_MAYORIA`); se escribe aquí para no
 *  arrastrar el módulo de consentimientos a la ficha, y hay una prueba que
 *  fija que los dos valen lo mismo. */
export const EDU_PATIENT_EDAD_MAYORIA = 18;

/**
 * ═══════════════════════════════════════════════════════════════════════
 * H-08 · UN MENOR TIENE QUE TENER TUTOR EN SU FICHA.
 *
 * El motivo escrito por el que este guardado no puede salir, o null si
 * puede. Se comprueba en los DOS lados con esta misma función: la pantalla
 * para decirlo antes de pulsar Guardar, y el servidor al guardar.
 *
 * 🔴 SOLO MUERDE CUANDO EL GUARDADO TOCA EL ASUNTO, y es la misma regla que
 * `eduPatientStatusConflict` ya aplica al estado, por la misma razón. En la
 * base hay menores registrados antes de que existiera la columna del tutor:
 * si esto bloqueara cualquier guardado de un menor sin tutor, recepción no
 * podría corregirle un dedazo en el apellido —ni el alumno el teléfono—
 * hasta rellenar un dato que a lo mejor no tiene delante. Lo que se bloquea
 * es lo que de verdad crea el problema:
 *
 *   · poner (o cambiar) la FECHA DE NACIMIENTO de forma que quede un menor
 *     sin tutor en la ficha, y
 *   · BORRAR el nombre del tutor de un menor que ya lo tenía.
 *
 * El aviso, en cambio, se pinta SIEMPRE que el paciente sea menor y no
 * tenga tutor: la ficha lo dice aunque no bloquee nada.
 *
 * ⚠️ Sin fecha de nacimiento NO se bloquea nada. No se puede afirmar que
 * alguien sea menor, y trancar la ficha de todo paciente sin nacimiento
 * —un dato que sigue siendo opcional— pararía la clínica. Es la misma
 * decisión que ya tomó el servidor de los consentimientos.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function eduPatientTutorConflict(
  datos: { ageYears: number | null; guardianName: string | null },
): string | null {
  if (datos.ageYears === null) return null;
  if (datos.ageYears >= EDU_PATIENT_EDAD_MAYORIA) return null;
  if (datos.guardianName && datos.guardianName.trim()) return null;
  return `Este paciente tiene ${datos.ageYears} ${
    datos.ageYears === 1 ? "año" : "años"
  }: es menor de edad y su ficha tiene que decir quién es su tutor o representante legal. Escribe su nombre y el parentesco — es quien firma los consentimientos y a quien se llama.`;
}

/** El aviso PERMANENTE de la ficha: menor sin tutor. Es el mismo texto que
 *  bloquea, para que nadie lea dos explicaciones del mismo problema. */
export function eduPatientTutorWarning(row: {
  ageYears: number | null;
  guardianName: string | null;
}): string | null {
  return eduPatientTutorConflict(row);
}

/**
 * ¿ESTE guardado tiene que rebotar por falta de tutor? Recibe la fila
 * guardada y el diff que se va a mandar, y aplica la regla de arriba.
 *
 * Se calcula la edad con la fecha RESULTANTE (la del diff si viene, la de
 * la fila si no): cambiar el nacimiento a 2015 sobre un paciente que
 * figuraba adulto tiene que rebotar en ese mismo acto, no en el siguiente.
 */
export function eduPatientTutorConflictOnSave(
  row: EduPatientRow,
  diff: Partial<Record<EduPatientFormField, string | null>>,
  now: Date = new Date(),
): string | null {
  const tocaNacimiento = diff.birthDate !== undefined;
  const borraTutor = diff.guardianName !== undefined && !String(diff.guardianName ?? "").trim();
  if (!tocaNacimiento && !borraTutor) return null;

  const nacimiento = tocaNacimiento ? diff.birthDate : row.birthDate;
  const ageYears = eduAgeYears(nacimiento ?? null, now);
  const guardianName =
    diff.guardianName !== undefined ? (diff.guardianName ?? null) : row.guardianName;
  return eduPatientTutorConflict({ ageYears, guardianName });
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LOS CHIPS DE LA CABECERA QUE ESTA OLA DEJA LISTOS Y NO MONTA.
 *
 * El encabezado de la ficha (pacientes/[id]/layout.tsx) ya pinta los chips
 * de los ANTECEDENTES con `eduAntecedentesChips`. Estos son los dos que la
 * Ola B hace posibles —«menor · tutor: X» y «embarazo»— y salen de aquí, en
 * la misma forma (`EduAlertChip`), para que montarlos sea añadir una línea
 * al layout y no escribir la regla otra vez.
 *
 * ✅ YA ESTÁN MONTADOS. Cuando se escribió este bloque no lo estaban —el
 * layout era de otra casilla de la misma ola— y el comentario decía «NO SE
 * MONTAN EN ESTA OLA». La otra casilla los montó:
 * `pacientes/[id]/layout.tsx` los pinta con su propio mapa de iconos
 * (`Record<EduFichaChipKind, LucideIcon>`). El aviso se queda por lo que
 * sigue siendo cierto: la unión `EduAlertChipKind` NO se amplía desde aquí.
 *
 * 🔴 Y SIGUEN LA MISMA REGLA DE TRES ESTADOS que los antecedentes: `null`
 * en `pregnancy` NO pinta nada (nadie preguntó ≠ no está embarazada), y
 * `DESCONOCIDO` pinta un chip ámbar propio — porque «se preguntó y no se
 * sabe» es justo lo que hay que resolver antes de una radiografía.
 * ═══════════════════════════════════════════════════════════════════════
 */
export type EduFichaChipKind = "menor" | "embarazo";

/**
 * Un chip de la cabecera que NO sale de los antecedentes.
 *
 * 🔴 TIPO PROPIO Y NO UN VALOR MÁS EN `EduAlertChipKind`, y la razón es
 * mecánica: el layout de la ficha declara `Record<EduAlertChipKind,
 * LucideIcon>`, así que ampliar aquella unión ROMPE LA BUILD de un archivo
 * que esta casilla no puede tocar (es de otra casilla de la misma ola). La
 * forma es la misma —tone, text, detail—, así que montarlos es concatenar
 * las dos listas y añadir dos iconos.
 */
export interface EduFichaChip {
  kind: EduFichaChipKind;
  tone: "danger" | "warn" | "info" | "ok" | "muted";
  text: string;
  detail?: string;
}

export function eduPatientFichaChips(row: {
  ageYears: number | null;
  guardianName: string | null;
  guardianRelation: string | null;
  pregnancy: EduPregnancy | null;
  /**
   * 🔴 SE RECIBE Y NO SE USA PARA DECIDIR «MENOR», a propósito y con
   * nombre propio (N-16 de la auditoría de la Ola A+B). `isChild` es la
   * DENTICIÓN TEMPORAL: un dato clínico de la boca, no la edad de la
   * persona. Un adulto con dentición temporal marcada llevaba en las doce
   * pestañas un chip que decía «Menor sin tutor registrado» mientras la
   * pestaña Datos del mismo paciente no decía nada y el servidor le dejaba
   * guardar sin tutor — tres pantallas contradiciéndose sobre lo mismo.
   *
   * MENOR SE DECIDE POR EDAD Y SOLO POR EDAD, que es la MISMA regla que
   * aplica `eduPatientTutorConflict` al guardar y la que aplica el servidor
   * de los consentimientos al emitir una carta. La prop se queda en la
   * firma porque el layout de la ficha la pasa en un literal —quitarla del
   * tipo haría saltar el chequeo de propiedades de más de TypeScript y
   * tumbaría la build de un archivo de otra casilla.
   */
  isChild: boolean;
}): EduFichaChip[] {
  const chips: EduFichaChip[] = [];

  const menor = row.ageYears !== null && row.ageYears < EDU_PATIENT_EDAD_MAYORIA;
  if (menor) {
    const quien = row.guardianName
      ? `${row.guardianName}${row.guardianRelation ? ` (${row.guardianRelation})` : ""}`
      : null;
    chips.push(
      quien
        ? {
            kind: "menor",
            tone: "info",
            text: `Menor · tutor: ${row.guardianName}`,
            detail: `Firma su representante legal: ${quien}.`,
          }
        : {
            kind: "menor",
            tone: "warn",
            text: "Menor sin tutor registrado",
            detail:
              "Un menor no firma su propio consentimiento y su ficha no dice quién es su representante legal. Se captura en la pestaña Datos.",
          },
    );
  }

  if (row.pregnancy === "EMBARAZO" || row.pregnancy === "LACTANCIA") {
    chips.push({
      kind: "embarazo",
      tone: "warn",
      text: row.pregnancy === "EMBARAZO" ? "Embarazo" : "Lactancia",
      detail:
        row.pregnancy === "EMBARAZO"
          ? "Paciente embarazada: consúltalo antes de una radiografía o de recetar."
          : "Paciente en lactancia: consúltalo antes de recetar.",
    });
  } else if (row.pregnancy === "DESCONOCIDO") {
    chips.push({
      kind: "embarazo",
      tone: "warn",
      text: "Embarazo: no lo sabe",
      detail:
        "Se le preguntó y no lo sabe. Resuélvelo antes de una radiografía — no es lo mismo que «no».",
    });
  }

  return chips;
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · LA PAGINACIÓN DE LA LISTA (H-06)
//
// 🔴 POR CURSOR Y NO POR `skip`. Una escuela con 2 000 pacientes veía los
// 300 más recientes y leía «se muestran los primeros 300»: los otros 1 700
// solo existían si sabías su nombre. Se pagina por cursor y no por número
// de página porque la lista se ordena por `createdAt desc` y se le dan de
// alta pacientes MIENTRAS alguien la recorre: con `skip`, un alta entre la
// página 1 y la 2 empuja una fila hacia abajo y esa fila se ve DOS veces —
// o, al revés, una se salta. El cursor apunta a una fila concreta, así que
// lo que ya pasó no vuelve.
//
// 🔴 Y EL ORDEN LLEVA DESEMPATE POR `id`. `createdAt` no es único: dos
// altas del mismo milisegundo (una importación, dos recepcionistas) se
// ordenarían de forma arbitraria entre consultas y el cursor saltaría una.
// ═══════════════════════════════════════════════════════════════════════

/** Filas por página. 50 y no 300: es lo que cabe en una pantalla sin que
 *  el navegador tenga que pintar un DOM de miles de nodos, y es el tamaño
 *  que hace que "Ver más" se sienta instantáneo. */
export const EDU_PATIENT_PAGE_SIZE = 50;

/** El cursor, ya descompuesto. */
export interface EduPatientCursor {
  createdAt: Date;
  id: string;
}

/**
 * El cursor como cadena, para que viaje en la query string.
 *
 * `<ISO>|<id>`, en claro y a propósito: un cursor no es un secreto (no
 * abre nada: el `where` del alcance se aplica igual) y uno legible se
 * puede depurar mirando la URL. Lo que sí se hace es VALIDARLO al leerlo —
 * un cursor inventado tiene que dar `null` y devolver la primera página,
 * nunca reventar la consulta.
 */
export function eduPatientCursorEncode(row: { createdAt: string; id: string }): string {
  return `${row.createdAt}|${row.id}`;
}

export function eduPatientCursorDecode(raw: unknown): EduPatientCursor | null {
  if (typeof raw !== "string") return null;
  const corte = raw.indexOf("|");
  if (corte <= 0) return null;
  const iso = raw.slice(0, corte);
  const id = raw.slice(corte + 1);
  if (!id || id.length > 40 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { createdAt: d, id };
}

/** Una página de la lista. `nextCursor` null = ya no hay más. */
export interface EduPatientsPageCursor {
  rows: EduPatientRow[];
  nextCursor: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · EXPORTAR LA LISTA A CSV
//
// 🔴 EL ESCAPE ES OBLIGATORIO Y NO ES ESTÉTICA. Un paciente que se llama
// «Pérez, María» parte la fila en dos columnas si nadie lo entrecomilla, y
// a partir de ahí TODO el archivo está corrido: el teléfono de uno queda en
// la columna del correo de otro. Se entrecomilla siempre y se duplican las
// comillas de dentro, que es la regla del RFC 4180.
//
// 🔴 Y LA CELDA QUE EMPIEZA POR = + - @ SE NEUTRALIZA. Excel y Sheets
// tratan esa celda como una FÓRMULA: un campo de notas que empiece por
// "=cmd|..." se ejecuta al abrir el archivo en el equipo de recepción. Se
// le antepone un apóstrofo, que es lo que la hoja de cálculo entiende como
// "esto es texto". No es teoría: es la clase de agujero que se abre al
// exportar datos que teclea cualquiera.
// ═══════════════════════════════════════════════════════════════════════

/** Una celda, escapada y neutralizada. */
export function eduCsvCell(value: unknown): string {
  const raw =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : String(value);
  // Los saltos de línea dentro de una celda son legales entre comillas,
  // pero una nota de recepción de tres párrafos hace ilegible la hoja: se
  // colapsan a un espacio.
  const limpio = raw.replace(/[\r\n]+/g, " ").trim();
  const seguro = /^[=+\-@\t]/.test(limpio) ? `'${limpio}` : limpio;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/**
 * Hasta cuántas filas arma el CSV el NAVEGADOR.
 *
 * Por encima de esto (o si quedan páginas por bajar) el archivo lo hace el
 * servidor. Mil es donde deja de ser gratis: mil filas por veintiséis
 * columnas son unos 200 KB de cadena construidos en el hilo de la interfaz,
 * y a partir de ahí la pestaña se nota trabada mientras se genera.
 */
export const EDU_PATIENT_CSV_CLIENTE_MAX = 1000;

/** Las columnas del CSV de pacientes, en su orden. */
export const EDU_PATIENT_CSV_HEADERS = [
  "Folio",
  "Nombre",
  "Apellidos",
  "Sexo",
  "Nacimiento",
  "Edad",
  "CURP",
  "Teléfono",
  "Teléfono 2",
  "Correo",
  "Preferencia de contacto",
  "Calle y número",
  "Colonia",
  "Ciudad",
  "Estado",
  "CP",
  "Tutor",
  "Parentesco del tutor",
  "Teléfono del tutor",
  "Seguro",
  "Póliza",
  "Estado del paciente",
  "Casos abiertos",
  "Casos totales",
  "Lo trajo",
  "Registrado",
] as const;

/**
 * La fecha COMO LA QUIERE UNA HOJA DE CÁLCULO: `AAAA-MM-DD` o vacío.
 *
 * 🔴 Y no `formatEduDate`, que es la del panel («7 de septiembre de 2026»)
 * y devuelve «—» cuando no hay fecha. En una columna de Excel eso no se
 * ordena, no se filtra por rango y no se resta: un CSV es para calcular,
 * no para leer. Se lee en UTC, como todas las fechas de calendario de este
 * vertical, para que un nacimiento del 1 de enero no salga «31 de
 * diciembre».
 */
export function eduCsvDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * El CSV completo de una lista de pacientes.
 *
 * ⚠️ NO lleva antecedentes, hábitos, embarazo ni los NOM-004: un CSV se
 * manda por correo y se deja abierto en un escritorio. Lo que sale es el
 * padrón administrativo —lo que una escuela necesita para llamar, cobrar y
 * contar—, no la historia clínica. Sacar eso es otra decisión y necesita
 * otra conversación.
 *
 * ⚠️ Con BOM UTF-8 al principio: sin él, Excel en Windows abre "Pérez"
 * como "PÃ©rez" y el archivo llega roto a quien lo pidió.
 */
export function eduPatientsCsv(
  rows: EduPatientRow[],
  formatDate: (iso: string | null | undefined) => string = eduCsvDate,
): string {
  const lineas: string[] = [
    (EDU_PATIENT_CSV_HEADERS as readonly string[]).map(eduCsvCell).join(","),
  ];
  for (const p of rows) {
    lineas.push(
      [
        p.folio,
        p.firstName,
        p.lastName,
        EDU_SEX_LABELS[p.sex],
        formatDate(p.birthDate),
        p.ageYears === null ? "" : p.ageYears,
        p.curp,
        p.phone,
        p.phone2,
        p.email,
        p.contactPreference ?? "",
        p.addressStreet,
        p.addressNeighborhood,
        p.addressCity,
        p.addressState,
        p.addressZip,
        p.guardianName,
        p.guardianRelation,
        p.guardianPhone,
        p.insuranceProvider,
        p.insurancePolicy,
        EDU_PATIENT_STATUS_LABELS[p.status],
        p.openCases,
        p.totalCases,
        p.origin.studentMatricula
          ? `${p.origin.studentMatricula} · ${p.origin.studentName ?? ""}`.trim()
          : "",
        formatDate(p.createdAt),
      ]
        .map(eduCsvCell)
        .join(","),
    );
  }
  // CRLF, que es lo que el RFC 4180 pide y lo que Excel espera.
  return `﻿${lineas.join("\r\n")}\r\n`;
}

/** El nombre del archivo. Con la fecha dentro: dos exportaciones del mismo
 *  día no se pisan en la carpeta de descargas y se sabe de cuándo es. */
export function eduPatientsCsvFileName(now: Date = new Date()): string {
  return `pacientes-${now.toISOString().slice(0, 10)}.csv`;
}
