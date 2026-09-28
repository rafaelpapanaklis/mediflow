export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { exigirCategoriaParaPagina } from "@/lib/dashboard/guardia-categoria.server";
import { prisma } from "@/lib/prisma";
import { ExercisesClient } from "./exercises-client";

export const metadata: Metadata = { title: "Ejercicios — DaleControl" };

export default async function ExercisesPage() {
  // Guardia de categoría EN LA PÁGINA (no en un layout): esta pantalla solo abre
  // para las clínicas cuyo giro la tiene. La categoría sale de la sesión.
  const user = await exigirCategoriaParaPagina("/dashboard/exercises");
  const clinicId = user.clinicId;

  // ws1-t4 (defensivo, sin cambio de comportamiento): select explícito para
  // que esta pantalla no dependa de columnas nuevas de InventoryItem
  // (unitCost, ws1-t4; quantityPrecise, ws1-t5) — sigan existiendo en la
  // base o no, Ejercicios lee exactamente lo mismo que leía hoy.
  const exercises = await prisma.inventoryItem.findMany({
    where: { clinicId, category: "exercise_library" },
    orderBy: { name: "asc" },
    select: {
      id: true, clinicId: true, name: true, description: true, category: true,
      emoji: true, quantity: true, minQuantity: true, unit: true, price: true,
      createdAt: true, updatedAt: true,
    },
  });

  return <ExercisesClient key={clinicId} initialExercises={exercises as any} />;
}
