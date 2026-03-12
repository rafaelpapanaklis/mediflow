"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Calendar, Users, FileText, CreditCard, BarChart2, Settings, LogOut, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";

const NAV = [
  { href: "/dashboard",              icon: LayoutDashboard, label: "Dashboard"     },
  { href: "/dashboard/appointments", icon: Calendar,        label: "Agenda"        },
  { href: "/dashboard/patients",     icon: Users,           label: "Pacientes"     },
  { href: "/dashboard/billing",      icon: CreditCard,      label: "Facturación"   },
  { href: "/dashboard/reports",      icon: BarChart2,       label: "Reportes"      },
  { href: "/dashboard/settings",     icon: Settings,        label: "Configuración" },
];

interface SidebarProps {
  user: { firstName: string; lastName: string; email: string; role: string };
  clinicName: string;
  plan: string;
}

export function Sidebar({ user, clinicName, plan }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Sesión cerrada");
    router.push("/login");
  }

  const initials = `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  const planColor: Record<string, string> = { BASIC: "bg-slate-500", PRO: "bg-brand-500", CLINIC: "bg-violet-500" };

  const Content = () => (
    <div className="flex flex-col h-full">
      <div className="px-4 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center text-xs font-extrabold text-white flex-shrink-0">M</div>
          <span className="font-extrabold text-white text-[15px]">MediFlow</span>
          <span className={cn("ml-auto text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full", planColor[plan] ?? "bg-brand-500")}>{plan}</span>
        </div>
        <div className="text-xs text-slate-400 truncate pl-9">{clinicName}</div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                active ? "bg-brand-600 text-white" : "text-slate-400 hover:bg-white/8 hover:text-white"
              )}>
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4 border-t border-white/10 pt-3">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/8 transition-colors group">
          <div className="w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">{initials}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-white truncate">{user.firstName} {user.lastName}</div>
            <div className="text-[10px] text-slate-400 truncate">{user.email}</div>
          </div>
          <button onClick={logout} className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-white transition-all" title="Cerrar sesión">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:flex flex-col w-52 flex-shrink-0 bg-slate-900 h-screen sticky top-0">
        <Content />
      </aside>

      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-slate-900 h-14 flex items-center px-4 gap-3">
        <button onClick={() => setOpen(true)} className="p-1.5 rounded-lg text-slate-400 hover:text-white"><Menu className="w-5 h-5" /></button>
        <span className="font-extrabold text-white text-[15px]">MediFlow</span>
        <span className="ml-auto text-xs text-slate-400 truncate max-w-[140px]">{clinicName}</span>
      </div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="relative w-64 bg-slate-900 h-full flex flex-col">
            <button className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white" onClick={() => setOpen(false)}><X className="w-4 h-4" /></button>
            <Content />
          </aside>
        </div>
      )}
    </>
  );
}
