export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext, eduUserDisplayName } from "@/lib/edu-auth";
import { hasEduPermission, type EduPermissionKey } from "@/lib/edu/permissions";
import {
  EDU_BRAND,
  EDU_NAV_ITEMS,
  EDU_NAV_LABELS,
  EDU_NAV_SECTION_LABELS,
  EDU_NAV_SECTION_ORDER,
  EDU_ROLE_LABELS,
  type EduNavItem,
} from "@/lib/edu/types";
import { EduShell } from "@/components/edu/edu-shell";
import "../edu-theme.css";

export const metadata: Metadata = {
  title: EDU_BRAND.full,
  robots: { index: false, follow: false },
};

/**
 * Shell del panel de DaleControl INSTITUCIONAL.
 *
 * 🔴 ÉSTE es el gate AUTORITATIVO del vertical: sin contexto de instituto,
 * a la calle. src/middleware.ts refresca la cookie de Supabase en /instituto
 * pero corre en el Edge y no puede consultar Prisma — no sabe si esta
 * persona es de un instituto. Quien lo sabe es este layout, y por eso
 * ninguna pantalla de las olas que siguen tiene que repetir el check de
 * sesión: le basta con vivir bajo el grupo (panel).
 *
 * Aquí NO se corta por contrato vencido. El contrato AVISA (banner en
 * Inicio, ver src/lib/edu/contract.ts): 120 alumnos con pacientes en el
 * sillón no se quedan fuera por una fecha administrativa.
 *
 * La navegación se resuelve AQUÍ (server), filtrando por permiso. El
 * sidebar solo pinta. En la Ola 0 sale un item porque hay una pantalla:
 * cada ola agrega el suyo en EDU_NAV_ITEMS y no toca este archivo.
 */
export default async function InstitutoPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };

  const items: EduNavItem[] = EDU_NAV_ITEMS.filter((item) => {
    if (!item.permission) return true;
    return hasEduPermission(permUser, item.permission as EduPermissionKey);
  }).map((item) => ({
    key: item.key,
    href: item.href,
    icon: item.icon,
    section: item.section,
    label: EDU_NAV_LABELS[item.key] ?? item.key,
  }));

  const nombre = eduUserDisplayName(ctx.user);
  const iniciales =
    [ctx.user.firstName, ctx.user.lastName]
      .filter(Boolean)
      .map((p) => p.trim().charAt(0).toUpperCase())
      .join("")
      .slice(0, 2) || nombre.charAt(0).toUpperCase();

  return (
    <EduShell
      institutionName={ctx.institution.name}
      brandName={EDU_BRAND.product}
      brandSub={EDU_BRAND.vertical}
      userName={nombre}
      userInitials={iniciales}
      roleLabel={EDU_ROLE_LABELS[ctx.role] ?? ctx.role}
      items={items}
      sectionOrder={EDU_NAV_SECTION_ORDER}
      sectionLabels={EDU_NAV_SECTION_LABELS}
    >
      {children}
    </EduShell>
  );
}
