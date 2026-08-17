"use client";
import { useState, useEffect } from "react";
import { Phone, MapPin, Clock, Instagram, Facebook, Star, ChevronDown, ChevronUp, X, Check, ChevronLeft, ChevronRight, Calendar, ArrowRight, Menu } from "lucide-react";
import { useBookingReopen, type PendingBooking } from "./_shared/booking-session";
import { BookingModal } from "./_shared/booking-modal";
import type { LandingClinic } from "./_shared/types";
import { useLiveClinic } from "./_shared/live-preview";

const DAYS_SHORT = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

function hexAdjust(hex: string, amount: number) {
  const n = parseInt(hex.replace("#",""),16);
  const r = Math.min(255,Math.max(0,(n>>16)+amount));
  const g = Math.min(255,Math.max(0,((n>>8)&0xff)+amount));
  const b = Math.min(255,Math.max(0,(n&0xff)+amount));
  return `#${((r<<16)|(g<<8)|b).toString(16).padStart(6,"0")}`;
}

/* El contrato es el MISMO que el de las otras plantillas: una sola forma de
   clínica para las ocho mini-webs (antes classic tenía su copia local). */
type Clinic = LandingClinic;

export function ClinicLandingClient({ clinic: publicada, highlights }:{ clinic:Clinic; highlights?:string[] }) {
  // En /dashboard/landing esto trae lo que la clínica lleva escrito sin
  // guardar; en la página pública devuelve `publicada` tal cual.
  const clinic = useLiveClinic(publicada);
  const theme     = clinic.landingThemeColor ?? "#0f766e";
  const themeDark = hexAdjust(theme, -35);
  const [showBook, setShowBook] = useState(false);
  const [bookRestore, setBookRestore] = useState<PendingBooking|null>(null);
  const [lightbox, setLightbox] = useState<number|null>(null);
  const [openFaq, setOpenFaq]   = useState<number|null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [googleReviews, setGoogleReviews] = useState<{reviews:any[];rating:number|null;total:number}|null>(null);

  useEffect(() => {
    if (!clinic.googlePlaceId) return;
    fetch(`/api/google-reviews?slug=${clinic.slug}`)
      .then(r => r.json())
      .then(d => { if (d.reviews?.length > 0) setGoogleReviews(d); })
      .catch(() => {});
  }, [clinic.slug, clinic.googlePlaceId]);

  const testimonials:any[] = Array.isArray(clinic.landingTestimonials) ? clinic.landingTestimonials : [];
  const faqs:any[]         = Array.isArray(clinic.landingFaqs) ? clinic.landingFaqs : [];
  const services:any[]     = Array.isArray(clinic.landingServices) ? clinic.landingServices : [];
  const gallery:string[]   = clinic.landingGallery ?? [];
  const waLink = clinic.landingWhatsapp ? `https://wa.me/${clinic.landingWhatsapp.replace(/\D/g,"")}` : null;

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  // Reservar ya NO expulsa al visitante al registro: el modal resuelve la
  // sesión solo y, si no hay, ofrece los dos caminos sin perder el hueco.
  function openBooking() {
    setBookRestore(null);
    setShowBook(true);
  }

  // AUTO-REOPEN: de vuelta del login/registro, reabre el modal en el hueco
  // que ya había elegido (y limpia el ?reservar=1 del gate viejo).
  useBookingReopen(clinic.slug, (pending) => { setBookRestore(pending); setShowBook(true); });

  const navLinks = [
    ...(services.length > 0   ? [{href:"#servicios", label:"Servicios"}] : []),
    ...(clinic.users.length>0 ? [{href:"#doctores",  label:"Equipo"}]    : []),
    ...(gallery.length > 0    ? [{href:"#galeria",   label:"Galería"}]   : []),
    {href:"#contacto", label:"Contacto"},
  ];

  return (
    <>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,700;0,800;1,700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
      .l-root { font-family:'Plus Jakarta Sans',sans-serif; color:#1a1a2e; }
      .l-serif { font-family:'Fraunces',serif; }
      .l-btn { background:${theme}; color:#fff; box-shadow:0 4px 24px ${theme}44; transition:all .2s; }
      .l-btn:hover { background:${themeDark}; transform:translateY(-2px); box-shadow:0 8px 32px ${theme}55; }
      .l-btn-ghost { border:2px solid ${theme}; color:${theme}; background:transparent; transition:all .2s; }
      .l-btn-ghost:hover { background:${theme}12; transform:translateY(-2px); }
      .l-card { transition:all .25s cubic-bezier(.4,0,.2,1); }
      .l-card:hover { transform:translateY(-6px); box-shadow:0 24px 48px rgba(0,0,0,.10); }
      @keyframes fadeSlideUp { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
      .l-anim { animation:fadeSlideUp .65s ease both; }
      .l-delay1 { animation-delay:.12s; }
      .l-delay2 { animation-delay:.24s; }
      .l-delay3 { animation-delay:.36s; }
    `}</style>

    <div className="l-root min-h-screen bg-white">

      {/* NAVBAR */}
      <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/97 backdrop-blur-md shadow-sm" : "bg-transparent"}`}>
        <div className="max-w-6xl mx-auto px-5 flex items-center justify-between" style={{height:72}}>
          <div className="flex items-center gap-3">
            {clinic.logoUrl
              ? <img src={clinic.logoUrl} alt={clinic.name} className="h-11 w-11 rounded-2xl object-contain shadow-sm bg-white/10"/>
              : <div className="h-11 w-11 rounded-2xl flex items-center justify-center text-white font-bold text-xl l-serif" style={{background:theme}}>{clinic.name[0]}</div>
            }
            <span className={`font-bold text-base ${scrolled ? "text-gray-900" : "text-white"}`}>{clinic.name}</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map(l => (
              <a key={l.href} href={l.href} className={`text-sm font-medium transition-colors ${scrolled ? "text-gray-500 hover:text-gray-900" : "text-white/70 hover:text-white"}`}>{l.label}</a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer"
                className={`hidden sm:flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-all ${scrolled ? "text-green-600 bg-green-50 hover:bg-green-100" : "text-white bg-white/15 hover:bg-white/25"}`}>
                💬 WhatsApp
              </a>
            )}
            <button onClick={() => openBooking()} className="l-btn text-sm font-bold px-5 py-2.5 rounded-xl flex items-center gap-2">
              <Calendar size={14}/> Agendar
            </button>
            <button onClick={() => setMobileMenu(!mobileMenu)} className={`md:hidden p-2 rounded-lg ${scrolled ? "text-gray-600" : "text-white"}`}>
              <Menu size={22}/>
            </button>
          </div>
        </div>
        {mobileMenu && (
          <div className="md:hidden bg-white border-t border-gray-100 px-5 py-4 space-y-1 shadow-lg">
            {navLinks.map(l => (
              <a key={l.href} href={l.href} onClick={() => setMobileMenu(false)} className="block py-3 text-sm font-medium text-gray-600 border-b border-gray-50 last:border-0">{l.label}</a>
            ))}
          </div>
        )}
      </nav>

      {/* HERO */}
      <section className="relative flex items-center overflow-hidden" style={{minHeight:"100vh"}}>
        {clinic.landingCoverUrl
          ? <>
              <img src={clinic.landingCoverUrl} alt="" className="absolute inset-0 w-full h-full object-cover"/>
              <div className="absolute inset-0" style={{background:"linear-gradient(120deg,rgba(0,0,0,.75) 0%,rgba(0,0,0,.3) 100%)"}}/>
            </>
          : <div className="absolute inset-0" style={{background:`linear-gradient(135deg,${theme} 0%,${themeDark} 100%)`}}>
              <div className="absolute inset-0" style={{backgroundImage:"radial-gradient(circle at 70% 30%,rgba(255,255,255,.08) 0%,transparent 60%),radial-gradient(circle at 20% 80%,rgba(255,255,255,.05) 0%,transparent 50%)"}}/>
              {/* Geometric accent */}
              <div className="absolute right-0 top-0 w-1/2 h-full opacity-10" style={{background:"repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)",backgroundSize:"24px 24px"}}/>
            </div>
        }
        <div className="relative max-w-6xl mx-auto px-5 w-full py-36">
          <div className="max-w-2xl">
            {/* Pill badge */}
            <div className="l-anim inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm px-4 py-2 text-white/80 text-xs font-semibold mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"/>
              {clinic.specialty} · {clinic.city ?? "México"}
            </div>
            <h1 className="l-anim l-delay1 l-serif text-6xl sm:text-7xl font-bold text-white leading-[1.02] mb-5">
              {clinic.name}
            </h1>
            {clinic.landingTagline && (
              <p className="l-anim l-delay1 text-xl sm:text-2xl text-white/75 font-light mb-4">{clinic.landingTagline}</p>
            )}
            {clinic.description && (
              <p className="l-anim l-delay2 text-white/60 text-base leading-relaxed mb-6 max-w-lg">{clinic.description}</p>
            )}
            {highlights && highlights.length > 0 && (
              <div className="l-anim l-delay2 flex flex-wrap gap-2 mb-10">
                {highlights.map(h => (
                  <span key={h} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/15 px-3.5 py-1.5 text-white/85 text-xs font-semibold">
                    <Check size={12} className="text-emerald-400" /> {h}
                  </span>
                ))}
              </div>
            )}
            <div className="l-anim l-delay2 flex flex-wrap gap-3">
              <button onClick={() => openBooking()} className="l-btn px-8 py-4 rounded-2xl text-base font-bold flex items-center gap-2.5">
                Agendar cita <ArrowRight size={18}/>
              </button>
              {waLink && (
                <a href={waLink} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2.5 bg-white/12 hover:bg-white/22 backdrop-blur-sm border border-white/20 text-white px-8 py-4 rounded-2xl text-base font-semibold transition-all">
                  💬 WhatsApp
                </a>
              )}
            </div>
            {/* Stats */}
            {(clinic.users.length > 0 || testimonials.length > 0) && (
              <div className="l-anim l-delay3 flex flex-wrap gap-10 mt-16 pt-8 border-t border-white/10">
                {clinic.users.length > 0 && (
                  <div>
                    <div className="text-4xl font-bold text-white l-serif">{clinic.users.length}</div>
                    <div className="text-white/50 text-xs mt-1">Especialistas</div>
                  </div>
                )}
                {testimonials.length > 0 && (
                  <div>
                    <div className="text-4xl font-bold text-white l-serif flex items-end gap-1.5">
                      {(testimonials.reduce((s,t)=>s+(t.rating??5),0)/testimonials.length).toFixed(1)}
                      <Star size={22} className="fill-amber-400 text-amber-400 mb-1"/>
                    </div>
                    <div className="text-white/50 text-xs mt-1">Calificación</div>
                  </div>
                )}
                <div>
                  <div className="text-4xl font-bold text-white l-serif">✓</div>
                  <div className="text-white/50 text-xs mt-1">Cita en línea</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* SERVICIOS */}
      {services.length > 0 && (
        <section id="servicios" className="py-28 bg-white">
          <div className="max-w-6xl mx-auto px-5">
            <div className="max-w-xl mb-16">
              <div className="text-xs font-bold uppercase tracking-widest mb-5 px-4 py-2 rounded-full inline-block" style={{background:`${theme}12`,color:theme}}>Servicios</div>
              <h2 className="l-serif text-5xl font-bold text-gray-900 leading-tight mb-4">Lo que ofrecemos</h2>
              <p className="text-gray-400 text-lg">Tratamientos con tecnología de vanguardia para tu salud y bienestar</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {services.map((svc:any, i:number) => (
                <div key={i} className="l-card group border-2 border-gray-100 rounded-3xl p-8 hover:border-opacity-50 cursor-pointer" style={{"--tw-border-opacity":"1"} as any}
                  onMouseEnter={e=>(e.currentTarget.style.borderColor=`${theme}40`)}
                  onMouseLeave={e=>(e.currentTarget.style.borderColor="#f3f4f6")}>
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-6 transition-all group-hover:scale-110" style={{background:`${theme}10`}}>
                    {svc.icon || "🏥"}
                  </div>
                  <h3 className="font-bold text-gray-900 text-xl mb-3">{svc.name}</h3>
                  {svc.desc && <p className="text-gray-400 text-sm leading-relaxed">{svc.desc}</p>}
                  <div className="mt-6 flex items-center justify-between">
                    {svc.price ? <span className="font-bold text-lg" style={{color:theme}}>{svc.price}</span> : <span/>}
                    <button onClick={() => openBooking()} className="text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1" style={{background:`${theme}10`,color:theme}}>
                      Agendar <ArrowRight size={12}/>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* DOCTORES */}
      {clinic.users.length > 0 && (
        <section id="doctores" className="py-28" style={{background:`linear-gradient(180deg,#f8f9fa 0%,#fff 100%)`}}>
          <div className="max-w-6xl mx-auto px-5">
            <div className="text-center mb-16">
              <div className="text-xs font-bold uppercase tracking-widest mb-5 px-4 py-2 rounded-full inline-block" style={{background:`${theme}12`,color:theme}}>Equipo médico</div>
              <h2 className="l-serif text-5xl font-bold text-gray-900 mb-4">Nuestros especialistas</h2>
              <p className="text-gray-400 text-lg max-w-lg mx-auto">Profesionales certificados comprometidos con tu salud</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {clinic.users.map(doc => (
                <div key={doc.id} className="l-card bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100">
                  {/* Top color accent */}
                  <div className="h-1.5" style={{background:`linear-gradient(90deg,${doc.color},${hexAdjust(doc.color,40)})`}}/>
                  <div className="p-8 text-center">
                    {doc.avatarUrl
                      ? <img src={doc.avatarUrl} alt={doc.firstName} className="w-28 h-28 rounded-full mx-auto mb-6 object-cover ring-4 ring-white shadow-lg"/>
                      : <div className="w-28 h-28 rounded-full mx-auto mb-6 flex items-center justify-center text-white font-bold text-3xl l-serif ring-4 ring-white shadow-lg" style={{background:`linear-gradient(135deg,${doc.color},${hexAdjust(doc.color,-30)})`}}>
                          {doc.firstName[0]}{doc.lastName[0]}
                        </div>
                    }
                    <h3 className="font-bold text-gray-900 text-xl mb-1">Dr/a. {doc.firstName} {doc.lastName}</h3>
                    {doc.specialty && <p className="text-sm font-semibold mb-4" style={{color:theme}}>{doc.specialty}</p>}
                    {doc.services.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-1.5 mb-6">
                        {doc.services.slice(0,3).map(s => (
                          <span key={s} className="text-xs px-3 py-1 rounded-full bg-gray-50 text-gray-500 border border-gray-100">{s}</span>
                        ))}
                        {doc.services.length > 3 && <span className="text-xs px-3 py-1 rounded-full bg-gray-50 text-gray-400">+{doc.services.length-3}</span>}
                      </div>
                    )}
                    <button onClick={() => openBooking()} className="l-btn w-full py-3 rounded-2xl text-sm font-bold">
                      Agendar consulta
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* GALERÍA */}
      {gallery.length > 0 && (
        <section id="galeria" className="py-28 bg-white">
          <div className="max-w-6xl mx-auto px-5">
            <div className="flex items-end justify-between mb-14">
              <div>
                <div className="text-xs font-bold uppercase tracking-widest mb-4 px-4 py-2 rounded-full inline-block" style={{background:`${theme}12`,color:theme}}>Instalaciones</div>
                <h2 className="l-serif text-5xl font-bold text-gray-900">Nuestra clínica</h2>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 auto-rows-fr">
              {gallery.map((url, i) => (
                <button key={i} onClick={() => setLightbox(i)}
                  className={`relative overflow-hidden rounded-2xl group ${i===0 ? "col-span-2 row-span-2" : ""}`}
                  style={{aspectRatio:i===0?"1":"1"}}>
                  <img src={url} alt={`Foto ${i+1}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"/>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-all duration-300 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 bg-white/20 backdrop-blur-sm rounded-full p-3 transition-all">
                      <ChevronRight size={20} className="text-white"/>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          {lightbox !== null && (
            <div className="fixed inset-0 z-50 bg-black/96 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
              <button className="absolute top-5 right-5 text-white/50 hover:text-white p-2.5 rounded-2xl bg-white/8 hover:bg-white/15 transition-all" onClick={() => setLightbox(null)}><X size={20}/></button>
              <button className="absolute left-5 text-white/50 hover:text-white p-2.5 rounded-2xl bg-white/8 hover:bg-white/15 transition-all" onClick={e=>{e.stopPropagation();setLightbox(i=>Math.max(0,(i??0)-1))}}><ChevronLeft size={24}/></button>
              <img src={gallery[lightbox]} alt="" className="max-h-[88vh] max-w-[88vw] object-contain rounded-2xl" onClick={e=>e.stopPropagation()}/>
              <button className="absolute right-5 text-white/50 hover:text-white p-2.5 rounded-2xl bg-white/8 hover:bg-white/15 transition-all" onClick={e=>{e.stopPropagation();setLightbox(i=>Math.min(gallery.length-1,(i??0)+1))}}><ChevronRight size={24}/></button>
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-white/30 text-sm">{lightbox+1} / {gallery.length}</div>
            </div>
          )}
        </section>
      )}

      {/* TESTIMONIOS */}
      {testimonials.length > 0 && (
        <section className="py-28" style={{background:`linear-gradient(135deg,${theme}06 0%,${theme}03 100%)`}}>
          <div className="max-w-6xl mx-auto px-5">
            <div className="text-center mb-14">
              <div className="text-xs font-bold uppercase tracking-widest mb-5 px-4 py-2 rounded-full inline-block" style={{background:`${theme}12`,color:theme}}>Testimonios</div>
              <h2 className="l-serif text-5xl font-bold text-gray-900 mb-4">Lo que dicen nuestros pacientes</h2>
              <div className="flex items-center justify-center gap-1.5 mt-3">
                {Array.from({length:5}).map((_,i)=><Star key={i} size={18} className="fill-amber-400 text-amber-400"/>)}
                <span className="ml-2 font-bold text-gray-800">{(testimonials.reduce((s,t)=>s+(t.rating??5),0)/testimonials.length).toFixed(1)}</span>
                <span className="text-gray-400 text-sm">({testimonials.length})</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {testimonials.map((t:any, i:number) => (
                <div key={i} className="l-card bg-white rounded-3xl p-7 shadow-sm border border-gray-50 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 rounded-bl-full opacity-5" style={{background:theme}}/>
                  <div className="flex gap-0.5 mb-5">
                    {Array.from({length:5}).map((_,j)=>(
                      <Star key={j} size={15} className={j<(t.rating??5)?"fill-amber-400 text-amber-400":"text-gray-100 fill-gray-100"}/>
                    ))}
                  </div>
                  <p className="text-gray-600 text-sm leading-loose mb-6">"{t.text}"</p>
                  <div className="flex items-center gap-3 pt-5 border-t border-gray-50">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{background:theme}}>{t.name?.[0]??"P"}</div>
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

      {/* GOOGLE REVIEWS - shown when googlePlaceId configured and no manual testimonials */}
      {googleReviews && googleReviews.reviews.length > 0 && testimonials.length === 0 && (
        <section className="py-28" style={{background:`linear-gradient(135deg,${theme}06 0%,${theme}03 100%)`}}>
          <div className="max-w-6xl mx-auto px-5">
            <div className="text-center mb-14">
              <div className="text-xs font-bold uppercase tracking-widest mb-5 px-4 py-2 rounded-full inline-block" style={{background:`${theme}12`,color:theme}}>Reseñas de Google</div>
              <h2 className="l-serif text-5xl font-bold text-gray-900 mb-4">Lo que dicen nuestros pacientes</h2>
              {googleReviews.rating && (
                <div className="flex items-center justify-center gap-1.5 mt-3">
                  {Array.from({length:5}).map((_,i)=>(
                    <Star key={i} size={18} className={i<Math.round(googleReviews.rating!)?"fill-amber-400 text-amber-400":"text-gray-200 fill-gray-200"}/>
                  ))}
                  <span className="ml-2 font-bold text-gray-800">{googleReviews.rating.toFixed(1)}</span>
                  <span className="text-gray-400 text-sm">({googleReviews.total} reseñas en Google)</span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {googleReviews.reviews.slice(0,6).map((r:any, i:number) => (
                <div key={i} className="l-card bg-white rounded-3xl p-7 shadow-sm border border-gray-50 relative overflow-hidden">
                  <div className="flex gap-0.5 mb-5">
                    {Array.from({length:5}).map((_,j)=>(
                      <Star key={j} size={15} className={j<r.rating?"fill-amber-400 text-amber-400":"text-gray-100 fill-gray-100"}/>
                    ))}
                  </div>
                  {r.text && <p className="text-gray-600 text-sm leading-loose mb-6">"{r.text}"</p>}
                  <div className="flex items-center gap-3 pt-5 border-t border-gray-50">
                    {r.photoUrl
                      ? <img src={r.photoUrl} alt={r.name} className="w-10 h-10 rounded-full object-cover shrink-0"/>
                      : <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{background:theme}}>{r.name?.[0]??"G"}</div>
                    }
                    <div>
                      <div className="font-bold text-sm text-gray-900">{r.name}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1">{r.relativeTime} · <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/32px-Google_%22G%22_logo.svg.png" alt="Google" className="h-3 w-3 inline"/></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* GOOGLE REVIEWS - shown alongside manual testimonials */}
      {googleReviews && googleReviews.reviews.length > 0 && testimonials.length > 0 && (
        <div className="max-w-6xl mx-auto px-5 pb-4 text-center">
          <a href={`https://search.google.com/local/reviews?placeid=${clinic.googlePlaceId}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/32px-Google_%22G%22_logo.svg.png" alt="Google" className="h-4 w-4"/>
            Ver {googleReviews.total} reseñas en Google · {googleReviews.rating?.toFixed(1)} ⭐
          </a>
        </div>
      )}

      {/* FAQs */}
      {faqs.length > 0 && (
        <section className="py-28 bg-white">
          <div className="max-w-3xl mx-auto px-5">
            <div className="text-center mb-14">
              <div className="text-xs font-bold uppercase tracking-widest mb-5 px-4 py-2 rounded-full inline-block" style={{background:`${theme}12`,color:theme}}>FAQ</div>
              <h2 className="l-serif text-5xl font-bold text-gray-900">Preguntas frecuentes</h2>
            </div>
            <div className="space-y-3">
              {faqs.map((faq:any, i:number) => (
                <div key={i} className="border-2 border-gray-100 rounded-2xl overflow-hidden transition-all" style={openFaq===i?{borderColor:`${theme}30`}:{}}>
                  <button onClick={() => setOpenFaq(openFaq===i?null:i)}
                    className="w-full flex items-center justify-between p-6 text-left gap-4 hover:bg-gray-50/50 transition-colors">
                    <span className="font-semibold text-gray-900">{faq.question}</span>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all" style={{background:openFaq===i?theme:"#f3f4f6",color:openFaq===i?"#fff":"#9ca3af"}}>
                      {openFaq===i ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                    </div>
                  </button>
                  {openFaq===i && <div className="px-6 pb-6 text-gray-500 text-sm leading-relaxed">{faq.answer}</div>}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CONTACTO */}
      <section id="contacto" className="py-28 bg-gray-50">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-14">
            <div className="text-xs font-bold uppercase tracking-widest mb-5 px-4 py-2 rounded-full inline-block" style={{background:`${theme}12`,color:theme}}>Contacto</div>
            <h2 className="l-serif text-5xl font-bold text-gray-900 mb-3">Visítanos</h2>
            <p className="text-gray-400 text-lg">Estamos aquí para atenderte con gusto</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white rounded-3xl p-7 border border-gray-100 space-y-6">
                {clinic.address && (
                  <div className="flex gap-4 items-start">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{background:`${theme}12`}}>
                      <MapPin size={18} style={{color:theme}}/>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-sm mb-1">Dirección</div>
                      <div className="text-gray-500 text-sm leading-relaxed">{clinic.address}{clinic.city?`, ${clinic.city}`:""}</div>
                    </div>
                  </div>
                )}
                {clinic.phone && (
                  <div className="flex gap-4 items-start">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{background:`${theme}12`}}>
                      <Phone size={18} style={{color:theme}}/>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-sm mb-1">Teléfono</div>
                      <a href={`tel:${clinic.phone}`} className="text-sm font-semibold" style={{color:theme}}>{clinic.phone}</a>
                    </div>
                  </div>
                )}
                {clinic.schedules.filter(s=>s.enabled).length > 0 && (
                  <div className="flex gap-4 items-start">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{background:`${theme}12`}}>
                      <Clock size={18} style={{color:theme}}/>
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900 text-sm mb-3">Horarios</div>
                      <div className="space-y-1.5">
                        {clinic.schedules.filter(s=>s.enabled).map(s=>(
                          <div key={s.dayOfWeek} className="flex justify-between text-xs">
                            <span className="font-medium text-gray-600">{DAYS_SHORT[s.dayOfWeek]}</span>
                            <span className="text-gray-400">{s.openTime} – {s.closeTime}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {waLink && (
                  <a href={waLink} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2.5 bg-green-500 hover:bg-green-600 text-white font-bold py-3.5 rounded-2xl text-sm transition-colors">💬 Escribir por WhatsApp</a>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {clinic.landingInstagram && (
                    <a href={`https://instagram.com/${clinic.landingInstagram.replace("@","")}`} target="_blank" rel="noreferrer"
                      className="flex items-center justify-center gap-2 font-bold py-3 rounded-2xl text-sm text-white transition-opacity hover:opacity-90"
                      style={{background:"linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)"}}>
                      <Instagram size={15}/> Instagram
                    </a>
                  )}
                  {clinic.landingFacebook && (
                    <a href={clinic.landingFacebook} target="_blank" rel="noreferrer"
                      className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-2xl text-sm transition-colors">
                      <Facebook size={15}/> Facebook
                    </a>
                  )}
                </div>
              </div>
            </div>
            <div className="lg:col-span-3 rounded-3xl overflow-hidden shadow-sm border border-gray-100" style={{minHeight:400}}>
              {clinic.landingMapEmbed
                ? <iframe src={clinic.landingMapEmbed} width="100%" height="100%" style={{border:0,minHeight:400}} allowFullScreen loading="lazy"/>
                : <div className="w-full h-full min-h-[400px] flex flex-col items-center justify-center bg-white text-center p-10">
                    <MapPin size={48} className="text-gray-200 mb-4" strokeWidth={1}/>
                    <p className="text-gray-400 text-sm">{clinic.address ?? "Agrega tu mapa en el configurador"}</p>
                  </div>
              }
            </div>
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="py-28 relative overflow-hidden" style={{background:`linear-gradient(135deg,${theme} 0%,${themeDark} 100%)`}}>
        <div className="absolute inset-0" style={{backgroundImage:"radial-gradient(circle at 75% 25%,rgba(255,255,255,.08) 0%,transparent 55%)"}}/>
        <div className="absolute bottom-0 right-0 w-64 h-64 rounded-full bg-white/5" style={{filter:"blur(50px)"}}/>
        <div className="relative max-w-4xl mx-auto px-5 text-center">
          <h2 className="l-serif text-5xl sm:text-6xl font-bold text-white mb-5 leading-tight">
            Tu salud, nuestra<br/>prioridad
          </h2>
          <p className="text-white/65 text-xl mb-12 max-w-xl mx-auto">Agenda en menos de 2 minutos. Sin llamadas, sin esperas, sin complicaciones.</p>
          <div className="flex flex-wrap justify-center gap-4">
            <button onClick={() => openBooking()}
              className="bg-white font-bold px-10 py-4 rounded-2xl text-base shadow-2xl hover:bg-gray-50 transition-all flex items-center gap-2.5"
              style={{color:theme}}>
              <Calendar size={18}/> Agendar mi cita
            </button>
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer"
                className="bg-green-500 hover:bg-green-600 text-white font-bold px-10 py-4 rounded-2xl text-base shadow-xl transition-all flex items-center gap-2.5">
                💬 WhatsApp
              </a>
            )}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-gray-950 text-gray-500 py-10">
        <div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {clinic.logoUrl && <img src={clinic.logoUrl} alt="" className="h-9 w-9 rounded-xl object-contain opacity-60"/>}
            <div>
              <div className="text-gray-300 font-semibold text-sm">{clinic.name}</div>
              {clinic.city && <div className="text-xs text-gray-600">{clinic.city}</div>}
            </div>
          </div>
          <div className="text-xs">Powered by <a href="/" className="text-gray-400 hover:text-white font-bold transition-colors">DaleControl</a></div>
        </div>
      </footer>

      {/* BOOKING — el mismo flujo que las otras siete plantillas */}
      <BookingModal clinic={clinic} theme={theme} open={showBook} onClose={() => setShowBook(false)} restore={bookRestore}/>
    </div>
    </>
  );
}
