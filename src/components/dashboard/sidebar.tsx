"use client";
import { useEffect, useMemo, useState, useCallback, useRef, Fragment, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Home, Calendar, Users, MessageCircle, Inbox as InboxIcon,
  Sparkles, Camera, FlaskConical, Dumbbell, Footprints,
  Activity, Gift, DoorOpen, Package, Building2,
  CreditCard, Wallet, BarChart3, Monitor, UserCog, Globe, ClipboardList, Settings,
  ShoppingBag, Baby, Zap, Smile, Anchor, Truck, ShoppingCart,
  ChevronDown, ChevronRight, Moon, Sun, LogOut, PanelLeftClose, PanelLeft,
  X, Plus, LifeBuoy, Star, ScrollText, type LucideIcon,
} from "lucide-react";
import { useSidebarCounts } from "@/hooks/use-sidebar-counts";
import { useActiveConsult } from "@/hooks/use-active-consult";
import type { Role } from "@prisma/client";
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { PEDIATRICS_MODULE_KEY } from "@/lib/pediatrics/permissions";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import {
  ENDODONTICS_MODULE_KEY,
  PERIODONTICS_MODULE_KEY,
  ORTHODONTICS_MODULE_KEY,
} from "@/lib/specialties/keys";
import { setSidebarSectionCollapsed } from "@/app/actions/sidebar";
import { useT } from "@/i18n/i18n-provider";

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
}

// ═══════════════════════════════════════════════════════════════════
// Nav items
// ═══════════════════════════════════════════════════════════════════

type Section = "workspace" | "clinico" | "catalogo" | "specialties" | "admin";

