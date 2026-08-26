// ═══════════════════════════════════════════════════════════════════════
// ESTUDIO IA — el PLAN del reel. Núcleo PURO.
//
// 🔴 AQUÍ NO SE CODIFICA VIDEO, Y ES A PROPÓSITO.
//
// El repo no tiene ffmpeg, ni Remotion, ni ninguna librería de video, y
// meter una en un proyecto que corre en Vercel significa o un binario de
// ~70 MB en la función, o contratar un servicio de render. La consigna era
// empezar por lo que se puede hacer sin servicios caros, así que el video
// se arma EN EL NAVEGADOR: un <canvas> de 1080×1920 pinta las fotos con su
// zoom lento y su texto, y MediaRecorder graba ese canvas.
//
// Este archivo es la mitad que SÍ es del servidor: decide qué foto va en
// qué orden, cuánto dura cada una y qué texto lleva encima. El navegador
// solo ejecuta el plan. Así el ritmo y el copy se prueban sin abrir Chrome.
//
// Lo que esto NO da, dicho claro: el archivo sale en WebM en Chrome viejo y
// en MP4 donde el navegador lo soporte. TikTok e Instagram tragan los dos,
// pero un MP4 es lo seguro — por eso el componente prefiere MP4 y solo cae
// a WebM si el navegador no puede.
// ═══════════════════════════════════════════════════════════════════════
import {
  REEL_FPS,
  REEL_HEIGHT,
  REEL_WIDTH,
  type RealtyReelPlan,
  type RealtyReelScene,
  type RealtyReelTemplate,
} from "@/lib/realty/studio/types";

/** Datos del inmueble que necesita el plan. Sin Prisma: objeto plano. */
export interface ReelPropertyInput {
  title: string;
  /** Ya formateado ("$4,850,000 MXN"): el formato es del servidor. */
  price: string;
  operation: string;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  builtM2: number | null;
  colonia: string | null;
  city: string | null;
  /** URLs firmadas, YA en el orden de la galería (portada primero). */
  photoUrls: string[];
}

interface TemplateSpec {
  /** Cuánto dura cada foto. Menos tiempo = más ritmo. */
  perSceneMs: number;
  crossfadeMs: number;
  /** Cuántas fotos como máximo. Un reel largo no lo ve nadie. */
  maxScenes: number;
  /** El gancho de la primera pantalla. */
  hook: (p: ReelPropertyInput) => string;
}

/**
 * Las tres plantillas. La diferencia REAL es el ritmo y el gancho, no un
 * color: un "tour rápido" con fotos de 4 segundos no es un tour rápido.
 */
const TEMPLATES: Record<RealtyReelTemplate, TemplateSpec> = {
  // Recorrido: pausado, para que se vea cada espacio. El clásico.
  recorrido: {
    perSceneMs: 2600,
    crossfadeMs: 420,
    maxScenes: 8,
    hook: (p) => (p.colonia ? `Así se vive en ${p.colonia}` : p.title),
  },
  // "Antes de que se vaya": urgencia. Primero el precio, luego lo bonito.
  "antes-de-que-se-vaya": {
    perSceneMs: 1900,
    crossfadeMs: 260,
    maxScenes: 7,
    hook: () => "Antes de que se vaya",
  },
  // Tour rápido: corte seco, para TikTok. Nada dura más de segundo y medio.
  "tour-rapido": {
    perSceneMs: 1300,
    crossfadeMs: 160,
    maxScenes: 10,
    hook: (p) => p.price,
  },
};

