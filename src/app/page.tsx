import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white font-sans">
      {/* Nav */}
      <nav className="h-16 border-b border-border flex items-center px-6 lg:px-10 gap-6 sticky top-0 bg-white/90 backdrop-blur z-30">
        <div className="flex items-center gap-2 font-extrabold text-[19px] text-brand-600 mr-4">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center text-white text-xs font-extrabold">M</div>
          MediFlow
        </div>
        <div className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground">
          <Link href="#features" className="hover:text-foreground transition-colors">Características</Link>
          <Link href="#pricing"  className="hover:text-foreground transition-colors">Precios</Link>
          <Link href="#contact"  className="hover:text-foreground transition-colors">Contacto</Link>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/login"    className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">Iniciar sesión</Link>
          <Link href="/register" className="text-sm font-bold bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors">Comenzar gratis →</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 bg-brand-50 border border-brand-200 rounded-full px-4 py-1.5 text-sm font-semibold text-brand-700 mb-8">
          ✨ Software médico 100% en español
        </div>
        <h1 className="text-5xl lg:text-6xl font-extrabold text-foreground leading-[1.1] mb-6">
          Gestiona tu clínica.<br />
          <span className="text-brand-600">Sin complicaciones.</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Citas, pacientes, expedientes y facturación en un solo lugar. Cada clínica tiene sus propios datos, separados y seguros.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/register" className="bg-brand-600 text-white font-bold px-8 py-3.5 rounded-xl hover:bg-brand-700 transition-colors text-lg">
            Prueba gratis 14 días →
          </Link>
          <Link href="/login" className="border border-border text-foreground font-semibold px-8 py-3.5 rounded-xl hover:bg-muted transition-colors text-lg">
            Ver demo
          </Link>
        </div>
        <p className="text-sm text-muted-foreground mt-4">Sin tarjeta de crédito · Cancela cuando quieras · Setup en 5 minutos</p>
      </section>

      {/* Features */}
      <section id="features" className="bg-slate-50 py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-extrabold text-center mb-3">Todo lo que necesitas</h2>
          <p className="text-muted-foreground text-center mb-12">Diseñado para clínicas latinoamericanas</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon:"📅", title:"Agenda inteligente",    desc:"Visualiza y gestiona todas las citas del día. Confirmación en un clic." },
              { icon:"👥", title:"Expedientes completos", desc:"Historial médico, alergias, diagnósticos y más. Siempre disponible." },
              { icon:"💰", title:"Facturación simple",    desc:"Genera facturas, registra pagos y lleva control de tu cartera." },
              { icon:"📊", title:"Reportes y analítica",  desc:"Ingresos, pacientes nuevos, citas completadas. Toma decisiones con datos." },
              { icon:"🔒", title:"Multi-clínica seguro",  desc:"Cada clínica ve únicamente sus propios datos. Aislados completamente." },
              { icon:"📱", title:"Funciona en móvil",     desc:"Accede desde cualquier dispositivo. Tu clínica siempre contigo." },
            ].map(f => (
              <div key={f.title} className="bg-white rounded-2xl border border-border p-6 shadow-card">
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="font-bold text-base mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-extrabold text-center mb-3">Precios simples</h2>
          <p className="text-muted-foreground text-center mb-12">14 días de prueba en todos los planes</p>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { name:"Básico",      price:"$49",   per:"mes", desc:"Ideal para consultorio individual", features:["1 profesional","200 pacientes","Agenda y citas","Facturación básica"], cta:"Empezar gratis",  highlight:false },
              { name:"Profesional", price:"$99",   per:"mes", desc:"El más popular para clínicas",      features:["3 profesionales","Pacientes ilimitados","WhatsApp integrado","Reportes avanzados","Soporte prioritario"], cta:"Empezar gratis", highlight:true  },
              { name:"Clínica",     price:"$249",  per:"mes", desc:"Para redes y grupos médicos",       features:["Ilimitado todo","IA diagnóstica","Telemedicina","API access","Manager de cuenta"], cta:"Contactar",    highlight:false },
            ].map(p => (
              <div key={p.name} className={`rounded-2xl border p-6 ${p.highlight ? "border-brand-300 shadow-card-md ring-2 ring-brand-100 relative" : "border-border shadow-card"}`}>
                {p.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-bold px-3 py-1 rounded-full">Más popular</div>}
                <div className="font-extrabold text-base mb-1">{p.name}</div>
                <div className="flex items-end gap-1 mb-2">
                  <span className="text-4xl font-extrabold">{p.price}</span>
                  <span className="text-muted-foreground text-sm mb-1">/{p.per}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-5">{p.desc}</p>
                <ul className="space-y-2 mb-6">
                  {p.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <span className="text-emerald-500 font-bold">✓</span>{f}
                    </li>
                  ))}
                </ul>
                <Link href="/register" className={`block text-center font-bold py-2.5 rounded-xl transition-colors ${p.highlight ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-border hover:bg-muted"}`}>
                  {p.cta} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-brand-600 to-violet-700 py-16 px-6 text-white text-center">
        <h2 className="text-3xl font-extrabold mb-3">Listo para empezar?</h2>
        <p className="text-white/70 mb-8">Únete a más de 2,400 profesionales de la salud</p>
        <Link href="/register" className="bg-white text-brand-700 font-extrabold px-8 py-3.5 rounded-xl hover:bg-brand-50 transition-colors inline-block">
          Crear mi cuenta gratis →
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6 text-center text-sm text-muted-foreground">
        <div className="flex items-center justify-center gap-2 font-extrabold text-foreground mb-3">
          <div className="w-5 h-5 rounded-md bg-brand-600 flex items-center justify-center text-white text-[10px] font-extrabold">M</div>
          MediFlow
        </div>
        <p>© {new Date().getFullYear()} MediFlow. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
}
