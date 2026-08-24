"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Contact, LifeBuoy, Store, Users } from "lucide-react";
import { adminStyles as s, useT } from "./admin-ui";

// ═══════════════════════════════════════════════════════════════════════
// Barra de administración: pestañas + selector de sede.
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
  branches,
  activeBranchId,
  isConsolidated,
  canConsolidate,
  supportBadge,
}: {
  tabs: AdminTabKey[];
  active: AdminTabKey;
  branches: AdminBranchOption[];
  activeBranchId: string | null;
  isConsolidated: boolean;
  canConsolidate: boolean;
  supportBadge?: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const currentLabel = isConsolidated
    ? t("branch.all")
    : branches.find((b) => b.id === activeBranchId)?.label ?? branches[0]?.label ?? "";

  async function switchTo(value: string) {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    await switchBranchAndReload(value);
  }

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

      {branches.length > 1 || canConsolidate ? (
        <div className={s.branchPicker} ref={pickerRef}>
          <button
            type="button"
            className={s.branchBtn}
            onClick={() => setOpen((v) => !v)}
            disabled={busy}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <Building2 size={14} />
            <span className={s.branchBtnLabel}>{busy ? t("branch.switching") : currentLabel}</span>
            <ChevronDown size={14} />
          </button>

          {open ? (
            <div className={s.branchMenu} role="listbox" aria-label={t("branch.label")}>
              {canConsolidate ? (
                <button
                  type="button"
                  role="option"
                  aria-checked={isConsolidated}
                  aria-selected={isConsolidated}
                  className={s.branchOption}
                  onClick={() => switchTo("all")}
                >
                  {isConsolidated ? <Check size={14} /> : <span style={{ width: 14 }} />}
                  <span>{t("branch.all")}</span>
                </button>
              ) : null}

              {branches.map((b) => {
                const selected = !isConsolidated && b.id === activeBranchId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="option"
                    aria-checked={selected}
                    aria-selected={selected}
                    className={s.branchOption}
                    onClick={() => switchTo(b.id)}
                  >
                    {selected ? <Check size={14} /> : <span style={{ width: 14 }} />}
                    <span className={s.truncate} style={{ flex: 1 }}>
                      {b.label}
                    </span>
                    {b.isMainBranch ? (
                      <span style={{ fontSize: 10.5, color: "var(--text-4)" }}>
                        {t("branch.main")}
                      </span>
                    ) : null}
                    {!b.isActive ? (
                      <span style={{ fontSize: 10.5, color: "var(--text-4)" }}>
                        {t("branch.closed")}
                      </span>
                    ) : null}
                  </button>
                );
              })}

              <p className={s.branchNote}>{t("branches.switchWarning")}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
