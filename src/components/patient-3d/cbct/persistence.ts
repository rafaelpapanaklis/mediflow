// ─────────────────────────────────────────────────────────────────────────────
// persistence.ts — Persistencia del visor CBCT rediseñado (WS2-T7).
//
// Mapea las anotaciones (Anno[]) y la nota del estudio (string) del visor contra
// el PatientFile del SET CBCT, vía la API existente que valida clinicId/patientId
// en el SERVIDOR (multi-tenant: el cliente NUNCA define la clínica). Las
// anotaciones del SET CBCT son su PROPIO `annotations`; NO tocan las anotaciones
// Pin3D de las mallas STL (que viven en otro PatientFile / Model3DViewer).
//
//   PATCH /api/patients/[id]/models-3d/[fileId]
//     { annotations: Anno[] }   → marcas del visor (array; puede ir vacío)
//     { doctorNotes: string }   → nota clínica del estudio
// ─────────────────────────────────────────────────────────────────────────────

import type { Anno, AnnoType, EstudioNota } from "./types";
import { uid } from "./geometry";

const ANNO_TYPES: Record<AnnoType, true> = {
  distancia: true,
  angulo: true,
  anotacion: true,
  canal: true,
  implante: true,
};

function isPt(v: any): boolean {
  return !!v && typeof v.x === "number" && typeof v.y === "number";
}

/**
 * Normaliza el `annotations` crudo del PatientFile (Json de tipo desconocido) a
 * Anno[] válido para el visor. DEFENSIVO: descarta lo que no cuadre con el
 * contrato (tipo/id/plane/puntos), para no romper el visor con datos legados o
 * de otra superficie. Devuelve [] si no es un array.
 */
export function parseInitialAnnos(raw: unknown): Anno[] {
  if (!Array.isArray(raw)) return [];
  const out: Anno[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a: any = raw[i];
    if (!a || typeof a !== "object") continue;
    if (!a.type || !(a.type in ANNO_TYPES)) continue;
    if (typeof a.id !== "string" || typeof a.plane !== "string") continue;
    // Validación por tipo de la forma de `points` / campos clave.
    if (a.type === "distancia" && !(Array.isArray(a.points) && a.points.length === 2 && a.points.every(isPt))) continue;
    if (a.type === "angulo" && !(Array.isArray(a.points) && a.points.length === 3 && a.points.every(isPt))) continue;
    if (a.type === "anotacion" && !(Array.isArray(a.points) && a.points.length >= 1 && isPt(a.points[0]))) continue;
    if (a.type === "canal" && !(Array.isArray(a.points) && a.points.length >= 1 && a.points.every(isPt))) continue;
    if (a.type === "implante" && !isPt(a.p)) continue;
    out.push(a as Anno);
  }
  return out;
}

// ── Notas del estudio (FIX1): lista serializada en doctorNotes (string) ───────

/**
 * Deserializa el `doctorNotes` crudo del PatientFile a EstudioNota[]. DEFENSIVO:
 *  · JSON array de notas → se valida nota por nota (id/texto/ts).
 *  · texto plano LEGADO (lo que ya escribieron las clínicas antes de FIX1) → se
 *    conserva como UNA nota inicial (ts 0), para no perder nada.
 *  · vacío/no-string → [].
 */
export function parseInitialNotes(raw: unknown): EstudioNota[] {
  if (typeof raw !== "string") return [];
  const s = raw.trim();
  if (!s) return [];
  if (s.charAt(0) === "[") {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        const out: EstudioNota[] = [];
        for (let i = 0; i < arr.length; i++) {
          const n: any = arr[i];
          if (!n || typeof n !== "object" || typeof n.texto !== "string") continue;
          out.push({
            id: typeof n.id === "string" && n.id ? n.id : uid(),
            texto: n.texto,
            ts: typeof n.ts === "number" ? n.ts : 0,
          });
        }
        return out;
      }
    } catch {
      /* no era JSON válido: cae a texto plano legado abajo */
    }
  }
  // Texto plano legado → una sola nota inicial (preserva el contenido original).
  return [{ id: uid(), texto: raw, ts: 0 }];
}

/** Serializa la lista de notas a string para persistir en doctorNotes. */
export function serializeNotes(notes: EstudioNota[]): string {
  return JSON.stringify(Array.isArray(notes) ? notes : []);
}

