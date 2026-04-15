"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { pricingPlans } from "@/lib/landing-data";

export function Pricing() {
  return (
    <section id="precios" className="py-24 md:py-32 section-alt relative">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="inline-flex items-center gap-1.5 bg-violet-500/15 border border-violet-500/20 text-violet-400 text-xs font-bold tracking-wider uppercase px-4 py-1.5 rounded-full mb-6">
            14 días gratis
          </span>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Precios simples y transparentes
          </h2>
          <p className="text-lg text-slate-400">
            Sin tarjeta de crédito. Cancela cuando quieras.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6 items-start">
          {pricingPlans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`rounded-[1.3rem] p-8 h-full ${
                plan.highlighted
                  ? "pricing-glow bg-[#111631] text-white md:scale-105 z-10"
                  : "card-dark"
              }`}
            >
              {plan.highlighted && (
                <span className="inline-block bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-bold px-4 py-1.5 rounded-full mb-4">
                  Más popular
                </span>
              )}
              <h3 className="text-2xl font-bold text-white mb-1">{plan.name}</h3>
              <p className="text-sm text-slate-500 mb-6">{plan.subtitle}</p>
              <div className="mb-6">
                <span className="text-5xl font-black text-white">{plan.price}</span>
                <span className="text-slate-500">{plan.period}</span>
              </div>
              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="w-5 h-5 mt-0.5 text-emerald-400 flex-shrink-0" />
                    <span className="text-slate-300">{feature}</span>
                  </li>
                ))}
              </ul>
              <a
                href={`/register?plan=${plan.name.toLowerCase()}`}
                className={`block text-center py-4 rounded-full font-semibold transition-all ${
                  plan.highlighted
                    ? "btn-purple text-white"
                    : "bg-[#1a2044] hover:bg-[#222a55] text-white border border-[rgba(99,102,241,0.15)]"
                }`}
              >
                {plan.cta}
              </a>
            </motion.div>
          ))}
        </div>

        <p className="text-center text-sm text-slate-600 mt-8">
          Precios en MXN. Aceptamos tarjeta de crédito/débito y transferencia SPEI.
        </p>
      </div>
    </section>
  );
}
