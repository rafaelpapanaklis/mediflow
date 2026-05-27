// ═══════════════════════════════════════════════════════════════════════
// Laboratorios Dentales — contrato compartido del módulo.
// Espejo de src/lib/suppliers/types.ts. Única fuente de verdad de tipos,
// catálogos, rutas y APIs del marketplace de laboratorios dentales.
//
// El laboratorio es GLOBAL (sin clinicId): vende a cualquier clínica. El
// multi-tenant se resuelve SIEMPRE desde sesión — clinicId desde
// getAuthContext(), labId desde getDentalLabContext() — NUNCA desde el body.
//
// Nomenclatura: prefijo "DentalLab" en los modelos Prisma para no chocar con
// el módulo de laboratorio clínico existente (LabOrder = estudios de paciente).
//
// ── CONTRATO DE RUTAS ───────────────────────────────────────────────────
// Clínica (dentro de /dashboard, sesión de clínica):
//   /dashboard/laboratorios                    → catálogo de labs (A1)
//   /dashboard/laboratorios/[labId]            → ficha + servicios (A2)
//   /dashboard/laboratorios/ordenes            → mis órdenes (A4)
//   /dashboard/laboratorios/ordenes/[orderId]  → detalle de orden (A5)
// Laboratorio (panel propio, sesión de lab):
//   /laboratorios/login | /registro | /pendiente  → públicas (B2/B0/B1)
//   /laboratorios/inicio                       → dashboard del lab (B3)
//   /laboratorios/servicios                    → CRUD de servicios (B4)
//   /laboratorios/trafico                      → configuración de tráfico (B5)
//   /laboratorios/ordenes[/[id]]               → órdenes recibidas (B6/B7)
//   /laboratorios/perfil                       → perfil + métodos de pago (B8)
// Admin (super-admin):
//   /admin/laboratorios                        → lista + aprobar/rechazar (C1)
//
// ── CONTRATO DE APIs ────────────────────────────────────────────────────
// Clínica:
//   GET  /api/laboratorios                     → labs APPROVED (browse)
//   GET  /api/laboratorios/[labId]             → ficha + servicios activos
//   GET  /api/laboratorios/ordenes             → órdenes de la clínica
//   POST /api/laboratorios/ordenes             → crear { labId, serviceId, ... }
//   GET  /api/laboratorios/ordenes/[id]        → detalle + timeline
//   POST /api/laboratorios/ordenes/[id]/cancel → cancelar
// Laboratorio (sesión de lab):
//   POST /api/laboratorios/auth/register       → crea DentalLab(PENDING)+LabUser
//   GET/PUT  /api/laboratorios/me              → perfil del lab
//   GET/POST /api/laboratorios/me/servicios    → CRUD servicios
//   GET/PUT  /api/laboratorios/me/trafico      → estado + historial de tráfico
//   GET      /api/laboratorios/me/ordenes      → órdenes recibidas
//   PUT      /api/laboratorios/me/ordenes/[id]/estatus  → { to, eta? }
//   PUT      /api/laboratorios/me/ordenes/[id]/eta      → { pickup?, delivery? }
//   GET/PUT  /api/laboratorios/me/pagos        → métodos de pago + fiscal
//   *        /api/laboratorios/me/cuentas[...]  → cuentas bancarias SPEI
//   GET      /api/laboratorios/me/facturas     → facturas
// Admin:
//   GET   /api/admin/laboratorios              → todos los labs (?status=)
//   PATCH /api/admin/laboratorios/[id]         → { status, rejectedReason? }
// ═══════════════════════════════════════════════════════════════════════

// ── Enums (espejo 1:1 de los enums Prisma; como union types para poder
//    importarlos desde componentes "use client" sin el runtime de Prisma). ──
export type DentalLabStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type DentalLabUserRole = "OWNER" | "MANAGER" | "STAFF";
export type DentalLabOrderStatus =
  | "SOLICITADA"
  | "RECIBIDA"
  | "ATENDIENDO"
  | "ENVIADA"
  | "ENTREGADA"
  | "CANCELADA";
export type DentalLabTrafficLevel = "LOW" | "MEDIUM" | "HIGH";
export type DentalLabTrafficSource = "MANUAL" | "AUTO";
export type DentalLabOrderActor = "CLINIC" | "LAB" | "SYSTEM";
export type DentalLabPaymentStatus = "UNPAID" | "PAID";
export type DentalLabInvoiceStatus = "PAID" | "PENDING" | "OVERDUE";
export type DentalLabChatSender = "CLINIC" | "LAB";

