"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
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

  return (
    <button
      onClick={toggle}
      className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-white/10 transition-colors mb-1"
      title={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10">
          {dark ? <Moon className="w-3.5 h-3.5 text-slate-300" /> : <Sun className="w-3.5 h-3.5 text-amber-300" />}
        </div>
        <span className="text-xs font-semibold text-slate-400">
          {dark ? "Modo oscuro" : "Modo claro"}
        </span>
      </div>
      {/* Toggle pill */}
      <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${dark ? "bg-brand-600" : "bg-slate-600"}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${dark ? "left-[18px]" : "left-0.5"}`} />
      </div>
    </button>
  );
}
