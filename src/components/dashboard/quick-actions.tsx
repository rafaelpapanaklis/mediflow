"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Plus, Search, FileText, Bot, Calendar, Pill,
  X, Clock, User, ChevronRight,
} from "lucide-react";

interface Patient { id: string; firstName: string; lastName: string; patientNumber: string; phone?: string | null }
interface QuickActionsProps {
  currentUserId: string;
  clinicId: string;
  isAdmin: boolean;
}

// ── Global command palette (Cmd+K) ──────────────────────────────────────────
function CommandPalette({ onClose, clinicId }: { onClose: () => void; clinicId: string }) {
  const [query,    setQuery]    = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading,  setLoading]  = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) { setPatients([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/patients?search=${encodeURIComponent(query)}`);
        const data = await res.json();
        setPatients(Array.isArray(data) ? data.slice(0, 6) : []);
      } catch { setPatients([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function go(path: string) { router.push(path); onClose(); }

  const QUICK_LINKS = [
    { icon:"📅", label:"Agenda de hoy",      path:"/dashboard/appointments" },
    { icon:"👥", label:"Pacientes",           path:"/dashboard/patients"     },
    { icon:"📋", label:"Expedientes",         path:"/dashboard/clinical"     },
    { icon:"🤖", label:"Asistente IA",        path:"/dashboard/ai-assistant" },
    { icon:"📊", label:"Reportes",            path:"/dashboard/reports"      },
    { icon:"⚙️", label:"Configuración",       path:"/dashboard/settings"     },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-16 px-4"
      style={{ background:"rgba(0,0,0,0.6)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xl border border-border overflow-hidden"
        onKeyDown={e => e.key === "Escape" && onClose()}>

        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <input ref={inputRef}
            className="flex-1 text-base bg-transparent focus:outline-none placeholder:text-muted-foreground"
            placeholder="Buscar paciente, ir a página…"
            value={query} onChange={e => setQuery(e.target.value)} />
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {/* Patient results */}
          {query.trim() && (
            <div className="p-2">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide px-2 py-1.5">Pacientes</div>
              {loading ? (
                <div className="text-sm text-muted-foreground px-2 py-3">Buscando…</div>
              ) : patients.length === 0 ? (
                <div className="text-sm text-muted-foreground px-2 py-3">Sin resultados para "{query}"</div>
              ) : patients.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-muted/40 cursor-pointer group">
                  <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {p.firstName[0]}{p.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold">{p.firstName} {p.lastName}</div>
                    <div className="text-sm text-muted-foreground">{p.patientNumber}{p.phone ? ` · ${p.phone}` : ""}</div>
                  </div>
                  <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {[
                      { label:"Expediente", path:`/dashboard/patients/${p.id}` },
                      { label:"Cita",       path:`/dashboard/appointments?new=1&patientId=${p.id}` },
                    ].map(a => (
                      <button key={a.label} onClick={() => go(a.path)}
                        className="text-xs font-semibold px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-border rounded-lg hover:border-brand-400 hover:text-brand-600 transition-colors">
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick links */}
          {!query.trim() && (
            <div className="p-2">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide px-2 py-1.5">Navegación rápida</div>
              {QUICK_LINKS.map(l => (
                <button key={l.path} onClick={() => go(l.path)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-muted/40 transition-colors text-left">
                  <span className="text-xl w-8 flex-shrink-0 text-center">{l.icon}</span>
                  <span className="text-base font-semibold flex-1">{l.label}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-border flex items-center gap-4">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded font-mono">↵</kbd> Abrir
          </span>
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded font-mono">Esc</kbd> Cerrar
          </span>
          <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded font-mono">⌘K</kbd> Abrir buscador
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Quick Actions Bar ────────────────────────────────────────────────────────
export function QuickActionsBar({ currentUserId, clinicId, isAdmin }: QuickActionsProps) {
  const [showPalette, setShowPalette] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowPalette(prev => !prev);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const ACTIONS = [
    {
      icon: <Plus className="w-5 h-5" />,
      label: "Nueva cita",
      onClick: () => router.push("/dashboard/appointments?new=1"),
      primary: true,
      // primary is always highlighted regardless of path
    },
    {
      icon: <Search className="w-5 h-5" />,
      label: "Buscar paciente",
      onClick: () => setShowPalette(true),
      shortcut: "⌘K",
    },
    {
      icon: <Calendar className="w-5 h-5" />,
      label: "Mi agenda",
      path: "/dashboard/appointments",
      onClick: () => router.push("/dashboard/appointments"),
    },
    {
      icon: <FileText className="w-5 h-5" />,
      label: "Expedientes",
      path: "/dashboard/clinical",
      onClick: () => router.push("/dashboard/clinical"),
    },
    {
      icon: <Bot className="w-5 h-5" />,
      label: "Asistente IA",
      path: "/dashboard/ai-assistant",
      onClick: () => router.push("/dashboard/ai-assistant"),
      ai: true,
    },
    ...(isAdmin ? [{
      icon: <Pill className="w-5 h-5" />,
      label: "Facturación",
      path: "/dashboard/billing",
      onClick: () => router.push("/dashboard/billing"),
    }] : []),
  ];

  function isActive(path?: string): boolean {
    if (!path) return false;
    if (path === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(path);
  }

  return (
    <>
      <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-border rounded-2xl px-3 py-2.5 shadow-card flex-wrap">
        {ACTIONS.map((action, i) => {
          const active = isActive((action as any).path);
          return (
            <button key={i} onClick={action.onClick}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all hover:scale-105 active:scale-95
                ${action.primary
                  ? "bg-brand-600 text-white hover:bg-brand-700 shadow-sm"
                  : action.ai && active
                    ? "bg-violet-600 text-white shadow-md ring-2 ring-violet-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-900"
                    : action.ai
                      ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200"
                    : active
                      ? "bg-brand-600 text-white shadow-md ring-2 ring-brand-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-900"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
              {action.icon}
              <span className="hidden sm:inline">{action.label}</span>
              {action.shortcut && (
                <kbd className="hidden lg:inline text-xs px-1.5 py-0.5 bg-black/10 dark:bg-white/10 rounded font-mono">{action.shortcut}</kbd>
              )}
            </button>
          );
        })}
      </div>

      {showPalette && <CommandPalette onClose={() => setShowPalette(false)} clinicId={clinicId} />}
    </>
  );
}
