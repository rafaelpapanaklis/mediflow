"use client";
/* ============================================================
   PLANTILLA "FUTURISTA" — dark · glassmorphism · glow de neón
   Recreación de producción de design/template1.jsx con el
   contrato real de T1 (_shared) y datos 100% desde `clinic`.
   Tipografías: Space Grotesk (títulos/cuerpo) + JetBrains Mono.
   ============================================================ */
import { useState, useEffect, type CSSProperties } from "react";
import {
  Calendar, ArrowRight, Menu, X, MapPin, Phone, Clock,
  MessageCircle, Instagram, Facebook, ShieldCheck, Quote, Plus, ChevronDown,
} from "lucide-react";
import type { TemplateProps } from "../_shared/types";
import {
  tint, shade, alpha,
  SmartImg, Stars, GoogleG,
  useScrolled, useActiveSection, Reveal, scrollToId, useLightbox, Lightbox,
} from "../_shared/landing-utils";
import { BookingModal } from "../_shared/booking-modal";

const DAYS_FULL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const CERRADO = "#b91c1c";

/* ---- ícono de marca TikTok (lucide no incluye logos de marca) ---- */
function TiktokIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

/* ---- encabezado de sección (kicker mono + título Grotesk) ---- */
function SectionHead({ kicker, title, sub, glow, muted }: { kicker: string; title: string; sub?: string; glow: string; muted: string }) {
  return (
    <Reveal className="max-w-2xl">
      <p className="tf-mono text-[12px] tracking-[0.22em] uppercase mb-4" style={{ color: glow }}>{kicker}</p>
      <h2 className="text-4xl sm:text-5xl font-bold leading-[1.05] tracking-tight">{title}</h2>
      {sub && <p className="mt-4 text-lg" style={{ color: muted }}>{sub}</p>}
    </Reveal>
  );
}

