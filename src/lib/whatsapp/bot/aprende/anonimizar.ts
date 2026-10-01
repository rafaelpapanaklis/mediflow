/**
 * Privacidad del aprendizaje del bot (ws1-t11, LFPDPPP / NOM-024).
 *
 * Módulo PURO (sin prisma ni Node): lo usan el servidor antes de guardar una
 * sugerencia, una corrección o un ejemplo de tono, y los tests.
 *
 * Tres decisiones distintas, a propósito separadas:
 *  1. `anonimizar`        — quita datos personales del texto y deja un marcador
 *                           visible ([nombre], [teléfono]…). Nunca «adivina» un
 *                           reemplazo: el marcador obliga a la clínica a revisar.
 *  2. `motivoClinico`     — ¿el texto habla de la salud de ALGUIEN (síntomas,
 *                           medicamentos, padecimientos, indicaciones)? Eso
 *                           NUNCA se vuelve respuesta automática.
 *  3. `motivoPersonal`    — ¿la respuesta es sobre UN paciente (su cita, su
 *                           saldo)? Tampoco sirve como respuesta para todos.
 *
 * `evaluarPar` junta las tres para un par «pregunta → respuesta».
 */

export const MARCADORES = {
  nombre: "[nombre]",
  telefono: "[teléfono]",
  correo: "[correo]",
  fecha: "[fecha]",
  monto: "[monto]",
  numero: "[número]",
  enlace: "[enlace]",
  documento: "[documento]",
} as const;

const LISTA_MARCADORES = Object.values(MARCADORES);

/** ¿Al texto le queda algún marcador sin completar? (no se aprueba así) */
export function tieneMarcadores(texto: string): boolean {
  return LISTA_MARCADORES.some((m) => texto.includes(m));
}

export type OpcionesAnonimizar = {
  /** Nombres y apellidos conocidos del paciente del hilo (se quitan siempre). */
  nombres?: Array<string | null | undefined>;
  /**
   * Datos PÚBLICOS de la propia clínica que sí pueden quedarse (su teléfono,
   * su correo, su sitio): «llámanos al 55…» es una buena respuesta frecuente.
   */
  conservar?: Array<string | null | undefined>;
};

const MAYUS = "A-ZÁÉÍÓÚÑÜ";
const MINUS = "a-záéíóúñü";
const PALABRA_PROPIA = `[${MAYUS}][${MINUS}]+`;

/** Palabras con mayúscula que NO son un nombre de persona tras un saludo. */
const NO_SON_NOMBRE = new Set(
  [
    "doctor", "doctora", "dr", "dra", "equipo", "clinica", "clínica", "señor", "señora", "señorita",
    "sr", "sra", "srita", "buen", "buenos", "buenas", "dias", "días", "tardes", "noches", "gracias",
    "si", "sí", "no", "ok", "claro", "perfecto", "con", "de", "del", "la", "el", "los", "las", "que",
    "qué", "como", "cómo", "cuanto", "cuánto", "cuanta", "cuánta", "donde", "dónde", "quiero", "tengo",
    "me", "mi", "una", "un", "por", "para", "aqui", "aquí", "todos", "todas", "a", "en", "es",
    "nuevamente", "otra", "otro", "mucho", "muchas", "muchos", "disculpe", "disculpa", "oiga",
    "lunes", "martes", "miércoles", "miercoles", "jueves", "viernes", "sábado", "sabado", "domingo",
  ].map(normalizarPalabra),
);

