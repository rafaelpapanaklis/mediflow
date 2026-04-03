import Link from "next/link";

const SPECIALTIES = [
  { icon:"🦷", name:"Odontología",     features:["Odontograma interactivo 32 dientes","Plan de tratamiento por pieza","Evaluación periodontal completa","Prescripción médica integrada"], color:"from-blue-500 to-cyan-500" },
  { icon:"🧠", name:"Psicología",      features:["Notas SOAP, BIRP y DAP","Escalas PHQ-9 y GAD-7 automáticas","Plan terapéutico con metas","Alerta por riesgo suicida"], color:"from-violet-500 to-purple-500" },
  { icon:"🥗", name:"Nutrición",       features:["Cálculo automático IMC, TMB y GET","Plan alimenticio por tiempo de comida","Seguimiento de peso y composición","Registro de laboratorios"], color:"from-emerald-500 to-green-500" },
  { icon:"🩺", name:"Medicina General",features:["Signos vitales completos","Diagnóstico con CIE-10","Prescripción imprimible","Referidos a especialistas + incapacidades"], color:"from-rose-500 to-pink-500" },
  { icon:"✨", name:"Dermatología",    features:["Registro fotográfico de lesiones","Historial de procedimientos","Expediente clínico completo","Seguimiento de tratamientos"], color:"from-amber-500 to-orange-500" },
];

const FEATURES = [
  { icon:"📅", title:"Agenda inteligente",       desc:"Gestiona citas de todo tu equipo. Sin dobles reservaciones ni confusiones." },
  { icon:"👥", title:"Expediente del paciente",  desc:"Historia clínica, alergias, medicamentos, estudios y evolución completa." },
  { icon:"💰", title:"Facturación integrada",    desc:"Crea facturas, registra pagos y controla las finanzas de tu clínica." },
  { icon:"📊", title:"Reportes y estadísticas",  desc:"Ingresos, pacientes nuevos y citas por mes. Decisiones con datos." },
  { icon:"🔒", title:"Seguro y en la nube",      desc:"Cifrado de extremo a extremo con respaldos automáticos diarios." },
  { icon:"⚡", title:"Setup en 5 minutos",       desc:"Sin instalaciones ni servidores. Empieza a trabajar hoy mismo." },
];

const PLANS = [
  { id:"BASIC",  name:"Básico",       price:"$49",  desc:"Consultorio individual", features:["1 profesional","200 pacientes","Agenda completa","Expediente clínico","Facturación","Soporte email"], highlight:false },
  { id:"PRO",    name:"Profesional",  price:"$99",  desc:"El más popular",        features:["Hasta 3 profesionales","Pacientes ilimitados","Todo lo del Básico","Reportes avanzados","Historial completo","Soporte prioritario"], highlight:true },
  { id:"CLINIC", name:"Clínica",      price:"$249", desc:"Equipos grandes",       features:["Profesionales ilimitados","Todo lo del Pro","Múltiples sucursales","Manager de cuenta","Acceso API","Soporte 24/7"], highlight:false },
];

