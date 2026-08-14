// ─────────────────────────────────────────────────────────────────────────────
// Generador de la CARTA DE CONSENTIMIENTO INFORMADO.
//
// Una sola redacción para todo el producto: la usa el modal de alta (cliente,
// para que el doctor pueda editarla antes de crear) y POST /api/consent
// (servidor, que guarda el texto como snapshot inmutable). Antes había DOS
// textos distintos —cinco plantillas cortas embebidas en el route y el catálogo
// rico de `herramientas/consent-procedures`— y el paciente firmaba el pobre.
//
// ESTRUCTURA: sigue el orden y el contenido que pide la NOM-004-SSA3-2012
// numeral 10.1.1 (nombre de la institución, lugar y fecha, nombre y firma del
// paciente o su representante legal, nombre y firma del médico, nombre y firma
// de los testigos, y el acto autorizado con sus riesgos y beneficios) y la
// NOM-013-SSA2-2015 numeral 9.6.9 para la consulta estomatológica. Se añaden,
// porque son lo que de verdad protege al paciente y a la clínica: alternativas,
// curso esperado SIN tratamiento, autorización para atender contingencias y la
// cláusula de revocabilidad.
//
// PRUDENCIA: el contenido clínico sale de CONSENT_PROCEDURES, que a propósito
// describe riesgos frecuentes y ampliamente documentados, no una lista
// exhaustiva. Es una BASE que el estomatólogo revisa y completa para el caso
// concreto — por eso el modal la deja editar antes de guardarla.
//
// PURO: sin Prisma, sin React y sin red. Lo importan el cliente y el servidor.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CONSENT_PROCEDURES,
  type ConsentProcedure,
} from "@/lib/herramientas/consent-procedures";

/** Clave de la carta genérica de atención odontológica. */
export const GENERAL_CONSENT_KEY = "atencion-general";

/**
 * Carta general: la que se usa cuando el acto no es uno de los nueve
 * procedimientos del catálogo (revisión, diagnóstico, radiografías, limpieza,
 * anestesia local…). Vive aquí y no en el catálogo de herramientas porque esa
 * página pública lista procedimientos concretos, no la atención de rutina.
 */
const GENERAL_PROCEDURE: ConsentProcedure = {
  key: GENERAL_CONSENT_KEY,
  label: "Atención odontológica general",
  description:
    "La atención odontológica general incluye la revisión de tu boca, el diagnóstico, la toma de radiografías cuando hacen falta, la limpieza dental y los tratamientos de rutina que se acuerden contigo en la consulta. Cuando el tratamiento lo requiere se aplica anestesia local.",
  risks: [
    "Molestia o sensibilidad de dientes y encías durante o después de la consulta.",
    "Sangrado leve de las encías durante la limpieza, sobre todo si están inflamadas.",
    "Molestia pasajera por la anestesia local: adormecimiento de labio o lengua durante algunas horas y, con menor frecuencia, moretón en el sitio del piquete.",
    "Reacción alérgica a los materiales o medicamentos empleados, poco frecuente pero posible.",
    "Que durante la revisión se encuentren problemas que no se veían al principio y que requieran un tratamiento adicional, que se te explicará antes de realizarlo.",
  ],
  alternatives: [
    "Realizar solo una parte de lo propuesto y posponer el resto.",
    "Solicitar una segunda opinión antes de decidir.",
  ],
  care: [
    "Informar al personal de tus enfermedades, alergias y de todos los medicamentos que tomas, incluidos los naturistas.",
    "Mantener la higiene diaria y acudir a las revisiones en el intervalo que te indiquen.",
    "Avisar al consultorio si aparece dolor, inflamación o cualquier molestia que no cede.",
  ],
};

