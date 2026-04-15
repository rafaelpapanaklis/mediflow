"use client";

import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { steps } from "@/lib/landing-data";

export function Steps() {
  return (
    <section className="py-24 md:py-32 bg-[#0B0F1E] relative">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-violet-400 mb-4 block">
            Fácil configuración
          </span>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Empieza en 3 pasos
          </h2>
          <p className="text-lg text-slate-400">
            Configura tu clínica en menos de 5 minutos.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="relative"
            >
              <div className="card-dark p-8 h-full">
                <div className="step-number w-14 h-14 rounded-2xl flex items-center justify-center mb-6">
                  <span className="text-2xl font-black text-white">{step.number}</span>
                </div>
                <h3 className="text-2xl font-semibold text-white mb-3">{step.title}</h3>
                <p className="text-slate-400">{step.desc}</p>
              </div>
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10">
                  <ChevronRight className="w-6 h-6 text-violet-500/50" />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
