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

export const mono = localFont({
  src: [
    { path: "./ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./ibm-plex-mono-600.woff2", weight: "600", style: "normal" },
    { path: "./ibm-plex-mono-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
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
