// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — contrato compartido del vertical.
// Espejo de src/lib/laboratorios/types.ts. ÚNICA fuente de verdad de tipos,
// catálogos, flujos de estado, terminología y rutas del producto barber.
//
// Barber es un producto SEPARADO del dental. Multi-tenant: barbershopId sale
// SIEMPRE de la sesión (getBarberContext en src/lib/barber-auth.ts), NUNCA
// del body/query. Ojo Prisma: barbershopId undefined BORRA el filtro — jamás
// dejar pasar un undefined a un where.
//
// TERMINOLOGÍA (obligatoria en TODA la UI del vertical): cliente / barbero /
// barbería / servicio / visita. PROHIBIDO: "paciente", "doctor", "Dr.",
// "clínica", "consulta", "expediente". Ver BARBER_TERMS abajo.
//
// ── CONTRATO DE RUTAS ───────────────────────────────────────────────────
// Panel (sesión de barbería, guard en src/app/barber/(panel)/layout.tsx):
//   /barber                → router (login / suscripción / inicio)
//   /barber/registro       → alta pública de barbería (sin sesión)
//   /barber/inicio         → dashboard               (T1 · Ola 1)
//   /barber/agenda         → agenda de citas         (T2)
//   /barber/fila           → fila virtual walk-ins   (T3)
//   /barber/solicitudes    → solicitudes de reserva pública (T2)
//   /barber/clientes       → clientes + preferencias (T4)
//   /barber/servicios      → catálogo de servicios   (T5)
//   /barber/barberos       → equipo / barberos       (T5)
//   /barber/caja           → caja y cortes           (T6)
//   /barber/comisiones     → comisiones              (T6)
//   /barber/membresias     → membresías de clientes  (T7)
//   /barber/productos      → inventario simple       (T7)
//   /barber/mi-web         → editor de mini-web      (T8)
//   /barber/whatsapp       → inbox / plantillas      (ola WhatsApp)
//   /barber/suscripcion    → plan y pago DaleControl (ola Stripe)
//   /barber/configuracion  → datos de la barbería    (T5)
// Público (SIN sesión):
//   /b/[slug]              → mini-web pública de la barbería   (T8)
//   /b/[slug]/reservar     → flujo de reserva pública          (T8)
// APIs (prefijo /api/barber/*; multi-tenant desde sesión):
//   POST /api/barber/auth/register   → alta barbería + OWNER (Ola 0 ✓)
//   POST /api/barber/auth/logout     → signOut                (Ola 0 ✓)
//   El resto de APIs las define cada terminal BAJO /api/barber/<área>/…
//   (p.ej. /api/barber/agenda, /api/barber/clientes). Público de reserva:
//   /api/barber/public/… (valida slug, jamás recibe barbershopId).
// ═══════════════════════════════════════════════════════════════════════

// ── Enums (espejo 1:1 de los enums Prisma; como union types para poder
//    importarlos desde componentes "use client" sin el runtime de Prisma). ──
export type BarberPlanId = "BASICO" | "AVANZADO" | "PROFESIONAL";
export type BarberWhatsappSender = "PLATFORM" | "OWN_WABA";
export type BarberRole = "OWNER" | "MANAGER" | "BARBER" | "RECEPTION";
export type BarberCommissionType = "COMMISSION" | "CHAIR_RENT" | "SALARY";
export type BarberAppointmentStatus =
  | "PENDING"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "DONE"
  | "NO_SHOW"
  | "CANCELLED";
export type BarberAppointmentSource = "PANEL" | "PUBLIC" | "WALKIN" | "WHATSAPP";
export type BarberDepositStatus = "PENDING" | "PAID" | "REFUNDED" | "FORFEITED";
export type BarberWalkInStatus = "WAITING" | "CALLED" | "SERVED" | "LEFT";
export type BarberClientMembershipStatus = "ACTIVE" | "PAUSED" | "EXPIRED" | "CANCELLED";
export type BarberPaymentMethod = "CASH" | "CARD" | "SPEI" | "STRIPE";
export type BarberMessageDirection = "INBOUND" | "OUTBOUND";
export type BarberMessageStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

// ── Terminología del producto. La UI se escribe con estas palabras. ──
export const BARBER_TERMS = {
  client: "cliente",
  professional: "barbero",
  business: "barbería",
  service: "servicio",
  visit: "visita",
} as const;
export type BarberTermKey = keyof typeof BARBER_TERMS;

// ── Rutas base ──────────────────────────────────────────────────────────
/** Base del panel interno. */
export const BARBER_PANEL_BASE = "/barber" as const;
/**
 * Base pública de las mini-webs de barbería (/b/[slug]). Verificada libre en
 * la Ola 0: no existe src/app/b y una ruta estática SIEMPRE gana al catch-all
 * /[slug] de especialidades dentales.
 */
