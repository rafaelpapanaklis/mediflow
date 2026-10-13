import localFont from "next/font/local";

// Las tres del layout raíz (`src/app/layout.tsx`). Van juntas porque siempre se
// cargan en la misma página: no hay `@font-face` de más para nadie.

export const sans = localFont({
  src: [
    { path: "./ibm-plex-sans-latin-var.woff2", weight: "300", style: "normal" },
    { path: "./ibm-plex-sans-latin-var.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-sans-latin-var.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-sans-latin-var.woff2", weight: "600", style: "normal" },
    { path: "./ibm-plex-sans-latin-var.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

// `preload: false` en mono (13-oct-2026, ws1-t4, encargo de ws7, aprobado por
// Rafael): el layout raíz precargaba 7 .woff2 (175 KB) en TODAS las rutas y la
// portada no usa mono por encima del pliegue; sus 4 archivos (40 KB, 4
// peticiones) competían con el CSS y con Inter en los primeros 200 ms del
// celular. Sin precarga el navegador los pide igual, pero solo cuando una regla
// los usa (el @font-face sigue en el CSS del layout), y siguen con `display: swap`.
// La del logo se queda precargada: medido a 1440 en el build de producción, sin
// precarga la primera maquetación pintaba el wordmark con la reserva (114 px) y
// al llegar Hanken pasaba a 96 px: salto de letra visible en el header de
// escritorio, justo lo que Rafael puso como condición para quitarla.
export const mono = localFont({
  src: [
    { path: "./ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono-600.woff2", weight: "600", style: "normal" },
    { path: "./ibm-plex-mono-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
  preload: false,
});

// Tipografía del wordmark DaleControl (kit de marca "logo 105"): solo pesos del logo.
export const logo = localFont({
  src: [
    { path: "./hanken-grotesk-latin-var.woff2", weight: "600", style: "normal" },
    { path: "./hanken-grotesk-latin-var.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-logo",
  display: "swap",
});
