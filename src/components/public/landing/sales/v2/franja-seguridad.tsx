import type { CSSProperties, ReactNode } from "react";
import { GloboSeguridadVivo } from "./globo-seguridad-vivo";
import { SEGURIDAD, type SelloSeguridadIcono } from "./landing-data";
import "./franja-seguridad.css";

/**
 * Franja de seguridad (4-oct-2026, ws1-t10): ocupa el sitio de la fila de
 * píldoras con palomita que cerraba Precios. Un panel oscuro con los mismos
 * materiales del cierre de la portada (final-cta.tsx: azul noche, brillos azul
 * y violeta, trama de puntos de 26 px). Idea de Rafael: un globo del mundo con
 * escudo en el centro y los siete sellos alrededor, en órbita (escritorio);
 * en tableta y celular, el globo arriba y los sellos en cuadrícula debajo.
 *
 * Componente de SERVIDOR: todo el marcado viaja en el HTML. Lo que se ve sin
 * JavaScript es un globo SVG (mar, halo, meridianos que giran con CSS) y los
 * sellos. Encima, globo-seguridad-vivo.tsx monta el globo 3D de puntos en un
 * <canvas> —motor propio, sin three.js ni dependencias, cargado solo cuando la
 * franja se acerca a la pantalla y pausado fuera de ella— y los gestos de
 * entrada y de profundidad con el ratón. Con `prefers-reduced-motion` no se
 * mueve nada (franja-seguridad.css y el propio motor).
 *
 * Los textos viven en landing-data.ts (`SEGURIDAD`): redacción aprobada, en
 * español. Los íconos son PROPIOS, dibujados aquí: nunca los logotipos de
 * SOC 2 (AICPA) ni de ISO, que solo puede usar la empresa certificada. Son
 * decorativos (`aria-hidden`): el sello lo dice el texto, que se lee de
 * corrido («Cifrado AES-256»).
 */

/** Contorno ondulado del sello (16 lóbulos, caja de 56). */
const CONTORNO_SELLO =
  "M28 4.4Q33.58 -0.05 37.03 6.2Q43.89 4.22 44.69 11.31Q51.78 12.11 49.8 18.97Q56.05 22.42 51.6 28Q56.05 33.58 49.8 37.03Q51.78 43.89 44.69 44.69Q43.89 51.78 37.03 49.8Q33.58 56.05 28 51.6Q22.42 56.05 18.97 49.8Q12.11 51.78 11.31 44.69Q4.22 43.89 6.2 37.03Q-0.05 33.58 4.4 28Q-0.05 22.42 6.2 18.97Q4.22 12.11 11.31 11.31Q12.11 4.22 18.97 6.2Q22.42 -0.05 28 4.4Z";

/** Trazos de cada ícono en caja de 24 (línea de 1.7, puntas redondas). */
const ICONOS: Record<SelloSeguridadIcono, ReactNode> = {
  candado: (
    <>
      <rect x="5" y="10.8" width="14" height="9.7" rx="2.3" />
      <path d="M8.2 10.8V8a3.8 3.8 0 0 1 7.6 0v2.8" />
      <path d="M12 14.6v2.2" />
    </>
  ),
  "dos-pasos": (
    <>
      <rect x="6.8" y="2.8" width="10.4" height="18.4" rx="2.5" />
      <path d="m9.7 11.6 1.7 1.7 3-3.3" />
      <path d="M10.8 17.9h2.4" />
    </>
  ),
  respaldo: (
    <>
      <ellipse cx="10.6" cy="6.2" rx="6.6" ry="2.8" />
      <path d="M4 6.2v5.4c0 1.5 2.9 2.8 6.6 2.8" />
      <path d="M4 11.6V17c0 1.4 2.6 2.6 6 2.8" />
      <path d="M17.2 6.2v4.3" />
      <rect x="13.6" y="15.9" width="7.2" height="5.3" rx="1.4" />
      <path d="M15.3 15.9v-1.2a1.9 1.9 0 0 1 3.8 0v1.2" />
    </>
  ),
  bitacora: (
    <>
      <path d="M8.2 4.6H7A1.9 1.9 0 0 0 5.1 6.5V19A1.9 1.9 0 0 0 7 20.9h10a1.9 1.9 0 0 0 1.9-1.9V6.5A1.9 1.9 0 0 0 17 4.6h-1.2" />
      <rect x="8.2" y="3" width="7.6" height="3.4" rx="1.3" />
      <path d="M8.7 10.9h.01M11.4 10.9h4M8.7 14.2h.01M11.4 14.2h4M8.7 17.5h.01M11.4 17.5h2.4" />
    </>
  ),
  ley: (
    <>
      <path d="M12 4v16.4M7.8 20.4h8.4M5.2 7.2h13.6" />
      <path d="M5.2 7.2 2.7 13.4h5L5.2 7.2ZM18.8 7.2l-2.5 6.2h5l-2.5-6.2Z" />
      <path d="M2.7 13.4a2.5 2.5 0 0 0 5 0M16.3 13.4a2.5 2.5 0 0 0 5 0" />
    </>
  ),
  servidor: (
    <>
      <rect x="3.6" y="3.8" width="16.8" height="6.4" rx="1.9" />
      <rect x="3.6" y="13.8" width="16.8" height="6.4" rx="1.9" />
      <path d="M7.2 7h.01M7.2 17h.01M10.4 7h6.2M10.4 17h6.2" />
    </>
  ),
  certificado: (
    <>
      <circle cx="12" cy="9.2" r="5.4" />
      <path d="m8.6 13.6-1.5 7 4.9-2.5 4.9 2.5-1.5-7" />
      <path d="m9.9 9.3 1.5 1.5 2.8-3" />
    </>
  ),
};

