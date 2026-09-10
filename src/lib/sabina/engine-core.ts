/**
 * Sabina — las reglas PURAS del motor.
 *
 * Aquí no hay red, ni prisma, ni `server-only`: todo lo que decide algo
 * (qué modelo, si un argumento del modelo es válido, cómo se dice que falta un
 * permiso, qué se registra) vive aquí para que se pueda probar sin base y sin
 * gastar un peso en Anthropic. El bucle con la red está en `engine.ts`.
 *
 * El criterio del bucle está copiado de `src/lib/barber/bot.ts`, que ya hace
 * exactamente esto en producción: tope de rondas, presupuesto de tiempo por
 * turno y última vuelta sin herramientas. Ver el reporte para las tres
 * diferencias y por qué.
 */
import { ALL_PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type {
  SabinaDificultad,
  SabinaRastro,
  SabinaResultado,
  SabinaResultadoFallo,
  SabinaResultadoOk,
  SabinaTool,
} from "./engine-types";

/* ═══════════════════════════════════════════════════════════════════════
   TOPES — el bolsillo de la clínica y la paciencia del doctor
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Cuántas veces puede el modelo pedir herramientas antes de tener que
 * contestar. Cuatro es lo que usan `barber/bot.ts` y `realty/bot`, y aquí sirve
 * el mismo número por la misma razón: `resumen_clinica` (la más golosa del
 * catálogo) necesita una ronda para ella sola, una pregunta abierta encadena
 * dos o tres (ocupación → ausencias → ingresos) y a partir de la cuarta el
 * modelo ya no descubre nada nuevo, solo gasta. En la ÚLTIMA vuelta el motor
 * retira las herramientas: el modelo tiene que cerrar con palabras, no pedir
 * otra consulta que ya no cabe.
 */
export const SABINA_MAX_TOOL_ROUNDS = 4;

/**
 * Todo el turno vive dentro de este presupuesto. «Un doctor no espera treinta
 * segundos»: a los 20 s se corta y se contesta con lo que haya.
 */
export const SABINA_TURN_BUDGET_MS = 20_000;

/** Cada llamada al modelo, acotada aparte (AbortSignal). */
export const SABINA_CALL_TIMEOUT_MS = 12_000;

/** Techo de salida por llamada. Una respuesta de panel no es un ensayo. */
export const SABINA_MAX_OUTPUT_TOKENS = 1_200;

/** La pregunta que entra por el endpoint. Más que esto no es una pregunta. */
export const SABINA_MAX_PREGUNTA_CHARS = 2_000;

/* ═══════════════════════════════════════════════════════════════════════
   QUÉ MODELO — la diferencia entre 40 y 400 pesos al mes
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * El barato. Es el default del contrato y el que contesta la inmensa mayoría
 * de las preguntas de mostrador («¿cuántas citas tengo hoy?»), que son un dato
 * exacto que ya viene masticado en el `resumen` de la herramienta.
 */
export const SABINA_MODELO_DIRECTA = "claude-haiku-4-5";

/**
 * El caro, solo para lo que razona. `claude-sonnet-4-6` es el que ya usan el
 * bot de barbería, `/api/consult/ai-assist` y `integrations/claude`: se
 * mantiene el criterio de la casa en vez de estrenar un modelo aquí. Se cambia
 * por env sin redeploy, igual que el del bot de barbería.
 */
export const SABINA_MODELO_ABIERTA = "claude-sonnet-4-6";

/** El modelo de cada dificultad, con escape por env (sin redeploy). */
export function modeloPara(dificultad: SabinaDificultad): string {
  if (dificultad === "abierta") {
    return process.env.SABINA_MODELO_ABIERTA || SABINA_MODELO_ABIERTA;
  }
  return process.env.SABINA_MODELO_DIRECTA || SABINA_MODELO_DIRECTA;
}

/**
 * Señales de pregunta ABIERTA. Todas piden razonar sobre varias cosas a la vez
 * o pedir consejo; ninguna se contesta con una cifra.
 *
 * Van sin acentos y se comparan contra el texto ya normalizado (ver
 * `normalizar`), así que «por qué», «porque» y «PORQUÉ» entran por la misma
 * puerta y no hace falta duplicar cada entrada con y sin tilde.
 */
const SENALES_ABIERTA: readonly string[] = [
  "por que", "porque", "a que se debe", "a que se debio",
  "que hago", "que puedo hacer", "que me conviene", "me conviene",
  "como puedo", "como le hago", "como hago", "como expando", "como mejoro",
  "como aumento", "como subo", "como bajo", "como consigo", "como logro",
  "deberia", "convendria", "recomienda", "recomiendame", "recomendacion",
  "sugiere", "sugerencia", "aconseja", "consejo",
  "estrategia", "plan para", "plan de", "propon", "propuesta",
  "expandir", "crecer", "crecimiento", "mejorar", "optimiz", "rentab",
  "analiza", "analisis", "evalua", "diagnostica",
  "compara", "comparacion", "versus",
  "tendencia", "evolucion", "oportunidad", "riesgo",
  "bajaron", "bajo mucho", "cayeron", "cayo", "subieron", "aumentaron",
  "que opinas", "que piensas", "vale la pena", "tiene sentido",
];

/** Una pregunta larga rara vez es una consulta de dato. */
const PALABRAS_ABIERTA = 25;

/**
 * Quita acentos, baja a minúsculas y colapsa espacios. Es lo que permite que
 * `SENALES_ABIERTA` viva sin tildes.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Directa o abierta.
 *
 * 🔴 EL DEFAULT ES «DIRECTA», Y ESO ES LA REGLA, NO UN DESCUIDO. Solo sube a
 * `abierta` si SALTA una señal; ante la duda contesta el barato, porque subir
 * en una segunda pasada (ver `debeEscalar`) cuesta una pregunta, y bajar no se
 * puede: lo caro ya se gastó en TODAS. Con Haiku a 1/5 del precio de entrada
 * de Sonnet, equivocarse hacia abajo cuesta una pasada extra; equivocarse
 * hacia arriba cuesta cinco veces en cada pregunta del mes.
 */
export function clasificarDificultad(pregunta: string): SabinaDificultad {
  const texto = normalizar(pregunta ?? "");
  if (!texto) return "directa";

  if (SENALES_ABIERTA.some((s) => texto.includes(s))) return "abierta";

  // Dos preguntas en un mensaje ya no es un dato, es un cruce.
  const interrogaciones = (texto.match(/\?/g) ?? []).length;
  if (interrogaciones >= 2) return "abierta";

  if (texto.split(" ").filter(Boolean).length > PALABRAS_ABIERTA) return "abierta";

  return "directa";
}

/**
 * La segunda pasada. Se sube a lo caro SOLO si la barata se quedó sin
 * contestar: o agotó las rondas sin cerrar, o volvió con datos y sin texto.
 * Si ya contestó, no se escala aunque la pregunta pareciera difícil — el
 * dinero ya se ahorró.
 *
 * No se escala nunca dos veces: `yaEscalado` corta.
 */
export function debeEscalar(estado: {
  dificultad: SabinaDificultad;
  yaEscalado: boolean;
  respuesta: string | null;
  rondasAgotadas: boolean;
  huboHerramientas: boolean;
}): boolean {
  if (estado.yaEscalado) return false;
  if (estado.dificultad === "abierta") return false; // ya iba con el caro
  if (estado.respuesta && estado.respuesta.trim().length > 0) return false;
  return estado.rondasAgotadas || estado.huboHerramientas;
}

/* ═══════════════════════════════════════════════════════════════════════
   LO QUE EL MODELO PIDE — nunca se ejecuta a ciegas
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Claves que el modelo NO puede mandar, pase lo que pase. El `clinicId` sale de
 * la sesión y lo pone el motor en el `ctx`; si viajara dentro de un argumento,
 * una clínica podría leer a otra. Se BORRAN antes de validar, no se rechaza la
 * llamada: el modelo a veces las añade por imitación del esquema y castigar eso
 * con un error solo le hace repetir la ronda (y gastar).
 */
const CLAVES_PROHIBIDAS = new Set([
  "clinicid", "clinic_id", "clinica_id", "clinicaid",
  "userid", "user_id", "usuario_id", "usuarioid",
  "tenantid", "tenant_id",
]);

/** Devuelve los argumentos sin las claves prohibidas, y cuáles se quitaron. */
export function sanearArgumentos(input: unknown): {
  limpio: Record<string, unknown>;
  retirados: string[];
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { limpio: {}, retirados: [] };
  }
  const limpio: Record<string, unknown> = {};
  const retirados: string[] = [];
  for (const [clave, valor] of Object.entries(input as Record<string, unknown>)) {
    if (CLAVES_PROHIBIDAS.has(clave.toLowerCase())) {
      retirados.push(clave);
      continue;
    }
    limpio[clave] = valor;
  }
  return { limpio, retirados };
}

