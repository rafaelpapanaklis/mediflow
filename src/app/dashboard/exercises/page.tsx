export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ExercisesClient } from "./exercises-client";

export const metadata: Metadata = { title: "Ejercicios — MediFlow" };

export default async function ExercisesPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const exercises = await prisma.inventoryItem.findMany({
    where: { clinicId, category: "exercise_library" },
    orderBy: { name: "asc" },
  });

  return <ExercisesClient initialExercises={exercises as any} />;
}
