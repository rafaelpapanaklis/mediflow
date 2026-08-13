// Validación y guardado de una firma manuscrita capturada en canvas.
//
// Existe porque el módulo firma en CUATRO sitios (paciente, testigo 1, testigo 2
// y contrafirma del estomatólogo) y las reglas tienen que ser las mismas en
// todos: sin esto, la ruta que se escribe al final acaba aceptando lo que las
// otras rechazan. La comprobación importante no es la extensión sino el MAGIC
// NUMBER: que los bytes sean de verdad una imagen y no un ejecutable
// codificado en base64.
//
// SERVER ONLY: toca Supabase Storage.

import { createClient as createAdmin } from "@supabase/supabase-js";
import { BUCKETS } from "@/lib/storage";
import { validateMagicNumber } from "@/lib/validate-upload";

/** Una firma son unos KB; 5 MB es el techo que frena abusos sin estorbar. */
export const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;

const ALLOWED_SIGNATURE_MIMES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Resultado de validar una firma.
 *
 * Se devuelve un objeto plano con `error` en vez de una unión discriminada a
 * propósito: el tsconfig del repo NO tiene `strict`, así que TypeScript no
 * estrecha `{ok:true}|{ok:false}` y el caller acabaría con `buffer` de tipo
 * `never`.
 */
export interface SignatureCheck {
  /** null = la firma es válida. */
  error: string | null;
  /** Código HTTP sugerido para ese error (400 formato, 413 tamaño). */
  status: number;
  /** Detalle técnico del magic number, para el cuerpo de la respuesta. */
  detail?: string;
  /** Bytes de la imagen. Vacío cuando hay error. */
  buffer: Buffer;
}

const EMPTY = Buffer.alloc(0);

/** Valida un data URL de canvas (`data:image/png;base64,…`). */
export async function validateSignatureDataUrl(input: unknown): Promise<SignatureCheck> {
  if (typeof input !== "string" || !input.startsWith("data:image/")) {
    return { error: "Firma inválida", status: 400, buffer: EMPTY };
  }
  const buffer = Buffer.from(input.split(",")[1] ?? "", "base64");
  if (buffer.length === 0) {
    return { error: "Firma vacía", status: 400, buffer: EMPTY };
  }
  if (buffer.length > MAX_SIGNATURE_BYTES) {
    return {
      error: "La firma excede el tamaño permitido (máx 5 MB).",
      status: 413,
      buffer: EMPTY,
    };
  }
  const magicError = await validateMagicNumber(buffer, ALLOWED_SIGNATURE_MIMES);
  if (magicError) {
    return {
      error: "Archivo no válido: el contenido no coincide con la extensión",
      status: 400,
      detail: magicError,
      buffer: EMPTY,
    };
  }
  return { error: null, status: 200, buffer };
}

/**
 * Sube la firma al bucket PRIVADO y devuelve el path interno que se guarda en
 * la fila. Nunca se guarda una URL: la signed URL se genera on-demand cuando
 * alguien lee el documento (ver signMaybeUrl).
 *
 * Devuelve null si el guardado falla — el caller decide si eso invalida la
 * operación (en la firma del paciente NO: perder la imagen es malo, pero perder
 * el consentimiento del paciente que ya lo dio es peor).
 */
export async function uploadSignature(path: string, buffer: Buffer): Promise<string | null> {
  try {
    const supabase = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { error } = await supabase.storage
      .from(BUCKETS.PATIENT_FILES)
      .upload(path, buffer, { contentType: "image/png", upsert: true });
    if (error) {
      console.error("[consent/signature] upload falló:", error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.error("[consent/signature] excepción al subir:", e);
    return null;
  }
}

/** Path canónico de cada firma dentro del bucket. */
export function signaturePath(
  clinicId: string,
  consentId: string,
  who: "patient" | "doctor" | "witness1" | "witness2",
): string {
  const suffix = who === "patient" ? "" : `-${who}`;
  return `signatures/${clinicId}/${consentId}${suffix}.png`;
}
