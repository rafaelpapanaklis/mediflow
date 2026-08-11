import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Hanken_Grotesk } from "next/font/google";
import Script from "next/script";
import { Toaster } from "react-hot-toast";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { AnalyticsTracker } from "@/components/analytics/analytics-tracker";
import { GaPageview } from "@/components/analytics/ga-pageview";
import { MetaPixelPageview } from "@/components/analytics/meta-pixel-pageview";
import { GA4_MEASUREMENT_ID, PRIVATE_PATH_PATTERN } from "@/lib/analytics/ga4";
import { META_PIXEL_ID } from "@/lib/analytics/meta-pixel";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-mono", display: "swap" });
// Tipografía del wordmark DaleControl (kit de marca "logo 105"): solo pesos del logo.
const logo = Hanken_Grotesk({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-logo", display: "swap" });

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
        {/* Google tag (gtag.js) — Google Ads AW-18276007996 (conversiones) */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=AW-18276007996"
          strategy="afterInteractive"
        />
        {/* El mismo gtag.js sirve a varios destinos: GA4 se suma como un config
            extra DESPUÉS del de Ads, que no cambia. GA4 solo se configura en
            rutas públicas (PRIVATE_PATH_PATTERN) y con send_page_view:false,
            porque el page_view lo manda <GaPageview /> en cada navegación. */}
        <Script id="ga-gtag" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'AW-18276007996');
            if (!new RegExp(${JSON.stringify(PRIVATE_PATH_PATTERN)}).test(location.pathname)) {
              gtag('config', ${JSON.stringify(GA4_MEASUREMENT_ID)}, { send_page_view: false });
            }
          `}
        </Script>
        {/* Píxel de Meta (1692815882024068 — "DaleControl Web"): snippet oficial
            de arranque de fbq, envuelto en el MISMO guard de rutas privadas que
            GA4. En el panel no se carga fbevents.js ni se define fbq: /paciente
            y /portal no mandan señales a Meta.
            Aquí solo va el init. El PageView lo manda <MetaPixelPageview /> en
            cada navegación, mismo criterio que el send_page_view:false de GA4.
            Sin <noscript><img>: este layout es el raíz y ese pixel de respaldo
            se renderizaría también en las rutas privadas. */}
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            if (!new RegExp(${JSON.stringify(PRIVATE_PATH_PATTERN)}).test(location.pathname)) {
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', ${JSON.stringify(META_PIXEL_ID)});
            }
          `}
        </Script>
        {/* Toaster centralizado: única posición (top-right), duraciones
            consistentes (3s success/info, 5s error). Estilos globales
            via className para que dark mode funcione automáticamente
            con CSS variables del proyecto. */}
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
        {/* ConfirmProvider a nivel root para que /admin, /dashboard y
            cualquier otra ruta autenticada puedan usar useConfirm().
            Landing/auth pages no usan el hook → el provider está
            montado pero idle, sin coste perceptible (un useState + un
            <Dialog> Radix con open=false). */}
        <ConfirmProvider>
          {children}
        </ConfirmProvider>
        <Analytics />
        <SpeedInsights />
        {/* Analítica propia (DaleControl) — tracker de primera parte para /admin/analytics.
            No rastrea /admin ni /live; identidad resuelta server-side desde cookies. */}
        <AnalyticsTracker />
        {/* GA4 (G-Q3HM012SPZ) — page_view por navegación, solo rutas públicas. */}
        <GaPageview />
        {/* Píxel de Meta — PageView por navegación, solo rutas públicas. */}
        <MetaPixelPageview />
      </body>
    </html>
  );
}
