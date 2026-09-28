import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { ImportError, parseSpreadsheet } from "@/lib/import/engine";
import { detectEntitiesForColumns, mejorEntidad, ENTITY_IMPORT_ORDER, ordenDe } from "@/lib/import/detect-entity";
import { sanitizeUploadFileName } from "@/lib/import/spreadsheet-safety";
import { getOriginProfile } from "@/lib/import/profiles";
import type { Entity } from "@/lib/import/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// «Subir varios archivos a la vez»: cuántos y cuánto, en un solo POST. Cada
// archivo sigue pasando además por el tope de 5MB/5000 filas de siempre
// (parseSpreadsheet, uno por uno) — esto es el tope AGREGADO del lote, para no
// dejar pasar 20 archivos de 5MB cada uno en una sola llamada.
const MAX_FILES = 12;
const MAX_BATCH_BYTES = 40 * 1024 * 1024; // 40 MB

/** Una fila del "plan": un archivo o UNA pestaña de un .xlsx con varias (cada una cuenta como un archivo). */
export interface DetectedItem {
  fileIndex: number;
  fileName: string;
  sheetName: string | null;
  columns: string[];
  sample: string[][];
  rows: number;
  guesses: { entity: Entity; score: number; confianza: "alta" | "media" | "baja"; requiredOk: boolean }[];
  suggestedEntity: Entity | null;
  suggestedConfidence: "alta" | "media" | "baja" | null;
  order: number;
}

export interface DetectFileError {
  fileIndex: number;
  fileName: string;
  error: string;
}

export interface DetectBatchResult {
  items: DetectedItem[];
  errors: DetectFileError[];
  order: Entity[];
}

/**
 * POST /api/import/detect — «Importar mi clínica», subir VARIOS archivos a la
 * vez (WS1-T12). NO importa nada ni toca la base: solo lee cada archivo, lo
 * clasifica (o, un .xlsx de varias hojas, clasifica cada hoja como si fuera un
 * archivo aparte) y devuelve el PLAN — entidad detectada + confianza + el
 * orden de importación sugerido — para que el usuario lo confirme o corrija
 * antes de que el asistente llame a las rutas de importación de siempre
 * (una por entidad, ya existentes) en ese orden.
 *
 * FormData: `files` (repetido, uno por archivo) + `origin?` (id del perfil).
 * Cada archivo se evalúa por su cuenta: uno inválido no aborta el lote — entra
 * a `errors`, el resto sigue.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Solo lee y clasifica (no escribe nada): el permiso por entidad se exige,
  // como siempre, en la ruta real de importación cuando el usuario confirme.
  const roleGate = requireRole(ctx, "ADMIN", "RECEPTIONIST", "DOCTOR");
  if (roleGate) return roleGate;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Máximo ${MAX_FILES} archivos a la vez` }, { status: 400 });
  }
  const totalBytes = files.reduce((a, f) => a + f.size, 0);
  if (totalBytes > MAX_BATCH_BYTES) {
    return NextResponse.json(
      { error: `El lote pesa demasiado (${(totalBytes / (1024 * 1024)).toFixed(1)} MB); máximo ${MAX_BATCH_BYTES / (1024 * 1024)} MB entre todos` },
      { status: 413 },
    );
  }

  const originRaw = formData.get("origin");
  const origin = typeof originRaw === "string" && originRaw.trim() ? originRaw.trim().slice(0, 40) : null;
  const profile = origin ? getOriginProfile(origin) : null;

  const items: DetectedItem[] = [];
  const errors: DetectFileError[] = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    const fileName = sanitizeUploadFileName(file.name);
    try {
      const parsed = await parseSpreadsheet(file);
      const virtuales = parsed.needsSheet && parsed.sheets
        ? parsed.sheets.filter((s) => s.rows > 0).map((s) => ({ sheetName: s.name as string | null, columns: s.columns, sample: s.sample, rows: s.rows }))
        : [{
            sheetName: null as string | null,
            columns: parsed.columns,
            sample: parsed.rows.slice(0, 5).map((r) => parsed.columns.map((c) => String(r[c] ?? ""))),
            rows: parsed.rows.length,
          }];

      for (const v of virtuales) {
        const guesses = detectEntitiesForColumns(v.columns, fileName, v.sheetName ?? undefined, profile);
        const { entity: suggestedEntity, confianza: suggestedConfidence } = mejorEntidad(guesses);
        items.push({
          fileIndex,
          fileName,
          sheetName: v.sheetName,
          columns: v.columns,
          sample: v.sample,
          rows: v.rows,
          guesses: guesses.map(({ entity, score, confianza, requiredOk }) => ({ entity, score, confianza, requiredOk })),
          suggestedEntity,
          suggestedConfidence,
          order: ordenDe(suggestedEntity),
        });
      }
    } catch (e) {
      errors.push({
        fileIndex,
        fileName,
        error: e instanceof ImportError ? e.message : "No se pudo leer el archivo",
      });
    }
  }

  items.sort((a, b) => a.order - b.order || a.fileIndex - b.fileIndex || (a.sheetName ?? "").localeCompare(b.sheetName ?? ""));

  const result: DetectBatchResult = { items, errors, order: ENTITY_IMPORT_ORDER };
  return NextResponse.json(result);
}
