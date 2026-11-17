/* ═══════════════════════════════════════════════════════════════════════
   El aviso «agrégala a tu pantalla de inicio» — qué se enseña en cada
   teléfono (ws6-t2, punto 5).

   ⚠️ Este archivo lo importa un componente de NAVEGADOR
   (components/barber/stars/instalar-tarjeta.tsx): NO debe importar nada de
   servidor (ni stars-core, que firma tokens con `crypto`, ni prisma). Por eso
   vive aparte de tarjeta-instalar-core.ts, que arma el manifest.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Qué aviso se enseña.
 *   boton   = el navegador ofrece instalar (beforeinstallprompt): un botón;
 *   iphone  = iPhone / iPad: instrucción «Compartir → Agregar a inicio»;
 *   android = Android sin oferta del navegador: instrucción del menú ⋮;
 *   null    = nada (ya instalada, ya la cerró, o computadora sin oferta).
 */
export type AvisoInstalar = "boton" | "iphone" | "android" | null;

export function decidirAvisoInstalar(args: {
  userAgent: string;
  /** iPadOS se presenta como Mac: se distingue por los puntos de toque. */
  maxTouchPoints?: number;
  /** Ya corre como app (display-mode: standalone / navigator.standalone). */
  instalada: boolean;
  /** El cliente ya cerró el aviso alguna vez. */
  cerrado: boolean;
  /** El navegador disparó beforeinstallprompt. */
  ofrecida: boolean;
  /** Ya pasó la espera para ver si el navegador ofrecía instalar. */
  esperaVencida: boolean;
}): AvisoInstalar {
  if (args.instalada || args.cerrado) return null;
  if (args.ofrecida) return "boton";
  const ua = args.userAgent || "";
  const iphone = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (args.maxTouchPoints ?? 0) > 1);
  if (iphone) return "iphone";
  if (/Android/i.test(ua)) return args.esperaVencida ? "android" : null;
  return null;
}

/** Clave de localStorage: «ya lo cerré» (por barbería; no lleva el token). */
export function claveAvisoInstalar(slug: string): string {
  return `dcb-tarjeta-instalar:${slug}`;
}
