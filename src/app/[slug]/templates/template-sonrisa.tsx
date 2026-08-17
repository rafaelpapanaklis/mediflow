"use client";
/* ============================================================
   PLANTILLA "SONRISA" — estética dental.
   La transformación manda: antes/después a lo grande, fotos
   enormes, tipografía grande, esquinas casi rectas y mucho
   blanco. Menos secciones que "Equipo", cada una más grande.

   Color: todo derivado de landingThemeColor. Fuentes: las del
   panel (IBM Plex), ya cargadas en el layout raíz.
   ============================================================ */
import { useState, useEffect } from "react";
import { Facebook, Instagram, MessageCircle } from "lucide-react";
import type { TemplateProps } from "../_shared/types";
import { useLiveClinic } from "../_shared/live-preview";
import { tint, shade } from "../_shared/landing-utils";
import {
  faqList, msiPlazos, photoOf, sectionMap, sectionSubtitle, sectionTitle,
  serviceList, showSection, testimonialList, weekSchedule,
} from "../_shared/landing-data";
import { BeforeAfter, MsiSimulator, StarRow, priceToNumber } from "../_shared/landing-pieces";
import { BookingModal } from "../_shared/booking-modal";
import { useBookingReopen, type PendingBooking } from "../_shared/booking-session";