/** Objetivo del acto, en lenguaje sencillo. Complementa la descripción. */
const OBJECTIVES: Record<string, string> = {
  "extraccion-simple":
    "retirar un diente que ya no es posible conservar, para eliminar el dolor o la infección y evitar que el problema dañe los tejidos y los dientes vecinos",
  "extraccion-tercer-molar":
    "retirar la muela del juicio para resolver o prevenir el dolor, la infección y el daño a los dientes vecinos",
  endodoncia:
    "eliminar la infección del interior del diente y conservarlo en la boca en lugar de extraerlo",
  resina:
    "eliminar la caries y devolverle al diente su forma, su función y su aspecto",
  corona:
    "proteger y reconstruir un diente muy debilitado para que puedas volver a masticar con él",
  implante:
    "sustituir la raíz de un diente perdido para poder colocar sobre ella una corona o una prótesis fija",
  "limpieza-profunda":
    "detener la enfermedad de las encías y conservar el hueso que sostiene tus dientes",
  ortodoncia:
    "corregir la posición de los dientes y la forma en que muerdes",
  blanqueamiento:
    "aclarar el color de tus dientes",
  [GENERAL_CONSENT_KEY]:
    "conservar tu salud bucal, atender a tiempo lo que se detecte en la revisión y explicarte con claridad lo que encontramos",
};

/** Beneficio esperado. Se redacta sin prometer resultados. */
const BENEFITS: Record<string, string> = {
  "extraccion-simple":
    "Se espera que el dolor y la infección cedan y que la zona cicatrice en los días siguientes.",
  "extraccion-tercer-molar":
    "Se espera resolver las molestias que causa la muela y evitar el daño que puede provocar a los dientes vecinos.",
  endodoncia:
    "Se espera conservar el diente y que deje de doler, evitando la extracción.",
  resina:
    "Se espera detener la caries, recuperar la forma del diente y poder masticar sin molestia.",
  corona:
    "Se espera proteger el diente frente a una fractura y devolverle su función y su aspecto.",
  implante:
    "Se espera recuperar la función y la estética de la zona sin desgastar los dientes vecinos.",
  "limpieza-profunda":
    "Se espera que la inflamación y el sangrado de las encías disminuyan y que la pérdida de soporte se detenga.",
  ortodoncia:
    "Se espera mejorar la posición de los dientes, la mordida y la facilidad para limpiarlos.",
  blanqueamiento:
    "Se espera un aclaramiento del color de los dientes, variable en cada persona.",
  [GENERAL_CONSENT_KEY]:
    "Se espera detectar a tiempo los problemas de tu boca y tratarlos cuando todavía son sencillos de resolver.",
};

/**
 * Qué se espera si NO se hace nada (curso espontáneo). Deliberadamente en
 * términos generales: el pronóstico concreto lo pone el estomatólogo tratante al
 * editar la carta, no una plantilla.
 */
const NO_TREATMENT =
  "Si decido no realizar el tratamiento propuesto, el problema que lo motiva seguirá su curso natural. Se me ha explicado que eso puede significar más dolor, avance de la infección o de la caries, daño a los dientes y tejidos vecinos, y que el tratamiento que hoy es posible puede volverse más largo, más complejo o más costoso, o dejar de ser una opción.";

/** Un procedimiento del selector del modal (catálogo + carta general). */
export interface ConsentTemplateOption {
  key: string;
  label: string;
}

/** Todos los procedimientos que ofrece el módulo, en el orden del selector. */
export const CONSENT_TEMPLATES: ConsentProcedure[] = [
  ...CONSENT_PROCEDURES,
  GENERAL_PROCEDURE,
];

/** Opciones para el `<select>` del modal de alta. */
export function listConsentTemplates(): ConsentTemplateOption[] {
  return CONSENT_TEMPLATES.map((p) => ({ key: p.key, label: p.label }));
}

/** Procedimiento por clave. `null` cuando la clave no existe (texto libre). */
export function findConsentTemplate(key: string | null | undefined): ConsentProcedure | null {
  if (!key) return null;
  return CONSENT_TEMPLATES.find((p) => p.key === key) ?? null;
}

/** Datos con los que se personaliza la carta. Todo opcional salvo el paciente. */
export interface ConsentTemplateVars {
  clinicName: string;
  clinicAddress?: string | null;
  clinicCity?: string | null;
  patientName: string;
  /**
   * Edad en AÑOS CUMPLIDOS al momento de generar la carta. La pide la práctica
   * mexicana (y el expediente de la NOM-004) porque cambia lo que se autoriza:
   * un menor no consiente por sí mismo y la dosis y el riesgo se leen distinto.
   * Si no hay fecha de nacimiento capturada, la línea sale en blanco para
   * llenarla a mano — nunca desaparece.
   */
  patientAge?: number | null;
  /** Número de expediente del paciente (`Patient.patientNumber`). */
  patientNumber?: string | null;
  /** Estomatólogo responsable del acto. */
  doctorName?: string | null;
  /** Cédula profesional del estomatólogo (NOM-004 10.1.1.4). */
  doctorLicense?: string | null;
  /** Representante legal que firma en nombre del paciente, si aplica. */
  signerName?: string | null;
  signerRelation?: string | null;
  /** Ciudad donde se firma. Por defecto, la de la clínica. */
  place?: string | null;
  /** Fecha ya formateada. Por defecto, la de hoy en es-MX. */
  date?: string | null;
}