/** Qué pasó al intentar preparar una llamada del modelo. */
export type ValidacionOk<P = any> = {
  ok: true;
  tool: SabinaTool<P>;
  params: P;
  retirados: string[];
};

/** Las dos formas de rechazo. Un nombre para poder estrechar por `motivo`. */
export type ValidacionFallo = {
  ok: false;
  motivo: "desconocida" | "parametros";
  detalle: string;
};

export type ValidacionLlamada<P = any> = ValidacionOk<P> | ValidacionFallo;

/**
 * Valida lo que pidió el modelo ANTES de tocar la base.
 *
 * Dos fallos posibles y los dos vuelven al modelo como texto, no como
 * excepción: una herramienta inventada («consultar_expediente_completo») y unos
 * parámetros que no cuadran con el zod. En ninguno de los dos casos se ejecuta
 * nada.
 */
export function validarLlamada(
  tools: readonly SabinaTool<any, any>[],
  nombre: string,
  input: unknown,
): ValidacionLlamada<any> {
  const tool = tools.find((t) => t.nombre === nombre);
  if (!tool) {
    const disponibles = tools.map((t) => t.nombre).join(", ");
    return {
      ok: false,
      motivo: "desconocida",
      detalle: `No existe la herramienta «${nombre}». Las que hay: ${disponibles || "ninguna"}.`,
    };
  }

  const { limpio, retirados } = sanearArgumentos(input);
  const parsed = tool.parametros.safeParse(limpio);
  if (!parsed.success) {
    const problemas = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      motivo: "parametros",
      detalle: `Parámetros inválidos para «${nombre}»: ${problemas}`,
    };
  }

  return { ok: true, tool, params: parsed.data, retirados };
}