function normalizarPalabra(p: string): string {
  return p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex que ignora mayúsculas SOLO en la frase fija («hola», «me llamo»). No se
 * usa la bandera `i` porque haría que `[A-Z]` del nombre casara con cualquier
 * palabra y «hola buenas tardes Ana» se tragaría «buenas tardes» como nombre.
 */
function ci(frase: string): string {
  return frase.replace(/\p{L}/gu, (c) => {
    const may = c.toUpperCase();
    const min = c.toLowerCase();
    return may === min ? c : `[${may}${min}]`;
  });
}

function soloDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

const MESES = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";

/**
 * Quita datos personales. Orden: primero lo que tiene forma fija (correo,
 * enlaces, documentos, fechas, teléfonos, montos personales) y al final los
 * nombres, para que un correo «juan.perez@…» no deje medio nombre suelto.
 */
export function anonimizar(texto: string, opciones: OpcionesAnonimizar = {}): string {
  if (!texto) return "";
  const conservar = (opciones.conservar ?? [])
    .map((c) => (c ?? "").trim())
    .filter((c) => c.length >= 4);
  const conservarDigitos = conservar.map(soloDigitos).filter((d) => d.length >= 7);
  const conservarTexto = conservar.map((c) => c.toLowerCase());
  const seConserva = (fragmento: string) => {
    const f = fragmento.toLowerCase();
    if (conservarTexto.some((c) => f.includes(c) || c.includes(f))) return true;
    const d = soloDigitos(fragmento);
    return d.length >= 7 && conservarDigitos.some((c) => c.endsWith(d.slice(-10)) || d.endsWith(c.slice(-10)));
  };

  let t = texto;

  // Correos.
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, (m) => (seConserva(m) ? m : MARCADORES.correo));

  // Enlaces (links de pago, de expediente, de Drive…). Los de la clínica se quedan.
  t = t.replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, (m) => (seConserva(m) ? m : MARCADORES.enlace));

  // CURP (18) y RFC de persona física (13): letras + fecha + homoclave.
  t = t.replace(/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/gi, MARCADORES.documento);
  t = t.replace(/\b[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}\b/gi, MARCADORES.documento);

  // Fechas completas: 12/03/1990, 12-03-90, 1990-03-12, «12 de marzo de 1990»,
  // «12 de marzo». Los días de la semana («abrimos de lunes a viernes») se quedan.
  t = t.replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, MARCADORES.fecha);
  t = t.replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, MARCADORES.fecha);
  t = t.replace(new RegExp(`\\b\\d{1,2}\\s+de\\s+(?:${MESES})(?:\\s+(?:de|del)\\s+\\d{4})?\\b`, "gi"), MARCADORES.fecha);
  t = t.replace(new RegExp(`\\b(?:${MESES})\\s+\\d{1,2},?\\s+\\d{4}\\b`, "gi"), MARCADORES.fecha);

  // Montos PERSONALES: los que van con «tu saldo», «debes», «pagaste»… Un
  // precio de lista («la limpieza cuesta $600») sí es una respuesta frecuente.
  const CONTEXTO_MONTO_PERSONAL =
    "(?:tu|su)\\s+(?:saldo|adeudo|deuda|cuenta|pago|abono|anticipo|factura|presupuesto)|debes|debe|adeuda|pagaste|pag[óo]|abonaste|abon[óo]|te\\s+falta|le\\s+falta|restan|quedan\\s+pendientes|pendiente\\s+de";
  t = t.replace(
    new RegExp(`((?:${CONTEXTO_MONTO_PERSONAL})[^.\\n$\\d]{0,30})\\$?\\s?\\d[\\d,.]*(?:\\s?(?:mxn|pesos))?`, "gi"),
    (_m, previo: string) => `${previo}${MARCADORES.monto}`,
  );

  // Teléfonos y números largos (tarjeta, CLABE, NSS, expediente). Se toleran
  // espacios, guiones, puntos y paréntesis entre los dígitos.
  t = t.replace(/(?:\+?\d[\d\s().-]{5,}\d)/g, (m) => {
    const d = soloDigitos(m);
    if (d.length < 7) return m;
    if (seConserva(m)) return m;
    return d.length >= 10 && d.length <= 13 ? MARCADORES.telefono : MARCADORES.numero;
  });

  // Nombres conocidos del paciente (palabra completa, sin importar acentos ni mayúsculas).
  const nombres = (opciones.nombres ?? [])
    .flatMap((n) => (n ?? "").split(/\s+/))
    .map((n) => n.trim())
    .filter((n) => n.length >= 3 && !NO_SON_NOMBRE.has(normalizarPalabra(n)));
  for (const n of nombres) {
    const variantes = new Set([n, n.normalize("NFD").replace(/[̀-ͯ]/g, "")]);
    for (const v of variantes) {
      t = t.replace(new RegExp(`(?<![\\p{L}])${escaparRegex(v)}(?![\\p{L}])`, "giu"), MARCADORES.nombre);
    }
  }

  // «me llamo X Y», «soy X», «mi nombre es X», «a nombre de X», «mi hijo X».
  t = t.replace(
    new RegExp(
      `(?<![\\p{L}])(${["me llamo", "mi nombre es", "soy", "a nombre de", "de parte de"].map(ci).join("|")}|${ci("mi")} (?:${["hijo", "hija", "esposo", "esposa", "mamá", "mama", "papá", "papa", "hermano", "hermana", "novio", "novia"].map(ci).join("|")}))\\s+(${PALABRA_PROPIA}(?:\\s+${PALABRA_PROPIA}){0,3})`,
      "gu",
    ),
    (m, previo: string, nombre: string) => {
      const primero = nombre.split(/\s+/)[0];
      // «soy paciente», «soy nuevo» — minúscula: no es nombre. Con la bandera
      // `i` la clase de mayúsculas casa con todo, así que se revisa aquí.
      if (primero[0] !== primero[0].toUpperCase() || NO_SON_NOMBRE.has(normalizarPalabra(primero))) return m;
      return `${previo} ${MARCADORES.nombre}`;
    },
  );

  // Tratamiento + nombre de paciente: «Sr. López», «Sra. Ana Ruiz». (Dr./Dra.
  // se quedan: el nombre del dentista de la clínica sí es información pública.)
  t = t.replace(
    new RegExp(`\\b(Sr\\.?|Sra\\.?|Srita\\.?|Señor|Señora|Señorita|Don|Doña)\\s+${PALABRA_PROPIA}(?:\\s+${PALABRA_PROPIA}){0,2}`, "gu"),
    (_m, trato: string) => `${trato} ${MARCADORES.nombre}`,
  );

  // Saludo + nombre: «Hola Juan», «Buenas tardes, María José», «Gracias Ana».
  t = t.replace(
    new RegExp(
      `(?<![\\p{L}])(${[
        "hola", "buenos días", "buenos dias", "buenas tardes", "buenas noches", "buen día", "buen dia",
        "muchas gracias", "gracias", "saludos", "qué tal", "que tal", "hasta luego", "claro", "con gusto",
      ].map(ci).join("|")})(,?\\s+)(${PALABRA_PROPIA}(?:\\s+${PALABRA_PROPIA}){0,2})`,
      "gu",
    ),
    (m, saludo: string, sep: string, nombre: string) => {
      const palabras = nombre.split(/\s+/);
      const primero = palabras[0];
      if (primero[0] !== primero[0].toUpperCase()) return m;
      if (NO_SON_NOMBRE.has(normalizarPalabra(primero))) return m;
      // Quita solo las palabras con mayúscula que no son de la lista blanca.
      let usadas = 0;
      for (const p of palabras) {
        if (p[0] !== p[0].toUpperCase() || NO_SON_NOMBRE.has(normalizarPalabra(p))) break;
        usadas++;
      }
      const resto = palabras.slice(usadas).join(" ");
      return `${saludo}${sep}${MARCADORES.nombre}${resto ? ` ${resto}` : ""}`;
    },
  );

  // Marcadores repetidos seguidos («[nombre] [nombre]») → uno.
  for (const m of LISTA_MARCADORES) {
    const rep = new RegExp(`${escaparRegex(m)}(?:\\s+${escaparRegex(m)})+`, "g");
    t = t.replace(rep, m);
  }
  return t.replace(/[ \t]{2,}/g, " ").trim();
}

