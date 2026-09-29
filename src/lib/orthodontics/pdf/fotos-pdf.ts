import "server-only";
// ─────────────────────────────────────────────────────────────────────────────
// Fotos del caso → data URL para los PDF de ortodoncia (ws1-t4).
//
// El reporte de progreso le pasaba a @react-pdf `/api/patient-files/<id>`
// (ruta RELATIVA, que el render en el servidor no puede resolver) y el
// comparativo la ruta cruda del bucket (privado). Resultado: casillas negras.
// Aquí se firma la ruta, se baja con tope de tiempo y de bytes y se valida
// que sea PNG/JPEG mirando los BYTES (`imageAspect`) — mismo criterio que el
// expediente. Falla SIEMPRE en suave: una foto que no baja deja la casilla
// con su rótulo, nunca tumba el PDF.
// ─────────────────────────────────────────────────────────────────────────────

import { signMaybeUrls } from "@/lib/storage";
import { imageAspect } from "@/lib/pdf/clinic-letterhead";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const TANDA = 4;
/** Reloj global: 16 fotos lentas no pueden comerse los 60 s de la función. */
const PRESUPUESTO_MS = 35_000;

async function bajar(url: string, limite: number): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const restante = limite - Date.now();
  if (restante <= 0) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, restante)) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
    if (imageAspect(buf) == null) return null;
    const mime = buf[0] === 0x89 ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Mismo orden que la entrada; null donde no hay foto o no se pudo bajar. */
export async function fotosComoDataUrl(urls: Array<string | null | undefined>): Promise<Array<string | null>> {
  const salida: Array<string | null> = urls.map(() => null);
  const conValor = urls.map((u, i) => ({ u, i })).filter((x): x is { u: string; i: number } => Boolean(x.u));
  if (conValor.length === 0) return salida;
  let firmadas: string[];
  try {
    firmadas = await signMaybeUrls(conValor.map((x) => x.u), 180);
  } catch {
    return salida;
  }
  const limite = Date.now() + PRESUPUESTO_MS;
  for (let k = 0; k < conValor.length; k += TANDA) {
    const tanda = conValor.slice(k, k + TANDA);
    const bajadas = await Promise.all(tanda.map((x, j) => bajar(firmadas[k + j] ?? "", limite)));
    tanda.forEach((x, j) => {
      salida[x.i] = bajadas[j];
    });
  }
  return salida;
}
