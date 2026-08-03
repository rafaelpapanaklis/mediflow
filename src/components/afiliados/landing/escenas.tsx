/**
 * Las tres escenas 3D de /afiliados (diseño Afiliados-DaleControl.dc.html).
 *
 * Son CSS PURO: `perspective` + `transform-style: preserve-3d` + `transform`.
 * Ni WebGL ni librerías de animación — la landing está en 94 de PageSpeed
 * móvil y esta página no la puede tirar. Las tres animan SÓLO `transform`
 * (nunca alto, ancho ni posición), así que no provocan reflow, y las tres van
 * con `aria-hidden` porque son decoración: todo dato que aparece dibujado
 * también está escrito en texto real más abajo.
 *
 * Los keyframes viven en `src/app/afiliados/afiliados.css` con prefijo `dcaf`
 * y se congelan enteros bajo `prefers-reduced-motion: reduce`.
 *
 * NINGÚN monto se escribe aquí: las escenas 1 y 2 reciben ya formateado lo
 * que sale de `getPublicOffer()` en el server component.
 */

// ── Escena 1 · prisma hexagonal del hero ───────────────────────────────────

/** Cara con una cifra del programa ("$90 / al mes / por clínica…"). */
export interface CaraMonto {
  tipo: "monto";
  monto: string;
  unidad: string;
  nota: string;
}

/** Cara con una herramienta del panel (icono + título). */
export interface CaraDato {
  tipo: "dato";
  icono: "link" | "panel" | "cupon";
  titulo: string;
  nota: string;
}

export type CaraPrisma = CaraMonto | CaraDato;

const ICONOS: Record<CaraDato["icono"], React.ReactNode> = {
  link: (
    <>
      <path d="M10 14a5 5 0 0 0 7.07 0l2.86-2.86a5 5 0 0 0-7.07-7.07L11.2 5.73" />
      <path d="M14 10a5 5 0 0 0-7.07 0l-2.86 2.86a5 5 0 0 0 7.07 7.07l1.66-1.66" />
    </>
  ),
  panel: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M2 20h20" />
    </>
  ),
  cupon: (
    <>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5z" />
      <path d="M14 6v12" strokeDasharray="2.5 3" />
    </>
  ),
};

const caraBase: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 170,
  height: 228,
  margin: "-114px 0 0 -85px",
  backfaceVisibility: "hidden",
  borderRadius: 16,
  border: "1px solid rgba(96,165,250,.45)",
  background: "linear-gradient(165deg,rgba(37,99,235,.24),rgba(8,13,26,.62))",
  boxShadow: "inset 0 0 34px rgba(37,99,235,.3),0 0 26px rgba(37,99,235,.16)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: 14,
};

/**
 * Prisma hexagonal de 6 caras girando sobre su eje Y (32s, lineal, infinito).
 * Las caras van a `rotateY(i × 60deg) translateZ(147px)`: con menos de seis el
 * prisma quedaría abierto, así que el server siempre manda seis.
 */
export function EscenaPrisma({ caras }: { caras: CaraPrisma[] }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 360 }}>
      <div aria-hidden="true" style={{ position: "absolute", width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle,rgba(37,99,235,.3) 0%,rgba(37,99,235,0) 66%)" }} />
      <div aria-hidden="true" style={{ position: "absolute", right: "-4%", top: "6%", width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle,rgba(109,40,217,.28) 0%,rgba(109,40,217,0) 68%)" }} />
      <span aria-hidden="true" className="dcaf-float" style={{ position: "absolute", left: "9%", top: "16%", width: 6, height: 6, borderRadius: "50%", background: "#60a5fa", boxShadow: "0 0 12px rgba(96,165,250,.9)" }} />
      <span aria-hidden="true" className="dcaf-float--b" style={{ position: "absolute", right: "7%", top: "26%", width: 5, height: 5, borderRadius: "50%", background: "#a78bfa", boxShadow: "0 0 12px rgba(167,139,250,.9)" }} />
      <span aria-hidden="true" className="dcaf-float--c" style={{ position: "absolute", left: "16%", bottom: "14%", width: 4, height: 4, borderRadius: "50%", background: "#93c5fd", boxShadow: "0 0 10px rgba(147,197,253,.9)" }} />
      <span aria-hidden="true" className="dcaf-float--d" style={{ position: "absolute", right: "14%", bottom: "20%", width: 7, height: 7, borderRadius: "50%", background: "#60a5fa", boxShadow: "0 0 14px rgba(96,165,250,.85)" }} />

      <div className="dcaf-scene1" aria-hidden="true" style={{ perspective: 1300, width: 340, height: 340, position: "relative" }}>
        <div className="dcaf-ring" style={{ position: "absolute", left: "50%", top: "58%", width: 430, height: 430, margin: "-215px 0 0 -215px", borderRadius: "50%", border: "1px dashed rgba(96,165,250,.4)", transform: "rotateX(72deg)" }} />
        <div className="dcaf-ring-rev" style={{ position: "absolute", left: "50%", top: "58%", width: 330, height: 330, margin: "-165px 0 0 -165px", borderRadius: "50%", border: "1px solid rgba(139,92,246,.32)", transform: "rotateX(72deg)" }} />

        <div className="dcaf-spin" style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transform: "rotateX(-14deg) rotateY(24deg)" }}>
          {caras.slice(0, 6).map((cara, i) => (
            <div
              key={i}
              style={{
                ...caraBase,
                gap: cara.tipo === "monto" ? 6 : 8,
                transform: `rotateY(${i * 60}deg) translateZ(147px)`,
              }}
            >
              {cara.tipo === "monto" ? (
                <>
                  <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", color: "#93c5fd" }}>{cara.monto}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em" }}>{cara.unidad}</span>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>{cara.nota}</span>
                </>
              ) : (
                <>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {ICONOS[cara.icono]}
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{cara.titulo}</span>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>{cara.nota}</span>
                </>
              )}
            </div>
          ))}
        </div>

        <div aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: -6, width: 250, height: 44, marginLeft: -125, borderRadius: "50%", background: "radial-gradient(ellipse,rgba(37,99,235,.34) 0%,rgba(37,99,235,0) 70%)" }} />
      </div>
    </div>
  );
}

