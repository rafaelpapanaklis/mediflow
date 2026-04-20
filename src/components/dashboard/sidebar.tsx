"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import {
  LayoutDashboard, Calendar, Users, CreditCard,
  BarChart2, Settings, LogOut, Menu, X, Stethoscope,
  Sun, Moon, MessageCircle, Package, UserCog, Activity,
  Camera, Gift, FlaskConical, Clock, DoorOpen, Dumbbell,
  Footprints, FileImage, Globe, Sparkles, ChevronDown, ChevronsUpDown,
  Building2, Video, ClipboardList, User as UserIcon,
  PanelLeftClose, PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import { OnboardingMini } from "./onboarding-mini";

type NavSection = "work" | "admin";

type NavItem = {
  key:       string;
  href:      string;
  icon:      ComponentType<{ size?: number | string; className?: string }>;
  label:     string;
  adminOnly: boolean;
  section:   NavSection;
};

const CATEGORY_FEATURES: Record<string, string[]> = {
  DENTAL: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","xrays","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
  MEDICINE: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","xrays","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
  NUTRITION: ["dashboard","appointments","patients","clinical","treatments","billing","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
  PSYCHOLOGY: ["dashboard","appointments","patients","clinical","treatments","billing","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
  DERMATOLOGY: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","before-after","packages","xrays","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
  AESTHETIC_MEDICINE: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","before-after","packages","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
  HAIR_RESTORATION: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","before-after","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
  BEAUTY_CENTER: ["dashboard","appointments","patients","clinical","packages","billing","inventory","before-after","whatsapp","team","reports","settings","landing","ai-assistant","teleconsulta"],
  BROW_LASH: ["dashboard","appointments","patients","clinical","formulas","packages","billing","inventory","before-after","whatsapp","team","reports","settings","landing","ai-assistant","teleconsulta"],
  MASSAGE: ["dashboard","appointments","patients","clinical","packages","billing","whatsapp","team","reports","settings","landing","ai-assistant","teleconsulta"],
  LASER_HAIR_REMOVAL: ["dashboard","appointments","patients","clinical","packages","billing","inventory","before-after","whatsapp","team","reports","settings","landing","ai-assistant","teleconsulta"],
  HAIR_SALON: ["dashboard","appointments","patients","clinical","formulas","billing","inventory","walk-in","before-after","packages","whatsapp","team","reports","settings","landing","ai-assistant"],
  ALTERNATIVE_MEDICINE: ["dashboard","appointments","patients","clinical","treatments","formulas","billing","inventory","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
  NAIL_SALON: ["dashboard","appointments","patients","clinical","billing","inventory","walk-in","whatsapp","team","reports","settings","landing","ai-assistant"],
  SPA: ["dashboard","appointments","patients","clinical","packages","billing","inventory","resources","before-after","whatsapp","team","reports","settings","landing","ai-assistant","teleconsulta"],
  PHYSIOTHERAPY: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","exercises","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
  PODIATRY: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","orthotics","exercises","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
  OTHER: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","whatsapp","team","reports","settings","procedures","landing","ai-assistant","teleconsulta"],
};

interface ClinicOption {
  clinicId:   string;
  clinicName: string;
  category:   string;
  plan:       string;
  role:       string;
}

interface SidebarProps {
  user:                  { firstName: string; lastName: string; email: string; role: string; color?: string };
  clinicName:            string;
  clinicId:              string;
  plan:                  string;
  clinicCategory?:       string;
  allClinics?:           ClinicOption[];
  onboardingCompleted?:  string[];
}

function useDarkMode() {
  const [dark, setDark] = useState(true); // default dark (Claude Design)
  useLayoutEffect(() => {
    const saved = localStorage.getItem("theme");
    const isDark = saved !== "light";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }
  return { dark, toggle };
}

function useCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "1") setCollapsed(true);
  }, []);
  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }
  return { collapsed, toggle };
}

