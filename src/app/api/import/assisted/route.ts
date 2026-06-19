import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { BUCKETS } from "@/lib/storage";
import { createTicket } from "@/lib/support/service";

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/import/assisted  (WS2-T2) — Migración asistida.
//
// El usuario sube su respaldo/exportación (cualquier formato, ≤50MB) y el
// equipo de DaleControl la migra a mano. Flujo:
//   1. Sube el archivo al bucket PRIVADO patient-files bajo
//      import-assisted/{clinicId}/ (aislado por clínica, cliente admin).
//   2. Abre un ticket de SOPORTE (módulo existente) → notifica al equipo por
//      email (notifyNewTicket) y le da seguimiento con folio #DC-####.
//   3. Adjunta el archivo al primer mensaje del ticket para que el equipo lo
//      descargue desde /admin/soporte. SIN tabla nueva.
//
// Por qué NO se pasa el archivo por createTicket({ attachments }): el módulo de
// soporte limita adjuntos a 5MB e imágenes/PDF; la migración asistida acepta
// ≤50MB y cualquier formato (Excel, CSV, .zip, .sql…). El adjunto se inyecta
// vía Prisma con un path generado en servidor y acotado por clinicId (seguro);
// la capa de lectura (signMaybeUrls) no re-valida MIME/tamaño, solo firma.
//
// ⚠️ Límite de infra: en Vercel el body de una serverless function tope ~4.5MB.
// Archivos más grandes requieren subida directa a storage (signed upload URL)
// desde el cliente; hoy se respeta el contrato (FormData) y se documenta el
// tope. Ver ORQUESTA / followup.
// ═══════════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024; // 50MB (contrato)
const MAX_NOTE_CHARS = 2000;

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function fullName(ctx: AuthContext): string {
  return `${ctx.user?.firstName ?? ""} ${ctx.user?.lastName ?? ""}`.trim();
}

function safeExt(name: string): string {
  return (
    (name.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "bin"
  );
}

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 5, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
  }

  const file = formData.get("file");
  const noteRaw = (formData.get("note") as string | null) ?? "";

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo supera 50MB" }, { status: 413 });
  }

  const note = noteRaw.toString().slice(0, MAX_NOTE_CHARS).trim();

  // 1. Subir al bucket privado, aislado por clínica.
  const path = `import-assisted/${ctx.clinicId}/${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}.${safeExt(file.name)}`;
  const contentType = file.type || "application/octet-stream";

  try {
    const bytes = await file.arrayBuffer();
    const supabase = getAdminSupabase();
    const { error: uploadError } = await supabase.storage
      .from(BUCKETS.PATIENT_FILES)
      .upload(path, bytes, { contentType, upsert: false });
    if (uploadError) {
      console.error("[import/assisted] storage upload error:", uploadError);
      return NextResponse.json({ error: "No se pudo subir el archivo" }, { status: 500 });
    }
  } catch (e) {
    console.error("[import/assisted] upload exception:", e);
    return NextResponse.json({ error: "No se pudo procesar el archivo" }, { status: 500 });
  }

  // 2. Abrir ticket de soporte (notifica al equipo + folio de seguimiento).
  const clinicName = (ctx.clinic as any)?.name ?? "Clínica";
  const fileLine = `Archivo: ${file.name} (${humanSize(file.size)})`;
  const body =
    `Solicitud de migración asistida.\n\n` +
    (note ? `Nota de la clínica:\n${note}\n\n` : "") +
    `${fileLine}\n` +
    `Ruta interna (bucket privado): ${path}\n\n` +
    `El equipo descargará el archivo adjunto y realizará la migración. ` +
    `Avísale a la clínica cuando esté lista (objetivo ~48 h).`;

  let ticketId: string | undefined;
  try {
    const ticket = await createTicket({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      userName: fullName(ctx),
      subject: `Migración asistida — ${clinicName}`.slice(0, 200),
      category: "DUDA", // el módulo no tiene categoría "migración"; el asunto la identifica
      priority: "ALTA",
      body,
    });
    ticketId = ticket.folioLabel; // "#DC-0001"

    // 3. Adjuntar el archivo al primer (único) mensaje del ticket. Inyección
    //    server-side deliberada: el archivo excede los topes de adjuntos de
    //    soporte (5MB/imagen-PDF) a propósito; el path es de confianza.
    await prisma.supportMessage.updateMany({
      where: { ticketId: ticket.id },
      data: {
        attachments: [
          { path, name: file.name.slice(0, 120), size: file.size, type: contentType },
        ] as any,
      },
    });

    await logAudit({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "clinic",
      action: "create",
      entityId: ticket.id,
      changes: {
        assistedImport: {
          before: null,
          after: { folio: ticket.folioLabel, fileName: file.name, size: file.size, path },
        },
      },
    });
  } catch (e) {
    // El archivo ya está en storage; si el ticket falla no perdemos el upload.
    // El equipo puede ubicarlo por el path; respondemos ok con aviso.
    console.error("[import/assisted] ticket error:", e);
    return NextResponse.json(
      { ok: true, warning: "Archivo recibido; el ticket de seguimiento no se pudo crear automáticamente." },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, ticketId });
}
