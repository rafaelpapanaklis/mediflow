// Lista de opciones del menú del panel y el filtro de quién ve cada una.
//
// Vive aparte de `sidebar.tsx` para que la compartan los DOS menús —el de
// siempre y el de dos niveles (`menu-dos-niveles/`)— y así el nuevo enseñe
// exactamente lo que enseñaría el viejo a cada persona: mismo permiso, mismo
// plan, mismas banderas. El código de abajo se movió tal cual desde
// `sidebar.tsx`; ningún criterio cambió al moverlo.

import type { Role } from "@prisma/client";
import {
  Home, Calendar, Users, MessageCircle, Inbox as InboxIcon,
  Sparkles, Bot, Camera, FlaskConical, Dumbbell, Footprints,
  Activity, Gift, DoorOpen, Package, Building2,
  CreditCard, Wallet, PiggyBank, BarChart3, Monitor, UserCog, Globe, ClipboardList, Settings,
  ShoppingBag, Baby, Zap, Smile, Anchor, Truck, ShoppingCart,
  LifeBuoy, Star, ScrollText, type LucideIcon,
} from "lucide-react";
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";
import { PEDIATRICS_MODULE_KEY } from "@/lib/pediatrics/permissions";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import {
  ENDODONTICS_MODULE_KEY,
  PERIODONTICS_MODULE_KEY,
  ORTHODONTICS_MODULE_KEY,
} from "@/lib/specialties/keys";
import { HIDE_SUPPLY_MODULES, SUPPLY_NAV_IDS } from "@/lib/hidden-modules";

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
// ═══════════════════════════════════════════════════════════════════
// Nav items
// ═══════════════════════════════════════════════════════════════════
export type Section = "workspace" | "clinico" | "catalogo" | "specialties" | "admin";

// Secciones con título colapsable (todas menos "workspace", que no lleva
// encabezado). El orden define el render en el nav.
export const COLLAPSIBLE_SECTIONS = ["clinico", "catalogo", "specialties", "admin"] as const;
export type CollapsibleSectionId = (typeof COLLAPSIBLE_SECTIONS)[number];

export interface NavItemDef {
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
  // Exclusivo del menú reducido de clínica suspendida (isExpired). shouldShowItem
  // lo oculta SIEMPRE en el flujo normal; el sidebar lo renderiza sólo cuando
  // isExpired vía SUSPENDED_NAV_IDS. Se usa para "Facturación".
  suspendedOnly?: boolean;
  // Color propio del ICONO (solo el icono; la etiqueta sigue el tratamiento
  // normal). Debe ser un token del sistema, nunca un hex crudo. Al ir en el
  // <svg> gana sobre el `color` heredado del item, así que se mantiene igual
  // en reposo, hover y activo. Hoy solo lo usa "Soporte Técnico" para
  // destacarlo del gris del resto.
  iconColor?: string;
}

