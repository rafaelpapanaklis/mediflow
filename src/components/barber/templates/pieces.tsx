/* ═══════════════════════════════════════════════════════════════════════
   PIEZAS COMPARTIDAS DE LAS OCHO PLANTILLAS.

   Átomos sin estado: iconos, estrellas, fotos, horario, mapa, redes y el
   botón de reservar. Todo lo que se repite tal cual entre plantillas vive
   aquí; lo que las hace DISTINTAS (el orden de las secciones, cómo se
   trata la foto, la densidad, la tipografía) vive en cada plantilla y en
   su piel de skins.css.

   Sin "use client" y sin hooks: se pintan en el servidor para /b/[slug]
   (cero JavaScript en la página del cliente) y en el navegador para la
   vista previa del editor. Si alguna vez hace falta estado aquí, va en un
   archivo aparte — meter un hook en este rompería la página pública.

   Los iconos son SVG a mano y NO lucide-react a propósito: lucide
   construye sus componentes con forwardRef, que Next no deja llamar desde
   un Server Component. Además son doce trazos, no una dependencia.
   ═══════════════════════════════════════════════════════════════════════ */

import type { CSSProperties, ReactNode } from "react";
import {
  BARBER_WEB_DIAS,
  horarioBarberWeb,
  precioBarberWeb,
  duracionBarberWeb,
  urlFacebook,
  urlInstagram,
  urlTiktok,
  urlWhatsApp,
  type BarberWebConfig,
} from "@/lib/barber/landing";
import type { BarberWebServicio } from "./types";

/* ══════════════════════════════════════════════════════════════
   Iconos
   ══════════════════════════════════════════════════════════════ */

type IcoProps = { size?: number; className?: string };

const svg = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
  focusable: "false" as const,
});

