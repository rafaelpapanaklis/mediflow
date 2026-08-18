"use client";
/* ============================================================
   PLANTILLA "HEALTHTECH" — claro / redondeado / sans
   Plus Jakarta Sans · mucho blanco · tarjetas con sombras suaves ·
   gradientes del acento · hero split con foto redondeada + tarjetas
   flotantes. Todo deriva de `clinic` (multi-tenant, nada hardcodeado).
   Reusa el modal REAL y los helpers de ../_shared (contrato T1).
   ============================================================ */
import { useState, useEffect, type ReactNode } from "react";
import {
  Menu, X, ArrowRight, Shield, Award, Users, MessageCircle, MapPin,
  Phone, Clock, Instagram, Facebook, ChevronDown, Plus, Calendar, Star, Check,
} from "lucide-react";
import type { TemplateProps } from "../_shared/types";
import { useLiveClinic } from "../_shared/live-preview";
import { Foto, Txt, useEnEdicion } from "../_shared/edit-context";
// landing-address-parts y NO landing-address: este archivo viaja al navegador
// de los pacientes, y el módulo grande arrastra el manifiesto de las ocho
// plantillas (17 KB) sin que la página pública lo necesite para nada.
import { dirClinica, dirCopia, dirFaq, dirSeccion, dirServicio, dirTestimonio } from "@/lib/landing-address-parts";
import { copyMap, copyText, copyValue, photoOf, sectionMap, sectionTitle, showSection } from "../_shared/landing-data";
import {
  SmartImg, Stars, GoogleG, useScrolled, useActiveSection, Reveal,
  scrollToId, useLightbox, Lightbox, tint, shade, alpha, mix, hexAdjust,
} from "../_shared/landing-utils";
import { BookingModal } from "../_shared/booking-modal";
import { useBookingReopen, type PendingBooking } from "../_shared/booking-session";

const DAYS_FULL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const CLOSED_RED = "#b91c1c";

type Tokens = {
  theme: string; grad: string; gradSoft: string;
  ink: string; muted: string; paper: string; border: string; softShadow: string;
};

/* ---------- Botón pastilla (sólido / fantasma) ---------- */
function Pill({
  tk, children, onClick, variant = "solid", size = "md", className = "",
  campo, valor, porDefecto, despues,
}: {
  tk: Tokens; children?: ReactNode; onClick?: () => void;
  variant?: "solid" | "ghost"; size?: "md" | "sm"; className?: string;
  /* Con `campo`, el <button> ES el <Txt> y la etiqueta se edita haciendo clic.
     El icono viaja como hermano (`despues`) y el espacio como sufijo pegado:
     en el JSX eran UN nodo de texto seguido del svg, y partirlo metería una
     marca de hidratación donde no había ninguna. */
  campo?: string; valor?: string | null; porDefecto?: string; despues?: ReactNode;
}) {
  const clase =
    "inline-flex items-center justify-center gap-2 font-semibold rounded-full transition-all duration-300 " +
    (size === "md" ? "px-6 py-3.5 " : "px-5 py-2.5 text-sm ") + className;
  const estilo =
    variant === "solid"
      ? { background: tk.grad, color: "#fff", boxShadow: `0 12px 26px -10px ${alpha(tk.theme, 0.7)}` }
      : { background: "#fff", color: tk.ink, border: `1.5px solid ${tk.border}` };
  const sobre = (e: any) => (e.currentTarget.style.transform = "translateY(-2px)");
  const fuera = (e: any) => (e.currentTarget.style.transform = "none");

  if (campo) {
    return (
      <Txt
        as="button"
        type="button"
        onClick={onClick}
        className={clase}
        style={estilo}
        onMouseEnter={sobre}
        onMouseLeave={fuera}
        campo={campo}
        valor={valor} porDefecto={porDefecto}
        sufijo={despues !== undefined ? " " : undefined} unido={despues !== undefined}
        despues={despues}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={clase}
      style={estilo}
      onMouseEnter={sobre}
      onMouseLeave={fuera}
    >
      {children}
    </button>
  );
}

/* ---------- Encabezado de sección ---------- */
function SectionHead({
  tk, seccion, claveKicker, kicker, kickerValor, title, titleValor, sub, subValor, center = false, editando = false,
}: {
  tk: Tokens; seccion: string; claveKicker: string;
  kicker: string; kickerValor: string | null;
  title: string; titleValor?: string | null;
  sub?: string; subValor?: string | null;
  center?: boolean; editando?: boolean;
}) {
  return (
    <Reveal className={center ? "max-w-2xl mx-auto text-center" : "max-w-2xl"}>
      <Txt as="span" className="inline-block px-3 py-1 rounded-full text-[13px] font-bold mb-4" style={{ background: alpha(tk.theme, 0.1), color: tk.theme }}
        campo={dirCopia(claveKicker)}
        valor={kickerValor} porDefecto={kicker} />
      <Txt as="h2" className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.08]" style={{ color: tk.ink }}
        campo={dirSeccion(seccion, "titulo")}
        valor={titleValor} porDefecto={title} />
      {sub && (subValor || sub || editando) && (
        <Txt as="p" className="mt-4 text-lg" style={{ color: tk.muted }}
          campo={dirSeccion(seccion, "subtitulo")}
          valor={subValor} porDefecto={sub} />
      )}
    </Reveal>
  );
}

/* ---------- Badge de confianza del hero ---------- */
function TrustBadge({ tk, icon, big, small, clave, smallValor }: {
  tk: Tokens; icon: ReactNode; big: string; small: string;
  /* Sin `clave`, la leyenda no se edita: es el caso de la calificación con
     ficha de Google, donde el texto cambia solo según haya ficha o no. */
  clave?: string; smallValor?: string | null;
}) {
  return (
    <div className="rounded-2xl px-3 py-3 text-center" style={{ background: "#fff", border: `1px solid ${tk.border}` }}>
      <span className="flex justify-center mb-1" style={{ color: tk.theme }}>{icon}</span>
      <p className="text-xl font-extrabold leading-none" style={{ color: tk.ink }}>{big}</p>
      <Txt as="p" className="text-[11px] mt-0.5" style={{ color: "#94a3b8" }}
        campo={clave ? dirCopia(clave) : null}
        valor={clave ? smallValor : null} porDefecto={small} />
    </div>
  );
}

