"use client";

import Link from "next/link";
import { Contact, LifeBuoy, Store, Users } from "lucide-react";
import { adminStyles as s, useT } from "./admin-ui";

// ═══════════════════════════════════════════════════════════════════════
// Barra de administración: solo las pestañas.
//
// Antes traía TAMBIÉN un selector de sede («Barbería Prueba DaleControl ▾»)
// junto a las pestañas: con el de la barra de arriba eran dos selectores en la
// misma pantalla (Rafael, 16-nov, pase 19). Queda uno solo, el de arriba
// (BarberBranchBadge), igual que en Inicio.
//
// Las pestañas se pintan con los permisos YA resueltos en el servidor: aquí
// no se decide nada de seguridad (esconder una pestaña no es un permiso —
// el gate real vive en cada endpoint con assertBarberPermission).
// ═══════════════════════════════════════════════════════════════════════

export type AdminTabKey = "barberos" | "equipo" | "sucursales" | "soporte";

const TAB_ICONS: Record<AdminTabKey, React.ComponentType<{ size?: number | string }>> = {
  barberos: Contact,
  equipo: Users,
  sucursales: Store,
  soporte: LifeBuoy,
};

const TAB_HREF: Record<AdminTabKey, string> = {
  barberos: "/barber/barberos",
  equipo: "/barber/equipo",
  sucursales: "/barber/sucursales",
  soporte: "/barber/soporte",
};

export interface AdminBranchOption {
  id: string;
  label: string;
  isMainBranch: boolean;
  isActive: boolean;
}

/**
 * Cambio de sede. Después de mover la cookie se hace una navegación DURA, no
 * un router.refresh(): en el dental, refrescar conservaba el estado de los
 * componentes cliente y quedaban en pantalla datos de la clínica anterior —
 * el usuario creía estar viendo una sede y estaba viendo otra.
 *
 * Se navega al pathname SIN query para no arrastrar tampoco un id de la sede
 * vieja (un ticket abierto, por ejemplo), y antes se borra lo que el vertical
 * haya dejado en storage bajo el prefijo "dcb:".
 *
 * No vuelve: la página se recarga completa.
 */
export async function switchBranchAndReload(value: string): Promise<void> {
  try {
    await fetch("/api/barber/branches/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId: value }),
    });
  } catch {
    /* si falla la cookie, la recarga simplemente deja la sede anterior */
  }
  try {
    const wipe = (store: Storage) => {
      Object.keys(store)
        .filter((k) => k.startsWith("dcb:"))
        .forEach((k) => store.removeItem(k));
    };
    wipe(window.sessionStorage);
    wipe(window.localStorage);
  } catch {
    /* navegador sin storage: la recarga dura basta */
  }
  window.location.assign(window.location.pathname);
}

export function AdminNav({
  tabs,
  active,
  supportBadge,
}: {
  tabs: AdminTabKey[];
  active: AdminTabKey;
  supportBadge?: number;
}) {
  const t = useT();
  return (
    <div className={s.adminBar}>
      <nav className={s.tabs} aria-label={t("nav.section")}>
        {tabs.map((key) => {
          const Icon = TAB_ICONS[key];
          const isActive = key === active;
          return (
            <Link
              key={key}
              href={TAB_HREF[key]}
              aria-current={isActive ? "page" : undefined}
              className={s.tab}
            >
              <Icon size={15} />
              <span>{t(`nav.${key}`)}</span>
              {key === "soporte" && supportBadge ? (
                <span className={s.tabBadge}>{supportBadge}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
