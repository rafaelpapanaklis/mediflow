"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ChevronDown } from "lucide-react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SPECIALTY_LIST, type SpecialtyContent, type SpecialtyColor } from "@/lib/specialty-content";

/* ────────────────────────────────────────────────────────────────── */
/*  Mapas estáticos (Tailwind JIT los detecta porque son literales)    */
/* ────────────────────────────────────────────────────────────────── */

const colorClasses: Record<SpecialtyColor, { bg: string; text: string; dot: string; hoverBg: string; hoverBorder: string }> = {
  blue:    { bg: "bg-blue-500/15",    text: "text-blue-400",    dot: "bg-blue-500",    hoverBg: "hover:bg-blue-500/10",    hoverBorder: "hover:border-l-blue-500"    },
  teal:    { bg: "bg-teal-500/15",    text: "text-teal-400",    dot: "bg-teal-500",    hoverBg: "hover:bg-teal-500/10",    hoverBorder: "hover:border-l-teal-500"    },
  emerald: { bg: "bg-emerald-500/15", text: "text-emerald-400", dot: "bg-emerald-500", hoverBg: "hover:bg-emerald-500/10", hoverBorder: "hover:border-l-emerald-500" },
  violet:  { bg: "bg-violet-500/15",  text: "text-violet-400",  dot: "bg-violet-500",  hoverBg: "hover:bg-violet-500/10",  hoverBorder: "hover:border-l-violet-500"  },
  amber:   { bg: "bg-amber-500/15",   text: "text-amber-400",   dot: "bg-amber-500",   hoverBg: "hover:bg-amber-500/10",   hoverBorder: "hover:border-l-amber-500"   },
  lime:    { bg: "bg-lime-500/15",    text: "text-lime-400",    dot: "bg-lime-500",    hoverBg: "hover:bg-lime-500/10",    hoverBorder: "hover:border-l-lime-500"    },
  rose:    { bg: "bg-rose-500/15",    text: "text-rose-400",    dot: "bg-rose-500",    hoverBg: "hover:bg-rose-500/10",    hoverBorder: "hover:border-l-rose-500"    },
  pink:    { bg: "bg-pink-500/15",    text: "text-pink-400",    dot: "bg-pink-500",    hoverBg: "hover:bg-pink-500/10",    hoverBorder: "hover:border-l-pink-500"    },
  purple:  { bg: "bg-purple-500/15",  text: "text-purple-400",  dot: "bg-purple-500",  hoverBg: "hover:bg-purple-500/10",  hoverBorder: "hover:border-l-purple-500"  },
  cyan:    { bg: "bg-cyan-500/15",    text: "text-cyan-400",    dot: "bg-cyan-500",    hoverBg: "hover:bg-cyan-500/10",    hoverBorder: "hover:border-l-cyan-500"    },
  orange:  { bg: "bg-orange-500/15",  text: "text-orange-400",  dot: "bg-orange-500",  hoverBg: "hover:bg-orange-500/10",  hoverBorder: "hover:border-l-orange-500"  },
  indigo:  { bg: "bg-indigo-500/15",  text: "text-indigo-400",  dot: "bg-indigo-500",  hoverBg: "hover:bg-indigo-500/10",  hoverBorder: "hover:border-l-indigo-500"  },
  green:   { bg: "bg-green-500/15",   text: "text-green-400",   dot: "bg-green-500",   hoverBg: "hover:bg-green-500/10",   hoverBorder: "hover:border-l-green-500"   },
  fuchsia: { bg: "bg-fuchsia-500/15", text: "text-fuchsia-400", dot: "bg-fuchsia-500", hoverBg: "hover:bg-fuchsia-500/10", hoverBorder: "hover:border-l-fuchsia-500" },
};

const GROUP_ORDER: Array<{ key: "salud" | "estetica" | "belleza"; title: string }> = [
  { key: "salud",    title: "SALUD" },
  { key: "estetica", title: "MEDICINA ESTÉTICA" },
  { key: "belleza",  title: "BELLEZA Y BIENESTAR" },
];

function resolveIcon(name: string): LucideIcon {
  const lib = LucideIcons as unknown as Record<string, LucideIcon>;
  return lib[name] ?? LucideIcons.Circle;
}

