import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { negarApiPorCategoria } from "@/lib/dashboard/guardia-categoria.server";
import { prisma } from "@/lib/prisma";

// Exercise library stored as InventoryItem with category="exercise_library"
// Mapping: name -> exercise name, description -> exercise description,
// unit -> muscle group, quantity -> default sets, minQuantity -> default reps
//
// ws1-t4 (defensivo, sin cambio de comportamiento): los selects explícitos
// de este archivo evitan que este endpoint dependa de columnas nuevas de
// InventoryItem (unitCost, ws1-t4; quantityPrecise, ws1-t5) que no le
// interesan — ver la misma nota en dashboard/exercises/page.tsx.
const EXERCISE_SELECT = {
  id: true, name: true, description: true, unit: true,
  quantity: true, minQuantity: true, createdAt: true,
} as const;

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Guardia de categoría (sesión): 403 si el giro de la clínica no tiene esta función.
  const fuera = negarApiPorCategoria("/dashboard/exercises", ctx.clinicCategory);
  if (fuera) return fuera;

  const exercises = await prisma.inventoryItem.findMany({
    where: { clinicId: ctx.clinicId, category: "exercise_library" },
    orderBy: [{ unit: "asc" }, { name: "asc" }],
    select: EXERCISE_SELECT,
  });

  // Transform to exercise-friendly shape
  const result = exercises.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    muscleGroup: e.unit,
    defaultSets: e.quantity,
    defaultReps: e.minQuantity,
    createdAt: e.createdAt,
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Guardia de categoría (sesión): 403 si el giro de la clínica no tiene esta función.
  const fuera = negarApiPorCategoria("/dashboard/exercises", ctx.clinicCategory);
  if (fuera) return fuera;

  const body = await req.json();
  const { name, description, muscleGroup, defaultSets, defaultReps } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const item = await prisma.inventoryItem.create({
    data: {
      clinicId: ctx.clinicId,
      name: name.trim(),
      description: description ?? null,
      category: "exercise_library",
      emoji: "\ud83c\udfcb\ufe0f",
      quantity: defaultSets ? Number(defaultSets) : 3,
      minQuantity: defaultReps ? Number(defaultReps) : 10,
      unit: muscleGroup ?? "general",
    },
    select: EXERCISE_SELECT,
  });

  return NextResponse.json(
    {
      id: item.id,
      name: item.name,
      description: item.description,
      muscleGroup: item.unit,
      defaultSets: item.quantity,
      defaultReps: item.minQuantity,
      createdAt: item.createdAt,
    },
    { status: 201 }
  );
}
