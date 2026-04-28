"use client";

import { useEffect, useState } from "react";

interface Promotion { title: string; description: string; durationSec: number }
interface Testimonial { author: string; text: string }

interface Props {
  clinicName: string;
  clinicLogo: string | null;
  config: Record<string, unknown>;
}

/**
 * TvMarketingView — carrusel de promociones + branding clínica.
 * Sin polling — todo el contenido viene de TVDisplay.config (estático
 * hasta que el admin actualice el display via /dashboard/tv-modes).
 */
export function TvMarketingView({ clinicName, clinicLogo, config }: Props) {
  const promotions = (config.promotions as Promotion[] | undefined) ?? [];
  const testimonials = (config.testimonials as Testimonial[] | undefined) ?? [];
  const brandColor = (config.brandColor as string | undefined) ?? "#7c3aed";

  const [promoIdx, setPromoIdx] = useState(0);
  const [now, setNow] = useState(new Date());

  // Carousel timer — usa durationSec del slot actual.
  useEffect(() => {
    if (promotions.length === 0) return;
    const dur = (promotions[promoIdx]?.durationSec ?? 8) * 1000;
    const id = setTimeout(() => {
      setPromoIdx((i) => (i + 1) % promotions.length);
    }, dur);
    return () => clearTimeout(id);
  }, [promoIdx, promotions]);

  // Reloj.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const currentPromo = promotions[promoIdx];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `linear-gradient(135deg, ${brandColor} 0%, ${brandColor}cc 100%)`,
        color: "#fff",
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
        padding: 48,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 48 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {clinicLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clinicLogo} alt={clinicName} style={{ height: 80, borderRadius: 16 }} />
          )}
          <h1 style={{ fontSize: 56, fontWeight: 700, margin: 0, letterSpacing: "-0.03em" }}>{clinicName}</h1>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 80, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.04em", lineHeight: 1 }}>
            {now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </div>
          <div style={{ fontSize: 18, color: "rgba(255,255,255,0.85)", textTransform: "capitalize", marginTop: 8 }}>
            {now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      </header>

      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {currentPromo ? (
          <div
            key={promoIdx}
            style={{
              background: "rgba(255, 255, 255, 0.10)",
              border: "1px solid rgba(255, 255, 255, 0.20)",
              borderRadius: 24,
              padding: "60px 80px",
              maxWidth: 1100,
              textAlign: "center",
              animation: "promoFade 0.6s ease-out",
            }}
          >
            <h2 style={{ fontSize: 72, fontWeight: 800, margin: 0, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              {currentPromo.title}
            </h2>
            {currentPromo.description && (
              <p style={{ fontSize: 24, color: "rgba(255,255,255,0.85)", marginTop: 20, lineHeight: 1.5, fontWeight: 400 }}>
                {currentPromo.description}
              </p>
            )}
            <style>{`
              @keyframes promoFade {
                from { opacity: 0; transform: translateY(20px); }
                to   { opacity: 1; transform: translateY(0); }
              }
            `}</style>
          </div>
        ) : (
          <div style={{ fontSize: 28, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
            Bienvenido. Configura promociones desde el panel admin.
          </div>
        )}
      </main>

      <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 32 }}>
        {promotions.length > 1 && (
          <div style={{ display: "flex", gap: 6 }}>
            {promotions.map((_, i) => (
              <span
                key={i}
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: i === promoIdx ? "#fff" : "rgba(255,255,255,0.3)",
                  transition: "background 0.3s",
                }}
              />
            ))}
          </div>
        )}
        {testimonials.length > 0 && (
          <div style={{
            background: "rgba(255, 255, 255, 0.10)",
            borderRadius: 12,
            padding: 18,
            maxWidth: 480,
            fontSize: 14,
          }}>
            <div style={{ fontStyle: "italic", lineHeight: 1.5, color: "rgba(255,255,255,0.9)" }}>
              &ldquo;{testimonials[(promoIdx) % testimonials.length]?.text}&rdquo;
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 8 }}>
              — {testimonials[(promoIdx) % testimonials.length]?.author}
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
