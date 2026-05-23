import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { Supplier, SupplierStatus, SupplierUserRole } from "@prisma/client";

/**
 * Contexto de sesión de un usuario de PROVEEDOR. El proveedor es global
 * (sin clinicId). supplierId SIEMPRE sale de la sesión, nunca del request.
 * Devuelve null si no hay sesión Supabase o el usuario no es de proveedor.
 */
export interface SupplierContext {
  supplierUserId: string;
  supplierId: string;
  supplier: Supplier;
  role: SupplierUserRole;
  status: SupplierStatus;
}

export async function getSupplierContext(): Promise<SupplierContext | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const su = await prisma.supplierUser.findFirst({
      where: { supabaseId: user.id, isActive: true },
      include: { supplier: true },
      orderBy: { createdAt: "asc" },
    });
    if (!su) return null;

    return {
      supplierUserId: su.id,
      supplierId: su.supplierId,
      supplier: su.supplier,
      role: su.role,
      status: su.supplier.status,
    };
  } catch {
    return null;
  }
}
