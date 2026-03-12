import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Star } from "lucide-react";

const SOCIAL_PROOF = [
  { initials: "AG", color: "bg-violet-500" },
  { initials: "RS", color: "bg-brand-600"  },
  { initials: "MR", color: "bg-emerald-600"},
  { initials: "CM", color: "bg-pink-500"   },
];

export function Hero() {
  return (
    <section className="hero-bg relative overflow-hidden pt-20 pb-28 px-6">
      {/* Background grid decoration */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(rgba(37,99,235,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.04) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="container-tight relative text-center">
        {/* Eyebrow */}
        <div className="inline-flex items-center gap-2.5 rounded-full bg-brand-50 border border-brand-100 px-4 py-2 mb-8">
          <span className="flex h-2 w-2 rounded-full bg-brand-600" />
          <span className="text-xs font-semibold text-brand-700 tracking-wide uppercase">
            Nuevo · Notas clínicas con IA
          </span>
          <ArrowRight className="w-3 h-3 text-brand-600" />
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] text-foreground mb-6">
          El sistema operativo{" "}
          <br className="hidden sm:block" />
          <span className="gradient-text">de tu clínica</span>
        </h1>

        {/* Subheadline */}
        <p className="mx-auto max-w-2xl text-lg sm:text-xl text-muted-foreground leading-relaxed mb-10">
          Gestiona pacientes, agenda, expedientes y facturación desde un solo
          panel. Diseñado para médicos, dentistas, nutriólogos y más.
          <strong className="text-foreground"> Sin instalaciones. Sin IT.</strong>
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Button size="xl" asChild>
            <Link href="/register">
              ✦ Empieza 14 días gratis
            </Link>
          </Button>
          <Button size="xl" variant="outline" asChild>
            <Link href="/dashboard">
              Ver demo en vivo →
            </Link>
          </Button>
        </div>

        {/* Social proof */}
        <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
          <div className="flex -space-x-2">
            {SOCIAL_PROOF.map((a) => (
              <div
                key={a.initials}
                className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white ${a.color}`}
              >
                {a.initials}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            ))}
          </div>
          <span>
            <strong className="text-foreground">+2,400 clínicas</strong> en LATAM y España
          </span>
        </div>
      </div>

      {/* Dashboard preview */}
      <div className="container-wide mt-16 relative">
        <div className="relative mx-auto max-w-5xl">
          {/* Glow behind preview */}
          <div className="absolute inset-0 -top-8 bg-gradient-to-b from-brand-600/15 to-transparent rounded-3xl blur-3xl" />

          {/* Preview card */}
          <div className="relative rounded-2xl border border-border/80 bg-white shadow-card-lg overflow-hidden">
            {/* Browser top bar */}
            <div className="flex items-center gap-2 px-4 py-3 bg-muted/60 border-b border-border">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-rose-400" />
                <span className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="w-3 h-3 rounded-full bg-emerald-400" />
              </div>
              <div className="flex-1 bg-white rounded-md h-6 flex items-center px-3">
                <span className="text-xs text-muted-foreground font-mono">app.mediflow.com/dashboard</span>
              </div>
            </div>

            {/* Dashboard mini-preview */}
            <div className="flex h-[400px] overflow-hidden">
              {/* Sidebar mini */}
              <div className="w-48 bg-slate-900 flex flex-col p-3 gap-1 flex-shrink-0">
                <div className="flex items-center gap-2 px-2 py-3 mb-2">
                  <div className="w-6 h-6 rounded-lg bg-brand-600 flex items-center justify-center text-xs font-bold text-white">M</div>
                  <span className="text-xs font-bold text-white">MediFlow</span>
                  <span className="ml-auto text-[10px] bg-brand-600 text-white px-1.5 py-0.5 rounded-full font-bold">Pro</span>
                </div>
                {["⊞ Dashboard", "📅 Agenda", "👥 Pacientes", "📋 Expedientes", "🦷 Odontograma", "💳 Facturación"].map((item, i) => (
                  <div
                    key={item}
                    className={`px-2.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 ${
                      i === 0
                        ? "bg-brand-600 text-white"
                        : "text-slate-400 hover:bg-white/8"
                    }`}
                  >
                    {item}
                  </div>
                ))}
              </div>

              {/* Main area mini */}
              <div className="flex-1 bg-slate-50 p-4 overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm font-bold text-foreground">Buenos días, Dra. García 👋</div>
                    <div className="text-xs text-muted-foreground">Jueves, 12 de Junio 2025</div>
                  </div>
                  <div className="bg-brand-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer">
                    + Nueva cita
                  </div>
                </div>

                {/* KPI mini */}
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {[
                    { label: "Citas hoy", val: "8",      icon: "📅", bg: "bg-brand-50"   },
                    { label: "Nuevos",    val: "47",     icon: "👥", bg: "bg-emerald-50" },
                    { label: "Ingresos",  val: "$3,240", icon: "💰", bg: "bg-amber-50"   },
                    { label: "Confirm.",  val: "94%",    icon: "✅", bg: "bg-violet-50"  },
                  ].map((kpi) => (
                    <div key={kpi.label} className="bg-white rounded-lg p-2.5 border border-border shadow-card">
                      <div className={`w-6 h-6 rounded-md ${kpi.bg} flex items-center justify-center text-xs mb-1.5`}>{kpi.icon}</div>
                      <div className="text-sm font-bold text-foreground">{kpi.val}</div>
                      <div className="text-[10px] text-muted-foreground">{kpi.label}</div>
                    </div>
                  ))}
                </div>

                {/* Mini appointment list */}
                <div className="bg-white rounded-lg border border-border p-2.5">
                  <div className="text-xs font-semibold text-foreground mb-2">📅 Agenda de hoy</div>
                  {[
                    { time: "09:00", name: "Ana García",    type: "Limpieza dental",  color: "bg-violet-500", badge: "Confirmada", badgeColor: "text-emerald-700 bg-emerald-50" },
                    { time: "10:30", name: "Roberto Sánchez", type: "Extracción molar", color: "bg-brand-600",  badge: "En curso",   badgeColor: "text-brand-700 bg-brand-50"   },
                    { time: "12:00", name: "María Rodríguez",  type: "Ortodoncia",       color: "bg-emerald-600",badge: "Pendiente",  badgeColor: "text-amber-700 bg-amber-50"   },
                  ].map((appt) => (
                    <div key={appt.time} className="flex items-center gap-2 py-1.5 border-b border-border/60 last:border-0">
                      <span className="text-[10px] font-mono font-bold text-muted-foreground w-10">{appt.time}</span>
                      <div className={`w-5 h-5 rounded-full ${appt.color} flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0`}>
                        {appt.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold truncate">{appt.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{appt.type}</div>
                      </div>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${appt.badgeColor}`}>
                        {appt.badge}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