/**
 * Hueco para llenar a mano. Se usa en los datos que puede que la clínica no
 * tenga capturados (edad, expediente): una carta impresa con "Edad: undefined"
 * —o sin la línea— es una carta que no sirve; una con la raya se completa con
 * un bolígrafo delante del paciente.
 */
const BLANK = "______";

/** Edad en años cumplidos → "34 años". Sin dato, hueco para llenar. */
function ageLabel(age: number | null | undefined): string {
  if (age == null || !Number.isFinite(age) || age < 0) return BLANK;
  const years = Math.floor(age);
  return `${years} ${years === 1 ? "año" : "años"}`;
}

/** Marcadores admitidos dentro de un texto de consentimiento. */
function tokenMap(vars: ConsentTemplateVars): Record<string, string> {
  return {
    NOMBRE_PACIENTE: vars.patientName || "—",
    EDAD_PACIENTE: ageLabel(vars.patientAge),
    EXPEDIENTE_PACIENTE: (vars.patientNumber ?? "").trim() || BLANK,
    NOMBRE_DOCTOR: (vars.doctorName ?? "").trim() || "—",
    NOMBRE_CLINICA: vars.clinicName || "—",
    CEDULA_DOCTOR: (vars.doctorLicense ?? "").trim() || "—",
    NOMBRE_REPRESENTANTE: (vars.signerName ?? "").trim() || "—",
    PARENTESCO_REPRESENTANTE: (vars.signerRelation ?? "").trim() || "—",
    LUGAR: (vars.place ?? vars.clinicCity ?? "").trim() || "—",
    FECHA: (vars.date ?? "").trim() || todayEsMx(),
  };
}

/**
 * Sustituye los marcadores `[NOMBRE_PACIENTE]`, `[NOMBRE_DOCTOR]`… en un texto.
 *
 * Reemplazo GLOBAL: el generador anterior usaba `String.replace` con una cadena,
 * que en JavaScript cambia SOLO la primera aparición — una carta que nombraba al
 * paciente dos veces salía con `[NOMBRE_PACIENTE]` crudo en la segunda.
 */
export function interpolateConsent(text: string, vars: ConsentTemplateVars): string {
  const tokens = tokenMap(vars);
  return (text ?? "").replace(/\[([A-Z_]+)\]/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match,
  );
}

