import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { BUCKETS, esPathDeLaClinica, extractStoragePath, signMaybeUrlDeLaClinica, signMaybeUrlsDeLaClinica } from "@/lib/storage";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // M6/B7: las fotos de antes/después son de la familia de radiografías y
  // archivos del paciente (su POST pide xrays.upload); leerlas no pedía nada.
  const sinVer = denyIfMissingPermission(ctx, "xrays.view");
  if (sinVer) return sinVer;

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }

  // Visibilidad por paciente: sin este gate se leían las fotos de un paciente
  // restringido con solo su id.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const photos = await prisma.beforeAfterPhoto.findMany({
    where: { clinicId: ctx.clinicId, patientId },
    include: { patient: { select: { firstName: true, lastName: true } } },
    orderBy: { takenAt: "desc" },
  });

  // Firma cada URL on-demand (TTL 5 min). Tolera tanto paths nuevos como
  // URLs legacy guardadas antes de la migración a bucket privado.
  // Firma todas las URLs en UN round-trip (createSignedUrls) en vez de N×.
  // Solo objetos de ESTA clínica (auditoría nº1): una fila vieja con un path ajeno no se firma.
  const urls = await signMaybeUrlsDeLaClinica(photos.map((p) => p.url), ctx.clinicId);
  const signed = photos.map((p, i) => ({ ...p, url: urls[i] }));

  return NextResponse.json(signed);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: subir una foto de antes/después es SUBIR UN ARCHIVO del
  // paciente, que es literalmente lo que cubre "xrays.upload" — el catálogo lo
  // dice en su propia nota ("POST /api/xrays es también la subida genérica de
  // archivos del paciente: fotos, PDFs, adjuntos de la nota"), y es la key que
  // recepción tiene por default porque es quien toma la foto en la ficha.
  //
  // La asimetría con su hermana DELETE —que exige "medicalRecord.edit"— es
  // deliberada y ya existe igual en radiografías: POST /api/xrays pide
  // "xrays.upload" y DELETE/PATCH de /api/xrays/[id] piden "medicalRecord.edit".
  // Añadir evidencia clínica no es destruirla. Lo que esta línea cierra es la
  // escritura de un READONLY, que es el hallazgo.
  const deniedPerm = denyIfMissingPermission(ctx, "xrays.upload");
  if (deniedPerm) return deniedPerm;

  const body = await req.json();
  const { patientId, category, angle, url, sessionId, notes } = body;

  if (!patientId || !category || !angle || !url) {
    return NextResponse.json({ error: "patientId, category, angle, and url are required" }, { status: 400 });
  }

  // Aceptamos tanto un path interno como una URL de Supabase Storage del
  // bucket privado. Cualquier otra cosa se rechaza para que no entren URLs
  // arbitrarias en la tabla.
  let storedPath: string | null = null;
  if (!url.startsWith("http")) {
    storedPath = url;
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        return NextResponse.json({ error: "URL debe usar https" }, { status: 400 });
      }
      const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
      if (supabaseHost && parsed.host !== supabaseHost) {
        return NextResponse.json({ error: "URL no permitida" }, { status: 400 });
      }
      storedPath = extractStoragePath(url, BUCKETS.PATIENT_FILES);
      if (!storedPath) {
        return NextResponse.json({ error: "URL no pertenece al bucket de archivos" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL inválida" }, { status: 400 });
    }
  }
  // Auditoría cloudflare nº1: el path lo manda el cliente. Solo se acepta un objeto de la carpeta de
  // ESTA clínica (`<clinicId>/…`, donde la app guarda todo lo del paciente): ni el de otra clínica ni
  // los respaldos de la plataforma (`db-backups/…`) ni `..`. Antes se guardaba y se firmaba cualquiera.
  if (!esPathDeLaClinica(storedPath, ctx.clinicId)) {
    return NextResponse.json({ error: "El archivo no es de esta clínica" }, { status: 400 });
  }
  // m3 (revisión ws1-t2): y del MISMO paciente. Toda carpeta de archivos del paciente lleva su id como
  // segmento (`<clinicId>/<patientId>/…`, `<clinicId>/models-3d/<patientId>/…`, `…/orthodontics/<patientId>/…`,
  // `…/dicom-sets/<patientId>/…`). Sin esto, quien sube fotos podía atar a un paciente que ve el archivo de
  // otro paciente —oculto para él, o sin «Ver radiografías»— y el 201 le devolvía la URL firmada.
  if (!storedPath!.split("/").slice(1).includes(String(patientId))) {
    return NextResponse.json({ error: "El archivo no es de este paciente" }, { status: 400 });
  }

  // Verify patient belongs to clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found in this clinic" }, { status: 404 });
  }

  // Visibilidad por paciente: no crear fotos sobre un paciente restringido.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const photo = await prisma.beforeAfterPhoto.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      category,
      angle,
      url: storedPath,
      sessionId: sessionId ?? null,
      notes: notes ?? null,
    },
  });

  await registrarMovimientoDelPaciente({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    patientId,
    entityType: "photo",
    entityId: photo.id,
    action: "create",
    texto: "Subió una foto de antes y después",
    req,
  });

  // Devolvemos URL ya firmada al cliente para render inmediato.
  const signedUrl = await signMaybeUrlDeLaClinica(storedPath, ctx.clinicId).catch(() => "");
  return NextResponse.json({ ...photo, url: signedUrl }, { status: 201 });
}
