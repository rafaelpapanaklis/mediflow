/**
 * DaleControl INSTITUCIONAL — ARCO (LFPDPPP) · la parte PURA.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin
 * `new Date()` escondido (el `now` siempre se pasa). Recibe datos y
 * devuelve datos, para poder comprobar en una prueba —sin base de datos—
 * qué se sustituye y qué se conserva.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 UN PACIENTE NO SE BORRA NUNCA, Y EL ARCO NO CAMBIA ESO
 *
 * La NOM-004 obliga a conservar el expediente CINCO AÑOS desde el último
 * acto médico, y una solicitud de cancelación de datos NO derrota a esa
 * obligación: son dos normas distintas y la de salud gana sobre el dato
 * clínico. Lo que la LFPDPPP sí obliga a poder hacer —y hasta hoy este
 * producto no podía— es SUSTITUIR EL PII y conservar lo clínico.
 *
 * Así que hay TRES actos distintos, y son tres porque tienen tres
 * consecuencias distintas:
 *
 *   1. BAJA (`deletedAt`) — la ficha sale de las listas. Reversible: es
 *      una columna que se pone y se quita. NADA de la persona cambia.
 *   2. ANONIMIZACIÓN (`anonymizedAt`) — el PII se sustituye por
 *      marcadores. IRREVERSIBLE: lo que se sustituyó no vuelve. Lo
 *      clínico (odontograma, notas, estudios, recetas) se queda intacto.
 *   3. FUSIÓN (`mergedIntoId`) — dos fichas de la misma persona pasan a
 *      ser una. Vive en fusion-core.ts, no aquí.
 *
 * 🔴 QUÉ SE SUSTITUYE ESTÁ ESCRITO EN UN SITIO Y SOLO EN UNO:
 * EDU_ARCO_PII_FIELDS, aquí abajo. Repartirlo por el endpoint que
 * anonimiza es cómo se llega a que la ola que agrega una columna de
 * contacto se olvide de meterla en la lista — y entonces el teléfono del
 * paciente sobrevive a su propia solicitud de cancelación. La prueba
 * `edu-arco.test.ts` compara esta lista contra el modelo de Prisma para
 * que una columna nueva de PII no se pueda quedar fuera en silencio.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA RETENCIÓN
// ═══════════════════════════════════════════════════════════════════════

/**
 * CINCO AÑOS, en años y no en días: los bisiestos hacen que "5 * 365 días"
 * se quede corto por uno o dos días, y una retención que termina antes de
 * tiempo es exactamente el error que no se puede cometer.
 *
 * NOM-004-SSA3-2012 §5.3: el expediente se conserva un mínimo de cinco
 * años contados a partir de la fecha del ÚLTIMO acto médico.
 */
export const EDU_ARCO_RETENTION_YEARS = 5;

/**
 * Hasta cuándo hay que conservar el expediente, contado desde el último
 * acto médico.
 *
 * 🔴 DESDE EL ÚLTIMO ACTO, NO DESDE EL ALTA. Un paciente registrado en
 * 2019 al que se le hizo una endodoncia en 2025 tiene su reloj corriendo
 * desde 2025. Pasar la fecha equivocada aquí es adelantar cinco años una
 * destrucción de expediente.
 */
export function eduArcoRetentionUntil(lastClinicalActivity: Date): Date {
  const d = new Date(lastClinicalActivity.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + EDU_ARCO_RETENTION_YEARS);
  return d;
}

