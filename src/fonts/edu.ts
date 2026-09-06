import localFont from "next/font/local";

// Landing de instituciones (`src/app/instituciones/page.tsx`). Tres pesos y no cuatro:
// cada peso es un `@font-face` más que resolver antes de que el texto se asiente, y el
// 800 se usaba en un solo sitio.
export const inter = localFont({
  src: [
    { path: "./inter-latin-var.woff2", weight: "400", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "600", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter-edu",
  display: "fallback",
});

// `adjustFontFallback` explícito: para una serif, `next/font/google` calculaba el
// respaldo contra Times New Roman, no contra Arial (que es el default de
// `next/font/local`). Sin esta línea el salto al cargar la fuente sería otro.
export const serif = localFont({
  src: [
    { path: "./source-serif-4-600.woff2", weight: "600", style: "normal" },
    { path: "./source-serif-4-600-italic.woff2", weight: "600", style: "italic" },
  ],
  variable: "--font-serif-edu",
  display: "fallback",
  adjustFontFallback: "Times New Roman",
});
