/* ═══════════════════════════════════════════════════════════════════════
   PIEZAS COMPARTIDAS DE LA WEB PÚBLICA DE INMUEBLES.

   Todo lo que se repite entre bloques y entre plantillas: la tarjeta del
   inmueble, la fila, el escaparate, los botones, las pastillas y los
   iconos. Las plantillas cambian el MAQUETADO; estas piezas cambian de
   forma con `variante`, no de contenido.

   ── POR QUÉ <img> Y NO next/image ────────────────────────────────
   `images.remotePatterns` de next.config.mjs solo autoriza
   images.unsplash.com, y las fotos de los inmuebles viven en Supabase
   Storage: next/image las rechazaría en tiempo de ejecución con un 400 y
   la ficha saldría sin fotos. Además el optimizador cuesta una función por
   imagen en cada visita de una página que ya está cacheada por ISR. Se usa
   <img> con `width`/`height` cuando la foto los trae (CLS 0) y `loading`
   diferido salvo en la primera de la portada.

   Sin "use client": son server components puros. El único JavaScript de la
   página pública es el de los dos bloques que de verdad lo necesitan (el
   buscador y el mapa bajo demanda).
   ═══════════════════════════════════════════════════════════════════════ */

import type { ReactNode } from "react";
import {
  banos as fmtBanos,
  cocheras as fmtCocheras,
  fotoPortada,
  precioAnunciado,
  recamaras as fmtRecamaras,
  superficie,
  ubicacionPublica,
  type RealtyWebInmuebleDTO,
} from "@/lib/realty/landing";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  REALTY_PROPERTY_STATUS_UI,
} from "@/lib/realty/types";

/* ── Iconos (SVG en línea: cero peticiones, cero librería) ────────── */

export function IcoWhatsApp({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.5 14.4c-.3-.2-1.8-.9-2-1s-.5-.2-.7.1-.8 1-1 1.2-.4.2-.7 0a8 8 0 0 1-2.4-1.5 9 9 0 0 1-1.6-2c-.2-.3 0-.5.1-.7l.5-.6.3-.5v-.5l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4a3 3 0 0 0-1 2.2c0 1.3 1 2.6 1.1 2.8s1.8 2.9 4.5 4a15 15 0 0 0 1.5.5 3.6 3.6 0 0 0 1.6.1c.5 0 1.6-.6 1.8-1.3s.2-1.2.2-1.3zM12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Z" />
    </svg>
  );
}