/** ¿Ya pasó la retención de cinco años a la fecha `now`? */
export function eduArcoRetentionCumplida(lastClinicalActivity: Date, now: Date): boolean {
  return now.getTime() >= eduArcoRetentionUntil(lastClinicalActivity).getTime();
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · QUÉ SE SUSTITUYE, Y POR QUÉ CADA COSA
// ═══════════════════════════════════════════════════════════════════════

/**
 * El texto que ocupa el lugar de un dato personal borrado.
 *
 * No es la cadena vacía a propósito: "" y NULL ya significan otra cosa en
 * este modelo ("nadie lo capturó"), y una ficha anonimizada tiene que
 * poder distinguirse de una a medio llenar. Quien abra la lista tiene que
 * leer POR QUÉ no hay nombre.
 */
export const EDU_ARCO_REDACTED = "[DATO CANCELADO]";

/**
 * Lo que se le pone al folio. Se CONSERVA el folio original detrás del
 * prefijo porque es la llave con la que la escuela encuentra el
 * expediente en papel, y perderla es perder el expediente.
 */
export const EDU_ARCO_FOLIO_PREFIX = "ARCO-";

/**
 * LOS CAMPOS DE PII, cada uno con qué se sustituye.
 *
 * `null` = se pone a NULL (el campo es opcional y su ausencia ya es un
 * estado válido). Un string = se escribe ese texto.
 *
 * ⚠️ LO QUE NO ESTÁ AQUÍ SE CONSERVA, Y ESO ES DELIBERADO:
 *   · `birthDate` y `sex` → son datos CLÍNICOS: la edad y el sexo cambian
 *     la lectura de una radiografía y la dosis de un anestésico. El
 *     expediente que la norma obliga a conservar deja de servir sin ellos.
 *   · `isChild` → decide qué odontograma se pinta (temporal o permanente).
 *   · Los antecedentes (`allergies`, `chronicConditions`,
 *     `currentMedications`, `bloodType`, `familyHistory`, `pregnancy`,
 *     `habits*`) → son el expediente, no la identidad.
 *   · `status`, `institutionId`, `createdAt` → estructura.
 *
 * Y lo que SÍ está: todo lo que identifica a una PERSONA concreta o
 * permite contactarla, incluidas las tres columnas del tutor (el tutor es
 * otra persona física, con sus propios derechos ARCO) y las dos del
 * seguro (número de póliza = identificador).
 */
export const EDU_ARCO_PII_FIELDS: Record<string, string | null> = {
  firstName: EDU_ARCO_REDACTED,
  lastName: EDU_ARCO_REDACTED,
  phone: null,
  phone2: null,
  email: null,
  curp: null,
  addressStreet: null,
  addressNeighborhood: null,
  addressCity: null,
  addressState: null,
  addressZip: null,
  guardianName: null,
  guardianRelation: null,
  guardianPhone: null,
  insuranceProvider: null,
  insurancePolicy: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  emergencyContactRelation: null,
  notes: null,
  // El índice de búsqueda se vacía SIEMPRE y va aquí y no aparte: si se
  // quedara, buscar el apellido de la persona seguiría encontrando su
  // ficha anonimizada — que es exactamente lo que la solicitud pedía que
  // dejara de pasar. "" y no null porque la columna es NOT NULL con
  // default "".
  searchIndex: "",
};

/** Los nombres de los campos que se sustituyen, para las pruebas y la UI. */
export const EDU_ARCO_PII_FIELD_NAMES = Object.keys(EDU_ARCO_PII_FIELDS);

/**
 * Los campos que se CONSERVAN a propósito, con el porqué de cada uno. Se
 * pinta en la pantalla de confirmación: quien firma una anonimización
 * tiene que ver qué NO se va a borrar antes de firmarla.
 */
export const EDU_ARCO_CONSERVADO: Record<string, string> = {
  birthDate:
    "La edad cambia la lectura de una radiografía y la dosis de un anestésico. Es dato clínico.",
  sex: "Dato clínico del expediente que la NOM-004 obliga a conservar cinco años.",
  isChild: "Decide qué odontograma se pinta: dentición temporal o permanente.",
  folio: "Es la llave con la que la escuela encuentra el expediente en papel.",
  allergies: "Antecedente clínico. Sin él, el expediente conservado no sirve para nada.",
  chronicConditions:
    "Antecedente clínico: los padecimientos crónicos son la mitad del expediente que la norma obliga a conservar.",
  currentMedications:
    "Antecedente clínico: qué toma el paciente cambia qué se le puede recetar y qué anestésico se le pone.",
  bloodType: "Antecedente clínico: hace falta ante una hemorragia, y no identifica a nadie por sí solo.",
  // 🔴 LOS CUATRO QUE FALTABAN. Esta pantalla existe «para que la de
  // confirmación no mienta», y hasta esta ola callaba cuatro campos: dos de
  // ellos son 2 000 caracteres de texto libre cada uno, y los antecedentes
  // heredofamiliares nombran rutinariamente a la madre y al padre —otras
  // personas físicas, con sus propios derechos—. Se conservan igual (son el
  // expediente que la NOM-004 obliga a guardar), pero AHORA SE DICEN: quien
  // firma la anonimización tiene que poder leer el texto antes de firmar y
  // vaciarlo a mano desde la ficha si no quiere que se quede.
  familyHistory:
    "Antecedentes heredofamiliares: 2 000 caracteres de texto libre del expediente. ⚠️ Suelen nombrar a la madre y al padre — si hay que quitarlos, se vacía el campo en la ficha ANTES de anonimizar.",
  personalNonPathologicalHistory:
    "Antecedentes personales no patológicos: 2 000 caracteres de texto libre (vivienda, higiene, alimentación). ⚠️ Mismo aviso: si describe a la persona, se vacía en la ficha antes.",
  habitsNotes:
    "El detalle en palabras de los hábitos (tabaco, alcohol, bruxismo). Es expediente clínico, y es texto libre.",
  deleteReason:
    "Por qué se dio de baja la ficha. Es la constancia de la propia solicitud: borrarla dejaría la baja sin justificación en la única tabla donde consta.",
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LAS CLAVES QUE LA ANONIMIZACIÓN TIENE QUE SACAR DE LA BITÁCORA.
 *
 * `anonymizeEduPatient` prometía por escrito que «la bitácora no guarda el
 * PII que se borró» — y sí lo guardaba: el alta escribe `{ folio, nombre }`
 * y la corrección de la ficha guarda el antes y el después de siete
 * columnas, entre ellas `phone`, `email` y `curp`. Se anonimizaba a la
 * paciente, se pulsaba «Bitácora de este paciente» (el botón está en la
 * propia pantalla de ARCO) y ahí seguía su nombre y su teléfono.
 *
 * Son las mismas columnas del PII más los nombres «humanos» con los que
 * algún renglón guarda lo mismo (`nombre`, `otrosCampos` no, porque ése es
 * una lista de nombres de campo y no de valores).
 *
 * ⚠️ `folio` NO está, a propósito: la anonimización lo conserva prefijado
 * porque es la llave con la que la escuela encuentra el expediente en
 * papel. Sacarlo de la bitácora y dejarlo en la ficha sería incoherente.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const EDU_ARCO_BITACORA_CLAVES: string[] = [
  ...Object.keys(EDU_ARCO_PII_FIELDS).filter((k) => k !== "searchIndex"),
  "nombre",
];

/**
 * Lo que se le escribe al perfil FISCAL del paciente al anonimizarlo.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL RFC ES UN IDENTIFICADOR PERSONAL Y NO HAY OBLIGACIÓN DE
 * CONSERVARLO. `EduPatientTaxProfile` guarda RFC, razón social, código
 * postal y correo de facturación, y la anonimización no lo tocaba: quedaba
 * el RFC —que identifica a una persona física de forma única— junto a un
 * expediente cuyo nombre acababa de sustituirse. Era incoherente con que
 * `insurancePolicy` SÍ se redacte, y con el argumento escrito para hacerlo
 * («un número de póliza es un identificador»).
 *
 * ⚠️ NO ES UN CFDI TIMBRADO. Los timbrados viven en `EduInvoice` y ésos sí
 * se conservan: son documentos fiscales emitidos, con su obligación propia.
 * Esto es la LIBRETA de a nombre de quién facturar la próxima vez.
 *
 * 🔴 SE SUSTITUYE, NO SE BORRA LA FILA. Las tres columnas son NOT NULL, y
 * una fila que desaparece deja al cobro de al lado sin poder explicar por
 * qué se facturó. `XAXX010101000` es el RFC genérico del SAT para «público
 * en general»: es exactamente lo que este receptor pasa a ser, y cabe en
 * los 13 caracteres de la columna (donde `[DATO CANCELADO]`, de 16, no).
 * ═══════════════════════════════════════════════════════════════════════
 */
export const EDU_ARCO_RFC_GENERICO = "XAXX010101000";

export const EDU_ARCO_TAX_FIELDS: Record<string, string | null> = {
  rfc: EDU_ARCO_RFC_GENERICO,
  legalName: EDU_ARCO_REDACTED,
  zipCode: "00000",
  email: null,
};

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL CÁLCULO
// ═══════════════════════════════════════════════════════════════════════

/** La forma mínima de la ficha que necesita la anonimización. */
export interface EduArcoPatientLike {
  folio: string;
  anonymizedAt?: Date | null;
}

/**
 * El `data` EXACTO que se le pasa al update de la anonimización.
 *
 * Devuelve un objeto plano y no toca la base: la prueba compara este
 * objeto campo a campo, que es la única forma de que "se me olvidó el
 * segundo teléfono" salga en rojo en vez de en producción.
 *
 * 🔴 EL FOLIO SE PREFIJA, NO SE BORRA. `ARCO-P-0042` sigue diciendo cuál
 * era el expediente; `[DATO CANCELADO]` en el folio dejaría a la escuela
 * sin poder localizar el papel que la norma le obliga a guardar. Y se
 * prefija UNA sola vez: correr esto dos veces no produce
 * `ARCO-ARCO-P-0042`.
 */
export function eduArcoAnonymizeData(
  patient: EduArcoPatientLike,
  actorUserId: string | null,
  now: Date,
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...EDU_ARCO_PII_FIELDS };
  data.folio = patient.folio.startsWith(EDU_ARCO_FOLIO_PREFIX)
    ? patient.folio
    : `${EDU_ARCO_FOLIO_PREFIX}${patient.folio}`.slice(0, 30);
  data.anonymizedAt = now;
  data.anonymizedById = actorUserId;
  return data;
}

/**
 * ¿Se puede anonimizar esta ficha? Devuelve el motivo por el que NO, o
 * null si sí.
 *
 * 🔴 SE EXIGE QUE ESTÉ DADA DE BAJA PRIMERO. La anonimización es
 * irreversible y la baja no: obligar a pasar por la baja convierte un
 * clic de más en la única red de seguridad que este acto tiene. Es la
 * misma razón por la que una receta se anula antes de archivarse.
 */
export function eduArcoMotivoParaNoAnonimizar(patient: {
  deletedAt?: Date | null;
  anonymizedAt?: Date | null;
  mergedIntoId?: string | null;
}): string | null {
  if (patient.anonymizedAt) {
    return "Esa ficha ya está anonimizada. La sustitución del PII es irreversible y no se repite.";
  }
  if (patient.mergedIntoId) {
    return "Esa ficha se fusionó con otra: sus datos viven en la ficha ganadora. Anonimiza la ganadora, no ésta.";
  }
  if (!patient.deletedAt) {
    return "Antes de anonimizar hay que dar de baja la ficha. La baja se deshace; la anonimización no.";
  }
  return null;
}

/** Tope del motivo de una baja ARCO. Igual que el `@db.VarChar(500)`. */
export const EDU_ARCO_REASON_MAX = 500;

/**
 * El motivo de la baja, validado.
 *
 * 🔴 OBLIGATORIO, al revés que el `deleteReason` de una nota. Dar de baja
 * a un paciente es un acto que alguien tiene que poder explicar dentro de
 * un año («solicitud ARCO del 12/03», «duplicado de P-0031»), y aquí no
 * aplica el argumento del "asdf": no es un borrador vacío, es una persona.
 */
export function eduArcoParseReason(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < 3) {
    throw new Error(
      "Escribe por qué se da de baja esta ficha. Queda en el expediente y es lo que contesta la pregunta dentro de un año.",
    );
  }
  return v.slice(0, EDU_ARCO_REASON_MAX);
}