const FAQS = [
  { q:"¿Necesito instalar algo?",              a:"No. MediFlow funciona 100% en la nube desde cualquier navegador. Funciona en computadora, tablet y celular." },
  { q:"¿Mis datos están seguros?",             a:"Sí. Usamos cifrado de extremo a extremo con respaldos automáticos. Tus datos nunca se comparten con terceros." },
  { q:"¿Puedo cancelar en cualquier momento?", a:"Sí. Sin contratos de permanencia. Cancela cuando quieras y exporta todos tus datos." },
  { q:"¿Cómo realizo el pago?",                a:"Aceptamos tarjeta de crédito/débito vía Stripe y transferencia SPEI/CLABE a cuenta BBVA. Activación inmediata con tarjeta." },
  { q:"¿Puedo tener varios doctores?",         a:"Sí. Los planes Pro y Clínica permiten múltiples profesionales con accesos y permisos individuales." },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* NAV */}
      <nav className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur border-b border-white/10 px-6 h-16 flex items-center max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2 font-extrabold text-lg mr-8">
          <div className="w-8 h-8 rounded-xl bg-brand-600 flex items-center justify-center text-white text-sm font-extrabold">M</div>
          MediFlow
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm text-slate-400 flex-1">
          <a href="#funciones"      className="hover:text-white transition-colors">Funciones</a>
          <a href="#especialidades" className="hover:text-white transition-colors">Especialidades</a>
          <a href="#precios"        className="hover:text-white transition-colors">Precios</a>
          <a href="#faq"            className="hover:text-white transition-colors">FAQ</a>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <Link href="/login"    className="text-sm font-semibold text-slate-400 hover:text-white transition-colors hidden sm:block">Iniciar sesión</Link>
          <Link href="/register" className="bg-brand-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-brand-700 transition-colors">Prueba gratis →</Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 bg-brand-950/60 border border-brand-800 text-brand-300 text-xs font-bold px-3 py-1.5 rounded-full mb-6">
          ✨ 14 días gratis · Sin tarjeta de crédito · Cancela cuando quieras
        </div>
        <h1 className="text-5xl lg:text-6xl font-extrabold mb-6 leading-tight tracking-tight">
          El software que necesita<br />
          <span className="bg-gradient-to-r from-brand-400 to-violet-400 bg-clip-text text-transparent">
            tu clínica para crecer
          </span>
        </h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Gestiona pacientes, citas, expedientes clínicos y facturación en un solo lugar.
          Diseñado para médicos, dentistas, nutriólogos y psicólogos en Latinoamérica.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <Link href="/register" className="w-full sm:w-auto bg-brand-600 text-white font-bold px-8 py-4 rounded-2xl hover:bg-brand-700 transition-colors text-lg">
            Crear cuenta gratis →
          </Link>
          <Link href="/login" className="w-full sm:w-auto border border-white/20 text-white font-semibold px-8 py-4 rounded-2xl hover:bg-white/10 transition-colors">
            Ya tengo cuenta
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-8 text-sm">
          {[
            { val:"5 min",  label:"para configurar tu clínica" },
            { val:"100%",   label:"en la nube, sin instalar" },
            { val:"5",      label:"especialidades médicas" },
            { val:"$49",    label:"desde por mes" },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2 text-slate-400">
              <span className="font-extrabold text-white text-xl">{s.val}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* FUNCIONES */}
      <section id="funciones" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold mb-3">Todo lo que necesita tu clínica</h2>
          <p className="text-slate-400 max-w-xl mx-auto">Un sistema completo que reemplaza los cuadernos, hojas de cálculo y múltiples apps separadas.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(f => (
            <div key={f.title} className="bg-slate-900 border border-slate-700 rounded-2xl p-6 hover:border-brand-700 transition-colors">
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="font-bold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ESPECIALIDADES */}
      <section id="especialidades" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold mb-3">Formularios clínicos especializados</h2>
          <p className="text-slate-400 max-w-xl mx-auto">No es un sistema genérico. Cada especialidad tiene su propio expediente con las herramientas que realmente usa en consulta.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {SPECIALTIES.map(s => (
            <div key={s.name} className="bg-slate-900 border border-slate-700 rounded-2xl p-6 hover:border-slate-500 transition-colors">
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${s.color} flex items-center justify-center text-2xl mb-4`}>
                {s.icon}
              </div>
              <h3 className="font-bold text-white mb-3">{s.name}</h3>
              <ul className="space-y-1.5">
                {s.features.map(feat => (
                  <li key={feat} className="flex items-start gap-2 text-sm text-slate-400">
                    <span className="text-emerald-400 mt-0.5 flex-shrink-0">✓</span>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="bg-gradient-to-br from-brand-900/40 to-violet-900/40 border border-brand-800 rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <div className="text-3xl mb-4">🏥</div>
              <h3 className="font-bold text-white mb-2">¿Otra especialidad?</h3>
              <p className="text-sm text-slate-400 leading-relaxed">Seguimos agregando especialidades. Escríbenos y la priorizamos para ti.</p>
            </div>
            <a href="mailto:hola@mediflow.app" className="mt-6 text-sm font-bold text-brand-400 hover:underline">Solicitar especialidad →</a>
          </div>
        </div>
      </section>

      {/* POR QUÉ MEDIFLOW */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-3xl p-8 lg:p-12">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-extrabold mb-6">¿Por qué MediFlow<br/>y no Excel o papel?</h2>
              <div className="space-y-5">
                {[
                  { icon:"🔍", title:"Encuentra todo en segundos",    desc:"Busca cualquier paciente, expediente o factura al instante. Sin carpetas perdidas." },
                  { icon:"📱", title:"Desde cualquier lugar",         desc:"Revisa tu agenda desde el celular, atiende con tablet, genera reportes en la computadora." },
                  { icon:"🤝", title:"Tu equipo siempre coordinado", desc:"Doctores, recepcionistas y administradores trabajando en tiempo real sin conflictos." },
                  { icon:"📈", title:"Crece contigo",                 desc:"Desde consultorio individual hasta clínica con múltiples sucursales y doctores." },
                ].map(item => (
                  <div key={item.title} className="flex gap-4">
                    <span className="text-2xl flex-shrink-0 mt-0.5">{item.icon}</span>
                    <div>
                      <div className="font-bold text-white mb-1">{item.title}</div>
                      <div className="text-sm text-slate-400 leading-relaxed">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-950 rounded-2xl p-5 border border-slate-700">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">Dashboard de ejemplo</div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label:"Citas hoy",   val:"8",          color:"text-brand-400",   bg:"bg-brand-950/50" },
                  { label:"Este mes",    val:"$12,400",    color:"text-amber-400",   bg:"bg-amber-950/50" },
                  { label:"Pacientes",   val:"+3 nuevos",  color:"text-emerald-400", bg:"bg-emerald-950/50" },
                  { label:"Plan activo", val:"PRO",        color:"text-violet-400",  bg:"bg-violet-950/50" },
                ].map(k => (
                  <div key={k.label} className={`${k.bg} rounded-xl p-3`}>
                    <div className={`text-lg font-extrabold ${k.color}`}>{k.val}</div>
                    <div className="text-xs text-slate-500">{k.label}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {["10:00 — María García · Consulta general","11:30 — Pedro López · Control","14:00 — Ana Torres · Primera vez"].map(appt => (
                  <div key={appt} className="flex items-center gap-2 py-2 border-b border-slate-800 last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
                    <span className="text-xs text-slate-400">{appt}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRECIOS */}
      <section id="precios" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold mb-3">Precios simples y transparentes</h2>
          <p className="text-slate-400">14 días gratis en cualquier plan. Sin tarjeta de crédito. Sin sorpresas.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {PLANS.map(plan => (
            <div key={plan.id} className={`rounded-2xl p-7 border flex flex-col relative ${plan.highlight ? "bg-brand-900/20 border-brand-500" : "bg-slate-900 border-slate-700"}`}>
              {plan.highlight && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap">
                  ⭐ Más popular
                </div>
              )}
              <div className="mb-5">
                <h3 className="font-bold text-white text-lg mb-0.5">{plan.name}</h3>
                <p className="text-xs text-slate-400">{plan.desc}</p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-extrabold">{plan.price}</span>
                <span className="text-slate-400 text-sm">/mes</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
                    <span className="text-emerald-400 flex-shrink-0 font-bold">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/register" className={`w-full text-center font-bold py-3 rounded-xl transition-colors text-sm ${plan.highlight ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-slate-600 text-white hover:bg-slate-800"}`}>
                Empezar 14 días gratis
              </Link>
            </div>
          ))}
        </div>
        <p className="text-center mt-6 text-sm text-slate-500">
          Precios en USD. Aceptamos SPEI/CLABE y tarjeta.{" "}
          <a href="mailto:hola@mediflow.app" className="text-brand-400 hover:underline">Contáctanos</a> para descuentos anuales.
        </p>
      </section>

      {/* PANEL PREVIEW — INTERACTIVE */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-extrabold mb-3">Así se ve el panel de cada especialidad</h2>
          <p className="text-slate-400 max-w-xl mx-auto">Haz clic en una especialidad para ver cómo trabaja el doctor dentro del sistema.</p>
        </div>

        {/* Tabs — client side via JS */}
        <div className="flex gap-2 justify-center flex-wrap mb-8" id="spec-tabs">
          {[
            { id:"dental", label:"🦷 Odontología",    color:"#2563eb" },
            { id:"psico",  label:"🧠 Psicología",     color:"#7c3aed" },
            { id:"nutri",  label:"🥗 Nutrición",      color:"#059669" },
            { id:"medic",  label:"🩺 Medicina",       color:"#e11d48" },
            { id:"derm",   label:"✨ Dermatología",   color:"#d97706" },
          ].map((t, i) => (
            <button key={t.id} data-spec={t.id}
              className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${i === 0 ? "text-white border-transparent" : "border-slate-700 bg-slate-900 text-slate-400 hover:text-white"}`}
              style={i === 0 ? { background: t.color } : {}}
              onClick={undefined}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Browser frame */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="bg-slate-800 px-4 py-2.5 flex items-center gap-2 border-b border-slate-700">
            <div className="w-3 h-3 rounded-full bg-rose-500"></div>
            <div className="w-3 h-3 rounded-full bg-amber-500"></div>
            <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
            <div className="flex-1 bg-slate-900 rounded-md px-3 py-1 text-xs text-slate-500 ml-2 max-w-xs" id="preview-url">
              mediflow.app/dental-garcia/expedientes
            </div>
          </div>
          <div className="flex" style={{ height: "420px" }}>
            {/* Sidebar */}
            <div className="w-44 flex-shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col">
              <div className="px-3 py-3 border-b border-slate-800">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-5 h-5 rounded-md bg-brand-600 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">M</div>
                  <span className="text-xs font-bold text-white">MediFlow</span>
                  <span className="ml-auto text-[9px] font-bold text-white bg-violet-600 px-1.5 py-0.5 rounded-full">PRO</span>
                </div>
                <div className="text-[9px] text-slate-500 pl-7" id="preview-clinic">Clínica Dental García</div>
              </div>
              <nav className="flex-1 px-2 py-2 space-y-0.5 text-[10px]">
                {[["🏠","Dashboard"],["📅","Agenda"],["👥","Pacientes"],["📋","Expedientes"],["💰","Facturación"],["📊","Reportes"],["⚙️","Config"]].map(([icon,label]) => (
                  <div key={label} className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${label==="Expedientes"?"bg-brand-600 text-white":"text-slate-500"}`}>
                    <span>{icon}</span>{label}
                  </div>
                ))}
              </nav>
              <div className="px-2 py-2 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" id="preview-avatar">DG</div>
                  <div>
                    <div className="text-[9px] font-bold text-white" id="preview-doctor">Dr. García</div>
                    <div className="text-[8px] text-slate-500" id="preview-email">dr@dental.com</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Content panels */}
            <div className="flex-1 overflow-y-auto p-3 bg-slate-950 text-[10px]">

              {/* DENTAL */}
              <div id="panel-dental" className="space-y-2">
                <div className="font-bold text-white text-xs mb-2">🦷 Expediente Dental — Sofía Martínez</div>
                <div className="grid grid-cols-3 gap-2">
                  {[["23","Visitas","#60a5fa"],["$18,500","Plan","#fbbf24"],["87%","Pagado","#34d399"]].map(([v,l,c])=>(
                    <div key={l} className="bg-slate-900 border border-slate-800 rounded-lg p-2"><div className="font-bold" style={{color:c}}>{v}</div><div className="text-slate-500">{l}</div></div>
                  ))}
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                  <div className="font-bold text-white mb-2">Odontograma</div>
                  <div className="flex gap-1 justify-center mb-1">
                    {["s","c","s","r","s","s","e","s","s","s","r","s","c","s","s","a"].map((t,i)=>(
                      <div key={i} style={{width:13,height:15,borderRadius:3,fontSize:7,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid",
                        background:t==="c"?"#fca5a5":t==="r"?"#bfdbfe":t==="e"?"#c4b5fd":t==="a"?"#1e293b":"#1e293b",
                        borderColor:t==="c"?"#ef4444":t==="r"?"#3b82f6":t==="e"?"#7c3aed":"#334155",
                        color:t==="c"?"#7f1d1d":t==="r"?"#1e3a8a":"#475569",opacity:t==="a"?0.4:1}}>{t==="e"?"E":""}</div>
                    ))}
                  </div>
                  <div className="flex gap-1 justify-center">
                    {["a","s","s","c","s","r","s","s","s","s","e","s","s","c","s","s"].map((t,i)=>(
                      <div key={i} style={{width:13,height:15,borderRadius:3,fontSize:7,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid",
                        background:t==="c"?"#fca5a5":t==="r"?"#bfdbfe":t==="e"?"#c4b5fd":"#1e293b",
                        borderColor:t==="c"?"#ef4444":t==="r"?"#3b82f6":t==="e"?"#7c3aed":"#334155",opacity:t==="a"?0.3:1}}>{t==="e"?"E":""}</div>
                    ))}
                  </div>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {[["Caries","#fca5a5","#ef4444"],["Restauración","#bfdbfe","#3b82f6"],["Endodoncia","#c4b5fd","#7c3aed"],["Ausente","#1e293b","#475569"]].map(([l,bg,bc])=>(
                      <span key={l} style={{background:bg,borderColor:bc,color:bc,border:"1px solid",padding:"1px 6px",borderRadius:999,fontSize:8,fontWeight:700}}>{l}</span>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <div className="font-bold text-white mb-1.5">Procedimientos</div>
                    {[["Profilaxis","#059669"],["Restauración #15","#2563eb"],["Endodoncia #26","#7c3aed"]].map(([p,c])=>(
                      <span key={p} style={{background:c+"22",color:c,border:`1px solid ${c}44`,padding:"1px 6px",borderRadius:999,fontSize:8,fontWeight:700,display:"inline-block",margin:"1px"}}>{p}</span>
                    ))}
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <div className="font-bold text-white mb-1.5">Periodontal</div>
                    {[["Índice placa","35%"],["Cálculo","Moderado"],["Encías","Inflamadas"]].map(([l,v])=>(
                      <div key={l} className="flex justify-between py-0.5 border-b border-slate-800 last:border-0"><span className="text-slate-500">{l}</span><span className="text-slate-300 font-bold">{v}</span></div>
                    ))}
                  </div>
                </div>
              </div>

              {/* PSICOLOGÍA */}
              <div id="panel-psico" className="space-y-2 hidden">
                <div className="font-bold text-white text-xs mb-2">🧠 Sesión #8 — Carlos Mendoza</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-900 border rounded-lg p-2" style={{borderColor:"#7c3aed44",background:"rgba(124,58,237,0.1)"}}>
                    <div className="font-bold text-white mb-1">PHQ-9 · Depresión</div>
                    <div style={{fontSize:22,fontWeight:800,color:"#a78bfa"}}>12<span style={{fontSize:10,color:"#475569"}}>/27</span></div>
                    <div style={{fontSize:9,fontWeight:700,color:"#fbbf24"}}>Moderado</div>
                    <div style={{height:4,background:"#334155",borderRadius:2,marginTop:4}}><div style={{height:"100%",width:"44%",background:"#7c3aed",borderRadius:2}}></div></div>
                  </div>
                  <div className="bg-slate-900 border rounded-lg p-2" style={{borderColor:"#2563eb44",background:"rgba(37,99,235,0.1)"}}>
                    <div className="font-bold text-white mb-1">GAD-7 · Ansiedad</div>
                    <div style={{fontSize:22,fontWeight:800,color:"#60a5fa"}}>8<span style={{fontSize:10,color:"#475569"}}>/21</span></div>
                    <div style={{fontSize:9,fontWeight:700,color:"#fbbf24"}}>Leve</div>
                    <div style={{height:4,background:"#334155",borderRadius:2,marginTop:4}}><div style={{height:"100%",width:"38%",background:"#2563eb",borderRadius:2}}></div></div>
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                  <div className="font-bold text-white mb-1.5">Nota SOAP · Sesión de hoy</div>
                  {[["S — Subjetivo","Menos episodios de llanto esta semana"],["A — Diagnóstico","F32.1 Depresión moderada"],["P — Plan","Activación conductual + diario emociones"]].map(([l,v])=>(
                    <div key={l} className="flex justify-between py-0.5 border-b border-slate-800 last:border-0"><span className="text-slate-500">{l}</span><span className="text-slate-300 font-bold text-right" style={{maxWidth:140}}>{v}</span></div>
                  ))}
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                  <div className="font-bold text-white mb-1.5">Metas terapéuticas</div>
                  {[["Reducir ansiedad social","#10b981","En progreso"],["Mejorar calidad de sueño","#f59e0b","En progreso"],["Técnica de respiración","#2563eb","Logrado"]].map(([l,c,v])=>(
                    <div key={l} className="flex justify-between py-0.5 border-b border-slate-800 last:border-0">
                      <span className="text-slate-400">{l}</span>
                      <span style={{color:c,fontWeight:700}}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* NUTRICIÓN */}
              <div id="panel-nutri" className="space-y-2 hidden">
                <div className="font-bold text-white text-xs mb-2">🥗 Consulta Nutricional — Ana Torres</div>
                <div className="grid grid-cols-3 gap-2">
                  {[["27.4","IMC","#fbbf24"],["1,680 kcal","TMB","#34d399"],["2,184 kcal","GET","#60a5fa"]].map(([v,l,c])=>(
                    <div key={l} className="bg-slate-900 border border-slate-800 rounded-lg p-2"><div className="font-bold" style={{color:c}}>{v}</div><div className="text-slate-500">{l}</div></div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <div className="font-bold text-white mb-1.5">Antropometría</div>
                    {[["Peso","72 kg"],["Talla","162 cm"],["% Grasa","31%"],["Cintura","88 cm"],["ICC","0.87"]].map(([l,v])=>(
                      <div key={l} className="flex justify-between py-0.5 border-b border-slate-800 last:border-0"><span className="text-slate-500">{l}</span><span className="text-slate-300 font-bold">{v}</span></div>
                    ))}
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <div className="font-bold text-white mb-1.5">Progreso de peso</div>
                    {[["Consulta 1","75 kg",100,"#ef4444"],["Consulta 2","73 kg",94,"#f59e0b"],["Consulta 3","72 kg",88,"#10b981"]].map(([l,v,w,c])=>(
                      <div key={l} className="mb-2">
                        <div className="flex justify-between mb-0.5"><span className="text-slate-500">{l}</span><span style={{color:c,fontWeight:700}}>{v}</span></div>
                        <div style={{height:4,background:"#334155",borderRadius:2}}><div style={{height:"100%",width:`${w}%`,background:c,borderRadius:2}}></div></div>
                      </div>
                    ))}
                    <div style={{fontSize:9,color:"#34d399",fontWeight:700,marginTop:4}}>▼ -3kg en 3 semanas</div>
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                  <div className="font-bold text-white mb-1.5">Plan alimenticio del día</div>
                  {[["Desayuno","Avena + fruta + 2 claras"],["Comida","Pollo + verduras + arroz"],["Cena","Sopa verduras + tortilla"],["Meta calórica","1,600 kcal/día"]].map(([l,v])=>(
                    <div key={l} className="flex justify-between py-0.5 border-b border-slate-800 last:border-0"><span className="text-slate-500">{l}</span><span className={`font-bold ${l==="Meta calórica"?"text-emerald-400":"text-slate-300"}`}>{v}</span></div>
                  ))}
                </div>
              </div>

              {/* MEDICINA */}
              <div id="panel-medic" className="space-y-2 hidden">
                <div className="font-bold text-white text-xs mb-2">🩺 Consulta Médica — Roberto Sánchez</div>
                <div className="grid grid-cols-3 gap-2">
                  {[["120/80","T/A","#f87171"],["36.5°C","Temp","#34d399"],["98%","Sat O₂","#60a5fa"]].map(([v,l,c])=>(
                    <div key={l} className="bg-slate-900 border border-slate-800 rounded-lg p-2"><div className="font-bold" style={{color:c}}>{v}</div><div className="text-slate-500">{l}</div></div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <div className="font-bold text-white mb-1.5">Signos vitales</div>
                    {[["FC","72 lpm"],["FR","16 rpm"],["Glucemia","95 mg/dL"],["Peso","78 kg"]].map(([l,v])=>(
                      <div key={l} className="flex justify-between py-0.5 border-b border-slate-800 last:border-0"><span className="text-slate-500">{l}</span><span className="text-slate-300 font-bold">{v}</span></div>
                    ))}
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <div className="font-bold text-white mb-1.5">Diagnóstico</div>
                    <div style={{fontSize:10,fontWeight:700,color:"#f87171",marginBottom:6}}>J00 — Resfriado común</div>
                    {[["Motivo","Tos + congestión"],["Incapacidad","2 días"]].map(([l,v])=>(
                      <div key={l} className="flex justify-between py-0.5 border-b border-slate-800 last:border-0"><span className="text-slate-500">{l}</span><span className="text-slate-300 font-bold">{v}</span></div>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                  <div className="font-bold text-white mb-1.5">💊 Prescripción médica</div>
                  {[["Ibuprofeno 400mg","c/8h · 5 días"],["Loratadina 10mg","c/24h · 7 días"],["Paracetamol 500mg","c/6h si fiebre"]].map(([l,v])=>(
                    <div key={l} className="flex justify-between py-0.5 border-b border-slate-800 last:border-0"><span className="text-slate-400">{l}</span><span className="text-slate-300 font-bold">{v}</span></div>
                  ))}
                  <span style={{background:"#1e3a8a",color:"#60a5fa",border:"1px solid #2563eb44",padding:"1px 8px",borderRadius:999,fontSize:8,fontWeight:700,display:"inline-block",marginTop:6}}>Imprimir receta</span>
                </div>
              </div>

              {/* DERMATOLOGÍA */}
              <div id="panel-derm" className="space-y-2 hidden">
                <div className="font-bold text-white text-xs mb-2">✨ Consulta Dermatológica — Lucía Flores</div>
                <div className="grid grid-cols-3 gap-2">
                  {[["5","Visitas","#fbbf24"],["Activo","Tratamiento","#34d399"],["4","Imágenes","#60a5fa"]].map(([v,l,c])=>(
                    <div key={l} className="bg-slate-900 border border-slate-800 rounded-lg p-2"><div className="font-bold" style={{color:c}}>{v}</div><div className="text-slate-500">{l}</div></div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <div className="font-bold text-white mb-1.5">Diagnóstico</div>
                    <div style={{fontSize:10,fontWeight:700,color:"#fbbf24",marginBottom:6}}>L70.0 — Acné vulgar moderado</div>
                    {[["Zona","Frente y mejillas"],["Severidad","Moderada"],["Evolución","Mejorando"]].map(([l,v])=>(
                      <div key={l} className="flex justify-between py-0.5 border-b border-slate-800 last:border-0"><span className="text-slate-500">{l}</span><span className={`font-bold ${v==="Mejorando"?"text-emerald-400":"text-slate-300"}`}>{v}</span></div>
                    ))}
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <div className="font-bold text-white mb-1.5">Procedimientos</div>
                    {[["Limpieza facial profunda","#d97706"],["Extracción comedones","#d97706"],["Peeling químico leve","#2563eb"]].map(([p,c])=>(
                      <span key={p} style={{background:c+"22",color:c,border:`1px solid ${c}44`,padding:"1px 6px",borderRadius:999,fontSize:8,fontWeight:700,display:"block",margin:"2px 0"}}>{p}</span>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                  <div className="font-bold text-white mb-1.5">💊 Tratamiento indicado</div>
                  {[["Tretinoína 0.025% crema","Noches · 60 días"],["Clindamicina gel 1%","Mañanas · 60 días"],["Protector solar SPF 50","Diario"]].map(([l,v])=>(
                    <div key={l} className="flex justify-between py-0.5 border-b border-slate-800 last:border-0"><span className="text-slate-400">{l}</span><span className="text-slate-300 font-bold">{v}</span></div>
                  ))}
                  <span style={{background:"#05966922",color:"#34d399",border:"1px solid #05966944",padding:"1px 8px",borderRadius:999,fontSize:8,fontWeight:700,display:"inline-block",marginTop:6}}>Control en 4 semanas</span>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Client-side tab switching */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            const specs = [
              { id:'dental', url:'mediflow.app/dental-garcia/expedientes',    clinic:'Clínica Dental García',    avatar:'DG', doctor:'Dr. García',    email:'dr@dental.com',   color:'#2563eb' },
              { id:'psico',  url:'mediflow.app/psicologia-bienestar/expedientes', clinic:'Centro Psicológico',   avatar:'CP', doctor:'Dra. López',   email:'lopez@psico.com', color:'#7c3aed' },
              { id:'nutri',  url:'mediflow.app/nutricion-torres/expedientes',  clinic:'Nutrición Torres',         avatar:'NT', doctor:'Lic. Torres',  email:'torres@nutri.com',color:'#059669' },
              { id:'medic',  url:'mediflow.app/clinica-sanchez/expedientes',   clinic:'Consultorio Dr. Sánchez',  avatar:'DS', doctor:'Dr. Sánchez',  email:'sanchez@med.com', color:'#e11d48' },
              { id:'derm',   url:'mediflow.app/dermatologia-flores/expedientes',clinic:'Dermatología Flores',     avatar:'DF', doctor:'Dra. Flores',  email:'flores@derm.com', color:'#d97706' },
            ];
            document.querySelectorAll('[data-spec]').forEach(btn => {
              btn.addEventListener('click', function() {
                const sid = this.dataset.spec;
                const s = specs.find(x => x.id === sid);
                document.querySelectorAll('[data-spec]').forEach(b => {
                  b.style.background = '';
                  b.style.borderColor = '';
                  b.classList.add('border-slate-700','bg-slate-900','text-slate-400');
                  b.classList.remove('text-white');
                });
                this.style.background = s.color;
                this.style.borderColor = 'transparent';
                this.classList.remove('border-slate-700','bg-slate-900','text-slate-400');
                this.classList.add('text-white');
                document.getElementById('preview-url').textContent = s.url;
                document.getElementById('preview-clinic').textContent = s.clinic;
                document.getElementById('preview-avatar').textContent = s.avatar;
                document.getElementById('preview-doctor').textContent = s.doctor;
                document.getElementById('preview-email').textContent = s.email;
                document.querySelectorAll('[id^="panel-"]').forEach(p => p.classList.add('hidden'));
                document.getElementById('panel-' + sid).classList.remove('hidden');
              });
            });
          })();
        ` }} />
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold mb-3">Preguntas frecuentes</h2>
        </div>
        <div className="space-y-4">
          {FAQS.map(faq => (
            <div key={faq.q} className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <h3 className="font-bold text-white mb-2 text-sm">{faq.q}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <div className="bg-gradient-to-br from-brand-900/50 to-violet-900/50 border border-brand-700 rounded-3xl p-12">
          <h2 className="text-4xl font-extrabold mb-4">Empieza hoy. Es gratis.</h2>
          <p className="text-slate-400 mb-8 text-lg max-w-md mx-auto">Configura tu clínica en 5 minutos. Sin instalaciones, sin contratos.</p>
          <Link href="/register" className="inline-flex items-center gap-2 bg-brand-600 text-white font-bold px-10 py-4 rounded-2xl hover:bg-brand-700 transition-colors text-lg">
            Crear cuenta gratis →
          </Link>
          <p className="text-xs text-slate-500 mt-4">14 días gratis · Sin tarjeta · Cancela cuando quieras</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/10 px-6 py-10 max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-extrabold text-white">
            <div className="w-6 h-6 rounded-lg bg-brand-600 flex items-center justify-center text-xs font-extrabold">M</div>
            MediFlow
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <a href="mailto:hola@mediflow.app" className="hover:text-white transition-colors">hola@mediflow.app</a>
            <Link href="/login"    className="hover:text-white transition-colors">Iniciar sesión</Link>
            <Link href="/register" className="hover:text-white transition-colors">Registrarse</Link>
          </div>
          <div className="text-xs text-slate-600">© 2026 MediFlow. Todos los derechos reservados.</div>
        </div>
      </footer>

    </div>
  );
}
