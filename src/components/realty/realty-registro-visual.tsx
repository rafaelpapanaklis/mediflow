import { Building2, Camera, FileText, Wallet } from "lucide-react";

/**
 * Panel izquierdo del alta de inmuebles. 100% decorativo: sin lógica, sin
 * estado y sin i18n (siempre español, que es el idioma de una alta pública
 * mexicana).
 *
 * Cada punto de la lista es algo que el producto HACE de verdad en cuanto
 * arranquen las olas — no hay ninguna promesa que el panel no vaya a
 * cumplir. Los precios NO se escriben aquí: viven en realty_plan_configs.
 */
const PUNTOS = [
  { Icon: Building2, texto: "Tu cartera completa, con fotos y recorrido 3D en cada inmueble." },
  { Icon: Camera, texto: "Tu web pública en tu propia dirección, sin pagarle a nadie por listar." },
  { Icon: FileText, texto: "Contratos de renta con su depósito, su vigencia y su incremento." },
  { Icon: Wallet, texto: "La cobranza del mes y el recibo de cada pago, sin hojas de cálculo." },
];

export function RealtyRegistroVisual() {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 30,
        padding: "clamp(32px, 5vw, 72px)",
        height: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(135deg, #2F6B4D, #63A07E)",
            color: "#fff",
          }}
        >
          <Building2 size={21} />
        </span>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>DaleControl</div>
          <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.62)" }}>Inmuebles</div>
        </div>
      </div>

      <h2
        style={{
          fontSize: "clamp(28px, 3.4vw, 40px)",
          lineHeight: 1.12,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: "#fff",
          margin: 0,
          maxWidth: 460,
        }}
      >
        Tu cartera, tus prospectos y tus rentas en un solo lugar.
      </h2>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          maxWidth: 440,
        }}
      >
        {PUNTOS.map(({ Icon, texto }) => (
          <li key={texto} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <span
              style={{
                flex: "0 0 auto",
                width: 30,
                height: 30,
                borderRadius: 9,
                display: "grid",
                placeItems: "center",
                background: "rgba(99,160,126,.20)",
                color: "#94BFA6",
              }}
            >
              <Icon size={15} />
            </span>
            <span style={{ fontSize: 14.5, lineHeight: 1.55, color: "rgba(255,255,255,.82)" }}>
              {texto}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
