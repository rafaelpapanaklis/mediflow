"use client";
/* ============================================================
   PLANTILLA "EQUIPO" — la clínica con varios especialistas.
   El argumento es quién te atiende: fotos del equipo, casos
   reales y precios a la vista. Claro, aire, acento sólido.

   Todo el color sale de landingThemeColor. Tipografía: la del
   panel (IBM Plex Sans / Mono, ya cargadas en el layout raíz —
   aquí NO se importa ninguna fuente).

   Cada sección se oculta si no tiene datos: sin galería, sin
   testimonios, con un solo doctor o sin fotos de casos, la
   página sigue viéndose terminada.
   ============================================================ */
import { useState, useEffect } from "react";
import { ChevronRight, Facebook, Instagram, MapPin, MessageCircle, Shield, Sparkles, Users, Zap } from "lucide-react";
import type { TemplateProps } from "../_shared/types";
import { useLiveClinic } from "../_shared/live-preview";
import { Foto, Txt, useEnEdicion } from "../_shared/edit-context";
// landing-address-parts y NO landing-address: este archivo viaja al navegador
// de los pacientes, y el módulo grande arrastra el manifiesto de las ocho
// plantillas (17 KB) sin que la página pública lo necesite para nada.
import { dirClinica, dirCopia, dirFaq, dirSeccion, dirServicio, dirTestimonio } from "@/lib/landing-address-parts";
import { tint, shade, alpha } from "../_shared/landing-utils";
import {
  copyMap, copyValue, faqList, msiPlazos, photoOf, sectionMap, sectionTitle,
  serviceList, showSection, testimonialList, urgentText, weekSchedule,
} from "../_shared/landing-data";
import { BeforeAfter, StarRow } from "../_shared/landing-pieces";
import { BookingModal } from "../_shared/booking-modal";
import { useBookingReopen, type PendingBooking } from "../_shared/booking-session";