export const NAV_ITEMS: NavItemDef[] = [
  { id: "home",         section: "workspace", label: "Hoy",         href: "/dashboard",               icon: Home,          matchExact: true, permission: "today.view" },
  { id: "appointments", section: "workspace", label: "Agenda",      href: "/dashboard/agenda",        icon: Calendar,      permission: "agenda.view" },
  { id: "patients",     section: "workspace", label: "Pacientes",   href: "/dashboard/patients",      icon: Users,         permission: "patients.view" },
  { id: "inbox",        section: "workspace", label: "Inbox",       href: "/dashboard/inbox",         icon: InboxIcon,     countKey: "inboxUnread",   permission: "inbox.view", moduleKey: "inbox" },
  { id: "messages",     section: "workspace", label: "Whatsapp / Bot",    href: "/dashboard/whatsapp",      icon: MessageCircle, countKey: "messagesUnread", permission: "whatsapp.view", moduleKey: "whatsapp" },
  { id: "marketplace",  section: "workspace", label: "Marketplace", href: "/dashboard/marketplace",   icon: ShoppingBag,   permission: "marketplace.view", moduleKey: "marketplace", comingSoon: true },

  { id: "ai",           section: "clinico", label: "IA asistente", href: "/dashboard/ai-assistant", icon: Sparkles, moduleKey: "ai-assistant" },
  // Sabina vive JUNTO al Asistente IA, no lo sustituye (CONTRATO.md de
  // 20260910-1338-construir-sabina-la-capa-de-herramientas). Sin moduleKey:
  // es área core, igual que "ai" — no se gatea por marketplace.
  { id: "sabina",       section: "clinico", label: "Sabina",       href: "/dashboard/sabina",       icon: Bot },
  // Inventario vive en CLÍNICO, justo debajo de "IA asistente": al ocultar
  // Proveedores/Laboratorios (ver HIDE_SUPPLY_MODULES) era el único superviviente
  // de "Catálogo" y no ameritaba sección propia. Los filtros por `categories`,
  // `adminOnly` y `permission` siguen aplicando igual que en su sección anterior.
  { id: "inventory",    section: "clinico", label: "Inventario",   href: "/dashboard/inventory",
    icon: Package, adminOnly: true,
    categories: ["DENTAL", "MEDICINE", "PODIATRY", "DERMATOLOGY", "AESTHETIC_MEDICINE"],
    permission: "inventory.view" },
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
  // Proveedores / Mis compras / Laboratorios / Mis órdenes de laboratorio:
  // OCULTOS mientras HIDE_SUPPLY_MODULES sea true (src/lib/hidden-modules.ts).
  // Se dejan aquí, no se borran — volverlos a mostrar es apagar esa bandera.
  { id: "suppliers",    section: "catalogo", label: "Proveedores", href: "/dashboard/suppliers",
    icon: Truck, permission: "suppliers.view" },
  { id: "compras",      section: "catalogo", label: "Mis compras", href: "/dashboard/compras",
    icon: ShoppingCart, permission: "suppliers.view" },
  { id: "laboratorios",   section: "catalogo", label: "Laboratorios", href: "/dashboard/laboratorios",
    icon: FlaskConical, permission: "suppliers.view" },
  { id: "ordenes-laboratorio", section: "catalogo", label: "Mis órdenes de laboratorio", href: "/dashboard/ordenes-laboratorio",
    icon: ClipboardList, permission: "suppliers.view" },

  { id: "billing",        section: "admin", label: "Caja",              href: "/dashboard/caja",          icon: Wallet,         permission: "billing.view" },
  { id: "finanzas",       section: "admin", label: "Finanzas",          href: "/dashboard/finanzas",      icon: PiggyBank, adminOnly: true, permission: "analytics.view" },
  { id: "analytics",      section: "admin", label: "Analytics",         href: "/dashboard/analytics",     icon: BarChart3, adminOnly: true, permission: "analytics.view", moduleKey: "analytics" },
  { id: "tv-modes",       section: "admin", label: "Pantallas TV",      href: "/dashboard/tv-modes",      icon: Monitor, adminOnly: true, permission: "tvModes.view", moduleKey: "tv-modes" },
  { id: "reports",        section: "admin", label: "Reportes",          href: "/dashboard/reports",       icon: BarChart3,     permission: "reports.view", moduleKey: "reports" },
  // Recursos (sillones / consultorios): vive en ADMINISTRACIÓN, justo arriba de
  // Equipo — es configuración de la clínica, no catálogo comercial. El filtro
  // por `categories` y `adminOnly` siguen aplicando igual que en su sección
  // anterior; sólo cambió dónde se pinta.
  { id: "resources",      section: "admin", label: "Recursos",          href: "/dashboard/resources",
    icon: DoorOpen, adminOnly: true,
    categories: ["SPA", "MASSAGE", "BEAUTY_CENTER", "DENTAL", "MEDICINE",
                 "AESTHETIC_MEDICINE", "PHYSIOTHERAPY"],
    permission: "resources.view" },
  { id: "team",           section: "admin", label: "Equipo",            href: "/dashboard/team",          icon: UserCog,        permission: "team.view" },
  { id: "landing",        section: "admin", label: "Página web",        href: "/dashboard/landing",       icon: Globe,          permission: "landing.view", moduleKey: "landing" },
  { id: "procedures",     section: "admin", label: "Procedimientos",    href: "/dashboard/procedures",    icon: ClipboardList,  permission: "procedures.view" },
  { id: "clinic-layout",  section: "admin", label: "Mi Clínica Visual", href: "/dashboard/clinic-layout", icon: Building2, adminOnly: true, permission: "clinicLayout.view" },
  // Soporte Técnico: sin `permission` a propósito — cualquier usuario de la
  // clínica puede levantar tickets hacia DaleControl. Va JUSTO ARRIBA de
  // Configuración (y con `iconColor`) porque ahí vive el acceso directo al
  // Manager de cuenta por WhatsApp: tiene que encontrarse de un vistazo.
  { id: "soporte",        section: "admin", label: "Soporte Técnico",   href: "/dashboard/soporte",       icon: LifeBuoy, iconColor: "var(--success-strong)" },
  { id: "settings",       section: "admin", label: "Configuración",     href: "/dashboard/settings",      icon: Settings,       permission: "settings.view" },
  // Bitácora/Actividad: auditoría de la clínica. Solo ADMIN/dueño (adminOnly).
  { id: "auditoria",      section: "admin", label: "Bitácora",          href: "/dashboard/auditoria",     icon: ScrollText, adminOnly: true },
  // Facturación: EXCLUSIVA del menú reducido de clínica suspendida (suspendedOnly
  // → shouldShowItem la oculta en el flujo normal). Lleva a la pantalla de pago /
  // activación. Sin `permission`: cualquier rol la ve, igual que Soporte.
  { id: "facturacion",    section: "admin", label: "Facturación",       href: "/dashboard/suspended",     icon: CreditCard, suspendedOnly: true },
  { id: "resenas",        section: "admin", label: "Reseñas",           href: "/dashboard/resenas",       icon: Star, adminOnly: true },
];

