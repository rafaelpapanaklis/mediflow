import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <nav className="px-8 h-16 flex items-center justify-between border-b border-white/10 max-w-6xl mx-auto">
        <div className="flex items-center gap-2 font-extrabold text-lg text-brand-400">
          <div className="w-8 h-8 rounded-xl bg-brand-600 flex items-center justify-center text-white text-sm font-extrabold">M</div>
          MediFlow
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-semibold text-slate-400 hover:text-white transition-colors">Iniciar sesión</Link>
          <Link href="/register" className="bg-brand-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-brand-700 transition-colors">Empezar gratis</Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-8 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-brand-900/50 border border-brand-700 text-brand-300 text-xs font-bold px-3 py-1.5 rounded-full mb-6">
          ✨ 14 días gratis · Sin tarjeta de crédito
        </div>
        <h1 className="text-5xl font-extrabold mb-6 leading-tight">
          El panel de control que<br />
          <span className="text-brand-400">tu clínica necesita</span>
        </h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10">
          Gestiona pacientes, citas, expedientes clínicos y facturación en un solo lugar. Diseñado para médicos, dentistas, nutriólogos y psicólogos.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/register" className="bg-brand-600 text-white font-bold px-8 py-4 rounded-2xl hover:bg-brand-700 transition-colors text-lg">
            Crear cuenta gratis →
          </Link>
          <Link href="/login" className="border border-white/20 text-white font-semibold px-8 py-4 rounded-2xl hover:bg-white/10 transition-colors">
            Iniciar sesión
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-20 text-left">
          {[
            { icon: "🦷", title: "Odontología",    desc: "Odontograma interactivo, plan de tratamiento dental, periodoncia" },
            { icon: "🧠", title: "Psicología",     desc: "PHQ-9, GAD-7, notas SOAP/BIRP/DAP, plan terapéutico con metas" },
            { icon: "🥗", title: "Nutrición",      desc: "Antropometría, IMC, TMB, seguimiento de peso, plan alimenticio" },
            { icon: "🩺", title: "Medicina General", desc: "Signos vitales, prescripciones, referidos, historial clínico" },
          ].map(s => (
            <div key={s.title} className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
              <div className="text-3xl mb-3">{s.icon}</div>
              <div className="font-bold mb-1">{s.title}</div>
              <div className="text-xs text-slate-400">{s.desc}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-8 mt-16 border-t border-white/10 pt-16">
          {[
            { value: "50+",  label: "Clínicas activas"        },
            { value: "$49",  label: "Desde /mes por clínica"  },
            { value: "100%", label: "En la nube, sin instalar" },
          ].map(s => (
            <div key={s.label}>
              <div className="text-4xl font-extrabold text-brand-400">{s.value}</div>
              <div className="text-slate-400 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