export function IcoRecorrido({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <ellipse cx="12" cy="12" rx="10" ry="4.5" />
      <path d="M2 12a10 4.5 0 0 0 20 0" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IcoMapa({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

export function IcoCheck({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function IcoFlecha({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

/* ── Foto ─────────────────────────────────────────────────────────── */

export function Foto({
  url,
  alt,
  width,
  height,
  prioridad,
  className,
}: {
  url: string;
  alt: string;
  width?: number | null;
  height?: number | null;
  prioridad?: boolean;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      width={width ?? undefined}
      height={height ?? undefined}
      loading={prioridad ? "eager" : "lazy"}
      decoding="async"
      className={className}
    />
  );
}

/** Hueco cuando el inmueble todavía no tiene fotos. */
export function SinFoto({ etiqueta }: { etiqueta: string }) {
  return (
    <div className="dcrw-sinfoto" aria-hidden="true">
      <span>{etiqueta}</span>
    </div>
  );
}

/* ── Botones y pastillas ──────────────────────────────────────────── */

export function Boton({
  href,
  tono = "primario",
  externo,
  children,
}: {
  href: string;
  tono?: "primario" | "secundario" | "fantasma" | "whatsapp";
  externo?: boolean;
  children: ReactNode;
}) {
  // <a> y nunca <Link>: la mitad de estos enlaces salen del sitio (WhatsApp,
  // Google Maps) y del resto no queremos que el router prefetchee la ficha
  // de los doce inmuebles del listado en cuanto se pinta la página.
  return (
    <a
      href={href}
      className={`dcrw-btn dcrw-btn-${tono}`}
      {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

export function Pastilla({ children, tono }: { children: ReactNode; tono?: string }) {
  return <span className={`dcrw-pastilla ${tono ? `dcrw-pastilla-${tono}` : ""}`.trim()}>{children}</span>;
}

/* ── Datos del inmueble ───────────────────────────────────────────── */

/** "3 recámaras · 2.5 baños · 2 cocheras · 180 m²". Se cae lo que no hay. */
export function fichaCorta(inm: RealtyWebInmuebleDTO): string[] {
  return [
    fmtRecamaras(inm.recamaras),
    fmtBanos(inm.banos, inm.mediosBanos),
    fmtCocheras(inm.cocheras),
    superficie(inm.construidoM2) ?? superficie(inm.terrenoM2),
  ].filter((s): s is string => s !== null);
}

export function DatosInmueble({ inm }: { inm: RealtyWebInmuebleDTO }) {
  const datos = fichaCorta(inm);
  if (datos.length === 0) return null;
  return (
    <ul className="dcrw-datos">
      {datos.map((d) => (
        <li key={d}>{d}</li>
      ))}
    </ul>
  );
}

/* ── La tarjeta del inmueble ──────────────────────────────────────── */

export interface TarjetaProps {
  inm: RealtyWebInmuebleDTO;
  href: string;
  cta: string;
  /** ¿Lleva la insignia de recorrido virtual? Lo decide el BLOQUE. */
  recorrido: boolean;
  etiquetaRecorrido: string;
  /** "rejilla" | "fila" | "escaparate" | "preventa" | "tablero" */
  forma?: string;
  /** La primera del listado se carga sin diferir (es la que entra en pantalla). */
  prioridad?: boolean;
  /** Etiqueta de estatus (solo donde el estatus comercial importa). */
  estatus?: string | null;
}

export function TarjetaInmueble({
  inm,
  href,
  cta,
  recorrido,
  etiquetaRecorrido,
  forma = "rejilla",
  prioridad,
  estatus,
}: TarjetaProps) {
  const portada = fotoPortada(inm);
  const donde = ubicacionPublica(inm);
  const tono = REALTY_PROPERTY_STATUS_UI[inm.status]?.tone ?? "neutral";

  return (
    <article className={`dcrw-tarjeta dcrw-tarjeta-${forma}`}>
      <a href={href} className="dcrw-tarjeta-foto" aria-label={inm.titulo}>
        {portada ? (
          <Foto
            url={portada.url}
            alt={inm.titulo}
            width={portada.width}
            height={portada.height}
            prioridad={prioridad}
          />
        ) : (
          <SinFoto etiqueta={REALTY_PROPERTY_KIND_LABELS[inm.kind] ?? "Inmueble"} />
        )}
        {recorrido ? (
          <span className="dcrw-insignia">
            <IcoRecorrido />
            {etiquetaRecorrido}
          </span>
        ) : null}
        {estatus ? <span className={`dcrw-estatus dcrw-estatus-${tono}`}>{estatus}</span> : null}
      </a>
      <div className="dcrw-tarjeta-cuerpo">
        <p className="dcrw-tarjeta-op">
          {REALTY_PROPERTY_KIND_LABELS[inm.kind] ?? "Inmueble"} ·{" "}
          {REALTY_OPERATION_LABELS[inm.operation] ?? ""}
        </p>
        <h3 className="dcrw-tarjeta-titulo">
          <a href={href}>{inm.titulo}</a>
        </h3>
        {donde ? <p className="dcrw-tarjeta-donde">{donde}</p> : null}
        <p className="dcrw-precio">{precioAnunciado(inm)}</p>
        <DatosInmueble inm={inm} />
        <span className="dcrw-tarjeta-cta">
          {cta} <IcoFlecha />
        </span>
      </div>
    </article>
  );
}

/* ── Pie ──────────────────────────────────────────────────────────── */

export function Pie({
  nombre,
  licencia,
  redes,
  aviso,
}: {
  nombre: string;
  licencia: string | null;
  redes: Array<{ url: string; nombre: string }>;
  aviso?: string;
}) {
  // La página es ISR: este año se congela hasta la siguiente regeneración,
  // que con revalidate=300 son cinco minutos del 1 de enero. Aceptable.
  const anio = new Date().getFullYear();
  return (
    <footer className="dcrw-pie">
      <div className="dcrw-ancho dcrw-pie-caja">
        <p className="dcrw-pie-marca">
          © {anio} {nombre}
        </p>
        {licencia ? <p className="dcrw-pie-licencia">{licencia}</p> : null}
        {redes.length > 0 ? (
          <nav className="dcrw-pie-redes" aria-label="Redes sociales">
            {redes.map((r) => (
              <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer">
                {r.nombre}
              </a>
            ))}
          </nav>
        ) : null}
        {aviso ? <p className="dcrw-pie-aviso">{aviso}</p> : null}
      </div>
    </footer>
  );
}
