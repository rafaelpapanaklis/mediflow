"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { OnboardingMini } from "./onboarding-mini";

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
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("theme");
    const isDark = saved !== "light";
    document.documentElement.classList.toggle("dark", isDark);
    return isDark;
  });
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
  const pathname   = usePathname();
  const router     = useRouter();
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
    DENTAL:"Odontología", MEDICINE:"Medicina", NUTRITION:"Nutrición", PSYCHOLOGY:"Psicología",
    DERMATOLOGY:"Dermatología", AESTHETIC_MEDICINE:"Med. Estética", HAIR_RESTORATION:"Capilar",
    BEAUTY_CENTER:"Estética", BROW_LASH:"Cejas/Pestañas", MASSAGE:"Masajes",
    LASER_HAIR_REMOVAL:"Láser", HAIR_SALON:"Peluquería", ALTERNATIVE_MEDICINE:"Med. Alternativa",
    NAIL_SALON:"Uñas", SPA:"Spa", PHYSIOTHERAPY:"Fisioterapia", PODIATRY:"Podología", OTHER:"Otra",
  };

  const isAdmin  = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const isDoctor = user.role === "DOCTOR";

  const features = CATEGORY_FEATURES[clinicCategory] ?? CATEGORY_FEATURES.OTHER;

  const ALL_NAV = [
    { key:"dashboard",     href:"/dashboard",              icon:LayoutDashboard, label:"Dashboard",       adminOnly: false },
    { key:"appointments",  href:"/dashboard/appointments", icon:Calendar,        label:"Agenda",          adminOnly: false },
    { key:"patients",      href:"/dashboard/patients",     icon:Users,           label:"Pacientes",       adminOnly: false },
    { key:"clinical",      href:"/dashboard/clinical",     icon:Stethoscope,     label:"Expedientes",     adminOnly: false },
    { key:"treatments",    href:"/dashboard/treatments",   icon:Activity,        label:"Tratamientos",    adminOnly: false },
    { key:"before-after",  href:"/dashboard/before-after", icon:Camera,          label:"Antes/Después",   adminOnly: false },
    { key:"packages",      href:"/dashboard/packages",     icon:Gift,            label:"Paquetes",        adminOnly: true  },
    { key:"formulas",      href:"/dashboard/formulas",     icon:FlaskConical,    label:"Fórmulas",        adminOnly: false },
    { key:"walk-in",       href:"/dashboard/walk-in",      icon:Clock,           label:"Lista de espera", adminOnly: false },
    { key:"exercises",     href:"/dashboard/exercises",    icon:Dumbbell,        label:"Ejercicios",      adminOnly: false },
    { key:"orthotics",     href:"/dashboard/orthotics",    icon:Footprints,      label:"Ortesis",         adminOnly: false },
    { key:"resources",     href:"/dashboard/resources",    icon:DoorOpen,        label:"Recursos/Salas",  adminOnly: true  },
    { key:"billing",       href:"/dashboard/billing",      icon:CreditCard,      label:"Facturación",     adminOnly: true  },
    { key:"inventory",     href:"/dashboard/inventory",    icon:Package,         label:"Inventario",      adminOnly: true  },
    { key:"xrays",         href:"/dashboard/xrays",        icon:FileImage,       label:"Radiografías",    adminOnly: false },
    { key:"whatsapp",      href:"/dashboard/whatsapp",     icon:MessageCircle,   label:"WhatsApp",        adminOnly: true  },
    { key:"team",          href:"/dashboard/team",         icon:UserCog,         label:"Equipo",          adminOnly: true  },
    { key:"reports",       href:"/dashboard/reports",      icon:BarChart2,       label:"Reportes",        adminOnly: true  },
    { key:"settings",      href:"/dashboard/settings",     icon:Settings,        label:"Configuración",   adminOnly: false },
    { key:"procedures",    href:"/dashboard/procedures",   icon:ClipboardList,   label:"Procedimientos",  adminOnly: true  },
    { key:"landing",       href:"/dashboard/landing",      icon:Globe,           label:"Página web",      adminOnly: true  },
    { key:"ai-assistant",  href:"/dashboard/ai-assistant", icon:Sparkles,        label:"IA Asistente",    adminOnly: false },
    { key:"teleconsulta",  href:"/dashboard/teleconsulta", icon:Video,           label:"Teleconsulta",    adminOnly: false },
  ];

  const NAV = ALL_NAV.filter((n) => {
    if (!features.includes(n.key)) return false;
    if (n.adminOnly && !isAdmin) return false;
    return true;
  });

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();
  const roleLabel: Record<string, string> = {
    ADMIN:"Admin", DOCTOR:"Doctor", RECEPTIONIST:"Recep.",
    SUPER_ADMIN:"Admin", READONLY:"Solo lectura",
  };
  void isDoctor;

  const SidebarContent = ({ isCollapsed }: { isCollapsed: boolean }) => (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full flex-col bg-sidebar">
        {/* Header */}
        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet to-indigo shadow-lg shadow-violet/20">
              <span className="text-sm font-bold text-white">M</span>
            </div>
            {!isCollapsed && (
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-base font-semibold text-sidebar-foreground">MediFlow</span>
                <span className="truncate text-xs text-muted-foreground">{plan}</span>
              </div>
            )}
          </div>

          {/* Clinic switcher */}
          {!isCollapsed && hasMultipleClinics && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="mt-2 h-auto w-full justify-between rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-2 text-sm hover:bg-sidebar-accent/70"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sidebar-foreground">{clinicName}</span>
                  </div>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[240px]">
                <DropdownMenuLabel>Cambiar clínica</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allClinics.map((c) => (
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
                      <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-violet" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!isCollapsed && !hasMultipleClinics && (
            <div className="mt-1 truncate pl-12 text-xs text-muted-foreground">{clinicName}</div>
          )}
        </div>

        {/* Nav */}
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-2">
          <ul className="flex flex-col gap-1">
            {NAV.map((item) => {
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
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                    active
                      ? "bg-gradient-to-r from-violet/20 to-indigo/10 text-sidebar-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    isCollapsed && "justify-center px-2"
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-violet" />
                  )}
                  <Icon
                    className={cn(
                      "h-5 w-5 shrink-0 transition-colors",
                      active ? "text-violet" : "text-muted-foreground group-hover:text-sidebar-accent-foreground"
                    )}
                    aria-hidden
                  />
                  {!isCollapsed && (
                    <>
                      <span className="truncate">{item.label}</span>
                      {isWa && !active && (
                        <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                      )}
                    </>
                  )}
                </Link>
              );

              if (isCollapsed) {
                return (
                  <li key={item.href}>
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  </li>
                );
              }
              return <li key={item.href}>{link}</li>;
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="mt-auto border-t border-sidebar-border p-3">
          {/* Onboarding mini */}
          {!isCollapsed && onboardingCompleted && (
            <div className="mb-3">
              <OnboardingMini completed={onboardingCompleted} />
            </div>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleDark}
            className={cn(
              "mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isCollapsed && "justify-center px-2"
            )}
            aria-label="Cambiar tema"
          >
            {dark ? <Moon className="h-4 w-4 shrink-0" /> : <Sun className="h-4 w-4 shrink-0" />}
            {!isCollapsed && <span>{dark ? "Modo oscuro" : "Modo claro"}</span>}
          </button>

          {/* User dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  "h-auto w-full justify-start gap-3 rounded-lg p-2 hover:bg-sidebar-accent",
                  isCollapsed && "justify-center"
                )}
              >
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: user.color ?? "#7c3aed" }}
                >
                  {initials}
                </div>
                {!isCollapsed && (
                  <>
                    <div className="flex min-w-0 flex-1 flex-col items-start text-left">
                      <span className="truncate text-sm font-medium text-sidebar-foreground">
                        {user.firstName} {user.lastName}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {roleLabel[user.role] ?? user.role}
                      </span>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </>
                )}
              </Button>
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
            className="mt-2 hidden w-full items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:flex"
            aria-label={isCollapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
          >
            {isCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!isCollapsed && <span>Colapsar</span>}
          </button>
        </div>
      </div>
    </TooltipProvider>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border lg:flex",
          "transition-[width] duration-300",
          collapsed ? "w-[72px]" : "w-[260px]"
        )}
      >
        <SidebarContent isCollapsed={collapsed} />
      </aside>

      {/* Mobile top bar */}
      <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet to-indigo">
          <span className="text-sm font-bold text-white">M</span>
        </div>
        <span className="text-base font-semibold text-sidebar-foreground">MediFlow</span>
        <span className="ml-auto max-w-[140px] truncate text-sm text-muted-foreground">{clinicName}</span>
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

    // Focus first interactive element
    const firstFocusable = drawer.querySelector<HTMLElement>(
      'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;

      const focusable = drawer.querySelectorAll<HTMLElement>(
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
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside ref={drawerRef} className="relative flex h-full w-[280px] flex-col border-r border-sidebar-border">
        <button
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={onClose}
          aria-label="Cerrar menú"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </aside>
    </div>
  );
}
