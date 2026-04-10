"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Calendar, Users, CreditCard,
  BarChart2, Settings, LogOut, Menu, X, Stethoscope,
  Sun, Moon, MessageCircle, Package, UserCog, Activity,
  Camera, Gift, FlaskConical, Clock, DoorOpen, Dumbbell,
  Footprints, FileImage, Globe, Sparkles, ChevronDown, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";

const CATEGORY_FEATURES: Record<string, string[]> = {
  DENTAL: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","xrays","whatsapp","team","reports","settings","landing","ai-assistant"],
  MEDICINE: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","xrays","whatsapp","team","reports","settings","landing","ai-assistant"],
  NUTRITION: ["dashboard","appointments","patients","clinical","treatments","billing","whatsapp","team","reports","settings","landing","ai-assistant"],
  PSYCHOLOGY: ["dashboard","appointments","patients","clinical","treatments","billing","whatsapp","team","reports","settings","landing","ai-assistant"],
  DERMATOLOGY: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","before-after","packages","xrays","whatsapp","team","reports","settings","landing","ai-assistant"],
  AESTHETIC_MEDICINE: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","before-after","packages","whatsapp","team","reports","settings","landing","ai-assistant"],
  HAIR_RESTORATION: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","before-after","whatsapp","team","reports","settings","landing","ai-assistant"],
  BEAUTY_CENTER: ["dashboard","appointments","patients","clinical","packages","billing","inventory","before-after","whatsapp","team","reports","settings","landing","ai-assistant"],
  BROW_LASH: ["dashboard","appointments","patients","clinical","formulas","packages","billing","inventory","before-after","whatsapp","team","reports","settings","landing","ai-assistant"],
  MASSAGE: ["dashboard","appointments","patients","clinical","packages","billing","whatsapp","team","reports","settings","landing","ai-assistant"],
  LASER_HAIR_REMOVAL: ["dashboard","appointments","patients","clinical","packages","billing","inventory","before-after","whatsapp","team","reports","settings","landing","ai-assistant"],
  HAIR_SALON: ["dashboard","appointments","patients","clinical","formulas","billing","inventory","walk-in","before-after","packages","whatsapp","team","reports","settings","landing","ai-assistant"],
  ALTERNATIVE_MEDICINE: ["dashboard","appointments","patients","clinical","treatments","formulas","billing","inventory","whatsapp","team","reports","settings","landing","ai-assistant"],
  NAIL_SALON: ["dashboard","appointments","patients","clinical","billing","inventory","walk-in","whatsapp","team","reports","settings","landing","ai-assistant"],
  SPA: ["dashboard","appointments","patients","clinical","packages","billing","inventory","resources","before-after","whatsapp","team","reports","settings","landing","ai-assistant"],
  PHYSIOTHERAPY: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","exercises","whatsapp","team","reports","settings","landing","ai-assistant"],
  PODIATRY: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","orthotics","exercises","whatsapp","team","reports","settings","landing","ai-assistant"],
  OTHER: ["dashboard","appointments","patients","clinical","treatments","billing","inventory","whatsapp","team","reports","settings","landing","ai-assistant"],
};

interface ClinicOption {
  clinicId: string;
  clinicName: string;
  category: string;
  plan: string;
  role: string;
}

interface SidebarProps {
  user:            { firstName: string; lastName: string; email: string; role: string; color?: string };
  clinicName:      string;
  clinicId:        string;
  plan:            string;
  clinicCategory?: string;
  allClinics?:     ClinicOption[];
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

export function Sidebar({ user, clinicName, clinicId, plan, clinicCategory = "OTHER", allClinics = [] }: SidebarProps) {
  const pathname        = usePathname();
  const router          = useRouter();
  const [open, setOpen] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [switching, setSwitching] = useState(false);
  const { dark, toggle } = useDarkMode();
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
      setShowSwitcher(false);
      // Hard reload to ensure all server components get the new clinic context
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

  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const isDoctor = user.role === "DOCTOR";

  const features = CATEGORY_FEATURES[clinicCategory] ?? CATEGORY_FEATURES.OTHER;

  // Build navigation based on role + category
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
    { key:"landing",       href:"/dashboard/landing",      icon:Globe,           label:"Página web",      adminOnly: true  },
    { key:"ai-assistant",  href:"/dashboard/ai-assistant", icon:Sparkles,        label:"IA Asistente",    adminOnly: false },
  ];