/** "3 rec · 2 baños · 120 m²" — los datos que deciden si siguen viendo. */
export function reelFacts(p: ReelPropertyInput): string {
  return [
    p.bedrooms ? `${p.bedrooms} rec` : null,
    p.bathrooms ? `${p.bathrooms} baños` : null,
    p.parking ? `${p.parking} autos` : null,
    p.builtM2 ? `${Math.round(p.builtM2)} m²` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Providencia, Guadalajara" */
export function reelPlace(p: ReelPropertyInput): string {
  return [p.colonia, p.city].filter(Boolean).join(", ");
}

/**
 * Cuánto dura el video DE VERDAD: la suma de las escenas, sin descontar los
 * cruces.
 *
 * 🔴 Existe para que el plan y el grabador no se contradigan. El cruce de
 * este reel es un ENCIMADO en la cola de cada escena —la siguiente foto
 * aparece con opacidad creciente sobre la que termina—, y cuando llega el
 * corte la escena siguiente empieza igual desde cero con toda su duración.
 * O sea: el cruce NO acorta el video. Un `totalMs` que restara los cruces
 * (como haría un editor con solapamiento real) enseñaría "11.3 s" para un
 * archivo de 13 s, y quien publica un reel en TikTok cuenta los segundos.
 *
 * Lo usan LAS DOS mitades —el plan del servidor y el grabador del
 * navegador— justo para que no puedan separarse: si un día el ritmo cambia,
 * cambia en una sola función.
 */
export function reelRecordedMs(scenes: Array<{ durationMs: number }>): number {
  return scenes.reduce((acc, s) => acc + Math.max(0, s.durationMs), 0);
}

/**
 * Arma el plan.
 *
 * El orden de las fotos NO se reinventa: llega el de la galería, que ya lo
 * puso el asesor con la portada primero. Cambiarlo aquí sería pelearse con
 * la única persona que conoce el inmueble.
 *
 * Devuelve null si no hay fotos: un reel sin fotos no es un reel, y es mejor
 * decirlo que entregar un video negro de doce segundos.
 */
export function buildReelPlan(args: {
  property: ReelPropertyInput;
  template: RealtyReelTemplate;
  accountName: string;
  logoUrl: string | null;
  cta: string;
}): RealtyReelPlan | null {
  const spec = TEMPLATES[args.template] ?? TEMPLATES.recorrido;
  const photos = args.property.photoUrls.filter(Boolean).slice(0, spec.maxScenes);
  if (photos.length === 0) return null;

  const facts = reelFacts(args.property);
  const place = reelPlace(args.property);

  const scenes: RealtyReelScene[] = photos.map((photoUrl, i) => {
    // El texto NO va en todas las escenas. Un reel con letrero permanente se
    // lee como un anuncio; uno que respira, como un recorrido.
    let title = "";
    let subtitle = "";
    if (i === 0) {
      title = spec.hook(args.property);
      subtitle = place;
    } else if (i === 1 && facts) {
      title = facts;
    } else if (i === 2) {
      title = args.property.price;
      subtitle = args.property.operation === "RENTA" ? "al mes" : "";
    } else if (i === photos.length - 1) {
      title = args.cta;
    }

    // El zoom alterna de dirección para que dos fotos seguidas no se sientan
    // iguales. Es el truco más barato que hay contra la monotonía.
    const inward = i % 2 === 0;
    return {
      photoUrl,
      durationMs: spec.perSceneMs,
      title,
      subtitle,
      zoomFrom: inward ? 1.0 : 1.08,
      zoomTo: inward ? 1.08 : 1.0,
    };
  });

  return {
    template: args.template,
    width: REEL_WIDTH,
    height: REEL_HEIGHT,
    fps: REEL_FPS,
    // La MISMA cuenta que hará el grabador. Ver reelRecordedMs.
    totalMs: Math.max(1000, reelRecordedMs(scenes)),
    crossfadeMs: spec.crossfadeMs,
    scenes,
    logoUrl: args.logoUrl,
    accountName: args.accountName,
    cta: args.cta,
  };
}

/** Segundos con un decimal: "14.3 s". Para la pantalla. */
export function formatReelDuration(totalMs: number): string {
  return `${(Math.max(0, totalMs) / 1000).toFixed(1)} s`;
}