/**
 * Meridianos del globo. Cada uno es el círculo máximo aplastado en X: al girar
 * la esfera, su ancho aparente es el coseno del ángulo. `s` es la pose quieta
 * (sin animación) y `d` el desfase con que entra en el ciclo de 14 s. Es el
 * globo de reserva: cuando el canvas pinta su primer cuadro, esta malla se
 * apaga (`.is-vivo`).
 */
const MERIDIANOS: { s: number; d: string }[] = [
  { s: 0.985, d: "-0.78s" },
  { s: 0.574, d: "-4.28s" },
  { s: -0.174, d: "-7.78s" },
  { s: -0.819, d: "-11.28s" },
];

export function FranjaSeguridad() {
  return (
    <section id="seguridad" className="dcsg" aria-labelledby="dcsg-titulo" style={{ scrollMarginTop: 96 }}>
      <div data-reveal="" className="dcsg__panel">
        <div aria-hidden="true" className="dcsg__fondo" />

        <div className="dcsg__head">
          <span className="dcsg__eyebrow">
            <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3c2.6 1.7 5.2 2.5 8 2.7v6c0 4.8-3.1 8-8 9.8-4.9-1.8-8-5-8-9.8v-6c2.8-.2 5.4-1 8-2.7Z" />
              <path d="m8.8 12 2.3 2.3 4.2-4.6" />
            </svg>
            {SEGURIDAD.eyebrow}
          </span>
          <h2 id="dcsg-titulo" className="dcv4-balance dcsg__titulo">
            {SEGURIDAD.titleLead} <span className="dcsg__acento">{SEGURIDAD.titleAccent}</span>
          </h2>
          <p className="dcv4-pretty dcsg__lead">{SEGURIDAD.subtitle}</p>
        </div>

        <div className="dcsg__escena">
          {/* Órbitas (solo en escritorio): elipses en CSS y dos puntos de luz
              que recorren la principal, donde se apoyan los sellos. */}
          <div aria-hidden="true" className="dcsg__orbita dcsg__orbita--dentro" />
          <div aria-hidden="true" className="dcsg__orbita">
            <span className="dcsg__cometa"><i /></span>
            <span className="dcsg__cometa dcsg__cometa--2"><i /></span>
          </div>

          {/* Globo con escudo. Los degradados de este SVG (`dcsg-g`) los
              reutilizan los sellos: nunca se oculta con `display: none`. */}
          <div aria-hidden="true" className="dcsg__globo">
            {/* Ondas que salen del globo: elementos CSS y no trazos del SVG,
                para que animarlas no obligue a repintar el SVG en cada cuadro. */}
            <span className="dcsg__onda" />
            <span className="dcsg__onda dcsg__onda--2" />
            <svg focusable="false" className="dcsg__esfera" viewBox="0 0 240 240" fill="none">
              <defs>
                <linearGradient id="dcsg-g" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#60a5fa" />
                  <stop offset="1" stopColor="#a78bfa" />
                </linearGradient>
                <radialGradient id="dcsg-mar" cx="0.34" cy="0.28" r="0.8">
                  <stop offset="0" stopColor="#2f55c4" />
                  <stop offset="0.45" stopColor="#1a2a7a" />
                  <stop offset="1" stopColor="#0b1238" />
                </radialGradient>
                <radialGradient id="dcsg-halo" cx="0.5" cy="0.5" r="0.5">
                  <stop offset="0.5" stopColor="#60a5fa" stopOpacity="0.55" />
                  <stop offset="0.74" stopColor="#7c3aed" stopOpacity="0.16" />
                  <stop offset="1" stopColor="#7c3aed" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="dcsg-brillo" cx="0.3" cy="0.22" r="0.5">
                  <stop offset="0" stopColor="#fff" stopOpacity="0.3" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </radialGradient>
                <clipPath id="dcsg-disco">
                  <circle cx="120" cy="120" r="100" />
                </clipPath>
              </defs>
              <circle cx="120" cy="120" r="178" fill="url(#dcsg-halo)" />
              <circle cx="120" cy="120" r="100" fill="url(#dcsg-mar)" />
              {/* Malla de reserva, con el eje inclinado 18° como un globo de escritorio. */}
              <g className="dcsg__malla" transform="rotate(-18 120 120)" clipPath="url(#dcsg-disco)" stroke="rgba(191,219,254,.34)" strokeWidth="1.1">
                <path d="M20 120h200M33.4 70h173.2M33.4 170h173.2M70 33.4h100M70 206.6h100" />
                {MERIDIANOS.map((m) => (
                  <circle
                    key={m.d}
                    className="dcsg__meridiano"
                    cx="120"
                    cy="120"
                    r="100"
                    stroke="rgba(191,219,254,.55)"
                    vectorEffect="non-scaling-stroke"
                    style={{ "--s": m.s, "--d": m.d } as CSSProperties}
                  />
                ))}
              </g>
              <circle cx="120" cy="120" r="100" fill="url(#dcsg-brillo)" />
              <circle cx="120" cy="120" r="100" stroke="url(#dcsg-g)" strokeWidth="1.8" />
            </svg>
            <GloboSeguridadVivo />
            <svg focusable="false" className="dcsg__escudo" viewBox="0 0 120 150" fill="none">
              <defs>
                <linearGradient id="dcsg-cuerpo" x1="0.2" y1="0" x2="0.8" y2="1">
                  <stop offset="0" stopColor="#3b82f6" />
                  <stop offset="1" stopColor="#6d28d9" />
                </linearGradient>
              </defs>
              <path
                d="M60 12c16 10 33 15 50 16v38c0 34-20 58-50 72-30-14-50-38-50-72V28c17-1 34-6 50-16Z"
                fill="url(#dcsg-cuerpo)"
                stroke="rgba(255,255,255,.78)"
                strokeWidth="2.6"
                strokeLinejoin="round"
              />
              <path d="M60 24.5c13 7.5 26 11.5 39.5 13V66c0 27.5-15.5 47.5-39.5 60Z" fill="rgba(255,255,255,.14)" />
              <path d="m40 75 14.5 14.5 27-30" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <ul className="dcsg__sellos" aria-label={SEGURIDAD.listLabel}>
            {SEGURIDAD.sellos.map((s, i) => (
              <li key={s.clave} className="dcsg__sello" style={{ "--i": i } as CSSProperties}>
                <span aria-hidden="true" className="dcsg__medalla">
                  <svg focusable="false" viewBox="0 0 56 56" fill="none">
                    <path d={CONTORNO_SELLO} fill="#1b2a6b" stroke="url(#dcsg-g)" strokeWidth="1.4" strokeLinejoin="round" />
                    <circle cx="28" cy="28" r="19.5" stroke="rgba(255,255,255,.22)" strokeLinecap="round" strokeDasharray="0.8 3.28" />
                    <g transform="translate(16 16)" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      {ICONOS[s.icono]}
                    </g>
                  </svg>
                </span>
                <span className="dcsg__texto">
                  <span className="dcsg__antes">{s.antes}</span> <strong className="dcsg__clave">{s.clave}</strong>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
