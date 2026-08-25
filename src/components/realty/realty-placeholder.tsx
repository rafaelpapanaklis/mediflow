import {
  BarChart3,
  Building2,
  Calculator,
  CalendarCheck,
  Contact,
  CreditCard,
  FileText,
  Globe,
  Home,
  LifeBuoy,
  MessageCircle,
  Percent,
  Settings,
  Share2,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { getRealtyT } from "@/i18n/dictionaries/realty";

const ICONS: Record<string, React.ComponentType<{ size?: number | string }>> = {
  inicio: Home,
  inmuebles: Building2,
  prospectos: Users,
  visitas: CalendarCheck,
  rentas: FileText,
  cobranza: Wallet,
  propietarios: Contact,
  comisiones: Percent,
  equipo: UserPlus,
  reportes: BarChart3,
  "mi-web": Globe,
  portales: Share2,
  whatsapp: MessageCircle,
  calculadoras: Calculator,
  suscripcion: CreditCard,
  configuracion: Settings,
  soporte: LifeBuoy,
};

/**
 * Placeholder "En construcción" de un área del panel de inmuebles (Ola 0).
 * Cada terminal de la Ola 1 REEMPLAZA la página que lo usa por la suya —
 * sin tocar el sidebar ni este componente.
 *
 * El texto sale de realty.shell.areas.<key>: no dice "próximamente" a secas,
 * dice QUÉ va a haber ahí. Un placeholder que no promete nada concreto es
 * indistinguible de una pantalla rota.
 */
export function RealtyPlaceholder({
  areaKey,
  locale,
}: {
  areaKey: string;
  locale?: string | null;
}) {
  const t = getRealtyT(locale);
  const Icon = ICONS[areaKey] ?? Building2;
  const title = t(`realty.shell.nav.${areaKey}`);
  const desc = t(`realty.shell.areas.${areaKey}`);

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
          maxWidth: 560,
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
            background: "var(--brand-grad, linear-gradient(135deg, #2F6B4D, #3F8461))",
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
          {t("realty.shell.placeholder.soon")}
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
            {t("realty.shell.placeholder.body")}
          </p>
        </div>
      </div>
    </div>
  );
}