export function TemplateSonrisa({ clinic: publicada }: TemplateProps) {
  // En /dashboard/landing esto trae lo que la clínica lleva escrito sin
  // guardar; en la página pública devuelve `publicada` tal cual.
  const clinic = useLiveClinic(publicada);
  const acento = clinic.landingThemeColor ?? "#b4574d";
  const acentoOsc = shade(acento, 0.25);
  const acentoCl = tint(acento, 0.92);
  const nude = tint(acento, 0.94);
  const tinta = shade(acento, 0.84);
  const gris = "#6c605c";
  const linea = tint(acento, 0.86);

  /* ---- datos reales ---- */
  const S = sectionMap(clinic);
  const servicios = serviceList(clinic);
  const doctores = clinic.users ?? [];
  const testimonios = testimonialList(clinic);
  const faqs = faqList(clinic);
  const galeria = clinic.landingGallery ?? [];
  const horario = weekSchedule(clinic);
  const msi = msiPlazos(clinic);
  const wa = clinic.landingWhatsapp ? `https://wa.me/${clinic.landingWhatsapp.replace(/\D/g, "")}` : null;
  const portada = photoOf(clinic, "portada", { cover: true });
  const casoAntes = photoOf(clinic, "caso1_antes");
  const casoDespues = photoOf(clinic, "caso1_despues");
  const fotoDoctor = photoOf(clinic, "doctor") ?? doctores[0]?.avatarUrl ?? null;

  const [google, setGoogle] = useState<{ reviews: any[]; rating: number | null; total: number } | null>(null);
  useEffect(() => {
    if (!clinic.googlePlaceId) return;
    fetch(`/api/google-reviews?slug=${clinic.slug}`)
      .then(r => r.json())
      .then(d => { if (d.reviews?.length > 0) setGoogle(d); })
      .catch(() => {});
  }, [clinic.slug, clinic.googlePlaceId]);

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

  /* ---- secciones ---- */
  const verCasos = showSection(S, "casos", !!(casoAntes && casoDespues));
  const verTratamientos = showSection(S, "servicios", servicios.length > 0);
  const verSonrisas = showSection(S, "galeria", galeria.length > 0);
  const verDoctor = showSection(S, "equipo", doctores.length > 0);
  const verOpiniones = showSection(S, "opiniones", testimonios.length > 0 || !!google);
  const verPagos = showSection(S, "pagos", msi.length > 0 && servicios.some(s => priceToNumber(s.price)));
  const verFaq = showSection(S, "faq", faqs.length > 0);

  /* ---- la tira de cifras solo trae lo que la clínica capturó ---- */
  const cifras: { valor: string; etiqueta: string }[] = [];
  if (clinic.landingYearsExperience) cifras.push({ valor: String(clinic.landingYearsExperience), etiqueta: "años de experiencia" });
  if (clinic.landingPatients) cifras.push({ valor: clinic.landingPatients, etiqueta: "pacientes atendidos" });
  if (msi.length > 0) cifras.push({ valor: String(Math.max(...msi)), etiqueta: "meses sin intereses" });
  if (google?.total) cifras.push({ valor: String(google.total), etiqueta: "reseñas en Google" });

  const opcionesMsi = servicios
    .map(s => ({ label: s.name, monto: priceToNumber(s.price) }))
    .filter((o): o is { label: string; monto: number } => o.monto !== null);

  const nav: { href: string; label: string }[] = [
    ...(verCasos ? [{ href: "#transformacion", label: "Antes y después" }] : []),
    ...(verTratamientos ? [{ href: "#tratamientos", label: "Tratamientos" }] : []),
    ...(verSonrisas ? [{ href: "#sonrisas", label: "Sonrisas" }] : []),
    ...(verDoctor ? [{ href: "#equipo", label: "Quién te atiende" }] : []),
    ...(verPagos ? [{ href: "#pagos", label: "Pagos" }] : []),
  ];

  const btn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
    height: 54, padding: "0 30px", borderRadius: 4, fontWeight: 500, fontSize: 15,
    letterSpacing: ".01em", border: "1px solid transparent", cursor: "pointer",
    textDecoration: "none", fontFamily: "inherit", transition: ".2s",
  };
  const btnP: React.CSSProperties = { ...btn, background: tinta, color: "#fff" };
  const btnO: React.CSSProperties = { ...btn, background: "transparent", color: tinta, borderColor: tinta };
  const btnSm: React.CSSProperties = { height: 44, padding: "0 20px", fontSize: 14 };
  const eyebrow: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase",
    color: acento, display: "block", marginBottom: 18,
  };
  const h2: React.CSSProperties = { fontSize: "clamp(32px,4.4vw,54px)", fontWeight: 600, letterSpacing: "-.035em", lineHeight: 1.08, margin: 0 };
  const lead: React.CSSProperties = { fontSize: 18, color: gris, maxWidth: "56ch" };
  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ fontFamily: "var(--font-sans)", color: tinta, background: "#fff", fontSize: 16.5, lineHeight: 1.65 }}>
      <style>{`
        .so-wrap { max-width:1240px; margin:0 auto; padding:0 26px; }
        .so-sec { padding:100px 0; }
        .so-links a:hover { color:${acento}; }
        .so-hero { display:grid; grid-template-columns:1fr 1fr; min-height:min(88vh,780px); align-items:center; }
        .so-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:26px; }
        .so-2 { display:grid; grid-template-columns:1fr 1fr; gap:60px; align-items:center; }
        .so-doc { display:grid; grid-template-columns:.9fr 1.1fr; gap:64px; align-items:center; }
        .so-gal { display:grid; grid-template-columns:repeat(4,1fr); grid-auto-rows:220px; gap:14px; }
        .so-gal a { overflow:hidden; display:block; }
        .so-gal a:hover img { transform:scale(1.06); }
        .so-alta { grid-row:span 2; }
        .so-ancha { grid-column:span 2; }
        .so-tr img { transition:.5s; }
        .so-tr:hover img { transform:scale(1.05); }
        .so-ba { max-width:980px; margin:44px auto 0; box-shadow:0 40px 90px -40px rgba(35,27,25,.5); }
        .so-ftop { display:grid; grid-template-columns:1.5fr 1fr 1fr; gap:40px; }
        @media (max-width:1000px) {
          .so-hero, .so-doc, .so-2 { grid-template-columns:1fr; gap:34px; }
          .so-3, .so-ftop { grid-template-columns:1fr 1fr; }
          .so-links { display:none !important; }
          .so-gal { grid-template-columns:repeat(2,1fr); grid-auto-rows:180px; }
        }
        @media (max-width:620px) {
          .so-sec { padding:60px 0; }
          .so-3, .so-ftop { grid-template-columns:1fr; }
        }
        @media (prefers-reduced-motion: reduce) {
          .so-tr:hover img, .so-gal a:hover img { transform:none; }
        }
      `}</style>

      {/* ============ NAV ============ */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,.92)",
        backdropFilter: "blur(12px)", transition: ".25s",
        boxShadow: scrolled ? `0 1px 0 ${linea}` : "none",
      }}>
        <div className="so-wrap" style={{ display: "flex", alignItems: "center", gap: 34, height: 88 }}>
          <a href="#" style={{ marginRight: "auto", textDecoration: "none", display: "flex", alignItems: "baseline", gap: 9, minWidth: 0 }}>
            <b style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.03em" }}>{clinic.name}</b>
            <i style={{ fontStyle: "normal", ...mono, fontSize: 10.5, letterSpacing: ".18em", textTransform: "uppercase", color: gris }}>{clinic.specialty}</i>
          </a>
          <div className="so-links" style={{ display: "flex", gap: 30 }}>
            {nav.map(l => <a key={l.href} href={l.href} style={{ textDecoration: "none", fontSize: 14.5, color: gris }}>{l.label}</a>)}
          </div>
          <button type="button" onClick={() => abrir()} style={{ ...btnP, ...btnSm }}>Agenda tu valoración</button>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header className="so-hero">
        <div style={{ padding: "60px 60px 60px max(26px, calc((100vw - 1240px)/2 + 26px))" }}>
          <span style={eyebrow}>{clinic.specialty}{clinic.city ? ` · ${clinic.city}` : ""}</span>
          <h1 style={{ fontSize: "clamp(42px,5.6vw,74px)", fontWeight: 600, letterSpacing: "-.035em", lineHeight: 1.06, margin: 0 }}>
            {clinic.landingTagline || clinic.name}
          </h1>
          {clinic.description && (
            <p style={{ fontSize: 19, color: gris, maxWidth: "44ch", margin: "26px 0 34px" }}>{clinic.description}</p>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" onClick={() => abrir()} style={btnP}>Agenda tu valoración</button>
            {verCasos && <a href="#transformacion" style={btnO}>Ver transformaciones</a>}
          </div>
        </div>
        <div style={{ position: "relative", height: "100%", minHeight: 520, background: nude }}>
          {portada && <img src={portada} alt={clinic.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          {google?.rating && (
            <div style={{ position: "absolute", right: 20, bottom: 20, background: "#fff", padding: "20px 26px", boxShadow: "0 20px 50px -20px rgba(35,27,25,.3)", maxWidth: 270 }}>
              <b style={{ display: "block", ...mono, fontSize: 30, fontWeight: 600, letterSpacing: "-.02em" }}>
                {google.rating} <StarRow value={google.rating} color="#d4a017" size={15} />
              </b>
              <span style={{ fontSize: 13.5, color: gris, lineHeight: 1.45, display: "block", marginTop: 3 }}>
                {google.total} reseñas en Google
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ============ TIRA DE CIFRAS ============ */}
      {cifras.length > 0 && (
        <div style={{ background: tinta, color: tint(acento, 0.75), padding: "22px 0" }}>
          <div className="so-wrap" style={{ display: "flex", gap: 40, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            {cifras.map(c => (
              <div key={c.etiqueta} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 14 }}>
                <b style={{ ...mono, fontSize: 22, fontWeight: 600, color: "#fff" }}>{c.valor}</b>
                <span>{c.etiqueta}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ ANTES / DESPUÉS ============ */}
      {verCasos && (
        <section id="transformacion" style={{ background: nude, padding: "100px 0" }}>
          <div className="so-wrap" style={{ textAlign: "center" }}>
            <span style={eyebrow}>Casos reales</span>
            <h2 style={h2}>{sectionTitle(S, "casos", "Arrastra para ver el cambio")}</h2>
            <BeforeAfter
              antes={casoAntes} despues={casoDespues} accent={acento}
              radius={0} aspect="16/10"
              className="so-ba"
            />
            {sectionSubtitle(S, "casos") && (
              <p style={{ ...lead, margin: "28px auto 0", textAlign: "center" }}>{sectionSubtitle(S, "casos")}</p>
            )}
          </div>
        </section>
      )}

      {/* ============ TRATAMIENTOS ============ */}
      {verTratamientos && (
        <section className="so-sec" id="tratamientos">
          <div className="so-wrap">
            <span style={eyebrow}>Tratamientos</span>
            <h2 style={h2}>{sectionTitle(S, "servicios", "Lo que hacemos y lo que cuesta")}</h2>
            {sectionSubtitle(S, "servicios") && <p style={{ ...lead, marginTop: 16 }}>{sectionSubtitle(S, "servicios")}</p>}
            <div className="so-3" style={{ marginTop: 52 }}>
              {servicios.map((s, i) => {
                const foto = photoOf(clinic, `servicio${i + 1}`, { galleryIndex: i });
                return (
                  <article key={s.name + i} className="so-tr" style={{ position: "relative", overflow: "hidden", background: nude }}>
                    {foto && (
                      <div style={{ aspectRatio: "4/5", overflow: "hidden" }}>
                        <img src={foto} alt={s.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    )}
                    <div style={{ padding: "24px 24px 26px" }}>
                      <h3 style={{ fontSize: 22, marginBottom: 6, fontWeight: 600, letterSpacing: "-.03em" }}>{s.name}</h3>
                      {s.desc && <p style={{ margin: "0 0 16px", color: gris, fontSize: 14.5 }}>{s.desc}</p>}
                      <div style={{ display: "flex", alignItems: "baseline", gap: 12, borderTop: `1px solid ${linea}`, paddingTop: 15, flexWrap: "wrap" }}>
                        {s.price && <span style={{ ...mono, fontSize: 21, fontWeight: 600 }}>{s.price}</span>}
                        {s.durationMin && <span style={{ ...mono, fontSize: 12.5, color: gris }}>{s.durationMin} min</span>}
                        <button type="button" onClick={() => abrir({ service: s.name })} style={{ ...btnO, ...btnSm, marginLeft: "auto" }}>Agendar</button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ============ GALERÍA DE SONRISAS ============ */}
      {verSonrisas && (
        <section className="so-sec" id="sonrisas" style={{ paddingTop: verTratamientos ? 0 : undefined }}>
          <div className="so-wrap">
            <span style={eyebrow}>Nuestras sonrisas</span>
            <h2 style={h2}>{sectionTitle(S, "galeria", "Así quedan nuestros pacientes")}</h2>
            <div className="so-gal" style={{ marginTop: 48 }}>
              {galeria.slice(0, 5).map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noopener noreferrer"
                  className={i === 0 ? "so-alta so-ancha" : i === 2 ? "so-alta" : i === 4 ? "so-ancha" : ""}>
                  <img src={src} alt={`${clinic.name} — sonrisa ${i + 1}`} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ QUIÉN TE ATIENDE ============ */}
      {verDoctor && (
        <section className="so-sec" id="equipo" style={{ background: nude }}>
          <div className="so-wrap">
            {doctores.length === 1 ? (
              <div className="so-doc">
                <div style={{ aspectRatio: "4/5", overflow: "hidden", background: acentoCl, display: "grid", placeItems: "center" }}>
                  {fotoDoctor
                    ? <img src={fotoDoctor} alt={`${doctores[0].firstName} ${doctores[0].lastName}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 72, fontWeight: 600, color: acento, ...mono }}>{doctores[0].firstName[0]}{doctores[0].lastName[0]}</span>}
                </div>
                <div>
                  <span style={eyebrow}>Quién te atiende</span>
                  <h2 style={{ ...h2, fontSize: "clamp(28px,3.4vw,42px)" }}>Dr/a. {doctores[0].firstName} {doctores[0].lastName}</h2>
                  {doctores[0].specialty && <p style={{ ...lead, marginTop: 16 }}>{doctores[0].specialty}</p>}
                  {doctores[0].services.length > 0 && (
                    <ul style={{ listStyle: "none", padding: 0, margin: "26px 0 30px" }}>
                      {doctores[0].services.slice(0, 5).map(s => (
                        <li key={s} style={{ padding: "12px 0", borderBottom: `1px solid ${linea}`, display: "flex", gap: 16, fontSize: 15 }}>
                          <b style={{ ...mono, fontSize: 12.5, letterSpacing: ".1em", textTransform: "uppercase", color: acento, minWidth: 120, flex: "0 0 auto" }}>Atiende</b>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" onClick={() => abrir({ doctorId: doctores[0].id })} style={{ ...btnP, marginTop: 20 }}>Agenda con {doctores[0].firstName}</button>
                </div>
              </div>
            ) : (
              <>
                <span style={eyebrow}>Quién te atiende</span>
                <h2 style={h2}>{sectionTitle(S, "equipo", "El equipo")}</h2>
                <div className="so-3" style={{ marginTop: 48 }}>
                  {doctores.map(d => (
                    <article key={d.id}>
                      <div style={{ aspectRatio: "4/5", overflow: "hidden", background: acentoCl, display: "grid", placeItems: "center" }}>
                        {d.avatarUrl
                          ? <img src={d.avatarUrl} alt={`${d.firstName} ${d.lastName}`} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : <span style={{ fontSize: 54, fontWeight: 600, color: acento, ...mono }}>{d.firstName[0]}{d.lastName[0]}</span>}
                      </div>
                      <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.03em", margin: "18px 0 4px" }}>Dr/a. {d.firstName} {d.lastName}</h3>
                      {d.specialty && <div style={{ color: acento, fontSize: 14.5 }}>{d.specialty}</div>}
                      <button type="button" onClick={() => abrir({ doctorId: d.id })} style={{ ...btnO, ...btnSm, marginTop: 16 }}>Agendar</button>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* ============ OPINIONES ============ */}
      {verOpiniones && (
        <section className="so-sec">
          <div className="so-wrap">
            <span style={eyebrow}>Opiniones</span>
            <h2 style={h2}>
              {google?.rating ? `${google.rating} de ${google.total} reseñas` : sectionTitle(S, "opiniones", "Lo que dicen nuestros pacientes")}
            </h2>
            <div className="so-3" style={{ marginTop: 48 }}>
              {(testimonios.length > 0
                ? testimonios
                : (google?.reviews ?? []).slice(0, 3).map((r: any) => ({ text: r.text, name: r.author_name ?? "Paciente", rating: r.rating ?? 5, meta: r.relative_time_description ?? null }))
              ).slice(0, 6).map((t, i) => (
                <article key={i} style={{ borderTop: `2px solid ${tinta}`, paddingTop: 22 }}>
                  <StarRow value={t.rating} color="#d4a017" />
                  <p style={{ fontSize: 16, margin: "14px 0 18px" }}>“{t.text}”</p>
                  <div style={{ fontSize: 14, color: gris }}>
                    <b style={{ display: "block", color: tinta, fontWeight: 600 }}>{t.name}</b>
                    {t.meta}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ PAGOS ============ */}
      {verPagos && (
        <section id="pagos" style={{ background: acentoCl, padding: "80px 0" }}>
          <div className="so-wrap">
            <div className="so-2">
              <div>
                <span style={eyebrow}>Formas de pago</span>
                <h2 style={h2}>{sectionTitle(S, "pagos", "Tu tratamiento, en mensualidades")}</h2>
                <p style={{ ...lead, marginTop: 16 }}>
                  {sectionSubtitle(S, "pagos", `Meses sin intereses con tarjetas participantes: ${msi.join(", ")} plazos.`)}
                </p>
              </div>
              <div style={{ background: "#fff", padding: "28px 30px" }}>
                <MsiSimulator
                  plazos={msi}
                  opciones={opcionesMsi}
                  accent={acento}
                  ink={tinta}
                  muted={gris}
                  line={linea}
                  field="#fff"
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============ FAQ ============ */}
      {verFaq && (
        <section className="so-sec">
          <div className="so-wrap">
            <span style={eyebrow}>Preguntas frecuentes</span>
            <h2 style={{ ...h2, textAlign: "center" }}>{sectionTitle(S, "faq", "Antes de agendar")}</h2>
            <div style={{ maxWidth: 840, margin: "44px auto 0" }}>
              {faqs.map((f, i) => (
                <details key={i} open={i === 0} style={{ borderBottom: `1px solid ${linea}` }}>
                  <summary style={{ cursor: "pointer", padding: "22px 0", fontWeight: 500, fontSize: 17.5, listStyle: "none" }}>{f.q}</summary>
                  <p style={{ margin: "0 0 22px", color: gris }}>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ CTA FINAL ============ */}
      <section style={{ background: tinta, color: "#fff", padding: "110px 0", textAlign: "center" }}>
        <div className="so-wrap">
          <h2 style={{ ...h2, fontSize: "clamp(34px,5vw,60px)", maxWidth: "18ch", margin: "0 auto 18px" }}>
            {sectionTitle(S, "reservar", "Empieza por tu valoración")}
          </h2>
          <p style={{ color: tint(acento, 0.7), maxWidth: "48ch", margin: "0 auto 34px", fontSize: 17 }}>
            {sectionSubtitle(S, "reservar", "Agenda en línea, sin llamar. Te confirmamos por WhatsApp.")}
          </p>
          <button type="button" onClick={() => abrir()} style={{ ...btn, background: "#fff", color: tinta }}>Agenda tu valoración</button>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer style={{ background: nude, padding: "64px 0 26px" }}>
        <div className="so-wrap">
          <div className="so-ftop">
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 14 }}>
                <b style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.03em" }}>{clinic.name}</b>
                <i style={{ fontStyle: "normal", ...mono, fontSize: 10.5, letterSpacing: ".18em", textTransform: "uppercase", color: gris }}>{clinic.specialty}</i>
              </div>
              {clinic.address && <p style={{ fontSize: 14.5, color: gris, maxWidth: "32ch", margin: 0 }}>{clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</p>}
              {clinic.phone && <p style={{ margin: "14px 0 0" }}><a href={`tel:${clinic.phone}`} style={{ ...mono, color: acento, fontWeight: 600, textDecoration: "none" }}>{clinic.phone}</a></p>}
            </div>
            <div>
              <h4 style={{ ...mono, fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: gris, margin: "0 0 14px", fontWeight: 500 }}>Horarios</h4>
              {horario.map(d => (
                <div key={d.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, padding: "4px 0", color: d.hoy ? acento : gris }}>
                  <span>{d.label}</span><span style={mono}>{d.open ?? "Cerrado"}</span>
                </div>
              ))}
            </div>
            <div>
              <h4 style={{ ...mono, fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: gris, margin: "0 0 14px", fontWeight: 500 }}>Contacto</h4>
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" style={{ display: "block", textDecoration: "none", padding: "5px 0", fontSize: 14.5, color: tinta }}>WhatsApp</a>}
              {clinic.email && <a href={`mailto:${clinic.email}`} style={{ display: "block", textDecoration: "none", padding: "5px 0", fontSize: 14.5, color: tinta }}>{clinic.email}</a>}
              {clinic.landingInstagram && <a href={clinic.landingInstagram} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", padding: "5px 0", fontSize: 14.5, color: tinta }}><Instagram size={14} /> Instagram</a>}
              {clinic.landingFacebook && <a href={clinic.landingFacebook} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", padding: "5px 0", fontSize: 14.5, color: tinta }}><Facebook size={14} /> Facebook</a>}
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${linea}`, marginTop: 44, paddingTop: 20, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, fontSize: 13, color: gris }}>
            <span>© {new Date().getFullYear()} {clinic.name}</span>
            <span>Hecho con <a href="/" style={{ color: tinta, fontWeight: 600, textDecoration: "none" }}>DaleControl</a></span>
          </div>
        </div>
      </footer>

      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp"
          style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, width: 56, height: 56, borderRadius: "50%", background: "#25d366", display: "grid", placeItems: "center", boxShadow: "0 12px 28px -8px rgba(37,211,102,.65)", textDecoration: "none", color: "#0b2e1c" }}>
          <MessageCircle size={27} />
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
