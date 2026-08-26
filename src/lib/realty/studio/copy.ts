import "server-only";
// ═══════════════════════════════════════════════════════════════════════
// ESTUDIO IA — textos: descripción del anuncio y copy para redes.
//
// Se llama a Anthropic por `fetch` crudo y NO por el SDK, aunque el SDK
// esté en package.json: NINGÚN sitio del repo lo importa. Los nueve puntos
// que hablan con Claude (integrations/claude.ts, el bot de barber, las
// rutas clínicas) usan fetch con `x-api-key` + `anthropic-version`, y con
// el mismo contrato de "si no hay llave, devuelvo mock, no lanzo". Meter el
// SDK aquí sería mezclar dos formas de hacer lo mismo en un repo que ya
// eligió una.
// ═══════════════════════════════════════════════════════════════════════
import {
  REALTY_STUDIO_DEFAULT_MODEL,
  textCallMicros,
  type Micros,
} from "@/lib/realty/studio/pricing";
import type {
  RealtyCopyTone,
  RealtySocialResult,
  RealtyStudioError,
} from "@/lib/realty/studio/types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/**
 * La llave del vertical con caída a la general, igual que barber
 * (`BARBER_ANTHROPIC_API_KEY || ANTHROPIC_API_KEY`). Así se le puede poner
 * a inmuebles una llave con su propio límite de gasto en la consola de
 * Anthropic sin tocar al dental.
 */
function apiKey(): string | null {
  return process.env.REALTY_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || null;
}

function model(): string {
  return process.env.REALTY_AI_MODEL || REALTY_STUDIO_DEFAULT_MODEL;
}

