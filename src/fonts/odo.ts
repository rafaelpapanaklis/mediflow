import localFont from "next/font/local";

// Odontograma v2 (`src/components/dashboard/odontogram-v2/App.tsx`).
export const jakarta = localFont({
  src: [
    { path: "./plus-jakarta-sans-latin-var.woff2", weight: "400", style: "normal" },
    { path: "./plus-jakarta-sans-latin-var.woff2", weight: "500", style: "normal" },
    { path: "./plus-jakarta-sans-latin-var.woff2", weight: "600", style: "normal" },
    { path: "./plus-jakarta-sans-latin-var.woff2", weight: "700", style: "normal" },
    { path: "./plus-jakarta-sans-latin-var.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-odo",
  display: "swap",
});