// ── Bucket de Supabase Storage (archivos de orden + logos del lab). ──
export const DENTAL_LAB_FILES_BUCKET = "dental-lab-files" as const;

// ── Formatos aceptados para archivos de diseño / escaneo. ──
export const DENTAL_LAB_FILE_ACCEPT = ["STL", "PLY", "DCM", "PDF", "JPG", "PNG"] as const;
export const DENTAL_LAB_FILE_MAX_MB = 100;

// ── Los 9 servicios fijos del catálogo de laboratorio. ──
export const DENTAL_LAB_SERVICES = [
  { key: "s1", short: "Coronas", full: "Fabricación de coronas y puentes" },
  { key: "s2", short: "Prótesis", full: "Confección de prótesis fijas y removibles" },
  { key: "s3", short: "Carillas", full: "Diseño y elaboración de carillas estéticas" },
  { key: "s4", short: "Ortodoncia", full: "Creación de aparatos de ortodoncia" },
  { key: "s5", short: "Férulas", full: "Férulas de descarga y protectores bucales" },
  { key: "s6", short: "Inlays", full: "Incrustaciones dentales (inlays y onlays)" },
  { key: "s7", short: "CAD/CAM", full: "Diseño CAD/CAM y fresado" },
  { key: "s8", short: "Impresión 3D", full: "Impresión 3D de modelos dentales" },
  { key: "s9", short: "Reparación", full: "Reparación y ajuste de prótesis" },
] as const;
export type DentalLabServiceKey = (typeof DENTAL_LAB_SERVICES)[number]["key"];

// ── Niveles de tráfico → rango ETA sugerido + presentación. ──
export const DENTAL_LAB_TRAFFIC: Record<
  DentalLabTrafficLevel,
  {
    label: string;
    rangeLabel: string;
    minMinutes: number;
    maxMinutes: number;
    tone: "success" | "warning" | "danger";
    vehicle: "bike" | "motorcycle" | "car";
    desc: string;
  }
> = {
  LOW: {
    label: "Tráfico bajo",
    rangeLabel: "15–30 min",
    minMinutes: 15,
    maxMinutes: 30,
    tone: "success",
    vehicle: "bike",
    desc: "Sin contratiempos. Mensajero en moto, ruta despejada.",
  },
  MEDIUM: {
    label: "Tráfico medio",
    rangeLabel: "1–3 h",
    minMinutes: 60,
    maxMinutes: 180,
    tone: "warning",
    vehicle: "motorcycle",
    desc: "Hora pico o tráfico moderado. Mensajero en moto.",
  },
  HIGH: {
    label: "Tráfico alto",
    rangeLabel: "3+ h",
    minMinutes: 180,
    maxMinutes: 360,
    tone: "danger",
    vehicle: "car",
    desc: "Tráfico denso, lluvia o evento. Mensajero en coche.",
  },
};

// ── Estatus de orden → label es-MX + tono semántico. ──
export const DENTAL_LAB_ORDER_STATUS: Record<
  DentalLabOrderStatus,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "neutral" }
> = {
  SOLICITADA: { label: "Solicitada", tone: "info" },
  RECIBIDA: { label: "Recibida", tone: "brand" },
  ATENDIENDO: { label: "Atendiendo", tone: "warning" },
  ENVIADA: { label: "Enviada a clínica", tone: "info" },
  ENTREGADA: { label: "Entregada", tone: "success" },
  CANCELADA: { label: "Cancelada", tone: "neutral" },
};

// Secuencia canónica del timeline (cancelada es terminal aparte).
export const DENTAL_LAB_ORDER_FLOW: DentalLabOrderStatus[] = [
  "SOLICITADA",
  "RECIBIDA",
  "ATENDIENDO",
  "ENVIADA",
  "ENTREGADA",
];

export const DENTAL_LAB_STATUS_LABELS: Record<DentalLabStatus, string> = {
  PENDING: "En revisión",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  SUSPENDED: "Suspendido",
};

export const DENTAL_LAB_INVOICE_STATUS_LABELS: Record<DentalLabInvoiceStatus, string> = {
  PAID: "Pagada",
  PENDING: "Por cobrar",
  OVERDUE: "Vencida",
};

// ── DTOs — shape JSON que devuelven las APIs (fechas como ISO string). ──
export interface DentalLabDTO {
  id: string;
  name: string;
  slug: string;
  rfc: string | null;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  description: string | null;
  founded: number | null;
  services: string[];
  hours: Record<string, { open: string; close: string } | null> | null;
  coverageZones: string[];
  rating: number | null;
  ratingCount: number;
  onTimePct: number | null;
  totalOrders: number;
  status: DentalLabStatus;
  traffic: DentalLabTrafficStateDTO;
  createdAt: string;
  updatedAt: string;
}

