"use client";
/* ============================================================
   TEMPLATE "Cálido y cercano" — Fredoka + Nunito · blobs orgánicos
   bordes muy redondeados · pasteles del acento · emoji · familiar.
   Recreación de design/template3.jsx adaptada a los datos REALES
   (landing*) y a los helpers de _shared. Reserva por el modal real.
   ============================================================ */
import { useState, useEffect } from "react";
import { Menu, X, ArrowRight, Plus, Calendar, MapPin, Phone, MessageCircle, Clock, Instagram, Facebook } from "lucide-react";
import type { TemplateProps, LandingDoctor } from "../_shared/types";
import { useLiveClinic } from "../_shared/live-preview";
import { Foto, Txt, useEnEdicion } from "../_shared/edit-context";
// landing-address-parts y NO landing-address: este archivo viaja al navegador
// de los pacientes, y el módulo grande arrastra el manifiesto de las ocho
// plantillas (17 KB) sin que la página pública lo necesite para nada.
import { dirClinica, dirCopia, dirFaq, dirSeccion, dirServicio, dirTestimonio } from "@/lib/landing-address-parts";
import { copyMap, copyText, copyValue, photoOf, sectionMap, sectionTitle, showSection } from "../_shared/landing-data";
import {
  tint, shade, alpha,
  SmartImg, Stars, GoogleG, Reveal, Lightbox,
  useScrolled, useActiveSection, useLightbox, scrollToId,
} from "../_shared/landing-utils";
import { BookingModal } from "../_shared/booking-modal";
import { useBookingReopen, type PendingBooking } from "../_shared/booking-session";

const DAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function TemplateCalido({ clinic: publicada }: TemplateProps) {
  // En /dashboard/landing esto trae lo que la clínica lleva escrito sin
  // guardar; en la página pública devuelve `publicada` tal cual.
  const clinic = useLiveClinic(publicada);
  /* Solo dentro del lienzo del editor. En la página pública es SIEMPRE false,
     así que ninguna sección se pinta distinta para un paciente. */
  const editando = useEnEdicion();
  const accent = clinic.landingThemeColor ?? "#0f766e";

  // ---- datos reales (mismos campos que la landing classic) ----
  const services: any[] = Array.isArray(clinic.landingServices) ? clinic.landingServices : [];
  const testimonials: any[] = Array.isArray(clinic.landingTestimonials) ? clinic.landingTestimonials : [];
  const faqs: any[] = Array.isArray(clinic.landingFaqs) ? clinic.landingFaqs : [];
  const gallery: string[] = clinic.landingGallery ?? [];
  const doctors = clinic.users ?? [];
  const schedules = (clinic.schedules ?? []).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const waLink = clinic.landingWhatsapp ? `https://wa.me/${clinic.landingWhatsapp.replace(/\D/g, "")}` : null;

  // ---- estado ----
  const [booking, setBooking] = useState<{ open: boolean; service?: string; doctorId?: string; restore?: PendingBooking | null }>({ open: false });
  const openBooking = (opts?: { service?: string; doctorId?: string }) => setBooking({ open: true, ...opts });
  const closeBooking = () => setBooking((b) => ({ ...b, open: false }));
  // De vuelta del login/registro: reabre el modal en el hueco ya elegido.
  useBookingReopen(clinic.slug, (pending) =>
    setBooking({ open: true, doctorId: pending?.doctorId, service: pending?.service, restore: pending }));
  const scrolled = useScrolled(40);
  const [menu, setMenu] = useState(false);
  const active = useActiveSection(["inicio", "servicios", "equipo", "galeria", "contacto"]);
  const lb = useLightbox();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [floating, setFloating] = useState(false);
  const [googleReviews, setGoogleReviews] = useState<{ reviews: any[]; rating: number | null; total: number } | null>(null);

  useEffect(() => {
    if (!clinic.googlePlaceId) return;
    fetch(`/api/google-reviews?slug=${clinic.slug}`)
      .then((r) => r.json())
      .then((d) => { if (d.reviews?.length > 0) setGoogleReviews(d); })
      .catch(() => {});
  }, [clinic.slug, clinic.googlePlaceId]);

  useEffect(() => {
    const onScroll = () => setFloating(window.scrollY > 520);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ---- paleta cálida derivada del acento ----
  const ink = "#3a2e2a";
  const cream = "#fdf7f3";
  const p1 = tint(accent, 0.86);
  const p2 = tint(accent, 0.7);
  const peach = "#ffe9dd";
  const lilac = tint(accent, 0.8);
  const border = tint(accent, 0.78);
  const bubbleColors = [peach, p1, lilac, tint(accent, 0.82), "#fef3d6", p2];
  const head = { fontFamily: "'Fredoka', system-ui, sans-serif" } as const;
  const body = { fontFamily: "'Nunito', system-ui, sans-serif" } as const;
  const blob = "M44.8,-58.2C56.7,-49.3,64.2,-34.6,67.8,-19.2C71.4,-3.8,71.1,12.3,64.8,25.6C58.5,38.9,46.2,49.4,32.5,57.1C18.8,64.8,3.7,69.7,-12.4,69.3C-28.5,68.9,-45.6,63.2,-56.4,51.4C-67.2,39.6,-71.7,21.7,-72.2,3.9C-72.7,-13.9,-69.2,-31.6,-58.7,-43.3C-48.2,-55,-30.7,-60.7,-13.6,-62.8C3.5,-64.9,20.2,-63.4,44.8,-58.2Z";

  const brand = clinic.name;
  const tag = (clinic.landingTagline ?? "").trim();
  const tagComma = tag.indexOf(",");
  const tagA = tagComma > -1 ? tag.slice(0, tagComma) : tag || brand;
  const tagB = tagComma > -1 ? tag.slice(tagComma + 1).trim() : "";

  /* ---- lo que guardó el editor ----
     calido nació antes del manifiesto: su lista de bloques y sus títulos
     estaban escritos a mano y los interruptores de la pestaña Diseño se
     guardaban sin que pasara nada. Ahora se leen. Las listas siguen siendo
     las CRUDAS (sin serviceList ni faqList): esas normalizadoras tiran los
     elementos incompletos, y una tarjeta que hoy se pinta a medias
     desaparecería del sitio publicado de alguien sin que nadie lo pidiera. */
  const S = sectionMap(clinic);
  const copias = copyMap(clinic);
  const C = (clave: string) => copyValue(copias, clave);
  /* La portada, con la misma cadena de respaldo que las otras siete:
     ranura "portada" → landingCoverUrl (lo que calido leía hasta hoy). */
  const portada = photoOf(clinic, "portada", { cover: true });
  const verServicios = showSection(S, "servicios", services.length > 0);
  const verEquipo    = showSection(S, "equipo",    doctors.length > 0);
  const verGaleria   = showSection(S, "galeria",   gallery.length > 0);
  const verOpiniones = showSection(S, "opiniones", testimonials.length > 0 || !!(googleReviews && googleReviews.reviews.length > 0));
  const verFaq       = showSection(S, "faq",       faqs.length > 0);

  /* Los enlaces siguen a las secciones ENCENDIDAS: apagar una y dejar su
     ancla era mandar al paciente a un sitio que ya no existe. */
  const nav: Array<[string, string]> = [
    ...(verServicios ? [["Servicios", "servicios"] as [string, string]] : []),
    ...(verEquipo ? [["Equipo", "equipo"] as [string, string]] : []),
    ...(verGaleria ? [["Galería", "galeria"] as [string, string]] : []),
    ["Contacto", "contacto"],
  ];

  /* Con `campo`, el <button> ES el <Txt>: la etiqueta se edita haciendo clic
     y el icono o el emoji viajan pegados FUERA de lo editable, para que la
     clínica no los pierda al reescribir el texto. */
  const SolidBtn = ({ children, onClick, className = "", campo, valor, porDefecto, despues, sufijoFijo }: {
    children?: any; onClick?: () => void; className?: string;
    campo?: string; valor?: string | null; porDefecto?: string; despues?: any; sufijoFijo?: string;
  }) => {
    const clase = "inline-flex items-center justify-center gap-2 font-bold px-7 py-3.5 rounded-full transition-all duration-300 hover:-translate-y-0.5 " + className;
    const estilo = { background: accent, color: "#fff", boxShadow: `0 12px 26px -8px ${alpha(accent, 0.6)}`, ...head };
    if (campo) {
      return (
        <Txt as="button" onClick={onClick} className={clase} style={estilo}
          campo={campo} linea maxLen={80}
          valor={valor} porDefecto={porDefecto}
          sufijo={sufijoFijo ?? (despues !== undefined ? " " : undefined)}
          unido={sufijoFijo !== undefined || despues !== undefined}
          despues={despues} />
      );
    }
    return (
      <button onClick={onClick} className={clase} style={estilo}>
        {children}
      </button>
    );
  };

  return (
    <div style={{ background: cream, color: ink, ...body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;500;600;700;800&display=swap');
        @keyframes calFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
        .cal-blob { animation: calFloat 9s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce){ .cal-blob{ animation:none !important; } }
      `}</style>

      {/* ---------------- NAVBAR ---------------- */}
      <header className="fixed top-0 inset-x-0 z-50 transition-all duration-300 px-3 pt-3">
        <div
          className="max-w-6xl mx-auto px-3 sm:px-5 flex items-center justify-between rounded-full transition-all duration-300"
          style={scrolled
            ? { background: "rgba(255,255,255,.9)", backdropFilter: "blur(14px)", boxShadow: `0 10px 30px -12px ${alpha(accent, 0.3)}`, height: 64 }
            : { background: "transparent", height: 70 }}
        >
          <a href="#inicio" onClick={(e) => { e.preventDefault(); scrollToId("inicio"); }} className="flex items-center gap-2.5">
            {clinic.logoUrl
              ? <img src={clinic.logoUrl} alt={brand} className="w-11 h-11 rounded-full object-cover" />
              : <span className="grid place-items-center w-11 h-11 rounded-full font-bold text-white text-lg" style={{ background: accent, ...head }}>😁</span>}
            <span className="font-bold text-[18px]" style={head}>{brand}</span>
          </a>
          <nav className="hidden md:flex items-center gap-1">
            {nav.map(([label, id]) => (
              <a
                key={id}
                href={"#" + id}
                onClick={(e) => { e.preventDefault(); scrollToId(id); }}
                className="px-4 py-2 rounded-full text-[15px] font-bold transition-all"
                style={active === id ? { background: alpha(accent, 0.12), color: shade(accent, 0.1) } : { color: alpha(ink, 0.6) }}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <SolidBtn onClick={() => openBooking()} className="hidden sm:inline-flex !px-6 !py-2.5"
              campo={dirCopia("nav.cta")} valor={C("nav.cta")} porDefecto="Agendar Cita" sufijoFijo=" 🦷" />
            <button className="md:hidden w-11 h-11 grid place-items-center rounded-full" style={{ background: "#fff", color: accent }} aria-label="Abrir menú" onClick={() => setMenu(true)}>
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>

      {menu && (
        <div className="fixed inset-0 z-[60] md:hidden" style={{ background: cream }}>
          <div className="flex items-center justify-between px-6 h-[80px]">
            <span className="font-bold text-xl" style={head}>Menú</span>
            <button className="w-11 h-11 grid place-items-center rounded-full" style={{ background: "#fff", color: accent }} aria-label="Cerrar menú" onClick={() => setMenu(false)}>
              <X size={20} />
            </button>
          </div>
          <nav className="p-6 flex flex-col gap-3">
            {nav.map(([label, id], i) => (
              <a
                key={id}
                href={"#" + id}
                onClick={(e) => { e.preventDefault(); setMenu(false); scrollToId(id); }}
                className="px-6 py-5 rounded-3xl text-xl font-bold"
                style={{ background: bubbleColors[i % bubbleColors.length], color: ink, ...head }}
              >
                {label}
              </a>
            ))}
            <SolidBtn className="mt-3" onClick={() => { setMenu(false); openBooking(); }}
              campo={dirCopia("nav.cta")} valor={C("nav.cta")} porDefecto="Agendar Cita" sufijoFijo=" 🦷" />
          </nav>
        </div>
      )}

      {/* ---------------- HERO ---------------- */}
      <section id="inicio" className="relative overflow-hidden pt-28 sm:pt-36 pb-16">
        <svg className="cal-blob absolute -top-20 -right-32 w-[560px] h-[560px] opacity-60 pointer-events-none" viewBox="-100 -100 200 200" aria-hidden><path d={blob} fill={p1} /></svg>
        <svg className="cal-blob absolute top-40 -left-40 w-[420px] h-[420px] opacity-50 pointer-events-none" viewBox="-100 -100 200 200" aria-hidden><path d={blob} fill={peach} /></svg>
        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold mb-6" style={{ background: "#fff", color: shade(accent, 0.1), boxShadow: `0 8px 20px -10px ${alpha(accent, 0.4)}` }}>
              <span>👋</span> {clinic.specialty || "Clínica familiar"}
            </div>
            <h1 className="text-[42px] sm:text-6xl font-bold leading-[1.02]" style={{ ...head, color: ink }}>
              {tagA} {tagB && <span style={{ color: accent }}>{tagB}</span>} 🦷✨
            </h1>
            {(clinic.description || editando) && (
              <Txt as="p" className="mt-6 text-lg leading-relaxed font-medium" style={{ color: alpha(ink, 0.65) }}
                campo={dirClinica("description")} maxLen={5000} valor={clinic.description} />
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              <SolidBtn onClick={() => openBooking()}
                campo={dirCopia("hero.cta")} valor={C("hero.cta")} porDefecto="Agendar Cita"
                despues={<ArrowRight size={18} />} />
              {verServicios && (
                <Txt
                  as="button"
                  onClick={() => scrollToId("servicios")}
                  className="inline-flex items-center justify-center gap-2 font-bold px-7 py-3.5 rounded-full transition-all duration-300 hover:-translate-y-0.5"
                  style={{ background: "#fff", color: shade(accent, 0.1), border: `2px solid ${border}`, ...head }}
                  campo={dirCopia("hero.cta2")} linea maxLen={60}
                  valor={C("hero.cta2")} porDefecto="Ver servicios" sufijo=" 😊" unido
                />
              )}
            </div>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              {googleReviews?.rating && (
                <div className="flex items-center gap-2 bg-white rounded-full pl-2 pr-4 py-2" style={{ boxShadow: `0 8px 20px -12px ${alpha(accent, 0.4)}` }}>
                  <span className="grid place-items-center w-9 h-9 rounded-full text-white" style={{ background: accent }}>⭐</span>
                  <span className="font-bold text-sm">{googleReviews.rating.toFixed(1)} <span className="font-medium" style={{ color: alpha(ink, 0.5) }}>· {googleReviews.total} reseñas</span></span>
                </div>
              )}
              {clinic.landingPatients && (
                <div className="flex items-center gap-2 bg-white rounded-full pl-2 pr-4 py-2" style={{ boxShadow: `0 8px 20px -12px ${alpha(accent, 0.4)}` }}>
                  <span className="grid place-items-center w-9 h-9 rounded-full" style={{ background: peach }}>👨‍👩‍👧</span>
                  <span className="font-bold text-sm">{clinic.landingPatients} <Txt as="span" className="font-medium" style={{ color: alpha(ink, 0.5) }}
                    campo={dirCopia("chips.pacientes")} linea maxLen={60}
                    valor={C("chips.pacientes")} porDefecto="pacientes felices" /></span>
                </div>
              )}
              {clinic.landingYearsExperience != null && (
                <div className="flex items-center gap-2 bg-white rounded-full pl-2 pr-4 py-2" style={{ boxShadow: `0 8px 20px -12px ${alpha(accent, 0.4)}` }}>
                  <span className="grid place-items-center w-9 h-9 rounded-full" style={{ background: lilac }}>🎓</span>
                  <span className="font-bold text-sm">{clinic.landingYearsExperience} <Txt as="span" className="font-medium" style={{ color: alpha(ink, 0.5) }}
                    campo={dirCopia("chips.anios")} linea maxLen={60}
                    valor={C("chips.anios")} porDefecto="años de experiencia" /></span>
                </div>
              )}
            </div>
          </div>
          {/* foto con marco blob */}
          <div className="relative">
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="-100 -100 200 200" aria-hidden><path d={blob} fill={accent} /></svg>
            <div className="relative p-3">
              <div className="overflow-hidden" style={{ borderRadius: "44% 56% 54% 46% / 52% 44% 56% 48%" }}>
                {/* Sin `caja`: el div de arriba ya crea el contexto posicionado. */}
                <Foto slot="portada" url={portada} zona="derecha">
                  {(url) => <SmartImg src={url} alt={`Sonrisas en ${brand}`} accent={accent} className="w-full aspect-square object-cover" />}
                </Foto>
              </div>
            </div>
            <div className="absolute -bottom-2 -left-2 sm:left-4 bg-white rounded-3xl px-5 py-4 flex items-center gap-3" style={{ boxShadow: `0 20px 40px -16px ${alpha(accent, 0.5)}` }}>
              <span className="text-3xl">🎈</span>
              <div>
                <Txt as="p" className="font-bold text-sm" style={head}
                  campo={dirCopia("chips.tarjeta.titulo")} linea maxLen={60}
                  valor={C("chips.tarjeta.titulo")} porDefecto="Sin miedo al dentista" />
                <Txt as="p" className="text-xs font-medium" style={{ color: alpha(ink, 0.55) }}
                  campo={dirCopia("chips.tarjeta.texto")} linea maxLen={120}
                  valor={C("chips.tarjeta.texto")} porDefecto="Trato amable para toda la familia" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- SERVICIOS ---------------- */}
      {verServicios && (
        <section id="servicios" className="py-20 sm:py-28">
          <div className="max-w-6xl mx-auto px-5 sm:px-8">
            <WarmHead emoji="🦷" seccion="servicios" claveKicker="servicios.kicker"
              kicker="Nuestros servicios" kickerValor={C("servicios.kicker")}
              title="Cuidamos cada sonrisa con cariño" titleValor={S.servicios?.titulo}
              accent={accent} head={head} ink={ink} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-14">
              {services.map((s, i) => (
                <Reveal key={i} delay={i * 60}>
                  <div
                    className="group h-full rounded-[28px] p-7 bg-white transition-all duration-300"
                    style={{ border: `2px solid ${border}` }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-6px)"; e.currentTarget.style.boxShadow = `0 28px 50px -22px ${alpha(accent, 0.45)}`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
                  >
                    <span className="grid place-items-center w-16 h-16 rounded-3xl text-3xl transition-transform group-hover:rotate-6" style={{ background: bubbleColors[i % bubbleColors.length] }}>{s.icon || "🦷"}</span>
                    <Txt as="h3" className="mt-5 text-xl font-bold" style={head}
                      campo={dirServicio(i, "name")} linea requerido maxLen={120} valor={s.name} />
                    {(s.desc || editando) && (
                      <Txt as="p" className="mt-1.5 text-[15px] font-medium leading-relaxed" style={{ color: alpha(ink, 0.6) }}
                        campo={dirServicio(i, "desc")} maxLen={400} valor={s.desc} />
                    )}
                    <div className="mt-5 flex items-center justify-between">
                      {s.price || editando
                        ? <Txt as="span" className="text-lg font-bold" style={{ color: accent, ...head }}
                            campo={dirServicio(i, "price")} linea maxLen={40} valor={s.price} />
                        : <span />}
                      <Txt as="button" onClick={() => openBooking({ service: s.name })} className="px-4 py-2 rounded-full font-bold text-sm flex items-center gap-1.5 transition" style={{ background: alpha(accent, 0.12), color: shade(accent, 0.1) }}
                        campo={dirCopia("servicios.cta")} linea maxLen={40}
                        valor={C("servicios.cta")} porDefecto="Agendar" sufijo=" " unido
                        despues={<ArrowRight size={15} />} />
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- EQUIPO ---------------- */}
      {verEquipo && (
        <section id="equipo" className="py-20 sm:py-28 relative overflow-hidden" style={{ background: p1 }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 relative">
            <WarmHead emoji="👩‍⚕️" seccion="equipo" claveKicker="equipo.kicker"
              kicker="Nuestro equipo" kickerValor={C("equipo.kicker")}
              title="Doctores que te hacen sentir en casa" titleValor={S.equipo?.titulo}
              accent={accent} head={head} ink={ink} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-14">
              {doctors.map((u: LandingDoctor, i: number) => (
                <Reveal key={u.id} delay={i * 70}>
                  <div
                    className="bg-white rounded-[28px] p-5 text-center transition-all duration-300 hover:-translate-y-1.5"
                    style={{ boxShadow: `0 16px 36px -22px ${alpha(accent, 0.5)}` }}
                  >
                    <div className="mx-auto w-28 h-28 rounded-full overflow-hidden p-1" style={{ background: bubbleColors[i % bubbleColors.length] }}>
                      {u.avatarUrl
                        ? <img src={u.avatarUrl} alt={`${u.firstName} ${u.lastName}`} className="w-full h-full object-cover rounded-full" loading="lazy" />
                        : <div className="w-full h-full grid place-items-center rounded-full font-bold text-white text-2xl" style={{ background: accent, ...head }}>{(u.firstName?.[0] ?? "") + (u.lastName?.[0] ?? "")}</div>}
                    </div>
                    <h3 className="mt-4 font-bold text-lg" style={head}>Dr(a). {u.firstName} {u.lastName}</h3>
                    {u.specialty && <p className="text-sm font-semibold" style={{ color: accent }}>{u.specialty}</p>}
                    <Txt as="button" onClick={() => openBooking({ doctorId: u.id })} className="mt-4 w-full py-2.5 rounded-full font-bold text-sm transition hover:brightness-110" style={{ background: accent, color: "#fff" }}
                      campo={dirCopia("equipo.cta")} linea maxLen={60}
                      valor={C("equipo.cta")} porDefecto="Agendar consulta" />
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- GALERÍA ---------------- */}
      {verGaleria && (
        <section id="galeria" className="py-20 sm:py-28">
          <div className="max-w-6xl mx-auto px-5 sm:px-8">
            <WarmHead emoji="📸" seccion="galeria" claveKicker="galeria.kicker"
              kicker="Galería" kickerValor={C("galeria.kicker")}
              title="Un lugar pensado para tu sonrisa" titleValor={S.galeria?.titulo}
              accent={accent} head={head} ink={ink} />
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mt-14">
              {gallery.map((g, i) => (
                <Reveal key={i} delay={(i % 3) * 60}>
                  <button onClick={() => lb.open(i)} className="block w-full group overflow-hidden relative" style={{ borderRadius: 28 }} aria-label={`Ver foto ${i + 1}`}>
                    <SmartImg src={g} alt={`Instalación ${i + 1}`} accent={accent} className="w-full aspect-square object-cover transition-transform duration-700 group-hover:scale-110" />
                    <span className="absolute bottom-3 right-3 grid place-items-center w-10 h-10 rounded-full bg-white/90 transition-transform group-hover:scale-110" style={{ color: accent }}><Plus size={20} /></span>
                  </button>
                </Reveal>
              ))}
            </div>
            <Reveal className="mt-10 text-center">
              <Txt as="button" onClick={() => openBooking()} className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-bold text-white transition-all hover:-translate-y-1" style={{ background: accent, boxShadow: `0 14px 30px -10px ${alpha(accent, 0.6)}`, ...head }}
                campo={dirCopia("galeria.cta")} linea maxLen={80}
                valor={C("galeria.cta")} porDefecto="Ven a conocernos · Agendar Cita" sufijo=" 🦷" unido />
            </Reveal>
          </div>
        </section>
      )}

      {/* ---------------- TESTIMONIOS + GOOGLE ---------------- */}
      {verOpiniones && (
        <section className="py-20 sm:py-28 relative overflow-hidden" style={{ background: peach }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 relative">
            <WarmHead emoji="💬" seccion="opiniones" claveKicker="opiniones.kicker"
              kicker="Testimonios" kickerValor={C("opiniones.kicker")}
              title="Familias que ya confían en nosotros" titleValor={S.opiniones?.titulo}
              accent={accent} head={head} ink={ink} />
            {testimonials.length > 0 && (
              <div className="grid md:grid-cols-3 gap-6 mt-14">
                {testimonials.map((t2, i) => (
                  <Reveal key={i} delay={i * 70}>
                    <div className="bg-white rounded-[28px] p-7 h-full" style={{ boxShadow: `0 16px 36px -22px ${alpha(accent, 0.4)}` }}>
                      <div className="text-4xl">💛</div>
                      {/* Las comillas van como prefijo/sufijo y no dentro del
                          texto: si se guardaran, la siguiente edición las
                          duplicaría. */}
                      <Txt as="p" className="mt-3 text-[16px] font-medium leading-relaxed" style={{ color: alpha(ink, 0.75) }}
                        campo={dirTestimonio(i, "text")} requerido maxLen={800}
                        valor={t2.text} prefijo={"\""} sufijo={"\""} />
                      <div className="mt-5 flex items-center justify-between">
                        <div>
                          <Txt as="span" className="font-bold block" style={head}
                            campo={dirTestimonio(i, "name")} linea maxLen={80} valor={t2.name} />
                          {t2.date && <span className="text-xs font-medium" style={{ color: alpha(ink, 0.5) }}>{t2.date}</span>}
                        </div>
                        <Stars value={t2.rating ?? 5} size={15} />
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            )}
            {googleReviews && googleReviews.reviews.length > 0 && (
              <Reveal className="mt-10 bg-white rounded-[32px] p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6" style={{ boxShadow: `0 18px 44px -22px ${alpha(accent, 0.4)}` }}>
                <div className="flex items-center gap-4 sm:border-r sm:pr-8" style={{ borderColor: border }}>
                  <GoogleG size={36} />
                  <div>
                    <div className="text-5xl font-bold" style={{ ...head, color: ink }}>{(googleReviews.rating ?? 5).toFixed(1)}</div>
                    <Stars value={googleReviews.rating ?? 5} size={16} />
                  </div>
                </div>
                <div className="grow grid sm:grid-cols-2 gap-4">
                  {googleReviews.reviews.slice(0, 2).map((r, i) => (
                    <div key={i}>
                      {r.text && <p className="text-sm font-medium leading-relaxed" style={{ color: alpha(ink, 0.7) }}>&quot;{r.text}&quot;</p>}
                      <p className="mt-1.5 text-xs font-bold" style={{ color: accent }}>{r.name} · {r.relativeTime}</p>
                    </div>
                  ))}
                </div>
              </Reveal>
            )}
          </div>
        </section>
      )}

      {/* ---------------- FAQ ---------------- */}
      {verFaq && (
        <section className="py-20 sm:py-28">
          <div className="max-w-3xl mx-auto px-5 sm:px-8">
            <WarmHead emoji="❓" seccion="faq" claveKicker="faq.kicker"
              kicker="Preguntas frecuentes" kickerValor={C("faq.kicker")}
              title="Resolvemos tus dudas" titleValor={S.faq?.titulo}
              accent={accent} head={head} ink={ink} />
            <div className="space-y-3 mt-12">
              {faqs.map((f, i) => {
                const isOpen = openFaq === i;
                return (
                  <Reveal key={i} delay={i * 40}>
                    <div className="bg-white rounded-[24px] overflow-hidden transition-shadow" style={{ border: `2px solid ${border}`, boxShadow: isOpen ? `0 16px 36px -22px ${alpha(accent, 0.4)}` : "none" }}>
                      <button onClick={() => setOpenFaq(isOpen ? -1 : i)} aria-expanded={isOpen} className="w-full flex items-center justify-between gap-4 text-left px-6 py-5">
                        {/* Se leen las DOS formas: el formulario de siempre
                            guarda {question, answer} y el lienzo normaliza a
                            {q, a}. Antes solo se leía la vieja, así que la
                            primera pregunta que alguien editara desde el
                            lienzo habría desaparecido de la página. */}
                        <Txt as="span" className="font-bold text-[17px]" style={{ color: ink }}
                          campo={dirFaq(i, "q")} linea requerido maxLen={200}
                          valor={f.q ?? f.question} />
                        <span className="shrink-0 grid place-items-center w-8 h-8 rounded-full transition-transform duration-300" style={{ background: isOpen ? accent : p1, color: isOpen ? "#fff" : ink, transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
                      </button>
                      <div style={{ maxHeight: isOpen ? 280 : 0, overflow: "hidden", transition: "max-height .4s ease" }}>
                        <Txt as="p" className="px-6 pb-5 text-[15px] font-medium leading-relaxed" style={{ color: alpha(ink, 0.65) }}
                          campo={dirFaq(i, "a")} requerido maxLen={1200}
                          valor={f.a ?? f.answer} />
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
            <Reveal className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 text-center">
              <Txt as="span" className="text-[15px] font-medium" style={{ color: alpha(ink, 0.6) }}
                campo={dirCopia("faq.nota")} linea maxLen={160}
                valor={C("faq.nota")} porDefecto="¿Te quedó otra duda? Con gusto te ayudamos." />
              <SolidBtn onClick={() => openBooking()}
                campo={dirCopia("faq.cta")} valor={C("faq.cta")} porDefecto="Agendar Cita"
                despues={<ArrowRight size={17} />} />
            </Reveal>
          </div>
        </section>
      )}

      {/* ---------------- CTA FINAL ---------------- */}
      <section className="py-12">
        <div className="max-w-5xl mx-auto px-5 sm:px-8">
          <Reveal className="rounded-[40px] px-8 sm:px-16 py-16 text-center relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, 0.2)})` }}>
            <div className="absolute top-6 left-10 text-5xl opacity-30">🦷</div>
            <div className="absolute bottom-8 right-12 text-5xl opacity-30">✨</div>
            <div className="relative">
              {/* El emoji va pegado FUERA de lo editable: es decoración de la
                  plantilla y la clínica lo perdería al reescribir el titular. */}
              <Txt as="h2" className="text-4xl sm:text-5xl font-bold text-white leading-tight" style={head}
                campo={dirSeccion("reservar", "titulo")} linea maxLen={160}
                valor={S.reservar?.titulo} porDefecto="¿Listos para sonreír juntos?" sufijo=" 😄" unido />
              <Txt as="p" className="mt-4 text-lg text-white/90 max-w-xl mx-auto font-medium"
                campo={dirSeccion("reservar", "subtitulo")} maxLen={500}
                valor={S.reservar?.subtitulo} porDefecto="Agenda tu cita en línea. Te escribimos por WhatsApp para confirmar." />
              <Txt as="button" onClick={() => openBooking()} className="mt-8 inline-flex items-center gap-2 bg-white px-8 py-4 rounded-full font-bold transition hover:scale-105" style={{ color: shade(accent, 0.1), ...head }}
                campo={dirCopia("reservar.cta")} linea maxLen={60}
                valor={C("reservar.cta")} porDefecto="Agendar Cita" sufijo=" " unido
                despues={<ArrowRight size={18} />} />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- CONTACTO ---------------- */}
      <section id="contacto" className="py-20 sm:py-28" style={{ background: p1 }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <WarmHead emoji="📍" seccion="contacto" claveKicker="contacto.kicker"
            kicker="Visítanos" kickerValor={C("contacto.kicker")}
            title="Estamos cerca de ti" titleValor={S.contacto?.titulo}
            accent={accent} head={head} ink={ink} />
          <div className="grid lg:grid-cols-2 gap-8 items-stretch mt-12">
            <Reveal className="flex flex-col gap-4">
              {clinic.address && (
                <ContactRow accent={accent} border={border} ink={ink} icon={<MapPin size={22} />}
                  label="Dirección" labelClave="contacto.etiquetaDireccion" labelValor={C("contacto.etiquetaDireccion")}
                  value={`${clinic.address}${clinic.city ? `, ${clinic.city}` : ""}`} />
              )}
              {clinic.phone && (
                <ContactRow accent={accent} border={border} ink={ink} icon={<Phone size={22} />}
                  label="Teléfono" labelClave="contacto.etiquetaTelefono" labelValor={C("contacto.etiquetaTelefono")}
                  value={clinic.phone} href={`tel:${clinic.phone}`} />
              )}
              {clinic.landingWhatsapp && (
                <ContactRow accent={accent} border={border} ink={ink} icon={<MessageCircle size={22} />}
                  label="WhatsApp" labelClave="contacto.etiquetaWhatsapp" labelValor={C("contacto.etiquetaWhatsapp")}
                  value={clinic.landingWhatsapp} href={waLink ?? undefined} />
              )}
              {schedules.length > 0 && (
                <div className="p-5 rounded-[24px] bg-white" style={{ border: `2px solid ${border}` }}>
                  <div className="flex items-center gap-3 mb-3"><Clock size={20} style={{ color: accent }} /><Txt as="span" className="font-bold" style={{ color: ink, ...head }}
                    campo={dirCopia("contacto.etiquetaHorarios")} linea maxLen={60}
                    valor={C("contacto.etiquetaHorarios")} porDefecto="Horarios" /></div>
                  {schedules.map((s) => (
                    <div key={s.dayOfWeek} className="flex justify-between py-1.5 text-[15px]" style={{ color: alpha(ink, 0.65) }}>
                      <span className="font-medium">{DAYS_SHORT[s.dayOfWeek] ?? ""}</span>
                      {/* Solo el día CERRADO es texto editable: el horario
                          abierto es el dato de la agenda. */}
                      {s.enabled
                        ? <span className="font-bold" style={{ color: ink }}>{`${s.openTime} – ${s.closeTime}`}</span>
                        : <Txt as="span" className="font-bold" style={{ color: "#b91c1c" }}
                            campo={dirCopia("contacto.cerrado")} linea maxLen={40}
                            valor={C("contacto.cerrado")} porDefecto="Cerrado" />}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                {clinic.landingInstagram && (
                  <a href={`https://instagram.com/${clinic.landingInstagram.replace("@", "")}`} target="_blank" rel="noreferrer" aria-label="Instagram" className="grid place-items-center w-12 h-12 rounded-full transition hover:scale-105" style={{ background: "#fff", border: `2px solid ${border}`, color: accent }}>
                    <Instagram size={20} />
                  </a>
                )}
                {clinic.landingFacebook && (
                  <a href={clinic.landingFacebook} target="_blank" rel="noreferrer" aria-label="Facebook" className="grid place-items-center w-12 h-12 rounded-full transition hover:scale-105" style={{ background: "#fff", border: `2px solid ${border}`, color: accent }}>
                    <Facebook size={20} />
                  </a>
                )}
                <SolidBtn className="ml-auto" onClick={() => openBooking()}
                  campo={dirCopia("contacto.cta")} valor={C("contacto.cta")} porDefecto="Agendar Cita" />
              </div>
            </Reveal>
            <Reveal delay={100} className="overflow-hidden min-h-[360px] rounded-[28px]" style={{ border: `2px solid ${border}` }}>
              {clinic.landingMapEmbed
                ? <iframe title="Mapa de la clínica" src={clinic.landingMapEmbed} className="w-full h-full min-h-[360px]" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                : <div className="w-full h-full min-h-[360px] grid place-items-center bg-white text-center p-10"><div><MapPin size={44} style={{ color: border }} className="mx-auto mb-3" /><p className="text-sm font-medium" style={{ color: alpha(ink, 0.5) }}>{clinic.address ?? "Agrega tu mapa en el configurador"}</p></div></div>}
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- FOOTER ---------------- */}
      <footer style={{ background: shade(accent, 0.55), color: alpha("#ffffff", 0.75) }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              {clinic.logoUrl
                ? <img src={clinic.logoUrl} alt={brand} className="w-11 h-11 rounded-2xl object-cover" />
                : <span className="grid place-items-center w-11 h-11 rounded-2xl font-bold text-white" style={{ background: accent, ...head }}>{brand.slice(0, 2).toUpperCase()}</span>}
              <span className="text-white text-lg font-bold" style={head}>{brand}</span>
            </div>
            {clinic.description && <p className="max-w-sm text-[15px] leading-relaxed opacity-80">{clinic.description}</p>}
            <SolidBtn className="mt-6" onClick={() => openBooking()}>Agendar Cita</SolidBtn>
          </div>
          {nav.length > 0 && (
            <div>
              <p className="text-white font-bold mb-4" style={head}>Navegación</p>
              <ul className="space-y-2.5 text-[15px]">
                {nav.map(([l, id]) => (
                  <li key={id}><a href={"#" + id} onClick={(e) => { e.preventDefault(); scrollToId(id); }} className="opacity-75 hover:opacity-100 transition">{l}</a></li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-white font-bold mb-4" style={head}>Contacto</p>
            <ul className="space-y-2.5 text-[15px] opacity-80">
              {clinic.address && <li className="flex items-start gap-2"><MapPin size={17} className="mt-0.5 shrink-0" />{clinic.address}</li>}
              {clinic.phone && <li className="flex items-center gap-2"><Phone size={17} />{clinic.phone}</li>}
              {clinic.landingWhatsapp && <li className="flex items-center gap-2"><MessageCircle size={17} />{clinic.landingWhatsapp}</li>}
            </ul>
          </div>
        </div>
        <div className="border-t" style={{ borderColor: alpha("#ffffff", 0.12) }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] opacity-70">
            <span>© {new Date().getFullYear()} {brand}. Todos los derechos reservados.</span>
            <span className="flex items-center gap-1.5">Hecho con <a href="/" className="font-bold" style={{ color: tint(accent, 0.3) }}>DaleControl</a></span>
          </div>
        </div>
      </footer>

      {/* ---------------- LIGHTBOX + FLOTANTE + MODAL ---------------- */}
      <Lightbox images={gallery} lb={lb} />

      <button
        onClick={() => openBooking()}
        aria-label="Agendar Cita"
        className="fixed right-4 sm:right-6 z-[90] inline-flex items-center gap-2 font-bold text-white transition-all duration-500 hover:brightness-110 active:scale-95"
        style={{
          bottom: 24,
          padding: "13px 20px",
          borderRadius: 999,
          background: accent,
          boxShadow: `0 14px 30px -8px ${alpha(accent, 0.6)}`,
          opacity: floating ? 1 : 0,
          transform: floating ? "translateY(0) scale(1)" : "translateY(24px) scale(.9)",
          pointerEvents: floating ? "auto" : "none",
          ...head,
        }}
      >
        <Calendar size={18} />
        <Txt as="span" className="hidden sm:inline"
          campo={dirCopia("flotante.cta")} linea maxLen={40}
          valor={C("flotante.cta")} porDefecto="Agendar Cita" />
      </button>

      <BookingModal
        clinic={clinic}
        theme={accent}
        open={booking.open}
        onClose={closeBooking}
        preselectedDoctorId={booking.doctorId}
        preselectedService={booking.service}
        restore={booking.restore}
      />
    </div>
  );
}

/* El emoji NO es editable: es decoración de la plantilla y va en su propio
   <div>. El kicker y el título sí, y el <Txt> ES el <span>/<h2> de siempre. */
function WarmHead({ emoji, seccion, claveKicker, kicker, kickerValor, title, titleValor, accent, head, ink }: {
  emoji: string; seccion: string; claveKicker: string;
  kicker: string; kickerValor: string | null;
  title: string; titleValor?: string | null;
  accent: string; head: any; ink: string;
}) {
  return (
    <Reveal className="text-center max-w-2xl mx-auto">
      <div className="text-4xl mb-3">{emoji}</div>
      <Txt as="span" className="inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3" style={{ background: alpha(accent, 0.12), color: shade(accent, 0.1) }}
        campo={dirCopia(claveKicker)} linea maxLen={60}
        valor={kickerValor} porDefecto={kicker} />
      <Txt as="h2" className="text-4xl sm:text-5xl font-bold leading-[1.08]" style={{ ...head, color: ink }}
        campo={dirSeccion(seccion, "titulo")} linea maxLen={160}
        valor={titleValor} porDefecto={title} />
    </Reveal>
  );
}

function ContactRow({ icon, label, labelClave, labelValor, value, href, accent, border, ink }: {
  icon: any; label: string; labelClave: string; labelValor: string | null;
  value: string; href?: string; accent: string; border: string; ink: string;
}) {
  const inner = (
    <div className="flex items-center gap-4 p-5 rounded-[24px] bg-white transition hover:-translate-y-0.5" style={{ border: `2px solid ${border}` }}>
      <span className="shrink-0 grid place-items-center w-12 h-12 rounded-full" style={{ background: alpha(accent, 0.1), color: accent }}>{icon}</span>
      <div>
        <Txt as="p" className="text-xs uppercase tracking-wider font-bold" style={{ color: alpha(ink, 0.5) }}
          campo={dirCopia(labelClave)} linea maxLen={60}
          valor={labelValor} porDefecto={label} />
        <p className="font-bold text-[16px]" style={{ color: ink }}>{value}</p>
      </div>
    </div>
  );
  return href ? <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{inner}</a> : inner;
}
