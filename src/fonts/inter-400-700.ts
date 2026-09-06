import localFont from "next/font/local";

// Inter 400/500/600/700 con `--font-inter` y `display: "swap"`: la que usan el blog,
// /descubre, /casos-de-uso, /herramientas y /socio. Un `@font-face` por peso apuntando
// al mismo archivo variable, que es tal cual lo que servía Google.
export const inter = localFont({
  src: [
    { path: "./inter-latin-var.woff2", weight: "400", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "500", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "600", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});
