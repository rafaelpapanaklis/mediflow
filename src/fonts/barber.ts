import localFont from "next/font/local";

// Landing de barberías (`src/app/barberias/page.tsx`). Sin 500: la página nunca lo usa.
//
// display: "fallback" y no "swap": 100 ms de bloqueo y luego, si la fuente
// no llegó, el respaldo ajustado. En la práctica el archivo (precargado,
// 50 KB) ya está cuando se pinta el primer frame y el H1 nace en Inter: sin
// el re-layout del swap ni el salto de líneas que daba CLS 0.18 en móvil.
export const inter = localFont({
  src: [
    { path: "./inter-latin-var.woff2", weight: "400", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "600", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "700", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-inter",
  display: "fallback",
});

// Letrero de barbería: un solo peso, solo para etiquetas e insignias.
export const sign = localFont({
  src: "./bebas-neue-400.woff2",
  weight: "400",
  style: "normal",
  variable: "--font-sign",
  display: "fallback",
});
