"use client";

import { motion } from "framer-motion";
import { ArrowRight, Calendar, MessageCircle } from "lucide-react";
import { stats } from "@/lib/landing-data";

export function Hero() {
  return (
    <section className="relative overflow-hidden hero-mesh py-20 md:py-32">
      <div className="orb orb-purple w-96 h-96 -top-48 -right-48" />
      <div className="orb orb-teal w-72 h-72 bottom-0 left-0" />

      <div className="max-w-7xl mx-auto px-6 md:px-12 relative z-10">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="inline-flex items-center gap-2 bg-[#111631] border border-[rgba(99,102,241,0.2)] rounded-full px-4 py-2 mb-6"
            >
              <div className="flex -space-x-1.5">
                <div className="w-5 h-5 rounded-full bg-indigo-500" />
                <div className="w-5 h-5 rounded-full bg-violet-500" />
                <div className="w-5 h-5 rounded-full bg-purple-500" />
              </div>
              <span className="text-sm text-slate-300">
                Usado por <span className="text-violet-400 font-semibold">500+</span> clínicas en México
              </span>
            </motion.div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-black tracking-tighter leading-[0.95] text-white mb-6">
              El software que tu{" "}
              <span className="gradient-text-purple">clínica</span>{" "}
              necesita
            </h1>
            <p className="text-lg md:text-xl text-slate-400 leading-relaxed mb-8 max-w-lg">
              Gestión integral para clínicas de salud, medicina estética y belleza.
              Agenda, expedientes, facturación y WhatsApp — todo en un solo lugar.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-12">
              <a
                href="/register"
                className="btn-purple inline-flex items-center justify-center gap-2 text-white px-8 py-4 rounded-full font-semibold text-lg"
              >
                Comenzar gratis
                <ArrowRight className="w-5 h-5" />
              </a>
              <a
                href="#especialidades"
                className="btn-outline-dark inline-flex items-center justify-center gap-2 text-slate-300 px-8 py-4 rounded-full font-semibold text-lg"
              >
                Ver especialidades
              </a>
            </div>

            <div className="flex flex-wrap gap-8">
              {stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                >
                  <div className="text-3xl md:text-4xl font-black text-white">{stat.number}</div>
                  <div className="text-sm text-slate-500">{stat.label}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative"
          >
            <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-violet-500/10 border border-[rgba(99,102,241,0.15)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=800&h=600&fit=crop"
                alt="Doctora usando MediFlow"
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F1E]/60 to-transparent" />
            </div>

            <motion.div
              className="absolute -bottom-6 -left-6 glass-dark rounded-2xl p-4 shadow-xl"
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-500/15 rounded-xl flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Citas hoy</div>
                  <div className="text-lg font-bold text-white">24 confirmadas</div>
                </div>
              </div>
            </motion.div>

            <motion.div
              className="absolute -top-4 -right-4 glass-dark rounded-2xl p-3 shadow-xl"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: 0.5 }}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-emerald-500/15 rounded-lg flex items-center justify-center">
                  <MessageCircle className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">WhatsApp</div>
                  <div className="text-sm font-semibold text-emerald-400">Confirmado</div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
