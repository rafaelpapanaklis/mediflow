// Clinical-shared — helpers de Storage para ClinicalPhoto.
//
// Usa el bucket privado `patient-files` (mismo que el resto de archivos
// clínicos) bajo el prefix `clinical-photos/<clinicId>/<patientId>/`.
// Esto evita crear un bucket nuevo en producción y reutiliza la RLS
// deny-all de Supabase. El acceso siempre es vía signed URL on-demand.

import { createClient as createAdmin } from "@supabase/supabase-js";
import { BUCKETS, type BucketName } from "@/lib/storage";

const PHOTO_PREFIX = "clinical-photos";

/** Tamaño máximo aceptado para una foto clínica: 8 MB. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Tipos MIME permitidos. */
export const ALLOWED_PHOTO_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

let cached: ReturnType<typeof createAdmin> | null = null;
function admin() {
  if (cached) return cached;
  cached = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  return cached;
}

export interface UploadPhotoArgs {
  clinicId: string;
  patientId: string;
  module: string;
  fileName: string;
  contentType: string;
  body: Buffer | Uint8Array | ArrayBuffer;
}

export interface UploadPhotoResult {
  storagePath: string;
  bucket: BucketName;
}

export function buildPhotoPath(args: {
  clinicId: string;
  patientId: string;
  module: string;
  fileName: string;
}): string {
  const ts = Date.now();
  // Evita path traversal: sanitiza a [a-zA-Z0-9._-], colapsa puntos
  // consecutivos a underscore (para que no quede `..`) y recorta a 80.
  const safeName = args.fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .slice(0, 80);
  return `${PHOTO_PREFIX}/${args.clinicId}/${args.patientId}/${args.module}/${ts}_${safeName}`;
}

/** Sube el binario al bucket privado. Lanza si Supabase devuelve error. */
export async function uploadClinicalPhoto(args: UploadPhotoArgs): Promise<UploadPhotoResult> {
  const path = buildPhotoPath(args);
  const buffer =
    args.body instanceof ArrayBuffer ? Buffer.from(args.body) : Buffer.from(args.body);
  const { error } = await admin()
    .storage.from(BUCKETS.PATIENT_FILES)
    .upload(path, buffer, {
      contentType: args.contentType,
      upsert: false,
    });
  if (error) {
    throw new Error(`Upload de foto clínica falló: ${error.message}`);
  }
  return { storagePath: path, bucket: BUCKETS.PATIENT_FILES };
}

/** Borra el binario del bucket (el row sigue con deletedAt). */
export async function removeClinicalPhotoBinary(path: string): Promise<void> {
  const { error } = await admin().storage.from(BUCKETS.PATIENT_FILES).remove([path]);
  if (error) {
    console.warn("[clinical-photos] remove falló:", error.message);
  }
}
