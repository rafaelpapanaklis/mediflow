"use server";
/**
 * Server Actions del carrito de marketplace (Sprint 2).
 *
 * Multi-tenant: el clinicId siempre sale de getAuthContext(), nunca del
 * cliente. Validación con zod del cuid del módulo. Cada mutación llama
 * revalidatePath('/dashboard/marketplace') para refrescar el server
 * component.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";

// Validamos solo "string no vacío" — el seed creó IDs como UUIDs
// (gen_random_uuid()::text), no CUIDs, aunque el schema dice @default(cuid()).
// La integridad referencial la garantiza Prisma vía findUnique abajo.
const moduleIdSchema = z.string().min(1, { message: "moduleId requerido" });

export interface CartActionResult {
  ok: boolean;
  error?: string;
  /** Lista actualizada de moduleIds tras la mutación. */
  moduleIds?: string[];
}

/**
 * Agrega un módulo al carrito de la clínica activa.
 * Falla si el módulo ya está comprado (status='active' en ClinicModule).
 * Idempotente respecto al carrito: si ya está agregado, no lo duplica.
 */
export async function addToCart(moduleId: string): Promise<CartActionResult> {
  const parsed = moduleIdSchema.safeParse(moduleId);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ID inválido" };
  }

  const ctx = await getAuthContext();
  if (!ctx) return { ok: false, error: "No autenticado" };

  // Verificar que el módulo existe y está activo en el catálogo.
  const mod = await prisma.module.findUnique({
    where: { id: parsed.data },
    select: { id: true, isActive: true },
  });
  if (!mod || !mod.isActive) {
    return { ok: false, error: "Módulo no disponible" };
  }

  // Verificar que no esté ya comprado por la clínica.
  const existing = await prisma.clinicModule.findFirst({
    where: {
      clinicId: ctx.clinicId,
      moduleId: parsed.data,
      status: "active",
    },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: "Este módulo ya está activo en tu clínica" };
  }

  // Upsert dedupeado: leemos el carrito existente, agregamos si falta.
  const current = await prisma.cart.findUnique({
    where: { clinicId: ctx.clinicId },
    select: { moduleIds: true },
  });

  const nextIds = current?.moduleIds.includes(parsed.data)
    ? current.moduleIds
    : [...(current?.moduleIds ?? []), parsed.data];

  await prisma.cart.upsert({
    where:  { clinicId: ctx.clinicId },
    create: { clinicId: ctx.clinicId, moduleIds: nextIds },
    update: { moduleIds: nextIds },
  });

  revalidatePath("/dashboard/marketplace");
  return { ok: true, moduleIds: nextIds };
}

/**
 * Elimina un módulo del carrito. No falla si no estaba.
 */
export async function removeFromCart(moduleId: string): Promise<CartActionResult> {
  const parsed = moduleIdSchema.safeParse(moduleId);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "ID inválido" };
  }

  const ctx = await getAuthContext();
  if (!ctx) return { ok: false, error: "No autenticado" };

  const cart = await prisma.cart.findUnique({
    where: { clinicId: ctx.clinicId },
    select: { moduleIds: true },
  });
  if (!cart) {
    return { ok: true, moduleIds: [] };
  }

  const nextIds = cart.moduleIds.filter((id) => id !== parsed.data);
  await prisma.cart.update({
    where: { clinicId: ctx.clinicId },
    data:  { moduleIds: nextIds },
  });

  revalidatePath("/dashboard/marketplace");
  return { ok: true, moduleIds: nextIds };
}

/**
 * Vacía el carrito por completo. Idempotente.
 */
export async function clearCart(): Promise<CartActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false, error: "No autenticado" };

  await prisma.cart.upsert({
    where:  { clinicId: ctx.clinicId },
    create: { clinicId: ctx.clinicId, moduleIds: [] },
    update: { moduleIds: [] },
  });

  revalidatePath("/dashboard/marketplace");
  return { ok: true, moduleIds: [] };
}
