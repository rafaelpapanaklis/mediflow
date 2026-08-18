"use client";
/* ============================================================
   PLANTILLA "CONSULTORIO" — funciona con CERO fotos.

   Es su razón de existir: la clínica que no tiene material
   fotográfico decente igual necesita un sitio que no se vea
   vacío. La portada es color, tipografía y datos; el patrón del
   hero es un SVG en data-uri, no una imagen. Lo que manda es la
   lista de precios y el horario.

   AQUÍ NO SE PINTA NINGUNA FOTO. Ni portada, ni galería, ni
   avatares: los doctores salen con sus iniciales. Si alguna vez
   hace falta añadir una, es otra plantilla, no esta.
   ============================================================ */
import { useState, useEffect } from "react";
import { Facebook, Instagram, MapPin, MessageCircle, Phone, Zap } from "lucide-react";
import type { TemplateProps } from "../_shared/types";
import { useLiveClinic } from "../_shared/live-preview";
import { Txt, useEnEdicion } from "../_shared/edit-context";
// landing-address-parts y NO landing-address: este archivo viaja al navegador
// de los pacientes, y el módulo grande arrastra el manifiesto de las ocho
// plantillas (17 KB) sin que la página pública lo necesite para nada.
import { dirClinica, dirCopia, dirFaq, dirSeccion, dirServicio, dirTestimonio } from "@/lib/landing-address-parts";
import { tint, shade, alpha } from "../_shared/landing-utils";
import {
  copyMap, copyValue, faqList, msiPlazos, sectionMap, sectionSubtitle, sectionTitle,
  serviceList, showSection, testimonialList, urgentText, weekSchedule,
} from "../_shared/landing-data";
import { StarRow } from "../_shared/landing-pieces";
import { BookingModal } from "../_shared/booking-modal";
import { useBookingReopen, type PendingBooking } from "../_shared/booking-session";