/* ────────────────────────────────────────────────────────────────── */
/*  Componente                                                         */
/* ────────────────────────────────────────────────────────────────── */

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileSpecExpanded, setMobileSpecExpanded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Cerrar con Escape + click fuera
  useEffect(() => {
    if (!dropdownOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDropdownOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [dropdownOpen]);

  const grouped = GROUP_ORDER.map((g) => ({
    ...g,
    items: SPECIALTY_LIST.filter((s) => s.category === g.key),
  }));

  return (
    <header className="backdrop-blur-xl bg-[#0B0F1E]/80 border-b border-[rgba(99,102,241,0.1)] z-50 sticky top-0">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="flex items-center justify-between h-20">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-600/20">
              <span className="text-white font-black text-lg">M</span>
            </div>
            <span className="font-bold text-xl text-white">MediFlow</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8" ref={dropdownRef}>
            <div className="relative">
              <button
                type="button"
                aria-haspopup="true"
                aria-expanded={dropdownOpen}
                aria-label="Abrir menú de especialidades"
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors font-medium"
              >
                Especialidades
                <ChevronDown className={`h-4 w-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-1/2 top-full z-50 mt-3 w-[720px] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#0E1229]/95 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl"
                    role="menu"
                  >
                    <div className="grid grid-cols-3 gap-6">
                      {grouped.map((group) => (
                        <div key={group.key}>
                          <h3 className="mb-3 text-[10px] font-bold tracking-[0.18em] text-slate-500">
                            {group.title}
                          </h3>
                          <ul className="space-y-1">
                            {group.items.map((s) => (
                              <SpecialtyMenuItem
                                key={s.slug}
                                specialty={s}
                                onNavigate={() => setDropdownOpen(false)}
                              />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <a href="#funciones" className="text-slate-400 hover:text-white transition-colors font-medium">Funciones</a>
            <a href="#precios" className="text-slate-400 hover:text-white transition-colors font-medium">Precios</a>
            <a href="#testimonios" className="text-slate-400 hover:text-white transition-colors font-medium">Contacto</a>
          </nav>

          <div className="hidden md:flex items-center gap-4">
            <Link href="/login" className="text-slate-400 hover:text-white transition-colors font-medium">Iniciar sesión</Link>
            <Link
              href="/register"
              className="btn-purple text-white px-6 py-3 rounded-full font-semibold"
            >
              Empezar gratis
            </Link>
          </div>

          <button
            className="md:hidden p-2 text-slate-400"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-[#0E1229] border-t border-[rgba(99,102,241,0.1)] overflow-hidden"
          >
            <nav className="flex flex-col p-6 gap-2">
              <button
                type="button"
                onClick={() => setMobileSpecExpanded((e) => !e)}
                aria-expanded={mobileSpecExpanded}
                className="flex items-center justify-between text-slate-300 hover:text-white font-medium py-2"
              >
                <span>Especialidades</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${mobileSpecExpanded ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {mobileSpecExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden pl-2"
                  >
                    {grouped.map((group) => (
                      <div key={group.key} className="mb-4">
                        <h4 className="mb-2 text-[10px] font-bold tracking-[0.18em] text-slate-500">
                          {group.title}
                        </h4>
                        <ul className="space-y-1">
                          {group.items.map((s) => (
                            <SpecialtyMenuItem
                              key={s.slug}
                              specialty={s}
                              onNavigate={() => {
                                setMobileOpen(false);
                                setMobileSpecExpanded(false);
                              }}
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <a href="#funciones" className="text-slate-400 hover:text-white font-medium py-2" onClick={() => setMobileOpen(false)}>Funciones</a>
              <a href="#precios" className="text-slate-400 hover:text-white font-medium py-2" onClick={() => setMobileOpen(false)}>Precios</a>
              <a href="#testimonios" className="text-slate-400 hover:text-white font-medium py-2" onClick={() => setMobileOpen(false)}>Contacto</a>
              <hr className="border-[rgba(99,102,241,0.1)] my-2" />
              <Link href="/login" className="text-slate-400 font-medium py-2">Iniciar sesión</Link>
              <Link href="/register" className="btn-purple text-white px-6 py-3 rounded-full font-semibold text-center">Empezar gratis</Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Item del menú de especialidades                                    */
/* ────────────────────────────────────────────────────────────────── */

function SpecialtyMenuItem({
  specialty,
  onNavigate,
}: {
  specialty: SpecialtyContent;
  onNavigate: () => void;
}) {
  const c = colorClasses[specialty.color];
  const Icon = resolveIcon(specialty.iconMainName);
  return (
    <li>
      <Link
        href={`/${specialty.slug}`}
        onClick={onNavigate}
        className={`group flex items-center gap-2.5 rounded-lg border-l-2 border-l-transparent px-3 py-2 text-sm text-slate-300 transition-all ${c.hoverBg} ${c.hoverBorder} hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
        role="menuitem"
      >
        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${c.bg}`}>
          <Icon className={`h-3.5 w-3.5 ${c.text}`} />
        </span>
        <span className="truncate font-medium">{specialty.nombre}</span>
        <span className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${c.dot} opacity-0 transition-opacity group-hover:opacity-100`} />
      </Link>
    </li>
  );
}
