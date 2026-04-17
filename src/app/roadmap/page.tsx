import type { Metadata } from "next";
import { Header } from "@/components/public/landing/header";
import { Footer } from "@/components/public/landing/footer";
import { ROADMAP, STATUS_META, type RoadmapStatus } from "@/lib/roadmap";

export const metadata: Metadata = {
  title: "Roadmap — MediFlow",
  description: "Qué hemos lanzado, en qué trabajamos y qué viene en MediFlow.",
};

const ORDER: RoadmapStatus[] = ["launched", "in_progress", "planned"];

export default function RoadmapPage() {
  const grouped = ORDER.map(status => ({
    status,
    items: ROADMAP.filter(r => r.status === status),
  }));

  return (
    <div className="min-h-screen bg-[#0B0F1E] text-white">
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-14">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
            Roadmap público de MediFlow
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Aquí puedes ver qué hemos lanzado, en qué estamos trabajando ahora mismo y qué funcionalidades vienen próximamente. Nos guía el feedback de las clínicas que usan la plataforma todos los días.
          </p>
        </div>

        <div className="space-y-14">
          {grouped.map(({ status, items }) => {
            const meta = STATUS_META[status];
            return (
              <section key={status}>
                <div className="flex items-center gap-3 mb-6">
                  <span className={`text-xs font-bold uppercase tracking-widest ${meta.accent}`}>
                    {meta.label}
                  </span>
                  <div className="flex-1 h-px bg-slate-800" />
                  <span className="text-xs font-semibold text-slate-500">{items.length} ítems</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {items.map(item => (
                    <article
                      key={item.title}
                      className={`rounded-2xl border ${meta.border} ${meta.bg} p-5 hover:border-slate-500 transition-colors`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <h3 className="text-base font-bold text-white">{item.title}</h3>
                        {item.quarter && (
                          <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-400">
                            {item.quarter}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed">{item.description}</p>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-16 text-center bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <h2 className="text-xl font-bold mb-2">¿Te falta algo en este roadmap?</h2>
          <p className="text-slate-400 text-sm mb-4">Escríbenos — priorizamos lo que más pidan las clínicas.</p>
          <a
            href="mailto:soporte@mediflow.app"
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 py-3 rounded-xl text-sm transition-colors"
          >
            Sugerir feature →
          </a>
        </div>
      </main>
      <Footer />
    </div>
  );
}