export const BARBER_PUBLIC_BASE = "/b" as const;

/** Bucket de Supabase Storage para archivos del vertical (logos, fotos). */
export const BARBER_FILES_BUCKET = "barber-files" as const;

// ── Máquina de estados de la cita (espejo de orders-shared de labs) ─────
// Flujo canónico lineal; CANCELLED permitido desde cualquier estado NO
// terminal; NO_SHOW solo desde PENDING/CONFIRMED (la cita nunca inició).
// DONE, NO_SHOW y CANCELLED son terminales.
export const BARBER_APPOINTMENT_FLOW: BarberAppointmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "DONE",
];

export const BARBER_APPOINTMENT_STATUS_FLOW: Record<
  BarberAppointmentStatus,
  BarberAppointmentStatus[]
> = (() => {
  const map: Record<BarberAppointmentStatus, BarberAppointmentStatus[]> = {
    PENDING: [],
    CONFIRMED: [],
    IN_PROGRESS: [],
    DONE: [],
    NO_SHOW: [],
    CANCELLED: [],
  };
  for (let i = 0; i < BARBER_APPOINTMENT_FLOW.length - 1; i++) {
    const from = BARBER_APPOINTMENT_FLOW[i];
    const to = BARBER_APPOINTMENT_FLOW[i + 1];
    map[from] = [to, "CANCELLED"];
  }
  // La cita que nunca llegó: NO_SHOW solo tiene sentido antes de iniciar.
  map.PENDING = [...map.PENDING, "NO_SHOW"];
  map.CONFIRMED = [...map.CONFIRMED, "NO_SHOW"];
  // Terminales sin salidas.
  map.DONE = [];
  map.NO_SHOW = [];
  map.CANCELLED = [];
  return map;
})();

/** ¿Es válida la transición `from` → `to` según el flujo canónico? */
export function canTransition(
  from: BarberAppointmentStatus,
  to: BarberAppointmentStatus,
): boolean {
  return BARBER_APPOINTMENT_STATUS_FLOW[from]?.includes(to) ?? false;
}

/** Estados alcanzables desde `from` (incluye CANCELLED / NO_SHOW). */
export function nextStatuses(from: BarberAppointmentStatus): BarberAppointmentStatus[] {
  return [...(BARBER_APPOINTMENT_STATUS_FLOW[from] ?? [])];
}

export function isTerminalAppointmentStatus(status: BarberAppointmentStatus): boolean {
  return status === "DONE" || status === "NO_SHOW" || status === "CANCELLED";
}

// ── Labels es-MX + tono semántico (para badges/botones de la UI). ──
export const BARBER_APPOINTMENT_STATUS_UI: Record<
  BarberAppointmentStatus,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "danger" | "neutral" }
> = {
  PENDING: { label: "Pendiente", tone: "warning" },
  CONFIRMED: { label: "Confirmada", tone: "info" },
  IN_PROGRESS: { label: "En silla", tone: "brand" },
  DONE: { label: "Completada", tone: "success" },
  NO_SHOW: { label: "No llegó", tone: "danger" },
  CANCELLED: { label: "Cancelada", tone: "neutral" },
};

/** Etiqueta de acción del botón que LLEVA a cada estado. */
export const BARBER_APPOINTMENT_ACTION_LABELS: Record<BarberAppointmentStatus, string> = {
  PENDING: "Marcar pendiente",
  CONFIRMED: "Confirmar cita",
  IN_PROGRESS: "Iniciar servicio",
  DONE: "Completar visita",
  NO_SHOW: "Marcar no llegó",
  CANCELLED: "Cancelar cita",
};

export const BARBER_WALKIN_STATUS_UI: Record<
  BarberWalkInStatus,
  { label: string; tone: "info" | "brand" | "success" | "neutral" }
> = {
  WAITING: { label: "En espera", tone: "info" },
  CALLED: { label: "Llamado", tone: "brand" },
  SERVED: { label: "Atendido", tone: "success" },
  LEFT: { label: "Se fue", tone: "neutral" },
};

export const BARBER_ROLE_LABELS: Record<BarberRole, string> = {
  OWNER: "Dueño",
  MANAGER: "Encargado",
  BARBER: "Barbero",
  RECEPTION: "Recepción",
};

export const BARBER_COMMISSION_TYPE_LABELS: Record<BarberCommissionType, string> = {
  COMMISSION: "Comisión (%)",
  CHAIR_RENT: "Renta de silla",
  SALARY: "Sueldo",
};