export function Sidebar({
  user, clinicName, clinicId, plan,
  clinicCategory = "OTHER",
  allClinics = [],
  onboardingCompleted,
}: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const [open, setOpen] = useState(false);
  const { dark, toggle: toggleDark } = useDarkMode();
  const { collapsed, toggle: toggleCollapsed } = useCollapsed();
  const [switching, setSwitching] = useState(false);
  const hasMultipleClinics = allClinics.length > 1;

  async function switchClinic(targetClinicId: string) {
    if (targetClinicId === clinicId || switching) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/switch-clinic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId: targetClinicId }),
      });
      if (!res.ok) throw new Error();
      window.location.href = "/dashboard";
    } catch {
      toast.error("Error al cambiar de clínica");
    } finally {
      setSwitching(false);
    }
  }

  const CATEGORY_LABELS: Record<string, string> = {
    DENTAL: "Odontología", MEDICINE: "Medicina", NUTRITION: "Nutrición", PSYCHOLOGY: "Psicología",
    DERMATOLOGY: "Dermatología", AESTHETIC_MEDICINE: "Med. Estética", HAIR_RESTORATION: "Capilar",
    BEAUTY_CENTER: "Estética", BROW_LASH: "Cejas/Pestañas", MASSAGE: "Masajes",
    LASER_HAIR_REMOVAL: "Láser", HAIR_SALON: "Peluquería", ALTERNATIVE_MEDICINE: "Med. Alternativa",
    NAIL_SALON: "Uñas", SPA: "Spa", PHYSIOTHERAPY: "Fisioterapia", PODIATRY: "Podología", OTHER: "Otra",
  };

  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const features = CATEGORY_FEATURES[clinicCategory] ?? CATEGORY_FEATURES.OTHER;

  const ALL_NAV: NavItem[] = [
    { key: "dashboard",    href: "/dashboard",              icon: LayoutDashboard, label: "Dashboard",       adminOnly: false, section: "work"  },
    { key: "appointments", href: "/dashboard/appointments", icon: Calendar,        label: "Agenda",          adminOnly: false, section: "work"  },
    { key: "patients",     href: "/dashboard/patients",     icon: Users,           label: "Pacientes",       adminOnly: false, section: "work"  },
    { key: "clinical",     href: "/dashboard/clinical",     icon: Stethoscope,     label: "Expedientes",     adminOnly: false, section: "work"  },
    { key: "treatments",   href: "/dashboard/treatments",   icon: Activity,        label: "Tratamientos",    adminOnly: false, section: "work"  },
    { key: "before-after", href: "/dashboard/before-after", icon: Camera,          label: "Antes/Después",   adminOnly: false, section: "work"  },
    { key: "formulas",     href: "/dashboard/formulas",     icon: FlaskConical,    label: "Fórmulas",        adminOnly: false, section: "work"  },
    { key: "walk-in",      href: "/dashboard/walk-in",      icon: Clock,           label: "Lista de espera", adminOnly: false, section: "work"  },
    { key: "exercises",    href: "/dashboard/exercises",    icon: Dumbbell,        label: "Ejercicios",      adminOnly: false, section: "work"  },
    { key: "orthotics",    href: "/dashboard/orthotics",    icon: Footprints,      label: "Ortesis",         adminOnly: false, section: "work"  },
    { key: "xrays",        href: "/dashboard/xrays",        icon: FileImage,       label: "Radiografías",    adminOnly: false, section: "work"  },
    { key: "ai-assistant", href: "/dashboard/ai-assistant", icon: Sparkles,        label: "IA Asistente",    adminOnly: false, section: "work"  },
    { key: "teleconsulta", href: "/dashboard/teleconsulta", icon: Video,           label: "Teleconsulta",    adminOnly: false, section: "work"  },

    { key: "packages",     href: "/dashboard/packages",     icon: Gift,            label: "Paquetes",        adminOnly: true,  section: "admin" },
    { key: "resources",    href: "/dashboard/resources",    icon: DoorOpen,        label: "Recursos/Salas",  adminOnly: true,  section: "admin" },
    { key: "billing",      href: "/dashboard/billing",      icon: CreditCard,      label: "Facturación",     adminOnly: true,  section: "admin" },
    { key: "inventory",    href: "/dashboard/inventory",    icon: Package,         label: "Inventario",      adminOnly: true,  section: "admin" },
    { key: "whatsapp",     href: "/dashboard/whatsapp",     icon: MessageCircle,   label: "WhatsApp",        adminOnly: true,  section: "admin" },
    { key: "team",         href: "/dashboard/team",         icon: UserCog,         label: "Equipo",          adminOnly: true,  section: "admin" },
    { key: "reports",      href: "/dashboard/reports",      icon: BarChart2,       label: "Reportes",        adminOnly: true,  section: "admin" },
    { key: "procedures",   href: "/dashboard/procedures",   icon: ClipboardList,   label: "Procedimientos",  adminOnly: true,  section: "admin" },
    { key: "landing",      href: "/dashboard/landing",      icon: Globe,           label: "Página web",      adminOnly: true,  section: "admin" },
    { key: "settings",     href: "/dashboard/settings",     icon: Settings,        label: "Configuración",   adminOnly: false, section: "admin" },
  ];

  const NAV = ALL_NAV.filter(n => {
    if (!features.includes(n.key)) return false;
    if (n.adminOnly && !isAdmin) return false;
    return true;
  });

  const navWork  = NAV.filter(n => n.section === "work");
  const navAdmin = NAV.filter(n => n.section === "admin");

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();
  const roleLabel: Record<string, string> = {
    ADMIN: "Admin", DOCTOR: "Doctor", RECEPTIONIST: "Recep.",
    SUPER_ADMIN: "Admin", READONLY: "Solo lectura",
  };

  // Helper: un nav item con el estilo .nav-item-new
  const renderNavItem = (item: NavItem, isCollapsed: boolean) => {
    const active = item.href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(item.href);
    const Icon = item.icon;
    const isWa = item.key === "whatsapp";

    const link = (
      <Link
        href={item.href}
        prefetch
        onClick={() => setOpen(false)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "nav-item-new",
          active && "nav-item-new--active",
          isCollapsed && "justify-center"
        )}
        style={isCollapsed ? { padding: "7px 0" } : undefined}
      >
        <Icon size={16} />
        {!isCollapsed && (
          <>
            <span className="truncate">{item.label}</span>
            {isWa && !active && <span className="nav-item-new__dot" />}
          </>
        )}
      </Link>
    );

    if (isCollapsed) {
      return (
        <li key={item.href} style={{ listStyle: "none" }}>
          <Tooltip>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        </li>
      );
    }
    return <li key={item.href} style={{ listStyle: "none" }}>{link}</li>;
  };

  const SidebarContent = ({ isCollapsed }: { isCollapsed: boolean }) => (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn("sidebar-new", isCollapsed && "sidebar-new--collapsed")}
        style={{ width: isCollapsed ? 72 : 232 }}
      >
        {/* Brand */}
        <div className="sidebar-new__brand">
          <div className="sidebar-new__logo">
            <span style={{ fontSize: 14 }}>M</span>
          </div>
          {!isCollapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sidebar-new__brandname">MediFlow</div>
              <div className="sidebar-new__brandsub">{plan}</div>
            </div>
          )}
          {!isCollapsed && hasMultipleClinics && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="icon-btn-new"
                  style={{ width: 24, height: 24 }}
                  aria-label="Cambiar clínica"
                >
                  <ChevronsUpDown size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[240px]">
                <DropdownMenuLabel>Cambiar clínica</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allClinics.map(c => (
                  <DropdownMenuItem
                    key={c.clinicId}
                    disabled={switching}
                    onClick={() => switchClinic(c.clinicId)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2",
                      c.clinicId === clinicId && "bg-sidebar-accent"
                    )}
                  >
                    <Building2 className="h-4 w-4 shrink-0" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{c.clinicName}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {CATEGORY_LABELS[c.category] ?? c.category} · {c.plan}
                      </span>
                    </div>
                    {c.clinicId === clinicId && (
                      <span className="ml-auto h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--brand)" }} />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Clínica actual (sólo una) */}
        {!isCollapsed && !hasMultipleClinics && (
          <div
            style={{
              padding: "0 10px 8px",
              fontSize: 11,
              color: "var(--text-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {clinicName}
          </div>
        )}

        {/* Nav scroll area */}
        <nav className="scrollbar-thin" style={{ flex: 1, overflowY: "auto", marginRight: -4, paddingRight: 4 }}>
          {!isCollapsed && <div className="nav-section-new">Principal</div>}
          <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {navWork.map(item => renderNavItem(item, isCollapsed))}
          </ul>

          {navAdmin.length > 0 && (
            <>
              {!isCollapsed && <div className="nav-section-new">Administración</div>}
              <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                {navAdmin.map(item => renderNavItem(item, isCollapsed))}
              </ul>
            </>
          )}
        </nav>

        {/* Footer */}
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
          {!isCollapsed && onboardingCompleted && (
            <div style={{ padding: "0 2px" }}>
              <OnboardingMini completed={onboardingCompleted} />
            </div>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleDark}
            type="button"
            className={cn("nav-item-new", isCollapsed && "justify-center")}
            style={isCollapsed ? { padding: "7px 0" } : undefined}
            aria-label="Cambiar tema"
          >
            {dark ? <Moon size={14} /> : <Sun size={14} />}
            {!isCollapsed && <span>{dark ? "Modo oscuro" : "Modo claro"}</span>}
          </button>

          {/* User chip + dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="user-chip-new" style={{ justifyContent: isCollapsed ? "center" : "flex-start" }}>
                <div
                  className="avatar-new"
                  style={{
                    background: `linear-gradient(135deg, ${user.color ?? "#a78bfa"}, #7c3aed)`,
                    width: 28,
                    height: 28,
                    fontSize: 10,
                  }}
                >
                  {initials}
                </div>
                {!isCollapsed && (
                  <>
                    <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                      <div className="user-chip-new__name truncate">
                        {user.firstName} {user.lastName}
                      </div>
                      <div className="user-chip-new__role">
                        {roleLabel[user.role] ?? user.role}
                      </div>
                    </div>
                    <ChevronDown size={14} style={{ color: "var(--text-3)" }} />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isCollapsed ? "center" : "end"} side="top" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span>{user.firstName} {user.lastName}</span>
                  <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">
                  <UserIcon className="mr-2 h-4 w-4" />
                  Mi perfil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Collapse toggle (desktop only) */}
          <button
            onClick={toggleCollapsed}
            type="button"
            className={cn("nav-item-new hidden lg:flex", isCollapsed && "justify-center")}
            style={isCollapsed ? { padding: "7px 0" } : undefined}
            aria-label={isCollapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
          >
            {isCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
            {!isCollapsed && <span>Colapsar</span>}
          </button>
        </div>
      </div>
    </TooltipProvider>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <SidebarContent isCollapsed={collapsed} />
      </div>

      {/* Mobile top bar */}
      <div
        className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center gap-3 border-b lg:hidden"
        style={{
          borderColor: "var(--border-soft)",
          background: "rgba(10,10,15,0.9)",
          backdropFilter: "blur(8px)",
          padding: "0 16px",
        }}
      >
        <button
          onClick={() => setOpen(true)}
          type="button"
          className="icon-btn-new"
          aria-label="Abrir menú"
        >
          <Menu size={14} />
        </button>
        <div className="sidebar-new__logo" style={{ width: 28, height: 28 }}>
          <span style={{ fontSize: 14 }}>M</span>
        </div>
        <span className="sidebar-new__brandname">MediFlow</span>
        <span
          style={{ marginLeft: "auto", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "var(--text-3)" }}
        >
          {clinicName}
        </span>
      </div>

      {/* Mobile drawer with focus trap */}
      {open && (
        <MobileDrawer onClose={() => setOpen(false)}>
          <SidebarContent isCollapsed={false} />
        </MobileDrawer>
      )}
    </>
  );
}

function MobileDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;

    const firstFocusable = drawer.querySelector<HTMLElement>(
      'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;

      const focusable = drawer!.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose} />
      <aside ref={drawerRef} className="relative flex h-full w-[280px] flex-col">
        <button
          type="button"
          className="icon-btn-new"
          style={{ position: "absolute", right: 12, top: 12, zIndex: 10 }}
          onClick={onClose}
          aria-label="Cerrar menú"
        >
          <X size={14} />
        </button>
        {children}
      </aside>
    </div>
  );
}