export function TemplateFuturista({ clinic, highlights }: TemplateProps) {
  /* ---------- color de marca (todo deriva de aquí) ---------- */
  const theme = clinic.landingThemeColor ?? "#0f766e";
  const glow = tint(theme, 0.42);

  /* ---------- paleta oscura (tokens de la plantilla) ---------- */
  const bg = "#070b11";
  const surface = "rgba(255,255,255,0.04)";
  const surfaceAlt = "#0a1019";
  const footerBg = "#05080d";
  const inkText = "#e7eef5";
  const muted = alpha("#e7eef5", 0.6);
  const borderC = "rgba(255,255,255,0.1)";

  /* ---------- estilos derivados ---------- */
  const glass: CSSProperties = { background: surface, border: `1px solid ${borderC}`, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" };
  const neonText: CSSProperties = { color: glow, textShadow: `0 0 18px ${alpha(glow, 0.55)}` };
  const ctaSolid: CSSProperties = { padding: "14px 26px", borderRadius: 12, background: theme, color: "#fff", border: `1px solid ${alpha(glow, 0.6)}`, boxShadow: `0 0 0 1px ${alpha(glow, 0.15)}, 0 0 28px ${alpha(theme, 0.55)}, 0 18px 40px -16px ${alpha(theme, 0.7)}`, fontWeight: 600 };
  const ctaGhost: CSSProperties = { ...glass, padding: "14px 26px", borderRadius: 12, color: inkText, fontWeight: 600 };

  /* ---------- datos (mismas convenciones que landing-client.tsx) ---------- */
  const services: any[] = Array.isArray(clinic.landingServices) ? clinic.landingServices : [];
  const testimonials: any[] = Array.isArray(clinic.landingTestimonials) ? clinic.landingTestimonials : [];
  const faqs: any[] = Array.isArray(clinic.landingFaqs) ? clinic.landingFaqs : [];
  const gallery: string[] = clinic.landingGallery ?? [];
  const waLink = clinic.landingWhatsapp ? `https://wa.me/${clinic.landingWhatsapp.replace(/\D/g, "")}` : null;
  const orderedSchedules = clinic.schedules.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  /* ---------- estado ---------- */
  const [booking, setBooking] = useState<{ open: boolean; service?: string; doctorId?: string }>({ open: false });
  const openBooking = (opts: { service?: string; doctorId?: string } = {}) => setBooking({ open: true, service: opts.service, doctorId: opts.doctorId });
  const closeBooking = () => setBooking((b) => ({ ...b, open: false }));
  const [menu, setMenu] = useState(false);
  const [showFab, setShowFab] = useState(false);
  const [openFaq, setOpenFaq] = useState<number>(0);
  const [googleReviews, setGoogleReviews] = useState<{ reviews: any[]; rating: number | null; total: number } | null>(null);
  const scrolled = useScrolled(70);
  const lb = useLightbox();

  /* ---------- reseñas de Google (idéntico a landing-client.tsx) ---------- */
  useEffect(() => {
    if (!clinic.googlePlaceId) return;
    fetch(`/api/google-reviews?slug=${clinic.slug}`)
      .then((r) => r.json())
      .then((d) => { if (d.reviews?.length > 0) setGoogleReviews(d); })
      .catch(() => {});
  }, [clinic.slug, clinic.googlePlaceId]);

  /* ---------- botón flotante tras ~520px ---------- */
  useEffect(() => {
    const onScroll = () => setShowFab(window.scrollY > 520);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------- navegación (solo secciones presentes) ---------- */
  const navLinks: [string, string][] = [
    ...(services.length ? [["Servicios", "servicios"] as [string, string]] : []),
    ...(clinic.users.length ? [["Equipo", "equipo"] as [string, string]] : []),
    ...(gallery.length ? [["Galería", "galeria"] as [string, string]] : []),
    ["Contacto", "contacto"],
  ];
  const active = useActiveSection(["inicio", ...navLinks.map((n) => n[1])]);

  /* ---------- señales de confianza del hero ---------- */
  const stats: { value: string; label: string }[] = [];
  if (googleReviews?.rating) stats.push({ value: googleReviews.rating.toFixed(1), label: "rating google" });
  if (clinic.landingYearsExperience != null) stats.push({ value: `${clinic.landingYearsExperience}+`, label: "años exp." });
  if (clinic.landingPatients) stats.push({ value: clinic.landingPatients, label: "pacientes" });

  /* ---------- redes ---------- */
  const socials = [
    clinic.landingInstagram && { node: <Instagram size={20} />, href: `https://instagram.com/${clinic.landingInstagram.replace("@", "")}`, label: "Instagram" },
    clinic.landingFacebook && { node: <Facebook size={20} />, href: clinic.landingFacebook, label: "Facebook" },
    clinic.landingTiktok && { node: <TiktokIcon size={20} />, href: `https://tiktok.com/@${clinic.landingTiktok.replace("@", "")}`, label: "TikTok" },
    waLink && { node: <MessageCircle size={20} />, href: waLink, label: "WhatsApp" },
  ].filter(Boolean) as { node: JSX.Element; href: string; label: string }[];

  const initials = (clinic.name || "C").trim().slice(0, 2).toUpperCase();

  return (
    <div className="tf-root relative overflow-x-hidden" style={{ background: bg, color: inkText, fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
      {/* ---------- fuentes + keyframes (estilo landing-client.tsx) ---------- */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        .tf-root { font-family:'Space Grotesk', system-ui, sans-serif; }
        .tf-mono { font-family:'JetBrains Mono', ui-monospace, monospace; }
        @keyframes mfReveal { from { transform: translateY(20px); } to { transform: none; } }
        @keyframes mfFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-22px); } }
        @keyframes mfGlowPulse { 0%,100% { opacity:.5; } 50% { opacity:.9; } }
        @keyframes mfScan { 0% { transform: translateY(-100%); } 100% { transform: translateY(2400%); } }
        @keyframes mfFade { from { opacity:0; } to { opacity:1; } }
        @keyframes mfPop { 0% { transform: scale(0); } 60% { transform: scale(1.12); } 100% { transform: scale(1); } }
        .tf-cta { transition: filter .3s, transform .3s; }
        .tf-cta:hover { filter: brightness(1.12); transform: translateY(-2px); }
        .tf-cta:active { transform: scale(.97); }
        .tf-fade { animation: mfFade .25s ease both; }
        @media (prefers-reduced-motion: no-preference) {
          .tf-reveal { animation: mfReveal .6s cubic-bezier(.2,.8,.2,1) both; }
          .tf-float { animation: mfFloat 7s ease-in-out infinite; }
          .tf-orb-a { animation: mfGlowPulse 9s ease-in-out infinite; }
          .tf-orb-b { animation: mfGlowPulse 11s ease-in-out infinite; }
          .tf-scan { animation: mfScan 5s linear infinite; }
          .tf-pop { animation: mfPop .4s cubic-bezier(.2,1.4,.4,1) both; }
        }
      `}</style>

      {/* ---------- CAPA DE FONDO (grid técnico + orbes) ---------- */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(${alpha(glow, 0.06)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(glow, 0.06)} 1px, transparent 1px)`,
          backgroundSize: "62px 62px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%)",
        }} />
        <div className="tf-orb-a absolute -top-40 -left-32 w-[620px] h-[620px] rounded-full" style={{ background: alpha(theme, 0.22), filter: "blur(120px)" }} />
        <div className="tf-orb-b absolute top-1/3 -right-40 w-[560px] h-[560px] rounded-full" style={{ background: alpha(shade(theme, 0.1), 0.18), filter: "blur(130px)" }} />
      </div>

      <div className="relative z-10">
        {/* ============================================================
            1 · NAVBAR
           ============================================================ */}
        <header className="fixed top-0 inset-x-0 z-50 transition-all duration-500"
          style={scrolled
            ? { background: alpha(bg, 0.72), backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: `1px solid ${borderC}`, boxShadow: `0 10px 40px -20px ${alpha(theme, 0.6)}` }
            : { background: "transparent" }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between" style={{ height: scrolled ? 66 : 84, transition: "height .4s" }}>
            <a href="#inicio" onClick={(e) => { e.preventDefault(); scrollToId("inicio"); }} className="flex items-center gap-3">
              {clinic.logoUrl
                ? <img src={clinic.logoUrl} alt={clinic.name} className="w-11 h-11 rounded-xl object-contain" style={{ border: `1px solid ${borderC}` }} />
                : <span className="grid place-items-center w-11 h-11 rounded-xl font-bold text-white text-sm" style={{ background: theme, border: `1px solid ${alpha(glow, 0.6)}`, boxShadow: `0 0 20px ${alpha(theme, 0.6)}` }}>{initials}</span>}
              <span className="leading-none">
                <span className="block text-[16px] font-bold tracking-tight">{clinic.name}</span>
                <span className="tf-mono block text-[10px] tracking-[0.3em] uppercase mt-0.5" style={{ color: muted }}>{clinic.specialty}</span>
              </span>
            </a>
            <nav className="hidden md:flex items-center gap-8">
              {navLinks.map(([label, id]) => (
                <a key={id} href={"#" + id} onClick={(e) => { e.preventDefault(); scrollToId(id); }}
                  className="tf-mono text-[12px] tracking-[0.15em] uppercase relative py-1 transition-colors"
                  style={{ color: active === id ? glow : muted, textShadow: active === id ? `0 0 12px ${alpha(glow, 0.6)}` : "none" }}>
                  {label}
                  <span className="absolute -bottom-1 left-0 h-px transition-all duration-300" style={{ width: active === id ? "100%" : 0, background: glow, boxShadow: `0 0 8px ${glow}` }} />
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-3">
              <button onClick={() => openBooking()} className="tf-cta hidden sm:inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold"
                style={{ background: theme, color: "#fff", border: `1px solid ${alpha(glow, 0.6)}`, boxShadow: `0 0 22px ${alpha(theme, 0.55)}` }}>
                <Calendar size={16} /> Agendar Cita
              </button>
              <button className="md:hidden w-10 h-10 grid place-items-center rounded-lg" style={glass} aria-label="Abrir menú" onClick={() => setMenu(true)}><Menu size={20} /></button>
            </div>
          </div>
        </header>

        {/* menú móvil */}
        {menu && (
          <div className="tf-fade fixed inset-0 z-[60] md:hidden" style={{ background: alpha(bg, 0.96), backdropFilter: "blur(10px)" }}>
            <div className="flex items-center justify-between px-5 h-[84px]">
              <span className="text-lg font-bold tracking-tight">Menú</span>
              <button className="w-10 h-10 grid place-items-center rounded-lg" style={glass} aria-label="Cerrar menú" onClick={() => setMenu(false)}><X size={20} /></button>
            </div>
            <nav className="px-6 flex flex-col gap-2 mt-4">
              {navLinks.map(([label, id], i) => (
                <a key={id} href={"#" + id} onClick={(e) => { e.preventDefault(); setMenu(false); scrollToId(id); }}
                  className="py-4 px-4 rounded-xl text-2xl font-bold flex items-center" style={glass}>
                  <span className="tf-mono text-xs mr-3" style={{ color: glow }}>{String(i + 1).padStart(2, "0")}</span>{label}
                </a>
              ))}
              <button onClick={() => { setMenu(false); openBooking(); }} className="tf-cta mt-4 inline-flex items-center justify-center gap-2" style={ctaSolid}>
                <Calendar size={18} /> Agendar Cita
              </button>
            </nav>
          </div>
        )}

        {/* ============================================================
            2 · HERO
           ============================================================ */}
        <section id="inicio" className="relative pt-32 sm:pt-40 pb-20">
          <div className="max-w-6xl mx-auto px-5 sm:px-8 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-16 items-center">
            <div className="tf-reveal">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-7" style={glass}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: glow, boxShadow: `0 0 8px ${glow}` }} />
                <span className="tf-mono text-[11px] tracking-[0.2em] uppercase" style={{ color: muted }}>// {clinic.specialty}{clinic.city ? ` · ${clinic.city}` : ""}</span>
              </div>
              <h1 className="text-[40px] sm:text-6xl lg:text-7xl font-bold leading-[0.98] tracking-tight">{clinic.name}</h1>
              {clinic.landingTagline && (
                <p className="mt-5 text-2xl sm:text-3xl font-semibold leading-tight" style={neonText}>{clinic.landingTagline}</p>
              )}
              {clinic.description && (
                <p className="mt-6 text-[17px] leading-relaxed max-w-md" style={{ color: muted }}>{clinic.description}</p>
              )}
              {highlights && highlights.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-2">
                  {highlights.map((h) => (
                    <span key={h} className="tf-mono inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] tracking-wide uppercase" style={{ ...glass, color: glow }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: glow }} /> {h}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <button onClick={() => openBooking()} className="tf-cta inline-flex items-center justify-center gap-2" style={ctaSolid}>
                  <Calendar size={18} /> Agendar Cita
                </button>
                {waLink ? (
                  <a href={waLink} target="_blank" rel="noreferrer" className="tf-cta inline-flex items-center justify-center gap-2" style={ctaGhost}>
                    <MessageCircle size={18} /> WhatsApp
                  </a>
                ) : (
                  <button onClick={() => scrollToId(services.length ? "servicios" : "contacto")} className="tf-cta inline-flex items-center justify-center gap-2" style={ctaGhost}>
                    Conoce más <ArrowRight size={18} />
                  </button>
                )}
              </div>
              {/* señales de confianza */}
              {stats.length > 0 && (
                <div className="mt-12 flex flex-wrap items-stretch gap-x-8 gap-y-4">
                  {stats.map((s, i) => (
                    <div key={s.label} className="flex items-stretch gap-x-8">
                      {i > 0 && <span className="w-px self-stretch" style={{ background: borderC }} />}
                      <div>
                        <span className="text-3xl font-bold" style={{ color: glow, textShadow: `0 0 14px ${alpha(glow, 0.27)}` }}>{s.value}</span>
                        <p className="tf-mono text-[11px] tracking-[0.12em] uppercase mt-0.5" style={{ color: muted }}>{s.label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* visual: foto en marco HUD */}
            <div className="tf-float relative">
              <div className="relative rounded-2xl p-2.5" style={{ ...glass, boxShadow: `0 0 40px ${alpha(theme, 0.25)}` }}>
                <div className="relative overflow-hidden rounded-xl">
                  <SmartImg src={clinic.landingCoverUrl} alt={`Instalaciones de ${clinic.name}`} accent={theme} className="w-full aspect-[4/5] object-cover" />
                  <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 40%, ${alpha(theme, 0.35)})`, mixBlendMode: "multiply" }} />
                  <div className="tf-scan absolute inset-x-0 h-16 pointer-events-none" style={{ background: `linear-gradient(${alpha(glow, 0.25)}, transparent)` }} />
                </div>
                {/* brackets HUD */}
                {(["tl", "tr", "bl", "br"] as const).map((pos) => {
                  const base: CSSProperties = { position: "absolute", width: 22, height: 22, borderColor: glow, boxShadow: `0 0 12px ${alpha(glow, 0.5)}` };
                  const m: Record<string, CSSProperties> = {
                    tl: { top: -1, left: -1, borderTop: "2px solid", borderLeft: "2px solid", borderTopLeftRadius: 8 },
                    tr: { top: -1, right: -1, borderTop: "2px solid", borderRight: "2px solid", borderTopRightRadius: 8 },
                    bl: { bottom: -1, left: -1, borderBottom: "2px solid", borderLeft: "2px solid", borderBottomLeftRadius: 8 },
                    br: { bottom: -1, right: -1, borderBottom: "2px solid", borderRight: "2px solid", borderBottomRightRadius: 8 },
                  };
                  return <span key={pos} aria-hidden style={{ ...base, ...m[pos] }} />;
                })}
              </div>
              {/* tarjeta flotante de reseñas (solo si hay Google reviews) */}
              {googleReviews && (
                <div className="absolute -bottom-5 -left-5 sm:-left-8 px-5 py-4 rounded-xl" style={{ ...glass, boxShadow: "0 20px 40px -16px rgba(0,0,0,.6)" }}>
                  <div className="flex items-center gap-1.5 mb-1"><Stars value={googleReviews.rating ?? 5} size={13} color={glow} /></div>
                  <p className="text-[13px]" style={{ color: muted }}><span className="font-bold" style={{ color: inkText }}>{googleReviews.total}</span> reseñas verificadas</p>
                </div>
              )}
              {/* chip flotante con la especialidad */}
              <div className="absolute -top-4 -right-3 px-4 py-2.5 rounded-xl flex items-center gap-2" style={glass}>
                <ShieldCheck size={18} style={{ color: glow }} />
                <span className="text-xs font-semibold">{clinic.specialty}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            3 · SERVICIOS
           ============================================================ */}
        {services.length > 0 && (
          <section id="servicios" className="py-20 sm:py-28">
            <div className="max-w-6xl mx-auto px-5 sm:px-8">
              <SectionHead kicker="// Servicios" title="Tratamientos de nueva generación" sub="Precios transparentes y resultados predecibles." glow={glow} muted={muted} />
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-14">
                {services.map((s, i) => (
                  <Reveal key={i} delay={(i % 3) * 55}>
                    <div className="group h-full rounded-2xl p-6 transition-all duration-300" style={glass}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = alpha(glow, 0.55); e.currentTarget.style.boxShadow = `0 0 0 1px ${alpha(glow, 0.2)}, 0 24px 50px -24px ${alpha(theme, 0.7)}`; e.currentTarget.style.transform = "translateY(-4px)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = borderC; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}>
                      <div className="flex items-start justify-between">
                        <span className="grid place-items-center w-14 h-14 rounded-xl text-2xl" style={{ background: alpha(theme, 0.14), border: `1px solid ${alpha(glow, 0.3)}` }}>{s.icon || "🏥"}</span>
                        <span className="tf-mono text-[12px]" style={{ color: alpha(glow, 0.7) }}>{String(i + 1).padStart(2, "0")}/{String(services.length).padStart(2, "0")}</span>
                      </div>
                      <h3 className="mt-5 text-xl font-bold tracking-tight">{s.name}</h3>
                      {(s.description || s.desc) && <p className="mt-1.5 text-[14px] leading-relaxed min-h-[40px]" style={{ color: muted }}>{s.description || s.desc}</p>}
                      <div className="mt-5 pt-4 flex items-center justify-between" style={{ borderTop: `1px solid ${borderC}` }}>
                        {s.price ? <span className="text-lg font-bold">{s.price}</span> : <span />}
                        <button onClick={() => openBooking({ service: s.name })} className="tf-mono text-[12px] tracking-wider uppercase inline-flex items-center gap-1.5 transition" style={{ color: glow }}>
                          Agendar <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
                        </button>
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ============================================================
            4 · EQUIPO
           ============================================================ */}
        {clinic.users.length > 0 && (
          <section id="equipo" className="py-20 sm:py-28">
            <div className="max-w-6xl mx-auto px-5 sm:px-8">
              <SectionHead kicker="// Equipo" title="Especialistas detrás de la pantalla" sub="Ciencia, tecnología y calidez en un mismo lugar." glow={glow} muted={muted} />
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-14">
                {clinic.users.map((u, i) => (
                  <Reveal key={u.id} delay={(i % 4) * 60}>
                    <div className="group rounded-2xl overflow-hidden transition-all duration-300 h-full" style={glass}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = alpha(glow, 0.5); e.currentTarget.style.boxShadow = `0 24px 50px -24px ${alpha(theme, 0.7)}`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = borderC; e.currentTarget.style.boxShadow = "none"; }}>
                      <div className="relative overflow-hidden">
                        {u.avatarUrl ? (
                          <SmartImg src={u.avatarUrl} alt={`${u.firstName} ${u.lastName}`} accent={u.color} className="w-full aspect-square object-cover transition-transform duration-700 group-hover:scale-105" />
                        ) : (
                          <div className="w-full aspect-square grid place-items-center text-white font-bold text-5xl" style={{ background: `linear-gradient(135deg, ${u.color}, ${shade(u.color, 0.35)})` }}>
                            {u.firstName[0]}{u.lastName[0]}
                          </div>
                        )}
                        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 45%, ${alpha(bg, 0.85)})` }} />
                        {u.specialty && <span className="tf-mono absolute top-3 left-3 px-2.5 py-1 rounded-md text-[10px] tracking-wider uppercase" style={{ ...glass, color: glow }}>{u.specialty}</span>}
                      </div>
                      <div className="p-5">
                        <h3 className="text-lg font-bold tracking-tight">Dr/a. {u.firstName} {u.lastName}</h3>
                        <button onClick={() => openBooking({ doctorId: u.id })} className="tf-cta mt-3 w-full py-2.5 rounded-lg text-[13px] font-semibold inline-flex items-center justify-center gap-2"
                          style={{ background: alpha(theme, 0.16), color: glow, border: `1px solid ${alpha(glow, 0.35)}` }}>
                          Agendar consulta <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ============================================================
            5 · GALERÍA
           ============================================================ */}
        {gallery.length > 0 && (
          <section id="galeria" className="py-20 sm:py-28">
            <div className="max-w-6xl mx-auto px-5 sm:px-8">
              <SectionHead kicker="// Galería" title="Un entorno clínico de otro nivel" glow={glow} muted={muted} />
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mt-14">
                {gallery.map((g, i) => (
                  <Reveal key={i} delay={(i % 3) * 55} className={i % 5 === 0 ? "col-span-2 lg:col-span-1" : ""}>
                    <button onClick={() => lb.open(i)} aria-label={`Ampliar foto ${i + 1}`} className="relative block w-full group rounded-xl overflow-hidden" style={{ border: `1px solid ${borderC}` }}>
                      <SmartImg src={g} alt={`Instalación ${i + 1}`} accent={theme} className={"w-full object-cover transition-transform duration-700 group-hover:scale-110 " + (i % 5 === 0 ? "aspect-[16/10]" : "aspect-square")} />
                      <span className="absolute inset-0 transition-opacity opacity-0 group-hover:opacity-100 grid place-items-center" style={{ background: alpha(theme, 0.4) }}>
                        <span className="grid place-items-center w-11 h-11 rounded-full text-white" style={glass}><Plus size={20} /></span>
                      </span>
                    </button>
                  </Reveal>
                ))}
              </div>
              <Reveal className="mt-10 text-center">
                <button onClick={() => openBooking()} className="tf-cta inline-flex items-center justify-center gap-2" style={ctaSolid}>
                  <Calendar size={18} /> Conoce el espacio · Agendar Cita
                </button>
              </Reveal>
            </div>
          </section>
        )}

        {/* ============================================================
            6 · TESTIMONIOS
           ============================================================ */}
        {testimonials.length > 0 && (
          <section className="py-20 sm:py-28">
            <div className="max-w-6xl mx-auto px-5 sm:px-8">
              <p className="tf-mono text-[12px] tracking-[0.2em] uppercase mb-10" style={{ color: glow }}>// Lo que dicen nuestros pacientes</p>
              <div className="grid md:grid-cols-3 gap-4">
                {testimonials.map((tm, i) => (
                  <Reveal key={i} delay={(i % 3) * 70} className="rounded-2xl p-7" style={glass}>
                    <Quote size={28} style={{ color: alpha(glow, 0.7) }} fill={alpha(glow, 0.7)} strokeWidth={0} />
                    <p className="mt-4 text-[16px] leading-relaxed" style={{ color: inkText }}>&ldquo;{tm.text}&rdquo;</p>
                    <div className="mt-5 flex items-center justify-between">
                      <span className="tf-mono text-sm" style={{ color: muted }}>— {tm.name}</span>
                      <Stars value={tm.rating ?? 5} size={14} color={glow} />
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ============================================================
            7 · RESEÑAS DE GOOGLE
           ============================================================ */}
        {googleReviews && googleReviews.reviews.length > 0 && (
          <section className="py-20 sm:py-28">
            <div className="max-w-6xl mx-auto px-5 sm:px-8 grid lg:grid-cols-[0.8fr_1.2fr] gap-10 items-center">
              <Reveal className="rounded-2xl p-8" style={glass}>
                <div className="flex items-center gap-3 mb-5"><GoogleG size={26} /><span className="text-lg font-bold">Reseñas de Google</span></div>
                <div className="flex items-end gap-4">
                  <span className="text-7xl font-bold leading-none" style={neonText}>{(googleReviews.rating ?? 5).toFixed(1)}</span>
                  <div className="pb-2">
                    <Stars value={googleReviews.rating ?? 5} size={18} color={glow} />
                    <p className="text-sm mt-1" style={{ color: muted }}>{googleReviews.total} reseñas verificadas</p>
                  </div>
                </div>
                <button onClick={() => openBooking()} className="tf-cta mt-7 w-full inline-flex items-center justify-center gap-2" style={ctaSolid}>
                  <Calendar size={18} /> Agendar Cita
                </button>
              </Reveal>
              <div className="grid sm:grid-cols-2 gap-4">
                {googleReviews.reviews.slice(0, 3).map((r, i) => (
                  <Reveal key={i} delay={(i % 2) * 60} className="rounded-2xl p-6" style={glass}>
                    <div className="flex items-center justify-between">
                      <Stars value={r.rating ?? 5} size={13} color={glow} />
                      {r.relativeTime && <span className="tf-mono text-[11px]" style={{ color: muted }}>{r.relativeTime}</span>}
                    </div>
                    {r.text && <p className="mt-3 text-[14px] leading-relaxed" style={{ color: alpha(inkText, 0.85) }}>&ldquo;{r.text}&rdquo;</p>}
                    <div className="mt-4 flex items-center gap-2.5">
                      {r.photoUrl
                        ? <img src={r.photoUrl} alt={r.name} className="w-7 h-7 rounded-full object-cover" />
                        : <span className="grid place-items-center w-7 h-7 rounded-full text-[11px] font-bold text-white" style={{ background: theme }}>{r.name?.[0] ?? "G"}</span>}
                      <p className="text-sm font-semibold">{r.name}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ============================================================
            8 · FAQ
           ============================================================ */}
        {faqs.length > 0 && (
          <section className="py-20 sm:py-28" style={{ background: surfaceAlt }}>
            <div className="max-w-3xl mx-auto px-5 sm:px-8">
              <Reveal className="text-center mb-12">
                <p className="tf-mono text-[12px] tracking-[0.2em] uppercase mb-3" style={{ color: glow }}>// Preguntas frecuentes</p>
                <h2 className="text-4xl sm:text-5xl font-bold leading-tight tracking-tight">Resolvemos tus dudas</h2>
              </Reveal>
              <div className="space-y-3">
                {faqs.map((f, i) => {
                  const isOpen = openFaq === i;
                  return (
                    <Reveal key={i} delay={(i % 5) * 40}>
                      <div style={{ ...glass, borderRadius: 14, boxShadow: isOpen ? `0 20px 50px -20px ${alpha(theme, 0.55)}` : "none", transition: "box-shadow .3s" }}>
                        <button onClick={() => setOpenFaq(isOpen ? -1 : i)} aria-expanded={isOpen} className="w-full flex items-center justify-between gap-4 text-left px-6 py-5">
                          <span className="font-semibold text-[17px]">{f.question}</span>
                          <span className="shrink-0 grid place-items-center w-8 h-8 rounded-full transition-transform duration-300"
                            style={{ background: isOpen ? theme : surface, color: isOpen ? "#fff" : inkText, border: `1px solid ${borderC}`, transform: isOpen ? "rotate(180deg)" : "none" }}>
                            <ChevronDown size={18} />
                          </span>
                        </button>
                        <div style={{ maxHeight: isOpen ? 320 : 0, overflow: "hidden", transition: "max-height .4s ease" }}>
                          <p className="px-6 pb-5 text-[15px] leading-relaxed" style={{ color: muted }}>{f.answer}</p>
                        </div>
                      </div>
                    </Reveal>
                  );
                })}
              </div>
              <Reveal className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 text-center">
                <span className="text-[15px]" style={{ color: muted }}>¿Te quedó otra duda? Con gusto te ayudamos.</span>
                <button onClick={() => openBooking()} className="tf-cta inline-flex items-center gap-2" style={ctaSolid}>
                  Agendar Cita <ArrowRight size={17} />
                </button>
              </Reveal>
            </div>
          </section>
        )}

        {/* ============================================================
            CTA FINAL
           ============================================================ */}
        <section className="py-12">
          <div className="max-w-5xl mx-auto px-5 sm:px-8">
            <Reveal className="relative overflow-hidden rounded-3xl px-8 sm:px-16 py-16 text-center"
              style={{ background: `linear-gradient(135deg, ${shade(theme, 0.35)}, ${shade(theme, 0.6)})`, border: `1px solid ${alpha(glow, 0.4)}`, boxShadow: `0 0 60px ${alpha(theme, 0.4)}` }}>
              <div className="absolute inset-0 opacity-40" style={{ backgroundImage: `linear-gradient(${alpha(glow, 0.12)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(glow, 0.12)} 1px, transparent 1px)`, backgroundSize: "40px 40px" }} />
              <div className="relative">
                <p className="tf-mono text-[12px] tracking-[0.25em] uppercase mb-4" style={{ color: tint(theme, 0.55) }}>// Tu próxima cita</p>
                <h2 className="text-4xl sm:text-5xl font-bold leading-tight tracking-tight text-white">¿List@ para tu cita?</h2>
                <p className="mt-4 text-lg max-w-xl mx-auto" style={{ color: alpha("#ffffff", 0.8) }}>Agenda tu valoración. Te confirmamos por WhatsApp en minutos.</p>
                <button onClick={() => openBooking()} className="tf-cta mt-8 inline-flex items-center gap-2 px-8 py-4 rounded-xl font-bold"
                  style={{ background: "#fff", color: shade(theme, 0.2), boxShadow: `0 0 30px ${alpha(glow, 0.5)}` }}>
                  <Calendar size={18} /> Agendar Cita
                </button>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ============================================================
            9 · CONTACTO
           ============================================================ */}
        <section id="contacto" className="py-20 sm:py-28" style={{ background: surfaceAlt }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8">
            <Reveal className="text-center mb-12">
              <p className="tf-mono text-[12px] tracking-[0.2em] uppercase mb-3" style={{ color: glow }}>// Visítanos</p>
              <h2 className="text-4xl sm:text-5xl font-bold leading-tight tracking-tight">Estamos cerca de ti</h2>
            </Reveal>
            <div className="grid lg:grid-cols-2 gap-8 items-stretch">
              <Reveal className="flex flex-col gap-4">
                {clinic.address && (
                  <div className="flex items-center gap-4 p-5 rounded-2xl" style={glass}>
                    <span className="shrink-0 grid place-items-center w-12 h-12 rounded-xl" style={{ background: alpha(theme, 0.14), color: glow }}><MapPin size={22} /></span>
                    <div><p className="tf-mono text-xs uppercase tracking-wider" style={{ color: muted }}>Dirección</p><p className="font-semibold text-[16px]">{clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</p></div>
                  </div>
                )}
                {clinic.phone && (
                  <a href={`tel:${clinic.phone}`} className="flex items-center gap-4 p-5 rounded-2xl transition hover:brightness-110" style={glass}>
                    <span className="shrink-0 grid place-items-center w-12 h-12 rounded-xl" style={{ background: alpha(theme, 0.14), color: glow }}><Phone size={22} /></span>
                    <div><p className="tf-mono text-xs uppercase tracking-wider" style={{ color: muted }}>Teléfono</p><p className="font-semibold text-[16px]">{clinic.phone}</p></div>
                  </a>
                )}
                {clinic.landingWhatsapp && waLink && (
                  <a href={waLink} target="_blank" rel="noreferrer" className="flex items-center gap-4 p-5 rounded-2xl transition hover:brightness-110" style={glass}>
                    <span className="shrink-0 grid place-items-center w-12 h-12 rounded-xl" style={{ background: alpha(theme, 0.14), color: glow }}><MessageCircle size={22} /></span>
                    <div><p className="tf-mono text-xs uppercase tracking-wider" style={{ color: muted }}>WhatsApp</p><p className="font-semibold text-[16px]">{clinic.landingWhatsapp}</p></div>
                  </a>
                )}
                {/* horarios */}
                {orderedSchedules.length > 0 && (
                  <div className="p-5 rounded-2xl" style={glass}>
                    <div className="flex items-center gap-3 mb-3"><Clock size={20} style={{ color: glow }} /><span className="font-semibold">Horarios</span></div>
                    {orderedSchedules.map((s) => (
                      <div key={s.dayOfWeek} className="flex justify-between py-1.5 text-[15px]" style={{ color: muted }}>
                        <span>{DAYS_FULL[s.dayOfWeek] ?? `Día ${s.dayOfWeek}`}</span>
                        <span className="font-medium" style={{ color: s.enabled ? inkText : CERRADO }}>{s.enabled ? `${s.openTime} – ${s.closeTime}` : "Cerrado"}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* redes */}
                {socials.length > 0 && (
                  <div className="flex items-center gap-3 flex-wrap">
                    {socials.map((sc) => (
                      <a key={sc.label} href={sc.href} target="_blank" rel="noreferrer" aria-label={sc.label}
                        className="grid place-items-center w-12 h-12 rounded-xl transition hover:scale-105" style={{ ...glass, color: glow }}>
                        {sc.node}
                      </a>
                    ))}
                    <button onClick={() => openBooking()} className="tf-cta ml-auto inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white" style={{ background: theme, border: `1px solid ${alpha(glow, 0.6)}`, boxShadow: `0 0 22px ${alpha(theme, 0.5)}` }}>
                      Agendar Cita
                    </button>
                  </div>
                )}
              </Reveal>
              {/* mapa */}
              <Reveal delay={100} className="overflow-hidden rounded-2xl min-h-[360px]" style={{ border: `1px solid ${borderC}` }}>
                {clinic.landingMapEmbed
                  ? <iframe title="Mapa de la clínica" src={clinic.landingMapEmbed} className="w-full h-full min-h-[360px]" style={{ border: 0, filter: "grayscale(0.3) invert(0.9) hue-rotate(180deg)" }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                  : <div className="w-full h-full min-h-[360px] grid place-items-center text-center p-10" style={{ background: surface }}>
                      <div><MapPin size={42} style={{ color: alpha(glow, 0.5) }} className="mx-auto mb-3" /><p className="text-sm" style={{ color: muted }}>{clinic.address ?? "Ubicación próximamente"}</p></div>
                    </div>}
              </Reveal>
            </div>
          </div>
        </section>

        {/* ============================================================
            10 · FOOTER
           ============================================================ */}
        <footer style={{ background: footerBg, color: alpha("#ffffff", 0.7) }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                {clinic.logoUrl
                  ? <img src={clinic.logoUrl} alt={clinic.name} className="w-11 h-11 rounded-xl object-contain" />
                  : <span className="grid place-items-center w-11 h-11 rounded-xl font-bold text-white" style={{ background: theme, boxShadow: `0 0 18px ${alpha(theme, 0.6)}` }}>{initials}</span>}
                <span className="text-white text-lg font-bold">{clinic.name}</span>
              </div>
              {clinic.description && <p className="max-w-sm text-[15px] leading-relaxed opacity-80">{clinic.description}</p>}
              <button onClick={() => openBooking()} className="tf-cta mt-6 px-6 py-3 rounded-xl font-semibold text-white" style={{ background: theme, border: `1px solid ${alpha(glow, 0.5)}` }}>Agendar Cita</button>
            </div>
            {navLinks.length > 0 && (
              <div>
                <p className="text-white font-semibold mb-4">Navegación</p>
                <ul className="space-y-2.5 text-[15px]">
                  {navLinks.map(([l, id]) => (
                    <li key={id}><a href={"#" + id} onClick={(e) => { e.preventDefault(); scrollToId(id); }} className="opacity-75 hover:opacity-100 transition">{l}</a></li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="text-white font-semibold mb-4">Contacto</p>
              <ul className="space-y-2.5 text-[15px] opacity-80">
                {clinic.address && <li className="flex items-start gap-2"><MapPin size={17} className="mt-0.5 shrink-0" />{clinic.address}</li>}
                {clinic.phone && <li className="flex items-center gap-2"><Phone size={17} />{clinic.phone}</li>}
                {clinic.landingWhatsapp && <li className="flex items-center gap-2"><MessageCircle size={17} />{clinic.landingWhatsapp}</li>}
              </ul>
              {socials.length > 0 && (
                <div className="flex gap-3 mt-4">
                  {socials.map((sc) => (
                    <a key={sc.label} href={sc.href} target="_blank" rel="noreferrer" aria-label={sc.label} className="opacity-70 hover:opacity-100 transition">{sc.node}</a>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="border-t" style={{ borderColor: alpha("#ffffff", 0.1) }}>
            <div className="max-w-6xl mx-auto px-5 sm:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] opacity-60">
              <span>© {new Date().getFullYear()} {clinic.name}. Todos los derechos reservados.</span>
              <span className="flex items-center gap-1.5">Hecho con <a href="/" className="font-bold transition hover:opacity-100" style={{ color: glow }}>DaleControl</a></span>
            </div>
          </div>
        </footer>
      </div>

      {/* ---------- lightbox de galería ---------- */}
      <Lightbox images={gallery} lb={lb} />

      {/* ---------- botón flotante "Agendar" ---------- */}
      <button onClick={() => openBooking()} aria-label="Agendar Cita"
        className="tf-cta fixed right-4 sm:right-6 z-[90] inline-flex items-center gap-2 font-semibold text-white"
        style={{
          bottom: 24, padding: "13px 20px", borderRadius: 999, background: theme,
          border: `1px solid ${alpha(glow, 0.5)}`,
          boxShadow: `0 0 24px ${alpha(glow, 0.6)}, 0 14px 30px -10px ${alpha(theme, 0.7)}`,
          opacity: showFab ? 1 : 0,
          transform: showFab ? "translateY(0) scale(1)" : "translateY(24px) scale(.9)",
          pointerEvents: showFab ? "auto" : "none",
          transition: "opacity .5s, transform .5s",
        }}>
        <Calendar size={18} />
        <span className="hidden sm:inline">Agendar Cita</span>
      </button>

      {/* ---------- modal de reserva REAL (uno solo, controlado) ---------- */}
      <BookingModal clinic={clinic} theme={theme} open={booking.open} onClose={closeBooking} preselectedDoctorId={booking.doctorId} preselectedService={booking.service} />
    </div>
  );
}