export const BARBER_PAYMENT_METHOD_LABELS: Record<BarberPaymentMethod, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  SPEI: "Transferencia (SPEI)",
  STRIPE: "Pago en línea",
};

export const BARBER_DEPOSIT_STATUS_LABELS: Record<BarberDepositStatus, string> = {
  PENDING: "Anticipo pendiente",
  PAID: "Anticipo pagado",
  REFUNDED: "Anticipo devuelto",
  FORFEITED: "Anticipo retenido",
};

export const BARBER_CLIENT_MEMBERSHIP_STATUS_LABELS: Record<
  BarberClientMembershipStatus,
  string
> = {
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  EXPIRED: "Vencida",
  CANCELLED: "Cancelada",
};

export const BARBER_MESSAGE_STATUS_LABELS: Record<BarberMessageStatus, string> = {
  PENDING: "Pendiente",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  READ: "Leído",
  FAILED: "Falló",
};

// ── Catálogo SEMILLA de servicios (se insertan al registrar la barbería). ──
// price = precio SUGERIDO inicial (MXN); la barbería lo edita a su gusto.
// NO es un precio de plan de DaleControl (esos viven en barber_plan_configs).
export const BARBER_DEFAULT_SERVICES: ReadonlyArray<{
  key: string;
  name: string;
  durationMin: number;
  price: number;
  category: string;
  sortOrder: number;
}> = [
  { key: "corte", name: "Corte de cabello", durationMin: 30, price: 180, category: "corte", sortOrder: 0 },
  { key: "corte-barba", name: "Corte + barba", durationMin: 50, price: 280, category: "combo", sortOrder: 1 },
  { key: "barba", name: "Arreglo de barba", durationMin: 25, price: 140, category: "barba", sortOrder: 2 },
  { key: "delineado", name: "Delineado", durationMin: 15, price: 80, category: "corte", sortOrder: 3 },
  { key: "tinte", name: "Tinte / color", durationMin: 60, price: 350, category: "color", sortOrder: 4 },
  { key: "mascarilla", name: "Mascarilla negra", durationMin: 20, price: 120, category: "facial", sortOrder: 5 },
  { key: "cejas", name: "Perfilado de cejas", durationMin: 10, price: 60, category: "facial", sortOrder: 6 },
  { key: "nino", name: "Corte de niño", durationMin: 25, price: 150, category: "corte", sortOrder: 7 },
  { key: "ritual", name: "Ritual completo", durationMin: 75, price: 450, category: "combo", sortOrder: 8 },
] as const;

// ── Slug ────────────────────────────────────────────────────────────────
/** Slug URL-safe a partir del nombre de la barbería (para /b/[slug]). */
export function makeBarberSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return base || "barberia";
}

// ── Navegación del panel (la consume el layout + BarberSidebar). ────────
// label se resuelve vía i18n: barber.shell.nav.<key> (src/i18n/dictionaries/barber).
// featureKey gatea por plan (barber_plan_configs.features); permission por rol
// (src/lib/barber/permissions.ts). Sin featureKey = siempre visible (si el rol
// tiene el permiso). icon = nombre lucide que BarberSidebar sabe mapear.
export interface BarberNavItemDef {
  key: string;
  href: string;
  icon: string;
  section: "operacion" | "negocio" | "crecimiento" | "cuenta";
  permission: string | null;
  featureKey: string | null;
}

export const BARBER_NAV_ITEMS: BarberNavItemDef[] = [
  { key: "inicio", href: "/barber/inicio", icon: "home", section: "operacion", permission: null, featureKey: null },
  { key: "agenda", href: "/barber/agenda", icon: "calendar", section: "operacion", permission: "agenda.view", featureKey: "agenda" },
  { key: "fila", href: "/barber/fila", icon: "timer", section: "operacion", permission: "walkin.manage", featureKey: "walkinQueue" },
  { key: "solicitudes", href: "/barber/solicitudes", icon: "inbox", section: "operacion", permission: "requests.manage", featureKey: "publicBooking" },
  { key: "clientes", href: "/barber/clientes", icon: "users", section: "operacion", permission: "clients.view", featureKey: "clients" },
  { key: "servicios", href: "/barber/servicios", icon: "scissors", section: "negocio", permission: "services.manage", featureKey: null },
  { key: "barberos", href: "/barber/barberos", icon: "contact", section: "negocio", permission: "barbers.manage", featureKey: null },
  { key: "caja", href: "/barber/caja", icon: "wallet", section: "negocio", permission: "cash.view", featureKey: "cash" },
  { key: "comisiones", href: "/barber/comisiones", icon: "percent", section: "negocio", permission: "commissions.view", featureKey: "commissions" },
  { key: "membresias", href: "/barber/membresias", icon: "crown", section: "negocio", permission: "memberships.manage", featureKey: "memberships" },
  { key: "productos", href: "/barber/productos", icon: "package", section: "negocio", permission: "products.manage", featureKey: "products" },
  { key: "mi-web", href: "/barber/mi-web", icon: "globe", section: "crecimiento", permission: "web.edit", featureKey: "miniWebEditor" },
  { key: "whatsapp", href: "/barber/whatsapp", icon: "message-circle", section: "crecimiento", permission: "whatsapp.view", featureKey: "whatsappInbox" },
  { key: "suscripcion", href: "/barber/suscripcion", icon: "credit-card", section: "cuenta", permission: "billing.manage", featureKey: null },
  { key: "configuracion", href: "/barber/configuracion", icon: "settings", section: "cuenta", permission: "settings.edit", featureKey: null },
];

