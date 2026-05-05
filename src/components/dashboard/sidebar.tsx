"use client";
import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Home, Calendar, Users, MessageCircle, Inbox as InboxIcon,
  Stethoscope, Sparkles, FileImage, Camera, FlaskConical, Dumbbell, Footprints,
  Activity, Gift, DoorOpen, Package, Building2,
  CreditCard, BarChart3, Monitor, UserCog, Globe, ClipboardList, Settings,
  ShoppingBag, Baby, Zap, Smile,
  ChevronDown, ChevronRight, Moon, Sun, LogOut, PanelLeftClose, PanelLeft,
  X, type LucideIcon,
} from "lucide-react";
import { useSidebarCounts } from "@/hooks/use-sidebar-counts";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";
import { TrialSidebarStatus } from "@/components/dashboard/trial-sidebar-status";

// ═══════════════════════════════════════════════════════════════════
// Tipos
// ═══════════════════════════════════════════════════════════════════

export type UserRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "READONLY"
  | "ACCOUNTANT";

export type ClinicCategory =
  | "DENTAL" | "MEDICINE" | "NUTRITION" | "PSYCHOLOGY"
  | "DERMATOLOGY" | "AESTHETIC_MEDICINE" | "HAIR_RESTORATION"
  | "BEAUTY_CENTER" | "BROW_LASH" | "HAIR_SALON"
  | "MASSAGE" | "SPA" | "LASER_HAIR_REMOVAL"
  | "NAIL_SALON" | "PHYSIOTHERAPY" | "PODIATRY"
  | "ALTERNATIVE_MEDICINE" | "OTHER";

export type ClinicPlan = "BASIC" | "PRO" | "CLINIC";

// Shape compatible con el layout actual del repo
export interface SidebarUser {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  color?: string;
  id?: string;
  avatarUrl?: string | null;
  // Override granular del set default del role. Si vacío se usan los
  // defaults; si tiene keys, esas reemplazan al default. El sidebar lo
  // pasa a hasPermission(user, item.permission) para filtrar dinámicamente.
  permissionsOverride?: string[];
}

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
  onboardingCompleted?: string[];
  /** Para el mini-status de trial. Null si la clínica nunca tuvo trial. */
  trialEndsAt?: Date | string | null;
  /** True si el trial está vigente (futuro Y sin sub activa). */
  isInTrial?: boolean;
  /**
   * True si la clínica tiene al menos un módulo de especialidad activo
   * o está en trial. Determinado server-side en el layout vía
   * hasAnyActiveSpecialtyModule(clinicId). Si false, el grupo
   * "Especialidades" se oculta del sidebar.
   */
  hasSpecialtyAccess?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Nav items
// ═══════════════════════════════════════════════════════════════════

type Section = "workspace" | "clinico" | "catalogo" | "specialties" | "admin";

interface NavItemDef {
  id: string;
  section: Section;
  label: string;
  href: string;
  icon: LucideIcon;
  categories?: ClinicCategory[];
  adminOnly?: boolean;
  countKey?: "messagesUnread" | "clinicalDrafts" | "xraysUnanalyzed" | "inboxUnread";
  matchExact?: boolean;
  // Permiso UI requerido para que el item aparezca. Si está vacío, el item
  // se muestra siempre (asumiendo que pasa `categories` y `adminOnly`).
  // Cuando está, se evalúa con hasPermission(user, permission) — el set
  // efectivo viene de role default + permissionsOverride.
  permission?: PermissionKey;
}