/* ═══════════════════════════════════════════════════════════════════════
   SIN PERMISO — la regla 3, que es la que vuelve falsas las respuestas
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * El área en lenguaje de mostrador, para la frase que lee el doctor. Se saca
 * del prefijo de la key; si no está en el mapa se cae a la descripción del
 * catálogo (`ALL_PERMISSIONS`), que ya está escrita en español y se mantiene
 * sola cuando alguien añade un permiso.
 */
const AREA_POR_PREFIJO: Record<string, string> = {
  agenda: "la agenda",
  billing: "facturación",
  patients: "los pacientes",
  medicalRecord: "el expediente clínico",
  prescription: "las recetas",
  reports: "los reportes",
  inventory: "el inventario",
  team: "el equipo",
};

/** Nombre legible del área que protege un permiso. */
export function areaDePermiso(permiso: string): string {
  const prefijo = (permiso || "").split(".")[0];
  if (Object.prototype.hasOwnProperty.call(AREA_POR_PREFIJO, prefijo)) {
    return AREA_POR_PREFIJO[prefijo];
  }
  if (Object.prototype.hasOwnProperty.call(ALL_PERMISSIONS, permiso)) {
    return `«${ALL_PERMISSIONS[permiso as PermissionKey]}»`;
  }
  return `«${permiso}»`;
}

/**
 * La frase explícita del contrato:
 *   ❌ «No tengo datos de facturación»  → suena a que la clínica no facturó.
 *   ✅ «No tienes acceso a facturación, eso no te lo puedo contestar.»
 */