// ── Escena 2 · pila de clínicas con balanceo ───────────────────────────────

export interface TarjetaPila {
  nombre: string;
  detalle: string;
}

/**
 * Pila de tarjetas que se balancea (rotateY de −8° a 8°, 14s ease-in-out).
 * Cada tarjeta sube 76px, se desplaza 8px a la derecha y avanza 38px en Z:
 * de ahí sale la sensación de profundidad sin una sola imagen.
 */
export function EscenaPila({ tarjetas, total }: { tarjetas: TarjetaPila[]; total: string }) {
  return (
    <div aria-hidden="true" style={{ perspective: 1300, height: 400, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="dcaf-sway" style={{ position: "relative", width: 270, height: 320, transformStyle: "preserve-3d", transform: "rotateX(9deg) rotateY(-8deg)" }}>
        {tarjetas.slice(0, 4).map((t, i) => (
          <div
            key={t.nombre}
            style={{
              position: "absolute",
              left: 10 + i * 8,
              bottom: i * 76,
              width: 250,
              transform: `translateZ(${i * 38}px)`,
              background: "rgba(255,255,255,.94)",
              border: "1px solid #dbeafe",
              borderRadius: 13,
              padding: "13px 15px",
              boxShadow: "0 14px 34px rgba(37,99,235,.13)",
              display: "flex",
              alignItems: "center",
              gap: 11,
            }}
          >
            <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#dcfce7", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 13l4 4 10-10" />
              </svg>
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.35 }}>
              <strong style={{ display: "block", fontSize: 13.5, color: "#0f172a" }}>{t.nombre}</strong>
              <span style={{ color: "#64748b" }}>{t.detalle}</span>
            </span>
          </div>
        ))}
        <div style={{ position: "absolute", left: "50%", top: -14, transform: "translateX(-50%) translateZ(140px)", background: "#1d4ed8", color: "#ffffff", borderRadius: 999, padding: "8px 18px", fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", boxShadow: "0 10px 26px rgba(29,78,216,.35)" }}>
          {total}
        </div>
      </div>
    </div>
  );
}

// ── Escena 3 · anillos del cierre ──────────────────────────────────────────

/**
 * Dos anillos tumbados (`rotateX(72deg)`) girando en sentidos opuestos, de
 * fondo tras el CTA final. Se ocultan por completo bajo 767px.
 */
export function EscenaAnillos() {
  return (
    <div className="dcaf-scene3" aria-hidden="true" style={{ position: "absolute", inset: 0, perspective: 1000, pointerEvents: "none" }}>
      <div className="dcaf-ring-slow" style={{ position: "absolute", left: "50%", top: "60%", width: 640, height: 640, margin: "-320px 0 0 -320px", borderRadius: "50%", border: "1.5px solid rgba(96,165,250,.26)", transform: "rotateX(72deg)" }} />
      <div className="dcaf-ring-rev-slow" style={{ position: "absolute", left: "50%", top: "60%", width: 430, height: 430, margin: "-215px 0 0 -215px", borderRadius: "50%", border: "1.5px dashed rgba(96,165,250,.32)", transform: "rotateX(72deg)" }} />
      <div style={{ position: "absolute", left: "50%", top: "60%", width: 560, height: 280, margin: "-140px 0 0 -280px", background: "radial-gradient(ellipse,rgba(37,99,235,.2) 0%,rgba(37,99,235,0) 70%)" }} />
    </div>
  );
}