const NAV_ITEMS: NavItemDef[] = [
  { id: "home",         section: "workspace", label: "Hoy",         href: "/dashboard",               icon: Home,          matchExact: true, permission: "today.view" },
  { id: "appointments", section: "workspace", label: "Agenda",      href: "/dashboard/agenda",        icon: Calendar,      permission: "agenda.view" },
  { id: "patients",     section: "workspace", label: "Pacientes",   href: "/dashboard/patients",      icon: Users,         permission: "patients.view" },
  { id: "inbox",        section: "workspace", label: "Inbox",       href: "/dashboard/inbox",         icon: InboxIcon,     countKey: "inboxUnread",   permission: "inbox.view" },
  { id: "messages",     section: "workspace", label: "Mensajes",    href: "/dashboard/whatsapp",      icon: MessageCircle, countKey: "messagesUnread", permission: "whatsapp.view" },
  { id: "marketplace",  section: "workspace", label: "Marketplace", href: "/dashboard/marketplace",   icon: ShoppingBag,   permission: "marketplace.view" },

  { id: "clinical",     section: "clinico", label: "Expedientes",  href: "/dashboard/clinical",     icon: Stethoscope, countKey: "clinicalDrafts", permission: "medicalRecord.view" },
  { id: "ai",           section: "clinico", label: "IA asistente", href: "/dashboard/ai-assistant", icon: Sparkles },
  { id: "xrays",        section: "clinico", label: "Radiografías", href: "/dashboard/xrays",
    icon: FileImage, countKey: "xraysUnanalyzed",
    categories: ["DENTAL", "MEDICINE", "PODIATRY"],
    permission: "xrays.view" },
  { id: "before-after", section: "clinico", label: "Antes/Después", href: "/dashboard/before-after",
    icon: Camera,
    categories: ["DERMATOLOGY", "AESTHETIC_MEDICINE", "BEAUTY_CENTER", "HAIR_RESTORATION", "LASER_HAIR_REMOVAL"] },
  { id: "formulas",     section: "clinico", label: "Fórmulas",      href: "/dashboard/formulas",
    icon: FlaskConical,
    categories: ["BROW_LASH", "HAIR_SALON", "ALTERNATIVE_MEDICINE"] },
  { id: "exercises",    section: "clinico", label: "Ejercicios",    href: "/dashboard/exercises",
    icon: Dumbbell,
    categories: ["PHYSIOTHERAPY", "PODIATRY"] },
  { id: "orthotics",    section: "clinico", label: "Ortesis",       href: "/dashboard/orthotics",
    icon: Footprints,
    categories: ["PODIATRY"] },

  // Especialidades — sub-items por módulo del marketplace. La sección
  // entera se oculta en runtime si la clínica no tiene ningún módulo
  // de especialidad activo (ver hasSpecialtyAccess en el layout).
  // Categorías: solo DENTAL/MEDICINE pueden tener pacientes pediátricos.
  { id: "pediatrics",   section: "specialties", label: "Odontopediatría", href: "/dashboard/specialties/pediatrics",
    icon: Baby,
    categories: ["DENTAL", "MEDICINE"],
    permission: "specialties.pediatrics" },
  { id: "endodontics",  section: "specialties", label: "Endodoncia", href: "/dashboard/specialties/endodontics",
    icon: Zap,
    categories: ["DENTAL"],
    permission: "specialties.endodontics" },
  { id: "periodontics", section: "specialties", label: "Periodoncia", href: "/dashboard/specialties/periodontics",
    icon: Activity,
    categories: ["DENTAL"],
    permission: "specialties.periodontics" },
  { id: "orthodontics", section: "specialties", label: "Ortodoncia", href: "/dashboard/specialties/orthodontics",
    icon: Smile,
    categories: ["DENTAL"],
    permission: "specialties.orthodontics" },

  { id: "treatments",   section: "catalogo", label: "Tratamientos", href: "/dashboard/treatments", icon: Activity, permission: "treatments.view" },
  { id: "packages",     section: "catalogo", label: "Paquetes",     href: "/dashboard/packages",
    icon: Gift, adminOnly: true,
    categories: ["AESTHETIC_MEDICINE", "BEAUTY_CENTER", "DERMATOLOGY", "HAIR_RESTORATION",
                 "LASER_HAIR_REMOVAL", "SPA", "MASSAGE", "BROW_LASH", "HAIR_SALON"] },
  { id: "resources",    section: "catalogo", label: "Recursos",     href: "/dashboard/resources",
    icon: DoorOpen, adminOnly: true,
    categories: ["SPA", "MASSAGE", "BEAUTY_CENTER", "DENTAL", "MEDICINE",
                 "AESTHETIC_MEDICINE", "PHYSIOTHERAPY"],
    permission: "resources.view" },
  { id: "inventory",    section: "catalogo", label: "Inventario",   href: "/dashboard/inventory",
    icon: Package, adminOnly: true,
    categories: ["DENTAL", "MEDICINE", "PODIATRY", "DERMATOLOGY", "AESTHETIC_MEDICINE"],
    permission: "inventory.view" },

  { id: "billing",        section: "admin", label: "Facturación",       href: "/dashboard/billing",       icon: CreditCard,     permission: "billing.view" },
  { id: "analytics",      section: "admin", label: "Analytics",         href: "/dashboard/analytics",     icon: BarChart3, adminOnly: true, permission: "analytics.view" },
  { id: "tv-modes",       section: "admin", label: "Pantallas TV",      href: "/dashboard/tv-modes",      icon: Monitor, adminOnly: true, permission: "tvModes.view" },
  { id: "reports",        section: "admin", label: "Reportes",          href: "/dashboard/reports",       icon: BarChart3,     permission: "reports.view" },
  { id: "team",           section: "admin", label: "Equipo",            href: "/dashboard/team",          icon: UserCog,        permission: "team.view" },
  { id: "landing",        section: "admin", label: "Página web",        href: "/dashboard/landing",       icon: Globe,          permission: "landing.view" },
  { id: "procedures",     section: "admin", label: "Procedimientos",    href: "/dashboard/procedures",    icon: ClipboardList,  permission: "procedures.view" },
  { id: "clinic-layout",  section: "admin", label: "Mi Clínica Visual", href: "/dashboard/clinic-layout", icon: Building2, adminOnly: true, permission: "clinicLayout.view" },
  { id: "settings",       section: "admin", label: "Configuración",     href: "/dashboard/settings",      icon: Settings,       permission: "settings.view" },
];

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

