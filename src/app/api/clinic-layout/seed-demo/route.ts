import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { DEMO_ELEMENTS } from "@/lib/floor-plan/demo-layout";
import { TREATMENT_KINDS } from "@/lib/agenda/types";

export const dynamic = "force-dynamic";

// Contexto vía el helper CENTRAL (getAuthContext): misma resolución
// cookie→clínica que la copia local que había aquí (Supabase + prisma a
// mano), pero pasando por los gates de 2FA y de plan vencido que la copia se
// saltaba. ctx.user es la fila User con permissionsOverride normalizado, así
// que sirve tal cual para denyIfMissingPermission.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
}

function isMissingTable(err: unknown): boolean {
  // P2021/42P01 = tabla faltante; P2022/42703 = columna faltante (drift de migración)
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string };
  return e.code === "P2021" || e.code === "P2022" || e.code === "42P01" || e.code === "42703";
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
    // EQ-07: "Editar Mi Clínica Visual" del modal (por default SA/ADMIN, los
    // mismos que dejaba pasar la lista de roles que había aquí), con override.
    const denied = denyIfMissingPermission(dbUser, "clinicLayout.edit");
    if (denied) return denied;

    // 1. Crear/match Resources (lugares de tratamiento) para cada sillón demo.
    const existingChairs = await prisma.resource.findMany({
      where: { clinicId: dbUser.clinicId, kind: { in: [...TREATMENT_KINDS] } },
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
            kind: "SILLA_DENTAL",
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
      where: { clinicId: dbUser.clinicId, kind: { in: [...TREATMENT_KINDS] }, isActive: true },
      select: { id: true, name: true, color: true, orderIndex: true },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({
      layout,
      chairs: allChairs,
      created: { chairs: labelToResourceId.size },
    });
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
    // EQ-07: "Editar Mi Clínica Visual" del modal (por default SA/ADMIN, los
    // mismos que dejaba pasar la lista de roles que había aquí), con override.
    const denied = denyIfMissingPermission(dbUser, "clinicLayout.edit");
    if (denied) return denied;
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
    if (isMissingTable(err)) {
      return NextResponse.json(
        {
          error: "schema_not_migrated",
          hint: "Aplica la migración 20260428100000_clinic_layout en Supabase.",
        },
        { status: 503 },
      );
    }
    console.error("[PUT /api/clinic-layout/seed-demo]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