export function fraseSinPermiso(permiso: string): string {
  return `No tienes acceso a ${areaDePermiso(permiso)}, eso no te lo puedo contestar.`;
}

/**
 * Red de seguridad DETERMINISTA de la regla 3.
 *
 * El prompt del sistema ya se lo ordena al modelo, pero un prompt es una
 * súplica, no una garantía: si el modelo se come el aviso, la respuesta queda
 * falsa sin haber mentido en ninguna frase, que es justo el fallo que el
 * contrato llama «peor en una pregunta abierta». Así que si faltó un permiso y
 * la respuesta no lo dice, el aviso se añade aquí, en código.
 *
 * La detección es a propósito conservadora: basta con que la respuesta ya
 * mencione el área Y hable de acceso/permiso para darla por avisada.
 */
export function garantizarAvisoSinPermiso(
  respuesta: string,
  permisos: readonly string[],
): string {
  if (permisos.length === 0) return respuesta;

  const texto = normalizar(respuesta);
  const habla_de_acceso =
    texto.includes("no tienes acceso") ||
    texto.includes("no tengo permiso") ||
    texto.includes("sin permiso") ||
    texto.includes("no tienes permiso");

  const faltantes = Array.from(new Set(permisos)).filter((p) => {
    if (!habla_de_acceso) return true;
    return !texto.includes(normalizar(areaDePermiso(p)));
  });
  if (faltantes.length === 0) return respuesta;

  const avisos = faltantes.map((p) => fraseSinPermiso(p)).join(" ");
  const base = respuesta.trim();
  return base ? `${base}\n\n${avisos}` : avisos;
}

/* ═══════════════════════════════════════════════════════════════════════
   LO QUE VE EL MODELO
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Traduce un `SabinaResultado` a lo que se le devuelve al modelo.
 *
 * `sin_permiso` no se le entrega como un fallo cualquiera: lleva una ORDEN
 * explícita, porque de esa frase depende que la respuesta no salga falsa.
 */
export function resultadoParaModelo(res: SabinaResultado): string {
  // Se estrecha por `motivo` (texto) y no por `ok` (booleano): ver la nota de
  // SabinaResultado en engine-types.ts — este repo compila con "strict": false.
  if (res.ok === true) {
    const bien = res as SabinaResultadoOk;
    return JSON.stringify({ ok: true, resumen: bien.resumen, datos: bien.datos });
  }
  const mal = res as SabinaResultadoFallo;
  if (mal.motivo === "sin_permiso") {
    return JSON.stringify({
      ok: false,
      motivo: "sin_permiso",
      permiso: mal.permiso,
      instruccion:
        `EL USUARIO NO TIENE ACCESO A ${areaDePermiso(mal.permiso).toUpperCase()}. ` +
        `NO omitas este dato en silencio ni lo sustituyas por otro: DI textualmente ` +
        `"${fraseSinPermiso(mal.permiso)}" y sigue con lo que sí puedas contestar. ` +
        `Si la pregunta dependía de esto, dilo antes de cualquier conclusión.`,
    });
  }
  if (mal.motivo === "sin_datos") {
    return JSON.stringify({
      ok: false,
      motivo: "sin_datos",
      instruccion:
        "No hay datos para eso en el periodo pedido. Dilo tal cual. NO estimes, " +
        "NO promedies y NO inventes una cifra de reemplazo.",
    });
  }
  return JSON.stringify({
    ok: false,
    motivo: "error",
    detalle: mal.detalle,
    instruccion: "La consulta falló. Dilo; no supongas el dato.",
  });
}

