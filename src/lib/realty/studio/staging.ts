import "server-only";
// ═══════════════════════════════════════════════════════════════════════
// ESTUDIO IA — HOME STAGING VIRTUAL.
//
// Sube la foto de un cuarto vacío y devuelve la versión amueblada.
//
// 🔴 DOS REGLAS QUE NO SE NEGOCIAN, y las dos son legales antes que
// técnicas:
//
//   1. LA ORIGINAL NUNCA SE TOCA. El resultado entra como una foto MÁS del
//      inmueble. Reemplazar la foto real por una amueblada por IA es
//      exactamente el caso que le explota en la cara al asesor cuando el
//      cliente llega a ver un cuarto vacío.
//
//   2. LA MARCA "IMAGEN ILUSTRATIVA" VA QUEMADA EN LOS PÍXELES. No un
//      letrero al lado en el panel, no un badge en la web: quemada. Lo que
//      se descarga, se reenvía por WhatsApp y se sube a un portal es el
//      archivo — y el archivo tiene que decir lo que es sin depender de
//      dónde se esté viendo. Un texto en el HTML se pierde en el primer
//      "guardar imagen".
//
// La marca se compone con `sharp`, que ya es dependencia y ya está probado
// en producción en la subida de fotos de ortodoncia.
// ═══════════════════════════════════════════════════════════════════════
import { REALTY_STAGING_WATERMARK, type RealtyStagingStyle } from "@/lib/realty/studio/types";
import type { RealtyStudioError } from "@/lib/realty/studio/types";

const OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";

/** Llave del vertical con caída a la general, igual que la de Anthropic. */
function imageApiKey(): string | null {
  return process.env.REALTY_OPENAI_API_KEY || process.env.OPENAI_API_KEY || null;
}

function imageModel(): string {
  return process.env.REALTY_STAGING_MODEL || "gpt-image-1";
}

const STYLE_PROMPT: Record<RealtyStagingStyle, string> = {
  moderno:
    "estilo contemporáneo mexicano: líneas rectas, madera clara, textiles en tonos neutros, plantas de interior",
  calido:
    "estilo cálido mexicano: madera de nogal, textiles en barro y ocre, artesanía discreta, luz cálida",
  minimalista:
    "estilo minimalista: muy pocos muebles, paleta blanca y gris, sin adornos, sensación de amplitud",
};

/**
 * El prompt del staging. Lo importante NO es el estilo sino lo que PROHÍBE:
 * el modelo tiene que amueblar sin tocar la arquitectura. Si mueve una
 * ventana o borra una columna, la foto deja de ser de ese inmueble.
 */
function stagingPrompt(style: RealtyStagingStyle): string {
  return [
    `Amuebla este cuarto vacío con ${STYLE_PROMPT[style]}.`,
    "NO cambies la arquitectura: respeta exactamente las paredes, ventanas, puertas,",
    "columnas, pisos, techos, la perspectiva y la luz natural de la foto original.",
    "No agregues ni quites metros. No cambies el color de los muros ni el piso.",
    "Solo agrega muebles y decoración, como haría un home stager real.",
    "Resultado fotorrealista, sin texto ni marcas de agua.",
  ].join(" ");
}

export type StagingOutcome =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; error: RealtyStudioError };

export function isStagingOk(
  r: StagingOutcome,
): r is { ok: true; buffer: Buffer; contentType: string } {
  return r.ok === true;
}

/**
 * 🔴 QUEMA la marca de agua. Es la única función que puede producir el
 * buffer final del staging, y siempre la aplica: no recibe ningún parámetro
 * para desactivarla, a propósito. Si alguien quisiera saltársela tendría que
 * editar este archivo, que es justo el cambio que un revisor sí ve.
 *
 * Falla CERRADO: si sharp no puede componer, se propaga el error y NO se
 * guarda nada. Es al revés que `applyRealtyWatermark` de media.ts, que ante
 * un fallo devuelve la original sin marca — ahí la marca es el logo de la
 * agencia y es cosmética; aquí es la advertencia legal de que la imagen no
 * es real, y una imagen generada SIN esa advertencia es peor que ninguna
 * imagen.
 */
export async function burnIllustrativeWatermark(input: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;

  const meta = await sharp(input).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  // La banda ocupa el 8 % del alto y nunca menos de 44 px: en una foto
  // chica una banda proporcional quedaría ilegible.
  const band = Math.max(44, Math.round(height * 0.08));
  const fontSize = Math.max(18, Math.round(band * 0.42));
  const pad = Math.round(band * 0.32);

  // Se dibuja con SVG porque sharp lo rasteriza nativamente (librsvg): no
  // hace falta `canvas` ni ninguna dependencia nueva.
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${height - band}" width="${width}" height="${band}" fill="rgba(0,0,0,0.62)"/>
      <text x="${pad}" y="${height - band + band * 0.68}"
            font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}"
            font-weight="bold" fill="#FFFFFF" letter-spacing="1.5">${REALTY_STAGING_WATERMARK}</text>
      <text x="${width - pad}" y="${height - band + band * 0.68}" text-anchor="end"
            font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(fontSize * 0.72)}"
            fill="rgba(255,255,255,0.86)">Amueblado con IA</text>
    </svg>`,
  );

  return sharp(input)
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

/**
 * Genera el staging y devuelve el buffer YA marcado.
 *
 * El orden importa: primero se genera, después se marca, y solo el buffer
 * marcado sale de esta función. No hay ninguna ruta por la que salga la
 * imagen generada sin la marca.
 */
export async function generateStaging(args: {
  photo: Buffer;
  photoMime: string;
  style: RealtyStagingStyle;
}): Promise<StagingOutcome> {
  const key = imageApiKey();
  if (!key) {
    return {
      ok: false,
      error: {
        code: "not_configured",
        message:
          "El staging virtual todavía no está configurado. Falta la llave de imágenes en el servidor.",
      },
    };
  }

  try {
    const form = new FormData();
    form.append("model", imageModel());
    form.append("prompt", stagingPrompt(args.style));
    form.append("size", "1024x1024");
    form.append("n", "1");
    form.append(
      "image",
      new Blob([new Uint8Array(args.photo)], { type: args.photoMime || "image/jpeg" }),
      "cuarto.jpg",
    );

    const res = await fetch(OPENAI_IMAGE_EDIT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      // Generar una imagen tarda. 120 s es holgado y sigue por debajo del
      // maxDuration de la ruta.
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[realty/studio] imagen ${res.status}: ${body.slice(0, 300)}`);
      return {
        ok: false,
        error: {
          code: "provider",
          message: "No se pudo generar la imagen. Inténtalo otra vez en un momento.",
        },
      };
    }

    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (typeof b64 !== "string" || !b64) {
      return {
        ok: false,
        error: { code: "provider", message: "El generador devolvió una imagen vacía." },
      };
    }

    const raw = Buffer.from(b64, "base64");

    // 🔴 Aquí, y solo aquí, nace el buffer que se va a guardar.
    const marked = await burnIllustrativeWatermark(raw);
    return { ok: true, buffer: marked, contentType: "image/jpeg" };
  } catch (e) {
    console.error("[realty/studio] el staging falló:", e);
    return {
      ok: false,
      error: { code: "provider", message: "No se pudo generar la imagen." },
    };
  }
}
