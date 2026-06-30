import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import { MapPin } from "lucide-react";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { DirectoryExplorer } from "@/components/directory/DirectoryExplorer";
import { CategoryGrid } from "@/components/directory/CategoryGrid";
import { TopCombosFooter } from "@/components/directory/CityLinks";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { DIRECTORY_CATEGORIES } from "@/lib/directory/types";
import "@/components/public/landing/sales/sales.css";

// Misma fuente y patrón que la home (src/app/page.tsx): todo vive bajo `.mfh`.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = buildMetadata({
  title: "Encuentra tu clínica y reserva en línea | DaleControl",
  description:
    "Directorio de clínicas verificadas en México: dental, medicina, spa, fisioterapia, estética y más. Compara, elige y agenda tu cita en línea en minutos.",
  path: "/descubre",
  keywords: [
    "directorio de clínicas",
    "reservar cita en línea",
    "clínicas cerca de mí",
    "agendar cita médica",
    "clínica dental",
    "spa",
    "fisioterapia",
  ],
});

export const revalidate = 86400;

// ─────────────────────────────────────────────────────────────────────────────
// /descubre — página B2C del directorio (estilo Doctoralia).
// Hero violeta → buscador + categorías + resultados (DirectoryExplorer, client)
// → banda CTA para dueños de clínica. Página 100% estática (SSG): aquí NO se
// leen cookies/headers — la búsqueda y la sesión del nav son client-side.
// ─────────────────────────────────────────────────────────────────────────────

// JSON-LD: CollectionPage + ItemList de las 17 categorías del directorio.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Directorio de clínicas — DaleControl",
  url: `${SITE_URL}/descubre`,
  inLanguage: "es-MX",
  mainEntity: {
    "@type": "ItemList",
    itemListElement: DIRECTORY_CATEGORIES.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      url: `${SITE_URL}/descubre/${c.slug}`,
    })),
  },
};

export default function DescubrePage() {
  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <SalesNavSession />
      <main>
        {/* 1) Hero del directorio */}
        <section className="mfh-section--tight mfh-band--violet">
          <div className="mfh-container">
            <div className="mfh-head mfh-center" style={{ alignItems: "center", gap: 18 }}>
              <span className="mfh-eyebrow">
                <MapPin /> Directorio DaleControl
              </span>
              <h1 className="mfh-h1 mfh-balance">
                Encuentra tu clínica y <span className="mfh-grad">reserva en línea</span>
              </h1>
              <p className="mfh-lede" style={{ maxWidth: 620 }}>
                Clínicas verificadas de salud, estética y bienestar en México. Elige tu
                especialidad, compara y agenda en minutos.
              </p>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  gap: "10px 22px",
                  paddingTop: 2,
                }}
              >
                <span className="mfh-pill"><span className="mfh-dot" /> Reserva sin llamadas</span>
                <span className="mfh-pill"><span className="mfh-dot" /> Confirmación por WhatsApp</span>
                <span className="mfh-pill"><span className="mfh-dot" /> Sin costo para ti</span>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--body)" }}>
                ¿Ya tienes una cita?{" "}
                <Link href="/paciente/login" style={{ color: "var(--b2)", fontWeight: 600, textDecoration: "none" }}>
                  Entra a tu cuenta de paciente →
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* 2) Buscador + categorías + resultados (client-side) */}
        <DirectoryExplorer>
          <section className="mfh-section--tight" style={{ paddingBottom: 0 }}>
            <div className="mfh-container">
              <div className="mfh-head mfh-center" style={{ marginBottom: "clamp(24px, 4vw, 40px)" }}>
                <h2 className="mfh-h2 mfh-balance">Explora por especialidad</h2>
                <p className="mfh-lede">
                  Elige una categoría y descubre clínicas con agenda en línea cerca de ti.
                </p>
              </div>
              <CategoryGrid />
            </div>
          </section>
        </DirectoryExplorer>

        {/* Interlinking: combinaciones populares (ISR, null sin DB) */}
        <TopCombosFooter />

        {/* 3) CTA para dueños de clínica */}
        <section className="mfh-section--tight mfh-band--soft">
          <div className="mfh-container">
            <div className="mfh-head mfh-center" style={{ alignItems: "center", gap: 14 }}>
              <h2 className="mfh-h2 mfh-balance">¿Tienes una clínica?</h2>
              <p className="mfh-lede" style={{ maxWidth: 560 }}>
                Publícala gratis en el directorio y recibe reservas en línea de nuevos
                pacientes, con confirmación automática por WhatsApp.
              </p>
              <div style={{ paddingTop: 4 }}>
                <a href="/signup" className="mfh-btn mfh-btn--primary">
                  Publica tu clínica gratis
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SalesFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
    </div>
  );
}