/** El prompt del sistema. Es donde viven las reglas 3, 5 y 6 del contrato. */
export function construirSystemPrompt(opciones: {
  dificultad: SabinaDificultad;
  hoy: string;
}): string {
  return `Eres Sabina, la asistente de una clínica dental en México. Contestas al doctor y a su equipo sobre SU clínica, en español neutro y de tú. Hoy es ${opciones.hoy}.

CÓMO CONSIGUES LOS DATOS
Los números salen SIEMPRE de tus herramientas. No tienes ningún dato de la clínica en la cabeza.
- Si no llamaste a una herramienta, no tienes la cifra: no la escribas.
- Si una herramienta vuelve con "sin_datos", di que no hay dato de eso. NO estimes, NO promedies, NO rellenes con un número parecido, NO uses cifras de ejemplo.
- Si no existe una herramienta para lo que te preguntan, dilo: "eso no lo puedo consultar todavía".
- Nunca inventes un nombre de paciente, una cantidad, una fecha ni un porcentaje. Una sola cifra inventada y el doctor no te vuelve a usar.

CUANDO FALTA UN PERMISO (esto es lo más importante)
Si una herramienta vuelve con "sin_permiso", NO puedes omitir esa parte en silencio.
- MAL: "No tengo datos de facturación." (el doctor entiende que la clínica no facturó nada)
- BIEN: "No tienes acceso a facturación, eso no te lo puedo contestar."
Dilo con esas palabras, ANTES de cualquier conclusión, y sigue contestando lo que sí puedas. Si te faltó una pieza, avisa de que tu respuesta va sobre medio cuadro: un consejo sobre datos incompletos, dicho con seguridad, es peor que no contestar.

PRIMERO EL HECHO, DESPUÉS LA OPINIÓN
Separa siempre las dos cosas, y en este orden:
1. Lo medido, con su cifra y su periodo: "los martes tienes 40 % de ocupación".
2. Lo que sugieres, dicho como sugerencia: "yo movería ortodoncia a los martes".
Nunca mezcles las dos en la misma frase, y nunca presentes una opinión con el tono de un dato.

LO QUE NO HACES
Solo lees. No agendas citas, no cobras, no editas expedientes, no mandas mensajes. Si te lo piden, di que no puedes hacerlo y ofrece el dato que sí tienes.

CÓMO ESCRIBES
${
  opciones.dificultad === "abierta"
    ? "Es una pregunta abierta: consulta lo que necesites, cruza los datos y razona. Termina con lo medido primero y tus sugerencias después, separadas y claras."
    : "Es una pregunta directa: contesta con el dato y poco más. Dos o tres líneas. Sin rodeos y sin resumen ejecutivo."
}
Nada de markdown pesado ni tablas: esto se lee en un panel. Cifras en pesos mexicanos.`;
}

/* ═══════════════════════════════════════════════════════════════════════
   EL RASTRO — quién preguntó, no QUÉ preguntó
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Construye la línea del rastro por LISTA BLANCA.
 *
 * Se copia campo a campo a propósito, en vez de esparcir el estado del turno
 * con `...`: la pregunta y la respuesta pueden llevar el nombre y el
 * padecimiento de un paciente, y un `...estado` de más las mandaría a los logs
 * de Vercel sin que nadie lo notara en la revisión. Van a la conversación
 * guardada, que ya está protegida por clínica y por usuario.
 */
export function construirRastro(estado: {
  clinicId: string;
  userId: string;
  conversacionId?: string | null;
  modelo: string;
  dificultad: SabinaDificultad;
  escalado: boolean;
  herramientas: readonly string[];
  rondas: number;
  tokensEntrada: number;
  tokensSalida: number;
  ms: number;
  sinPermiso: readonly string[];
}): SabinaRastro {
  return {
    clinicId: estado.clinicId,
    userId: estado.userId,
    conversacionId: estado.conversacionId ?? null,
    modelo: estado.modelo,
    dificultad: estado.dificultad,
    escalado: estado.escalado,
    herramientas: [...estado.herramientas],
    rondas: estado.rondas,
    tokensEntrada: estado.tokensEntrada,
    tokensSalida: estado.tokensSalida,
    ms: estado.ms,
    sinPermiso: [...estado.sinPermiso],
  };
}

/** El esquema JSON que ve el modelo, sacado del zod de cada herramienta. */
export function toolsParaModelo(
  tools: readonly SabinaTool<any, any>[],
  aJsonSchema: (t: SabinaTool<any, any>) => Record<string, unknown>,
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({
    name: t.nombre,
    description: t.descripcion,
    input_schema: aJsonSchema(t),
  }));
}

