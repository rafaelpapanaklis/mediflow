"use client";
import { useState, useEffect } from "react";
import { Phone, MapPin, Clock, Instagram, Facebook, Star, ChevronDown, ChevronUp, X, Check, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

const DAYS_ES = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

interface Clinic {
  id: string; name: string; slug: string; specialty: string;
  phone: string | null; email: string | null; address: string | null;
  city: string | null; logoUrl: string | null; description: string | null;
  landingThemeColor: string | null; landingCoverUrl: string | null;
  landingGallery: string[]; landingTestimonials: any; landingFaqs: any;
  landingServices: any; landingWhatsapp: string | null;
  landingInstagram: string | null; landingFacebook: string | null;
  landingTiktok: string | null; landingMapEmbed: string | null;
  landingTagline: string | null;
  users: { id:string; firstName:string; lastName:string; specialty:string|null; color:string; avatarUrl:string|null; services:string[] }[];
  schedules: { dayOfWeek:number; enabled:boolean; openTime:string; closeTime:string }[];
}

export function ClinicLandingClient({ clinic }: { clinic: Clinic }) {
  const theme = clinic.landingThemeColor ?? "#2563eb";
  const [showBook, setShowBook] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [openFaq, setOpenFaq] = useState<number|null>(null);

  const testimonials: any[] = Array.isArray(clinic.landingTestimonials) ? clinic.landingTestimonials : [];
  const faqs: any[]         = Array.isArray(clinic.landingFaqs) ? clinic.landingFaqs : [];
  const services: any[]     = Array.isArray(clinic.landingServices) ? clinic.landingServices : [];
  const gallery: string[]   = clinic.landingGallery ?? [];

  const waLink = clinic.landingWhatsapp
    ? `https://wa.me/${clinic.landingWhatsapp.replace(/\D/g,"")}`
    : null;

  return (
    <div className="min-h-screen bg-white font-sans">

      {/* ── NAVBAR ── */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {clinic.logoUrl
              ? <img src={clinic.logoUrl} alt={clinic.name} className="h-10 w-10 rounded-xl object-contain" />
              : <div className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-extrabold text-lg" style={{background:theme}}>{clinic.name[0]}</div>
            }
            <span className="font-extrabold text-gray-900 text-lg hidden sm:block">{clinic.name}</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-semibold text-gray-500">
            <a href="#servicios" className="hover:text-gray-900">Servicios</a>
            <a href="#doctores" className="hover:text-gray-900">Doctores</a>
            <a href="#galeria" className="hover:text-gray-900">Galería</a>
            <a href="#contacto" className="hover:text-gray-900">Contacto</a>
          </div>
          <button onClick={() => setShowBook(true)}
            className="text-white font-bold px-5 py-2.5 rounded-xl text-sm shadow-md hover:opacity-90 transition-opacity"
            style={{background:theme}}>
            Agendar cita
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden" style={{minHeight:480}}>
        {clinic.landingCoverUrl
          ? <img src={clinic.landingCoverUrl} alt="Portada" className="absolute inset-0 w-full h-full object-cover" />
          : <div className="absolute inset-0" style={{background:`linear-gradient(135deg, ${theme}dd, ${theme}88)`}} />
        }
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative max-w-6xl mx-auto px-4 py-24 text-white">
          <div className="max-w-2xl">
            {clinic.logoUrl && (
              <img src={clinic.logoUrl} alt={clinic.name} className="h-20 w-20 rounded-2xl object-contain mb-6 bg-white/10 p-2" />
            )}
            <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 leading-tight">{clinic.name}</h1>
            {clinic.landingTagline && (
              <p className="text-xl font-semibold text-white/90 mb-4">{clinic.landingTagline}</p>
            )}
            {clinic.description && (
              <p className="text-white/80 text-base mb-8 leading-relaxed max-w-xl">{clinic.description}</p>
            )}
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setShowBook(true)}
                className="text-white font-bold px-8 py-4 rounded-2xl text-base shadow-xl hover:opacity-90 transition-all"
                style={{background:theme}}>
                📅 Agendar cita ahora
              </button>
              {waLink && (
                <a href={waLink} target="_blank" rel="noreferrer"
                  className="bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-4 rounded-2xl text-base shadow-xl transition-all">
                  💬 WhatsApp
                </a>
              )}
            </div>
            <div className="flex flex-wrap gap-4 mt-6 text-sm text-white/80">
              {clinic.city && <span className="flex items-center gap-1"><MapPin size={14}/>{clinic.city}</span>}
              {clinic.phone && <span className="flex items-center gap-1"><Phone size={14}/>{clinic.phone}</span>}
            </div>
          </div>
        </div>
      </section>

      {/* ── SERVICIOS ── */}
      {services.length > 0 && (
        <section id="servicios" className="py-16 bg-gray-50">
          <div className="max-w-6xl mx-auto px-4">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-2">Nuestros servicios</h2>
            <p className="text-gray-500 text-center mb-10">Todo lo que necesitas en un solo lugar</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((svc: any, i: number) => (
                <div key={i} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                  {svc.icon && <div className="text-3xl mb-3">{svc.icon}</div>}
                  <h3 className="font-bold text-gray-900 text-lg mb-2">{svc.name}</h3>
                  {svc.desc && <p className="text-gray-500 text-sm leading-relaxed">{svc.desc}</p>}
                  {svc.price && (
                    <div className="mt-4 font-bold text-lg" style={{color:theme}}>{svc.price}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── DOCTORES ── */}
      {clinic.users.length > 0 && (
        <section id="doctores" className="py-16 bg-white">
          <div className="max-w-6xl mx-auto px-4">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-2">Nuestro equipo</h2>
            <p className="text-gray-500 text-center mb-10">Profesionales dedicados a tu salud</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {clinic.users.map(doc => (
                <div key={doc.id} className="bg-gray-50 rounded-2xl p-6 text-center border border-gray-100 hover:shadow-md transition-shadow">
                  {doc.avatarUrl
                    ? <img src={doc.avatarUrl} alt={doc.firstName} className="w-20 h-20 rounded-full mx-auto mb-4 object-cover" />
                    : <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center text-white font-extrabold text-2xl" style={{background:doc.color}}>
                        {doc.firstName[0]}{doc.lastName[0]}
                      </div>
                  }
                  <h3 className="font-bold text-gray-900 text-lg">Dr/a. {doc.firstName} {doc.lastName}</h3>
                  {doc.specialty && <p className="text-gray-500 text-sm mt-1">{doc.specialty}</p>}
                  {doc.services.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                      {doc.services.slice(0,4).map(s => (
                        <span key={s} className="text-xs px-2.5 py-1 rounded-full font-semibold text-white" style={{background:theme}}>{s}</span>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setShowBook(true)}
                    className="mt-4 w-full py-2 rounded-xl text-sm font-bold border-2 transition-colors hover:text-white"
                    style={{borderColor:theme, color:theme}}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = theme; (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = theme; }}>
                    Agendar con este doctor
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── GALERÍA ── */}
      {gallery.length > 0 && (
        <section id="galeria" className="py-16 bg-gray-50">
          <div className="max-w-6xl mx-auto px-4">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-10">Nuestra clínica</h2>
            <div className="relative">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {gallery.map((url, i) => (
                  <button key={i} onClick={() => setGalleryIdx(i)}
                    className="aspect-square rounded-2xl overflow-hidden hover:opacity-90 transition-opacity">
                    <img src={url} alt={`Foto ${i+1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
              {/* Lightbox */}
              {galleryIdx !== null && (
                <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                  onClick={() => setGalleryIdx(0)}>
                  <button className="absolute top-4 right-4 text-white p-2" onClick={() => setGalleryIdx(-1)}>
                    <X size={24}/>
                  </button>
                  <button className="absolute left-4 text-white p-2"
                    onClick={e => { e.stopPropagation(); setGalleryIdx(i => Math.max(0, i-1)); }}>
                    <ChevronLeft size={32}/>
                  </button>
                  <img src={gallery[galleryIdx]} alt="Foto" className="max-h-[80vh] max-w-full rounded-2xl" onClick={e => e.stopPropagation()} />
                  <button className="absolute right-4 text-white p-2"
                    onClick={e => { e.stopPropagation(); setGalleryIdx(i => Math.min(gallery.length-1, i+1)); }}>
                    <ChevronRight size={32}/>
                  </button>
                  <div className="absolute bottom-4 text-white/60 text-sm">{galleryIdx+1} / {gallery.length}</div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── TESTIMONIOS ── */}
      {testimonials.length > 0 && (
        <section className="py-16 bg-white">
          <div className="max-w-6xl mx-auto px-4">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-2">Lo que dicen nuestros pacientes</h2>
            <p className="text-gray-500 text-center mb-10">Testimonios reales de personas como tú</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {testimonials.map((t: any, i: number) => (
                <div key={i} className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                  <div className="flex gap-0.5 mb-3">
                    {Array.from({length:5}).map((_,j) => (
                      <Star key={j} size={16} className={j < (t.rating??5) ? "fill-amber-400 text-amber-400" : "text-gray-200"} />
                    ))}
                  </div>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">"{t.text}"</p>
                  <div className="flex items-center gap-3">
                    {t.avatarUrl
                      ? <img src={t.avatarUrl} alt={t.name} className="w-10 h-10 rounded-full object-cover" />
                      : <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{background:theme}}>{t.name?.[0]}</div>
                    }
                    <div>
                      <div className="font-bold text-sm text-gray-900">{t.name}</div>
                      {t.date && <div className="text-xs text-gray-400">{t.date}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FAQs ── */}
      {faqs.length > 0 && (
        <section className="py-16 bg-gray-50">
          <div className="max-w-3xl mx-auto px-4">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-10">Preguntas frecuentes</h2>
            <div className="space-y-3">
              {faqs.map((faq: any, i: number) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <button onClick={() => setOpenFaq(openFaq===i ? null : i)}
                    className="w-full flex items-center justify-between p-5 text-left font-semibold text-gray-900 hover:bg-gray-50">
                    {faq.question}
                    {openFaq === i ? <ChevronUp size={18} className="shrink-0 text-gray-400"/> : <ChevronDown size={18} className="shrink-0 text-gray-400"/>}
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-5 text-gray-500 text-sm leading-relaxed">{faq.answer}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── HORARIOS + MAPA ── */}
      <section id="contacto" className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-10">Visítanos</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Info */}
            <div className="space-y-6">
              {clinic.address && (
                <div className="flex gap-3">
                  <MapPin className="shrink-0 mt-1" size={20} style={{color:theme}} />
                  <div>
                    <div className="font-bold text-gray-900">Dirección</div>
                    <div className="text-gray-500 text-sm">{clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</div>
                  </div>
                </div>
              )}
              {clinic.phone && (
                <div className="flex gap-3">
                  <Phone className="shrink-0 mt-1" size={20} style={{color:theme}} />
                  <div>
                    <div className="font-bold text-gray-900">Teléfono</div>
                    <a href={`tel:${clinic.phone}`} className="text-sm" style={{color:theme}}>{clinic.phone}</a>
                  </div>
                </div>
              )}
              {clinic.schedules.filter(s=>s.enabled).length > 0 && (
                <div className="flex gap-3">
                  <Clock className="shrink-0 mt-1" size={20} style={{color:theme}} />
                  <div>
                    <div className="font-bold text-gray-900 mb-2">Horarios</div>
                    <div className="space-y-1">
                      {clinic.schedules.filter(s=>s.enabled).map(s => (
                        <div key={s.dayOfWeek} className="flex justify-between text-sm text-gray-500 gap-8">
                          <span>{DAYS_ES[s.dayOfWeek]}</span>
                          <span>{s.openTime} – {s.closeTime}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {/* Social */}
              <div className="flex gap-3 pt-2">
                {clinic.landingInstagram && (
                  <a href={`https://instagram.com/${clinic.landingInstagram.replace("@","")}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50">
                    <Instagram size={16} /> Instagram
                  </a>
                )}
                {clinic.landingFacebook && (
                  <a href={clinic.landingFacebook} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50">
                    <Facebook size={16} /> Facebook
                  </a>
                )}
                {clinic.landingTiktok && (
                  <a href={`https://tiktok.com/@${clinic.landingTiktok.replace("@","")}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50">
                    🎵 TikTok
                  </a>
                )}
              </div>
            </div>
            {/* Map */}
            {clinic.landingMapEmbed ? (
              <div className="rounded-2xl overflow-hidden h-64 lg:h-auto border border-gray-100">
                <iframe src={clinic.landingMapEmbed} width="100%" height="100%" style={{border:0, minHeight:300}} allowFullScreen loading="lazy" />
              </div>
            ) : clinic.address ? (
              <div className="rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 flex items-center justify-center h-64 text-gray-400 text-sm">
                <div className="text-center">
                  <MapPin size={32} className="mx-auto mb-2 text-gray-300"/>
                  <p>{clinic.address}</p>
                  {clinic.city && <p>{clinic.city}</p>}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section className="py-16 text-white text-center" style={{background:`linear-gradient(135deg, ${theme}, ${theme}cc)`}}>
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-3xl font-extrabold mb-4">¿Listo para agendar tu cita?</h2>
          <p className="text-white/80 mb-8">Elige tu doctor, fecha y horario favorito en menos de 2 minutos.</p>
          <div className="flex flex-wrap justify-center gap-4">
            <button onClick={() => setShowBook(true)}
              className="bg-white font-bold px-8 py-4 rounded-2xl text-base shadow-xl hover:bg-gray-50 transition-colors"
              style={{color:theme}}>
              📅 Agendar cita ahora
            </button>
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer"
                className="bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-4 rounded-2xl text-base shadow-xl transition-colors">
                💬 Escribir por WhatsApp
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-gray-900 text-gray-400 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2">
            {clinic.logoUrl && <img src={clinic.logoUrl} alt={clinic.name} className="h-8 w-8 rounded-lg object-contain" />}
            <span className="font-semibold text-white">{clinic.name}</span>
          </div>
          <div>Powered by <a href="/" className="text-white font-semibold hover:underline">MediFlow</a></div>
        </div>
      </footer>

      {/* ── BOOKING MODAL ── */}
      {showBook && (
        <BookingModal clinic={clinic} onClose={() => setShowBook(false)} theme={theme} />
      )}
    </div>
  );
}

// ── Embedded Booking Modal ────────────────────────────────────────────────────
function BookingModal({ clinic, onClose, theme }: { clinic: Clinic; onClose: () => void; theme: string }) {
  const [step, setStep]         = useState(1); // 1=doctor, 2=date/time, 3=form, 4=success
  const [doctor, setDoctor]     = useState<Clinic["users"][0] | null>(null);
  const [calDate, setCalDate]   = useState(new Date());
  const [selDate, setSelDate]   = useState("");
  const [slots, setSlots]       = useState<string[]>([]);
  const [selSlot, setSelSlot]   = useState("");
  const [loadSlots, setLoadSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState("");
  const [form, setForm]         = useState({ firstName:"", lastName:"", phone:"", email:"", type:"Consulta general", notes:"" });

  const schedMap = Object.fromEntries(clinic.schedules.map(s => [s.dayOfWeek, s]));

  function isDayEnabled(date: Date) {
    const day = date.getDay();
    const schedDay = day === 0 ? 6 : day - 1;
    const sched = schedMap[schedDay];
    const today = new Date(); today.setHours(0,0,0,0);
    return !!sched?.enabled && date >= today;
  }

  function buildCalDays() {
    const year = calDate.getFullYear(), month = calDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const mondayPad = firstDay === 0 ? 6 : firstDay - 1;
    const last = new Date(year, month+1, 0).getDate();
    const cells: (Date|null)[] = [];
    for (let i=0; i<mondayPad; i++) cells.push(null);
    for (let d=1; d<=last; d++) cells.push(new Date(year, month, d));
    return cells;
  }

  useEffect(() => {
    if (!selDate || !doctor) return;
    setSlots([]); setSelSlot(""); setLoadSlots(true);
    fetch(`/api/public/availability?slug=${clinic.slug}&date=${selDate}&doctorId=${doctor.id}`)
      .then(r => r.json()).then(d => setSlots(d.slots ?? []))
      .catch(()=>{}).finally(() => setLoadSlots(false));
  }, [selDate, doctor, clinic.slug]);

  async function submit() {
    if (!form.firstName.trim() || !form.lastName.trim() || form.phone.trim().replace(/\D/g,"").length < 10) {
      setError("Completa nombre y teléfono (10 dígitos)"); return;
    }
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/public/book", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ slug:clinic.slug, doctorId:doctor!.id, date:selDate, startTime:selSlot,
          type:form.type, firstName:form.firstName.trim(), lastName:form.lastName.trim(),
          phone:form.phone.trim(), email:form.email.trim()||undefined, notes:form.notes.trim()||undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al agendar");
      setStep(4);
    } catch(e:any) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  const today = toYMD(new Date());
  const DAYS_SHORT = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <div className="font-extrabold text-gray-900">Agendar cita</div>
            <div className="text-xs text-gray-400">{clinic.name}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100"><X size={18}/></button>
        </div>

        <div className="p-5">
          {/* Progress */}
          {step < 4 && (
            <div className="flex gap-1 mb-5">
              {["Doctor","Fecha","Datos"].map((l,i) => (
                <div key={l} className="flex-1 text-center">
                  <div className={`h-1.5 rounded-full mb-1 ${step > i+1 ? "bg-emerald-500" : step === i+1 ? "" : "bg-gray-100"}`}
                    style={step === i+1 ? {background:theme} : {}} />
                  <div className={`text-xs font-semibold ${step===i+1?"":"text-gray-300"}`}
                    style={step===i+1?{color:theme}:{}}>{l}</div>
                </div>
              ))}
            </div>
          )}

          {/* Step 1: Doctor */}
          {step === 1 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-500 mb-3">Elige tu doctor</p>
              {clinic.users.map(doc => (
                <button key={doc.id} onClick={() => { setDoctor(doc); setStep(2); }}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-gray-100 hover:border-gray-200 text-left transition-colors">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-extrabold shrink-0"
                    style={{background:doc.color}}>
                    {doc.firstName[0]}{doc.lastName[0]}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900">Dr/a. {doc.firstName} {doc.lastName}</div>
                    {doc.specialty && <div className="text-xs text-gray-400">{doc.specialty}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Date + Time */}
          {step === 2 && doctor && (
            <div>
              <button onClick={() => setStep(1)} className="text-xs text-gray-400 mb-3 flex items-center gap-1 hover:text-gray-600">
                ← Cambiar doctor
              </button>
              {/* Calendar */}
              <div className="bg-gray-50 rounded-2xl p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}
                    className="p-1.5 rounded-lg hover:bg-gray-200">‹</button>
                  <span className="font-bold text-sm">{MONTHS_ES[calDate.getMonth()]} {calDate.getFullYear()}</span>
                  <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}
                    className="p-1.5 rounded-lg hover:bg-gray-200">›</button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {DAYS_SHORT.map(d => <div key={d} className="text-center text-xs text-gray-400 font-semibold">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {buildCalDays().map((day, i) => {
                    if (!day) return <div key={i}/>;
                    const ymd = toYMD(day);
                    const enabled = isDayEnabled(day);
                    const sel = ymd === selDate;
                    const isToday = ymd === today;
                    return (
                      <button key={i} disabled={!enabled} onClick={() => setSelDate(ymd)}
                        className="h-9 rounded-xl text-sm font-medium transition-all"
                        style={{
                          background: sel ? theme : "transparent",
                          color: sel ? "#fff" : enabled ? "#111" : "#d1d5db",
                          fontWeight: isToday ? 700 : 400,
                          border: isToday && !sel ? `2px solid ${theme}` : "none",
                          cursor: enabled ? "pointer" : "default",
                        }}>
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Slots */}
              {selDate && (
                <div className="mb-3">
                  {loadSlots ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-2"><Loader2 size={14} className="animate-spin"/>Buscando horarios…</div>
                  ) : slots.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2">Sin horarios disponibles — elige otra fecha</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {slots.map(slot => (
                        <button key={slot} onClick={() => setSelSlot(slot)}
                          className="py-2 rounded-xl text-sm font-semibold border-2 transition-all"
                          style={{
                            background: selSlot===slot ? theme : "transparent",
                            color: selSlot===slot ? "#fff" : "#374151",
                            borderColor: selSlot===slot ? theme : "#e5e7eb",
                          }}>
                          {slot}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button disabled={!selSlot} onClick={() => setStep(3)}
                className="w-full py-3 rounded-2xl font-bold text-white transition-opacity disabled:opacity-30"
                style={{background:theme}}>
                {selSlot ? `Continuar — ${selSlot}` : "Elige un horario"}
              </button>
            </div>
          )}

          {/* Step 3: Patient data */}
          {step === 3 && (
            <div className="space-y-3">
              <button onClick={() => setStep(2)} className="text-xs text-gray-400 mb-1 flex items-center gap-1 hover:text-gray-600">
                ← Cambiar horario
              </button>
              <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700 font-semibold mb-3">
                📅 {selDate ? new Date(selDate+"T00:00:00").toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"}) : ""} · {selSlot} · Dr/a. {doctor?.firstName} {doctor?.lastName}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Nombre *</label>
                  <input value={form.firstName} onChange={e=>setForm(f=>({...f,firstName:e.target.value}))}
                    placeholder="Nombre" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Apellido *</label>
                  <input value={form.lastName} onChange={e=>setForm(f=>({...f,lastName:e.target.value}))}
                    placeholder="Apellido" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">WhatsApp / Teléfono *</label>
                <input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))}
                  placeholder="+52 999 123 4567" type="tel"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Email (opcional)</label>
                <input value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}
                  placeholder="correo@ejemplo.com" type="email"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Motivo de consulta</label>
                <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white">
                  {(doctor?.services.length ? doctor.services : ["Consulta general","Primera vez","Revisión","Urgencia"]).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Notas (opcional)</label>
                <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
                  placeholder="Describe brevemente tu motivo…" rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400 resize-none" />
              </div>
              {error && <div className="text-red-600 text-sm bg-red-50 rounded-xl p-3">{error}</div>}
              <button onClick={submit} disabled={submitting}
                className="w-full py-3.5 rounded-2xl font-bold text-white text-base transition-opacity disabled:opacity-50"
                style={{background:theme}}>
                {submitting ? <span className="flex items-center justify-center gap-2"><Loader2 size={18} className="animate-spin"/>Confirmando…</span> : "✅ Confirmar cita"}
              </button>
              <p className="text-xs text-gray-400 text-center">Recibirás confirmación por WhatsApp</p>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 4 && (
            <div className="text-center py-6">
              <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
                <Check size={40} className="text-emerald-500"/>
              </div>
              <h3 className="text-2xl font-extrabold text-gray-900 mb-2">¡Cita confirmada! 🎉</h3>
              <p className="text-gray-500 mb-1">Dr/a. {doctor?.firstName} {doctor?.lastName}</p>
              <p className="font-bold mb-6" style={{color:theme}}>
                {selDate ? new Date(selDate+"T00:00:00").toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"}) : ""} · {selSlot}
              </p>
              <div className="bg-gray-50 rounded-2xl p-4 text-sm text-gray-500 mb-6 text-left space-y-1">
                <p>📱 Recibirás un WhatsApp con los detalles</p>
                <p>⏰ Recordatorio 24h antes de tu cita</p>
                {clinic.address && <p>📍 {clinic.address}</p>}
              </div>
              <button onClick={onClose}
                className="w-full py-3 rounded-2xl font-bold text-white" style={{background:theme}}>
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
