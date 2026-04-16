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
              }
            } catch(e) {}
          })();
        `}} />
      </head>
      <body className={`${sora.variable} ${jetbrainsMono.variable} antialiased font-sans bg-background text-foreground`}>
        <Toaster position="top-right" toastOptions={{ className: "text-sm font-medium" }} />
        {children}
      </body>
    </html>
  );
}
