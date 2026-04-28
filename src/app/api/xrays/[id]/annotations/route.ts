import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

export const dynamic = "force-dynamic";

const PointSchema = z.object({ x: z.number(), y: z.number() });
const AnnotationSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(["ruler", "angle", "freehand"]),
  points: z.array(PointSchema).min(1).max(2000),
  label: z.string().max(200).optional(),
  color: z.string().max(20).optional(),
  createdAt: z.string().datetime().optional(),
});
const PutSchema = z.object({
  annotations: z.array(AnnotationSchema).max(200),
});

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({
      where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { supabaseId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

interface Params { params: { id: string } }

function isMissingColumn(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; message?: string };
  // P2022: column does not exist (Prisma) — la migración no se aplicó aún.
  if (e.code === "P2022") return true;
  if (typeof e.message === "string" && /column .*annotations.* does not exist/i.test(e.message)) {
    return true;
  }
  return false;
}

/** GET /api/xrays/[id]/annotations */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const file = await prisma.patientFile.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true, annotations: true },
    });
    if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const annotations = Array.isArray(file.annotations) ? file.annotations : [];
    return NextResponse.json({ annotations });
  } catch (err) {
    if (isMissingColumn(err)) {
      return NextResponse.json(
        {
          annotations: [],
          warning: "schema_not_migrated",
          hint: "Aplica la migración 20260428000000_xray_annotations.",
        },
        { status: 200 },
      );
    }
    console.error("[GET /api/xrays/:id/annotations]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/** PUT /api/xrays/[id]/annotations — reemplaza el array completo. */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const file = await prisma.patientFile.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true },
    });
    if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });

    await prisma.patientFile.update({
      where: { id: params.id },
      data: { annotations: parsed.data.annotations as unknown as Prisma.InputJsonValue },
    });

    return NextResponse.json({ ok: true, annotations: parsed.data.annotations });
  } catch (err) {
    if (isMissingColumn(err)) {
      return NextResponse.json(
        {
          ok: false,
          warning: "schema_not_migrated",
          hint: "Aplica la migración 20260428000000_xray_annotations.",
        },
        { status: 503 },
      );
    }
    console.error("[PUT /api/xrays/:id/annotations]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/** Alias POST = PUT, para compatibilidad. */
export async function POST(req: NextRequest, params: Params) {
  return PUT(req, params);
}
