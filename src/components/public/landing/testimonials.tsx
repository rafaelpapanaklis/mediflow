"use client";

import { motion } from "framer-motion";
import { Star } from "lucide-react";
import { testimonials } from "@/lib/landing-data";

export function Testimonials() {
  return (
    <section id="testimonios" className="py-24 md:py-32 bg-[#0B0F1E]">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-violet-400 mb-4 block">
            Testimonios
          </span>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Lo que dicen nuestros clientes
          </h2>
          <p className="text-lg text-slate-400">
            Profesionales reales que transformaron su práctica.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="testimonial-dark p-8"
            >
              <div className="flex gap-1 mb-6">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="text-slate-300 mb-6 leading-relaxed">&quot;{t.quote}&quot;</p>
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.image}
                  alt={t.name}
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-violet-500/20"
                />
                <div>
                  <div className="font-semibold text-white text-sm">{t.name}</div>
                  <div className="text-xs text-slate-500">{t.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
