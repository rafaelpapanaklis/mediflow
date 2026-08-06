"use client";

import { useEffect, useState } from "react";
import { Logo } from "../../landing/primitives/logo";
import { SplineScene } from "@/components/ui/splite";
import { Spotlight } from "@/components/ui/spotlight";

const SPLINE_SCENE = "https://prod.spline.design/Xt-60EX3otw1Uuty/scene.splinecode";

/**
 * Gate del 3D: SOLO desktop (≥1024px + puntero fino) y sin reduced-motion.
 * Devuelve null en el primer render (SSR/hidratación) para no decidir en
 * servidor; mientras tanto se pinta el fallback ligero. El runtime de Spline
 * (~1.2 MB) solo se importa (lazy) cuando esto da true, así móvil/tablet
 * nunca lo descargan. Nota: AuthShell ya oculta este panel <1024px, pero el
 * gate evita la descarga igualmente (el CSS oculta, no des-monta).
 */
function useCanRender3D(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const queries = [
      window.matchMedia("(min-width: 1024px)"),
      window.matchMedia("(hover: hover) and (pointer: fine)"),
      window.matchMedia("(prefers-reduced-motion: no-preference)"),
    ];
    const evaluate = () => setOk(queries.every((q) => q.matches));
    evaluate();
    queries.forEach((q) => q.addEventListener("change", evaluate));
    return () => queries.forEach((q) => q.removeEventListener("change", evaluate));
  }, []);
  return ok;
}

