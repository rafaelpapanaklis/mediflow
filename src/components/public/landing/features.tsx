"use client";

import { motion } from "framer-motion";
import {
  Calendar, FileText, Receipt, Users, Camera, Package, Shield, BarChart3,
  type LucideIcon,
} from "lucide-react";
import { features, iconColors, type FeatureIconKey } from "@/lib/landing-data";

const FEATURE_ICONS: Record<FeatureIconKey, LucideIcon> = {
  Calendar, FileText, Receipt, Users, Camera, Package, Shield, BarChart3,
};

export function Features() {
  return (
    <section id="funciones" className="py-24 md:py-32 bg-[#0B0F1E] relative">
      <div className="orb orb-indigo w-80 h-80 top-20 right-0" />

      <div className="max-w-7xl mx-auto px-6 md:px-12 relative z-10">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-violet-400 mb-4 block">
            Todo incluido
          </span>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Todo lo que necesitas en un solo lugar
          </h2>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            Herramientas potentes que reemplazan hojas de cálculo, cuadernos y apps separadas.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {features.map((feature, i) => {
            const Icon = FEATURE_ICONS[feature.iconKey];
            const color = iconColors[feature.colorKey];
            return (
              <motion.div
                key={feature.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className={`bento-dark p-8 ${feature.span}`}
              >
                <div className={`w-14 h-14 ${color.bg} rounded-2xl flex items-center justify-center mb-6`}>
                  <Icon className={`w-7 h-7 ${color.text}`} />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">{feature.name}</h3>
                <p className="text-slate-400">{feature.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