function todayEsMx(): string {
  return new Date().toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function bullets(items: string[]): string {
  return items.map((i) => `• ${i}`).join("\n");
}

/**
 * Arma la carta completa de un procedimiento.
 *
 * El resultado es texto plano con saltos de línea: se guarda tal cual en
 * `ConsentForm.content`, se pinta con `white-space: pre-wrap` en la página
 * pública y se imprime igual en el PDF. Nada de HTML — el mismo texto tiene que
 * verse idéntico en la pantalla del paciente y en el papel.
 */
export function buildConsentContent(
  procedureKey: string,
  vars: ConsentTemplateVars,
): string {
  const proc = findConsentTemplate(procedureKey) ?? GENERAL_PROCEDURE;
  const isMinorRepresented = Boolean((vars.signerName ?? "").trim());

  const clinicLine = [vars.clinicName, vars.clinicAddress, vars.clinicCity]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");

  const doctorLine = vars.doctorLicense
    ? "Nombre: [NOMBRE_DOCTOR]\nCédula profesional: [CEDULA_DOCTOR]"
    : "Nombre: [NOMBRE_DOCTOR]";

  // Edad y expediente van SIEMPRE, tengan dato o no: son la identificación
  // mínima del paciente en el expediente clínico (NOM-004 numeral 5.11) y lo
  // primero que se busca cuando la carta se archiva en papel.
  const patientIdBlock =
    "Nombre del paciente: [NOMBRE_PACIENTE]\n" +
    "Edad: [EDAD_PACIENTE]\n" +
    "Número de expediente: [EXPEDIENTE_PACIENTE]";

  const patientBlock = isMinorRepresented
    ? patientIdBlock +
      "\nRepresentante legal que firma en su nombre: [NOMBRE_REPRESENTANTE]\n" +
      "Parentesco o relación con el paciente: [PARENTESCO_REPRESENTANTE]"
    : patientIdBlock;

  const objective = OBJECTIVES[proc.key] ?? OBJECTIVES[GENERAL_CONSENT_KEY];
  const benefit = BENEFITS[proc.key] ?? BENEFITS[GENERAL_CONSENT_KEY];

  // "No realizar ningún tratamiento" es una alternativa que SIEMPRE existe y que
  // la norma obliga a plantear; el catálogo la deja fuera a propósito para que se
  // agregue aquí una sola vez.
  const alternatives = [
    ...proc.alternatives,
    "No realizar ningún tratamiento, con las consecuencias que se describen en el punto siguiente.",
  ];

  // Con representante legal firma ÉL, no el paciente (que por definición es
  // quien no puede hacerlo). El bloque de firmas del PDF sigue el mismo
  // criterio: una sola línea, rotulada "Representante legal".
  const who = isMinorRepresented
    ? "el representante legal del paciente"
    : "el paciente";

  const raw = `CARTA DE CONSENTIMIENTO INFORMADO

Establecimiento: ${clinicLine || "[NOMBRE_CLINICA]"}
Lugar y fecha: [LUGAR], a [FECHA]

1. DATOS DEL PACIENTE
${patientBlock}

2. ESTOMATÓLOGO RESPONSABLE
${doctorLine}

3. ACTO QUE SE AUTORIZA
Procedimiento: ${proc.label}
${proc.description}
El objetivo del tratamiento es ${objective}.

4. RIESGOS Y MOLESTIAS QUE PUEDEN PRESENTARSE
Se me explicó que ningún tratamiento está libre de riesgos y que, aun realizándolo correctamente, pueden presentarse:
${bullets(proc.risks)}
También se me informó que pueden aparecer complicaciones poco frecuentes que no es posible enumerar por completo, y que serán atendidas si ocurren.

5. BENEFICIOS QUE SE ESPERAN
${benefit} Se me explicó que ningún resultado puede garantizarse, porque depende de mi situación clínica y de los cuidados que yo mantenga.

6. ALTERNATIVAS QUE SE ME OFRECIERON
${bullets(alternatives)}

7. QUÉ PUEDE PASAR SI NO ME TRATO
${NO_TREATMENT}

8. LO QUE SE ESPERA DE TU PARTE
Para que el resultado sea el previsto, se te pide:
${bullets(proc.care)}

9. ATENCIÓN DE CONTINGENCIAS Y URGENCIAS
Autorizo al estomatólogo y al personal del establecimiento a realizar, durante este procedimiento, las medidas necesarias para atender las contingencias y urgencias que se deriven del acto autorizado, cuando esperar a consultarme ponga en riesgo mi salud. Toda medida distinta al procedimiento aquí descrito se me explicará y se recabará mi autorización antes de realizarla, salvo esa situación de urgencia.

10. REVOCACIÓN
Se me informó que puedo revocar este consentimiento en cualquier momento mientras el procedimiento no haya iniciado, sin necesidad de justificarlo y sin que ello afecte la calidad de la atención que recibo. La revocación se hace por escrito y queda registrada en mi expediente.

11. DECLARACIÓN
Declaro que la información que proporcioné sobre mi estado de salud, mis alergias y los medicamentos que tomo es verídica y completa. Declaro también que esta carta se me explicó en lenguaje sencillo, que pude hacer todas las preguntas que quise, que se resolvieron mis dudas y que acepto de forma libre y voluntaria el procedimiento descrito.

12. FIRMAS
Firman ${who}, el estomatólogo responsable y, cuando están presentes, los testigos del acto. Se entrega copia de este documento al paciente y una copia se conserva en su expediente clínico conforme al contenido de la NOM-004-SSA3-2012 y la NOM-013-SSA2-2015.`;

  return interpolateConsent(raw, vars);
}
