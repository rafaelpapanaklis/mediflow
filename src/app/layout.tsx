import type { Metadata, Viewport } from "next";
import { Sora, JetBrains_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mediflow-pi.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "MediFlow — Software para clínicas en México",
    template: "%s | MediFlow",
  },
  description:
    "MediFlow es el software de gestión todo-en-uno para clínicas de salud, estética y belleza en México. Agenda, expedientes, facturación CFDI 4.0 y WhatsApp.",
  applicationName: "MediFlow",
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
    siteName: "MediFlow",
    url: SITE_URL,
    title: "MediFlow — Software para clínicas en México",
    description:
      "Agenda, expedientes, facturación CFDI 4.0 y WhatsApp para clínicas de salud, estética y belleza.",
  },
  twitter: {
    card: "summary_large_image",
    title: "MediFlow — Software para clínicas en México",
    description:
      "Agenda, expedientes, facturación CFDI 4.0 y WhatsApp para clínicas en un solo lugar.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var saved = localStorage.getItem('theme');
              if (saved === 'dark') {
                document.documentElement.classList.add('dark');
              } else if (saved === 'light') {
                document.documentElement.classList.remove('dark');
              } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                document.documentElement.classList.add('dark');
              }
            } catch(e) {}
          })();
        `}} />
      </head>
      <body className={`${sora.variable} ${jetbrainsMono.variable} antialiased font-sans bg-background text-foreground`}>
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
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              padding: "10px 14px",
              fontSize: 13,
            },
          }}
        />
        {children}
      </body>
    </html>
  );
}