// Secciones con título colapsable (todas menos "workspace", que no lleva
// encabezado). El orden define el render en el nav.
const COLLAPSIBLE_SECTIONS = ["clinico", "catalogo", "specialties", "admin"] as const;
type CollapsibleSectionId = (typeof COLLAPSIBLE_SECTIONS)[number];

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
  // Module key del marketplace que controla la visibilidad del item. Si
  // está, el item solo aparece cuando la key está en `clinicModuleKeys`
  // del SidebarProps. Items sin moduleKey no se gatean por marketplace
  // (área "core" del producto). Se usa hoy para los items de
  // "Especialidades" y se puede extender a otras áreas modulares.
  moduleKey?: string;
  // "Próximamente": si es true el item se muestra pero NO navega (sin Link).
  // renderItem lo pinta como <div> deshabilitado con badge "Próximamente".
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItemDef[] = [
  { id: "home",         section: "workspace", label: "Hoy",         href: "/dashboard",               icon: Home,          matchExact: true, permission: "today.view" },
  { id: "appointments", section: "workspace", label: "Agenda",      href: "/dashboard/agenda",        icon: Calendar,      permission: "agenda.view" },
  { id: "patients",     section: "workspace", label: "Pacientes",   href: "/dashboard/patients",      icon: Users,         permission: "patients.view" },
  { id: "inbox",        section: "workspace", label: "Inbox",       href: "/dashboard/inbox",         icon: InboxIcon,     countKey: "inboxUnread",   permission: "inbox.view", moduleKey: "inbox", comingSoon: true },
  { id: "messages",     section: "workspace", label: "Whatsapp / Bot",    href: "/dashboard/whatsapp",      icon: MessageCircle, countKey: "messagesUnread", permission: "whatsapp.view", moduleKey: "whatsapp", comingSoon: true },
  { id: "marketplace",  section: "workspace", label: "Marketplace", href: "/dashboard/marketplace",   icon: ShoppingBag,   permission: "marketplace.view", moduleKey: "marketplace", comingSoon: true },

  { id: "ai",           section: "clinico", label: "IA asistente", href: "/dashboard/ai-assistant", icon: Sparkles, moduleKey: "ai-assistant" },
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

  // Especialidades — sub-items por módulo del marketplace. Cada item
  // exige su `moduleKey` activo (o trial vigente) en `clinicModuleKeys`,
  // determinado server-side en el layout vía getActiveClinicModuleKeys().
  // Si ningún item pasa el filtro la sección entera se oculta.
  // Categorías: solo DENTAL/MEDICINE pueden tener pacientes pediátricos.
  { id: "pediatrics",   section: "specialties", label: "Odontopediatría", href: "/dashboard/specialties/pediatrics",
    icon: Baby,
    categories: ["DENTAL", "MEDICINE"],
    permission: "specialties.pediatrics",
    moduleKey: PEDIATRICS_MODULE_KEY, comingSoon: true },
  { id: "endodontics",  section: "specialties", label: "Endodoncia", href: "/dashboard/specialties/endodontics",
    icon: Zap,
    categories: ["DENTAL"],
    permission: "specialties.endodontics",
    moduleKey: ENDODONTICS_MODULE_KEY, comingSoon: true },
  { id: "periodontics", section: "specialties", label: "Periodoncia", href: "/dashboard/specialties/periodontics",
    icon: Activity,
    categories: ["DENTAL"],
    permission: "specialties.periodontics",
    moduleKey: PERIODONTICS_MODULE_KEY, comingSoon: true },
  { id: "orthodontics", section: "specialties", label: "Ortodoncia", href: "/dashboard/specialties/orthodontics",
    icon: Smile,
    categories: ["DENTAL"],
    permission: "specialties.orthodontics",
    moduleKey: ORTHODONTICS_MODULE_KEY, comingSoon: true },
  { id: "implants",     section: "specialties", label: "Implantología", href: "/dashboard/specialties/implants",
    icon: Anchor,
    categories: ["DENTAL"],
    permission: "specialties.implants",
    moduleKey: IMPLANTS_MODULE_KEY, comingSoon: true },

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
  { id: "suppliers",    section: "catalogo", label: "Proveedores", href: "/dashboard/suppliers",
    icon: Truck, permission: "suppliers.view" },
  { id: "compras",      section: "catalogo", label: "Mis compras", href: "/dashboard/compras",
    icon: ShoppingCart, permission: "suppliers.view" },
  { id: "laboratorios",   section: "catalogo", label: "Laboratorios", href: "/dashboard/laboratorios",
    icon: FlaskConical, permission: "suppliers.view" },
  { id: "ordenes-laboratorio", section: "catalogo", label: "Mis órdenes de laboratorio", href: "/dashboard/ordenes-laboratorio",
    icon: ClipboardList, permission: "suppliers.view" },

  { id: "billing",        section: "admin", label: "Caja",              href: "/dashboard/caja",          icon: Wallet,         permission: "billing.view" },
  { id: "analytics",      section: "admin", label: "Analytics",         href: "/dashboard/analytics",     icon: BarChart3, adminOnly: true, permission: "analytics.view", moduleKey: "analytics" },
  { id: "tv-modes",       section: "admin", label: "Pantallas TV",      href: "/dashboard/tv-modes",      icon: Monitor, adminOnly: true, permission: "tvModes.view", moduleKey: "tv-modes" },
  { id: "reports",        section: "admin", label: "Reportes",          href: "/dashboard/reports",       icon: BarChart3,     permission: "reports.view", moduleKey: "reports" },
  { id: "team",           section: "admin", label: "Equipo",            href: "/dashboard/team",          icon: UserCog,        permission: "team.view" },
  { id: "landing",        section: "admin", label: "Página web",        href: "/dashboard/landing",       icon: Globe,          permission: "landing.view", moduleKey: "landing" },
  { id: "procedures",     section: "admin", label: "Procedimientos",    href: "/dashboard/procedures",    icon: ClipboardList,  permission: "procedures.view" },
  { id: "clinic-layout",  section: "admin", label: "Mi Clínica Visual", href: "/dashboard/clinic-layout", icon: Building2, adminOnly: true, permission: "clinicLayout.view" },
  { id: "settings",       section: "admin", label: "Configuración",     href: "/dashboard/settings",      icon: Settings,       permission: "settings.view" },
  // Bitácora/Actividad: auditoría de la clínica. Solo ADMIN/dueño (adminOnly).
  { id: "auditoria",      section: "admin", label: "Bitácora",          href: "/dashboard/auditoria",     icon: ScrollText, adminOnly: true },
  // Soporte Técnico: sin `permission` a propósito — cualquier usuario de la
  // clínica puede levantar tickets hacia DaleControl.
  { id: "soporte",        section: "admin", label: "Soporte Técnico",   href: "/dashboard/soporte",       icon: LifeBuoy },
  { id: "resenas",        section: "admin", label: "Reseñas",           href: "/dashboard/resenas",       icon: Star, adminOnly: true },
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

function shouldShowItem(
  item: NavItemDef,
  user: SidebarUser,
  category: ClinicCategory,
  clinicModuleKeys: string[],
): boolean {
  if (item.adminOnly && user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") return false;
  if (item.categories && item.categories.length > 0) {
    if (!item.categories.includes(category)) return false;
  }
  // Marketplace gating: si el item declara `moduleKey`, exigimos que la
  // clínica tenga ese módulo activo (o esté en trial). Aplica también al
  // SUPER_ADMIN — el toggle del marketplace es la fuente de verdad y un
  // admin tampoco debe ver una especialidad que no contrató.
  if (item.moduleKey && !clinicModuleKeys.includes(item.moduleKey)) return false;
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
      role: (user.role === "ACCOUNTANT" ? "READONLY" : user.role) as Role,
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

  const getCount = useCallback((key?: NavItemDef["countKey"]): number => key ? counts[key] : 0, [counts]);

  const renderItem = useCallback(
    (item: NavItemDef) => {
      // "Próximamente": el item se muestra pero NO navega. Mismo layout visual
      // que el Link normal (icono + label) pero sin href, sin hover y con
      // cursor/opacidad de deshabilitado. Badge solo en modo expandido; en
      // colapsado (icon-only) solo opacidad + title nativo.
      if (item.comingSoon) {
        const SoonIcon = item.icon;
        return (
          <div
            key={item.id}
            title={collapsed ? "Próximamente" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: collapsed ? 0 : 10,
              justifyContent: collapsed ? "center" : "flex-start",
              padding: collapsed ? "8px 0" : "7px 10px",
              borderRadius: 8,
              color: "var(--text-2)",
              fontSize: 13,
              fontWeight: 500,
              background: "transparent",
              border: "1px solid transparent",
              whiteSpace: "nowrap",
              cursor: "not-allowed",
              opacity: 0.55,
            }}
          >
            <SoonIcon size={16} aria-hidden style={{ flexShrink: 0 }} />
            {!collapsed && (
              <>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t(`sidebar.nav.${item.id}`)}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.3,
                    color: "var(--text-2)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: 6,
                    padding: "1px 5px",
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
                {t(`sidebar.nav.${item.id}`)}
              </span>
              {count > 0 && (
                <span
                  aria-label={t("sidebar.itemPending", { count })}
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
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
                  aria-label={t("sidebar.consultInProgress")}
                  title={t("sidebar.consultInProgress")}
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
      <ClinicSwitcher
        collapsed={collapsed}
        clinicName={props.clinicName}
        clinicId={props.clinicId}
        plan={props.plan}
        allClinics={props.allClinics ?? []}
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
                    background: "var(--brand)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    boxShadow: "0 4px 12px -2px color-mix(in srgb, var(--brand) 45%, transparent)",
                    transition: "transform 0.12s, box-shadow 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
                >
                  <Plus size={18} aria-hidden />
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
              padding: "9px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "var(--brand)",
              color: "#fff",
              border: "none",
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
              boxShadow: "0 4px 14px -2px color-mix(in srgb, var(--brand) 50%, transparent)",
              transition: "transform 0.12s, box-shadow 0.12s, filter 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.filter = "brightness(1.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.filter = "brightness(1)";
            }}
          >
            <Plus size={15} aria-hidden />
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
  const t = useT();
  const router = useRouter();
  const hasOthers = allClinics.filter((c) => c.clinicId !== clinicId).length > 0;
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
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
    textAlign: "left",
  };

  if (!hasOthers) {
    return <div style={brandStyle}>{brandContent}</div>;
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t("sidebar.clinicSwitcherAria", { name: clinicName })}
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
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
    <div style={{ marginTop: 6 }}>
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
          className="mf-sidebar-section-chevron"
          data-collapsed={collapsed}
          style={{ flexShrink: 0 }}
        />
        {label}
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

  const logout = async () => {
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
  };

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
