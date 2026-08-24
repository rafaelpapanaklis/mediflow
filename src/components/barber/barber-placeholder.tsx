import {
  Calendar,
  Contact,
  CreditCard,
  Crown,
  Globe,
  Home,
  Inbox,
  MessageCircle,
  Package,
  Percent,
  Scissors,
  Settings,
  Timer,
  Users,
  Wallet,
} from "lucide-react";
import { getBarberT } from "@/i18n/dictionaries/barber";

const ICONS: Record<string, React.ComponentType<{ size?: number | string }>> = {
  inicio: Home,
  agenda: Calendar,
  fila: Timer,
  solicitudes: Inbox,
  clientes: Users,
  servicios: Scissors,
  barberos: Contact,
  caja: Wallet,
  comisiones: Percent,
  membresias: Crown,
  productos: Package,
  "mi-web": Globe,
  whatsapp: MessageCircle,
  suscripcion: CreditCard,
  configuracion: Settings,
};

/**
 * Placeholder "Próximamente" de un área del panel barber (Ola 0). Cada
 * terminal de la Ola 1 REEMPLAZA la página que lo usa por la suya — sin
 * tocar el sidebar ni este componente.
 */
export function BarberPlaceholder({
  areaKey,
  locale,
}: {
  areaKey: string;
  locale?: string | null;
}) {
  const t = getBarberT(locale);
  const Icon = ICONS[areaKey] ?? Scissors;
  const title = t(`barber.shell.nav.${areaKey}`);
  const desc = t(`barber.shell.areas.${areaKey}`);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "grid",
        placeItems: "center",
        padding: "clamp(16px, 3vw, 40px)",
      }}
    >
      <div
        className="shadow-card"
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "clamp(24px, 4vw, 40px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "var(--brand-grad, linear-gradient(135deg, #A2612F, #BE7A3C))",
            display: "grid",
            placeItems: "center",
            color: "#fff",
            boxShadow: "var(--shadow-2)",
          }}
        >
          <Icon size={26} />
        </div>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--brand)",
            background: "var(--brand-soft)",
            border: "1px solid var(--border-brand)",
          }}
        >
          {t("barber.shell.placeholder.soon")}
        </span>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--text-1)",
              margin: 0,
            }}
          >
            {title}
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-2)", margin: 0 }}>
            {desc}
          </p>
          <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-3)", margin: 0 }}>
            {t("barber.shell.placeholder.body")}
          </p>
        </div>
      </div>
    </div>
  );
}
