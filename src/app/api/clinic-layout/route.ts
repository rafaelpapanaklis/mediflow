import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { revalidateAfter } from "@/lib/cache/revalidate";

export const dynamic = "force-dynamic";

const ElementSchema = z.object({
  id: z.number().int(),
  type: z.string().min(1).max(40),
  col: z.number(),
  row: z.number(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  resourceId: z.string().nullable().optional(),
  name: z.string().max(120).nullable().optional(),
});
const PutSchema = z.object({
  elements: z.array(ElementSchema).max(500),
  metadata: z
    .object({
      zoom: z.number().min(0.2).max(4).optional(),
      panOffset: z.object({ x: z.number(), y: z.number() }).optional(),
      lastEditAt: z.string().optional(),
      gridSize: z
        .object({
          cols: z.number().int().positive(),
          rows: z.number().int().positive(),
        })
        .optional(),
    })
    .optional()
    .nullable(),
  name: z.string().min(1).max(120).optional(),
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

function isMissingTable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string };
  return e.code === "P2021" || e.code === "42P01";
}

/**
 * GET /api/clinic-layout
 * Devuelve el layout activo de la clínica + lista de Resources(kind=CHAIR)
 * disponibles para colocar como sillones. Autocrea un layout vacío si la
 * clínica no tiene uno aún.
 */
export async function GET() {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const [layout, chairs] = await Promise.all([
      prisma.clinicLayout.findUnique({
        where: { clinicId: dbUser.clinicId },
      }),
      prisma.resource.findMany({
        where: { clinicId: dbUser.clinicId, kind: "CHAIR", isActive: true },
        select: { id: true, name: true, color: true, orderIndex: true },
        orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
      }),
    ]);

    if (!layout) {
      // Auto-create layout vacío en primer acceso
      const created = await prisma.clinicLayout.create({
        data: {
          clinicId: dbUser.clinicId,
          elements: [] as unknown as Prisma.InputJsonValue,
          metadata: {} as unknown as Prisma.InputJsonValue,
        },
      });
      return NextResponse.json({ layout: created, chairs });
    }

    return NextResponse.json({ layout, chairs });
  } catch (err) {
    if (isMissingTable(err)) {
      return NextResponse.json(
        {
          error: "schema_not_migrated",
          hint: "Aplica la migración 20260428100000_clinic_layout en Supabase.",
        },
        { status: 503 },
      );
    }
    console.error("[GET /api/clinic-layout]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * PUT /api/clinic-layout — guarda el layout completo (autosave debounced
 * desde el cliente). Reemplaza elements + metadata atómicamente.
 *
 * Solo admin/owner pueden editar; otros roles reciben 403.
 */
export async function PUT(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!["SUPER_ADMIN", "ADMIN"].includes(dbUser.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    // Validar resourceIds: cada chair element debe apuntar a un Resource real
    // de la misma clínica con kind=CHAIR. Además, un mismo Resource no puede
    // ocupar dos casillas del layout (sería ambiguo para drag-to-chair).
    const chairElements = parsed.data.elements.filter((e) => e.resourceId);
    if (chairElements.length > 0) {
      const uniqueIds = new Set(chairElements.map((e) => e.resourceId!));
      if (uniqueIds.size !== chairElements.length) {
        return NextResponse.json(
          { error: "duplicate_resource_in_layout", hint: "Un sillón no puede ocupar dos casillas." },
          { status: 400 },
        );
      }
      const ids = Array.from(uniqueIds);
      const valid = await prisma.resource.findMany({
        where: { id: { in: ids }, clinicId: dbUser.clinicId, kind: "CHAIR" },
        select: { id: true },
      });
      if (valid.length !== ids.length) {
        return NextResponse.json(
          { error: "invalid_chair_reference", hint: "Algún resourceId no existe o no es de esta clínica." },
          { status: 400 },
        );
      }
    }

    const data: Prisma.ClinicLayoutUpdateInput = {
      elements: parsed.data.elements as unknown as Prisma.InputJsonValue,
      metadata: (parsed.data.metadata ?? null) as unknown as Prisma.InputJsonValue,
    };
    if (parsed.data.name) data.name = parsed.data.name;

    const layout = await prisma.clinicLayout.upsert({
      where: { clinicId: dbUser.clinicId },
      update: data,
      create: {
        clinicId: dbUser.clinicId,
        elements: parsed.data.elements as unknown as Prisma.InputJsonValue,
        metadata: (parsed.data.metadata ?? null) as unknown as Prisma.InputJsonValue,
        name: parsed.data.name ?? "Layout principal",
      },
    });

    revalidateAfter("clinicLayout");
    return NextResponse.json({ layout });
  } catch (err) {
    if (isMissingTable(err)) {
      return NextResponse.json(
        {
          error: "schema_not_migrated",
          hint: "Aplica la migración 20260428100000_clinic_layout en Supabase.",
        },
        { status: 503 },
      );
    }
    console.error("[PUT /api/clinic-layout]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
