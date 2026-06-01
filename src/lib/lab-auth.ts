import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { DentalLab, DentalLabStatus, DentalLabUserRole } from "@prisma/client";

/**
 * Contexto de sesión de un usuario de LABORATORIO. El laboratorio es global
 * (sin clinicId). labId SIEMPRE sale de la sesión, nunca del request body.
 * Devuelve null si no hay sesión Supabase o el usuario no es de laboratorio.
 */
export interface DentalLabContext {
  labUserId: string;
  labId: string;
  lab: DentalLab;
  role: DentalLabUserRole;
  status: DentalLabStatus;
}

export async function getDentalLabContext(): Promise<DentalLabContext | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const lu = await prisma.dentalLabUser.findFirst({
      where: { supabaseId: user.id, isActive: true },
      include: { lab: true },
      orderBy: { createdAt: "asc" },
    });
    if (!lu) return null;

    return {
      labUserId: lu.id,
      labId: lu.labId,
      lab: lu.lab,
      role: lu.role,
      status: lu.lab.status,
    };
  } catch {
    return null;
  }
}