async function patchFile(
  patientId: string,
  fileId: string,
  body: { annotations?: Anno[]; doctorNotes?: string },
): Promise<void> {
  const res = await fetch(`/api/patients/${patientId}/models-3d/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = "No se pudo guardar";
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch {
      /* sin cuerpo JSON: deja el mensaje por defecto */
    }
    throw new Error(msg);
  }
}

/** Persiste las marcas (anotaciones) del SET CBCT. Lanza si la API falla. */
export function saveAnnos(patientId: string, fileId: string, annos: Anno[]): Promise<void> {
  return patchFile(patientId, fileId, { annotations: annos });
}

/** Persiste la nota clínica del estudio. Lanza si la API falla. */
export function saveNotes(patientId: string, fileId: string, notes: string): Promise<void> {
  return patchFile(patientId, fileId, { doctorNotes: notes });
}

/** Handlers listos para <CbctViewer/> (onGuardarHallazgos / onGuardarNota). */
export function makeCbctHandlers(patientId: string, fileId: string) {
  return {
    onGuardarHallazgos: (annos: Anno[]) => saveAnnos(patientId, fileId, annos),
    onGuardarNota: (notes: string) => saveNotes(patientId, fileId, notes),
  };
}

// ── Captura de imagen del estudio (FIX4) ─────────────────────────────────────
// Compone la imagen del Stage enfocado (el <canvas> real del corte 2D, o el SVG
// placeholder/volumen) + el overlay SVG de anotaciones en un canvas temporal y
// devuelve un PNG (Blob). El visor lo descarga.
//
// SUBIDA AL ESTUDIO (pendiente de confirmar): hoy NINGÚN endpoint la admite —
// PATCH /models-3d/[fileId] solo acepta { doctorNotes | annotations } y POST
// /models-3d rechaza PNG por extensión (ALLOWED_EXT) y firma. Adjuntarla en
// servidor exigiría una columna/endpoint nuevos; por la regla "no inventes
// columnas sin confirmar" y el ownership (no tocar la API), se entrega como
// DESCARGA real (deja de ser stub). Para subir: confirmar destino y enviar este
// Blob por multipart desde aquí.
export async function captureStageToBlob(stageEl: Element | null): Promise<Blob | null> {
  if (!stageEl || typeof document === "undefined") return null;
  const host = (stageEl.querySelector("[data-vc-content]") as HTMLElement | null) || (stageEl as HTMLElement);

  // Base = corte real (<canvas>); si no hay (placeholder), el primer <svg>.
  // Overlay de anotaciones = SIEMPRE el último <svg> (se monta tras el contenido).
  const canvasEl = host.querySelector("canvas") as HTMLCanvasElement | null;
  const svgs = host.querySelectorAll("svg");
  const overlaySvg = svgs.length ? (svgs[svgs.length - 1] as SVGSVGElement) : null;
  const baseSvg = !canvasEl && svgs.length ? (svgs[0] as SVGSVGElement) : null;

  // Tamaño objetivo = caja de imagen (layout, SIN zoom/pan) → captura el corte
  // completo con todas sus anotaciones. ×ratio acotado para nitidez.
  const cw = Math.max(1, host.offsetWidth || (canvasEl ? canvasEl.width : 800));
  const ch = Math.max(1, host.offsetHeight || (canvasEl ? canvasEl.height : 600));
  const ratio = Math.min(typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1, 2);
  const TW = Math.max(1, Math.min(2400, Math.round(cw * ratio)));
  const TH = Math.max(1, Math.min(2400, Math.round(ch * ratio)));

  const tmp = document.createElement("canvas");
  tmp.width = TW;
  tmp.height = TH;
  const ctx = tmp.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#06080c"; // fondo del Stage
  ctx.fillRect(0, 0, TW, TH);

  // 1) Capa base.
  if (canvasEl && canvasEl.width > 0 && canvasEl.height > 0) {
    try {
      ctx.drawImage(canvasEl, 0, 0, TW, TH);
    } catch {
      // WebGL (vol3d) sin preserveDrawingBuffer puede no leerse: queda fondo+overlay.
    }
  } else if (baseSvg) {
    const baseImg = await svgToImage(baseSvg, TW, TH).catch(() => null);
    if (baseImg) ctx.drawImage(baseImg, 0, 0, TW, TH);
  }

  // 2) Overlay de anotaciones encima.
  if (overlaySvg && overlaySvg !== baseSvg) {
    const ovImg = await svgToImage(overlaySvg, TW, TH).catch(() => null);
    if (ovImg) ctx.drawImage(ovImg, 0, 0, TW, TH);
  }

  return await new Promise<Blob | null>((resolve) => {
    try {
      tmp.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null); // taint inesperado: no rompemos el visor
    }
  });
}

// Rasteriza un <svg> del DOM a un HTMLImageElement w×h. El overlay/placeholder son
// SVG PUROS (sin <image> externo ni <foreignObject>) → no tiñen el canvas.
function svgToImage(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", "0 0 " + w + " " + h);
    // El overlay usa fontFamily="inherit"; al rasterizar aislado fijamos una fuente.
    clone.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, sans-serif";
    const xml = new XMLSerializer().serializeToString(clone);
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("svg image error"));
    img.src = src;
  });
}

/** Descarga un Blob como archivo (captura PNG del estudio). */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
