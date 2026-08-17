"use client";
/* ============================================================
   PLANTILLA "ESPECIALISTAS" — alta especialidad, ticket alto.
   Oscura, sobria, mucho aire. Los argumentos son tecnología,
   credenciales y financiamiento: quien va a gastar $150,000
   necesita ver por qué, no cuántas caritas felices hay.

   El fondo oscuro se deriva del acento (shade), así que una
   clínica con acento azul no acaba con un fondo dorado.
   ============================================================ */
import { useState, useEffect } from "react";
import { ChevronRight, Instagram, MessageCircle } from "lucide-react";
import type { TemplateProps } from "../_shared/types";
import { useLiveClinic } from "../_shared/live-preview";
import { shade, alpha, mix } from "../_shared/landing-utils";
import {
  faqList, msiPlazos, photoOf, sectionMap, sectionSubtitle, sectionTitle,
  serviceList, showSection, testimonialList, weekSchedule,
} from "../_shared/landing-data";
import { BeforeAfter, MsiSimulator, StarRow, priceToNumber } from "../_shared/landing-pieces";
import { BookingModal } from "../_shared/booking-modal";
import { useBookingReopen, type PendingBooking } from "../_shared/booking-session";

export function TemplateEspecialistas({ clinic: publicada }: TemplateProps) {
  // En /dashboard/landing esto trae lo que la clínica lleva escrito sin
  // guardar; en la página pública devuelve `publicada` tal cual.
  const clinic = useLiveClinic(publicada);
  const acento = clinic.landingThemeColor ?? "#c9a961";
  /* La base oscura sale del acento mezclado con azul noche: conserva su
     temperatura (un acento dorado da un fondo cálido, uno azul uno frío)
     sin que ningún acento claro deje el fondo lavado. */
  const fondo = shade(mix(acento, "#0a0f1a", 0.86), 0.35);
  const fondo2 = shade(mix(acento, "#111827", 0.86), 0.22);
  const fondo3 = shade(mix(acento, "#161f30", 0.86), 0.12);
  const tinta = "#f1f5f9";
  const gris = "#93a3b8";
  const linea = "rgba(255,255,255,.11)";
  const inkSobreAcento = shade(acento, 0.78);

  const S = sectionMap(clinic);
  const servicios = serviceList(clinic);
  const doctores = clinic.users ?? [];
  const testimonios = testimonialList(clinic);
  const faqs = faqList(clinic);
  const horario = weekSchedule(clinic);
  const msi = msiPlazos(clinic);
  const wa = clinic.landingWhatsapp ? `https://wa.me/${clinic.landingWhatsapp.replace(/\D/g, "")}` : null;
  const portada = photoOf(clinic, "portada", { cover: true });
  const casoAntes = photoOf(clinic, "caso1_antes");
  const casoDespues = photoOf(clinic, "caso1_despues");
  const tecFotos = [
    photoOf(clinic, "tecnologia1"),
    photoOf(clinic, "tecnologia2"),
    photoOf(clinic, "tecnologia3"),
  ];
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

  const verTratamientos = showSection(S, "servicios", servicios.length > 0);
  const verTec = showSection(S, "tecnologia", tecFotos.some(Boolean));
  const verCaso = showSection(S, "casos", !!(casoAntes && casoDespues));
  const verDoctor = showSection(S, "equipo", doctores.length > 0);
  const opcionesMsi = servicios
    .map(s => ({ label: s.name, monto: priceToNumber(s.price) }))
    .filter((o): o is { label: string; monto: number } => o.monto !== null);
  const verPagos = showSection(S, "pagos", msi.length > 0 && opcionesMsi.length > 0);
  const verOpiniones = showSection(S, "opiniones", testimonios.length > 0 || !!google);
  const verFaq = showSection(S, "faq", faqs.length > 0);

  /* Franja de credenciales: solo cifras que la clínica capturó. */
  const franja: { valor: string; etiqueta: string }[] = [];
  if (clinic.landingPatients) franja.push({ valor: clinic.landingPatients, etiqueta: "pacientes atendidos" });
  if (clinic.landingYearsExperience) franja.push({ valor: String(clinic.landingYearsExperience), etiqueta: "años de especialidad" });
  if (google?.rating) franja.push({ valor: String(google.rating), etiqueta: `${google.total} reseñas en Google` });
  if (msi.length > 0) franja.push({ valor: String(Math.max(...msi)), etiqueta: "meses sin intereses" });

  const nav: { href: string; label: string }[] = [
    ...(verTratamientos ? [{ href: "#tratamientos", label: "Tratamientos" }] : []),
    ...(verTec ? [{ href: "#tecnologia", label: "Tecnología" }] : []),
    ...(verCaso ? [{ href: "#casos", label: "Casos" }] : []),
    ...(verDoctor ? [{ href: "#doctor", label: doctores.length === 1 ? "El especialista" : "Especialistas" }] : []),
    ...(verPagos ? [{ href: "#pagos", label: "Financiamiento" }] : []),
  ];

  const btn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
    height: 54, padding: "0 28px", borderRadius: 8, fontWeight: 500, fontSize: 15,
    border: "1px solid transparent", cursor: "pointer", textDecoration: "none",
    fontFamily: "inherit", transition: ".2s",
  };
  const btnP: React.CSSProperties = { ...btn, background: acento, color: inkSobreAcento };
  const btnO: React.CSSProperties = { ...btn, background: "transparent", color: tinta, borderColor: linea };
  const btnSm: React.CSSProperties = { height: 42, padding: "0 18px", fontSize: 14 };
  const kicker: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".22em", textTransform: "uppercase",
    color: acento, display: "block", marginBottom: 20,
  };
  const h2: React.CSSProperties = { fontSize: "clamp(30px,4vw,48px)", fontWeight: 400, letterSpacing: "-.03em", lineHeight: 1.12, margin: 0 };
  const lead: React.CSSProperties = { color: gris, fontSize: 17.5, maxWidth: "58ch", fontWeight: 300 };
  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ fontFamily: "var(--font-sans)", background: fondo, color: tinta, fontSize: 16.5, lineHeight: 1.7 }}>
      <style>{`
        .es-wrap { max-width:1200px; margin:0 auto; padding:0 24px; }
        .es-sec { padding:104px 0; }
        .es-links a:hover { color:${acento}; }
        .es-t:hover { padding-left:12px; }
        .es-tc img { transition:.5s; }
        .es-tc:hover img { transform:scale(1.04); }
        .es-hero { display:grid; grid-template-columns:1.05fr .95fr; align-items:center; gap:56px; padding:70px 0 90px; }
        .es-franja { display:grid; grid-template-columns:repeat(4,1fr); }
        .es-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:24px; }
        .es-2 { display:grid; grid-template-columns:1.05fr .95fr; gap:56px; align-items:center; }
        .es-doc { display:grid; grid-template-columns:.85fr 1.15fr; gap:56px; align-items:center; }
        .es-fin { display:grid; grid-template-columns:1fr 1fr; gap:60px; align-items:center; }
        .es-ubi { display:grid; grid-template-columns:1fr 1fr; }
        .es-ftop { display:grid; grid-template-columns:1.5fr 1fr 1fr; gap:38px; }
        .es-fila { display:grid; grid-template-columns:auto 1fr auto auto; gap:26px; align-items:center; }
        @media (max-width:1000px) {
          .es-hero, .es-2, .es-doc, .es-fin, .es-ubi { grid-template-columns:1fr; gap:34px; }
          .es-3, .es-ftop, .es-franja { grid-template-columns:1fr 1fr; }
          .es-links { display:none !important; }
        }
        @media (max-width:620px) {
          .es-sec { padding:64px 0; }
          .es-3, .es-ftop, .es-franja { grid-template-columns:1fr; }
          .es-fila { grid-template-columns:1fr auto; gap:10px 16px; }
          .es-num { display:none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .es-t:hover { padding-left:0; }
          .es-tc:hover img { transform:none; }
        }
      `}</style>

      {/* ============ NAV ============ */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50, background: alpha(fondo, 0.86),
        backdropFilter: "blur(14px)", transition: ".25s",
        borderBottom: `1px solid ${scrolled ? linea : "transparent"}`,
      }}>
        <div className="es-wrap" style={{ display: "flex", alignItems: "center", gap: 32, height: 84 }}>
          <a href="#" style={{ marginRight: "auto", textDecoration: "none", display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            {clinic.logoUrl
              ? <img src={clinic.logoUrl} alt="" style={{ width: 38, height: 38, objectFit: "contain", borderRadius: 4, flex: "0 0 auto" }} />
              : <span style={{ width: 38, height: 38, border: `1px solid ${acento}`, color: acento, display: "grid", placeItems: "center", ...mono, fontWeight: 600, fontSize: 15, borderRadius: 4, flex: "0 0 auto" }}>{clinic.name.charAt(0).toUpperCase()}</span>}
            <span style={{ minWidth: 0 }}>
              <b style={{ display: "block", fontSize: 17, fontWeight: 500, letterSpacing: "-.02em" }}>{clinic.name}</b>
              <span style={{ display: "block", ...mono, fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase", color: gris }}>{clinic.specialty}</span>
            </span>
          </a>
          <div className="es-links" style={{ display: "flex", gap: 28 }}>
            {nav.map(l => <a key={l.href} href={l.href} style={{ textDecoration: "none", fontSize: 14.5, color: gris }}>{l.label}</a>)}
          </div>
          <button type="button" onClick={() => abrir()} style={{ ...btnP, ...btnSm }}>Valoración</button>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header className="es-wrap es-hero">
        <div>
          <span style={kicker}>{clinic.specialty}</span>
          <h1 style={{ fontSize: "clamp(38px,5.2vw,64px)", fontWeight: 300, maxWidth: "15ch", letterSpacing: "-.03em", lineHeight: 1.1, margin: 0 }}>
            {clinic.landingTagline || clinic.name}
          </h1>
          {clinic.description && (
            <p style={{ color: gris, fontSize: 18, maxWidth: "46ch", margin: "24px 0 34px", fontWeight: 300 }}>{clinic.description}</p>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" onClick={() => abrir()} style={btnP}>Agenda tu valoración</button>
            {verCaso && <a href="#casos" style={btnO}>Ver casos <ChevronRight size={15} /></a>}
          </div>
        </div>
        <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "4/3.4", background: fondo2, border: `1px solid ${linea}` }}>
          {portada
            ? <img src={portada} alt={clinic.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", background: `linear-gradient(200deg, ${alpha(acento, 0.16)}, ${fondo2})`, color: acento, ...mono, fontSize: 64, fontWeight: 300 }}>
                {clinic.name.charAt(0).toUpperCase()}
              </div>}
        </div>
      </header>

      {/* ============ FRANJA DE CREDENCIALES ============ */}
      {franja.length > 0 && (
        <div style={{ borderTop: `1px solid ${linea}`, borderBottom: `1px solid ${linea}` }}>
          <div className="es-wrap es-franja">
            {franja.map((f, i) => (
              <div key={f.etiqueta} style={{
                padding: "30px 26px 30px 0",
                borderRight: i === franja.length - 1 ? "none" : `1px solid ${linea}`,
              }}>
                <b style={{ display: "block", ...mono, fontSize: 30, fontWeight: 500, letterSpacing: "-.03em", color: "#fff" }}>{f.valor}</b>
                <span style={{ fontSize: 13.5, color: gris }}>{f.etiqueta}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ TRATAMIENTOS ============ */}
      {verTratamientos && (
        <section className="es-sec" id="tratamientos">
          <div className="es-wrap">
            <span style={kicker}>Tratamientos</span>
            <h2 style={h2}>{sectionTitle(S, "servicios", "Alta especialidad, precio cerrado")}</h2>
            {sectionSubtitle(S, "servicios") && <p style={{ ...lead, marginTop: 16 }}>{sectionSubtitle(S, "servicios")}</p>}

            <div style={{ marginTop: 52, borderTop: `1px solid ${linea}` }}>
              {servicios.map((s, i) => (
                <div key={s.name + i} className="es-fila es-t" style={{ padding: "26px 0", borderBottom: `1px solid ${linea}`, transition: ".2s" }}>
                  <span className="es-num" style={{ ...mono, fontSize: 12.5, color: acento, width: 36 }}>{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <b style={{ fontSize: 21, fontWeight: 500, display: "block", letterSpacing: "-.02em" }}>{s.name}</b>
                    {s.desc && <span style={{ color: gris, fontSize: 14.5 }}>{s.desc}</span>}
                  </div>
                  <span style={{ ...mono, fontSize: 20, fontWeight: 500, textAlign: "right" }}>
                    {s.price}
                    {s.durationMin && (
                      <i style={{ display: "block", fontStyle: "normal", fontFamily: "var(--font-sans)", fontSize: 12.5, color: gris }}>{s.durationMin} min</i>
                    )}
                  </span>
                  <button type="button" onClick={() => abrir({ service: s.name })} style={{ ...btnO, ...btnSm }}>Valoración</button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ TECNOLOGÍA ============ */}
      {verTec && (
        <section className="es-sec" id="tecnologia" style={{ paddingTop: verTratamientos ? 0 : undefined }}>
          <div className="es-wrap">
            <span style={kicker}>Tecnología</span>
            <h2 style={h2}>{sectionTitle(S, "tecnologia", "Nada se improvisa en el sillón")}</h2>
            <div className="es-3" style={{ marginTop: 52 }}>
              {tecFotos.map((foto, i) => {
                if (!foto) return null;
                const id = `tecnologia${i + 1}`;
                return (
                  <article key={id} className="es-tc" style={{ background: fondo2, border: `1px solid ${linea}`, borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <div style={{ aspectRatio: "16/11", overflow: "hidden" }}>
                      <img src={foto} alt={sectionTitle(S, id, "Equipo del consultorio")} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: .92 }} />
                    </div>
                    <div style={{ padding: 24 }}>
                      <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".18em", textTransform: "uppercase", color: acento, marginBottom: 10 }}>
                        {sectionTitle(S, id, "Equipo")}
                      </div>
                      {sectionSubtitle(S, id) && (
                        <p style={{ margin: 0, color: gris, fontSize: 14.5, fontWeight: 300 }}>{sectionSubtitle(S, id)}</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ============ CASO DOCUMENTADO ============ */}
      {verCaso && (
        <section className="es-sec" id="casos" style={{ background: fondo2, borderTop: `1px solid ${linea}`, borderBottom: `1px solid ${linea}` }}>
          <div className="es-wrap">
            <span style={kicker}>Caso documentado</span>
            <h2 style={h2}>{sectionTitle(S, "casos", "Antes y después")}</h2>
            <div className="es-2" style={{ marginTop: 44 }}>
              <BeforeAfter antes={casoAntes} despues={casoDespues} accent={acento} radius={8} surface="dark" />
              <div>
                {sectionSubtitle(S, "casos") && <p style={lead}>{sectionSubtitle(S, "casos")}</p>}
                <button type="button" onClick={() => abrir()} style={{ ...btnP, marginTop: 26 }}>Agenda tu valoración</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============ EL ESPECIALISTA ============ */}
      {verDoctor && (
        <section className="es-sec" id="doctor">
          <div className="es-wrap">
            {doctores.length === 1 ? (
              <div className="es-doc">
                <div style={{ borderRadius: 8, overflow: "hidden", aspectRatio: "4/5", border: `1px solid ${linea}`, background: fondo2, display: "grid", placeItems: "center" }}>
                  {fotoDoctor
                    ? <img src={fotoDoctor} alt={`${doctores[0].firstName} ${doctores[0].lastName}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ ...mono, fontSize: 72, fontWeight: 300, color: acento }}>{doctores[0].firstName[0]}{doctores[0].lastName[0]}</span>}
                </div>
                <div>
                  <span style={kicker}>El especialista</span>
                  <h2 style={{ ...h2, fontSize: "clamp(28px,3.4vw,40px)" }}>Dr/a. {doctores[0].firstName} {doctores[0].lastName}</h2>
                  {doctores[0].specialty && <p style={{ ...lead, marginTop: 16 }}>{doctores[0].specialty}</p>}
                  {doctores[0].services.length > 0 && (
                    <ul style={{ listStyle: "none", padding: 0, margin: "28px 0 32px" }}>
                      {doctores[0].services.slice(0, 6).map(s => (
                        <li key={s} style={{ display: "flex", gap: 18, padding: "14px 0", borderBottom: `1px solid ${linea}`, fontSize: 15 }}>
                          <b style={{ ...mono, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: acento, minWidth: 120 }}>Atiende</b>
                          <span style={{ color: gris, fontWeight: 300 }}>{s}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" onClick={() => abrir({ doctorId: doctores[0].id })} style={btnP}>Agenda con {doctores[0].firstName}</button>
                </div>
              </div>
            ) : (
              <>
                <span style={kicker}>Los especialistas</span>
                <h2 style={h2}>{sectionTitle(S, "equipo", "Quién te va a operar")}</h2>
                <div className="es-3" style={{ marginTop: 48 }}>
                  {doctores.map(d => (
                    <article key={d.id} style={{ background: fondo2, border: `1px solid ${linea}`, borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ aspectRatio: "4/5", overflow: "hidden", display: "grid", placeItems: "center", background: fondo3 }}>
                        {d.avatarUrl
                          ? <img src={d.avatarUrl} alt={`${d.firstName} ${d.lastName}`} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : <span style={{ ...mono, fontSize: 54, fontWeight: 300, color: acento }}>{d.firstName[0]}{d.lastName[0]}</span>}
                      </div>
                      <div style={{ padding: 24 }}>
                        <b style={{ fontSize: 19, fontWeight: 500, display: "block" }}>Dr/a. {d.firstName} {d.lastName}</b>
                        {d.specialty && <div style={{ ...mono, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: acento, margin: "8px 0 14px" }}>{d.specialty}</div>}
                        <button type="button" onClick={() => abrir({ doctorId: d.id })} style={{ ...btnO, ...btnSm }}>Valoración</button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* ============ FINANCIAMIENTO ============ */}
      {verPagos && (
        <section className="es-sec" id="pagos" style={{ background: fondo2, borderTop: `1px solid ${linea}`, borderBottom: `1px solid ${linea}` }}>
          <div className="es-wrap es-fin">
            <div>
              <span style={kicker}>Financiamiento</span>
              <h2 style={h2}>{sectionTitle(S, "pagos", "Tu tratamiento cabe en tu mes")}</h2>
              <p style={{ ...lead, marginTop: 16 }}>
                {sectionSubtitle(S, "pagos", `Meses sin intereses con tarjetas participantes, hasta ${Math.max(...msi)} plazos. La cifra que ves es la que se carga.`)}
              </p>
            </div>
            <MsiSimulator
              plazos={msi}
              opciones={opcionesMsi}
              accent={acento}
              surface="dark"
              ink={tinta}
              muted={gris}
              line={linea}
              field={fondo3}
            />
          </div>
        </section>
      )}

      {/* ============ OPINIONES ============ */}
      {verOpiniones && (
        <section className="es-sec">
          <div className="es-wrap">
            <span style={kicker}>Opiniones</span>
            <h2 style={h2}>
              {google?.rating
                ? <>{google.rating} <b style={{ fontWeight: 600 }}>de {google.total} reseñas</b></>
                : sectionTitle(S, "opiniones", "Lo que dicen nuestros pacientes")}
            </h2>
            <div className="es-3" style={{ marginTop: 48 }}>
              {(testimonios.length > 0
                ? testimonios
                : (google?.reviews ?? []).slice(0, 3).map((r: any) => ({ text: r.text, name: r.author_name ?? "Paciente", rating: r.rating ?? 5, meta: r.relative_time_description ?? null }))
              ).slice(0, 6).map((t, i) => (
                <article key={i} style={{ borderTop: `1px solid ${acento}`, paddingTop: 22 }}>
                  <StarRow value={t.rating} color={acento} size={14} />
                  <p style={{ fontSize: 16, margin: "14px 0 18px", fontWeight: 300 }}>“{t.text}”</p>
                  <b style={{ fontSize: 14.5, fontWeight: 500, display: "block" }}>{t.name}</b>
                  {t.meta && <small style={{ color: gris, fontSize: 13 }}>{t.meta}</small>}
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ FAQ ============ */}
      {verFaq && (
        <section className="es-sec" style={{ paddingTop: 0 }}>
          <div className="es-wrap">
            <span style={kicker}>Preguntas frecuentes</span>
            <h2 style={h2}>{sectionTitle(S, "faq", "Antes de decidir")}</h2>
            <div style={{ maxWidth: 840, marginTop: 40 }}>
              {faqs.map((f, i) => (
                <details key={i} open={i === 0} style={{ borderBottom: `1px solid ${linea}` }}>
                  <summary style={{ cursor: "pointer", padding: "20px 0", fontWeight: 500, fontSize: 17, listStyle: "none" }}>{f.q}</summary>
                  <p style={{ margin: "0 0 20px", color: gris, fontWeight: 300 }}>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ UBICACIÓN ============ */}
      <section className="es-sec" style={{ paddingTop: 0 }} id="ubicacion">
        <div className="es-wrap">
          <span style={kicker}>Dónde estamos</span>
          <h2 style={h2}>{sectionTitle(S, "contacto", clinic.city ?? "Ubicación y horarios")}</h2>
          <div className="es-ubi" style={{ border: `1px solid ${linea}`, borderRadius: 8, overflow: "hidden", marginTop: 44 }}>
            <div style={{ padding: "38px 34px" }}>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px" }}>
                {horario.map(d => (
                  <li key={d.label} style={{
                    display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0",
                    borderBottom: `1px solid ${linea}`, fontSize: 15,
                    color: d.hoy ? acento : d.open ? tinta : gris,
                  }}>
                    <span>{d.label}{d.hoy ? " · hoy" : ""}</span>
                    <time style={{ ...mono, fontSize: 14 }}>{d.open ?? "Cerrado"}</time>
                  </li>
                ))}
              </ul>
              {clinic.address && <p style={{ fontSize: 15, color: gris, margin: "0 0 6px", fontWeight: 300 }}>{clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</p>}
              {clinic.phone && <p style={{ margin: "0 0 22px" }}><a href={`tel:${clinic.phone}`} style={{ ...mono, color: acento, textDecoration: "none" }}>{clinic.phone}</a></p>}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => abrir()} style={{ ...btnP, ...btnSm }}>Agendar valoración</button>
                {clinic.address && (
                  <a style={{ ...btnO, ...btnSm }} href={`https://maps.google.com/?q=${encodeURIComponent(`${clinic.address} ${clinic.city ?? ""}`)}`} target="_blank" rel="noopener noreferrer">Cómo llegar</a>
                )}
              </div>
            </div>
            {clinic.landingMapEmbed
              ? <iframe src={clinic.landingMapEmbed} loading="lazy" title={`Mapa de ${clinic.name}`} style={{ width: "100%", height: "100%", minHeight: 400, border: 0, display: "block", filter: "grayscale(1) invert(.92) contrast(.85)" }} />
              : <div style={{ minHeight: 260, background: fondo2, display: "grid", placeItems: "center", color: acento, ...mono, fontSize: 13, letterSpacing: ".2em", textTransform: "uppercase" }}>
                  {clinic.city ?? ""}
                </div>}
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer style={{ padding: "56px 0 24px", borderTop: `1px solid ${linea}` }}>
        <div className="es-wrap">
          <div className="es-ftop">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <span style={{ width: 38, height: 38, border: `1px solid ${acento}`, color: acento, display: "grid", placeItems: "center", ...mono, fontWeight: 600, fontSize: 15, borderRadius: 4 }}>{clinic.name.charAt(0).toUpperCase()}</span>
                <span>
                  <b style={{ display: "block", fontSize: 17, fontWeight: 500 }}>{clinic.name}</b>
                  <span style={{ display: "block", ...mono, fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase", color: gris }}>{clinic.specialty}</span>
                </span>
              </div>
              {clinic.address && <p style={{ fontSize: 14.5, color: gris, maxWidth: "32ch", margin: 0, fontWeight: 300 }}>{clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</p>}
            </div>
            {verTratamientos && (
              <div>
                <h4 style={{ ...mono, fontSize: 10.5, letterSpacing: ".2em", textTransform: "uppercase", color: acento, margin: "0 0 14px", fontWeight: 500 }}>Tratamientos</h4>
                {servicios.slice(0, 5).map(s => (
                  <a key={s.name} href="#tratamientos" style={{ display: "block", textDecoration: "none", padding: "5px 0", fontSize: 14.5, color: gris }}>{s.name}</a>
                ))}
              </div>
            )}
            <div>
              <h4 style={{ ...mono, fontSize: 10.5, letterSpacing: ".2em", textTransform: "uppercase", color: acento, margin: "0 0 14px", fontWeight: 500 }}>Contacto</h4>
              {clinic.phone && <a href={`tel:${clinic.phone}`} style={{ ...mono, display: "block", textDecoration: "none", padding: "5px 0", fontSize: 14.5, color: gris }}>{clinic.phone}</a>}
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" style={{ display: "block", textDecoration: "none", padding: "5px 0", fontSize: 14.5, color: gris }}>WhatsApp</a>}
              {clinic.email && <a href={`mailto:${clinic.email}`} style={{ display: "block", textDecoration: "none", padding: "5px 0", fontSize: 14.5, color: gris }}>{clinic.email}</a>}
              {clinic.landingInstagram && <a href={clinic.landingInstagram} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", padding: "5px 0", fontSize: 14.5, color: gris }}><Instagram size={14} /> Instagram</a>}
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${linea}`, marginTop: 40, paddingTop: 20, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, fontSize: 13, color: gris }}>
            <span>© {new Date().getFullYear()} {clinic.name}</span>
            <span>Hecho con <a href="/" style={{ color: tinta, textDecoration: "none" }}>DaleControl</a></span>
          </div>
        </div>
      </footer>

      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp"
          style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, width: 56, height: 56, borderRadius: "50%", background: "#25d366", display: "grid", placeItems: "center", boxShadow: "0 12px 30px -8px rgba(37,211,102,.5)", textDecoration: "none", color: "#0b2e1c" }}>
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
