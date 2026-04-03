"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Calendar, Users, CreditCard,
  BarChart2, Settings, LogOut, Menu, X, Stethoscope,
  Sun, Moon, MessageCircle, Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";

const NAV = [
  { href: "/dashboard",              icon: LayoutDashboard, label: "Dashboard"     },
  { href: "/dashboard/appointments", icon: Calendar,        label: "Agenda"        },
  { href: "/dashboard/patients",     icon: Users,           label: "Pacientes"     },
  { href: "/dashboard/clinical",     icon: Stethoscope,     label: "Expedientes"   },
  { href: "/dashboard/billing",      icon: CreditCard,      label: "Facturación"   },
  { href: "/dashboard/inventory",    icon: Package,         label: "Inventario"    },
  { href: "/dashboard/whatsapp",     icon: MessageCircle,   label: "WhatsApp"      },
  { href: "/dashboard/reports",      icon: BarChart2,       label: "Reportes"      },
  { href: "/dashboard/settings",     icon: Settings,        label: "Configuración" },
];

interface SidebarProps {
  user:       { firstName: string; lastName: string; email: string; role: string };
  clinicName: string;
  plan:       string;
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

export function Sidebar({ user, clinicName, plan }: SidebarProps) {
  const pathname        = usePathname();
  const router          = useRouter();
  const [open, setOpen] = useState(false);
  const { dark, toggle } = useDarkMode();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials  = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();
  const planColor: Record<string, string> = { BASIC:"bg-slate-500", PRO:"bg-brand-500", CLINIC:"bg-violet-500" };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="px-4 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-sm font-extrabold text-white flex-shrink-0">M</div>
          <span className="font-extrabold text-white text-base">MediFlow</span>
          <span className={cn("ml-auto text-xs font-bold text-white px-2 py-0.5 rounded-full", planColor[plan] ?? "bg-brand-500")}>{plan}</span>
        </div>
        <div className="text-sm text-slate-400 truncate pl-10">{clinicName}</div>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
          const isWa   = item.href === "/dashboard/whatsapp";
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors",
                active ? (isWa ? "bg-emerald-600 text-white" : "bg-brand-600 text-white")
                       : "text-slate-400 hover:bg-white/10 hover:text-white"
              )}>
              <item.icon className={cn("w-4 h-4 flex-shrink-0", isWa && !active && "text-emerald-400")} />
              {item.label}
              {isWa && !active && <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4 border-t border-white/10 pt-3 space-y-1">
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

        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-white/10 transition-colors group">
          <div className="w-9 h-9 rounded-full bg-violet-500 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">{initials}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">{user.firstName} {user.lastName}</div>
            <div className="text-xs text-slate-400 truncate">{user.email}</div>
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