export function TemplateHealthtech({ clinic: publicada, highlights }: TemplateProps) {
  // En /dashboard/landing esto trae lo que la clínica lleva escrito sin
  // guardar; en la página pública devuelve `publicada` tal cual.
  const clinic = useLiveClinic(publicada);
  /* Solo dentro del lienzo del editor. En la página pública es SIEMPRE false,
     así que ninguna sección se pinta distinta para un paciente. */
  const editando = useEnEdicion();
  /* ---- tokens de marca (todo deriva del acento) ---- */
  const theme = clinic.landingThemeColor ?? "#0f766e";
  const ink = "#0f172a";
  const muted = "#64748b";
  const paper = "#f4f7fb";
  const border = "#e6edf4";
  const grad = `linear-gradient(135deg, ${theme}, ${shade(theme, 0.28)})`;
  const gradSoft = `linear-gradient(135deg, ${tint(theme, 0.92)}, ${tint(theme, 0.8)})`;
  const softShadow = "0 18px 40px -18px rgba(15,23,42,.18)";
  const tintedSurface = mix("#ffffff", theme, 0.04); // superficie con un toque de marca
  const tk: Tokens = { theme, grad, gradSoft, ink, muted, paper, border, softShadow };

  /* ---- estado ---- */
  const [booking, setBooking] = useState<{ open: boolean; preselectedService?: string; preselectedDoctorId?: string; restore?: PendingBooking | null }>({ open: false });
  const openBooking = (opts?: { service?: string; doctorId?: string }) =>
    setBooking({ open: true, preselectedService: opts?.service, preselectedDoctorId: opts?.doctorId });
  const closeBooking = () => setBooking((b) => ({ ...b, open: false }));
  // De vuelta del login/registro: reabre el modal en el hueco ya elegido.
  useBookingReopen(clinic.slug, (pending) =>
    setBooking({ open: true, preselectedDoctorId: pending?.doctorId, preselectedService: pending?.service, restore: pending }));

  const scrolled = useScrolled(40);
  const active = useActiveSection(["inicio", "servicios", "equipo", "galeria", "contacto"]);
  const lb = useLightbox();
  const [menu, setMenu] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [showFloat, setShowFloat] = useState(false);
  const [googleReviews, setGoogleReviews] = useState<{ reviews: any[]; rating: number | null; total: number } | null>(null);

  /* ---- reseñas de Google (igual que landing-client: sólo si hay googlePlaceId) ---- */
  useEffect(() => {
    if (!clinic.googlePlaceId) return;
    fetch(`/api/google-reviews?slug=${clinic.slug}`)
      .then((r) => r.json())
      .then((d) => { if (d.reviews?.length > 0) setGoogleReviews(d); })
      .catch(() => {});
  }, [clinic.slug, clinic.googlePlaceId]);

  /* ---- botón flotante tras ~520px ---- */
  useEffect(() => {
    const onScroll = () => setShowFloat(window.scrollY > 520);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* ---- parseo de datos (Array.isArray como landing-client) ---- */
  const services: any[] = Array.isArray(clinic.landingServices) ? clinic.landingServices : [];
  const testimonials: any[] = Array.isArray(clinic.landingTestimonials) ? clinic.landingTestimonials : [];
  const faqs: any[] = Array.isArray(clinic.landingFaqs) ? clinic.landingFaqs : [];
  const gallery: string[] = clinic.landingGallery ?? [];
  const doctors = clinic.users ?? [];
  const waLink = clinic.landingWhatsapp ? `https://wa.me/${clinic.landingWhatsapp.replace(/\D/g, "")}` : null;
  const igLink = clinic.landingInstagram ? `https://instagram.com/${clinic.landingInstagram.replace("@", "")}` : null;
  const fbLink = clinic.landingFacebook || null;

  const ratingValue =
    googleReviews?.rating ??
    (testimonials.length ? testimonials.reduce((s, t) => s + (t.rating ?? 5), 0) / testimonials.length : null);

  const schedMap: Record<string, { dayOfWeek: number; enabled: boolean; openTime: string; closeTime: string }> =
    Object.fromEntries((clinic.schedules ?? []).map((s) => [String(s.dayOfWeek), s]));

  const showGoogle = !!googleReviews && googleReviews.reviews.length > 0;
  const hasBadges = ratingValue != null || clinic.landingYearsExperience != null || !!clinic.landingPatients;

  /* ---- lo que guardó el editor ----
     healthtech nació antes del manifiesto: su lista de bloques y sus títulos
     estaban escritos a mano y los interruptores de la pestaña Diseño se
     guardaban sin que pasara nada. Ahora se leen. Las listas siguen siendo
     las CRUDAS (sin serviceList ni faqList): esas normalizadoras tiran los
     elementos incompletos, y una tarjeta que hoy se pinta a medias
     desaparecería del sitio publicado de alguien sin que nadie lo pidiera. */
  const S = sectionMap(clinic);
  const copias = copyMap(clinic);
  const C = (clave: string) => copyValue(copias, clave);
  /* La portada, con la misma cadena de respaldo que las otras siete:
     ranura "portada" → landingCoverUrl (lo que healthtech leía hasta hoy). */
  const portada = photoOf(clinic, "portada", { cover: true });
  const verServicios = showSection(S, "servicios", services.length > 0);
  const verEquipo    = showSection(S, "equipo",    doctors.length > 0);
  const verGaleria   = showSection(S, "galeria",   gallery.length > 0);
  const verOpiniones = showSection(S, "opiniones", testimonials.length > 0);
  const verFaq       = showSection(S, "faq",       faqs.length > 0);

  const navItems: [string, string][] = [
    ...(services.length > 0 ? [["Servicios", "servicios"] as [string, string]] : []),
    ...(doctors.length > 0 ? [["Equipo", "equipo"] as [string, string]] : []),
    ...(gallery.length > 0 ? [["Galería", "galeria"] as [string, string]] : []),
    ["Contacto", "contacto"],
  ];

  return (
    <div className="ht-root min-h-screen" style={{ background: "#fff", color: ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        .ht-root { font-family:'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; -webkit-font-smoothing:antialiased; }
        .ht-root ::selection { background:${alpha(theme, 0.18)}; }
        @keyframes mfFade { from { opacity:0; } to { opacity:1; } }
        @keyframes mfPop { 0% { transform:scale(.85); opacity:0; } 60% { transform:scale(1.04); } 100% { transform:scale(1); opacity:1; } }
        @keyframes mfReveal { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:none; } }
        @media (prefers-reduced-motion: no-preference) {
          .ht-fade { animation: mfFade .8s ease both; }
          .ht-pop { animation: mfPop .5s cubic-bezier(.2,1.4,.4,1) both; }
          .ht-reveal { animation: mfReveal .6s cubic-bezier(.2,.8,.2,1) both; }
        }
      `}</style>

      {/* ---------------- NAVBAR ---------------- */}
      <header
        className="fixed top-0 inset-x-0 z-50 transition-all duration-300"
        style={
          scrolled
            ? { background: "rgba(255,255,255,.85)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderBottom: `1px solid ${border}`, boxShadow: "0 6px 24px -16px rgba(15,23,42,.2)" }
            : { background: "transparent" }
        }
      >
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-[72px] flex items-center justify-between">
          <a href="#inicio" onClick={(e) => { e.preventDefault(); scrollToId("inicio"); }} className="flex items-center gap-2.5 min-w-0">
            {clinic.logoUrl ? (
              <img src={clinic.logoUrl} alt={clinic.name} className="w-10 h-10 rounded-2xl object-contain bg-white" />
            ) : (
              <span className="grid place-items-center w-10 h-10 rounded-2xl font-extrabold text-white text-sm shrink-0" style={{ background: grad }}>
                {clinic.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="font-extrabold text-[17px] tracking-tight truncate" style={{ color: ink }}>{clinic.name}</span>
          </a>

          <nav className="hidden md:flex items-center gap-1 p-1 rounded-full" style={{ background: paper }}>
            {navItems.map(([label, id]) => (
              <a
                key={id}
                href={"#" + id}
                onClick={(e) => { e.preventDefault(); scrollToId(id); }}
                className="px-4 py-2 rounded-full text-sm font-semibold transition-all"
                style={active === id ? { background: "#fff", color: theme, boxShadow: "0 2px 10px -4px rgba(15,23,42,.2)" } : { color: muted }}
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Pill tk={tk} size="sm" onClick={() => openBooking()} className="hidden sm:inline-flex"
              campo={dirCopia("nav.cta")} valor={C("nav.cta")} porDefecto="Agendar Cita" />
            <button className="md:hidden w-10 h-10 grid place-items-center rounded-xl" style={{ background: paper, color: ink }} aria-label="Abrir menú" onClick={() => setMenu(true)}>
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* menú móvil */}
      {menu && (
        <div className="fixed inset-0 z-[60] md:hidden bg-white">
          <div className="flex items-center justify-between px-5 h-[72px] border-b" style={{ borderColor: border }}>
            <span className="font-extrabold text-lg" style={{ color: ink }}>Menú</span>
            <button className="w-10 h-10 grid place-items-center rounded-xl" style={{ background: paper, color: ink }} aria-label="Cerrar menú" onClick={() => setMenu(false)}>
              <X size={20} />
            </button>
          </div>
          <nav className="p-5 flex flex-col gap-2">
            {navItems.map(([label, id]) => (
              <a
                key={id}
                href={"#" + id}
                onClick={(e) => { e.preventDefault(); setMenu(false); scrollToId(id); }}
                className="px-4 py-4 rounded-2xl text-lg font-semibold"
                style={{ background: paper, color: ink }}
              >
                {label}
              </a>
            ))}
            <Pill tk={tk} className="mt-3 w-full" onClick={() => { setMenu(false); openBooking(); }}
              campo={dirCopia("nav.cta")} valor={C("nav.cta")} porDefecto="Agendar Cita" />
          </nav>
        </div>
      )}

      {/* ---------------- HERO ---------------- */}
      <section id="inicio" className="relative overflow-hidden pt-28 sm:pt-36 pb-20">
        <div aria-hidden className="absolute -top-40 -right-40 w-[640px] h-[640px] rounded-full pointer-events-none" style={{ background: gradSoft, filter: "blur(10px)", opacity: 0.7 }} />
        <div aria-hidden className="absolute top-1/3 -left-24 w-72 h-72 rounded-full pointer-events-none" style={{ background: alpha(theme, 0.07) }} />

        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-14 items-center">
          {/* columna texto */}
          <div className="ht-fade">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[13px] font-semibold mb-6" style={{ background: alpha(theme, 0.1), color: shade(theme, 0.15) }}>
              <span className="w-2 h-2 rounded-full" style={{ background: theme }} />
              {clinic.specialty}{clinic.city ? ` · ${clinic.city}` : ""}
            </div>

            <Txt as="h1" className="text-[40px] sm:text-6xl font-extrabold leading-[1.04] tracking-tight" style={{ color: ink }}
              campo={dirClinica("name")} valor={clinic.name} />
            {(clinic.landingTagline || editando) && (
              <Txt as="p" className="mt-3 text-2xl sm:text-3xl font-extrabold leading-tight" style={{ background: grad, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
                campo={dirClinica("landingTagline")} valor={clinic.landingTagline} />
            )}
            {(clinic.description || editando) && (
              <Txt as="p" className="mt-6 text-lg leading-relaxed" style={{ color: muted }}
                campo={dirClinica("description")} valor={clinic.description} />
            )}

            {highlights && highlights.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {highlights.map((h) => (
                  <span key={h} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold" style={{ background: alpha(theme, 0.08), color: shade(theme, 0.15) }}>
                    <Check size={13} style={{ color: theme }} /> {h}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <Pill tk={tk} onClick={() => openBooking()}
                campo={dirCopia("hero.cta")} valor={C("hero.cta")} porDefecto="Agendar Cita"
                despues={<ArrowRight size={18} />} />
              {waLink ? (
                <Txt
                  as="a"
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 font-semibold rounded-full px-6 py-3.5 transition-all duration-300 hover:-translate-y-0.5"
                  style={{ background: "#fff", color: ink, border: `1.5px solid ${border}` }}
                  campo={dirCopia("hero.whatsapp")}
                  valor={C("hero.whatsapp")} porDefecto="WhatsApp" prefijo=" " unido
                  antes={<MessageCircle size={18} style={{ color: theme }} />}
                />
              ) : (
                <Txt
                  as="button"
                  type="button"
                  onClick={() => scrollToId(verServicios ? "servicios" : "contacto")}
                  className="inline-flex items-center justify-center gap-2 font-semibold rounded-full px-6 py-3.5 transition-all duration-300 hover:-translate-y-0.5"
                  style={{ background: "#fff", color: ink, border: `1.5px solid ${border}` }}
                  campo={dirCopia("hero.cta2")}
                  valor={C("hero.cta2")} porDefecto="Conoce más"
                />
              )}
            </div>

            {hasBadges && (
              <div className="mt-10 grid grid-cols-3 gap-3 max-w-lg">
                {/* Con ficha de Google la leyenda cambia sola a "Google": es
                    una condición, no un literal, así que solo se edita la
                    versión sin Google. */}
                {ratingValue != null && (
                  <TrustBadge tk={tk} icon={<Star size={18} />} big={ratingValue.toFixed(1)}
                    small={googleReviews?.rating != null ? "Google" : "calificación"}
                    clave={googleReviews?.rating != null ? undefined : "sellos.calificacion"}
                    smallValor={C("sellos.calificacion")} />
                )}
                {clinic.landingYearsExperience != null && (
                  <TrustBadge tk={tk} icon={<Award size={18} />} big={`${clinic.landingYearsExperience}+`} small="años"
                    clave="sellos.anios" smallValor={C("sellos.anios")} />
                )}
                {clinic.landingPatients && (
                  <TrustBadge tk={tk} icon={<Users size={18} />} big={clinic.landingPatients} small="pacientes"
                    clave="sellos.pacientes" smallValor={C("sellos.pacientes")} />
                )}
              </div>
            )}
          </div>

          {/* columna foto + tarjetas flotantes */}
          <div className="relative ht-fade">
            <div className="rounded-[32px] overflow-hidden" style={{ boxShadow: "0 40px 80px -30px rgba(15,23,42,.35)" }}>
              {/* Sin `caja`: el div de la tarjeta flotante de al lado ya crea
                  el contexto posicionado; envolver aquí movería la foto. */}
              <Foto slot="portada" url={portada} zona="derecha">
                {(url) => <SmartImg src={url} alt={`Consultorio de ${clinic.name}`} accent={theme} className="w-full aspect-[4/3] object-cover" />}
              </Foto>
            </div>

            {ratingValue != null && (
              <div className="absolute -left-4 sm:-left-8 bottom-8 bg-white rounded-2xl p-4 flex items-center gap-3 ht-pop" style={{ boxShadow: "0 20px 40px -16px rgba(15,23,42,.3)" }}>
                <div className="grid place-items-center w-11 h-11 rounded-xl text-white" style={{ background: grad }}><Shield size={22} /></div>
                <div>
                  <Txt as="p" className="text-xs" style={{ color: "#94a3b8" }}
                    campo={dirCopia("sellos.tarjeta")}
                    valor={C("sellos.tarjeta")} porDefecto="Calificación" />
                  <p className="font-bold text-sm" style={{ color: ink }}>{ratingValue.toFixed(1)} de 5</p>
                </div>
              </div>
            )}

            {doctors.length > 0 && (
              <div className="absolute -right-3 top-6 bg-white rounded-2xl px-4 py-3 flex items-center gap-2 ht-pop" style={{ boxShadow: "0 20px 40px -16px rgba(15,23,42,.3)", animationDelay: ".15s" }}>
                <div className="flex -space-x-2">
                  {doctors.slice(0, 3).map((u) => (
                    <SmartImg key={u.id} src={u.avatarUrl} alt={u.firstName} accent={theme} className="w-8 h-8 rounded-full object-cover border-2 border-white" />
                  ))}
                </div>
                <div>
                  {ratingValue != null && <Stars value={ratingValue} size={11} />}
                  <p className="text-[11px] font-semibold" style={{ color: muted }}>
                    {doctors.length} {doctors.length === 1 ? "especialista" : "especialistas"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- SERVICIOS ---------------- */}
      {verServicios && (
        <section id="servicios" className="py-20 sm:py-28">
          <div className="max-w-7xl mx-auto px-5 sm:px-8">
            <SectionHead tk={tk} seccion="servicios" claveKicker="servicios.kicker" editando={editando}
              kicker="Servicios" kickerValor={C("servicios.kicker")}
              title="Todo lo que tu salud necesita" titleValor={S.servicios?.titulo}
              sub="Tratamientos con tecnología de punta y precios claros." subValor={S.servicios?.subtitulo} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-14">
              {services.map((s: any, i: number) => (
                <Reveal key={i} delay={i * 60}>
                  <div
                    className="group h-full rounded-3xl p-7 transition-all duration-300 bg-white"
                    style={{ border: `1px solid ${border}` }}
                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 30px 60px -28px rgba(15,23,42,.28)"; e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.borderColor = alpha(theme, 0.4); }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = border; }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="grid place-items-center w-14 h-14 rounded-2xl text-2xl" style={{ background: alpha(theme, 0.1) }}>{s.icon || "🏥"}</span>
                      {(s.price || editando) && (
                        <Txt as="span" className="px-3 py-1 rounded-full text-sm font-bold" style={{ background: paper, color: theme }}
                          campo={dirServicio(i, "price")} valor={s.price} />
                      )}
                    </div>
                    <Txt as="h3" className="mt-5 text-xl font-bold" style={{ color: ink }}
                      campo={dirServicio(i, "name")} valor={s.name} />
                    {(s.desc || editando) && (
                      <Txt as="p" className="mt-1.5 text-[15px] leading-relaxed" style={{ color: muted }}
                        campo={dirServicio(i, "desc")} valor={s.desc} />
                    )}
                    <Txt
                      as="button"
                      type="button"
                      onClick={() => openBooking({ service: s.name })}
                      className="mt-5 w-full py-3 rounded-2xl font-semibold text-sm transition-all flex items-center justify-center gap-2"
                      style={{ background: paper, color: ink }}
                      onMouseEnter={(e: any) => { e.currentTarget.style.background = grad; e.currentTarget.style.color = "#fff"; }}
                      onMouseLeave={(e: any) => { e.currentTarget.style.background = paper; e.currentTarget.style.color = ink; }}
                      campo={dirCopia("servicios.cta")}
                      valor={C("servicios.cta")} porDefecto="Agendar" sufijo=" " unido
                      despues={<ArrowRight size={16} />}
                    />
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- EQUIPO ---------------- */}
      {verEquipo && (
        <section id="equipo" className="py-20 sm:py-28" style={{ background: tintedSurface }}>
          <div className="max-w-7xl mx-auto px-5 sm:px-8">
            <SectionHead tk={tk} seccion="equipo" claveKicker="equipo.kicker" editando={editando}
              kicker="Equipo médico" kickerValor={C("equipo.kicker")}
              title="Especialistas en quienes confiar" titleValor={S.equipo?.titulo}
              sub="Profesionales certificados, comprometidos con tu bienestar." subValor={S.equipo?.subtitulo} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-14">
              {doctors.map((u, i) => (
                <Reveal key={u.id} delay={i * 70}>
                  <div
                    className="bg-white rounded-3xl p-3 transition-all duration-300 group h-full"
                    style={{ border: `1px solid ${border}` }}
                    onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 30px 60px -28px rgba(15,23,42,.28)")}
                    onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
                  >
                    <div className="rounded-2xl overflow-hidden relative">
                      <div className="h-1.5 absolute top-0 inset-x-0 z-10" style={{ background: `linear-gradient(90deg, ${u.color}, ${hexAdjust(u.color, 40)})` }} />
                      <SmartImg
                        src={u.avatarUrl}
                        alt={`Dr(a). ${u.firstName} ${u.lastName}`}
                        accent={theme}
                        className="w-full aspect-square object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      {u.specialty && (
                        <span className="absolute top-3 left-3 px-3 py-1 rounded-full text-[11px] font-bold text-white" style={{ background: alpha(ink, 0.55), backdropFilter: "blur(4px)" }}>
                          {u.specialty}
                        </span>
                      )}
                    </div>
                    <div className="p-4">
                      <h3 className="font-bold text-lg" style={{ color: ink }}>Dr(a). {u.firstName} {u.lastName}</h3>
                      <Txt
                        as="button"
                        type="button"
                        onClick={() => openBooking({ doctorId: u.id })}
                        className="mt-3 w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition"
                        style={{ background: alpha(theme, 0.1), color: theme }}
                        campo={dirCopia("equipo.cta")}
                        valor={C("equipo.cta")} porDefecto="Agendar consulta" sufijo=" " unido
                        despues={<ArrowRight size={15} />}
                      />
                    </div>
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
          <div className="max-w-7xl mx-auto px-5 sm:px-8">
            <SectionHead tk={tk} seccion="galeria" claveKicker="galeria.kicker" editando={editando}
              kicker="Galería" kickerValor={C("galeria.kicker")}
              title="Conoce nuestras instalaciones" titleValor={S.galeria?.titulo} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-14">
              {gallery.map((g, i) => (
                <Reveal key={i} delay={(i % 4) * 50} className={i === 0 ? "col-span-2 row-span-2" : ""}>
                  <button type="button" onClick={() => lb.open(i)} aria-label={`Ampliar instalación ${i + 1}`} className="block w-full h-full group rounded-2xl overflow-hidden relative">
                    <SmartImg
                      src={g}
                      alt={`Instalación ${i + 1}`}
                      accent={theme}
                      className={"w-full object-cover transition-transform duration-700 group-hover:scale-105 " + (i === 0 ? "aspect-square lg:h-full" : "aspect-square")}
                    />
                    <span className="absolute inset-0 transition-opacity opacity-0 group-hover:opacity-100 grid place-items-center" style={{ background: alpha(theme, 0.35) }}>
                      <span className="grid place-items-center w-12 h-12 rounded-full bg-white/90" style={{ color: theme }}><Plus size={22} /></span>
                    </span>
                  </button>
                </Reveal>
              ))}
            </div>
            <Reveal className="mt-10 text-center">
              <Pill tk={tk} onClick={() => openBooking()}
                campo={dirCopia("galeria.cta")} valor={C("galeria.cta")} porDefecto="Visítanos · Agendar Cita"
                despues={<ArrowRight size={18} />} />
            </Reveal>
          </div>
        </section>
      )}

      {/* ---------------- TESTIMONIOS ---------------- */}
      {verOpiniones && (
        <section className="py-20 sm:py-28" style={{ background: tintedSurface }}>
          <div className="max-w-7xl mx-auto px-5 sm:px-8">
            <SectionHead tk={tk} center seccion="opiniones" claveKicker="opiniones.kicker" editando={editando}
              kicker="Testimonios" kickerValor={C("opiniones.kicker")}
              title="Lo que dicen nuestros pacientes" titleValor={S.opiniones?.titulo} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-14">
              {testimonials.map((t: any, i: number) => (
                <Reveal key={i} delay={i * 60}>
                  <div className="bg-white rounded-3xl p-6 h-full" style={{ border: `1px solid ${border}` }}>
                    <Stars value={t.rating ?? 5} size={15} />
                    {/* Las comillas van como prefijo/sufijo y no dentro del
                        texto: si se guardaran, la siguiente edición las
                        duplicaría. */}
                    <Txt as="p" className="mt-3 text-[15px] leading-relaxed" style={{ color: "#475569" }}
                      campo={dirTestimonio(i, "text")}
                      valor={t.text} prefijo={"\u201C"} sufijo={"\u201D"} />
                    <div className="mt-4 flex items-center gap-2.5">
                      <span className="grid place-items-center w-9 h-9 rounded-full text-white font-bold text-sm" style={{ background: grad }}>{t.name?.[0] ?? "P"}</span>
                      <div>
                        <Txt as="p" className="font-semibold text-sm" style={{ color: ink }}
                          campo={dirTestimonio(i, "name")} valor={t.name} />
                        {t.date && <p className="text-xs" style={{ color: "#94a3b8" }}>{t.date}</p>}
                      </div>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- RESEÑAS DE GOOGLE ---------------- */}
      {showGoogle && (
        <section className="py-20 sm:py-28">
          <div className="max-w-7xl mx-auto px-5 sm:px-8">
            <div className="grid lg:grid-cols-3 gap-5">
              {/* tarjeta resumen Google */}
              <Reveal className="rounded-3xl p-8 text-white flex flex-col justify-between" style={{ background: grad, boxShadow: `0 30px 60px -24px ${alpha(theme, 0.6)}` }}>
                <div>
                  <div className="flex items-center gap-2 bg-white/15 w-fit px-3 py-1.5 rounded-full">
                    <GoogleG size={18} /><Txt as="span" className="text-sm font-semibold"
                      campo={dirCopia("opiniones.tituloGoogle")}
                      valor={C("opiniones.tituloGoogle")} porDefecto="Google" />
                  </div>
                  {googleReviews!.rating != null && (
                    <>
                      <div className="mt-6 text-6xl font-extrabold">{googleReviews!.rating.toFixed(1)}</div>
                      <Stars value={googleReviews!.rating} size={18} color="#fff" />
                    </>
                  )}
                  <p className="mt-2 text-white/85">{googleReviews!.total} reseñas verificadas</p>
                </div>
                <Txt as="button" type="button" onClick={() => openBooking()} className="mt-8 bg-white rounded-2xl py-3.5 font-bold transition hover:brightness-95" style={{ color: shade(theme, 0.1) }}
                  campo={dirCopia("opiniones.cta")}
                  valor={C("opiniones.cta")} porDefecto="Agendar mi cita" />
              </Reveal>

              {/* reseñas */}
              <div className="lg:col-span-2 grid sm:grid-cols-2 gap-5">
                {googleReviews!.reviews.slice(0, 4).map((r: any, i: number) => (
                  <Reveal key={i} delay={i * 60} className="bg-white rounded-3xl p-6" style={{ border: `1px solid ${border}` }}>
                    <div className="flex items-center justify-between">
                      <Stars value={r.rating ?? 5} size={15} />
                      <span className="text-xs" style={{ color: "#94a3b8" }}>{r.relativeTime || "paciente"}</span>
                    </div>
                    {r.text && <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "#475569" }}>&ldquo;{r.text}&rdquo;</p>}
                    <div className="mt-4 flex items-center gap-2.5">
                      {r.photoUrl ? (
                        <img src={r.photoUrl} alt={r.name} className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <span className="grid place-items-center w-9 h-9 rounded-full text-white font-bold text-sm" style={{ background: grad }}>{r.name?.[0] ?? "G"}</span>
                      )}
                      <span className="font-semibold text-sm" style={{ color: ink }}>{r.name}</span>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---------------- FAQ ---------------- */}
      {verFaq && (
        <section className="py-20 sm:py-28">
          <div className="max-w-3xl mx-auto px-5 sm:px-8">
            <SectionHead tk={tk} center seccion="faq" claveKicker="faq.kicker" editando={editando}
              kicker="Preguntas frecuentes" kickerValor={C("faq.kicker")}
              title="Resolvemos tus dudas" titleValor={S.faq?.titulo} />
            <div className="space-y-3 mt-12">
              {faqs.map((f: any, i: number) => {
                const isOpen = openFaq === i;
                return (
                  <Reveal key={i} delay={i * 40}>
                    <div style={{ background: "#fff", border: `1px solid ${border}`, borderRadius: 20, boxShadow: isOpen ? softShadow : "none", transition: "box-shadow .3s" }}>
                      <button
                        type="button"
                        onClick={() => setOpenFaq(isOpen ? null : i)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center justify-between gap-4 text-left px-6 py-5"
                      >
                        {/* Se leen las DOS formas: el formulario de siempre
                            guarda {question, answer} y el lienzo normaliza a
                            {q, a}. Antes solo se leía la vieja, así que la
                            primera pregunta que alguien editara desde el
                            lienzo habría desaparecido de la página. */}
                        <Txt as="span" className="font-semibold text-[17px]" style={{ color: ink }}
                          campo={dirFaq(i, "q")}
                          valor={f.q ?? f.question} />
                        <span
                          className="shrink-0 grid place-items-center w-8 h-8 rounded-full transition-transform duration-300"
                          style={{ background: isOpen ? theme : paper, color: isOpen ? "#fff" : ink, transform: isOpen ? "rotate(180deg)" : "none" }}
                        >
                          <ChevronDown size={18} />
                        </span>
                      </button>
                      <div style={{ maxHeight: isOpen ? 320 : 0, overflow: "hidden", transition: "max-height .4s ease" }}>
                        <Txt as="p" className="px-6 pb-5 text-[15px] leading-relaxed" style={{ color: muted }}
                          campo={dirFaq(i, "a")}
                          valor={f.a ?? f.answer} />
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
            <Reveal className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 text-center">
              <Txt as="span" className="text-[15px]" style={{ color: muted }}
                campo={dirCopia("faq.nota")}
                valor={C("faq.nota")} porDefecto="¿Te quedó otra duda? Con gusto te ayudamos." />
              <Pill tk={tk} size="sm" onClick={() => openBooking()}
                campo={dirCopia("faq.cta")} valor={C("faq.cta")} porDefecto="Agendar Cita"
                despues={<ArrowRight size={16} />} />
            </Reveal>
          </div>
        </section>
      )}

      {/* ---------------- CTA FINAL ---------------- */}
      <section className="py-12">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal className="rounded-[36px] px-8 sm:px-16 py-16 text-center relative overflow-hidden" style={{ background: grad }}>
            <div aria-hidden className="absolute -top-20 -right-10 w-72 h-72 rounded-full bg-white/10" />
            <div aria-hidden className="absolute -bottom-24 -left-10 w-80 h-80 rounded-full bg-white/10" />
            <div className="relative">
              <Txt as="h2" className="text-4xl sm:text-5xl font-extrabold text-white leading-tight"
                campo={dirSeccion("reservar", "titulo")}
                valor={S.reservar?.titulo} porDefecto="¿Listo para tu cita?" />
              <Txt as="p" className="mt-4 text-lg text-white/85 max-w-xl mx-auto"
                campo={dirSeccion("reservar", "subtitulo")}
                valor={S.reservar?.subtitulo} porDefecto="Agenda en menos de un minuto. Te confirmamos por WhatsApp." />
              <Txt
                as="button"
                type="button"
                onClick={() => openBooking()}
                className="mt-8 inline-flex items-center gap-2 bg-white px-8 py-4 rounded-full font-bold transition hover:scale-105"
                style={{ color: shade(theme, 0.1) }}
                campo={dirCopia("reservar.cta")}
                valor={C("reservar.cta")} porDefecto="Agendar Cita" sufijo=" " unido
                despues={<ArrowRight size={18} />}
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- CONTACTO ---------------- */}
      <section id="contacto" className="py-20 sm:py-28" style={{ background: paper }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <SectionHead tk={tk} center seccion="contacto" claveKicker="contacto.kicker" editando={editando}
            kicker="Visítanos" kickerValor={C("contacto.kicker")}
            title="Estamos cerca de ti" titleValor={S.contacto?.titulo} />
          <div className="grid lg:grid-cols-2 gap-8 items-stretch mt-12">
            {/* info */}
            <Reveal className="flex flex-col gap-4">
              {clinic.address && (
                <div className="flex items-center gap-4 p-5" style={{ background: "#fff", border: `1px solid ${border}`, borderRadius: 20 }}>
                  <span className="shrink-0 grid place-items-center w-12 h-12 rounded-2xl" style={{ background: alpha(theme, 0.1), color: theme }}><MapPin size={22} /></span>
                  <div>
                    <Txt as="p" className="text-xs uppercase tracking-wider" style={{ color: muted }}
                      campo={dirCopia("contacto.etiquetaDireccion")}
                      valor={C("contacto.etiquetaDireccion")} porDefecto="Dirección" />
                    <p className="font-semibold text-[16px]" style={{ color: ink }}>{clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</p>
                  </div>
                </div>
              )}
              {clinic.phone && (
                <a href={`tel:${clinic.phone}`} className="flex items-center gap-4 p-5 transition hover:-translate-y-0.5" style={{ background: "#fff", border: `1px solid ${border}`, borderRadius: 20 }}>
                  <span className="shrink-0 grid place-items-center w-12 h-12 rounded-2xl" style={{ background: alpha(theme, 0.1), color: theme }}><Phone size={22} /></span>
                  <div>
                    <Txt as="p" className="text-xs uppercase tracking-wider" style={{ color: muted }}
                      campo={dirCopia("contacto.etiquetaTelefono")}
                      valor={C("contacto.etiquetaTelefono")} porDefecto="Teléfono" />
                    <p className="font-semibold text-[16px]" style={{ color: ink }}>{clinic.phone}</p>
                  </div>
                </a>
              )}
              {waLink && (
                <a href={waLink} target="_blank" rel="noreferrer" className="flex items-center gap-4 p-5 transition hover:-translate-y-0.5" style={{ background: "#fff", border: `1px solid ${border}`, borderRadius: 20 }}>
                  <span className="shrink-0 grid place-items-center w-12 h-12 rounded-2xl" style={{ background: alpha(theme, 0.1), color: theme }}><MessageCircle size={22} /></span>
                  <div>
                    <Txt as="p" className="text-xs uppercase tracking-wider" style={{ color: muted }}
                      campo={dirCopia("contacto.etiquetaWhatsapp")}
                      valor={C("contacto.etiquetaWhatsapp")} porDefecto="WhatsApp" />
                    <p className="font-semibold text-[16px]" style={{ color: ink }}>{clinic.landingWhatsapp}</p>
                  </div>
                </a>
              )}

              {/* horarios — sólo si hay al menos un día abierto; los cerrados (p.ej. Domingo) en rojo */}
              {(clinic.schedules ?? []).some((s) => s.enabled) && (
                <div className="p-5" style={{ background: "#fff", border: `1px solid ${border}`, borderRadius: 20 }}>
                  <div className="flex items-center gap-3 mb-3">
                    <Clock size={20} style={{ color: theme }} /><Txt as="span" className="font-semibold" style={{ color: ink }}
                      campo={dirCopia("contacto.etiquetaHorarios")}
                      valor={C("contacto.etiquetaHorarios")} porDefecto="Horarios" />
                  </div>
                  {[0, 1, 2, 3, 4, 5, 6].map((dow) => {
                    const s = schedMap[String(dow)];
                    const closed = !s?.enabled;
                    return (
                      <div key={dow} className="flex justify-between py-1.5 text-[15px]" style={{ color: muted }}>
                        <span>{DAYS_FULL[dow]}</span>
                        {/* Solo el día CERRADO es texto editable: el horario
                            abierto es el dato de la agenda. */}
                        {closed
                          ? <Txt as="span" className="font-medium" style={{ color: CLOSED_RED }}
                              campo={dirCopia("contacto.cerrado")}
                              valor={C("contacto.cerrado")} porDefecto="Cerrado" />
                          : <span className="font-medium" style={{ color: ink }}>
                              {`${s.openTime} – ${s.closeTime}`}
                            </span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* redes + CTA */}
              {(igLink || fbLink || waLink) && (
                <div className="flex items-center gap-3">
                  {igLink && (
                    <a href={igLink} target="_blank" rel="noreferrer" aria-label="Instagram" className="grid place-items-center w-12 h-12 rounded-full transition hover:scale-105" style={{ background: "#fff", border: `1px solid ${border}`, color: theme }}>
                      <Instagram size={20} />
                    </a>
                  )}
                  {fbLink && (
                    <a href={fbLink} target="_blank" rel="noreferrer" aria-label="Facebook" className="grid place-items-center w-12 h-12 rounded-full transition hover:scale-105" style={{ background: "#fff", border: `1px solid ${border}`, color: theme }}>
                      <Facebook size={20} />
                    </a>
                  )}
                  {waLink && (
                    <a href={waLink} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="grid place-items-center w-12 h-12 rounded-full transition hover:scale-105" style={{ background: "#fff", border: `1px solid ${border}`, color: theme }}>
                      <MessageCircle size={20} />
                    </a>
                  )}
                  <Txt as="button" type="button" onClick={() => openBooking()} className="ml-auto px-6 py-3 rounded-full font-semibold text-white transition hover:brightness-110" style={{ background: theme }}
                    campo={dirCopia("contacto.cta")}
                    valor={C("contacto.cta")} porDefecto="Agendar Cita" />
                </div>
              )}
            </Reveal>

            {/* mapa */}
            <Reveal delay={100} className="overflow-hidden min-h-[360px]" style={{ border: `1px solid ${border}`, borderRadius: 20 }}>
              {clinic.landingMapEmbed ? (
                <iframe
                  title="Mapa de la clínica"
                  src={clinic.landingMapEmbed}
                  className="w-full h-full min-h-[360px]"
                  style={{ border: 0, filter: "grayscale(0.2)" }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              ) : (
                <div className="w-full h-full min-h-[360px] grid place-items-center text-center p-10" style={{ background: "#fff" }}>
                  <div>
                    <MapPin size={48} className="mx-auto mb-4" strokeWidth={1} style={{ color: alpha(theme, 0.3) }} />
                    <p className="text-sm" style={{ color: muted }}>{clinic.address ?? "Ubicación próximamente"}</p>
                  </div>
                </div>
              )}
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- FOOTER ---------------- */}
      <footer style={{ background: ink, color: alpha("#ffffff", 0.7) }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              {clinic.logoUrl ? (
                <img src={clinic.logoUrl} alt={clinic.name} className="w-11 h-11 rounded-2xl object-contain bg-white/10" />
              ) : (
                <span className="grid place-items-center w-11 h-11 rounded-2xl font-bold text-white" style={{ background: grad }}>{clinic.name.slice(0, 2).toUpperCase()}</span>
              )}
              <span className="text-white text-lg font-bold">{clinic.name}</span>
            </div>
            {clinic.description && <p className="max-w-sm text-[15px] leading-relaxed opacity-80">{clinic.description}</p>}
            <button type="button" onClick={() => openBooking()} className="mt-6 px-6 py-3 rounded-full font-semibold text-white transition hover:brightness-110" style={{ background: theme }}>
              Agendar Cita
            </button>
          </div>

          <div>
            <p className="text-white font-semibold mb-4">Navegación</p>
            <ul className="space-y-2.5 text-[15px]">
              {navItems.map(([label, id]) => (
                <li key={id}>
                  <a href={"#" + id} onClick={(e) => { e.preventDefault(); scrollToId(id); }} className="opacity-75 hover:opacity-100 transition">{label}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-white font-semibold mb-4">Contacto</p>
            <ul className="space-y-2.5 text-[15px] opacity-80">
              {clinic.address && <li className="flex items-start gap-2"><MapPin size={17} className="mt-0.5 shrink-0" />{clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</li>}
              {clinic.phone && <li className="flex items-center gap-2"><Phone size={17} />{clinic.phone}</li>}
              {clinic.landingWhatsapp && <li className="flex items-center gap-2"><MessageCircle size={17} />{clinic.landingWhatsapp}</li>}
            </ul>
            {(igLink || fbLink || waLink) && (
              <div className="flex gap-3 mt-4">
                {igLink && <a href={igLink} target="_blank" rel="noreferrer" aria-label="Instagram" className="opacity-70 hover:opacity-100 transition"><Instagram size={19} /></a>}
                {fbLink && <a href={fbLink} target="_blank" rel="noreferrer" aria-label="Facebook" className="opacity-70 hover:opacity-100 transition"><Facebook size={19} /></a>}
                {waLink && <a href={waLink} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="opacity-70 hover:opacity-100 transition"><MessageCircle size={19} /></a>}
              </div>
            )}
          </div>
        </div>
        <div className="border-t" style={{ borderColor: alpha("#ffffff", 0.1) }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] opacity-60">
            <span>© {new Date().getFullYear()} {clinic.name}. Todos los derechos reservados.</span>
            <div className="flex items-center gap-5">
              <a href="/privacidad" target="_blank" rel="noreferrer" className="hover:opacity-100 transition">Aviso de privacidad</a>
              <span className="flex items-center gap-1.5">Hecho con <span style={{ color: tint(theme, 0.3), fontWeight: 700 }}>DaleControl</span></span>
            </div>
          </div>
        </div>
      </footer>

      {/* ---------------- BOTÓN FLOTANTE ---------------- */}
      <button
        type="button"
        onClick={() => openBooking()}
        /* El aria-label sigue al texto visible: si la clínica renombra el
           botón, quien usa lector de pantalla oye lo mismo que se ve. */
        aria-label={copyText(copias, "flotante.cta", "Agendar Cita")}
        className="fixed right-4 sm:right-6 z-[90] inline-flex items-center gap-2 font-semibold text-white transition-all duration-500 hover:brightness-110 active:scale-95"
        style={{
          bottom: 24,
          padding: "13px 20px",
          borderRadius: 999,
          background: theme,
          boxShadow: `0 14px 30px -8px ${alpha(theme, 0.6)}`,
          opacity: showFloat ? 1 : 0,
          transform: showFloat ? "translateY(0) scale(1)" : "translateY(24px) scale(.9)",
          pointerEvents: showFloat ? "auto" : "none",
        }}
      >
        <Calendar size={18} />
        <Txt as="span" className="hidden sm:inline"
          campo={dirCopia("flotante.cta")}
          valor={C("flotante.cta")} porDefecto="Agendar Cita" />
      </button>

      {/* ---------------- LIGHTBOX + MODAL REAL ---------------- */}
      <Lightbox images={gallery} lb={lb} />
      <BookingModal
        clinic={clinic}
        theme={theme}
        open={booking.open}
        onClose={closeBooking}
        preselectedService={booking.preselectedService}
        preselectedDoctorId={booking.preselectedDoctorId}
        restore={booking.restore}
      />
    </div>
  );
}
