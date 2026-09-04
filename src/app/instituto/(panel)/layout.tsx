export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext, eduUserDisplayName } from "@/lib/edu-auth";
import { hasEduPermission, type EduPermissionKey } from "@/lib/edu/permissions";
import { eduVisibility } from "@/lib/edu/visibility";
import {
  EDU_BRAND,
  EDU_NAV_ITEMS,
  EDU_NAV_LABELS,
  EDU_NAV_SECTION_LABELS,
  EDU_NAV_SECTION_ORDER,
  EDU_ROLE_LABELS,
  type EduNavItem,
} from "@/lib/edu/types";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduPersonaLinksAllowed } from "@/lib/edu/persona-core";
import { EduShell } from "@/components/edu/edu-shell";
import { EduPersonaLinksProvider } from "@/components/edu/persona/persona-link";
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
 *
 * ── Ola 11 · LA SEDE ────────────────────────────────────────────────────
 * El ALCANCE POR SEDE también se resuelve aquí, y por la misma razón que la
 * navegación: para que exista UN solo sitio donde se decide qué sedes puede
 * ver esta persona. El shell solo pinta el selector.
 *
 * 🔴 CON UNA SOLA SEDE NO SE PINTA NADA. `showPicker` lo decide
 * campus-core.ts y aquí solo se pasa: una escuela de una sede —que son casi
 * todas— no se entera nunca de que esta ola existe.
 *
 * 🔴 Y si las tablas de la ola todavía no están (el .sql sin aplicar),
 * getEduCampusScope devuelve "sin sedes" en vez de reventar: este layout
 * envuelve TODAS las pantallas del vertical, y un throw aquí las dejaría
 * todas en blanco.
 */
export default async function InstitutoPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  // ── 🔴 P2-9 · LA CONTRASEÑA TEMPORAL NO SE QUEDA PARA SIEMPRE ────────
  // Cuando el sistema GENERA la contraseña (el alta de equipo), quien dio
  // de alta la CONOCIÓ. Para un expediente clínico no basta pedir de
  // palabra que la cambien: hasta que la persona define la suya, el panel
  // no se usa. La bandera se escribía desde la Ola 1B y nadie la leía —
  // este es el lector. Corre en CADA render del panel (force-dynamic) con
  // la base en la mano, así que no se salta navegando directo.
  //
  // La pantalla vive FUERA del grupo (panel) —/instituto/cambiar-contrasena,
  // hermana del login— a propósito: si viviera dentro, este redirect la
  // alcanzaría a ella misma y sería un bucle. Es el espejo del gate del
  // dental (dashboard/layout.tsx), con la salida resuelta por ubicación en
  // vez de por comparación de pathname.
  if (ctx.user.mustChangePassword) redirect("/instituto/cambiar-contrasena");

  const sede = await getEduCampusScope(ctx);

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };

  // ── Ola 12 · AGENDA vs. MI AGENDA: cada quien la suya ─────────────────
  // La parrilla por sillón ("Agenda") es la herramienta de quien piensa en
  // "¿qué sillón está libre?" — caja y dirección, que ven el día ENTERO. A
  // un alumno esa parrilla le sale llena de columnas "Sin citas" que no son
  // suyas, y a un docente tampoco le sirve: lo suyo es el día de sus
  // alumnos. Por eso el menú reparte por ALCANCE, no por una key nueva:
  //   · alcance "all" (caja, dirección)      → ve "Agenda", no "Mi agenda"
  //   · alcance recortado (alumno, docente)  → ve "Mi agenda", no "Agenda"
  // Se decide por alcance y no por rol suelto para que un override raro no
  // deje a nadie con una pantalla que le miente. Y no es solo el menú: la
  // PANTALLA de agenda redirige a /mi-dia a quien llega recortado — el
  // item escondido nunca es el candado.
  const apptScope = eduVisibility(ctx, "appointments");
  // Ola de Casos: a CAJA el recurso "cases" le devuelve "none" SIEMPRE
  // (aunque un override le encienda casos.view por error) — el item se
  // esconde también por alcance, como Agenda/Mi agenda. Y como siempre, el
  // item escondido no es el candado: la pantalla y la API vuelven a cerrar.
  const caseScope = eduVisibility(ctx, "cases");

  const items: EduNavItem[] = EDU_NAV_ITEMS.filter((item) => {
    if (item.key === "agenda" && apptScope.kind !== "all") return false;
    if (item.key === "mi-dia" && apptScope.kind === "all") return false;
    if (item.key === "casos" && caseScope.kind === "none") return false;
    if (!item.permission) return true;
    return hasEduPermission(permUser, item.permission as EduPermissionKey);
  }).map((item) => ({
    key: item.key,
    href: item.href,
    icon: item.icon,
    section: item.section,
    label: EDU_NAV_LABELS[item.key] ?? item.key,
    matchPrefixes: item.matchPrefixes,
  }));

  // ── Ola de PERSONAS · quién puede abrir la ficha de quién ─────────────
  // Los tres booleanos se resuelven AQUÍ, en el servidor y una sola vez, por
  // la misma razón que la navegación y el alcance por sede: para que exista
  // UN sitio donde se decide. El componente que pinta el nombre
  // (EduPersonaLink) solo lee el contexto; si preguntara por su cuenta,
  // habría noventa sitios decidiendo lo mismo.
  //
  // 🔴 Esto decide si se PINTA un enlace, no si se puede entrar: cada ficha
  // vuelve a exigir su permiso en el servidor. Un nombre que no enlaza no es
  // un candado, igual que un item de menú escondido nunca lo fue.
  const personaLinks = eduPersonaLinksAllowed((k) =>
    hasEduPermission(permUser, k as EduPermissionKey),
  );

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
      campusOptions={sede.options}
      campusActiveId={sede.activeId}
      campusAllLabel={sede.allLabel}
      showCampusPicker={sede.showPicker}
      brandName={EDU_BRAND.product}
      brandSub={EDU_BRAND.vertical}
      userName={nombre}
      userInitials={iniciales}
      roleLabel={EDU_ROLE_LABELS[ctx.role] ?? ctx.role}
      items={items}
      sectionOrder={EDU_NAV_SECTION_ORDER}
      sectionLabels={EDU_NAV_SECTION_LABELS}
    >
      {/* `children` sigue entrando como SLOT: el proveedor es un cliente, pero
          recibe el árbol ya construido por este Server Component, así que las
          pantallas del panel siguen siendo server. Mismo patrón que EduShell. */}
      <EduPersonaLinksProvider value={personaLinks}>{children}</EduPersonaLinksProvider>
    </EduShell>
  );
}