/** Item de navegación YA resuelto (label + visibilidad) que recibe el sidebar. */
export interface BarberNavItem {
  key: string;
  href: string;
  icon: string;
  section: "operacion" | "negocio" | "crecimiento" | "cuenta";
  label: string;
}

// ── DTOs — shape JSON que devuelven las APIs del vertical. ──────────────
// Fechas como ISO string; Decimals de Prisma como number (Number(x)).
export interface BarbershopDTO {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  locale: string;
  logoUrl: string | null;
  plan: BarberPlanId;
  subscriptionStatus: string;
  isActive: boolean;
}

export interface BarberDTO {
  id: string;
  name: string;
  nickname: string | null;
  photoUrl: string | null;
  bio: string | null;
  commissionType: BarberCommissionType;
  commissionPct: number | null;
  chairRent: number | null;
  isActive: boolean;
  sortOrder: number;
}

export interface BarberClientDTO {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  preferences: Record<string, unknown> | null;
  photoUrl: string | null;
  loyaltyCount: number;
  totalVisits: number;
  lastVisitAt: string | null;
  blockedAt: string | null;
}

export interface BarberServiceDTO {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: number;
  category: string;
  isActive: boolean;
  sortOrder: number;
}

export interface BarberAppointmentServiceDTO {
  id: string;
  serviceId: string;
  serviceName: string;
  priceAtBooking: number;
}

export interface BarberAppointmentDTO {
  id: string;
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  barberId: string | null;
  barberName: string | null;
  startAt: string;
  endAt: string;
  status: BarberAppointmentStatus;
  source: BarberAppointmentSource;
  depositAmount: number | null;
  depositStatus: BarberDepositStatus | null;
  notes: string | null;
  services: BarberAppointmentServiceDTO[];
}

export interface BarberWalkInDTO {
  id: string;
  clientName: string;
  phone: string | null;
  barberId: string | null;
  joinedAt: string;
  calledAt: string | null;
  servedAt: string | null;
  status: BarberWalkInStatus;
  position: number;
}

export interface BarberMembershipDTO {
  id: string;
  name: string;
  description: string | null;
  price: number;
  includedCuts: number | null;
  periodDays: number;
  isActive: boolean;
  sortOrder: number;
}

export interface BarberClientMembershipDTO {
  id: string;
  clientId: string;
  membershipId: string;
  status: BarberClientMembershipStatus;
  startAt: string;
  endAt: string;
  cutsUsed: number;
  paymentMethod: BarberPaymentMethod;
}

export interface BarberSaleItemDTO {
  id: string;
  serviceId: string | null;
  productId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
}

export interface BarberSaleDTO {
  id: string;
  appointmentId: string | null;
  clientId: string | null;
  barberId: string | null;
  subtotal: number;
  tip: number;
  total: number;
  paymentMethod: BarberPaymentMethod;
  cashSessionId: string | null;
  soldByUserId: string;
  notes: string | null;
  createdAt: string;
  items: BarberSaleItemDTO[];
}

export interface BarberProductDTO {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  cost: number | null;
  stock: number;
  isActive: boolean;
}

export interface BarberCashSessionDTO {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingAmount: number;
  countedAmount: number | null;
  expectedAmount: number | null;
  notes: string | null;
  openedByUserId: string;
  closedByUserId: string | null;
}

export interface BarberCommissionEntryDTO {
  id: string;
  barberId: string;
  saleId: string | null;
  appointmentId: string | null;
  base: number;
  pct: number | null;
  amount: number;
  periodKey: string;
  paidAt: string | null;
}

export interface BarberMessageDTO {
  id: string;
  direction: BarberMessageDirection;
  waMessageId: string | null;
  phone: string;
  body: string | null;
  templateName: string | null;
  status: BarberMessageStatus;
  errorMessage: string | null;
  clientId: string | null;
  appointmentId: string | null;
  createdAt: string;
}