export function IcoTijeras({ size = 18, className }: IcoProps) {
  return (
    <svg {...svg(size, className)}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

export function IcoNavaja({ size = 18, className }: IcoProps) {
  return (
    <svg {...svg(size, className)}>
      <path d="M3 15l9-9 5 5-9 9H3z" />
      <path d="M14 4l3-1 3 3-1 3" />
    </svg>
  );
}

export function IcoMapa({ size = 18, className }: IcoProps) {
  return (
    <svg {...svg(size, className)}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function IcoReloj({ size = 18, className }: IcoProps) {
  return (
    <svg {...svg(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function IcoTelefono({ size = 18, className }: IcoProps) {
  return (
    <svg {...svg(size, className)}>
      <path d="M6 3h3l2 5-2.5 1.5a12 12 0 006 6L16 13l5 2v3a2 2 0 01-2.2 2A17 17 0 014 5.2 2 2 0 016 3z" />
    </svg>
  );
}

export function IcoWhatsApp({ size = 18, className }: IcoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M12.04 2C6.6 2 2.2 6.4 2.2 11.84c0 1.74.46 3.44 1.32 4.94L2 22l5.36-1.4a9.9 9.9 0 004.68 1.19h.01c5.43 0 9.84-4.4 9.84-9.84C21.89 6.4 17.48 2 12.04 2zm0 18.03h-.01a8.2 8.2 0 01-4.17-1.14l-.3-.18-3.18.83.85-3.1-.2-.32a8.16 8.16 0 01-1.25-4.35c0-4.52 3.68-8.19 8.2-8.19a8.19 8.19 0 018.18 8.2c0 4.51-3.67 8.18-8.12 8.18zm4.5-6.13c-.25-.13-1.46-.72-1.69-.8-.22-.09-.39-.13-.55.12s-.63.8-.78.96c-.14.17-.28.19-.53.06a6.7 6.7 0 01-1.97-1.21 7.4 7.4 0 01-1.36-1.7c-.14-.24-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.14.17-.25.25-.41.09-.17.04-.31-.02-.44-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.25-.84.82-.84 2s.86 2.32.98 2.48c.12.17 1.7 2.6 4.12 3.65.58.25 1.03.4 1.38.51.58.19 1.1.16 1.52.1.46-.07 1.46-.6 1.66-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29z" />
    </svg>
  );
}

export function IcoInstagram({ size = 18, className }: IcoProps) {
  return (
    <svg {...svg(size, className)}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IcoFacebook({ size = 18, className }: IcoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H8v3h2v7h3v-7h2.5l.5-3H13v-2c0-.6.4-1 1-1z" />
    </svg>
  );
}

export function IcoTiktok({ size = 18, className }: IcoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M16.5 3c.4 2 1.7 3.4 3.5 3.7v2.8a6.6 6.6 0 01-3.5-1.1v5.9a5.4 5.4 0 11-5.4-5.4c.3 0 .5 0 .8.1v2.9a2.6 2.6 0 101.8 2.4V3h2.8z" />
    </svg>
  );
}

export function IcoEstrella({ size = 16, className, llena = true }: IcoProps & { llena?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={llena ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
    </svg>
  );
}

export function IcoFlecha({ size = 16, className }: IcoProps) {
  return (
    <svg {...svg(size, className)}>
      <line x1="4" y1="12" x2="19" y2="12" />
      <polyline points="13,6 19,12 13,18" />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════
   Estrellas
   ══════════════════════════════════════════════════════════════ */

export function Estrellas({ n, size = 15 }: { n: number; size?: number }) {
  const llenas = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span className="dcbw-estrellas" role="img" aria-label={`${llenas} de 5 estrellas`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <IcoEstrella key={i} size={size} llena={i < llenas} />
      ))}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
   Fotos

   Todas por <img> y no next/image: la página se sirve por ISR desde
   Vercel y las fotos viven en el bucket público de Supabase, ya
   comprimidas en el NAVEGADOR antes de subir (1600 px de lado, webp
   0.8). Pasarlas otra vez por el optimizador solo añade latencia y
   coste por transformación.

   `prioridad` es para la foto de portada, que es el LCP: esa carga
   ansiosa y todas las demás en diferido.
   ══════════════════════════════════════════════════════════════ */

export function Foto({
  src,
  alt,
  className,
  style,
  prioridad = false,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  prioridad?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading={prioridad ? "eager" : "lazy"}
      decoding="async"
    />
  );
}

/**
 * El hueco de una foto que todavía no existe.
 *
 * Solo se pinta DENTRO del editor (`editando`). En la página pública una
 * ranura vacía no deja rastro: nadie ve un rectángulo punteado con
 * "sube tu portada" en el sitio que manda por WhatsApp a sus clientes.
 */
export function HuecoFoto({
  etiqueta,
  className,
  style,
}: {
  etiqueta: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`dcbw-hueco ${className ?? ""}`} style={style}>
      <span>{etiqueta}</span>
    </div>
  );
}

/**
 * Foto de ranura con su hueco: pinta la foto si la hay; si no, el hueco
 * SOLO en el editor y nada en público. Las ocho plantillas la usan para
 * no repetir el mismo `if` ocho veces con criterios distintos.
 */
export function Ranura({
  url,
  etiqueta,
  alt,
  className,
  style,
  editando,
  prioridad,
}: {
  url: string | null;
  etiqueta: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  editando?: boolean;
  prioridad?: boolean;
}) {
  if (url) {
    return <Foto src={url} alt={alt} className={className} style={style} prioridad={prioridad} />;
  }
  if (!editando) return null;
  return <HuecoFoto etiqueta={etiqueta} className={className} style={style} />;
}

/* ══════════════════════════════════════════════════════════════
   El poste de barbero

   Franjas en CSS, no una imagen: escala sin pesar y hereda el acento.
   ══════════════════════════════════════════════════════════════ */

export function Poste({ className }: { className?: string }) {
  return <span className={`dcbw-poste ${className ?? ""}`} aria-hidden />;
}

/* ══════════════════════════════════════════════════════════════
   Botones y enlaces

   TODOS los enlaces de estas páginas son <a> y nunca <Link>: se pintan
   en el servidor, apuntan a rutas de otra terminal (el embudo de
   reserva es de T5) y no queremos que el router del cliente prefetchee
   una ruta que quizá aún no existe.
   ══════════════════════════════════════════════════════════════ */

export function Boton({
  href,
  children,
  className,
  variante = "primario",
  externo = false,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  variante?: "primario" | "fantasma" | "whatsapp";
  externo?: boolean;
}) {
  const extra = externo ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <a href={href} className={`dcbw-btn dcbw-btn-${variante} ${className ?? ""}`} {...extra}>
      {children}
    </a>
  );
}

/* ══════════════════════════════════════════════════════════════
   Servicios
   ══════════════════════════════════════════════════════════════ */

export function Precio({ n, className }: { n: number; className?: string }) {
  return <span className={`dcbw-precio ${className ?? ""}`}>{precioBarberWeb(n)}</span>;
}

export function Duracion({ min, className }: { min: number; className?: string }) {
  const t = duracionBarberWeb(min);
  if (!t) return null;
  return <span className={`dcbw-duracion ${className ?? ""}`}>{t}</span>;
}

/**
 * Los servicios agrupados por categoría, en el orden en que llegan.
 *
 * `general` (el default del schema) NO se pinta como encabezado: una
 * barbería que nunca tocó las categorías vería un título "general" encima
 * de toda su carta.
 */
export function porCategoria(
  servicios: BarberWebServicio[],
): { categoria: string | null; items: BarberWebServicio[] }[] {
  const orden: string[] = [];
  const mapa = new Map<string, BarberWebServicio[]>();
  for (const s of servicios) {
    const k = (s.categoria || "general").trim().toLowerCase();
    if (!mapa.has(k)) {
      mapa.set(k, []);
      orden.push(k);
    }
    mapa.get(k)!.push(s);
  }
  const soloUna = orden.length === 1;
  return orden.map((k) => ({
    categoria: soloUna || k === "general" ? null : capitalizar(k),
    items: mapa.get(k)!,
  }));
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ══════════════════════════════════════════════════════════════
   Horario
   ══════════════════════════════════════════════════════════════ */

export function TablaHorario({ config, className }: { config: BarberWebConfig; className?: string }) {
  const filas = horarioBarberWeb(config);
  return (
    <ul className={`dcbw-horario ${className ?? ""}`}>
      {filas.map((f) => (
        <li key={f.dia} className={f.abierto ? "" : "dcbw-cerrado"}>
          <span className="dcbw-horario-dia">{BARBER_WEB_DIAS[f.dia]}</span>
          <span className="dcbw-horario-rango">{f.rango ?? "Cerrado"}</span>
        </li>
      ))}
    </ul>
  );
}

/* ══════════════════════════════════════════════════════════════
   Mapa

   iframe en diferido: el mapa de Google pesa más que toda la página
   junta, y en móvil casi nadie llega a mirarlo. Con loading="lazy" no
   se descarga hasta que el visitante se acerca.
   ══════════════════════════════════════════════════════════════ */

export function Mapa({ src, titulo, className }: { src: string; titulo: string; className?: string }) {
  return (
    <iframe
      className={`dcbw-mapa ${className ?? ""}`}
      src={src}
      title={titulo}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      allowFullScreen
    />
  );
}

/* ══════════════════════════════════════════════════════════════
   Redes
   ══════════════════════════════════════════════════════════════ */

export function Redes({
  config,
  className,
  size = 20,
  conWhatsApp = true,
  textoWhatsApp,
}: {
  config: BarberWebConfig;
  className?: string;
  size?: number;
  conWhatsApp?: boolean;
  textoWhatsApp?: string;
}) {
  const ig = urlInstagram(config.instagram);
  const fb = urlFacebook(config.facebook);
  const tt = urlTiktok(config.tiktok);
  const wa = conWhatsApp ? urlWhatsApp(config.whatsapp, textoWhatsApp) : null;
  if (!ig && !fb && !tt && !wa) return null;
  return (
    <div className={`dcbw-redes ${className ?? ""}`}>
      {ig && (
        <a href={ig} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
          <IcoInstagram size={size} />
        </a>
      )}
      {fb && (
        <a href={fb} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
          <IcoFacebook size={size} />
        </a>
      )}
      {tt && (
        <a href={tt} target="_blank" rel="noopener noreferrer" aria-label="TikTok">
          <IcoTiktok size={size} />
        </a>
      )}
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
          <IcoWhatsApp size={size} />
        </a>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   El pie

   Es NUESTRO, no de la barbería: por eso no está en el manifiesto y no
   se edita. El enlace sale a la web de DaleControl con `<a>`.
   ══════════════════════════════════════════════════════════════ */

export function Pie({ nombre }: { nombre: string }) {
  const anio = 2020; // Sin new Date(): el HTML se cachea por ISR y un año
  // calculado en el servidor se congela con la caché. El aviso legal no
  // necesita año, así que no se pinta ninguno.
  void anio;
  return (
    <footer className="dcbw-pie">
      <span>{nombre}</span>
      <a href="https://www.dalecontrol.com" target="_blank" rel="noopener noreferrer">
        Hecho con DaleControl
      </a>
    </footer>
  );
}