// IDs (en orden de render) de los únicos items visibles cuando la clínica está
// suspendida: Facturación primero (acción principal), Soporte después. El
// sidebar los saca de NAV_ITEMS por id cuando isExpired; el resto del menú se
// oculta porque el layout ya rebota toda otra navegación a /dashboard/suspended.
export const SUSPENDED_NAV_IDS = ["facturacion", "soporte"] as const;
export function isActivePath(pathname: string | null, href: string, matchExact?: boolean): boolean {
  if (!pathname) return false;
  if (matchExact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

// TEMPORAL: ocultar la sección "Especialidades" (Odontopediatría, Endodoncia,
// Periodoncia, Ortodoncia, Implantología) mientras se terminan de desarrollar.
// Hoy son stubs "Próximamente" sin funcionalidad. Poner en false para re-mostrarlas.
export const HIDE_SPECIALTIES = true;

export function shouldShowItem(
  item: NavItemDef,
  user: SidebarUser,
  category: ClinicCategory,
  clinicModuleKeys: string[],
): boolean {
  // Items exclusivos del menú de suspensión (Facturación) NUNCA salen en el
  // flujo normal; el sidebar los renderiza aparte cuando isExpired.
  if (item.suspendedOnly) return false;
  // Oculta toda la sección de especialidades (aún en desarrollo). Ver HIDE_SPECIALTIES.
  if (HIDE_SPECIALTIES && item.section === "specialties") return false;
  // Oculta Proveedores / Mis compras / Laboratorios / Mis órdenes de laboratorio
  // mientras el área no sea pública. Ver HIDE_SUPPLY_MODULES.
  if (HIDE_SUPPLY_MODULES && SUPPLY_NAV_IDS.includes(item.id)) return false;
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