export interface StudioTextCall {
  text: string;
  micros: Micros;
  /** El modelo que REALMENTE respondió (`response.model`), no el que se pidió. */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type StudioTextOutcome =
  | { ok: true; call: StudioTextCall }
  | {
      ok: false;
      error: RealtyStudioError;
      /**
       * Micros que el proveedor YA cobró aunque no devolviera nada útil.
       *
       * Se llena SOLO cuando el modelo contestó y quemó tokens (una negativa
       * o un corte por longitud): eso se paga igual y tiene que tocar el
       * tope, o una negativa en bucle sale gratis para la cuenta y cara para
       * nosotros. Queda ausente cuando no hubo llamada o el proveedor
       * respondió con un error HTTP, porque entonces no se cobró nada.
       */
      spentMicros?: Micros;
    };

/** Con strict:false TypeScript no estrecha por booleano. Guarda explícita. */
export function isTextOk(
  r: StudioTextOutcome,
): r is { ok: true; call: StudioTextCall } {
  return r.ok === true;
}

async function callClaude(args: {
  system: string;
  user: string;
  maxTokens: number;
}): Promise<StudioTextOutcome> {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      error: {
        code: "not_configured",
        message:
          "La IA todavía no está configurada. Falta la llave de Anthropic en el servidor.",
      },
    };
  }

  const used = model();
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: used,
        // 🔴 max_tokens ALTO aunque el anuncio sean 120 palabras.
        //
        // En Opus 5 el razonamiento viene ENCENDIDO por omisión, y los
        // tokens de razonamiento se descuentan de max_tokens igual que los
        // de la respuesta. Con un tope apretado el modelo se queda sin
        // presupuesto PENSANDO y la respuesta llega sin un solo bloque de
        // texto — que aquí se veía como "la IA devolvió una respuesta
        // vacía", el error críptico que este módulo tiene prohibido dar.
        //
        // Subirlo NO sube el costo: se cobran los tokens que se generan, no
        // los que se autorizan. Quien acota el gasto es `effort`, no esto.
        max_tokens: args.maxTokens,
        // Esfuerzo BAJO a propósito: redactar el anuncio de una casa es una
        // tarea corta y acotada. Subirlo no mejora el texto y sí multiplica
        // el costo de cada generación, que es lo que este módulo cuida.
        output_config: { effort: "low" },
        system: args.system,
        messages: [{ role: "user", content: args.user }],
      }),
      // Holgado y por debajo del maxDuration de la ruta (120 s): con el
      // razonamiento encendido una redacción puede tardar más que un
      // completado seco, y cortarla a los 60 s sería tirar tokens ya pagados.
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[realty/studio] Anthropic ${res.status}: ${body.slice(0, 300)}`);
      return {
        ok: false,
        error: {
          code: "provider",
          message: "La IA no pudo responder. Inténtalo otra vez en un momento.",
        },
      };
    }

    const data = await res.json();
    const blocks = (data?.content ?? []) as Array<{ type: string; text?: string }>;
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim();

    const inputTokens = Number(data?.usage?.input_tokens) || 0;
    const outputTokens = Number(data?.usage?.output_tokens) || 0;

    // 🔴 Se cobra por el modelo que RESPONDIÓ, no por el que se pidió. Son
    // el mismo salvo cuando no lo son (una variable de entorno mal escrita,
    // un ruteo del proveedor), y en ese caso cobrar por el pedido es cobrar
    // por una tarifa que nadie aplicó.
    const served = typeof data?.model === "string" && data.model ? data.model : used;
    const micros = textCallMicros({ model: served, inputTokens, outputTokens });

    if (!text) {
      // 🔴 Los tokens YA se gastaron aunque no haya texto, así que el error
      // dice CUÁL de los tres casos fue. "Respuesta vacía" a secas es la
      // frase que manda a la gente a soporte.
      const stop = String(data?.stop_reason ?? "");
      const message =
        stop === "refusal"
          ? "La IA no quiso redactar este anuncio. Revisa que los datos del inmueble no tengan nada raro y vuelve a intentar."
          : stop === "max_tokens"
            ? "La IA se quedó a medias. Inténtalo otra vez."
            : "La IA devolvió una respuesta vacía. Inténtalo otra vez.";
      return { ok: false, error: { code: "provider", message }, spentMicros: micros };
    }

    return {
      ok: true,
      call: { text, micros, model: served, inputTokens, outputTokens },
    };
  } catch (e) {
    console.error("[realty/studio] Anthropic no contestó:", e);
    return {
      ok: false,
      error: { code: "provider", message: "La IA no contestó a tiempo." },
    };
  }
}

// ── El contexto del inmueble ────────────────────────────────────────────

export interface StudioPropertyContext {
  title: string;
  kind: string;
  operation: string;
  price: string;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  builtM2: number | null;
  landM2: number | null;
  colonia: string | null;
  city: string | null;
  state: string | null;
  amenities: string[];
  /** Lo que el asesor ya escribió. La IA mejora, no inventa de cero. */
  currentDescription: string | null;
}

function contextBlock(p: StudioPropertyContext): string {
  const line = (label: string, v: string | number | null | undefined) =>
    v === null || v === undefined || v === "" ? null : `${label}: ${v}`;
  return [
    line("Título", p.title),
    line("Tipo", p.kind),
    line("Operación", p.operation),
    line("Precio", p.price),
    line("Recámaras", p.bedrooms),
    line("Baños", p.bathrooms),
    line("Estacionamientos", p.parking),
    line("Construcción (m²)", p.builtM2),
    line("Terreno (m²)", p.landM2),
    line("Colonia", p.colonia),
    line("Ciudad", p.city),
    line("Estado", p.state),
    p.amenities.length ? `Amenidades: ${p.amenities.join(", ")}` : null,
    p.currentDescription ? `Lo que ya escribió el asesor: ${p.currentDescription}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 🔴 LA REGLA QUE NO SE NEGOCIA: la IA no puede inventar datos del
 * inmueble. Un anuncio que promete una alberca que no existe es publicidad
 * engañosa, y el que responde es el asesor, no nosotros.
 */
const NO_INVENTAR = [
  "REGLAS QUE NO SE ROMPEN:",
  "· Usa ÚNICAMENTE los datos que te doy. Si no te di un dato, NO lo menciones.",
  "· Está PROHIBIDO inventar amenidades, medidas, acabados, años o cercanías.",
  "· No prometas rendimientos, plusvalía ni aprobación de créditos.",
  "· Nada de 'hermosa', 'espectacular' ni 'de ensueño': di lo que hay.",
  "· Español de México, tuteo, sin regionalismos de España.",
].join("\n");

