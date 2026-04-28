import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { DEMO_ELEMENTS } from "@/lib/floor-plan/demo-layout";

export const dynamic = "force-dynamic";

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

/**
 * POST /api/clinic-layout/seed-demo
 *
 * Carga el layout DENTAL demo (recepción + 3 consultorios + rayos X +
 * esterilización + baño). Para los sillones del demo:
 *  - Si la clínica ya tiene un Resource(kind=CHAIR) con el mismo
 *    chairLabel, lo reusa.
 *  - Si no existe, lo crea automáticamente.
 *
 * Sobreescribe el layout actual si ya hay uno (con confirm desde el
 * cliente). Solo SUPER_ADMIN/ADMIN.
 */
export async function POST() {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!["SUPER_ADMIN", "ADMIN"].includes(dbUser.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // 1. Crear/match Resources(kind=CHAIR) para cada sillón demo.
    const existingChairs = await prisma.resource.findMany({
      where: { clinicId: dbUser.clinicId, kind: "CHAIR" },
      select: { id: true, name: true, isActive: true },
    });
    const labelToResourceId = new Map<string, string>();
    let nextOrder = existingChairs.length;

    for (const el of DEMO_ELEMENTS) {
      if (el.type !== "sillon" || !el.chairLabel) continue;
      const found = existingChairs.find(
        (c) => c.name.toLowerCase() === el.chairLabel!.toLowerCase(),
      );
      if (found) {
        // Si está inactivo, lo reactivamos.
        if (!found.isActive) {
          await prisma.resource.update({
            where: { id: found.id },
            data: { isActive: true },
          });
        }
        labelToResourceId.set(el.chairLabel, found.id);
      } else {
        const created = await prisma.resource.create({
          data: {
            clinicId: dbUser.clinicId,
            kind: "CHAIR",
            name: el.chairLabel,
            isActive: true,
            orderIndex: nextOrder++,
          },
          select: { id: true },
        });
        labelToResourceId.set(el.chairLabel, created.id);
      }
    }

    // 2. Construir el array elements con ids autoincrementales y resourceId
    //    asociado para sillones.
    let nextId = 1;
    const elements = DEMO_ELEMENTS.map((el) => {
      const base = {
        id: nextId++,
        type: el.type,
        col: el.col,
        row: el.row,
        rotation: el.rotation,
      };
      if (el.type === "sillon" && el.chairLabel) {
        return {
          ...base,
          resourceId: labelToResourceId.get(el.chairLabel) ?? null,
          name: el.chairLabel,
        };
      }
      return base;
    });

    // 3. Upsert layout.
    const layout = await prisma.clinicLayout.upsert({
      where: { clinicId: dbUser.clinicId },
      update: {
        elements: elements as unknown as Prisma.InputJsonValue,
        metadata: {
          zoom: 1,
          panOffset: { x: 0, y: 0 },
          lastEditAt: new Date().toISOString(),
          gridSize: { cols: 32, rows: 24 },
          source: "demo",
        } as unknown as Prisma.InputJsonValue,
      },
      create: {
        clinicId: dbUser.clinicId,
        name: "Layout principal",
        elements: elements as unknown as Prisma.InputJsonValue,
        metadata: {
          zoom: 1,
          panOffset: { x: 0, y: 0 },
          lastEditAt: new Date().toISOString(),
          gridSize: { cols: 32, rows: 24 },
          source: "demo",
        } as unknown as Prisma.InputJsonValue,
      },
    });

    const allChairs = await prisma.resource.findMany({
      where: { clinicId: dbUser.clinicId, kind: "CHAIR", isActive: true },
      select: { id: true, name: true, color: true, orderIndex: true },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({
      layout,
      chairs: allChairs,
      created: { chairs: labelToResourceId.size },
    });
  } catch (err) {
    console.error("[POST /api/clinic-layout/seed-demo]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * POST /api/clinic-layout/seed-demo?empty=1
 * Crea layout vacío sin demo (botón "Empezar de cero" cuando no había
 * layout). Solo si no existe layout previo.
 */
export async function PUT() {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!["SUPER_ADMIN", "ADMIN"].includes(dbUser.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const layout = await prisma.clinicLayout.upsert({
      where: { clinicId: dbUser.clinicId },
      update: {},
      create: {
        clinicId: dbUser.clinicId,
        elements: [] as unknown as Prisma.InputJsonValue,
        metadata: {} as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ layout });
  } catch (err) {
    console.error("[PUT /api/clinic-layout/seed-demo]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
