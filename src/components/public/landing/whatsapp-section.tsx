"use client";

import { motion } from "framer-motion";
import { Heart, MessageCircle } from "lucide-react";

export function WhatsAppSection() {
  return (
    <section className="py-24 md:py-32 section-alt">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-emerald-400 mb-4 block">
              WhatsApp bidireccional incluido
            </span>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-6">
              Tus pacientes confirman respondiendo{" "}
              <span className="gradient-text-teal">&quot;sí&quot; o &quot;no&quot;</span>
            </h2>
            <p className="text-lg text-slate-400 mb-8">
              Sin apps extra, sin complicaciones. Recordatorios automáticos y confirmación instantánea directamente en WhatsApp.
            </p>
            <a
              href="/register"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-4 rounded-full font-semibold text-lg transition-all hover:shadow-lg hover:shadow-emerald-500/25"
            >
              <MessageCircle className="w-5 h-5" />
              Probarlo gratis
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative"
          >
            <div className="bg-[#0a0e1a] rounded-[3rem] p-4 max-w-sm mx-auto border border-[rgba(99,102,241,0.1)] shadow-2xl shadow-black/30">
              <div className="bg-gradient-to-r from-emerald-600 to-teal-500 rounded-t-[2.5rem] px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-full flex items-center justify-center">
                    <Heart className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="text-white font-semibold">MediFlow</div>
                    <div className="text-emerald-100 text-xs">En línea</div>
                  </div>
                </div>
              </div>
              <div className="bg-[#080b16] rounded-b-[2.5rem] p-4 space-y-3">
                <div className="bg-emerald-900/40 rounded-2xl rounded-tl-none p-3 max-w-[80%] border border-emerald-800/30">
                  <p className="text-sm text-slate-200">Hola María! Te recordamos tu cita mañana a las 10:00 AM con el Dr. García.</p>
                  <p className="text-xs text-emerald-400 mt-2">Responde &quot;sí&quot; para confirmar o &quot;no&quot; para cancelar.</p>
                </div>
                <div className="bg-indigo-900/30 rounded-2xl rounded-tr-none p-3 max-w-[40%] ml-auto border border-indigo-800/30">
                  <p className="text-sm text-white font-medium">sí</p>
                </div>
                <div className="bg-emerald-900/40 rounded-2xl rounded-tl-none p-3 max-w-[70%] border border-emerald-800/30">
                  <p className="text-sm text-slate-200">Tu cita está confirmada. Te esperamos!</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
