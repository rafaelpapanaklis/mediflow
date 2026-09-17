"use client";
import { useEffect, useMemo, useState, useCallback, useRef, Fragment, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Settings,
  ChevronDown, Moon, Sun, LogOut, PanelLeftClose, PanelLeft,
  X, Plus,
} from "lucide-react";
import { useSidebarCounts } from "@/hooks/use-sidebar-counts";
import { useActiveConsult } from "@/hooks/use-active-consult";
import type { Role } from "@prisma/client";
import { hasPermission } from "@/lib/auth/permissions";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { setSidebarSectionCollapsed } from "@/app/actions/sidebar";
import { useT } from "@/i18n/i18n-provider";
import { NewBranchDialog } from "@/components/dashboard/new-branch-dialog";
import type { SidebarBranchInfo } from "@/lib/branches-shared";

import {
  NAV_ITEMS,
  SUSPENDED_NAV_IDS,
  COLLAPSIBLE_SECTIONS,
  isActivePath,
  shouldShowItem,
  type Section,
  type CollapsibleSectionId,
  type NavItemDef,
  type UserRole,
  type ClinicCategory,
  type ClinicPlan,
  type SidebarUser,
} from "@/components/dashboard/sidebar-nav";

// La lista de opciones, sus tipos y el filtro de visibilidad viven en
// sidebar-nav.ts (los comparte el menú de dos niveles). Se reexportan los
// tipos para que los importadores de siempre no cambien.
export type { UserRole, ClinicCategory, ClinicPlan, SidebarUser };

export interface SidebarClinicRef {
  clinicId: string;
  clinicName: string;
  plan?: ClinicPlan;
}

export interface SidebarProps {
  user: SidebarUser;
  clinicName: string;
  clinicId: string;
  plan: ClinicPlan;
  clinicCategory: ClinicCategory;
  allClinics?: SidebarClinicRef[];
  /**
   * Multi-Clínica Fase 1 — cupo de sucursales del DUEÑO y prefills del form
   * "Nueva sucursal". Lo resuelve el layout con getBranchQuota; si viene
   * undefined el switcher se comporta como siempre (solo lista/cambia sedes).
   */
  branches?: SidebarBranchInfo;
  onboardingCompleted?: string[];
  /** Para el mini-status de trial. Null si la clínica nunca tuvo trial. */
  trialEndsAt?: Date | string | null;
  /** True si el trial está vigente (futuro Y sin sub activa). */
  isInTrial?: boolean;
  /**
   * Specialty module keys activas en la clínica (o todas si está en trial
   * vigente). Determinado server-side en el layout vía
   * getActiveClinicModuleKeys(clinicId). Cada item de la sección
   * "Especialidades" se oculta si su `moduleKey` no está en la lista; la
   * sección entera se oculta cuando ningún item pasa el filtro.
   */
  clinicModuleKeys?: string[];
  /**
   * Secciones del sidebar que el usuario tiene colapsadas (persistido en DB:
   * User.sidebarCollapsed). Estado inicial server→client; el toggle se guarda
   * con la server action. Valores: clinico | catalogo | specialties | admin.
   */
  sidebarCollapsed?: string[];
  /**
   * Clínica suspendida / sin plan activo (isPlanExpired en el layout). Cuando
   * es true el sidebar deja el menú normal y muestra SOLO el menú reducido de
   * suspensión (Facturación + Soporte). El layout ya redirige toda navegación
   * que no sea /dashboard/suspended o /dashboard/soporte(/*), así que el menú
   * completo no tendría a dónde llevar.
   */
  isExpired?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Hooks locales
// ═══════════════════════════════════════════════════════════════════

function useBooleanLocalStorage(key: string, defaultValue: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(defaultValue);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === "1") setValue(true);
      else if (raw === "0") setValue(false);
    } catch {}
  }, [key]);

  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try { window.localStorage.setItem(key, v ? "1" : "0"); } catch {}
    },
    [key],
  );

  return [value, set];
}

// ═══════════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════════

