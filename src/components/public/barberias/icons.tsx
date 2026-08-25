import {
  Bell,
  Bot,
  Calculator,
  CalendarCheck,
  CalendarDays,
  ChartNoAxesColumn,
  Check,
  Crown,
  Gift,
  Globe,
  Handshake,
  Heart,
  Inbox,
  KeyRound,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  Package,
  Percent,
  Printer,
  QrCode,
  Receipt,
  ShieldCheck,
  Smartphone,
  Store,
  Timer,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { OficioLibreta, OficioSilla, OficioTijeras } from "./oficio";

/**
 * Nombre (el que guarda src/lib/barber/marketing.ts) → icono. Los objetos
 * del oficio (tijeras, silla, libreta) van dibujados a mano en oficio.tsx;
 * el resto son lucide. Un nombre desconocido cae a las tijeras, nunca a un
 * hueco.
 */
const LUCIDE: Record<string, LucideIcon> = {
  bell: Bell,
  bot: Bot,
  calculator: Calculator,
  "calendar-check": CalendarCheck,
  "calendar-days": CalendarDays,
  chart: ChartNoAxesColumn,
  check: Check,
  crown: Crown,
  gift: Gift,
  globe: Globe,
  handshake: Handshake,
  heart: Heart,
  inbox: Inbox,
  "key-round": KeyRound,
  "life-buoy": LifeBuoy,
  megaphone: Megaphone,
  "message-circle": MessageCircle,
  package: Package,
  percent: Percent,
  printer: Printer,
  "qr-code": QrCode,
  receipt: Receipt,
  "shield-check": ShieldCheck,
  smartphone: Smartphone,
  store: Store,
  timer: Timer,
  "trending-up": TrendingUp,
  "user-round": UserRound,
  users: Users,
  wallet: Wallet,
};

export function LandingIcon({ name, size = 20 }: { name: string; size?: number }) {
  if (name === "scissors") return <OficioTijeras size={size} />;
  if (name === "armchair") return <OficioSilla size={size} />;
  if (name === "notebook-pen") return <OficioLibreta size={size} />;
  const Icon = LUCIDE[name];
  if (!Icon) return <OficioTijeras size={size} />;
  return <Icon size={size} aria-hidden="true" />;
}