// ── Contenido clínico ─────────────────────────────────────────────────────────

/**
 * Señales de que el texto trata la SALUD de una persona. Se busca sobre el
 * texto sin acentos y en minúsculas. Un tratamiento por su nombre («¿cuánto
 * cuesta una extracción?») NO es clínico: es catálogo. Lo clínico es el
 * síntoma, el medicamento, el padecimiento y la indicación.
 */
const SENALES_CLINICAS: Array<{ re: RegExp; motivo: string }> = [
  { re: /\b(me |le |te |nos )?(duele|dolio|dolor|doliendo|punzad|molesti)/, motivo: "síntomas" },
  { re: /\b(sangr|inflam|hinch|infecc|infectad|absces|pus\b|fiebre|calentura|sensibilidad|pulsa)/, motivo: "síntomas" },
  { re: /\bse me (cayo|rompio|movio|quebro|despego|safo|zafo)\b/, motivo: "síntomas" },
  {
    re: /\b(antibiotic|analgesic|antiinflamator|amoxicilina|ibuprofeno|paracetamol|ketorolaco|naproxeno|clindamicina|metronidazol|diclofenaco|nimesulida|dexametasona|clorhexidina|tramadol|aspirina)/,
    motivo: "medicamentos",
  },
  { re: /\b(medicamento|medicina|pastilla|tableta|capsula|jarabe|receta|dosis|recetar|automedic)/, motivo: "medicamentos" },
  { re: /\b\d+\s?(mg|ml)\b|\bcada \d+ (horas|hrs|h)\b/, motivo: "medicamentos" },
  {
    re: /\b(alergi|alergic|embaraz|lactan|diabet|hipertens|presion arterial|anticoagul|cancer|quimio|vih|hepatitis|epilep|cardiac|marcapasos|osteoporo|bifosfonat)/,
    motivo: "padecimientos",
  },
  { re: /\b(diagnostic|pronostic|tu radiografia|su radiografia|tus estudios|sus estudios|resultado de|resultados de)/, motivo: "diagnóstico" },
  { re: /\b(compresa|hielo en|no escup|enjuag|reposo|puntos de sutura|sutura|postoperatori|despues de la (extraccion|cirugia))/, motivo: "indicaciones" },
];

