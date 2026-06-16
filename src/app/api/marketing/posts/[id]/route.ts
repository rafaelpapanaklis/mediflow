// CRUD de MarketingPost — recurso individual (WS-MKT-T3).
// GET    /api/marketing/posts/:id  → un post (clinic-scoped) para precargar el editor
// PATCH  /api/marketing/posts/:id  → editar (solo DRAFT/SCHEDULED/FAILED; jamás PUBLISHED)
// DELETE /api/marketing/posts/:id  → borrar (mismas reglas de estado)

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { PatchSchema, isEditable, errorResponse, IG_CAPTION_MAX, assertChannelConnected } from "../_shared";

export const dynamic = "force-dynamic";

// Next 14.2.x: params SÍNCRONOS (no Promise).
type Ctx = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const post = await prisma.marketingPost.findFirst({
      where: { id: params.id, clinicId: ctx.clinicId }, // aislamiento por clínica
    });
    if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ post });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const existing = await prisma.marketingPost.findFirst({
      where: { id: params.id, clinicId: ctx.clinicId },
    });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!isEditable(existing.status)) {
      return NextResponse.json(
        { error: "not_editable", hint: "Solo se pueden editar borradores, programados o fallidos." },
        { status: 409 },
      );
    }

    const d = parsed.data;
    const data: any = {}; // updatedAt lo fija Prisma (@updatedAt) automáticamente
    if (d.channel !== undefined) data.channel = d.channel;
    if (d.caption !== undefined) data.caption = d.caption;
    if (d.mediaUrls !== undefined) data.mediaUrls = d.mediaUrls;
    if (d.status !== undefined) data.status = d.status;
    if (d.scheduledFor !== undefined) data.scheduledFor = d.scheduledFor ? new Date(d.scheduledFor) : null;

    // Coherencia del estado resultante (mezcla de lo enviado + lo existente).
    const finalChannel = d.channel ?? existing.channel;
    const finalMedia = d.mediaUrls ?? existing.mediaUrls ?? [];

    if (d.publishNow) {
      // Editar y publicar ya: exige conexión del canal y fija la fecha = ahora
      // (mismo contrato que crear con publishNow). El worker (T5) la procesa.
      const connErr = await assertChannelConnected(ctx.clinicId, finalChannel as any);
      if (connErr) return connErr;
      if (finalChannel !== "FACEBOOK" && finalMedia.length === 0) {
        return NextResponse.json(
          { error: "invalid_payload", issues: [{ path: ["mediaUrls"], message: "Instagram requiere al menos una imagen" }] },
          { status: 400 },
        );
      }
      data.status = "SCHEDULED";
      data.scheduledFor = new Date();
    } else {
      const finalStatus = d.status ?? existing.status;
      if (finalStatus === "DRAFT") {
        data.scheduledFor = null; // un borrador nunca conserva fecha
      } else if (finalStatus === "SCHEDULED") {
        const finalScheduled =
          d.scheduledFor !== undefined
            ? d.scheduledFor
              ? new Date(d.scheduledFor)
              : null
            : existing.scheduledFor;
        // Solo validamos "futuro" si el usuario fija la fecha o recién entra a
        // SCHEDULED; así editar solo el texto de un programado ya vencido no se bloquea.
        const validateFuture = d.scheduledFor !== undefined || existing.status !== "SCHEDULED";
        if (validateFuture) {
          const t = finalScheduled ? new Date(finalScheduled).getTime() : NaN;
          if (!finalScheduled || isNaN(t) || t <= Date.now()) {
            return NextResponse.json(
              { error: "invalid_payload", issues: [{ path: ["scheduledFor"], message: "La fecha debe ser futura" }] },
              { status: 400 },
            );
          }
        }
        if (finalChannel !== "FACEBOOK" && finalMedia.length === 0) {
          return NextResponse.json(
            { error: "invalid_payload", issues: [{ path: ["mediaUrls"], message: "Instagram requiere al menos una imagen" }] },
            { status: 400 },
          );
        }
        if (finalChannel !== "FACEBOOK" && d.caption !== undefined && d.caption.length > IG_CAPTION_MAX) {
          return NextResponse.json(
            { error: "invalid_payload", issues: [{ path: ["caption"], message: `Instagram permite máximo ${IG_CAPTION_MAX} caracteres` }] },
            { status: 400 },
          );
        }
      }
    }

    // Escritura también acotada por clinicId (defensa en profundidad).
    await prisma.marketingPost.updateMany({
      where: { id: params.id, clinicId: ctx.clinicId },
      data,
    });
    const updated = await prisma.marketingPost.findFirst({
      where: { id: params.id, clinicId: ctx.clinicId },
    });
    return NextResponse.json({ post: updated });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const existing = await prisma.marketingPost.findFirst({
      where: { id: params.id, clinicId: ctx.clinicId },
    });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!isEditable(existing.status)) {
      return NextResponse.json(
        { error: "not_deletable", hint: "No se puede borrar una publicación publicada o en proceso." },
        { status: 409 },
      );
    }
    await prisma.marketingPost.deleteMany({
      where: { id: params.id, clinicId: ctx.clinicId },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return errorResponse(e);
  }
}