export function TemplateEquipo({ clinic: publicada }: TemplateProps) {
  // En /dashboard/landing esto trae lo que la clínica lleva escrito sin
  // guardar; en la página pública devuelve `publicada` tal cual.
  const clinic = useLiveClinic(publicada);
  /* Solo dentro del lienzo del editor. En la página pública es SIEMPRE false,
     así que ninguna sección se pinta distinta para un paciente. */
  const editando = useEnEdicion();
  const acento = clinic.landingThemeColor ?? "#0e7c66";
  const acentoOsc = shade(acento, 0.28);
  const acentoCl = tint(acento, 0.9);
  const acentoCl2 = tint(acento, 0.78);
  const tinta = shade(acento, 0.86);
  const gris = "#5c6b67";
  const linea = "#e3e9e7";
  const fondo2 = tint(acento, 0.965);
  const sombra = "0 1px 2px rgba(19,36,32,.04), 0 8px 28px -12px rgba(19,36,32,.18)";

  /* ---- datos reales ---- */
  const S = sectionMap(clinic);
  /* El texto suelto que reescribio la clinica (kickers, botones, leyendas).
     `C(clave)` devuelve null si no lo toco, y entonces <Txt> pinta el literal
     de siempre: en la pagina publica no se mueve un pixel. */
  const copias = copyMap(clinic);
  const C = (clave: string) => copyValue(copias, clave);
  const servicios = serviceList(clinic);
  const doctores = clinic.users ?? [];
  const testimonios = testimonialList(clinic);
  const faqs = faqList(clinic);
  const galeria = clinic.landingGallery ?? [];
  const horario = weekSchedule(clinic);
  const urgencias = urgentText(clinic);
  const msi = msiPlazos(clinic);
  const wa = clinic.landingWhatsapp ? `https://wa.me/${clinic.landingWhatsapp.replace(/\D/g, "")}` : null;
  const portada = photoOf(clinic, "portada", { cover: true });
  const casoAntes = photoOf(clinic, "caso1_antes");
  const casoDespues = photoOf(clinic, "caso1_despues");
  const tec1 = photoOf(clinic, "tecnologia1");
  const tec2 = photoOf(clinic, "tecnologia2");

  /* ---- reseñas de Google (si la clínica conectó su ficha) ---- */
  const [google, setGoogle] = useState<{ reviews: any[]; rating: number | null; total: number } | null>(null);
  useEffect(() => {
    if (!clinic.googlePlaceId) return;
    fetch(`/api/google-reviews?slug=${clinic.slug}`)
      .then(r => r.json())
      .then(d => { if (d.reviews?.length > 0) setGoogle(d); })
      .catch(() => {});
  }, [clinic.slug, clinic.googlePlaceId]);

  /* ---- reserva ---- */
  const [booking, setBooking] = useState<{ open: boolean; service?: string; doctorId?: string; restore?: PendingBooking | null }>({ open: false });
  const abrir = (opts?: { service?: string; doctorId?: string }) => setBooking({ open: true, ...opts });
  const cerrar = () => setBooking(b => ({ ...b, open: false }));
  useBookingReopen(clinic.slug, pending =>
    setBooking({ open: true, doctorId: pending?.doctorId, service: pending?.service, restore: pending }));

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 10);
    fn();
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  /* ---- qué secciones existen ---- */
  const verServicios = showSection(S, "servicios", servicios.length > 0);
  const verEquipo = showSection(S, "equipo", doctores.length > 0);
  /* Estas tres solo dependen de que HAYA foto, y la foto se sube desde el
     propio lienzo: si se ocultaran por estar vacías, no habría dónde soltarla
     y la clínica no podría estrenarlas nunca. Siguen respetando el
     interruptor de la sección — apagada sigue apagada. */
  const verCasos = showSection(S, "casos", editando || !!(casoAntes && casoDespues));
  const verTec1 = showSection(S, "tecnologia1", editando || !!tec1);
  const verTec2 = showSection(S, "tecnologia2", editando || !!tec2);
  const verOpiniones = showSection(S, "opiniones", testimonios.length > 0 || !!google);
  const verGaleria = showSection(S, "galeria", galeria.length > 0);
  const verFaq = showSection(S, "faq", faqs.length > 0);

  /* ---- credenciales del hero: solo hechos que la clínica capturó ---- */
  const credenciales: { valor: string; etiqueta: string; estrellas?: boolean; clave?: string }[] = [];
  if (google?.rating) credenciales.push({ valor: String(google.rating), etiqueta: `${google.total} reseñas en Google`, estrellas: true });
  if (clinic.landingYearsExperience) credenciales.push({ valor: String(clinic.landingYearsExperience), etiqueta: clinic.city ? `años atendiendo ${clinic.city}` : "años de experiencia" });
  /* La UNICA leyenda del hero que es un literal y no una expresion: las otras
     tres se construyen ("{n} reseñas en Google", "años atendiendo {ciudad}",
     singular/plural de especialista) y por eso no se instrumentan. */
  if (clinic.landingPatients) credenciales.push({ valor: clinic.landingPatients, etiqueta: "pacientes atendidos", clave: "hero.cifraPacientes" });
  if (doctores.length > 0) credenciales.push({ valor: String(doctores.length), etiqueta: doctores.length === 1 ? "especialista" : "especialistas" });

  /* ---- valores: se arman con lo que la clínica configuró, no con copy ---- */
  /* `clave` = la del titulo; `claveTexto` = la del cuerpo, o null cuando el
     cuerpo se CONSTRUYE (los plazos de MSI) o sale de otra columna (el aviso
     de urgencias, que ya se edita como landingUrgentText). */
  const valores: { Icono: any; titulo: string; texto: string; clave: string; claveTexto: string | null }[] = [];
  if (urgencias) valores.push({ Icono: Zap, titulo: "Urgencias", texto: urgencias, clave: "valores.urgencias.titulo", claveTexto: null });
  if (msi.length > 0) valores.push({ Icono: Sparkles, titulo: "Meses sin intereses", texto: `Difiere tu tratamiento a ${msi.join(", ")} meses sin intereses.`, clave: "valores.msi.titulo", claveTexto: null });
  if (servicios.some(s => s.price)) valores.push({ Icono: Shield, titulo: "Precios a la vista", texto: "El costo de cada tratamiento está publicado antes de que agendes.", clave: "valores.precios.titulo", claveTexto: "valores.precios.texto" });
  if (doctores.length > 1) valores.push({ Icono: Users, titulo: "Elige a tu doctor", texto: "Agenda directo con el especialista que prefieras.", clave: "valores.doctor.titulo", claveTexto: "valores.doctor.texto" });

  const nav: { href: string; label: string }[] = [
    ...(verServicios ? [{ href: "#servicios", label: "Servicios" }] : []),
    ...(verEquipo ? [{ href: "#equipo", label: "Equipo" }] : []),
    ...(verCasos ? [{ href: "#casos", label: "Casos" }] : []),
    ...(verOpiniones ? [{ href: "#opiniones", label: "Opiniones" }] : []),
    { href: "#ubicacion", label: "Ubicación" },
  ];

  const btn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    height: 48, padding: "0 22px", borderRadius: 999, fontWeight: 600, fontSize: 15,
    border: "1px solid transparent", cursor: "pointer", textDecoration: "none",
    fontFamily: "inherit", transition: ".18s",
  };
  const btnP: React.CSSProperties = { ...btn, background: acento, color: "#fff" };
  const btnG: React.CSSProperties = { ...btn, background: "#fff", color: tinta, borderColor: linea };
  const btnSm: React.CSSProperties = { height: 40, padding: "0 16px", fontSize: 14 };
  const kicker: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500, letterSpacing: ".14em",
    textTransform: "uppercase", color: acento, display: "block",
  };
  const secT: React.CSSProperties = { fontSize: "clamp(28px,3.4vw,40px)", fontWeight: 600, margin: "10px 0 8px", letterSpacing: "-.02em", lineHeight: 1.15 };
  const secS: React.CSSProperties = { color: gris, maxWidth: "60ch", margin: 0 };
  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ fontFamily: "var(--font-sans)", color: tinta, background: "#fff", fontSize: 16, lineHeight: 1.6 }}>
      <style>{`
        .eq-wrap { max-width:1180px; margin:0 auto; padding:0 20px; }
        .eq-sec { padding:76px 0; }
        .eq-links a:hover { color:${acento}; border-color:${acento}; }
        .eq-srv:hover { box-shadow:${sombra}; transform:translateY(-2px); }
        .eq-acc:hover { transform:translateY(-3px); }
        .eq-doc-f img { transition:.4s; }
        .eq-doc:hover .eq-doc-f img { transform:scale(1.04); }
        .eq-gal a:hover img { transform:scale(1.06); }
        .eq-grid-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }
        .eq-grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:22px; }
        .eq-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:44px; align-items:center; }
        .eq-gal { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
        .eq-gal a:first-child { grid-column:span 2; grid-row:span 2; aspect-ratio:auto; }
        .eq-ubi { display:grid; grid-template-columns:1.3fr 1fr; }
        .eq-ftop { display:grid; grid-template-columns:1.4fr 1fr 1.2fr; gap:38px; }
        .eq-hide-sm { display:inline; }
        @media (max-width:1000px) {
          .eq-grid-4 { grid-template-columns:repeat(2,1fr); }
          .eq-grid-3, .eq-grid-2, .eq-ubi { grid-template-columns:1fr; gap:26px; }
          .eq-links { display:none !important; }
          .eq-ftop { grid-template-columns:1fr 1fr; }
        }
        @media (max-width:640px) {
          .eq-sec { padding:52px 0; }
          .eq-grid-4, .eq-grid-3, .eq-accesos { grid-template-columns:1fr !important; }
          .eq-gal { grid-template-columns:repeat(2,1fr); }
          .eq-gal a:first-child { grid-column:span 2; grid-row:span 1; aspect-ratio:16/10; }
          .eq-ftop { grid-template-columns:1fr; gap:26px; }
          .eq-hide-sm { display:none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .eq-srv:hover, .eq-acc:hover, .eq-doc:hover .eq-doc-f img, .eq-gal a:hover img { transform:none; }
        }
      `}</style>

      {/* ============ BARRA SUPERIOR ============ */}
      <div style={{ background: tinta, color: tint(acento, 0.72), fontSize: 13 }}>
        <div className="eq-wrap" style={{ display: "flex", alignItems: "center", gap: 22, minHeight: 40, flexWrap: "wrap" }}>
          {clinic.phone && <a href={`tel:${clinic.phone}`} style={{ ...mono, textDecoration: "none" }}>📞 {clinic.phone}</a>}
          {clinic.address && <a href="#ubicacion" className="eq-hide-sm" style={{ textDecoration: "none" }}>{clinic.address}</a>}
        </div>
      </div>

      {/* ============ NAV ============ */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,.94)",
        backdropFilter: "blur(10px)", transition: ".2s",
        borderBottom: `1px solid ${scrolled ? linea : "transparent"}`,
        boxShadow: scrolled ? "0 6px 20px -14px rgba(19,36,32,.4)" : "none",
      }}>
        <div className="eq-wrap" style={{ display: "flex", alignItems: "center", gap: 12, height: 76 }}>
          <a href="#" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none", marginRight: "auto", minWidth: 0 }}>
            {clinic.logoUrl
              ? <img src={clinic.logoUrl} alt="" style={{ width: 42, height: 42, borderRadius: 12, objectFit: "contain", flex: "0 0 auto" }} />
              : <span style={{ width: 42, height: 42, borderRadius: 12, background: acento, color: "#fff", display: "grid", placeItems: "center", flex: "0 0 auto", fontWeight: 700, ...mono }}>{clinic.name.charAt(0).toUpperCase()}</span>}
            <span style={{ minWidth: 0 }}>
              <b style={{ display: "block", fontSize: 17, fontWeight: 600, letterSpacing: "-.02em" }}>{clinic.name}</b>
              <span style={{ display: "block", fontSize: 11.5, color: gris }}>
                {clinic.specialty}{clinic.city ? ` · ${clinic.city}` : ""}
              </span>
            </span>
          </a>
          <div className="eq-links" style={{ display: "flex", gap: 26 }}>
            {nav.map(l => (
              <a key={l.href} href={l.href} style={{ textDecoration: "none", fontSize: 14.5, fontWeight: 500, color: shade(acento, 0.55), padding: "6px 0", borderBottom: "2px solid transparent" }}>{l.label}</a>
            ))}
          </div>
          <Txt as="button" type="button" onClick={() => abrir()} style={{ ...btnP, ...btnSm }}
            campo={dirCopia("nav.cta")} linea maxLen={40}
            valor={C("nav.cta")} porDefecto="Agenda tu cita" />
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header style={{ position: "relative", minHeight: 640, display: "flex", alignItems: "flex-end", color: "#fff", overflow: "hidden", background: acentoOsc }}>
        <Foto slot="portada" url={portada} zona="derecha"
          caja={{ position: "absolute", inset: 0 }}>
          {(url) => url ? (
            <div aria-hidden="true" style={{
              position: "absolute", inset: 0,
              background: `url("${url}") center 28%/cover no-repeat`,
            }} />
          ) : null}
        </Foto>
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0,
          background: `linear-gradient(100deg, ${alpha(shade(acento, 0.8), 0.94)} 0%, ${alpha(shade(acento, 0.8), 0.74)} 46%, ${alpha(shade(acento, 0.8), portada ? 0.3 : 0.7)} 100%)`,
        }} />
        <div className="eq-wrap" style={{ position: "relative", paddingTop: 96, paddingBottom: 56 }}>
          <span style={{ ...kicker, color: tint(acento, 0.55) }}>
            {clinic.specialty}{clinic.landingYearsExperience ? ` · desde hace ${clinic.landingYearsExperience} años` : ""}
          </span>
          <Txt as="h1" style={{ fontSize: "clamp(34px,5vw,58px)", fontWeight: 600, maxWidth: "16ch", margin: "14px 0 16px", lineHeight: 1.12, letterSpacing: "-.02em" }}
            campo={dirClinica("landingTagline")} maxLen={300}
            valor={clinic.landingTagline} porDefecto={clinic.name} />
          <Txt as="p" style={{ maxWidth: "52ch", color: tint(acento, 0.78), fontSize: 17, margin: "0 0 28px" }}
            campo={dirClinica("description")} maxLen={5000}
            valor={clinic.description} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {/* El icono va como hermano (`despues`) y el espacio como sufijo
                PEGADO: en la plantilla eran un solo nodo de texto ("Agendar
                cita ") seguido del svg, y partirlo en dos metería una marca
                de hidratación donde antes no había ninguna. */}
            <Txt as="button" type="button" onClick={() => abrir()} style={btnP}
              campo={dirCopia("hero.cta")} linea maxLen={60}
              valor={C("hero.cta")} porDefecto="Agendar cita" sufijo=" " unido
              despues={<ChevronRight size={16} />} />
            {wa && (
              <Txt as="a" href={wa} target="_blank" rel="noopener noreferrer" style={{ ...btn, background: "#25d366", color: "#0b2e1c" }}
                campo={dirCopia("hero.whatsapp")} linea maxLen={60}
                valor={C("hero.whatsapp")} porDefecto="WhatsApp" prefijo=" " unido
                antes={<MessageCircle size={18} />} />
            )}
          </div>
          {credenciales.length > 0 && (
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap", marginTop: 38, paddingTop: 24, borderTop: "1px solid rgba(255,255,255,.18)" }}>
              {credenciales.map(c => (
                <div key={c.etiqueta}>
                  <b style={{ display: "block", fontSize: 22, fontWeight: 600, ...mono }}>
                    {c.valor} {c.estrellas && <StarRow value={Number(c.valor)} color="#fbbf24" size={15} />}
                  </b>
                  <Txt as="span" style={{ fontSize: 13, color: tint(acento, 0.7) }}
                    campo={c.clave ? dirCopia(c.clave) : null} linea maxLen={60}
                    valor={c.clave ? C(c.clave) : null} porDefecto={c.etiqueta} />
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ============ TRES ACCESOS ============ */}
      <div className="eq-wrap">
        <div className="eq-accesos" style={{ display: "grid", gridTemplateColumns: `repeat(${verServicios ? 3 : 2},1fr)`, gap: 14, marginTop: -42, position: "relative", zIndex: 5 }}>
          {verServicios && (
            <a className="eq-acc" href="#servicios" style={{ padding: "26px 24px", borderRadius: 14, textDecoration: "none", boxShadow: sombra, transition: ".18s", display: "block", background: acento, color: "#fff" }}>
              <Txt as="b" style={{ display: "block", fontSize: 18, fontWeight: 600, marginBottom: 5 }}
                campo={dirCopia("accesos.servicios.titulo")} linea maxLen={60}
                valor={C("accesos.servicios.titulo")} porDefecto="Servicios y precios →" />
              <Txt as="span" style={{ fontSize: 14, opacity: .85 }}
                campo={dirCopia("accesos.servicios.texto")} linea maxLen={120}
                valor={C("accesos.servicios.texto")} porDefecto="Costos claros antes de sentarte" />
            </a>
          )}
          <button type="button" onClick={() => abrir()} className="eq-acc" style={{ padding: "26px 24px", borderRadius: 14, boxShadow: sombra, transition: ".18s", display: "block", textAlign: "left", border: 0, cursor: "pointer", background: tinta, color: "#fff", fontFamily: "inherit" }}>
            <Txt as="b" style={{ display: "block", fontSize: 18, fontWeight: 600, marginBottom: 5 }}
              campo={dirCopia("accesos.agenda.titulo")} linea maxLen={60}
              valor={C("accesos.agenda.titulo")} porDefecto="Agenda tu cita →" />
            <Txt as="span" style={{ fontSize: 14, opacity: .85 }}
              campo={dirCopia("accesos.agenda.texto")} linea maxLen={120}
              valor={C("accesos.agenda.texto")} porDefecto="En línea, sin llamar" />
          </button>
          <a className="eq-acc" href={verEquipo ? "#equipo" : "#ubicacion"} style={{ padding: "26px 24px", borderRadius: 14, textDecoration: "none", boxShadow: sombra, transition: ".18s", display: "block", background: acentoCl, color: acentoOsc }}>
            {/* Dos claves y no una: el acceso dice una cosa u otra según haya
                equipo, y con una sola clave editar un estado le cambiaría el
                texto al otro sin que nadie lo pidiera. */}
            <Txt as="b" style={{ display: "block", fontSize: 18, fontWeight: 600, marginBottom: 5 }}
              campo={dirCopia(verEquipo ? "accesos.equipo.titulo" : "accesos.ubicacion.titulo")}
              linea maxLen={60}
              valor={C(verEquipo ? "accesos.equipo.titulo" : "accesos.ubicacion.titulo")}
              porDefecto={verEquipo ? "Conócenos →" : "Cómo llegar →"} />
            <span style={{ fontSize: 14, opacity: .85 }}>
              {verEquipo
                ? `${doctores.length} ${doctores.length === 1 ? "especialista" : "especialistas"}`
                : (clinic.city ?? "Ubicación y horarios")}
            </span>
          </a>
        </div>
      </div>

      {/* ============ VALORES ============ */}
      {valores.length > 0 && (
        <section className="eq-sec">
          <div className="eq-wrap">
            <div className="eq-grid-4" style={{ gap: 26 }}>
              {valores.map(v => (
                <div key={v.titulo} style={{ display: "flex", gap: 14 }}>
                  <span style={{ width: 46, height: 46, borderRadius: 13, background: acentoCl, display: "grid", placeItems: "center", flex: "0 0 auto", color: acento }}>
                    <v.Icono size={22} strokeWidth={1.8} />
                  </span>
                  <div>
                    <Txt as="b" style={{ display: "block", fontSize: 15.5, fontWeight: 600, marginBottom: 3 }}
                      campo={dirCopia(v.clave)} linea maxLen={60}
                      valor={C(v.clave)} porDefecto={v.titulo} />
                    <Txt as="p" style={{ margin: 0, fontSize: 14, color: gris, lineHeight: 1.5 }}
                      campo={v.claveTexto ? dirCopia(v.claveTexto) : null} maxLen={240}
                      valor={v.claveTexto ? C(v.claveTexto) : null} porDefecto={v.texto} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ SERVICIOS ============ */}
      {verServicios && (
        <section className="eq-sec" id="servicios" style={{ background: fondo2 }}>
          <div className="eq-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("servicios.kicker")} linea maxLen={60}
              valor={C("servicios.kicker")} porDefecto="Servicios y precios" />
            <Txt as="h2" style={secT} campo={dirSeccion("servicios", "titulo")} linea maxLen={160}
              valor={S.servicios?.titulo}
              porDefecto="Lo que cuesta, antes de sentarte" />
            <Txt as="p" style={secS} campo={dirSeccion("servicios", "subtitulo")} maxLen={500}
              valor={S.servicios?.subtitulo} />

            <div className="eq-grid-4" style={{ marginTop: 40 }}>
              {servicios.map((s, i) => {
                const relleno = i % 4 === 1;
                const suave = i % 4 === 3;
                const fondo = relleno ? acento : suave ? acentoCl : "#fff";
                const texto = relleno ? "#fff" : tinta;
                const apagado = relleno ? "rgba(255,255,255,.78)" : gris;
                return (
                  <article key={s.name + i} className="eq-srv" style={{
                    border: `1px solid ${relleno ? acento : suave ? acentoCl2 : linea}`, borderRadius: 14,
                    padding: "22px 20px 18px", background: fondo, color: texto,
                    display: "flex", flexDirection: "column", transition: ".18s",
                  }}>
                    <span style={{
                      width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", marginBottom: 16, fontSize: 18,
                      background: relleno ? "rgba(255,255,255,.16)" : acentoCl, color: relleno ? "#fff" : acento,
                    }}>{s.icon || "🦷"}</span>
                    <Txt as="b" style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: "-.01em" }}
                      campo={dirServicio(s.i, "name")} linea requerido maxLen={120}
                      valor={s.name} />
                    <Txt as="p" style={{ fontSize: 13.5, color: apagado, margin: "5px 0 18px", lineHeight: 1.5 }}
                      campo={dirServicio(s.i, "desc")} maxLen={400}
                      valor={s.desc} />
                    <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Txt as="span" style={{ ...mono, fontSize: 19, fontWeight: 600 }}
                        campo={dirServicio(s.i, "price")} linea maxLen={40}
                        valor={s.price} />
                      {s.durationMin && <span style={{ ...mono, fontSize: 12.5, color: apagado }}>{s.durationMin} min</span>}
                      <Txt as="button" type="button" onClick={() => abrir({ service: s.name })} style={{
                        ...btnG, ...btnSm, marginLeft: "auto",
                        ...(relleno ? { background: "rgba(255,255,255,.14)", borderColor: "rgba(255,255,255,.28)", color: "#fff" } : {}),
                      }}
                        campo={dirCopia("servicios.cta")} linea maxLen={40}
                        valor={C("servicios.cta")} porDefecto="Agendar" />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ============ EQUIPO ============ */}
      {verEquipo && (
        <section className="eq-sec" id="equipo">
          <div className="eq-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("equipo.kicker")} linea maxLen={60}
              valor={C("equipo.kicker")} porDefecto="Quién te atiende" />
            <Txt as="h2" style={secT} campo={dirSeccion("equipo", "titulo")} linea maxLen={160}
              valor={S.equipo?.titulo}
              porDefecto={doctores.length > 1 ? "Especialistas, no rotación de pasantes" : "Quién te va a atender"} />
            <Txt as="p" style={secS} campo={dirSeccion("equipo", "subtitulo")} maxLen={500}
              valor={S.equipo?.subtitulo} />

            <div className="eq-grid-3" style={{ marginTop: 40 }}>
              {doctores.map(d => (
                <article key={d.id} className="eq-doc" style={{ borderRadius: 14, overflow: "hidden", background: "#fff", border: `1px solid ${linea}` }}>
                  <div className="eq-doc-f" style={{ aspectRatio: "4/4.4", overflow: "hidden", background: acentoCl, display: "grid", placeItems: "center" }}>
                    {d.avatarUrl
                      ? <img src={d.avatarUrl} alt={`${d.firstName} ${d.lastName}`} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span style={{ fontSize: 54, fontWeight: 600, color: acento, ...mono }}>{d.firstName[0]}{d.lastName[0]}</span>}
                  </div>
                  <div style={{ padding: "18px 20px 20px" }}>
                    <b style={{ fontSize: 17, fontWeight: 600, display: "block" }}>Dr/a. {d.firstName} {d.lastName}</b>
                    {d.specialty && <div style={{ color: acento, fontSize: 13.5, fontWeight: 500, margin: "2px 0 8px" }}>{d.specialty}</div>}
                    {d.services.length > 0 && (
                      <span style={{ ...mono, fontSize: 12, color: gris, display: "block", marginBottom: 14 }}>{d.services.slice(0, 3).join(" · ")}</span>
                    )}
                    <button type="button" onClick={() => abrir({ doctorId: d.id })} style={{ ...btnG, ...btnSm }}>Agendar con {d.firstName}</button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ CASOS (antes / después) ============ */}
      {verCasos && (
        <section className="eq-sec" id="casos" style={{ background: fondo2 }}>
          <div className="eq-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("casos.kicker")} linea maxLen={60}
              valor={C("casos.kicker")} porDefecto="Casos reales" />
            <Txt as="h2" style={secT} campo={dirSeccion("casos", "titulo")} linea maxLen={160}
              valor={S.casos?.titulo}
              porDefecto="Arrastra y mira la diferencia" />
            <div className="eq-grid-2" style={{ marginTop: 34 }}>
              {/* Dos ranuras en un mismo hueco: la caja la pone la de "antes" y
                  la de "después" cuelga su botonera de esa misma caja. */}
              <Foto slot="caso1_antes" url={casoAntes} zona="izquierda"
                caja={{ position: "relative" }} vacio={{ aspectRatio: "4/3" }}>
                {(antes) => (
                  <Foto slot="caso1_despues" url={casoDespues} zona="derecha">
                    {(despues) => <BeforeAfter antes={antes} despues={despues} accent={acento} />}
                  </Foto>
                )}
              </Foto>
              <div>
                <Txt as="p" style={{ color: gris, margin: "10px 0 0", fontSize: 16 }}
                  campo={dirSeccion("casos", "subtitulo")} maxLen={600}
                  valor={S.casos?.subtitulo} />
                <Txt as="button" type="button" onClick={() => abrir()} style={{ ...btnP, marginTop: 22 }}
                  campo={dirCopia("casos.cta")} linea maxLen={60}
                  valor={C("casos.cta")} porDefecto="Quiero mi valoración" />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============ TECNOLOGÍA ============ */}
      {(verTec1 || verTec2) && (
        <section className="eq-sec" id="tecnologia">
          <div className="eq-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("tecnologia.kicker")} linea maxLen={60}
              valor={C("tecnologia.kicker")} porDefecto="Tecnología" />
            <Txt as="h2" style={secT} campo={dirSeccion("tecnologia", "titulo")} linea maxLen={160}
              valor={S.tecnologia?.titulo}
              porDefecto="Lo que hay detrás del sillón" />

            {[{ ver: verTec1, foto: tec1, id: "tecnologia1", nombre: "Tecnología 1" }, { ver: verTec2, foto: tec2, id: "tecnologia2", nombre: "Tecnología 2" }]
              .filter(t => t.ver)
              .map((t, i) => (
                <div key={t.id} className="eq-grid-2" style={{ marginTop: 38 }}>
                  <div style={{ order: i % 2 === 1 ? 2 : 0 }}>
                    <Txt as="div" style={{ ...mono, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: acento, marginBottom: 8 }}
                      campo={dirSeccion(t.id, "titulo")} linea maxLen={120}
                      valor={S[t.id]?.titulo}
                      porDefecto="Equipo del consultorio" />
                    <Txt as="p" style={{ color: gris, margin: "0 0 18px" }}
                      campo={dirSeccion(t.id, "subtitulo")} maxLen={500}
                      valor={S[t.id]?.subtitulo} />
                    <Txt as="button" type="button" onClick={() => abrir()} style={btnG}
                      campo={dirCopia("tecnologia.cta")} linea maxLen={60}
                      valor={C("tecnologia.cta")} porDefecto="Agendar cita" />
                  </div>
                  <Foto slot={t.id} url={t.foto} etiqueta={t.nombre}
                    caja={{ position: "relative" }} vacio={{ aspectRatio: "16/11" }}>
                    {(url) => url ? (
                      <div style={{ borderRadius: 14, overflow: "hidden", aspectRatio: "16/11", boxShadow: sombra }}>
                        <img src={url} alt={sectionTitle(S, t.id, "Equipo del consultorio")} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ) : null}
                  </Foto>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ============ OPINIONES ============ */}
      {verOpiniones && (
        <section className="eq-sec" id="opiniones" style={{ background: fondo2 }}>
          <div className="eq-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("opiniones.kicker")} linea maxLen={60}
              valor={C("opiniones.kicker")} porDefecto="Opiniones" />
            <Txt as="h2" style={secT} campo={dirSeccion("opiniones", "titulo")} linea maxLen={160}
              valor={S.opiniones?.titulo}
              porDefecto={google ? "Lo que dicen en Google" : "Lo que dicen nuestros pacientes"} />

            {google?.rating && (
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", margin: "26px 0 34px" }}>
                <span style={{ ...mono, fontSize: 52, fontWeight: 600, lineHeight: 1 }}>{google.rating}</span>
                <div>
                  <StarRow value={google.rating} color="#fbbf24" size={20} />
                  <div style={{ fontSize: 14, color: gris }}>{google.total} reseñas verificadas en Google</div>
                </div>
              </div>
            )}

            <div className="eq-grid-3" style={{ gap: 18, marginTop: google?.rating ? 0 : 34 }}>
              {/* `dir` es null en las reseñas de Google: son de Google, no de la
                  clínica, y no hay dónde guardarlas si alguien las reescribe. */}
              {(testimonios.length > 0
                ? testimonios.map(t => ({ text: t.text, name: t.name, rating: t.rating, meta: t.meta, dir: t.i }))
                : (google?.reviews ?? []).slice(0, 3).map((r: any) => ({ text: r.text, name: r.author_name ?? "Paciente", rating: r.rating ?? 5, meta: r.relative_time_description ?? null, dir: null }))
              ).slice(0, 6).map((t, i) => (
                <article key={i} style={{ background: "#fff", border: `1px solid ${linea}`, borderRadius: 14, padding: 22 }}>
                  <StarRow value={t.rating} color="#fbbf24" />
                  <Txt as="p" style={{ margin: "10px 0 16px", fontSize: 15, color: shade(acento, 0.55) }}
                    campo={t.dir === null ? null : dirTestimonio(t.dir, "text")}
                    requerido maxLen={800}
                    valor={t.text} prefijo="“" sufijo="”" />
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <span style={{ width: 38, height: 38, borderRadius: "50%", background: acentoCl, color: acentoOsc, display: "grid", placeItems: "center", fontWeight: 600, fontSize: 14 }}>
                      {t.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
                    </span>
                    <div>
                      <Txt as="b" style={{ fontSize: 14.5, fontWeight: 600, display: "block" }}
                        campo={t.dir === null ? null : dirTestimonio(t.dir, "name")}
                        linea maxLen={80} valor={t.name} />
                      <Txt as="span" style={{ fontSize: 12.5, color: gris }}
                        campo={t.dir === null ? null : dirTestimonio(t.dir, "meta")}
                        linea maxLen={80} valor={t.meta} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ GALERÍA ============ */}
      {verGaleria && (
        <section className="eq-sec" id="galeria">
          <div className="eq-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("galeria.kicker")} linea maxLen={60}
              valor={C("galeria.kicker")} porDefecto="La clínica" />
            <Txt as="h2" style={secT} campo={dirSeccion("galeria", "titulo")} linea maxLen={160}
              valor={S.galeria?.titulo}
              porDefecto="Así se ve por dentro" />
            <div className="eq-gal" style={{ marginTop: 34 }}>
              {galeria.slice(0, 5).map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noopener noreferrer" style={{ borderRadius: 12, overflow: "hidden", aspectRatio: "1", display: "block" }}>
                  <img src={src} alt={`${clinic.name} — foto ${i + 1}`} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", transition: ".35s" }} />
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ FAQ ============ */}
      {verFaq && (
        <section className="eq-sec" style={{ background: fondo2 }}>
          <div className="eq-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("faq.kicker")} linea maxLen={60}
              valor={C("faq.kicker")} porDefecto="Preguntas frecuentes" />
            <Txt as="h2" style={secT} campo={dirSeccion("faq", "titulo")} linea maxLen={160}
              valor={S.faq?.titulo}
              porDefecto="Lo que todos preguntan antes de venir" />
            <div style={{ maxWidth: 820, margin: "34px auto 0" }}>
              {faqs.map((f, i) => (
                <details key={i} open={i === 0} style={{ borderBottom: `1px solid ${linea}` }}>
                  <Txt as="summary" style={{ cursor: "pointer", padding: "18px 0", fontWeight: 600, fontSize: 16.5, listStyle: "none" }}
                    campo={dirFaq(f.i, "q")} linea requerido maxLen={200}
                    valor={f.q} />
                  <Txt as="p" style={{ margin: "0 0 20px", color: gris }}
                    campo={dirFaq(f.i, "a")} requerido maxLen={1200}
                    valor={f.a} />
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ UBICACIÓN ============ */}
      <section className="eq-sec" id="ubicacion">
        <div className="eq-wrap">
          <Txt as="span" style={kicker} campo={dirCopia("contacto.kicker")} linea maxLen={60}
              valor={C("contacto.kicker")} porDefecto="Ubicación y horarios" />
          <Txt as="h2" style={secT} campo={dirSeccion("contacto", "titulo")} linea maxLen={160}
            valor={S.contacto?.titulo}
            porDefecto="Dónde estamos" />
          <div className="eq-ubi" style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${linea}`, marginTop: 34 }}>
            {clinic.landingMapEmbed
              ? <iframe src={clinic.landingMapEmbed} loading="lazy" title={`Mapa de ${clinic.name}`} style={{ width: "100%", height: "100%", minHeight: 420, border: 0, display: "block", filter: "grayscale(.15)" }} />
              : <div style={{ minHeight: 260, background: acentoCl, display: "grid", placeItems: "center", color: acentoOsc }}><MapPin size={40} strokeWidth={1.5} /></div>}
            <div style={{ padding: "34px 32px", background: "#fff" }}>
              <Txt as="h3" style={{ fontSize: 19, fontWeight: 600, marginBottom: 14 }}
                campo={dirCopia("contacto.etiquetaHorarios")} linea maxLen={60}
                valor={C("contacto.etiquetaHorarios")} porDefecto="Horarios" />
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 22px" }}>
                {horario.map(d => (
                  <li key={d.label} style={{
                    display: "flex", justifyContent: "space-between", gap: 16, padding: "9px 0",
                    borderBottom: `1px solid ${linea}`, fontSize: 14.5,
                    color: d.open ? (d.hoy ? acento : tinta) : gris, fontWeight: d.hoy ? 600 : 400,
                  }}>
                    <span>{d.label}{d.hoy ? " · hoy" : ""}</span>
                    {/* Solo el dia CERRADO es texto editable: el horario abierto
                        es el dato de la agenda. */}
                    {d.open
                      ? <time style={{ ...mono, fontSize: 13.5 }}>{d.open}</time>
                      : <Txt as="time" style={{ ...mono, fontSize: 13.5 }}
                          campo={dirCopia("contacto.cerrado")} linea maxLen={40}
                          valor={C("contacto.cerrado")} porDefecto="Cerrado" />}
                  </li>
                ))}
              </ul>
              {clinic.address && <p style={{ fontSize: 14.5, color: gris, margin: "0 0 6px" }}>{clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</p>}
              {clinic.phone && <p style={{ fontSize: 14.5, margin: "0 0 20px" }}><a href={`tel:${clinic.phone}`} style={{ ...mono, color: acento, textDecoration: "none", fontWeight: 600 }}>{clinic.phone}</a></p>}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {clinic.address && (
                  <Txt as="a" style={{ ...btnP, ...btnSm }} href={`https://maps.google.com/?q=${encodeURIComponent(`${clinic.address} ${clinic.city ?? ""}`)}`} target="_blank" rel="noopener noreferrer"
                    campo={dirCopia("contacto.comoLlegar")} linea maxLen={60}
                    valor={C("contacto.comoLlegar")} porDefecto="Cómo llegar" />
                )}
                <Txt as="button" type="button" onClick={() => abrir()} style={{ ...btnG, ...btnSm }}
                  campo={dirCopia("contacto.cta")} linea maxLen={60}
                  valor={C("contacto.cta")} porDefecto="Agendar cita" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer style={{ background: acentoOsc, color: tint(acento, 0.72) }}>
        <div className="eq-wrap">
          <div className="eq-ftop" style={{ padding: "60px 0 44px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
                {clinic.logoUrl
                  ? <img src={clinic.logoUrl} alt="" style={{ width: 42, height: 42, borderRadius: 12, objectFit: "contain" }} />
                  : <span style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(255,255,255,.16)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, ...mono }}>{clinic.name.charAt(0).toUpperCase()}</span>}
                <b style={{ color: "#fff", fontSize: 17 }}>{clinic.name}</b>
              </div>
              {clinic.description && <p style={{ fontSize: 14.5, maxWidth: "34ch", margin: 0 }}>{clinic.description}</p>}
              {msi.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                  <span style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 7, padding: "6px 11px", ...mono, fontSize: 11.5 }}>
                    MSI {msi.join("/")}
                  </span>
                </div>
              )}
            </div>
            {verServicios && (
              <div>
                <h4 style={{ color: "#fff", fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", ...mono, fontWeight: 500, margin: "0 0 16px" }}>Servicios</h4>
                {servicios.slice(0, 5).map(s => (
                  <a key={s.name} href="#servicios" style={{ textDecoration: "none", fontSize: 14.5, display: "block", padding: "5px 0" }}>{s.name}</a>
                ))}
              </div>
            )}
            <div>
              <h4 style={{ color: "#fff", fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", ...mono, fontWeight: 500, margin: "0 0 16px" }}>Contacto</h4>
              {clinic.phone && <a href={`tel:${clinic.phone}`} style={{ ...mono, textDecoration: "none", fontSize: 14.5, display: "block", padding: "5px 0" }}>{clinic.phone}</a>}
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", fontSize: 14.5, display: "block", padding: "5px 0" }}>WhatsApp</a>}
              {clinic.email && <a href={`mailto:${clinic.email}`} style={{ textDecoration: "none", fontSize: 14.5, display: "block", padding: "5px 0" }}>{clinic.email}</a>}
              {clinic.landingInstagram && <a href={clinic.landingInstagram} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", fontSize: 14.5, display: "flex", alignItems: "center", gap: 6, padding: "5px 0" }}><Instagram size={14} /> Instagram</a>}
              {clinic.landingFacebook && <a href={clinic.landingFacebook} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", fontSize: 14.5, display: "flex", alignItems: "center", gap: 6, padding: "5px 0" }}><Facebook size={14} /> Facebook</a>}
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,.14)", padding: "18px 0", display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
            <span>© {new Date().getFullYear()} {clinic.name}</span>
            <span>Hecho con <a href="/" style={{ color: "#fff", fontWeight: 700, textDecoration: "none" }}>DaleControl</a></span>
          </div>
        </div>
      </footer>

      {/* ============ WHATSAPP FLOTANTE ============ */}
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp"
          style={{ position: "fixed", right: 20, bottom: 20, zIndex: 60, width: 58, height: 58, borderRadius: "50%", background: "#25d366", display: "grid", placeItems: "center", boxShadow: "0 10px 26px -6px rgba(37,211,102,.6)", textDecoration: "none", color: "#0b2e1c" }}>
          <MessageCircle size={28} />
        </a>
      )}

      <BookingModal
        clinic={clinic}
        theme={acento}
        open={booking.open}
        onClose={cerrar}
        preselectedDoctorId={booking.doctorId}
        preselectedService={booking.service}
        restore={booking.restore}
      />
    </div>
  );
}