/** Alternativa ligera (tablet, reduced-motion, o si el 3D no aplica): solo CSS. */
function StaticVisual() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
      <div
        className="dc-fallback-float"
        style={{
          position: "absolute", right: "-18%", top: "-22%", width: 720, height: 720,
          borderRadius: "50%", filter: "blur(30px)",
          background: "radial-gradient(circle, rgba(124,58,237,0.30) 0%, rgba(124,58,237,0) 65%)",
        }}
      />
      <div
        style={{
          position: "absolute", left: "-22%", bottom: "-18%", width: 640, height: 640,
          borderRadius: "50%", filter: "blur(30px)",
          background: "radial-gradient(circle, rgba(76,29,149,0.42) 0%, rgba(76,29,149,0) 65%)",
        }}
      />
      <svg width="400" height="400" viewBox="0 0 36 36" fill="none" style={{ position: "absolute", right: "4%", top: "50%", transform: "translateY(-52%)" }}>
        <path d="M18 4 L31 11 L18 18 L5 11 Z" fill="rgba(167,139,250,0.05)" stroke="rgba(167,139,250,0.14)" strokeWidth="0.8" strokeLinejoin="round" />
        <path d="M5.5 18.5 L18 25.2 L30.5 18.5" stroke="rgba(167,139,250,0.12)" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.5 24.5 L18 31.2 L30.5 24.5" stroke="rgba(167,139,250,0.08)" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <style>{`
        .dc-fallback-float { animation: dc-float 16s ease-in-out infinite alternate; }
        @keyframes dc-float { from { transform: translateY(-12px); } to { transform: translateY(14px); } }
        @media (prefers-reduced-motion: reduce) { .dc-fallback-float { animation: none; } }
      `}</style>
    </div>
  );
}

export function LoginVisual() {
  const can3D = useCanRender3D();

  return (
    <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minHeight: 520 }}>
      {/* Capa escena — absoluta para que el copy no la empuje. El canvas de
          Spline hereda el fondo oscuro del panel, así que el padding del
          AuthShell no deja costuras visibles. */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        {can3D ? (
          /* Host del Spotlight. NO se puede montar el Spotlight directamente
             sobre la capa de arriba: el componente le escribe
             position:relative + overflow:hidden a su padre, y eso sacaría del
             flujo absoluto a esa capa (colapsándola a 0 px de alto, con el
             canvas dentro). Este host ya nace relative y mide 100%×100%, así
             que recibe ambos estilos sin efecto. Sigue siendo el mismo
             rectángulo, de modo que el mousemove que burbujea desde el canvas
             posiciona el foco igual que en el prototipo. */
          <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
            {/* Halo estático detrás del robot: separa la silueta del fondo y
                da calidez. mix-blend screen = luz aditiva sobre la escena. */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute", left: "50%", top: "52%", width: 660, height: 660,
                transform: "translate(-50%, -50%)", borderRadius: "50%",
                background: "radial-gradient(circle, rgba(139,92,246,0.22) 0%, rgba(99,68,190,0.12) 45%, transparent 70%)",
                filter: "blur(36px)", pointerEvents: "none", mixBlendMode: "screen", zIndex: 5,
              }}
            />
            {/* Spotlight en morado de marca (caída suave); los stops del
                gradiente se pasan por className — el componente no se toca. */}
            <Spotlight
              className="z-10 from-violet-400/40 via-violet-600/25 to-violet-600/0 mix-blend-screen"
              size={600}
            />
            {/* Recorte de la marca "Built with Spline": el runtime la dibuja
                DENTRO del canvas, pegada a la esquina inferior. El canvas se
                desborda 6% arriba y abajo dentro de este wrapper con
                overflow-hidden, así la franja inferior (con la marca) queda
                fuera del área visible sin alterar el encuadre. El plan de pago
                de Spline la quita oficialmente; esto es solo un recorte. */}
            <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -64, left: 0, width: "100%", height: "calc(100% + 128px)" }}>
                <SplineScene
                  scene={SPLINE_SCENE}
                  className="h-full w-full"
                  onLoad={(app: any) => {
                    // La marca "Built with Spline" es una pasada de render del
                    // visor (pipeline.logoOverlayPass). API privada: si cambia
                    // de versión, esto no hace nada (y la marca reaparecería).
                    // Lo oficial es el plan de pago de Spline.
                    try {
                      const p = app?._renderer?.pipeline?.logoOverlayPass;
                      if (p) { p.enabled = false; app.requestRender?.(); }
                    } catch { /* noop */ }
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <StaticVisual />
        )}
      </div>

      {/* Copy de marca. pointer-events:none para que el robot siga al cursor. */}
      <div style={{ position: "relative", zIndex: 2, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none" }}>
        <div>
          <Logo size={26} color="#ffffff" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 460 }}>
          <div
            style={{
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase",
              color: "#c4b5fd",
            }}
          >
            Software para clínicas dentales
          </div>
          <h2
            style={{
              fontFamily: "var(--font-sans, system-ui, sans-serif)",
              fontSize: 37, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.15,
              color: "#ffffff", margin: 0, textWrap: "pretty",
              textShadow: "0 2px 28px rgba(8,6,18,0.55)",
            }}
          >
            Tu clínica en piloto automático.
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: "rgba(237,233,254,0.84)", margin: 0, maxWidth: 400, textWrap: "pretty", textShadow: "0 1px 20px rgba(8,6,18,0.5)" }}>
            Agenda, expedientes NOM-024 y facturación CFDI 4.0 avanzan solos mientras tú atiendes pacientes.
          </p>
          {/* Sello de cumplimiento, no una métrica. Aquí vivía "+2,400 clínicas
              confían en DaleControl": un número que no es cierto. Lo que sí es
              verificable es lo que hace el producto — timbra CFDI 4.0 ante el
              SAT a través de su PAC. */}
          <div style={{ paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.14)", display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em", color: "#ffffff" }}>CFDI 4.0</span>
            <span style={{ fontSize: 12, color: "rgba(237,233,254,0.75)" }}>Facturación timbrada ante el SAT</span>
          </div>
        </div>
      </div>

      {/* Pill "Datos cifrados" anclada abajo-derecha del panel: refuerza
          confianza y cubre la esquina donde el runtime dibuja su marca. */}
      <span
        title="Cifrado TLS en tránsito y AES-256 en reposo"
        style={{
          position: "absolute", zIndex: 4, right: 20, bottom: 18,
          display: "inline-flex", alignItems: "center", gap: 9,
          padding: "7px 14px", borderRadius: 999,
          background: "rgba(18,14,40,0.72)", border: "1px solid rgba(255,255,255,0.14)",
          lineHeight: 1, whiteSpace: "nowrap", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" />
          <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" fill="#a78bfa" />
          <path d="M9.3 15.9l1.9 1.9 3.5-3.7" stroke="#120e2a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: 13, color: "#f5f5f7" }}>Datos cifrados</span>
        <span aria-hidden="true" style={{ width: 1, height: 13, background: "rgba(255,255,255,0.18)" }} />
        <span style={{ fontSize: 12, color: "rgba(237,233,254,0.75)", letterSpacing: "0.02em" }}>TLS + AES-256</span>
      </span>
    </div>
  );
}