function sinAcentos(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Motivo («síntomas», «medicamentos»…) si el texto es clínico; null si no. */
export function motivoClinico(texto: string): string | null {
  const t = sinAcentos(texto ?? "");
  for (const s of SENALES_CLINICAS) if (s.re.test(t)) return s.motivo;
  return null;
}

// ── Respuesta personal (sobre UN paciente) ───────────────────────────────────

const SENALES_PERSONALES: RegExp[] = [
  /\b(tu|su) (cita|saldo|adeudo|deuda|cuenta|pago|abono|anticipo|factura|presupuesto|tratamiento|expediente|caso|control|receta|orden)\b/,
  /\b(te|le) (agende|agendamos|reagende|reagendamos|cancele|cancelamos|confirmo|confirmamos|registre|registramos|aparte|apartamos|cambie|cambiamos|mando|mandamos|envio|enviamos)\b/,
  /\b(te|le) (esperamos|espero) (el|este|ma(n|ñ)ana|hoy|a las)\b/,
  /\b(debes|adeudas|pagaste|abonaste|te falta|le falta)\b/,
  /\bya (quedo|qued(o|ó) agendad|esta agendad|quedo registrad)/,
];

/** «personal» si la respuesta trata del caso de un paciente; null si no. */
export function motivoPersonal(texto: string): string | null {
  const t = sinAcentos(texto ?? "");
  return SENALES_PERSONALES.some((re) => re.test(t)) ? "personal" : null;
}

// ── Par pregunta → respuesta ──────────────────────────────────────────────────

/** Por debajo de esto una respuesta («ok», «sí, claro») no enseña nada. */
export const RESPUESTA_MIN_CARACTERES = 15;
export const PREGUNTA_MIN_CARACTERES = 6;
/** Una FAQ larga es una conversación, no una respuesta frecuente. */
export const TEXTO_MAX_CARACTERES = 1000;

export type MotivoNoApto = "clinico" | "personal" | "corta" | "larga";

export type EvaluacionPar =
  | { apto: true; pregunta: string; respuesta: string }
  | { apto: false; motivo: MotivoNoApto; detalle: string | null };

/**
 * Decide si un par puede sugerirse y, si puede, lo devuelve anonimizado.
 * Lo clínico se mira ANTES de anonimizar (y en las dos mitades): el
 * anonimizado no debe esconder la señal.
 */
export function evaluarPar(
  preguntaCruda: string,
  respuestaCruda: string,
  opciones: OpcionesAnonimizar = {},
): EvaluacionPar {
  const clinico = motivoClinico(preguntaCruda) ?? motivoClinico(respuestaCruda);
  if (clinico) return { apto: false, motivo: "clinico", detalle: clinico };
  if (motivoPersonal(respuestaCruda)) return { apto: false, motivo: "personal", detalle: null };
  const pregunta = anonimizar(preguntaCruda, opciones);
  const respuesta = anonimizar(respuestaCruda, opciones);
  if (respuesta.length < RESPUESTA_MIN_CARACTERES || pregunta.length < PREGUNTA_MIN_CARACTERES) {
    return { apto: false, motivo: "corta", detalle: null };
  }
  if (respuesta.length > TEXTO_MAX_CARACTERES || pregunta.length > TEXTO_MAX_CARACTERES) {
    return { apto: false, motivo: "larga", detalle: null };
  }
  return { apto: true, pregunta, respuesta };
}

export const ETIQUETA_NO_APTO: Record<MotivoNoApto, string> = {
  clinico: "Habla de la salud de un paciente: el bot nunca contesta eso solo",
  personal: "Es sobre el caso de un paciente (su cita, su saldo…)",
  corta: "Demasiado corta para enseñar algo",
  larga: "Demasiado larga para una respuesta frecuente",
};

/**
 * ¿Qué le falta a este texto para volverse respuesta frecuente? null = nada.
 * Lo escribe o revisa una persona del equipo, así que NO se re-anonimiza
 * (borraría el teléfono de la clínica que acaba de escribir); pero lo clínico
 * y los marcadores sin completar no pasan. Lo usan el servidor y la pantalla.
 */
export function problemaDeTextoDeFaq(pregunta: string, respuesta: string): { code: string; mensaje: string } | null {
  const p = (pregunta ?? "").trim();
  const r = (respuesta ?? "").trim();
  if (!p || !r) return { code: "faltan_textos", mensaje: "Escribe la pregunta y la respuesta." };
  if (p.length > TEXTO_MAX_CARACTERES || r.length > TEXTO_MAX_CARACTERES) {
    return { code: "muy_largo", mensaje: `Máximo ${TEXTO_MAX_CARACTERES} caracteres por campo.` };
  }
  if (tieneMarcadores(p) || tieneMarcadores(r)) {
    return {
      code: "marcadores",
      mensaje: "Completa o quita lo que está entre corchetes ([nombre], [teléfono]…) antes de guardar.",
    };
  }
  const clinico = motivoClinico(p) ?? motivoClinico(r);
  if (clinico) {
    return {
      code: "clinico",
      mensaje: `Esto habla de la salud de un paciente (${clinico}): el bot no debe contestarlo solo. Que lo atienda una persona.`,
    };
  }
  return null;
}
