import localFont from "next/font/local";

// Igual que `inter-400-700`, más el 800: la home y las páginas de producto lo usan
// en titulares. Módulo aparte y no un peso extra en el otro, porque el `@font-face`
// de más se colaría en todas las páginas que no lo necesitan.
//
// El 800 es el tope de verdad: un grep de `fontWeight` sobre la landing v2 + footer
// + nav no encuentra ni un 900, así que ese `@font-face` sobraba y no está.
export const inter = localFont({
  src: [
    { path: "./inter-latin-var.woff2", weight: "400", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "500", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "600", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "700", style: "normal" },
    { path: "./inter-latin-var.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});
