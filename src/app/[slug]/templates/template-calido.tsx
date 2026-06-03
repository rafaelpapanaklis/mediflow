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
import {
  tint, shade, alpha,
  SmartImg, Stars, GoogleG, Reveal, Lightbox,
  useScrolled, useActiveSection, useLightbox, scrollToId,
} from "../_shared/landing-utils";
import { BookingModal } from "../_shared/booking-modal";

const DAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function TemplateCalido({ clinic }: TemplateProps) {
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
  const [booking, setBooking] = useState<{ open: boolean; service?: string; doctorId?: string }>({ open: false });
  const openBooking = (opts?: { service?: string; doctorId?: string }) => setBooking({ open: true, ...opts });
  const closeBooking = () => setBooking((b) => ({ ...b, open: false }));
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

  const nav: Array<[string, string]> = [
    ...(services.length ? [["Servicios", "servicios"] as [string, string]] : []),
    ...(doctors.length ? [["Equipo", "equipo"] as [string, string]] : []),
    ...(gallery.length ? [["Galería", "galeria"] as [string, string]] : []),
    ["Contacto", "contacto"],
  ];

  const SolidBtn = ({ children, onClick, className = "" }: { children: any; onClick?: () => void; className?: string }) => (
    <button
      onClick={onClick}
      className={"inline-flex items-center justify-center gap-2 font-bold px-7 py-3.5 rounded-full transition-all duration-300 hover:-translate-y-0.5 " + className}
      style={{ background: accent, color: "#fff", boxShadow: `0 12px 26px -8px ${alpha(accent, 0.6)}`, ...head }}
    >
      {children}
    </button>
  );

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
            <SolidBtn onClick={() => openBooking()} className="hidden sm:inline-flex !px-6 !py-2.5">Agendar Cita 🦷</SolidBtn>
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
            <SolidBtn className="mt-3" onClick={() => { setMenu(false); openBooking(); }}>Agendar Cita 🦷</SolidBtn>
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
            {clinic.description && (
              <p className="mt-6 text-lg leading-relaxed font-medium" style={{ color: alpha(ink, 0.65) }}>{clinic.description}</p>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              <SolidBtn onClick={() => openBooking()}>Agendar Cita <ArrowRight size={18} /></SolidBtn>
              {services.length > 0 && (
                <button
                  onClick={() => scrollToId("servicios")}
                  className="inline-flex items-center justify-center gap-2 font-bold px-7 py-3.5 rounded-full transition-all duration-300 hover:-translate-y-0.5"
                  style={{ background: "#fff", color: shade(accent, 0.1), border: `2px solid ${border}`, ...head }}
                >
                  Ver servicios 😊
                </button>
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
                  <span className="font-bold text-sm">{clinic.landingPatients} <span className="font-medium" style={{ color: alpha(ink, 0.5) }}>pacientes felices</span></span>
                </div>
              )}
              {clinic.landingYearsExperience != null && (
                <div className="flex items-center gap-2 bg-white rounded-full pl-2 pr-4 py-2" style={{ boxShadow: `0 8px 20px -12px ${alpha(accent, 0.4)}` }}>
                  <span className="grid place-items-center w-9 h-9 rounded-full" style={{ background: lilac }}>🎓</span>
                  <span className="font-bold text-sm">{clinic.landingYearsExperience} <span className="font-medium" style={{ color: alpha(ink, 0.5) }}>años de experiencia</span></span>
                </div>
              )}
            </div>
          </div>
          {/* foto con marco blob */}
          <div className="relative">
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="-100 -100 200 200" aria-hidden><path d={blob} fill={accent} /></svg>
            <div className="relative p-3">
              <div className="overflow-hidden" style={{ borderRadius: "44% 56% 54% 46% / 52% 44% 56% 48%" }}>
                <SmartImg src={clinic.landingCoverUrl} alt={`Sonrisas en ${brand}`} accent={accent} className="w-full aspect-square object-cover" />
              </div>
            </div>
            <div className="absolute -bottom-2 -left-2 sm:left-4 bg-white rounded-3xl px-5 py-4 flex items-center gap-3" style={{ boxShadow: `0 20px 40px -16px ${alpha(accent, 0.5)}` }}>
              <span className="text-3xl">🎈</span>
              <div>
                <p className="font-bold text-sm" style={head}>Sin miedo al dentista</p>
                <p className="text-xs font-medium" style={{ color: alpha(ink, 0.55) }}>Trato amable para toda la familia</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- SERVICIOS ---------------- */}
      {services.length > 0 && (
        <section id="servicios" className="py-20 sm:py-28">
          <div className="max-w-6xl mx-auto px-5 sm:px-8">
            <WarmHead emoji="🦷" kicker="Nuestros servicios" title="Cuidamos cada sonrisa con cariño" accent={accent} head={head} ink={ink} />
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
                    <h3 className="mt-5 text-xl font-bold" style={head}>{s.name}</h3>
                    {s.desc && <p className="mt-1.5 text-[15px] font-medium leading-relaxed" style={{ color: alpha(ink, 0.6) }}>{s.desc}</p>}
                    <div className="mt-5 flex items-center justify-between">
                      {s.price ? <span className="text-lg font-bold" style={{ color: accent, ...head }}>{s.price}</span> : <span />}
                      <button onClick={() => openBooking({ service: s.name })} className="px-4 py-2 rounded-full font-bold text-sm flex items-center gap-1.5 transition" style={{ background: alpha(accent, 0.12), color: shade(accent, 0.1) }}>
                        Agendar <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- EQUIPO ---------------- */}
      {doctors.length > 0 && (
        <section id="equipo" className="py-20 sm:py-28 relative overflow-hidden" style={{ background: p1 }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 relative">
            <WarmHead emoji="👩‍⚕️" kicker="Nuestro equipo" title="Doctores que te hacen sentir en casa" accent={accent} head={head} ink={ink} />
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
                    <button onClick={() => openBooking({ doctorId: u.id })} className="mt-4 w-full py-2.5 rounded-full font-bold text-sm transition hover:brightness-110" style={{ background: accent, color: "#fff" }}>
                      Agendar consulta
                    </button>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- GALERÍA ---------------- */}
      {gallery.length > 0 && (
        <section id="galeria" className="py-20 sm:py-28">
          <div className="max-w-6xl mx-auto px-5 sm:px-8">
            <WarmHead emoji="📸" kicker="Galería" title="Un lugar pensado para tu sonrisa" accent={accent} head={head} ink={ink} />
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
              <button onClick={() => openBooking()} className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-bold text-white transition-all hover:-translate-y-1" style={{ background: accent, boxShadow: `0 14px 30px -10px ${alpha(accent, 0.6)}`, ...head }}>
                Ven a conocernos · Agendar Cita 🦷
              </button>
            </Reveal>
          </div>
        </section>
      )}

      {/* ---------------- TESTIMONIOS + GOOGLE ---------------- */}
      {(testimonials.length > 0 || (googleReviews && googleReviews.reviews.length > 0)) && (
        <section className="py-20 sm:py-28 relative overflow-hidden" style={{ background: peach }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 relative">
            <WarmHead emoji="💬" kicker="Testimonios" title="Familias que ya confían en nosotros" accent={accent} head={head} ink={ink} />
            {testimonials.length > 0 && (
              <div className="grid md:grid-cols-3 gap-6 mt-14">
                {testimonials.map((t2, i) => (
                  <Reveal key={i} delay={i * 70}>
                    <div className="bg-white rounded-[28px] p-7 h-full" style={{ boxShadow: `0 16px 36px -22px ${alpha(accent, 0.4)}` }}>
                      <div className="text-4xl">💛</div>
                      <p className="mt-3 text-[16px] font-medium leading-relaxed" style={{ color: alpha(ink, 0.75) }}>&quot;{t2.text}&quot;</p>
                      <div className="mt-5 flex items-center justify-between">
                        <div>
                          <span className="font-bold block" style={head}>{t2.name}</span>
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
      {faqs.length > 0 && (
        <section className="py-20 sm:py-28">
          <div className="max-w-3xl mx-auto px-5 sm:px-8">
            <WarmHead emoji="❓" kicker="Preguntas frecuentes" title="Resolvemos tus dudas" accent={accent} head={head} ink={ink} />
            <div className="space-y-3 mt-12">
              {faqs.map((f, i) => {
                const isOpen = openFaq === i;
                return (
                  <Reveal key={i} delay={i * 40}>
                    <div className="bg-white rounded-[24px] overflow-hidden transition-shadow" style={{ border: `2px solid ${border}`, boxShadow: isOpen ? `0 16px 36px -22px ${alpha(accent, 0.4)}` : "none" }}>
                      <button onClick={() => setOpenFaq(isOpen ? -1 : i)} aria-expanded={isOpen} className="w-full flex items-center justify-between gap-4 text-left px-6 py-5">
                        <span className="font-bold text-[17px]" style={{ color: ink }}>{f.question}</span>
                        <span className="shrink-0 grid place-items-center w-8 h-8 rounded-full transition-transform duration-300" style={{ background: isOpen ? accent : p1, color: isOpen ? "#fff" : ink, transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
                      </button>
                      <div style={{ maxHeight: isOpen ? 280 : 0, overflow: "hidden", transition: "max-height .4s ease" }}>
                        <p className="px-6 pb-5 text-[15px] font-medium leading-relaxed" style={{ color: alpha(ink, 0.65) }}>{f.answer}</p>
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
            <Reveal className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 text-center">
              <span className="text-[15px] font-medium" style={{ color: alpha(ink, 0.6) }}>¿Te quedó otra duda? Con gusto te ayudamos.</span>
              <SolidBtn onClick={() => openBooking()}>Agendar Cita <ArrowRight size={17} /></SolidBtn>
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
              <h2 className="text-4xl sm:text-5xl font-bold text-white leading-tight" style={head}>¿Listos para sonreír juntos? 😄</h2>
              <p className="mt-4 text-lg text-white/90 max-w-xl mx-auto font-medium">Agenda tu cita en línea. Te escribimos por WhatsApp para confirmar.</p>
              <button onClick={() => openBooking()} className="mt-8 inline-flex items-center gap-2 bg-white px-8 py-4 rounded-full font-bold transition hover:scale-105" style={{ color: shade(accent, 0.1), ...head }}>
                Agendar Cita <ArrowRight size={18} />
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- CONTACTO ---------------- */}
      <section id="contacto" className="py-20 sm:py-28" style={{ background: p1 }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <WarmHead emoji="📍" kicker="Visítanos" title="Estamos cerca de ti" accent={accent} head={head} ink={ink} />
          <div className="grid lg:grid-cols-2 gap-8 items-stretch mt-12">
            <Reveal className="flex flex-col gap-4">
              {clinic.address && (
                <ContactRow accent={accent} border={border} ink={ink} icon={<MapPin size={22} />} label="Dirección" value={`${clinic.address}${clinic.city ? `, ${clinic.city}` : ""}`} />
              )}
              {clinic.phone && (
                <ContactRow accent={accent} border={border} ink={ink} icon={<Phone size={22} />} label="Teléfono" value={clinic.phone} href={`tel:${clinic.phone}`} />
              )}
              {clinic.landingWhatsapp && (
                <ContactRow accent={accent} border={border} ink={ink} icon={<MessageCircle size={22} />} label="WhatsApp" value={clinic.landingWhatsapp} href={waLink ?? undefined} />
              )}
              {schedules.length > 0 && (
                <div className="p-5 rounded-[24px] bg-white" style={{ border: `2px solid ${border}` }}>
                  <div className="flex items-center gap-3 mb-3"><Clock size={20} style={{ color: accent }} /><span className="font-bold" style={{ color: ink, ...head }}>Horarios</span></div>
                  {schedules.map((s) => (
                    <div key={s.dayOfWeek} className="flex justify-between py-1.5 text-[15px]" style={{ color: alpha(ink, 0.65) }}>
                      <span className="font-medium">{DAYS_SHORT[s.dayOfWeek] ?? ""}</span>
                      <span className="font-bold" style={{ color: s.enabled ? ink : "#b91c1c" }}>{s.enabled ? `${s.openTime} – ${s.closeTime}` : "Cerrado"}</span>
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
                <SolidBtn className="ml-auto" onClick={() => openBooking()}>Agendar Cita</SolidBtn>
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
            <span className="flex items-center gap-1.5">Hecho con <a href="/" className="font-bold" style={{ color: tint(accent, 0.3) }}>MediFlow</a></span>
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
        <span className="hidden sm:inline">Agendar Cita</span>
      </button>

      <BookingModal
        clinic={clinic}
        theme={accent}
        open={booking.open}
        onClose={closeBooking}
        preselectedDoctorId={booking.doctorId}
        preselectedService={booking.service}
      />
    </div>
  );
}

function WarmHead({ emoji, kicker, title, accent, head, ink }: { emoji: string; kicker: string; title: string; accent: string; head: any; ink: string }) {
  return (
    <Reveal className="text-center max-w-2xl mx-auto">
      <div className="text-4xl mb-3">{emoji}</div>
      <span className="inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3" style={{ background: alpha(accent, 0.12), color: shade(accent, 0.1) }}>{kicker}</span>
      <h2 className="text-4xl sm:text-5xl font-bold leading-[1.08]" style={{ ...head, color: ink }}>{title}</h2>
    </Reveal>
  );
}

function ContactRow({ icon, label, value, href, accent, border, ink }: { icon: any; label: string; value: string; href?: string; accent: string; border: string; ink: string }) {
  const inner = (
    <div className="flex items-center gap-4 p-5 rounded-[24px] bg-white transition hover:-translate-y-0.5" style={{ border: `2px solid ${border}` }}>
      <span className="shrink-0 grid place-items-center w-12 h-12 rounded-full" style={{ background: alpha(accent, 0.1), color: accent }}>{icon}</span>
      <div>
        <p className="text-xs uppercase tracking-wider font-bold" style={{ color: alpha(ink, 0.5) }}>{label}</p>
        <p className="font-bold text-[16px]" style={{ color: ink }}>{value}</p>
      </div>
    </div>
  );
  return href ? <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{inner}</a> : inner;
}