function isActivePath(pathname: string | null, href: string, matchExact?: boolean): boolean {
  if (!pathname) return false;
  if (matchExact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

function shouldShowItem(item: NavItemDef, user: SidebarUser, category: ClinicCategory): boolean {
  if (item.adminOnly && user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") return false;
  if (item.categories && item.categories.length > 0) {
    if (!item.categories.includes(category)) return false;
  }
  // Permission gating: SUPER_ADMIN ve todo (mantiene el comportamiento previo).
  // Para los demás, si el item declara `permission`, exigimos que el set
  // efectivo (default del role + override) lo incluya. Items sin `permission`
  // se siguen mostrando — útil para áreas que aún no migraron al sistema.
  if (item.permission && user.role !== "SUPER_ADMIN") {
    // Convertimos a la shape que hasPermission espera para la capa 2.
    // El cast a Role coincide porque UserRole y Prisma.Role tienen los
    // mismos valores excepto ACCOUNTANT (UI-only, no en DB) que cae
    // como readonly por seguridad.
    const userForPerm = {
      role: (user.role === "ACCOUNTANT" ? "READONLY" : user.role) as any,
      permissionsOverride: user.permissionsOverride ?? [],
    };
    if (!hasPermission(userForPerm, item.permission)) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════════

export function Sidebar(props: SidebarProps) {
  const pathname = usePathname();
  const counts = useSidebarCounts();
  const activeConsult = useActiveConsult().consult;

  const [collapsed, setCollapsed] = useBooleanLocalStorage("sidebar-collapsed", false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const defaultAdminExpanded =
    props.user.role === "SUPER_ADMIN" || props.user.role === "ADMIN";
  const [adminExpanded, setAdminExpanded] = useBooleanLocalStorage(
    "sidebar-admin-expanded",
    defaultAdminExpanded,
  );

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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

  const visibleItems = useMemo(() => {
    return NAV_ITEMS.filter((item) =>
      shouldShowItem(item, props.user, props.clinicCategory),
    );
    // Necesitamos depender del array completo (override puede cambiar tras
    // un guardado en /dashboard/team). props.user es el objeto referencial
    // que cambia cuando el layout re-renderiza con datos frescos.
  }, [props.user, props.clinicCategory]);

  const itemsBySection = useMemo(() => {
    const map: Record<Section, NavItemDef[]> = {
      workspace: [], clinico: [], catalogo: [], specialties: [], admin: [],
    };
    visibleItems.forEach((it) => map[it.section].push(it));
    return map;
  }, [visibleItems]);

  const getCount = useCallback((key?: NavItemDef["countKey"]): number => key ? counts[key] : 0, [counts]);

  const renderItem = useCallback(
    (item: NavItemDef) => {
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
            padding: collapsed ? "8px 0" : "7px 10px",
            borderRadius: 8,
            color: active ? undefined : "var(--text-2)",
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
            background: active ? "var(--brand-soft)" : "transparent",
            border: active ? "1px solid rgba(124,58,237,0.20)" : "1px solid transparent",
            boxShadow: active
              ? "0 0 12px rgba(124,58,237,0.08), inset 0 0 0 1px rgba(124,58,237,0.08)"
              : "none",
            transition: "background 0.15s, color 0.15s, border-color 0.15s",
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
          <Icon size={16} aria-hidden style={{ flexShrink: 0 }} />
          {!collapsed && (
            <>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {item.label}
              </span>
              {count > 0 && (
                <span
                  aria-label={`${count} pendiente${count === 1 ? "" : "s"}`}
                  style={{
                    fontFamily: "var(--font-jetbrains-mono, monospace)",
                    fontSize: 10,
                    fontWeight: 500,
                    padding: "1px 6px",
                    minWidth: 18,
                    textAlign: "center",
                    borderRadius: 10,
                    background: active ? "rgba(124,58,237,0.20)" : "var(--brand-soft)",
                    color: active ? "var(--brand)" : "var(--text-2)",
                    flexShrink: 0,
                  }}
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
              {hasConsultBadge && (
                <span
                  aria-label="Consulta en curso"
                  title="Consulta en curso"
                  style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: "var(--success)",
                    boxShadow: "0 0 4px rgba(16,185,129,0.6)",
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
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  zIndex: 50,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {item.label}
                {count > 0 && (
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains-mono, monospace)",
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
    [pathname, collapsed, activeConsult, getCount],
  );

  const renderSectionLabel = (label: string) => {
    if (collapsed) return null;
    return (
      <div
        style={{
          padding: "14px 10px 6px",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-3)",
        }}
      >
        {label}
      </div>
    );
  };

  const sidebarInner = (
    <>
      <ClinicSwitcher
        collapsed={collapsed}
        clinicName={props.clinicName}
        clinicId={props.clinicId}
        plan={props.plan}
        allClinics={props.allClinics ?? []}
      />

      {props.trialEndsAt !== undefined && (
        <TrialSidebarStatus
          trialEndsAt={props.trialEndsAt}
          isInTrial={props.isInTrial ?? false}
          collapsed={collapsed}
        />
      )}

      <nav
        aria-label="Navegación principal"
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

        {itemsBySection.clinico.length > 0 && (
          <>
            {renderSectionLabel("Clínico")}
            {itemsBySection.clinico.map((it) => renderItem(it))}
          </>
        )}

        {itemsBySection.catalogo.length > 0 && (
          <>
            {renderSectionLabel("Catálogo")}
            {itemsBySection.catalogo.map((it) => renderItem(it))}
          </>
        )}

        {props.hasSpecialtyAccess && itemsBySection.specialties.length > 0 && (
          <>
            {renderSectionLabel("Especialidades")}
            {itemsBySection.specialties.map((it) => renderItem(it))}
          </>
        )}

        {itemsBySection.admin.length > 0 && !collapsed && (
          <AdminSection
            expanded={adminExpanded}
            onToggle={() => setAdminExpanded(!adminExpanded)}
            items={itemsBySection.admin}
            renderItem={renderItem}
          />
        )}

        {props.hasSpecialtyAccess && collapsed && itemsBySection.specialties.length > 0 && (
          <>
            <div style={{ height: 8 }} />
            {itemsBySection.specialties.map((it) => renderItem(it))}
          </>
        )}

        {itemsBySection.admin.length > 0 && collapsed && (
          <>
            <div style={{ height: 8 }} />
            {itemsBySection.admin.map((it) => renderItem(it))}
          </>
        )}
      </nav>

      <SidebarFooter
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
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
              aria-label="Navegación"
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
                fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              }}
            >
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Cerrar navegación"
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
        aria-label="Navegación lateral"
        className={`sidebar-new ${collapsed ? "mf-sidebar--collapsed" : ""}`}
        style={{
          width: collapsed ? 68 : undefined,
          paddingInline: collapsed ? 8 : 10,
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

function ClinicSwitcher({
  collapsed, clinicName, clinicId, plan, allClinics,
}: {
  collapsed: boolean;
  clinicName: string;
  clinicId: string;
  plan: ClinicPlan;
  allClinics: SidebarClinicRef[];
}) {
  const router = useRouter();
  const hasOthers = allClinics.filter((c) => c.clinicId !== clinicId).length > 0;
  const initials = clinicName
    .split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  const switchClinic = async (id: string) => {
    try {
      const res = await fetch("/api/dashboard/switch-clinic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clinicId: id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
          boxShadow: "0 0 20px rgba(124,58,237,0.4), inset 0 1px 0 rgba(255,255,255,0.2)",
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
          <div
            style={{
              fontSize: 10, fontWeight: 600,
              letterSpacing: "0.06em",
              color: "var(--text-3)",
              textTransform: "uppercase",
            }}
          >
            {plan}
          </div>
        </div>
      )}
      {!collapsed && hasOthers && (
        <ChevronDown size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} aria-hidden />
      )}
    </>
  );

  const brandStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: collapsed ? "8px 4px" : "8px 10px",
    marginBottom: 10,
    paddingBottom: 14,
    borderBottom: "1px solid var(--border-soft)",
    width: "100%",
    background: "transparent",
    border: "none",
    borderRadius: 8,
    cursor: hasOthers ? "pointer" : "default",
    fontFamily: "var(--font-sora, 'Sora', sans-serif)",
    textAlign: "left",
  };

  if (!hasOthers) {
    return <div style={brandStyle}>{brandContent}</div>;
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Clínica activa: ${clinicName}. Cambiar clínica.`}
        style={brandStyle}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        {brandContent}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start" sideOffset={4}
          style={{
            minWidth: 220,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            borderRadius: 10, padding: 4,
            boxShadow: "0 20px 50px -10px rgba(15,10,30,0.25), 0 8px 20px -8px rgba(15,10,30,0.15)",
            zIndex: 50,
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
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
            Clínicas
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
                    ACTUAL
                  </span>
                )}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Admin section
// ═══════════════════════════════════════════════════════════════════

function AdminSection({
  expanded, onToggle, items, renderItem,
}: {
  expanded: boolean;
  onToggle: () => void;
  items: NavItemDef[];
  renderItem: (item: NavItemDef) => ReactNode;
}) {
  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls="mf-sidebar-admin-items"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "10px 10px 6px",
          background: "transparent",
          border: "none",
          color: "var(--text-3)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <ChevronRight
          size={12}
          aria-hidden
          className="mf-sidebar-admin-chevron"
          data-collapsed={!expanded}
          style={{ flexShrink: 0 }}
        />
        Administración
      </button>
      <div
        className="mf-sidebar-admin-body"
        data-collapsed={!expanded}
        id="mf-sidebar-admin-items"
      >
        <div
          className="mf-sidebar-admin-inner"
          style={{ display: "flex", flexDirection: "column", gap: 2 }}
          {...(!expanded ? ({ inert: "" } as any) : {})}
        >
          {items.map((it) => renderItem(it))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Footer
// ═══════════════════════════════════════════════════════════════════

function SidebarFooter({
  collapsed, onToggleCollapse, user,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: SidebarUser;
}) {
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

  const logout = async () => {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[Sidebar] logout failed", err);
    } finally {
      window.location.href = "/login";
    }
  };

  const displayName = `${user.firstName} ${user.lastName}`.trim();
  const initials = displayName
    .split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  const roleLabel: Record<UserRole, string> = {
    SUPER_ADMIN: "Owner",
    ADMIN: "Admin",
    DOCTOR: "Doctor",
    RECEPTIONIST: "Recepción",
    READONLY: "Solo lectura",
    ACCOUNTANT: "Contabilidad",
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
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        style={{
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
          cursor: "pointer",
          fontFamily: "inherit",
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
        {isDark ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
        {!collapsed && (isDark ? "Modo claro" : "Modo oscuro")}
      </button>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`Usuario: ${displayName}. Abrir menú de sesión.`}
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
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
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
              Cerrar sesión
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
        aria-pressed={collapsed}
        style={{
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
          cursor: "pointer",
          fontFamily: "inherit",
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
        {!collapsed && "Colapsar"}
      </button>
    </div>
  );
}