/* ═══════════════════════════════════════════════════════════════════════
   ZOD → JSON SCHEMA
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Convierte el zod de una herramienta al `input_schema` que pide la API de
 * Anthropic. Es un convertidor MÍNIMO, escrito a mano a propósito:
 * `zod-to-json-schema` no está en package.json y dentro de un worktree no se
 * corre `npm install` (reemplazaría el enlace de node_modules por una copia
 * real). Cubre lo que usa el catálogo del contrato — objetos con strings,
 * números, booleanos, enums, arrays, opcionales y defaults.
 *
 * 🔴 Esto solo describe; NO valida. Lo que de verdad decide si una llamada se
 * ejecuta es `validarLlamada()`, que corre el zod de verdad. Si este
 * convertidor se queda corto con un tipo raro, el peor caso es que el modelo
 * mande un argumento malo y pierda una ronda — nunca que se ejecute algo sin
 * validar.
 */
export function zodAJsonSchema(esquema: unknown): Record<string, unknown> {
  const nodo = convertir(esquema);
  // La API exige un objeto en la raíz.
  if (nodo && typeof nodo === "object" && (nodo as any).type === "object") {
    return nodo as Record<string, unknown>;
  }
  return { type: "object", properties: {}, additionalProperties: false };
}

function def(esquema: any): any {
  return esquema?._def ?? {};
}

function convertir(esquema: any): Record<string, unknown> {
  const d = def(esquema);
  const descripcion: string | undefined = d.description;
  const conDesc = (nodo: Record<string, unknown>) =>
    descripcion ? { ...nodo, description: descripcion } : nodo;

  switch (d.typeName) {
    case "ZodObject": {
      const shape = typeof d.shape === "function" ? d.shape() : d.shape ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [clave, valor] of Object.entries(shape as Record<string, any>)) {
        properties[clave] = convertir(valor);
        if (!esOpcional(valor)) required.push(clave);
      }
      return conDesc({
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      });
    }
    case "ZodString": {
      const nodo: Record<string, unknown> = { type: "string" };
      for (const chequeo of d.checks ?? []) {
        if (chequeo.kind === "min") nodo.minLength = chequeo.value;
        if (chequeo.kind === "max") nodo.maxLength = chequeo.value;
      }
      return conDesc(nodo);
    }
    case "ZodNumber": {
      const nodo: Record<string, unknown> = {
        type: (d.checks ?? []).some((c: any) => c.kind === "int") ? "integer" : "number",
      };
      for (const chequeo of d.checks ?? []) {
        if (chequeo.kind === "min") nodo.minimum = chequeo.value;
        if (chequeo.kind === "max") nodo.maximum = chequeo.value;
      }
      return conDesc(nodo);
    }
    case "ZodBoolean":
      return conDesc({ type: "boolean" });
    case "ZodEnum":
      return conDesc({ type: "string", enum: [...(d.values ?? [])] });
    case "ZodNativeEnum":
      return conDesc({ type: "string", enum: Object.values(d.values ?? {}) });
    case "ZodLiteral":
      return conDesc({ const: d.value });
    case "ZodArray":
      return conDesc({ type: "array", items: convertir(d.type) });
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
      return conDesc(convertir(d.innerType));
    case "ZodEffects":
      return conDesc(convertir(d.schema));
    case "ZodUnion": {
      const opciones = (d.options ?? []).map((o: any) => convertir(o));
      return conDesc({ anyOf: opciones });
    }
    case "ZodDate":
      return conDesc({ type: "string", format: "date" });
    default:
      // Tipo que este convertidor no conoce: se describe como "cualquier cosa"
      // y que el zod de verdad decida en validarLlamada().
      return conDesc({});
  }
}

/** ¿La clave puede faltar? optional/default/nullish no van en `required`. */
function esOpcional(esquema: any): boolean {
  const t = def(esquema).typeName;
  return t === "ZodOptional" || t === "ZodDefault";
}
