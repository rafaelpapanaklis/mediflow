import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

// Exercise library stored as InventoryItem with category="exercise_library"
// Mapping: name -> exercise name, description -> exercise description,
// unit -> muscle group, quantity -> default sets, minQuantity -> default reps

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const exercises = await prisma.inventoryItem.findMany({
    where: { clinicId: ctx.clinicId, category: "exercise_library" },
    orderBy: [{ unit: "asc" }, { name: "asc" }],
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