  const NAV = ALL_NAV.filter(n => {
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

  const initials   = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();
  const planColor: Record<string, string> = { BASIC:"bg-slate-500", PRO:"bg-brand-500", CLINIC:"bg-violet-500" };
  const roleLabel: Record<string, string> = { ADMIN:"Admin", DOCTOR:"Doctor", RECEPTIONIST:"Recep.", SUPER_ADMIN:"Admin", READONLY:"Solo lectura" };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo + Clinic Switcher */}
      <div className="px-4 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-sm font-extrabold text-white flex-shrink-0">M</div>
          <span className="font-extrabold text-white text-base">MediFlow</span>
          <span className={cn("ml-auto text-xs font-bold text-white px-2 py-0.5 rounded-full", planColor[plan] ?? "bg-brand-500")}>{plan}</span>
        </div>
        {hasMultipleClinics ? (
          <div className="relative pl-10">
            <button
              onClick={() => setShowSwitcher(s => !s)}
              className="flex items-center gap-1.5 w-full text-left text-sm text-slate-300 hover:text-white transition-colors rounded-lg hover:bg-white/5 px-2 py-1.5 -mx-2"
            >
              <Building2 className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
              <span className="truncate flex-1 font-semibold">{clinicName}</span>
              <ChevronDown className={cn("w-3.5 h-3.5 flex-shrink-0 text-slate-400 transition-transform", showSwitcher && "rotate-180")} />
            </button>
            {showSwitcher && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSwitcher(false)} />
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden max-h-[50vh] overflow-y-auto">
                  <div className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cambiar clínica</div>
                  {allClinics.map(c => (
                    <button
                      key={c.clinicId}
                      onClick={() => switchClinic(c.clinicId)}
                      disabled={switching}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                        c.clinicId === clinicId
                          ? "bg-brand-600/20 text-white"
                          : "text-slate-300 hover:bg-white/5 hover:text-white"
                      )}
                    >
                      <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                        {c.clinicName[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{c.clinicName}</div>
                        <div className="text-[10px] text-slate-400">{CATEGORY_LABELS[c.category] ?? c.category} · {c.plan}</div>
                      </div>
                      {c.clinicId === clinicId && (
                        <div className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-400 truncate pl-10">{clinicName}</div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
          const isWa   = item.href === "/dashboard/whatsapp";
          const isTeam = item.href === "/dashboard/team";
          return (
            <Link key={item.href} href={item.href} prefetch={true} onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors",
                active ? (isWa ? "bg-emerald-600 text-white" : isTeam ? "bg-violet-600 text-white" : "bg-brand-600 text-white")
                       : "text-slate-400 hover:bg-white/10 hover:text-white"
              )}>
              <item.icon className={cn("w-4 h-4 flex-shrink-0",
                isWa && !active && "text-emerald-400",
                isTeam && !active && "text-violet-400"
              )} />
              {item.label}
              {isWa && !active && <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4 border-t border-white/10 pt-3 space-y-1">
        {/* Dark/Light toggle */}
        <button onClick={toggle}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-white/10 transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
              {dark ? <Moon className="w-3.5 h-3.5 text-slate-300" /> : <Sun className="w-3.5 h-3.5 text-amber-300" />}
            </div>
            <span className="text-sm font-semibold text-slate-400">{dark ? "Modo oscuro" : "Modo claro"}</span>
          </div>
          <div className={cn("w-10 h-5 rounded-full relative flex-shrink-0 transition-colors", dark ? "bg-brand-600" : "bg-slate-600")}>
            <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all", dark ? "left-[22px]" : "left-0.5")} />
          </div>
        </button>

        {/* User row */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-white/10 transition-colors group">
          {/* Avatar with doctor color */}
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
            style={{ background: user.color ?? "#7c3aed" }}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">{user.firstName} {user.lastName}</div>
            <div className="text-xs text-slate-400 truncate">{roleLabel[user.role] ?? user.role} · {user.email}</div>
          </div>
          <button onClick={logout} className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-slate-400 hover:text-white transition-all" title="Cerrar sesión">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:flex flex-col w-56 flex-shrink-0 bg-slate-900 h-screen sticky top-0">
        <SidebarContent />
      </aside>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-slate-900 h-14 flex items-center px-4 gap-3">
        <button onClick={() => setOpen(true)} className="p-1.5 rounded-lg text-slate-400 hover:text-white"><Menu className="w-5 h-5" /></button>
        <span className="font-extrabold text-white text-base">MediFlow</span>
        <span className="ml-auto text-sm text-slate-400 truncate max-w-[140px]">{clinicName}</span>
      </div>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="relative w-64 bg-slate-900 h-full flex flex-col">
            <button className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white" onClick={() => setOpen(false)}><X className="w-4 h-4" /></button>
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}
