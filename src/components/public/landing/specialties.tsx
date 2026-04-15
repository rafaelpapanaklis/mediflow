"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Stethoscope, Sparkles, Flower2, Smile, Salad, Brain, Sun,
  Activity, Dumbbell, Scissors, Hand, Zap, Leaf, Palette, Waves,
  type LucideIcon,
} from "lucide-react";
import {
  specialties, iconColors,
  type SpecialtyCategory, type SpecialtyIconKey,
} from "@/lib/landing-data";

const SPEC_ICONS: Record<SpecialtyIconKey, LucideIcon> = {
  Smile, Stethoscope, Salad, Brain, Sun, Activity, Dumbbell,
  Sparkles, Scissors, Flower2, Hand, Zap, Leaf, Palette, Waves,
};

const TABS: { id: SpecialtyCategory; label: string; Icon: LucideIcon }[] = [
  { id: "salud",    label: "Salud",              Icon: Stethoscope },
  { id: "estetica", label: "Medicina Estética",  Icon: Sparkles },
  { id: "belleza",  label: "Belleza y Bienestar", Icon: Flower2 },
];

export function Specialties() {
  const [activeTab, setActiveTab] = useState<SpecialtyCategory>("salud");

  return (
    <section id="especialidades" className="py-24 md:py-32 section-alt relative">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-violet-400 mb-4 block">
            18 especialidades
          </span>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Diseñado para tu especialidad
          </h2>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            Cada categoría tiene formularios clínicos, herramientas y flujos únicos.
          </p>
        </motion.div>

        <div className="flex flex-wrap justify-center gap-4 mb-12">
          {TABS.map((tab) => {
            const TabIcon = tab.Icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`spec-tab flex items-center gap-2 px-6 py-3 rounded-full font-semibold ${
                  isActive
                    ? "active text-white"
                    : "bg-[#111631] border border-[rgba(99,102,241,0.1)] text-slate-400 hover:text-white hover:border-[rgba(99,102,241,0.25)]"
                }`}
              >
                <TabIcon className="w-5 h-5 relative z-10" />
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
        >
          {specialties[activeTab].map((spec, i) => {
            const Icon = SPEC_ICONS[spec.iconKey];
            const color = iconColors[spec.colorKey];
            return (
              <motion.div
                key={spec.slug}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Link href={`/${spec.slug}`} className="card-dark p-6 group cursor-pointer block h-full">
                  <div className={`w-12 h-12 ${color.bg} rounded-xl flex items-center justify-center mb-4`}>
                    <Icon className={`w-6 h-6 ${color.text}`} />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">{spec.name}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{spec.desc}</p>
                </Link>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
