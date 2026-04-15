"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

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

          <nav className="hidden md:flex items-center gap-8">
            <a href="#especialidades" className="text-slate-400 hover:text-white transition-colors font-medium">Especialidades</a>
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

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-[#0E1229] border-t border-[rgba(99,102,241,0.1)] overflow-hidden"
          >
            <nav className="flex flex-col p-6 gap-4">
              <a href="#especialidades" className="text-slate-400 hover:text-white font-medium py-2" onClick={() => setMobileOpen(false)}>Especialidades</a>
              <a href="#funciones" className="text-slate-400 hover:text-white font-medium py-2" onClick={() => setMobileOpen(false)}>Funciones</a>
              <a href="#precios" className="text-slate-400 hover:text-white font-medium py-2" onClick={() => setMobileOpen(false)}>Precios</a>
              <a href="#testimonios" className="text-slate-400 hover:text-white font-medium py-2" onClick={() => setMobileOpen(false)}>Contacto</a>
              <hr className="border-[rgba(99,102,241,0.1)]" />
              <Link href="/login" className="text-slate-400 font-medium py-2">Iniciar sesión</Link>
              <Link href="/register" className="btn-purple text-white px-6 py-3 rounded-full font-semibold text-center">Empezar gratis</Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