export function Sidebar(props: SidebarProps) {
  const t = useT();
  const pathname = usePathname();
  const counts = useSidebarCounts();
  const activeConsult = useActiveConsult().consult;

  const [userCollapsed, setUserCollapsed] = useBooleanLocalStorage("sidebar-collapsed", false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Secciones colapsadas (oculta sus items, deja el título). Estado inicial
  // desde User.sidebarCollapsed (DB, server→client). El toggle es OPTIMISTA y
  // se persiste con la server action sin recargar; si falla, se revierte.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () =>
      new Set(
        (props.sidebarCollapsed ?? []).filter((s) =>
          (COLLAPSIBLE_SECTIONS as readonly string[]).includes(s),
        ),
      ),
  );
  const toggleSection = useCallback(
    (section: CollapsibleSectionId) => {
      const willCollapse = !collapsedSections.has(section);
      setCollapsedSections((prev) => {
        const next = new Set(prev);
        if (willCollapse) next.add(section);
        else next.delete(section);
        return next;
      });
      void setSidebarSectionCollapsed(section, willCollapse)
        .then((res) => {
          if (!res?.ok) throw new Error(res?.error ?? "persist_failed");
        })
        .catch(() => {
          // Revierte el optimismo si la persistencia falló.
          setCollapsedSections((prev) => {
            const next = new Set(prev);
            if (willCollapse) next.delete(section);
            else next.add(section);
            return next;
          });
        });
    },
    [collapsedSections],
  );

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // En laptops/tablets/desktop el sidebar SIEMPRE muestra etiquetas; solo se
  // colapsa a icon-only si el usuario lo pide manualmente (toggle). En teléfonos
  // (isMobile, <=1023.98px) se usa el drawer. El ancho expandido ya se reduce
  // a 196px vía CSS (@media max-width:1280px) sin ocultar los nombres.
  const collapsed = userCollapsed;

  useEffect(() => {
    if (!isMobile) setMobileOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    const handler = () => setMobileOpen(true);
    window.addEventListener("mf:open-mobile-sidebar", handler);
    return () => window.removeEventListener("mf:open-mobile-sidebar", handler);
  }, [isMobile]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  const previousPathname = useRef(pathname);
  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      if (isMobile) setMobileOpen(false);
    }
  }, [pathname, isMobile]);

  const clinicModuleKeys = useMemo(
    () => props.clinicModuleKeys ?? [],
    [props.clinicModuleKeys],
  );

  const visibleItems = useMemo(() => {
    return NAV_ITEMS.filter((item) =>
      shouldShowItem(item, props.user, props.clinicCategory, clinicModuleKeys),
    );
    // Necesitamos depender del array completo (override puede cambiar tras
    // un guardado en /dashboard/team). props.user es el objeto referencial
    // que cambia cuando el layout re-renderiza con datos frescos.
  }, [props.user, props.clinicCategory, clinicModuleKeys]);

  const itemsBySection = useMemo(() => {
    const map: Record<Section, NavItemDef[]> = {
      workspace: [], clinico: [], catalogo: [], specialties: [], admin: [],
    };
    visibleItems.forEach((it) => map[it.section].push(it));
    return map;
  }, [visibleItems]);

  // Clínica suspendida: el sidebar cambia al menú reducido (Facturación +
  // Soporte). Los items se sacan de NAV_ITEMS por id, en orden fijo (ver
  // SUSPENDED_NAV_IDS); Facturación es suspendedOnly, así que sólo aparece aquí.
  const isExpired = props.isExpired ?? false;
  const suspendedItems = useMemo(
    () =>
      SUSPENDED_NAV_IDS
        .map((id) => NAV_ITEMS.find((it) => it.id === id))
        .filter((it): it is NavItemDef => Boolean(it)),
    [],
  );

  const getCount = useCallback((key?: NavItemDef["countKey"]): number => key ? counts[key] : 0, [counts]);

  const renderItem = useCallback(
    (item: NavItemDef) => {
      // "Próximamente": el item se muestra pero NO navega. Mismo layout visual
      // que el Link normal (icono + label) pero sin href, sin hover y con
      // cursor/opacidad de deshabilitado. Badge solo en modo expandido; en
      // colapsado (icon-only) solo opacidad + title nativo.
      if (item.comingSoon) {
        const SoonIcon = item.icon;
        const soonLabel = t(`sidebar.nav.${item.id}`);
        return (
          <div
            key={item.id}
            title={`${soonLabel} · Próximamente`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: collapsed ? 0 : 10,
              // El badge baja a una segunda línea cuando no cabe junto al
              // nombre. A 1280 el sidebar mide 196 px y a la fila le quedan
              // ~112 px para nombre + pastilla: "Marketplace" (74) + "PRÓXIMAMENTE"
              // (90) no entran. Envolver conserva las dos cosas enteras; elidir
              // cualquiera de las dos dejaba texto cortado, que es justo lo que
              // este arreglo viene a quitar. Con sitio de sobra no envuelve y la
              // fila se ve exactamente igual que antes.
              flexWrap: collapsed ? "nowrap" : "wrap",
              rowGap: 2,
              justifyContent: collapsed ? "center" : "flex-start",
              padding: collapsed ? "8px 0" : "5px 10px 5px 12px",
              minHeight: 40,
              borderRadius: 8,
              color: "var(--text-2)",
              fontSize: 13.5,
              fontWeight: 500,
              background: "transparent",
              border: "1px solid transparent",
              whiteSpace: "nowrap",
              cursor: "not-allowed",
              opacity: 0.55,
            }}
          >
            <SoonIcon size={18} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0 }} />
            {!collapsed && (
              <>
                {/* El nombre del item es la información principal: crece con el
                    hueco disponible (flex-basis auto = su ancho natural) y sólo
                    elide cuando ni siquiera cabe él solo. */}
                <span
                  style={{
                    flex: "1 1 auto",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {soonLabel}
                </span>
                {/* El badge es secundario, así que es el que cede el sitio: en
                    vez de encogerse hasta quedar en "PRÓXI…" se va a la línea de
                    abajo (`flexWrap` en la fila). `flexShrink: 0` es lo que fuerza
                    el salto en lugar del recorte. Sin márgenes automáticos: el
                    nombre lleva `flex-grow`, así que en una línea ya empuja el
                    badge contra el borde derecho igual que antes, y al bajar
                    queda alineado a la izquierda en vez de centrado. */}
                <span
                  style={{
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    fontSize: 9,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--text-3)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: 99,
                    padding: "1.5px 6px",
                  }}
                >
                  Próximamente
                </span>
              </>
            )}
          </div>
        );
      }

      const active = isActivePath(pathname, item.href, item.matchExact);
      const count = getCount(item.countKey);
      const Icon = item.icon;
      const hasConsultBadge = item.id === "home" && Boolean(activeConsult);

      const content = (
        <Link
          key={item.id}
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={`mf-sidebar-item ${active ? "mf-sidebar-item--active" : ""}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? "8px 0" : "0 10px 0 12px",
            minHeight: 40,
            borderRadius: 8,
            color: active ? undefined : "var(--text-2)",
            fontSize: 13.5,
            fontWeight: active ? 600 : 500,
            textDecoration: "none",
            background: active ? "var(--brand-soft)" : "transparent",
            border: "1px solid transparent",
            transition: "background var(--dur-1) var(--ease), color var(--dur-1) var(--ease)",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            if (active) return;
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-1)";
          }}
          onMouseLeave={(e) => {
            if (active) return;
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-2)";
          }}
        >
          {/* item.iconColor (token, no hex) pinta SOLO el icono y va en el
              propio <svg>, así que no lo pisan ni el hover ni el `color` del
              estado activo — el item destaca siempre, no solo al pasar. */}
          <Icon size={18} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0, color: item.iconColor }} />
          {!collapsed && (
            <>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {t(`sidebar.nav.${item.id}`)}
              </span>
              {count > 0 && (
                <span className="mf-nav-count" aria-label={t("sidebar.itemPending", { count })}>
                  {count > 99 ? "99+" : count}
                </span>
              )}
              {hasConsultBadge && (
                <span
                  aria-label={t("sidebar.consultInProgress")}
                  title={t("sidebar.consultInProgress")}
                  style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: "var(--success)",
                    boxShadow: "0 0 0 3px var(--success-soft)",
                    flexShrink: 0,
                  }}
                />
              )}
            </>
          )}
          {collapsed && (count > 0 || hasConsultBadge) && (
            <span
              aria-hidden
              className="mf-sidebar-item-dot"
              style={{
                background: hasConsultBadge ? "var(--success)" : "var(--brand)",
                boxShadow: hasConsultBadge
                  ? "0 0 4px rgba(16,185,129,0.6)"
                  : "0 0 4px rgba(124,58,237,0.6)",
              }}
            />
          )}
        </Link>
      );

      if (collapsed) {
        return (
          <Tooltip.Root key={item.id} delayDuration={300}>
            <Tooltip.Trigger asChild>{content}</Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="right"
                sideOffset={8}
                style={{
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 12,
                  color: "var(--text-1)",
                  boxShadow: "0 6px 20px -4px rgba(15,10,30,0.18), 0 2px 8px -2px rgba(15,10,30,0.10)",
                  fontFamily: "var(--font-sans, system-ui, sans-serif)",
                  zIndex: 50,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {t(`sidebar.nav.${item.id}`)}
                {count > 0 && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 10,
                      padding: "1px 5px",
                      borderRadius: 10,
                      background: "var(--brand-soft)",
                      color: "var(--brand)",
                    }}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
                <Tooltip.Arrow width={8} height={4} style={{ fill: "var(--bg-elev)" }} />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        );
      }

      return content;
    },
    [pathname, collapsed, activeConsult, getCount, t],
  );

  const { open: openNewAppointment } = useNewAppointmentDialog();

  const canCreateAppt = (() => {
    if (props.user.role === "SUPER_ADMIN") return true;
    const userForPerm = {
      role: (props.user.role === "ACCOUNTANT" ? "READONLY" : props.user.role) as Role,
      permissionsOverride: props.user.permissionsOverride ?? [],
    };
    return hasPermission(userForPerm, "agenda.create");
  })();

  const sidebarInner = (
    <>
      {/* Marca "105" — degradado SOLO aquí, en el CTA, barra activa y KPI hero */}
      <div
        aria-hidden
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: 9,
          padding: collapsed ? "2px 0 10px" : "2px 10px 12px",
        }}
      >
        <svg width="26" height="26" viewBox="0 0 36 36" aria-hidden="true" style={{ flexShrink: 0 }}>
          <defs>
            <linearGradient id="mf-lg-brand" x1="0" x2="1">
              <stop offset="0" stopColor="#7c3aed" />
              <stop offset="1" stopColor="#2563eb" />
            </linearGradient>
          </defs>
          <path d="M18 4 L31 11 L18 18 L5 11 Z" fill="#efeafe" stroke="#7c3aed" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M5.5 18.5 L18 25.2 L30.5 18.5" fill="none" stroke="url(#mf-lg-brand)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 24.5 L18 31.2 L30.5 24.5" fill="none" stroke="url(#mf-lg-brand)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".45" />
        </svg>
        {!collapsed && (
          <div
            style={{
              fontFamily: "var(--font-logo, var(--font-sans, system-ui, sans-serif))",
              fontSize: 16.5,
              letterSpacing: "-0.025em",
              lineHeight: 1,
              paddingTop: 1,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "var(--brand)", fontWeight: 700 }}>Dale</span>
            <span style={{ color: "var(--text-1)", fontWeight: 600 }}>Control</span>
          </div>
        )}
      </div>

      {isExpired ? (
        // ── Menú reducido de clínica suspendida ──────────────────────────
        // Sólo Facturación + Soporte. Sin CTA de cita, sin secciones/headers,
        // sin especialidades ni onboarding. El switcher SÓLO si el dueño tiene
        // más de una clínica (para poder salir a una activa); con una sola
        // clínica el menú queda mínimo: logo + 2 items + bloque de usuario.
        <>
          {(props.allClinics?.length ?? 0) > 1 && (
            <ClinicSwitcher
              collapsed={collapsed}
              clinicName={props.clinicName}
              clinicId={props.clinicId}
              plan={props.plan}
              allClinics={props.allClinics ?? []}
              branches={props.branches}
            />
          )}
          <nav
            aria-label={t("sidebar.navAria")}
            className="scrollbar-thin"
            style={{
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              paddingInline: collapsed ? 8 : 0,
            }}
          >
            {suspendedItems.map((it) => renderItem(it))}
          </nav>
        </>
      ) : (
      <>
      <ClinicSwitcher
        collapsed={collapsed}
        clinicName={props.clinicName}
        clinicId={props.clinicId}
        plan={props.plan}
        allClinics={props.allClinics ?? []}
        branches={props.branches}
      />

      {canCreateAppt && (
        collapsed ? (
          <Tooltip.Provider delayDuration={150}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  onClick={() => openNewAppointment({ openAgendaAfter: true })}
                  aria-label={t("sidebar.newAppointmentAria")}
                  style={{
                    margin: "8px auto 12px",
                    width: 36,
                    height: 36,
                    display: "grid",
                    placeItems: "center",
                    background: "var(--brand-grad)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    boxShadow: "var(--shadow-2)",
                    transition: "transform var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "var(--shadow-3)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "var(--shadow-2)";
                  }}
                >
                  <Plus size={18} strokeWidth={1.75} aria-hidden />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={8} style={{
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--text-1)",
                  boxShadow: "0 4px 12px rgba(15,10,30,0.15)",
                  zIndex: 200,
                }}>
                  {t("sidebar.newAppointment")}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        ) : (
          <button
            type="button"
            onClick={() => openNewAppointment({ openAgendaAfter: true })}
            aria-label={t("sidebar.newAppointmentAria")}
            style={{
              margin: "10px 12px 14px",
              height: 40,
              padding: "0 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "var(--brand-grad)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
              boxShadow: "var(--shadow-2)",
              transition: "transform var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "var(--shadow-3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "var(--shadow-2)";
            }}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden />
            {t("sidebar.newAppointment")}
          </button>
        )
      )}

      <nav
        aria-label={t("sidebar.navAria")}
        className="scrollbar-thin"
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          paddingInline: collapsed ? 8 : 0,
        }}
      >
        {itemsBySection.workspace.map((it) => renderItem(it))}

        {collapsed
          ? // Modo icon-only: items de cada sección, sin encabezado ni colapso.
            COLLAPSIBLE_SECTIONS.map((sec) =>
              itemsBySection[sec].length > 0 ? (
                <Fragment key={sec}>
                  <div style={{ height: 8 }} />
                  {itemsBySection[sec].map((it) => renderItem(it))}
                </Fragment>
              ) : null,
            )
          : // Modo expandido: cada sección con título + chevron colapsable.
            COLLAPSIBLE_SECTIONS.map((sec) =>
              itemsBySection[sec].length > 0 ? (
                <CollapsibleSection
                  key={sec}
                  id={sec}
                  label={t(`sidebar.section.${sec}`)}
                  collapsed={collapsedSections.has(sec)}
                  onToggle={() => toggleSection(sec)}
                >
                  {itemsBySection[sec].map((it) => renderItem(it))}
                </CollapsibleSection>
              ) : null,
            )}
      </nav>
      </>
      )}

      <SidebarFooter
        collapsed={collapsed}
        onToggleCollapse={() => setUserCollapsed(!userCollapsed)}
        user={props.user}
      />
    </>
  );

  if (isMobile) {
    return (
      <Tooltip.Provider>
        {mobileOpen && (
          <>
            <div
              aria-hidden
              className="mf-sidebar-mobile-overlay"
              onClick={() => setMobileOpen(false)}
              style={{
                position: "fixed", inset: 0,
                background: "rgba(5,5,10,0.72)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                zIndex: 49,
              }}
            />
            <aside
              role="dialog"
              aria-label={t("sidebar.mobileNav")}
              aria-modal="true"
              className="mf-sidebar-mobile-panel"
              style={{
                position: "fixed", top: 0, left: 0, bottom: 0,
                width: "min(280px, 80vw)",
                background: "var(--bg-elev)",
                borderRight: "1px solid var(--border-soft)",
                boxShadow: "4px 0 24px -4px rgba(15,10,30,0.18)",
                zIndex: 50,
                display: "flex",
                flexDirection: "column",
                paddingBlock: 14,
                paddingInline: 10,
                fontFamily: "var(--font-sans, system-ui, sans-serif)",
              }}
            >
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label={t("sidebar.closeNav")}
                style={{
                  position: "absolute",
                  top: 10, right: 10,
                  width: 32, height: 32,
                  display: "grid", placeItems: "center",
                  borderRadius: 8,
                  background: "var(--bg-elev-2)",
                  border: "1px solid var(--border-soft)",
                  color: "var(--text-2)",
                  cursor: "pointer",
                }}
              >
                <X size={14} />
              </button>
              {sidebarInner}
            </aside>
          </>
        )}
      </Tooltip.Provider>
    );
  }

  return (
    <Tooltip.Provider>
      <aside
        aria-label={t("sidebar.asideAria")}
        className={`sidebar-new ${collapsed ? "mf-sidebar--collapsed" : ""}`}
        style={{
          width: collapsed ? 68 : undefined,
          paddingInline: collapsed ? 8 : 10,
          // Variante A: sidebar claro sólido. Inline para no tocar .sidebar-new,
          // que comparten los paneles de labs/proveedores/admin (fuera del piloto).
          background: "var(--bg-elev)",
          borderRight: "1px solid var(--border-soft)",
        }}
      >
        {sidebarInner}
      </aside>
    </Tooltip.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Clinic Switcher
// ═══════════════════════════════════════════════════════════════════

// Al cambiar de clínica (o crear una sede nueva) la ruta actual puede apuntar a
// una entidad de la sede anterior; en el nuevo tenant no existe y el server
// responde 404. safeSwitchDestination() decide a dónde ir: raíz de la sección
// si tiene listado propio, /dashboard si no, o null para quedarse y refrescar.
const SWITCH_SAFE_ROOTS = new Set([
  "patients", "xrays", "suppliers", "laboratorios",
  "compras", "ordenes-laboratorio", "soporte",
]);
const CUID_RE = /^c[a-z0-9]{20,}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Un segmento parece ID de entidad si es UUID, o un cuid (que siempre trae
// dígitos → no confundimos palabras de ruta como "orthodontics" o "settings").
const looksLikeEntityId = (seg: string) =>
  UUID_RE.test(seg) || (CUID_RE.test(seg) && /[0-9]/.test(seg));

function safeSwitchDestination(pathname: string | null): string | null {
  if (!pathname) return null;
  const parts = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  if (parts[0] !== "dashboard") return null;
  if (!parts.some(looksLikeEntityId)) return null; // sin ID → refrescar en sitio
  const section = parts[1];
  return section && SWITCH_SAFE_ROOTS.has(section)
    ? `/dashboard/${section}`
    : "/dashboard";
}

/**
 * Aspecto propio de la tarjeta de clínica. Lo usa el menú de dos niveles: pinta
 * su tarjeta con sus clases y reutiliza TODO lo demás de aquí (cambio de sede,
 * nueva sucursal, administrar sucursales). Sin él, la tarjeta de siempre.
 */
export interface ClinicSwitcherApariencia {
  trigger: (info: { hasMenu: boolean; initials: string }) => ReactNode;
  className: string;
  /** Clase extra del desplegable (que se abre en un portal, fuera del menú). */
  contentClassName?: string;
}

export function ClinicSwitcher({
  collapsed, clinicName, clinicId, plan, allClinics, branches, apariencia,
}: {
  collapsed: boolean;
  clinicName: string;
  clinicId: string;
  plan: ClinicPlan;
  allClinics: SidebarClinicRef[];
  branches?: SidebarBranchInfo;
  apariencia?: ClinicSwitcherApariencia;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [branchOpen, setBranchOpen] = useState(false);
  const hasOthers = allClinics.filter((c) => c.clinicId !== clinicId).length > 0;
  // Sección de sucursales: sólo para el DUEÑO cuyo plan contempla multi-sede
  // (maxClinics ≠ 1). Con un plan sin sucursales no se menciona el tema — el
  // upsell a CLINIC es trabajo de la página de precios, no del sidebar.
  const showBranches = !!branches?.quota.planAllowsBranches && branches.quota.blockedReason !== "ROLE";
  // Sin otras sedes NI acción de sucursal no hay nada que desplegar: se queda
  // como la tarjeta estática de marca de siempre.
  const hasMenu = hasOthers || showBranches;
  const initials = clinicName
    .split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  const switchClinic = async (id: string) => {
    try {
      const res = await fetch("/api/switch-clinic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clinicId: id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // La ruta actual puede apuntar a una entidad (paciente, factura, orden…)
      // de la sede anterior, inexistente en el nuevo tenant → el server haría
      // notFound() (404). Si la ruta lleva un ID salimos a un destino seguro;
      // si no, refrescar en sitio basta.
      const safe = safeSwitchDestination(pathname);
      if (safe) router.push(safe);
      router.refresh();
    } catch {
      window.location.href = "/dashboard";
    }
  };

  const brandContent = (
    <>
      <div
        style={{
          width: 28, height: 28,
          borderRadius: 8,
          background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
          display: "grid", placeItems: "center",
          color: "#fff", fontWeight: 700, fontSize: 11,
          boxShadow: "0 2px 6px rgba(124,58,237,0.35)",
          flexShrink: 0,
        }}
      >
        {initials || "MF"}
      </div>
      {!collapsed && (
        <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
          <div
            style={{
              fontSize: 13, fontWeight: 600,
              color: "var(--text-1)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              letterSpacing: "-0.01em",
            }}
          >
            {clinicName}
          </div>
          <span
            style={{
              display: "inline-block",
              marginTop: 2,
              fontSize: 9.5, fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--brand)",
              background: "var(--brand-soft)",
              borderRadius: 99,
              padding: "1.5px 7px",
              textTransform: "uppercase",
            }}
          >
            {plan}
          </span>
        </div>
      )}
      {!collapsed && hasMenu && (
        <ChevronDown size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} aria-hidden />
      )}
    </>
  );

  const brandStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: collapsed ? "center" : "flex-start",
    gap: 10,
    padding: collapsed ? "6px 4px" : "9px 10px",
    marginBottom: 10,
    width: "100%",
    background: "var(--bg-elev)",
    border: "1px solid var(--border-soft)",
    borderRadius: 10,
    boxShadow: "var(--shadow-1)",
    cursor: hasMenu ? "pointer" : "default",
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
    textAlign: "left",
    transition: "background var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease)",
  };

  if (!hasMenu) {
    if (apariencia) {
      return <div className={apariencia.className}>{apariencia.trigger({ hasMenu, initials })}</div>;
    }
    return <div style={brandStyle}>{brandContent}</div>;
  }

  const triggerProps = apariencia
    ? { className: apariencia.className }
    : {
        style: brandStyle,
        onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.boxShadow = "var(--shadow-2)";
        },
        onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
          e.currentTarget.style.background = "var(--bg-elev)";
          e.currentTarget.style.boxShadow = "var(--shadow-1)";
        },
      };

  return (
    <>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t("sidebar.clinicSwitcherAria", { name: clinicName })}
        {...triggerProps}
      >
        {apariencia ? apariencia.trigger({ hasMenu, initials }) : brandContent}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start" sideOffset={4}
          {...(apariencia?.contentClassName ? { className: apariencia.contentClassName } : {})}
          style={{
            minWidth: 220,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            borderRadius: 10, padding: 4,
            boxShadow: "0 20px 50px -10px rgba(15,10,30,0.25), 0 8px 20px -8px rgba(15,10,30,0.15)",
            zIndex: 50,
            fontFamily: "var(--font-sans, system-ui, sans-serif)",
          }}
        >
          <div
            style={{
              padding: "6px 10px 4px",
              fontSize: 10, fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-3)",
            }}
          >
            {t("sidebar.clinics")}
          </div>
          {allClinics.map((c) => {
            const isCurrent = c.clinicId === clinicId;
            return (
              <DropdownMenu.Item
                key={c.clinicId}
                onSelect={(e) => {
                  if (!isCurrent) {
                    e.preventDefault();
                    switchClinic(c.clinicId);
                  }
                }}
                style={{
                  padding: "8px 10px",
                  fontSize: 13,
                  color: "var(--text-1)",
                  borderRadius: 6,
                  cursor: isCurrent ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  outline: "none",
                  background: isCurrent ? "var(--brand-soft)" : "transparent",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.clinicName}
                </span>
                {isCurrent && (
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.06em",
                      color: "var(--brand)",
                      fontWeight: 600,
                    }}
                  >
                    {t("sidebar.current")}
                  </span>
                )}
              </DropdownMenu.Item>
            );
          })}

          {showBranches && branches && (
            <>
              <DropdownMenu.Separator style={{ height: 1, background: "var(--border-soft)", margin: "4px 0" }} />
              {branches.quota.canCreate ? (
                <DropdownMenu.Item
                  // SIN preventDefault: que el menú cierre solo. El diálogo vive
                  // FUERA de DropdownMenu.Root (abajo), así que cerrar el menú no
                  // lo desmonta, y dejar los dos abiertos pelearía el foco.
                  onSelect={() => setBranchOpen(true)}
                  style={{
                    padding: "8px 10px",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--brand)",
                    borderRadius: 6,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    outline: "none",
                  }}
                >
                  <Plus size={14} aria-hidden />
                  {t("sidebar.branches.new")}
                </DropdownMenu.Item>
              ) : (
                // Tope alcanzado (o suscripción no al día): estado informativo,
                // no accionable. El cobro de la sede extra es follow-up (b).
                <div
                  style={{
                    padding: "8px 10px",
                    fontSize: 11,
                    color: "var(--text-3)",
                    lineHeight: 1.45,
                  }}
                >
                  {branches.quota.blockedReason === "LIMIT"
                    ? t("sidebar.branches.limitReached", {
                        used: String(branches.quota.used),
                        max: String(branches.quota.max),
                      })
                    : t("sidebar.branches.needsSubscription")}
                </div>
              )}
              {/* MULTI-CLÍNICA · FASE 2 — única entrada a la pantalla de
                  sucursales (compartir pacientes entre sedes). Sin esto la
                  página queda huérfana: no se llega más que tecleando la URL.
                  Sólo tiene sentido con 2+ sedes; el guard real (SUPER_ADMIN)
                  vive en la página y en la API. */}
              {branches.quota.used > 1 && (
                <DropdownMenu.Item
                  onSelect={() => router.push("/dashboard/settings/sucursales")}
                  style={{
                    padding: "8px 10px",
                    fontSize: 12,
                    color: "var(--text-2)",
                    borderRadius: 6,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    outline: "none",
                  }}
                >
                  <Settings size={13} aria-hidden />
                  {t("sidebar.branches.manage")}
                </DropdownMenu.Item>
              )}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    {showBranches && branches && (
      <NewBranchDialog
        open={branchOpen}
        onClose={() => setBranchOpen(false)}
        defaults={branches.defaults}
        quota={branches.quota}
        onCreated={() => {
          // El endpoint ya movió la cookie de clínica activa a la sede nueva
          // (vacía). Si veníamos de una ruta con ID de la sede anterior, esa
          // entidad no existe en la nueva → mismo 404: salir a destino seguro.
          setBranchOpen(false);
          const safe = safeSwitchDestination(pathname);
          if (safe) router.push(safe);
          router.refresh();
        }}
      />
    )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Collapsible section (título + chevron; colapsa/expande sus items)
// ═══════════════════════════════════════════════════════════════════

function CollapsibleSection({
  id, label, collapsed, onToggle, children,
}: {
  id: CollapsibleSectionId;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = `mf-sidebar-section-${id}`;
  return (
    <div style={{ marginTop: 14 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          borderRadius: 6,
          color: "var(--text-3)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          transition: "color var(--dur-1) var(--ease)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-2)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; }}
      >
        {/* El rótulo va en su propio <span> elidible: "ADMINISTRACIÓN" es una
            sola palabra (uppercase + letter-spacing) y no puede envolver, así
            que sin esto lo recortaba a pelo el `overflowX:hidden` del <nav>
            ancestro, sin puntos suspensivos. Mismo patrón que renderItem. */}
        <span
          title={label}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className="mf-sidebar-section-chevron"
          data-collapsed={collapsed}
          style={{ flexShrink: 0, marginLeft: "auto", color: "var(--text-4)" }}
        />
      </button>
      <div
        className="mf-sidebar-section-body"
        data-collapsed={collapsed}
        id={bodyId}
      >
        <div
          className="mf-sidebar-section-inner"
          style={{ display: "flex", flexDirection: "column", gap: 2 }}
          {...(collapsed ? ({ inert: "" } as any) : {})}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Footer
// ═══════════════════════════════════════════════════════════════════

/** Cierre de sesión del panel. Lo comparten este pie y el menú de dos niveles. */
export async function cerrarSesionPanel() {
  try {
    // POST al endpoint server: borra cookies httpOnly que el cliente no puede
    // tocar (activeClinicId, df_2fa, df_2fa_pending) y hace signOut server-side.
    // Sin esto, df_2fa podría sobrevivir al logout y saltarse el reto en el
    // siguiente login dentro de su ventana de 12 h.
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    await supabase.auth.signOut();
  } catch (err) {
    console.error("[Sidebar] logout failed", err);
  } finally {
    window.location.href = "/login";
  }
}

function SidebarFooter({
  collapsed, onToggleCollapse, user,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: SidebarUser;
}) {
  const t = useT();
  const [isDark, setIsDark] = useState<boolean>(false);

  useEffect(() => {
    const sync = () => setIsDark(document.documentElement.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;
    const nowDark = !html.classList.contains("dark");
    html.classList.toggle("dark", nowDark);
    try { window.localStorage.setItem("theme", nowDark ? "dark" : "light"); } catch {}
    setIsDark(nowDark);
  };

  const logout = cerrarSesionPanel;

  const displayName = `${user.firstName} ${user.lastName}`.trim();
  const initials = displayName
    .split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  const roleLabel: Record<UserRole, string> = {
    SUPER_ADMIN: t("sidebar.role.owner"),
    ADMIN: t("sidebar.role.admin"),
    DOCTOR: t("sidebar.role.doctor"),
    RECEPTIONIST: t("sidebar.role.receptionist"),
    READONLY: t("sidebar.role.readonly"),
    ACCOUNTANT: t("sidebar.role.accountant"),
  };

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px solid var(--border-soft)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: collapsed ? "column" : "row",
          alignItems: "center",
          gap: collapsed ? 4 : 6,
        }}
      >
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? t("sidebar.switchToLight") : t("sidebar.switchToDark")}
          style={{
            flex: collapsed ? undefined : 1,
            display: "flex",
            alignItems: "center",
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? "8px 0" : "7px 10px",
            borderRadius: 8,
            background: "transparent",
            border: "none",
            color: "var(--text-3)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "background var(--dur-1) var(--ease), color var(--dur-1) var(--ease)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-3)";
          }}
        >
          {isDark ? <Sun size={15} strokeWidth={1.75} aria-hidden /> : <Moon size={15} strokeWidth={1.75} aria-hidden />}
          {!collapsed && (isDark ? t("sidebar.modeLight") : t("sidebar.modeDark"))}
        </button>

        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-pressed={collapsed}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: collapsed ? "100%" : 34,
            padding: collapsed ? "8px 0" : "7px 0",
            borderRadius: 8,
            background: "transparent",
            border: "none",
            color: "var(--text-3)",
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "background var(--dur-1) var(--ease), color var(--dur-1) var(--ease)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-3)";
          }}
        >
          {collapsed ? <PanelLeft size={14} aria-hidden /> : <PanelLeftClose size={14} aria-hidden />}
        </button>
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={t("sidebar.userMenuAria", { name: displayName })}
          style={{
            display: "flex",
            alignItems: "center",
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? "6px 0" : "6px 8px",
            background: "transparent",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
            cursor: "pointer",
            fontFamily: "inherit",
            width: "100%",
            transition: "background var(--dur-1) var(--ease)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <div
            style={{
              width: 28, height: 28,
              borderRadius: "50%",
              background: user.color
                ? `linear-gradient(135deg, ${user.color}, #7c3aed)`
                : "linear-gradient(135deg, #a78bfa, #7c3aed)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              fontWeight: 600,
              fontSize: 10,
              flexShrink: 0,
            }}
          >
            {initials || "?"}
          </div>
          {!collapsed && (
            <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
              <div
                style={{
                  fontSize: 12, fontWeight: 600,
                  color: "var(--text-1)",
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {displayName}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", lineHeight: 1.2 }}>
                {roleLabel[user.role]}
              </div>
            </div>
          )}
          {!collapsed && (
            <ChevronDown size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} aria-hidden />
          )}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start" side="top" sideOffset={6}
            style={{
              minWidth: 180,
              background: "var(--bg-elev)",
              border: "1px solid var(--border-strong)",
              borderRadius: 10, padding: 4,
              boxShadow: "0 20px 50px -10px rgba(15,10,30,0.25), 0 8px 20px -8px rgba(15,10,30,0.15)",
              zIndex: 50,
              fontFamily: "var(--font-sans, system-ui, sans-serif)",
            }}
          >
            <DropdownMenu.Item
              onSelect={logout}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                fontSize: 13,
                color: "var(--danger)",
                borderRadius: 6,
                cursor: "pointer",
                outline: "none",
              }}
            >
              <LogOut size={14} />
              {t("sidebar.logout")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
