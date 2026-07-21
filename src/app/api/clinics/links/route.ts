import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import {
  getOwnedClinicIds,
  getOwnedBranches,
  listPatientLinks,
  createPatientLink,
} from "@/lib/branches";
import { persistentRateLimit } from "@/lib/failban";
import { logMutation } from "@/lib/audit";
import { logError } from "@/lib/safe-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * MULTI-CLÍNICA · FASE 2 — vínculos de PACIENTES COMPARTIDOS entre sedes.
 *
 * GET  /api/clinics/links  → sedes del dueño + vínculos vigentes entre ellas.
 * POST /api/clinics/links  → crea el vínculo entre dos de SUS sedes.
 *
 * ANTI-IDOR (el punto crítico de todo el endpoint): los ids del body NUNCA se
 * usan tal cual. Se cotejan contra `getOwnedClinicIds(supabaseId de la SESIÓN)`,
 * que sale de las filas User con rol SUPER_ADMIN. Un id ajeno —o uno propio
 * donde el usuario no sea dueño— se rechaza con 403 antes de tocar la BD.
 *
 * Sólo el DUEÑO (SUPER_ADMIN) opera esto: un ADMIN de sede no puede abrirle el
 * expediente de su sucursal a otra.
 */

/** Vincular sedes es una acción rarísima; 10/min por IP frena cualquier ráfaga. */
const LINKS_RATE_LIMIT = { limit: 10, windowSec: 60 };

const createSchema = z.object({
  clinicAId: z.string().trim().min(1).max(40),
  clinicBId: z.string().trim().min(1).max(40),
});

export async function GET(req: NextRequest) {
  const rl = await persistentRateLimit(req, LINKS_RATE_LIMIT);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Solo el dueño de la cuenta puede administrar las sedes." },
      { status: 403 },
    );
  }

  try {
    const supabaseId: string = ctx.user.supabaseId;
    const branches = await getOwnedBranches(supabaseId);
    const links = await listPatientLinks(branches.map((b) => b.clinicId));
    return NextResponse.json({ branches, links, activeClinicId: ctx.clinicId });
  } catch (err: any) {
    logError("[api/clinics/links GET]", err);
    return NextResponse.json({ error: "No se pudieron cargar las sedes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rl = await persistentRateLimit(req, LINKS_RATE_LIMIT);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Solo el dueño de la cuenta puede compartir pacientes entre sedes." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const { clinicAId, clinicBId } = parsed.data;

  if (clinicAId === clinicBId) {
    return NextResponse.json(
      { error: "No puedes vincular una sede consigo misma." },
      { status: 400 },
    );
  }

  try {
    // ⚠️ NÚCLEO ANTI-IDOR: la pertenencia se recalcula desde la SESIÓN.
    const owned = await getOwnedClinicIds(ctx.user.supabaseId);
    if (owned.indexOf(clinicAId) === -1 || owned.indexOf(clinicBId) === -1) {
      return NextResponse.json(
        { error: "Alguna de las sedes no te pertenece." },
        { status: 403 },
      );
    }

    const link = await createPatientLink({
      clinicXId: clinicAId,
      clinicYId: clinicBId,
      createdById: ctx.userId,
    });

    // Auditoría en la clínica activa (ahí vive el actor), con el par afectado.
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "clinic",
      entityId: link.id,
      action: "create",
      after: { patientLink: true, clinicAId: link.clinicAId, clinicBId: link.clinicBId },
    });

    return NextResponse.json({ link }, { status: 201 });
  } catch (err: any) {
    logError("[api/clinics/links POST]", err);
    return NextResponse.json({ error: "No se pudo vincular las sedes" }, { status: 500 });
  }
}