const TONE_HINT: Record<RealtyCopyTone, string> = {
  directo: "Tono DIRECTO: frases cortas, dato tras dato, cero adornos. Para quien ya sabe lo que busca.",
  calido: "Tono CÁLIDO: habla de cómo se vive ahí, en segunda persona, sin cursilería.",
  premium: "Tono PREMIUM: sobrio y preciso, materiales y ubicación primero. Nada de mayúsculas ni signos de más.",
};

// ── C. La descripción del anuncio ───────────────────────────────────────

export async function generateDescription(args: {
  property: StudioPropertyContext;
  tone: RealtyCopyTone;
}): Promise<StudioTextOutcome> {
  const system = [
    "Eres quien redacta los anuncios de una inmobiliaria mexicana.",
    "Escribes la descripción que va en el portal y en la web de la agencia.",
    NO_INVENTAR,
    TONE_HINT[args.tone],
  ].join("\n\n");

  const user = [
    "Escribe la descripción de este inmueble.",
    "",
    contextBlock(args.property),
    "",
    "FORMATO: de 60 a 120 palabras, en 2 o 3 párrafos cortos.",
    "Empieza por lo que hace distinto a este inmueble, no por 'se vende'.",
    "Cierra con una invitación a agendar una visita.",
    "Devuelve SOLO el texto del anuncio, sin títulos ni comillas ni viñetas.",
  ].join("\n");

  return callClaude({ system, user, maxTokens: 4000 });
}

// ── D. Textos para redes ────────────────────────────────────────────────

/**
 * Saca los tres bloques del texto. El modelo devuelve secciones marcadas y
 * NO un JSON: pedir JSON y parsearlo añade un modo de fallo (un JSON roto
 * tira toda la generación) para un texto que un humano va a copiar y pegar
 * igual. Si las marcas no aparecen, todo el texto cae en `post`, que es una
 * degradación útil en vez de un error.
 */
export function parseSocial(raw: string): RealtySocialResult {
  const grab = (label: string): string => {
    const re = new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n[A-ZÁÉÍÓÚ]{3,}\\s*:|$)`, "i");
    const m = re.exec(raw);
    return m ? m[1].trim() : "";
  };

  const post = grab("POST");
  const hashtagsRaw = grab("HASHTAGS");
  const firstComment = grab("COMENTARIO");

  // ⚠️ Sin la bandera `u` ni escapes \p{...}: el `target` de este repo es
  // anterior a ES6 y TypeScript los rechaza (TS1501). La clase se escribe a
  // mano e incluye los acentos y la ñ, que es lo que se pierde en un
  // hashtag mexicano — "#CasasEnMichoacán" cortado en "Michoac" es basura.
  const hashtags = Array.from(
    new Set(
      (hashtagsRaw.match(/#[A-Za-z0-9_áéíóúüñÁÉÍÓÚÜÑ]+/g) ?? [])
        .map((h) => h.slice(1).trim())
        .filter(Boolean),
    ),
  ).slice(0, 15);

  return {
    post: post || raw.trim(),
    hashtags,
    firstComment,
  };
}

export async function generateSocial(args: {
  property: StudioPropertyContext;
  tone: RealtyCopyTone;
}): Promise<StudioTextOutcome> {
  const zona = args.property.colonia || args.property.city || "la zona";
  const system = [
    "Eres quien lleva las redes de una inmobiliaria mexicana.",
    "Escribes para Instagram y TikTok, donde la gente NO busca metros cuadrados:",
    "busca imaginarse viviendo ahí. Vendes el estilo de vida, con datos reales.",
    NO_INVENTAR,
    TONE_HINT[args.tone],
  ].join("\n\n");

  const user = [
    "Escribe el material para publicar este inmueble.",
    "",
    contextBlock(args.property),
    "",
    "Devuelve EXACTAMENTE estas tres secciones, con estas etiquetas:",
    "",
    "POST:",
    "(máximo 4 renglones. El primero tiene que frenar el scroll. Sin hashtags aquí.)",
    "",
    "HASHTAGS:",
    `(de 8 a 12, en una sola línea, con #. Incluye los de ${zona} y los de bienes raíces en México.)`,
    "",
    "COMENTARIO:",
    "(el primer comentario: una línea invitando a escribir por mensaje directo.)",
  ].join("\n");

  return callClaude({ system, user, maxTokens: 4000 });
}
