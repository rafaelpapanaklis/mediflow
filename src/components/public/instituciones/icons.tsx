import {
  AlertTriangle,
  ArrowLeftRight,
  Box,
  Building2,
  Calculator,
  Calendar,
  CalendarClock,
  ClipboardCheck,
  FileSignature,
  FolderClosed,
  Gauge,
  GraduationCap,
  Grid3x3,
  Layers,
  ListChecks,
  MapPin,
  MessageCircle,
  Pen,
  PenLine,
  Pill,
  Receipt,
  Scan,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Table2,
  Tags,
  Target,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Un solo mapa nombre → icono. Las secciones piden el icono por el nombre
 * que trae la promesa en src/lib/edu/marketing.ts, así que ese archivo no
 * importa lucide (y por tanto lo puede leer una ruta Edge, como la imagen
 * social) y aquí no se decide nada de contenido.
 */
const MAPA: Record<string, LucideIcon> = {
  "alert-triangle": AlertTriangle,
  "arrow-left-right": ArrowLeftRight,
  box: Box,
  building: Building2,
  calculator: Calculator,
  calendar: Calendar,
  "calendar-clock": CalendarClock,
  clipboard: ClipboardCheck,
  "file-signature": FileSignature,
  folder: FolderClosed,
  gauge: Gauge,
  "graduation-cap": GraduationCap,
  grid: Grid3x3,
  layers: Layers,
  "list-checks": ListChecks,
  "map-pin": MapPin,
  "message-circle": MessageCircle,
  pen: Pen,
  "pen-line": PenLine,
  pill: Pill,
  receipt: Receipt,
  scan: Scan,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  stethoscope: Stethoscope,
  table: Table2,
  tags: Tags,
  target: Target,
  "user-check": UserCheck,
  users: Users,
  wallet: Wallet,
};

/** Si el nombre no está en el mapa cae en el birrete: nunca un hueco. */
export function EduIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Cmp = MAPA[name] ?? GraduationCap;
  return <Cmp size={size} strokeWidth={1.7} aria-hidden="true" />;
}

/**
 * El birrete de la marca. Es el mismo glifo que lleva el panel en su
 * cabecera (src/components/edu/edu-shell.tsx usa GraduationCap de lucide),
 * para que la página pública y el producto se sientan lo mismo.
 */
export function EduMark({ size = 20 }: { size?: number }) {
  return <GraduationCap size={size} strokeWidth={1.9} aria-hidden="true" />;
}
