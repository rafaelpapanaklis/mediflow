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
import { Foto, Txt, useEnEdicion } from "../_shared/edit-context";
// landing-address-parts y NO landing-address: este archivo viaja al navegador
// de los pacientes, y el módulo grande arrastra el manifiesto de las ocho
// plantillas (17 KB) sin que la página pública lo necesite para nada.
import { dirClinica, dirCopia, dirFaq, dirSeccion, dirServicio, dirTestimonio } from "@/lib/landing-address-parts";
import { tint, shade } from "../_shared/landing-utils";
import {
  copyMap, copyValue, faqList, msiPlazos, photoOf, sectionMap, sectionSubtitle, sectionTitle,
  serviceList, showSection, testimonialList, weekSchedule,
} from "../_shared/landing-data";
import { BeforeAfter, MsiSimulator, StarRow, priceToNumber } from "../_shared/landing-pieces";
import { BookingModal } from "../_shared/booking-modal";
import { useBookingReopen, type PendingBooking } from "../_shared/booking-session";

export function TemplateSonrisa({ clinic: publicada }: TemplateProps) {
  // En /dashboard/landing esto trae lo que la clínica lleva escrito sin
  // guardar; en la página pública devuelve `publicada` tal cual.
  const clinic = useLiveClinic(publicada);
  /* Solo dentro del lienzo del editor. En la página pública es SIEMPRE false,
     así que ninguna sección se pinta distinta para un paciente. */
  const editando = useEnEdicion();
  const acento = clinic.landingThemeColor ?? "#b4574d";
  const acentoOsc = shade(acento, 0.25);
  const acentoCl = tint(acento, 0.92);
  const nude = tint(acento, 0.94);
  const tinta = shade(acento, 0.84);
  const gris = "#6c605c";
  const linea = tint(acento, 0.86);

  /* ---- datos reales ---- */
  const S = sectionMap(clinic);
  /* El texto suelto que reescribió la clínica (kickers, botones, leyendas).
     `C(clave)` devuelve null si no lo tocó, y entonces <Txt> pinta el literal
     de siempre: en la página pública no se mueve un píxel. */
  const copias = copyMap(clinic);
  const C = (clave: string) => copyValue(copias, clave);
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
  /* En el lienzo, la sección de antes/después se ve aunque no haya fotos: la
     foto se sube desde ahí mismo, y si se ocultara por estar vacía no habría
     dónde soltarla. Sigue respetando el interruptor: apagada sigue apagada. */
  const verCasos = showSection(S, "casos", editando || !!(casoAntes && casoDespues));
  const verTratamientos = showSection(S, "servicios", servicios.length > 0);
  const verSonrisas = showSection(S, "galeria", galeria.length > 0);
  const verDoctor = showSection(S, "equipo", doctores.length > 0);
  const verOpiniones = showSection(S, "opiniones", testimonios.length > 0 || !!google);
  const verPagos = showSection(S, "pagos", msi.length > 0 && servicios.some(s => priceToNumber(s.price)));
  const verFaq = showSection(S, "faq", faqs.length > 0);

  /* ---- la tira de cifras solo trae lo que la clínica capturó ---- */
  /* A diferencia de `equipo`, aquí las CUATRO leyendas son literales y no
     expresiones, así que las cuatro se editan. Cada una lleva su clave. */
  const cifras: { valor: string; etiqueta: string; clave: string }[] = [];
  if (clinic.landingYearsExperience) cifras.push({ valor: String(clinic.landingYearsExperience), etiqueta: "años de experiencia", clave: "cifras.anios" });
  if (clinic.landingPatients) cifras.push({ valor: clinic.landingPatients, etiqueta: "pacientes atendidos", clave: "cifras.pacientes" });
  if (msi.length > 0) cifras.push({ valor: String(Math.max(...msi)), etiqueta: "meses sin intereses", clave: "cifras.msi" });
  if (google?.total) cifras.push({ valor: String(google.total), etiqueta: "reseñas en Google", clave: "cifras.google" });

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
          <Txt as="button" type="button" onClick={() => abrir()} style={{ ...btnP, ...btnSm }}
            campo={dirCopia("nav.cta")} etiqueta="Botón de reservar de la barra" linea maxLen={60}
            valor={C("nav.cta")} porDefecto="Agenda tu valoración" />
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header className="so-hero">
        <div style={{ padding: "60px 60px 60px max(26px, calc((100vw - 1240px)/2 + 26px))" }}>
          <span style={eyebrow}>{clinic.specialty}{clinic.city ? ` · ${clinic.city}` : ""}</span>
          <Txt as="h1" style={{ fontSize: "clamp(42px,5.6vw,74px)", fontWeight: 600, letterSpacing: "-.035em", lineHeight: 1.06, margin: 0 }}
            campo={dirClinica("landingTagline")} etiqueta="Eslogan" maxLen={300}
            valor={clinic.landingTagline} porDefecto={clinic.name} />
          {(clinic.description || editando) && (
            <Txt as="p" style={{ fontSize: 19, color: gris, maxWidth: "44ch", margin: "26px 0 34px" }}
              campo={dirClinica("description")} etiqueta="Descripción de la clínica" maxLen={5000}
              valor={clinic.description} />
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Txt as="button" type="button" onClick={() => abrir()} style={btnP}
              campo={dirCopia("hero.cta")} etiqueta="Botón principal de la portada" linea maxLen={60}
              valor={C("hero.cta")} porDefecto="Agenda tu valoración" />
            {verCasos && (
              <Txt as="a" href="#transformacion" style={btnO}
                campo={dirCopia("hero.cta2")} etiqueta="Botón secundario de la portada" linea maxLen={60}
                valor={C("hero.cta2")} porDefecto="Ver transformaciones" />
            )}
          </div>
        </div>
        <div style={{ position: "relative", height: "100%", minHeight: 520, background: nude }}>
          {/* Sin `caja`: la botonera se ancla al div de arriba, que ya es
              `position:relative`. Envolver aquí movería la foto. */}
          <Foto slot="portada" url={portada} etiqueta="Portada" zona="derecha">
            {(url) => url ? <img src={url} alt={clinic.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
          </Foto>
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
                <Txt as="span" campo={dirCopia(c.clave)} etiqueta="Leyenda de la cifra" linea maxLen={60}
                  valor={C(c.clave)} porDefecto={c.etiqueta} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ ANTES / DESPUÉS ============ */}
      {verCasos && (
        <section id="transformacion" style={{ background: nude, padding: "100px 0" }}>
          <div className="so-wrap" style={{ textAlign: "center" }}>
            <Txt as="span" style={eyebrow} campo={dirCopia("casos.kicker")} etiqueta="Etiqueta de casos" linea maxLen={60}
              valor={C("casos.kicker")} porDefecto="Casos reales" />
            <Txt as="h2" style={h2} campo={dirSeccion("casos", "titulo")} etiqueta="Título del antes y después" linea maxLen={160}
              valor={S.casos?.titulo} porDefecto="Arrastra para ver el cambio" />
            {/* Dos ranuras en un mismo hueco: la caja la pone la de "antes" y
                la de "después" cuelga su botonera de esa misma caja. */}
            <Foto slot="caso1_antes" url={casoAntes} etiqueta="Caso 1 · antes" zona="izquierda"
              caja={{ position: "relative" }} vacio={{ aspectRatio: "16/10" }}>
              {(antes) => (
                <Foto slot="caso1_despues" url={casoDespues} etiqueta="Caso 1 · después" zona="derecha">
                  {(despues) => (
                    <BeforeAfter
                      antes={antes} despues={despues} accent={acento}
                      radius={0} aspect="16/10"
                      className="so-ba"
                    />
                  )}
                </Foto>
              )}
            </Foto>
            {(sectionSubtitle(S, "casos") || editando) && (
              <Txt as="p" style={{ ...lead, margin: "28px auto 0", textAlign: "center" }}
                campo={dirSeccion("casos", "subtitulo")} etiqueta="Descripción del caso" maxLen={600}
                valor={S.casos?.subtitulo} />
            )}
          </div>
        </section>
      )}

      {/* ============ TRATAMIENTOS ============ */}
      {verTratamientos && (
        <section className="so-sec" id="tratamientos">
          <div className="so-wrap">
            <Txt as="span" style={eyebrow} campo={dirCopia("servicios.kicker")} etiqueta="Etiqueta de tratamientos" linea maxLen={60}
              valor={C("servicios.kicker")} porDefecto="Tratamientos" />
            <Txt as="h2" style={h2} campo={dirSeccion("servicios", "titulo")} etiqueta="Título de tratamientos" linea maxLen={160}
              valor={S.servicios?.titulo} porDefecto="Lo que hacemos y lo que cuesta" />
            {(sectionSubtitle(S, "servicios") || editando) && (
              <Txt as="p" style={{ ...lead, marginTop: 16 }}
                campo={dirSeccion("servicios", "subtitulo")} etiqueta="Bajada de tratamientos" maxLen={500}
                valor={S.servicios?.subtitulo} />
            )}
            <div className="so-3" style={{ marginTop: 52 }}>
              {servicios.map((s, i) => {
                const foto = photoOf(clinic, `servicio${i + 1}`, { galleryIndex: i });
                /* El manifiesto solo declara servicio1..3. A partir del cuarto
                   la tarjeta sigue pintando su foto de galería, pero no hay
                   ranura donde subir una: envolverla en <Foto> con un id que
                   no existe dejaría un botón que guarda en el vacío. */
                const ranura = i < 3 ? `servicio${i + 1}` : null;
                const tarjeta = (url: string | null) => (
                  <>
                    {(url || (editando && ranura)) && (
                      <div style={{ aspectRatio: "4/5", overflow: "hidden" }}>
                        {url && <img src={url} alt={s.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                      </div>
                    )}
                  </>
                );
                return (
                  <article key={s.name + i} className="so-tr" style={{ position: "relative", overflow: "hidden", background: nude }}>
                    {ranura
                      ? <Foto slot={ranura} url={foto} etiqueta={`Foto del tratamiento ${i + 1}`} zona="completa">{tarjeta}</Foto>
                      : tarjeta(foto)}
                    <div style={{ padding: "24px 24px 26px" }}>
                      <Txt as="h3" style={{ fontSize: 22, marginBottom: 6, fontWeight: 600, letterSpacing: "-.03em" }}
                        campo={dirServicio(s.i, "name")} etiqueta="Nombre del tratamiento" linea requerido maxLen={120}
                        valor={s.name} />
                      {(s.desc || editando) && (
                        <Txt as="p" style={{ margin: "0 0 16px", color: gris, fontSize: 14.5 }}
                          campo={dirServicio(s.i, "desc")} etiqueta="Descripción del tratamiento" maxLen={400}
                          valor={s.desc} />
                      )}
                      <div style={{ display: "flex", alignItems: "baseline", gap: 12, borderTop: `1px solid ${linea}`, paddingTop: 15, flexWrap: "wrap" }}>
                        {(s.price || editando) && (
                          <Txt as="span" style={{ ...mono, fontSize: 21, fontWeight: 600 }}
                            campo={dirServicio(s.i, "price")} etiqueta="Precio" linea maxLen={40}
                            valor={s.price} />
                        )}
                        {s.durationMin && <span style={{ ...mono, fontSize: 12.5, color: gris }}>{s.durationMin} min</span>}
                        <Txt as="button" type="button" onClick={() => abrir({ service: s.name })} style={{ ...btnO, ...btnSm, marginLeft: "auto" }}
                          campo={dirCopia("servicios.cta")} etiqueta="Botón de cada tratamiento" linea maxLen={40}
                          valor={C("servicios.cta")} porDefecto="Agendar" />
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
            <Txt as="span" style={eyebrow} campo={dirCopia("galeria.kicker")} etiqueta="Etiqueta de la galería" linea maxLen={60}
              valor={C("galeria.kicker")} porDefecto="Nuestras sonrisas" />
            <Txt as="h2" style={h2} campo={dirSeccion("galeria", "titulo")} etiqueta="Título de la galería" linea maxLen={160}
              valor={S.galeria?.titulo} porDefecto="Así quedan nuestros pacientes" />
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
                  <Foto slot="doctor" url={fotoDoctor} etiqueta="Foto del doctor o doctora" zona="completa">
                    {(url) => url
                      ? <img src={url} alt={`${doctores[0].firstName} ${doctores[0].lastName}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span style={{ fontSize: 72, fontWeight: 600, color: acento, ...mono }}>{doctores[0].firstName[0]}{doctores[0].lastName[0]}</span>}
                  </Foto>
                </div>
                <div>
                  <Txt as="span" style={eyebrow} campo={dirCopia("equipo.kicker")} etiqueta="Etiqueta del equipo" linea maxLen={60}
                    valor={C("equipo.kicker")} porDefecto="Quién te atiende" />
                  <h2 style={{ ...h2, fontSize: "clamp(28px,3.4vw,42px)" }}>Dr/a. {doctores[0].firstName} {doctores[0].lastName}</h2>
                  {doctores[0].specialty && <p style={{ ...lead, marginTop: 16 }}>{doctores[0].specialty}</p>}
                  {doctores[0].services.length > 0 && (
                    <ul style={{ listStyle: "none", padding: 0, margin: "26px 0 30px" }}>
                      {doctores[0].services.slice(0, 5).map(s => (
                        <li key={s} style={{ padding: "12px 0", borderBottom: `1px solid ${linea}`, display: "flex", gap: 16, fontSize: 15 }}>
                          <Txt as="b" style={{ ...mono, fontSize: 12.5, letterSpacing: ".1em", textTransform: "uppercase", color: acento, minWidth: 120, flex: "0 0 auto" }}
                            campo={dirCopia("equipo.etiquetaAtiende")} etiqueta="Rótulo de cada tratamiento que atiende" linea maxLen={40}
                            valor={C("equipo.etiquetaAtiende")} porDefecto="Atiende" />
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
                <Txt as="span" style={eyebrow} campo={dirCopia("equipo.kicker")} etiqueta="Etiqueta del equipo" linea maxLen={60}
                  valor={C("equipo.kicker")} porDefecto="Quién te atiende" />
                <Txt as="h2" style={h2} campo={dirSeccion("equipo", "titulo")} etiqueta="Título del equipo" linea maxLen={160}
                  valor={S.equipo?.titulo} porDefecto="El equipo" />
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
                      <Txt as="button" type="button" onClick={() => abrir({ doctorId: d.id })} style={{ ...btnO, ...btnSm, marginTop: 16 }}
                        campo={dirCopia("equipo.cta")} etiqueta="Botón de cada doctor" linea maxLen={40}
                        valor={C("equipo.cta")} porDefecto="Agendar" />
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
            <Txt as="span" style={eyebrow} campo={dirCopia("opiniones.kicker")} etiqueta="Etiqueta de opiniones" linea maxLen={60}
              valor={C("opiniones.kicker")} porDefecto="Opiniones" />
            {/* Con ficha de Google el titular es una cadena CONSTRUIDA
                ("4.8 de 132 reseñas") y no se instrumenta: guardarla congelaría
                los números de hoy. Sin Google sí es un título de sección. */}
            {google?.rating
              ? <h2 style={h2}>{`${google.rating} de ${google.total} reseñas`}</h2>
              : <Txt as="h2" style={h2} campo={dirSeccion("opiniones", "titulo")} etiqueta="Título de opiniones" linea maxLen={160}
                  valor={S.opiniones?.titulo} porDefecto="Lo que dicen nuestros pacientes" />}
            <div className="so-3" style={{ marginTop: 48 }}>
              {/* `dir` es null en las reseñas de Google: son de Google, no de la
                  clínica, y no hay dónde guardarlas si alguien las reescribe. */}
              {(testimonios.length > 0
                ? testimonios.map(t => ({ text: t.text, name: t.name, rating: t.rating, meta: t.meta, dir: t.i as number | null }))
                : (google?.reviews ?? []).slice(0, 3).map((r: any) => ({ text: r.text, name: r.author_name ?? "Paciente", rating: r.rating ?? 5, meta: r.relative_time_description ?? null, dir: null as number | null }))
              ).slice(0, 6).map((t, i) => (
                <article key={i} style={{ borderTop: `2px solid ${tinta}`, paddingTop: 22 }}>
                  <StarRow value={t.rating} color="#d4a017" />
                  {/* Las comillas van como prefijo/sufijo y no dentro del texto:
                      si se guardaran, la siguiente edición las duplicaría. */}
                  <Txt as="p" style={{ fontSize: 16, margin: "14px 0 18px" }}
                    campo={t.dir === null ? null : dirTestimonio(t.dir, "text")}
                    etiqueta="Opinión" requerido maxLen={800}
                    valor={t.text} prefijo="“" sufijo="”" />
                  <div style={{ fontSize: 14, color: gris }}>
                    <Txt as="b" style={{ display: "block", color: tinta, fontWeight: 600 }}
                      campo={t.dir === null ? null : dirTestimonio(t.dir, "name")}
                      etiqueta="Quién lo dice" linea maxLen={80} valor={t.name} />
                    {/* `meta` NO se instrumenta aquí y es una decisión: en esta
                        plantilla se pinta SUELTO dentro del <div>, sin elemento
                        propio. Envolverlo en un <span> para poder hacerle clic
                        añadiría un nodo al HTML público de una página ya
                        publicada. Se sigue editando desde el formulario. */}
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
                <Txt as="span" style={eyebrow} campo={dirCopia("pagos.kicker")} etiqueta="Etiqueta de pagos" linea maxLen={60}
                  valor={C("pagos.kicker")} porDefecto="Formas de pago" />
                <Txt as="h2" style={h2} campo={dirSeccion("pagos", "titulo")} etiqueta="Título de pagos" linea maxLen={160}
                  valor={S.pagos?.titulo} porDefecto="Tu tratamiento, en mensualidades" />
                {/* El texto por defecto se CONSTRUYE con los plazos de la clínica,
                    así que en el manifiesto va vacío y el literal real se pasa
                    aquí. <Txt> nunca guarda el default, solo lo enseña. */}
                <Txt as="p" style={{ ...lead, marginTop: 16 }}
                  campo={dirSeccion("pagos", "subtitulo")} etiqueta="Bajada de pagos" maxLen={500}
                  valor={S.pagos?.subtitulo}
                  porDefecto={`Meses sin intereses con tarjetas participantes: ${msi.join(", ")} plazos.`} />
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
            <Txt as="span" style={eyebrow} campo={dirCopia("faq.kicker")} etiqueta="Etiqueta de preguntas" linea maxLen={60}
              valor={C("faq.kicker")} porDefecto="Preguntas frecuentes" />
            <Txt as="h2" style={{ ...h2, textAlign: "center" }} campo={dirSeccion("faq", "titulo")} etiqueta="Título de preguntas" linea maxLen={160}
              valor={S.faq?.titulo} porDefecto="Antes de agendar" />
            <div style={{ maxWidth: 840, margin: "44px auto 0" }}>
              {faqs.map((f, i) => (
                <details key={i} open={i === 0} style={{ borderBottom: `1px solid ${linea}` }}>
                  <Txt as="summary" style={{ cursor: "pointer", padding: "22px 0", fontWeight: 500, fontSize: 17.5, listStyle: "none" }}
                    campo={dirFaq(f.i, "q")} etiqueta="Pregunta" linea requerido maxLen={200}
                    valor={f.q} />
                  <Txt as="p" style={{ margin: "0 0 22px", color: gris }}
                    campo={dirFaq(f.i, "a")} etiqueta="Respuesta" requerido maxLen={1200}
                    valor={f.a} />
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ CTA FINAL ============ */}
      <section style={{ background: tinta, color: "#fff", padding: "110px 0", textAlign: "center" }}>
        <div className="so-wrap">
          <Txt as="h2" style={{ ...h2, fontSize: "clamp(34px,5vw,60px)", maxWidth: "18ch", margin: "0 auto 18px" }}
            campo={dirSeccion("reservar", "titulo")} etiqueta="Título del cierre" linea maxLen={160}
            valor={S.reservar?.titulo} porDefecto="Empieza por tu valoración" />
          <Txt as="p" style={{ color: tint(acento, 0.7), maxWidth: "48ch", margin: "0 auto 34px", fontSize: 17 }}
            campo={dirSeccion("reservar", "subtitulo")} etiqueta="Bajada del cierre" maxLen={500}
            valor={S.reservar?.subtitulo} porDefecto="Agenda en línea, sin llamar. Te confirmamos por WhatsApp." />
          <Txt as="button" type="button" onClick={() => abrir()} style={{ ...btn, background: "#fff", color: tinta }}
            campo={dirCopia("reservar.cta")} etiqueta="Botón del cierre" linea maxLen={60}
            valor={C("reservar.cta")} porDefecto="Agenda tu valoración" />
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