export interface DentalLabServiceDTO {
  id: string;
  labId: string;
  serviceKey: string;
  name: string;
  description: string | null;
  priceFrom: number;
  unit: string;
  daysMin: number | null;
  daysMax: number | null;
  imageUrl: string | null;
  isActive: boolean;
}

export interface DentalLabOrderEventDTO {
  status: DentalLabOrderStatus;
  at: string | null; // null = aún no alcanzado
  eta: string | null; // para pasos futuros: tiempo estimado
  actor: { id: string | null; name: string | null; role: DentalLabOrderActor | null } | null;
  detail: string | null;
}

export interface DentalLabCourierDTO {
  name: string;
  initials: string;
  vehicle: string;
  plate: string;
  phone: string;
  etaMinutes?: number;
  location?: { lat: number; lng: number };
}

export interface DentalLabOrderFileDTO {
  id: string;
  url: string;
  name: string;
  fileType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
}

export interface DentalLabOrderDTO {
  id: string;
  orderNumber: string;
  clinicId: string;
  labId: string;
  lab?: DentalLabDTO;
  serviceId: string | null;
  service?: DentalLabServiceDTO;
  patientId: string | null;
  patientName: string | null;
  internalRef: string | null;
  status: DentalLabOrderStatus;
  notes: string | null;
  basePrice: number;
  extrasTotal: number;
  total: number;
  paymentStatus: DentalLabPaymentStatus;
  paymentMethod: string | null;
  priority: boolean;
  pickupAt: string | null;
  etaAt: string | null;
  courier: DentalLabCourierDTO | null;
  timeline: DentalLabOrderEventDTO[];
  files: DentalLabOrderFileDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface DentalLabTrafficStateDTO {
  level: DentalLabTrafficLevel;
  manualOverride: { minMinutes: number; maxMinutes: number; note: string | null } | null;
  updatedAt: string;
}

export interface DentalLabTrafficHistoryDTO {
  at: string;
  from: DentalLabTrafficLevel | null;
  to: DentalLabTrafficLevel | null;
  by: { userId: string | null; name: string | null } | null;
  source: DentalLabTrafficSource;
  note: string | null;
}

export interface DentalLabBankAccountDTO {
  id: string;
  bank: string;
  clabe: string;
  accountNumber: string | null;
  holderName: string;
  isPrimary: boolean;
}

export interface DentalLabFiscalDataDTO {
  legalName: string;
  rfc: string;
  taxRegime: { code: string; label: string };
  zipCode: string;
  cfdiUse: { code: string; label: string };
  state: string | null;
  certificateUrl: string | null;
  certificateValidUntil: string | null;
}

export interface DentalLabPaymentMethodsDTO {
  spei: { enabled: boolean; isPrimary: boolean; accounts: DentalLabBankAccountDTO[] };
  card: { enabled: boolean; stripeConnected: boolean };
  cash: { enabled: boolean };
  invoice: { enabled: boolean; pendingApprovals: number };
}

export interface DentalLabInvoiceDTO {
  id: string;
  folio: string;
  clinicId: string | null;
  clinicName: string;
  amount: number;
  status: DentalLabInvoiceStatus;
  issuedAt: string;
}

export interface DentalLabChatMessageDTO {
  id: string;
  threadId: string;
  sender: DentalLabChatSender;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface DentalLabChatThreadDTO {
  id: string;
  clinicId: string;
  labId: string;
  orderId: string | null;
  lastMessageAt: string;
  clinicUnread: number;
  labUnread: number;
  messages?: DentalLabChatMessageDTO[];
}

export interface DentalLabAdminRowDTO {
  id: string;
  name: string;
  city: string | null;
  rfc: string | null;
  email: string;
  registeredAt: string;
  servicesCount: number;
  status: DentalLabStatus;
  rejectedReason: string | null;
  totalOrders: number;
}

// ── Helpers puros compartidos. ──

/** Número de orden legible y único-por-tiempo: "ORD-LXXXXXX-XXXX". */
export function makeDentalLabOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

/** Referencia interna de paciente sugerida: "REF-####". */
export function makeInternalRef(): string {
  return `REF-${Math.floor(1000 + Math.random() * 9000)}`;
}

/** Slug estable a partir del nombre del lab (sin acentos, kebab-case). */
export function slugifyDentalLab(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "laboratorio"
  );
}
