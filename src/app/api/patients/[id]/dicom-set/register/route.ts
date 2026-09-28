import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { BUCKETS, signMaybeUrl, getStorageObjectSize, removeFileFromStorage } from "@/lib/storage";
import { storageQuotaError } from "@/lib/storage-quota";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { validateCbctZip } from "@/lib/validate-upload";
import { MAX_SERVER_INSPECT_BYTES } from "@/lib/uploads/patient-study-upload";
import { registrarSubidaRechazada, limiteSubidasPorUsuario } from "@/lib/uploads/validar-archivo";

// Solo caracteres que produce studyStoragePath()/el path que este endpoint
// arma. Cierra ../ y cualquier intento de escaparse de la carpeta aunque el
// prefijo coincida (mismo regex que /uploads/confirm/route.ts).
const SAFE_PATH = /^[a-zA-Z0-9/._-]+$/;

// Registra como PatientFile un set CBCT (.zip) ya subido a Storage vía la signed
// upload URL. Guarda SOLO el path interno; la signed URL se firma bajo demanda.
//
// POST /api/patients/[id]/dicom-set/register  body: { path, name, size }
//
// SEGURIDAD (magic number): los bytes nunca pasan por el servidor durante la
// subida (signed upload URL directa). Igual que /uploads/confirm, aquí SÍ se
// descarga y valida el objeto cuando su tamaño real cae dentro de
// MAX_SERVER_INSPECT_BYTES — arriba de eso (CBCT grandes) se guarda tal cual,
// mismo trade-off documentado ahí (memoria de una función serverless).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // EQ-07 — "Subir radiografías y archivos del paciente" (xrays.upload), el
  // mismo permiso que exige POST /api/xrays. Escribir contra el bucket consume
  // el cupo de almacenamiento del plan (hasta 2 GB por archivo), así que la
  // escritura pide la clave de ESCRITURA, no la de lectura. Recepción la tiene
  // por default —es quien sube los estudios—; READONLY no.
  const deniedPerm = denyIfMissingPermission(ctx, "xrays.upload");
  if (deniedPerm) return deniedPerm;

  // Visibilidad por paciente: 404 si el viewer no puede ver este paciente.
  const denied = await assertPatientVisible(params.id, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  if (!limiteSubidasPorUsuario(`dental:dicom-register:${ctx.userId}`)) {
    return NextResponse.json({ error: "Demasiadas subidas. Espera unos minutos." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const path = String(body?.path ?? "");
  const name = String(body?.name ?? "estudio.zip").slice(0, 120);
  // Solo informativo: NUNCA se valida cuota contra esto (ver abajo).
  const clientSize = Number(body?.size) || null;

  // Seguridad: el path debe pertenecer EXACTAMENTE a esta clínica + paciente
  // (evita registrar un archivo de otra clínica conociendo su path). El
  // `startsWith` NO basta por sí solo — un path como
  // "<mia>/dicom-sets/<id>/../../../<otra-clinica>/x.zip" también empieza
  // con el prefijo propio pero escapa con "..": mismo veto que ya usa
  // /uploads/confirm (revisión ws1-t8).
  if (path !== "" && (!SAFE_PATH.test(path) || path.includes(".."))) {
    return NextResponse.json({ error: "Path inválido" }, { status: 400 });
  }
  if (path !== "" && !path.startsWith(`${ctx.clinicId}/dicom-sets/${params.id}/`)) {
    return NextResponse.json({ error: "Path inválido" }, { status: 400 });
  }
  if (!path) return NextResponse.json({ error: "Falta el path" }, { status: 400 });

  // Tope de almacenamiento del plan. El .zip ya está en el bucket (subida
  // directa), así que si excede la cuota lo borramos para no dejar huérfano.
  //
  // El tamaño se pregunta AL STORAGE, no al cliente: antes se usaba
  // `Number(body.size) || null` dentro de un `if (size)`, así que mandar
  // `size: 0` (o no mandarlo) saltaba la cuota por completo — justo en los
  // archivos más pesados del sistema.
  //
  // FAIL-OPEN documentado: si el storage no devuelve el tamaño (objeto todavía
  // no visible, error de red), NO se bloquea el registro y NO se evalúa la
  // cuota contra el número del cliente; se loguea y se sigue. Lo que nunca
  // ocurre es tomar una decisión de cuota con un dato que el cliente controla.
  const realSize = await getStorageObjectSize(path);
  if (realSize == null) {
    console.warn("[dicom-set/register] sin tamaño real del objeto; cuota NO evaluada", { path, clientSize });
  } else {
    let quotaErr: Awaited<ReturnType<typeof storageQuotaError>> = null;
    try {
      quotaErr = await storageQuotaError(ctx.clinicId, realSize);
    } catch (e) {
      console.error("[dicom-set/register] no se pudo evaluar la cuota, se deja pasar:", e);
    }
    if (quotaErr) {
      try {
        const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
        await admin.storage.from("patient-files").remove([path]);
      } catch {}
      return quotaErr;
    }
  }

  // Se guarda el tamaño REAL si lo hay; el del cliente solo como último recurso
  // para que el listado no quede sin dato (no influye en ninguna cuota).
  const size = realSize ?? clientSize;

  // Inspección de contenido cuando el objeto es lo bastante chico (mismo techo
  // que /uploads/confirm): descarga server↔server (no pasa por el cuerpo de la
  // petición) y valida que sea un .zip real y no un ejecutable disfrazado.
  if (realSize != null && realSize <= MAX_SERVER_INSPECT_BYTES) {
    try {
      const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const dl = await admin.storage.from(BUCKETS.PATIENT_FILES).download(path);
      if (dl.error || !dl.data) {
        console.warn("[dicom-set/register] no se pudo descargar para validar:", dl.error);
      } else {
        const bytes = await dl.data.arrayBuffer();
        const magicError = validateCbctZip(bytes);
        if (magicError) {
          await removeFileFromStorage(path).catch((e) =>
            console.error("[dicom-set/register] no se pudo borrar el objeto inválido:", e),
          );
          await registrarSubidaRechazada({
            clinicId: ctx.clinicId,
            userId: ctx.userId,
            patientId: params.id,
            ruta: "/api/patients/[id]/dicom-set/register",
            motivo: magicError,
            codigo: "tipo_no_permitido",
            nombreOriginal: name,
          });
          return NextResponse.json(
            { error: "Archivo no válido: el contenido no coincide con un set CBCT (.zip)", detalle: magicError },
            { status: 400 },
          );
        }
      }
    } catch (e) {
      console.error("[dicom-set/register] inspección de contenido falló, se deja pasar:", e);
    }
  }

  const record = await prisma.patientFile.create({
    data: {
      patientId: params.id,
      clinicId: ctx.clinicId,
      uploadedBy: ctx.userId,
      name,
      url: path,
      size,
      mimeType: "application/zip",
      category: "SCAN_STL" as any,
    },
    select: { id: true, name: true, url: true, size: true, mimeType: true, createdAt: true },
  });

  const signedUrl = await signMaybeUrl(record.url).catch(() => "");
  return NextResponse.json({ ...record, url: signedUrl }, { status: 201 });
}