/** Patrón geométrico del hero: SVG en data-uri, cero peticiones y cero fotos. */
function patronHero(): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">` +
    `<g fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round">` +
    `<circle cx="30" cy="30" r="14"/><circle cx="90" cy="90" r="14"/>` +
    `<path d="M52 8v44M8 52h44"/><path d="M112 68v44M68 112h44"/>` +
    `</g></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

export function TemplateConsultorio({ clinic: publicada }: TemplateProps) {
  // En /dashboard/landing esto trae lo que la clínica lleva escrito sin
  // guardar; en la página pública devuelve `publicada` tal cual.
  const clinic = useLiveClinic(publicada);
  const acento = clinic.landingThemeColor ?? "#1d4ed8";
  const acentoOsc = shade(acento, 0.3);
  const acentoCl = tint(acento, 0.9);
  const tinta = shade(acento, 0.82);
  const gris = "#5a6579";
  const linea = tint(acento, 0.87);
  const fondo2 = tint(acento, 0.965);
  /* Ámbar de AVISO. Es el único color que no deriva del acento y es a
     propósito: marca urgencias y el hueco destacado. Un aviso que se pinta
     del mismo color que todo lo demás deja de ser un aviso. */
  const aviso = "#f6b93b";
  const avisoInk = "#3a2a00";

  const S = sectionMap(clinic);
  const servicios = serviceList(clinic);
  const doctores = clinic.users ?? [];
  const testimonios = testimonialList(clinic);
  const faqs = faqList(clinic);
  const horario = weekSchedule(clinic);
  const urgencias = urgentText(clinic);
  const msi = msiPlazos(clinic);
  const wa = clinic.landingWhatsapp ? `https://wa.me/${clinic.landingWhatsapp.replace(/\D/g, "")}` : null;

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

  /* Solo dentro del lienzo del editor. En la página pública es SIEMPRE false. */
  const editando = useEnEdicion();
  /* El texto suelto que reescribió la clínica. `C(clave)` devuelve null si no
     lo tocó, y entonces <Txt> pinta el literal de siempre. */
  const copias = copyMap(clinic);
  const C = (clave: string) => copyValue(copias, clave);

  const verPrecios = showSection(S, "servicios", servicios.length > 0);
  const verEquipo = showSection(S, "equipo", doctores.length > 0);
  const verOpiniones = showSection(S, "opiniones", testimonios.length > 0 || !!google);
  const verFaq = showSection(S, "faq", faqs.length > 0);

  const hoy = horario.find(d => d.hoy);
  const primerPrecio = servicios.find(s => s.price)?.price ?? null;

  /* Los cuatro datos del hero: solo hechos capturados por la clínica. */
  /* `clave` solo en los dos que son LITERALES. Los otros dos se construyen —el
     nombre del tratamiento más barato en minúsculas y los años con la ciudad
     dentro—, y como texto plano se guardaría la mezcla ya montada. */
  const datos: { valor: string; etiqueta: string; destacado?: boolean; clave?: string }[] = [];
  if (hoy?.open) datos.push({ valor: hoy.open.split("–")[1]?.trim() ?? hoy.open, etiqueta: "hoy cerramos a las", destacado: true, clave: "datos.hoyCierra" });
  if (primerPrecio) datos.push({ valor: primerPrecio, etiqueta: servicios.find(s => s.price)!.name.toLowerCase() });
  if (clinic.landingYearsExperience) datos.push({ valor: String(clinic.landingYearsExperience), etiqueta: clinic.city ? `años en ${clinic.city}` : "años de experiencia" });
  if (google?.rating) datos.push({ valor: `${google.rating} ★`, etiqueta: `${google.total} reseñas en Google` });
  else if (clinic.landingPatients) datos.push({ valor: clinic.landingPatients, etiqueta: "pacientes atendidos", clave: "datos.pacientes" });

  const nav: { href: string; label: string }[] = [
    ...(verPrecios ? [{ href: "#precios", label: "Precios" }] : []),
    { href: "#horarios", label: "Horarios" },
    ...(verEquipo ? [{ href: "#equipo", label: "Dentistas" }] : []),
    ...(verOpiniones ? [{ href: "#opiniones", label: "Opiniones" }] : []),
  ];

  const btn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    height: 50, padding: "0 24px", borderRadius: 10, fontWeight: 600, fontSize: 15.5,
    border: "2px solid transparent", cursor: "pointer", textDecoration: "none",
    fontFamily: "inherit", transition: ".15s",
  };
  const btnP: React.CSSProperties = { ...btn, background: acento, color: "#fff" };
  const btnA: React.CSSProperties = { ...btn, background: aviso, color: avisoInk };
  const btnO: React.CSSProperties = { ...btn, background: "#fff", borderColor: linea, color: tinta };
  const btnSm: React.CSSProperties = { height: 40, padding: "0 16px", fontSize: 14, borderWidth: 1 };
  const kicker: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: 11.5, letterSpacing: ".16em", textTransform: "uppercase",
    color: acento, display: "block", marginBottom: 10,
  };
  const h2: React.CSSProperties = { fontSize: "clamp(26px,3.2vw,36px)", fontWeight: 600, letterSpacing: "-.025em", lineHeight: 1.12, margin: 0 };
  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ fontFamily: "var(--font-sans)", color: tinta, background: "#fff", fontSize: 16, lineHeight: 1.6 }}>
      <style>{`
        .co-wrap { max-width:1120px; margin:0 auto; padding:0 20px; }
        .co-sec { padding:60px 0; }
        .co-links a:hover { color:${acento}; }
        .co-pr:hover { background:${acentoCl}; }
        .co-datos { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; }
        .co-cab { display:grid; grid-template-columns:1fr 110px 130px 130px; gap:14px; }
        .co-fila { display:grid; grid-template-columns:1fr 110px 130px 130px; gap:14px; align-items:center; }
        .co-horarios { display:grid; grid-template-columns:1.1fr .9fr; gap:20px; }
        .co-equipo { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
        .co-res { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
        .co-ftop { display:grid; grid-template-columns:1.4fr 1fr 1fr; gap:32px; }
        @media (max-width:900px) {
          .co-datos { grid-template-columns:repeat(2,1fr); }
          .co-horarios, .co-equipo, .co-res, .co-ftop { grid-template-columns:1fr; }
          .co-links { display:none !important; }
          .co-cab { display:none; }
          .co-fila { grid-template-columns:1fr auto; gap:8px 14px; }
        }
        @media (max-width:560px) {
          .co-sec { padding:44px 0; }
          .co-datos { grid-template-columns:1fr; }
        }
      `}</style>

      {/* ============ BARRA SUPERIOR ============ */}
      <div style={{ background: tinta, color: tint(acento, 0.7), fontSize: 14 }}>
        <div className="co-wrap" style={{ display: "flex", alignItems: "center", gap: 20, minHeight: 44, flexWrap: "wrap" }}>
          {clinic.phone && <a href={`tel:${clinic.phone}`} style={{ ...mono, textDecoration: "none", fontWeight: 500, color: "#fff" }}>📞 {clinic.phone}</a>}
          {clinic.address && <span>{clinic.address}{clinic.city ? ` · ${clinic.city}` : ""}</span>}
          {hoy?.open && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, marginLeft: "auto" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 0 3px rgba(74,222,128,.22)" }} />
              <span style={mono}>Hoy {hoy.open}</span>
            </span>
          )}
        </div>
      </div>

      {/* ============ NAV ============ */}
      <nav style={{ position: "sticky", top: 0, zIndex: 40, background: "#fff", borderBottom: `1px solid ${linea}` }}>
        <div className="co-wrap" style={{ display: "flex", alignItems: "center", gap: 14, height: 70 }}>
          <a href="#" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", marginRight: "auto", minWidth: 0 }}>
            <span style={{ width: 40, height: 40, borderRadius: 10, background: acento, color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, ...mono, fontSize: 16, flex: "0 0 auto" }}>
              {clinic.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
            </span>
            <span style={{ minWidth: 0 }}>
              <b style={{ display: "block", fontSize: 16.5 }}>{clinic.name}</b>
              <span style={{ display: "block", fontSize: 12, color: gris }}>
                {clinic.specialty}{clinic.landingYearsExperience ? ` · desde hace ${clinic.landingYearsExperience} años` : ""}
              </span>
            </span>
          </a>
          <div className="co-links" style={{ display: "flex", gap: 22 }}>
            {nav.map(l => <a key={l.href} href={l.href} style={{ textDecoration: "none", fontSize: 14.5, fontWeight: 500, color: shade(acento, 0.5) }}>{l.label}</a>)}
          </div>
          <Txt as="button" type="button" onClick={() => abrir()} style={{ ...btnP, ...btnSm }}
            campo={dirCopia("nav.cta")} etiqueta="Botón de reservar de la barra" linea maxLen={40}
            valor={C("nav.cta")} porDefecto="Agendar" />
        </div>
      </nav>

      {/* ============ HERO SIN NINGUNA FOTO ============ */}
      <header style={{ position: "relative", background: acento, color: "#fff", overflow: "hidden" }}>
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0, opacity: .09,
          backgroundImage: patronHero(), backgroundRepeat: "repeat", backgroundSize: "120px 120px",
        }} />
        <div className="co-wrap" style={{ position: "relative", padding: "64px 20px 0" }}>
          <Txt as="h1" style={{ fontSize: "clamp(34px,5vw,56px)", maxWidth: "17ch", marginBottom: 18, fontWeight: 600, letterSpacing: "-.025em", lineHeight: 1.12 }}
            campo={dirClinica("landingTagline")} etiqueta="Eslogan" maxLen={300}
            valor={clinic.landingTagline} porDefecto={clinic.name} />
          {(clinic.description || editando) && (
            <Txt as="p" style={{ fontSize: 18, color: tint(acento, 0.82), maxWidth: "50ch", margin: "0 0 28px" }}
              campo={dirClinica("description")} etiqueta="Descripción de la clínica" maxLen={5000}
              valor={clinic.description} />
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 44 }}>
            <Txt as="button" type="button" onClick={() => abrir()} style={btnA}
              campo={dirCopia("hero.cta")} etiqueta="Botón principal de la portada" linea maxLen={60}
              valor={C("hero.cta")} porDefecto="Agendar cita →" />
            {verPrecios && (
              <Txt as="a" href="#precios" style={{ ...btnO, background: "transparent", borderColor: "rgba(255,255,255,.4)", color: "#fff" }}
                campo={dirCopia("hero.cta2")} etiqueta="Botón de precios de la portada" linea maxLen={60}
                valor={C("hero.cta2")} porDefecto="Ver lista de precios" />
            )}
          </div>
          {datos.length > 0 && (
            <div className="co-datos" style={{ background: "rgba(255,255,255,.22)", borderRadius: "10px 10px 0 0", overflow: "hidden", transform: "translateY(1px)" }}>
              {datos.map(d => (
                <div key={d.etiqueta} style={{
                  background: d.destacado ? aviso : acento,
                  color: d.destacado ? avisoInk : "#fff",
                  padding: "22px 20px",
                }}>
                  <b style={{ display: "block", ...mono, fontSize: 26, fontWeight: 600, letterSpacing: "-.02em" }}>{d.valor}</b>
                  <Txt as="span" style={{ fontSize: 13.5, color: d.destacado ? alpha(avisoInk, 0.75) : tint(acento, 0.75) }}
                    campo={d.clave ? dirCopia(d.clave) : null} etiqueta="Leyenda del dato" linea maxLen={60}
                    valor={d.clave ? C(d.clave) : null} porDefecto={d.etiqueta} />
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ============ URGENCIAS ============ */}
      {urgencias && (
        <div style={{ background: tinta, color: "#fff", padding: "26px 0" }}>
          <div className="co-wrap" style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
            <span style={{ width: 52, height: 52, borderRadius: 14, background: alpha(aviso, 0.16), color: aviso, display: "grid", placeItems: "center", flex: "0 0 auto" }}>
              <Zap size={26} />
            </span>
            <div style={{ minWidth: 240, flex: 1 }}>
              <Txt as="b" style={{ display: "block", fontSize: 19, fontWeight: 600 }}
                campo={dirCopia("urgencias.titulo")} etiqueta="Titular de urgencias" linea maxLen={80}
                valor={C("urgencias.titulo")} porDefecto="¿Traes dolor ahorita?" />
              <Txt as="span" style={{ color: tint(acento, 0.66), fontSize: 14.5 }}
                campo={dirClinica("landingUrgentText")} etiqueta="Aviso de urgencias" maxLen={1000}
                valor={urgencias} />
            </div>
            {clinic.phone && (
              <Txt as="a" style={{ ...btnA, marginLeft: "auto" }} href={`tel:${clinic.phone}`}
                campo={dirCopia("urgencias.cta")} etiqueta="Botón de urgencias" linea maxLen={40}
                valor={C("urgencias.cta")} porDefecto="Llamar ahora" />
            )}
          </div>
        </div>
      )}

      {/* ============ LISTA DE PRECIOS ============ */}
      {verPrecios && (
        <section className="co-sec" id="precios">
          <div className="co-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("servicios.kicker")} etiqueta="Etiqueta de precios" linea maxLen={60}
              valor={C("servicios.kicker")} porDefecto="Lista de precios" />
            <Txt as="h2" style={h2} campo={dirSeccion("servicios", "titulo")} etiqueta="Título de la lista de precios" linea maxLen={160}
              valor={S.servicios?.titulo} porDefecto="Lo que cuesta cada cosa" />
            {(sectionSubtitle(S, "servicios") || editando) && (
              <Txt as="p" style={{ color: gris, margin: "8px 0 0", maxWidth: "60ch" }}
                campo={dirSeccion("servicios", "subtitulo")} etiqueta="Nota bajo los precios" maxLen={500}
                valor={S.servicios?.subtitulo} />
            )}

            <div style={{ border: `1px solid ${linea}`, borderRadius: 10, overflow: "hidden", marginTop: 26 }}>
              <div className="co-cab" style={{
                padding: "13px 22px", background: fondo2, borderBottom: `1px solid ${linea}`,
                ...mono, fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: gris,
              }}>
                <Txt as="span" campo={dirCopia("servicios.colTratamiento")} etiqueta="Columna «tratamiento»" linea maxLen={40}
                  valor={C("servicios.colTratamiento")} porDefecto="Tratamiento" /><Txt as="span" campo={dirCopia("servicios.colDuracion")} etiqueta="Columna «duración»" linea maxLen={40}
                  valor={C("servicios.colDuracion")} porDefecto="Duración" /><Txt as="span" campo={dirCopia("servicios.colPrecio")} etiqueta="Columna «precio»" linea maxLen={40}
                  valor={C("servicios.colPrecio")} porDefecto="Precio" /><span />
              </div>
              {servicios.map((s, i) => (
                <div key={s.name + i} className="co-fila co-pr" style={{
                  padding: "16px 22px", borderBottom: i === servicios.length - 1 ? 0 : `1px solid ${linea}`, transition: ".12s",
                }}>
                  <div>
                    <Txt as="b" style={{ display: "block", fontSize: 16.5, fontWeight: 600 }}
                      campo={dirServicio(s.i, "name")} etiqueta="Nombre del tratamiento" linea requerido maxLen={120}
                      valor={s.name} />
                    {(s.desc || editando) && (
                      <Txt as="span" style={{ fontSize: 13.5, color: gris }}
                        campo={dirServicio(s.i, "desc")} etiqueta="Descripción del tratamiento" maxLen={400}
                        valor={s.desc} />
                    )}
                  </div>
                  <span style={{ ...mono, fontSize: 13.5, color: gris }}>{s.durationMin ? `${s.durationMin} min` : ""}</span>
                  {/* El precio se pinta vacío cuando no hay: <Txt> no pinta nada
                      sin texto, así que la celda se queda igual de vacía que hoy
                      y la rejilla no se mueve. En el lienzo sí aparece, para
                      poder ponerle precio. */}
                  {s.price || editando
                    ? <Txt as="span" style={{ ...mono, fontSize: 18, fontWeight: 600 }}
                        campo={dirServicio(s.i, "price")} etiqueta="Precio" linea maxLen={40}
                        valor={s.price} />
                    : <span style={{ ...mono, fontSize: 18, fontWeight: 600 }}>{""}</span>}
                  <Txt as="button" type="button" onClick={() => abrir({ service: s.name })} style={{ ...btnO, ...btnSm }}
                    campo={dirCopia("servicios.cta")} etiqueta="Botón de cada fila" linea maxLen={40}
                    valor={C("servicios.cta")} porDefecto="Agendar" />
                </div>
              ))}
            </div>

            {msi.length > 0 && (
              <p style={{ fontSize: 14, color: gris, margin: "14px 0 0" }}>
                Meses sin intereses disponibles: {msi.join(", ")} pagos con tarjetas participantes.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ============ HORARIOS Y MAPA ============ */}
      <section className="co-sec" id="horarios" style={{ background: fondo2 }}>
        <div className="co-wrap">
          <Txt as="span" style={kicker} campo={dirCopia("contacto.kicker")} etiqueta="Etiqueta de horarios" linea maxLen={60}
              valor={C("contacto.kicker")} porDefecto="Horarios y ubicación" />
          <Txt as="h2" style={h2} campo={dirSeccion("contacto", "titulo")} etiqueta="Título de horarios" linea maxLen={160}
            valor={S.contacto?.titulo} porDefecto="Cuándo y dónde" />
          <div className="co-horarios" style={{ marginTop: 26 }}>
            <div style={{ border: `1px solid ${linea}`, borderRadius: 10, padding: 26, background: "#fff" }}>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {horario.map(d => (
                  <li key={d.label} style={{
                    display: "flex", justifyContent: "space-between", gap: 16, padding: "11px 14px",
                    margin: "0 -14px", borderBottom: `1px solid ${d.hoy ? "transparent" : linea}`, fontSize: 15.5,
                    background: d.hoy ? acentoCl : "transparent", borderRadius: d.hoy ? 8 : 0,
                    color: d.hoy ? acentoOsc : d.open ? tinta : gris, fontWeight: d.hoy ? 600 : 400,
                  }}>
                    <span>{d.label}{d.hoy ? " · hoy" : ""}</span>
                    {/* Solo el día CERRADO es texto editable: el horario abierto
                        es el dato de la agenda. */}
                    {d.open
                      ? <time style={{ ...mono, fontSize: 14.5 }}>{d.open}</time>
                      : <Txt as="time" style={{ ...mono, fontSize: 14.5 }}
                          campo={dirCopia("contacto.cerrado")} etiqueta="Cómo se dice «cerrado»" linea maxLen={40}
                          valor={C("contacto.cerrado")} porDefecto="Cerrado" />}
                  </li>
                ))}
              </ul>
              {clinic.address && <p style={{ fontSize: 15, color: gris, margin: "18px 0 6px" }}>{clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</p>}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
                {clinic.address && (
                  <Txt as="a" style={{ ...btnP, ...btnSm }} href={`https://maps.google.com/?q=${encodeURIComponent(`${clinic.address} ${clinic.city ?? ""}`)}`} target="_blank" rel="noopener noreferrer"
                    campo={dirCopia("contacto.comoLlegar")} etiqueta="Botón del mapa" linea maxLen={60}
                    valor={C("contacto.comoLlegar")} porDefecto="Cómo llegar" />
                )}
                {clinic.phone && (
                  <Txt as="a" style={{ ...btnO, ...btnSm }} href={`tel:${clinic.phone}`}
                    campo={dirCopia("contacto.llamar")} etiqueta="Botón de llamar" linea maxLen={40}
                    valor={C("contacto.llamar")} porDefecto="Llamar" prefijo=" " unido
                    antes={<Phone size={14} />} />
                )}
              </div>
            </div>
            <div style={{ border: `1px solid ${linea}`, borderRadius: 10, overflow: "hidden", minHeight: 340, background: "#fff" }}>
              {clinic.landingMapEmbed
                ? <iframe src={clinic.landingMapEmbed} loading="lazy" title={`Mapa de ${clinic.name}`} style={{ width: "100%", height: "100%", minHeight: 340, border: 0, display: "block" }} />
                : <div style={{ minHeight: 340, display: "grid", placeItems: "center", color: acento, gap: 10 }}>
                    <MapPin size={40} strokeWidth={1.5} />
                    <span style={{ fontSize: 14, color: gris }}>{clinic.city ?? "Consulta la dirección arriba"}</span>
                  </div>}
            </div>
          </div>
        </div>
      </section>

      {/* ============ DENTISTAS (iniciales, sin foto) ============ */}
      {verEquipo && (
        <section className="co-sec" id="equipo">
          <div className="co-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("equipo.kicker")} etiqueta="Etiqueta de dentistas" linea maxLen={60}
              valor={C("equipo.kicker")} porDefecto="Quién te atiende" />
            {/* Con varios doctores el texto por defecto se CONSTRUYE
                ("3 dentistas, siempre los mismos"). <Txt> nunca guarda el
                default, solo lo enseña, así que se le pasa el que toque. */}
            <Txt as="h2" style={h2} campo={dirSeccion("equipo", "titulo")} etiqueta="Título de dentistas" linea maxLen={160}
              valor={S.equipo?.titulo}
              porDefecto={doctores.length === 1 ? "Tu dentista" : `${doctores.length} dentistas, siempre los mismos`} />
            <div className="co-equipo" style={{ marginTop: 26 }}>
              {doctores.map(d => (
                <div key={d.id} style={{ display: "flex", gap: 16, alignItems: "center", border: `1px solid ${linea}`, borderRadius: 10, padding: "18px 20px", flexWrap: "wrap" }}>
                  <span style={{ width: 52, height: 52, borderRadius: "50%", background: acentoCl, color: acentoOsc, display: "grid", placeItems: "center", fontWeight: 600, fontSize: 17, flex: "0 0 auto", ...mono }}>
                    {d.firstName[0]}{d.lastName[0]}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b style={{ display: "block", fontSize: 16.5 }}>Dr/a. {d.firstName} {d.lastName}</b>
                    {d.specialty && <span style={{ display: "block", fontSize: 14, color: acento, fontWeight: 500 }}>{d.specialty}</span>}
                    {d.services.length > 0 && <small style={{ display: "block", ...mono, fontSize: 12, color: gris, marginTop: 2 }}>{d.services.slice(0, 3).join(" · ")}</small>}
                  </div>
                  <Txt as="button" type="button" onClick={() => abrir({ doctorId: d.id })} style={{ ...btnO, ...btnSm, marginLeft: "auto" }}
                    campo={dirCopia("equipo.cta")} etiqueta="Botón de cada doctor" linea maxLen={40}
                    valor={C("equipo.cta")} porDefecto="Agendar" />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ OPINIONES ============ */}
      {verOpiniones && (
        <section className="co-sec" id="opiniones" style={{ background: fondo2 }}>
          <div className="co-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("opiniones.kicker")} etiqueta="Etiqueta de opiniones" linea maxLen={60}
              valor={C("opiniones.kicker")} porDefecto="Opiniones" />
            {/* Con ficha de Google el titular es una cadena CONSTRUIDA y no se
                instrumenta: guardarla congelaría los números de hoy. */}
            {google?.rating
              ? <h2 style={h2}>{`${google.rating} en Google, ${google.total} reseñas`}</h2>
              : <Txt as="h2" style={h2} campo={dirSeccion("opiniones", "titulo")} etiqueta="Título de opiniones" linea maxLen={160}
                  valor={S.opiniones?.titulo} porDefecto="Lo que dicen nuestros pacientes" />}
            <div className="co-res" style={{ marginTop: 26 }}>
              {/* `dir` es null en las reseñas de Google: son de Google, no de la
                  clínica, y no hay dónde guardarlas si alguien las reescribe. */}
              {(testimonios.length > 0
                ? testimonios.map(t => ({ text: t.text, name: t.name, rating: t.rating, meta: t.meta, dir: t.i as number | null }))
                : (google?.reviews ?? []).slice(0, 3).map((r: any) => ({ text: r.text, name: r.author_name ?? "Paciente", rating: r.rating ?? 5, meta: r.relative_time_description ?? null, dir: null as number | null }))
              ).slice(0, 6).map((t, i) => (
                <article key={i} style={{ border: `1px solid ${linea}`, borderRadius: 10, padding: 20, background: "#fff" }}>
                  <StarRow value={t.rating} color={aviso} />
                  {/* Las comillas van como prefijo/sufijo y no dentro del texto:
                      si se guardaran, la siguiente edición las duplicaría. */}
                  <Txt as="p" style={{ margin: "9px 0 14px", fontSize: 15 }}
                    campo={t.dir === null ? null : dirTestimonio(t.dir, "text")}
                    etiqueta="Opinión" requerido maxLen={800}
                    valor={t.text} prefijo="“" sufijo="”" />
                  <Txt as="b" style={{ fontSize: 14 }}
                    campo={t.dir === null ? null : dirTestimonio(t.dir, "name")}
                    etiqueta="Quién lo dice" linea maxLen={80} valor={t.name} />
                  {t.meta && (
                    <Txt as="small" style={{ color: gris, fontSize: 13 }}
                      campo={t.dir === null ? null : dirTestimonio(t.dir, "meta")}
                      etiqueta="Cuándo / de dónde" linea maxLen={80}
                      valor={t.meta} prefijo=" · " />
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ FAQ ============ */}
      {verFaq && (
        <section className="co-sec">
          <div className="co-wrap">
            <Txt as="span" style={kicker} campo={dirCopia("faq.kicker")} etiqueta="Etiqueta de preguntas" linea maxLen={60}
              valor={C("faq.kicker")} porDefecto="Preguntas frecuentes" />
            <Txt as="h2" style={h2} campo={dirSeccion("faq", "titulo")} etiqueta="Título de preguntas" linea maxLen={160}
              valor={S.faq?.titulo} porDefecto="Lo que más nos preguntan" />
            <div style={{ marginTop: 26, border: `1px solid ${linea}`, borderRadius: 10, overflow: "hidden" }}>
              {faqs.map((f, i) => (
                <details key={i} open={i === 0} style={{ borderBottom: i === faqs.length - 1 ? 0 : `1px solid ${linea}` }}>
                  <Txt as="summary" style={{ cursor: "pointer", padding: "16px 22px", fontWeight: 600, fontSize: 16, listStyle: "none", background: "#fff" }}
                    campo={dirFaq(f.i, "q")} etiqueta="Pregunta" linea requerido maxLen={200}
                    valor={f.q} />
                  <Txt as="p" style={{ margin: 0, padding: "0 22px 20px", color: gris }}
                    campo={dirFaq(f.i, "a")} etiqueta="Respuesta" requerido maxLen={1200}
                    valor={f.a} />
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ CTA ============ */}
      <section style={{ background: acento, color: "#fff", padding: "56px 0", textAlign: "center" }}>
        <div className="co-wrap">
          <Txt as="h2" style={{ ...h2, fontSize: "clamp(26px,3.4vw,38px)", marginBottom: 12 }}
            campo={dirSeccion("reservar", "titulo")} etiqueta="Título del cierre" linea maxLen={160}
            valor={S.reservar?.titulo} porDefecto="Agenda en dos minutos, sin llamar" />
          <Txt as="p" style={{ color: tint(acento, 0.82), margin: "0 0 26px" }}
            campo={dirSeccion("reservar", "subtitulo")} etiqueta="Bajada del cierre" maxLen={500}
            valor={S.reservar?.subtitulo} porDefecto="Eliges día y hora y te confirmamos por WhatsApp." />
          <Txt as="button" type="button" onClick={() => abrir()} style={btnA}
            campo={dirCopia("reservar.cta")} etiqueta="Botón del cierre" linea maxLen={60}
            valor={C("reservar.cta")} porDefecto="Agendar mi cita →" />
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer style={{ background: tinta, color: tint(acento, 0.62), padding: "44px 0 20px" }}>
        <div className="co-wrap">
          <div className="co-ftop">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255,255,255,.12)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, ...mono }}>
                  {clinic.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <b style={{ color: "#fff", fontSize: 16.5 }}>{clinic.name}</b>
              </div>
              {clinic.address && <p style={{ fontSize: 14.5, margin: 0, maxWidth: "34ch" }}>{clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</p>}
              {msi.length > 0 && (
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
                  {msi.map(m => (
                    <span key={m} style={{ border: "1px solid rgba(255,255,255,.18)", borderRadius: 6, padding: "5px 10px", ...mono, fontSize: 11 }}>{m} MSI</span>
                  ))}
                </div>
              )}
            </div>
            {verPrecios && (
              <div>
                <h4 style={{ color: "#fff", ...mono, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", margin: "0 0 12px", fontWeight: 500 }}>Tratamientos</h4>
                {servicios.slice(0, 5).map(s => (
                  <a key={s.name} href="#precios" style={{ display: "block", textDecoration: "none", padding: "4px 0", fontSize: 14.5 }}>{s.name}</a>
                ))}
              </div>
            )}
            <div>
              <h4 style={{ color: "#fff", ...mono, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", margin: "0 0 12px", fontWeight: 500 }}>Contacto</h4>
              {clinic.phone && <a href={`tel:${clinic.phone}`} style={{ display: "block", textDecoration: "none", padding: "4px 0", fontSize: 14.5, ...mono }}>{clinic.phone}</a>}
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" style={{ display: "block", textDecoration: "none", padding: "4px 0", fontSize: 14.5 }}>WhatsApp</a>}
              {clinic.email && <a href={`mailto:${clinic.email}`} style={{ display: "block", textDecoration: "none", padding: "4px 0", fontSize: 14.5 }}>{clinic.email}</a>}
              {clinic.landingInstagram && <a href={clinic.landingInstagram} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", padding: "4px 0", fontSize: 14.5 }}><Instagram size={14} /> Instagram</a>}
              {clinic.landingFacebook && <a href={clinic.landingFacebook} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", padding: "4px 0", fontSize: 14.5 }}><Facebook size={14} /> Facebook</a>}
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,.12)", marginTop: 30, paddingTop: 16, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, fontSize: 13 }}>
            <span>© {new Date().getFullYear()} {clinic.name}</span>
            <span>Hecho con <a href="/" style={{ color: "#fff", fontWeight: 700, textDecoration: "none" }}>DaleControl</a></span>
          </div>
        </div>
      </footer>

      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer"
          style={{ position: "fixed", right: 18, bottom: 18, zIndex: 60, display: "inline-flex", alignItems: "center", gap: 9, background: "#25d366", color: "#0b2e1c", padding: "13px 18px", borderRadius: 999, textDecoration: "none", fontWeight: 600, fontSize: 15, boxShadow: "0 10px 26px -8px rgba(37,211,102,.6)" }}>
          <MessageCircle size={22} /> WhatsApp
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
