import type { Metadata, Viewport } from "next";
import { sans, mono, logo } from "@/fonts/root";
import Script from "next/script";
import { Toaster } from "react-hot-toast";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { AvisosVestibles } from "@/components/dashboard/layout-rediseno/avisos";
import { AnalyticsTracker } from "@/components/analytics/analytics-tracker";
import { GaPageview } from "@/components/analytics/ga-pageview";
import { AdsClickCapture } from "@/components/analytics/ads-click-capture";
import { EmbudoVistas } from "@/components/analytics/embudo-vistas";
import { MetaPixelPageview } from "@/components/analytics/meta-pixel-pageview";
import { TiktokPixel } from "@/components/analytics/tiktok-pixel";
import { RecargaPorDespliegue } from "@/components/recarga-por-despliegue";
import { scriptEtiquetasDiferidas } from "@/lib/analytics/etiquetas-diferidas";
import { cargarInsightsDeVercel } from "@/lib/analytics/vercel-insights";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "DaleControl — Software para clínicas en México",
    template: "%s | DaleControl",
  },
  description:
    "DaleControl es el software de gestión todo-en-uno para clínicas de salud, estética y belleza en México. Agenda, expedientes, facturación CFDI 4.0 y WhatsApp.",
  applicationName: "DaleControl",
  generator: "Next.js",
  keywords: [
    "software para clínicas",
    "expediente clínico digital",
    "agenda médica",
    "facturación CFDI 4.0",
    "software médico México",
    "WhatsApp para clínicas",
  ],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "es_MX",
    siteName: "DaleControl",
    url: SITE_URL,
    title: "DaleControl — Software para clínicas en México",
    description:
      "Agenda, expedientes, facturación CFDI 4.0 y WhatsApp para clínicas de salud, estética y belleza.",
  },
  twitter: {
    card: "summary_large_image",
    title: "DaleControl — Software para clínicas en México",
    description:
      "Agenda, expedientes, facturación CFDI 4.0 y WhatsApp para clínicas en un solo lugar.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Verificación de dominio de Meta (Business Manager → Dominios). No mover de <head>. */}
        <meta name="facebook-domain-verification" content="vbkgvotyofxz7i64jkvb9kgtep2oki" />
        {/* Tema: default SIEMPRE claro (sin fallback a prefers-color-scheme).
            La clase dark solo se aplica en rutas del panel y solo si el
            usuario la eligió (toggles del panel guardan localStorage 'theme'). */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var saved = localStorage.getItem('theme');
              var p = location.pathname;
              var isPanel = p.indexOf('/dashboard') === 0 || p.indexOf('/admin') === 0;
              if (isPanel && saved === 'dark') document.documentElement.classList.add('dark');
            } catch(e) {}
          })();
        `}} />
      </head>
      <body className={`${sans.variable} ${mono.variable} ${logo.variable} antialiased font-sans bg-background text-foreground`}>
        {/* Google tag (gtag.js — Ads AW-18276007996 + GA4) y píxel de Meta
            (1692815882024068 — "DaleControl Web"), DIFERIDOS (12-oct-2026,
            ws1-t4, encargo de ws7, punto 3a). El stub de gtag (dataLayer) y el
            stub oficial de fbq (fbq.queue) se definen aquí mismo, como antes;
            lo único que espera es la red: gtag.js y fbevents.js se piden cuando
            el navegador queda ocioso tras `load` (tope 4 s) o al primer gesto.
            Mismo guard de rutas privadas: GA4 y fbq solo en rutas públicas; el
            PageView/page_view lo mandan <GaPageview/> y <MetaPixelPageview/>.
            Sin <noscript><img> de Meta: este layout es el raíz y ese pixel de
            respaldo se renderizaría también en las rutas privadas.
            Detalle y pruebas: src/lib/analytics/etiquetas-diferidas.ts. */}
        <Script id="etiquetas-diferidas" strategy="afterInteractive">
          {scriptEtiquetasDiferidas()}
        </Script>
        {/* Toaster centralizado: única posición (top-right), duraciones
            consistentes (3s success/info, 5s error). Estilos globales
            via className para que dark mode funcione automáticamente
            con CSS variables del proyecto.
            AvisosVestibles (envoltorio de hijo único, no un hijo más: no cambia
            las ranuras ni los useId) lo devuelve TAL CUAL salvo que el layout de
            /dashboard haya encendido la ropa del rediseño para la clínica. */}
        <AvisosVestibles>
        <Toaster
          position="top-right"
          gutter={8}
          toastOptions={{
            className: "text-sm font-medium",
            duration: 3000,
            success: { duration: 3000, iconTheme: { primary: "#10b981", secondary: "#fff" } },
            error: { duration: 5000, iconTheme: { primary: "#ef4444", secondary: "#fff" } },
            loading: { duration: Infinity },
            style: {
              borderRadius: "10px",
              background: "var(--bg-elev)",
              color: "var(--text-1)",
              border: "1px solid var(--border-soft)",
              boxShadow: "0 8px 24px -8px rgba(15,10,30,0.18)",
              fontFamily: "var(--font-sans, system-ui, sans-serif)",
              padding: "10px 14px",
              fontSize: 13,
            },
          }}
        />
        </AvisosVestibles>
        {/* ConfirmProvider a nivel root para que /admin, /dashboard y
            cualquier otra ruta autenticada puedan usar useConfirm().
            Landing/auth pages no usan el hook → el provider está
            montado pero idle, sin coste perceptible (un useState + un
            <Dialog> Radix con open=false). */}
        <ConfirmProvider>
          {children}
        </ConfirmProvider>
        {/* Solo donde existe /_vercel/* (C-129): fuera de Vercel eran dos 404 por pantalla. */}
        {cargarInsightsDeVercel() && <Analytics />}
        {cargarInsightsDeVercel() && <SpeedInsights />}
        {/* Analítica propia (DaleControl) — tracker de primera parte para /admin/analytics.
            No rastrea /admin ni /live; identidad resuelta server-side desde cookies. */}
        <AnalyticsTracker />
        {/* GA4 (G-Q3HM012SPZ) — page_view por navegación, solo rutas públicas. */}
        <GaPageview />
        {/* Píxel de Meta — PageView por navegación, solo rutas públicas. */}
        <MetaPixelPageview />
        <TiktokPixel />
        {/* Clic de Google Ads (gclid/gbraid/wbraid) → cookie dc_ads de 90 días; el
            alta la guarda ligada a la clínica. Solo rutas públicas. */}
        <AdsClickCapture />
        {/* Embudo: landing_vista al abrir la portada (GA4 + analítica propia). */}
        <EmbudoVistas />
        {/* Tras un despliegue, la pestaña que ya estaba abierta pide fragmentos de
            JS que ya no existen. Esto atrapa los que no llegan a error.tsx y
            recarga UNA vez (o avisa, si hay algo a medio escribir). */}
        <RecargaPorDespliegue />
      </body>
    </html>
  );
}
