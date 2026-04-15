"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export function FinalCTA() {
  return (
    <section className="py-24 md:py-32 cta-gradient relative overflow-hidden">
      <div className="orb orb-purple w-96 h-96 -top-48 right-0 opacity-30" />
      <div className="max-w-4xl mx-auto px-6 md:px-12 text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-6">
            Empieza hoy — 14 días gratis
          </h2>
          <p className="text-xl text-white/70 mb-8">
            Sin tarjeta de crédito. Configura tu clínica en 5 minutos.
          </p>
          <a
            href="/register"
            className="inline-flex items-center gap-2 bg-white hover:bg-slate-100 text-[#0B0F1E] px-8 py-4 rounded-full font-semibold text-lg transition-all shadow-lg shadow-black/20"
          >
            Crear cuenta gratis
            <ArrowRight className="w-5 h-5" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
