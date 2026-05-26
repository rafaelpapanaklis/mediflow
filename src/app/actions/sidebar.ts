"use server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Secciones colapsables del sidebar. Mantener en sync con COLLAPSIBLE_SECTIONS
// del componente Sidebar. "workspace" no lleva título, así que no es colapsable.
const COLLAPSIBLE_SECTIONS = new Set(["clinico", "catalogo", "specialties", "admin"]);

/**
 * Marca/desmarca una sección del sidebar como colapsada para el usuario EN
 * SESIÓN. El userId sale SIEMPRE de la sesión (getCurrentUser), nunca del body.
 * El nuevo array se computa server-side a partir del estado actual del usuario,
 * saneando valores desconocidos. Devuelve el array resultante.
 */
export async function setSidebarSectionCollapsed(section: string, collapsed: boolean) {
  if (!COLLAPSIBLE_SECTIONS.has(section)) {
    return { ok: false as const, error: "invalid_section" };
  }

  const user = await getCurrentUser();

  const next = new Set(
    (user.sidebarCollapsed ?? []).filter((s) => COLLAPSIBLE_SECTIONS.has(s)),
  );
  if (collapsed) next.add(section);
  else next.delete(section);

  const sidebarCollapsed = Array.from(next);
  await prisma.user.update({
    where: { id: user.id },
    data: { sidebarCollapsed },
  });

  return { ok: true as const, sidebarCollapsed };
}
