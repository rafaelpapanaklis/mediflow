import type { Metadata } from "next";
import { Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MediFlow — El sistema operativo de tu clínica",
    template: "%s | MediFlow",
  },
  description:
    "Gestiona pacientes, agenda, expedientes y facturación desde un solo lugar. La plataforma clínica más completa en español.",
  keywords: ["software clínico", "gestión consultorio", "expediente médico", "agenda médica"],
  authors: [{ name: "MediFlow" }],
  openGraph: {
    type: "website",
    locale: "es_MX",
    siteName: "MediFlow",
    title: "MediFlow — El sistema operativo de tu clínica",
    description: "Gestiona pacientes, agenda, expedientes y facturación desde un solo lugar.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${sora.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
