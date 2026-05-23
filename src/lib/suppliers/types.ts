// ═══════════════════════════════════════════════════════════════════════
// Proveedores / Compras — contrato compartido del marketplace B2B.
//
// Este módulo es la ÚNICA fuente de verdad de los tipos, las rutas y las
// APIs del sistema de proveedores. Toda terminal (T2–T7) que construya
// browse de clínica, carrito/pedidos, panel de proveedor, chat o admin
// DEBE importar de aquí para no desincronizarse.
//
// El proveedor es GLOBAL (sin clinicId): un proveedor vende a cualquier
// clínica. El multi-tenant se resuelve SIEMPRE desde sesión —
// clinicId desde getAuthContext(), supplierId desde getSupplierContext()—
// NUNCA desde el body del request.
//
// ── CONTRATO DE RUTAS ──────────────────────────────────────────────────
// Rutas clínica (dentro de /dashboard, sesión de clínica):
//   /dashboard/suppliers                     → browse de proveedores
//   /dashboard/suppliers/[supplierId]        → ficha + catálogo del proveedor
//   /dashboard/compras                       → carrito + historial de pedidos
//   /dashboard/compras/[orderId]             → detalle de un pedido
//   /dashboard/proveedor-chat/[supplierId]   → chat clínica↔proveedor
//
// Rutas proveedor (panel propio, sesión de proveedor):
//   /proveedores/login                       → público
//   /proveedores/registro                    → público
//   /proveedores/pendiente                   → registro en revisión (sin panel)
//   /proveedores/inicio                      → dashboard del proveedor (panel)
//   /proveedores/productos                   → CRUD de productos (panel)
//   /proveedores/pedidos                     → pedidos recibidos (panel)
//   /proveedores/pedidos/[id]                → detalle de pedido (panel)
//   /proveedores/chats                       → bandeja de chats (panel)
//   /proveedores/configuracion               → perfil del proveedor (panel)
//
// Rutas admin (panel plataforma):
//   /admin/suppliers                         → lista + aprobar/rechazar
//   /admin/suppliers/[id]                    → ficha del proveedor
//
// ── CONTRATO DE APIs ───────────────────────────────────────────────────
// Clínica:
//   GET    /api/suppliers                    → proveedores APPROVED (browse)
//   GET    /api/suppliers/[supplierId]       → ficha + productos activos
//   GET    /api/compras/cart                 → carritos de la clínica
//   POST   /api/compras/cart                 → agregar item {productId, quantity}
//   PATCH  /api/compras/cart/[itemId]        → cambiar cantidad {quantity}
//   DELETE /api/compras/cart/[itemId]        → quitar item
//   GET    /api/compras/orders               → pedidos de la clínica
//   POST   /api/compras/orders               → checkout {supplierId} (vacía carrito)
//   GET    /api/compras/orders/[id]          → detalle de pedido
// Proveedor:
//   GET    /api/proveedores/products         → productos del proveedor en sesión
//   POST   /api/proveedores/products         → crear producto
//   PATCH  /api/proveedores/products/[id]    → editar producto
//   DELETE /api/proveedores/products/[id]    → desactivar/eliminar producto
//   POST   /api/proveedores/products/[id]/images  → subir imagen (bucket abajo)
//   DELETE /api/proveedores/products/[id]/images  → quitar imagen {url}
//   GET    /api/proveedores/orders           → pedidos recibidos
//   PATCH  /api/proveedores/orders/[id]      → cambiar status/paymentStatus
//   GET    /api/proveedores/profile          → perfil del proveedor
//   PATCH  /api/proveedores/profile          → editar perfil
// Chat:
//   GET    /api/supplier-chat                → threads (vista clínica o proveedor)
//   POST   /api/supplier-chat/start          → abrir/obtener thread {supplierId}
//   GET    /api/supplier-chat/[threadId]/messages  → mensajes
//   POST   /api/supplier-chat/[threadId]/messages  → enviar {body}
// Admin:
//   GET    /api/admin/suppliers              → todos los proveedores
//   PATCH  /api/admin/suppliers/[id]         → {status, rejectedReason?}
//
// Auth proveedor (públicas, las crea la fundación):
//   POST   /api/proveedores/auth/register    → crea Supplier(PENDING)+SupplierUser(OWNER)
//   POST   /api/proveedores/auth/logout      → cierra sesión Supabase
// ═══════════════════════════════════════════════════════════════════════

// ── Enums (espejo 1:1 de los enums Prisma; como union types para poder
//    importarlos también desde componentes "use client" sin arrastrar el
//    runtime de @prisma/client). ──────────────────────────────────────
export type SupplierStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type SupplierUserRole = "OWNER" | "MANAGER" | "STAFF";
export type SupplierOrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";
export type SupplierPaymentStatus = "UNPAID" | "PAID";
export type SupplierChatSender = "CLINIC" | "SUPPLIER";

// ── Bucket de Supabase Storage para imágenes de producto (público). Lo
//    crea la migración supplier_marketplace. Las APIs de imágenes deben
//    usar esta constante, nunca un literal suelto. ──────────────────────
export const SUPPLIER_PRODUCTS_BUCKET = "supplier-products" as const;

// ── DTOs — shape JSON que devuelven las APIs (fechas como ISO string).
//    Los server components que consumen Prisma directo usan los tipos de
//    @prisma/client; estos DTOs son para el cruce por la red. ───────────
export interface SupplierDTO {
  id: string;
  businessName: string;
  slug: string;
  rfc: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  description: string | null;
  categories: string[];
  paymentMethods: string[];
  status: SupplierStatus;
  approvedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierProductImageDTO {
  id: string;
  productId: string;
  url: string;
  sortOrder: number;
  createdAt: string;
}

export interface SupplierProductDTO {
  id: string;
  supplierId: string;
  name: string;
  description: string | null;
  category: string | null;
  sku: string | null;
  price: number;
  unit: string;
  stock: number;
  isActive: boolean;
  images: SupplierProductImageDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface SupplierCartItemDTO {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  product?: SupplierProductDTO;
  createdAt: string;
}

export interface SupplierCartDTO {
  id: string;
  clinicId: string;
  supplierId: string;
  supplier?: SupplierDTO;
  items: SupplierCartItemDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface SupplierOrderItemDTO {
  id: string;
  orderId: string;
  productId: string | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface SupplierOrderDTO {
  id: string;
  orderNumber: string;
  clinicId: string;
  supplierId: string;
  supplier?: SupplierDTO;
  status: SupplierOrderStatus;
  paymentStatus: SupplierPaymentStatus;
  paymentMethod: string | null;
  subtotal: number;
  total: number;
  notes: string | null;
  items: SupplierOrderItemDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface SupplierChatMessageDTO {
  id: string;
  threadId: string;
  sender: SupplierChatSender;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface SupplierChatThreadDTO {
  id: string;
  clinicId: string;
  supplierId: string;
  supplier?: SupplierDTO;
  lastMessageAt: string;
  clinicUnread: number;
  supplierUnread: number;
  createdAt: string;
  messages?: SupplierChatMessageDTO[];
}

// ── Catálogo compartido para el form de registro y los filtros de browse.
//    Mantener estable: el browse filtra y el registro captura contra esta
//    misma lista. ─────────────────────────────────────────────────────
export const SUPPLIER_CATEGORY_OPTIONS = [
  "Insumos dentales",
  "Equipo y mobiliario",
  "Consumibles",
  "Ortodoncia",
  "Endodoncia",
  "Implantología",
  "Periodoncia",
  "Laboratorio dental",
  "Radiología",
  "Esterilización y limpieza",
  "Anestesia y farmacia",
  "Protección y desechables",
  "Otros",
] as const;

export const SUPPLIER_PAYMENT_METHOD_OPTIONS = [
  "Transferencia (SPEI)",
  "Tarjeta de crédito/débito",
  "Efectivo",
  "Crédito 30 días",
  "PayPal",
] as const;

// ── Labels legibles para badges de UI. ───────────────────────────────
export const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  PENDING: "En revisión",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  SUSPENDED: "Suspendido",
};

export const SUPPLIER_ORDER_STATUS_LABELS: Record<SupplierOrderStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  SHIPPED: "Enviado",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

export const SUPPLIER_PAYMENT_STATUS_LABELS: Record<SupplierPaymentStatus, string> = {
  UNPAID: "Sin pagar",
  PAID: "Pagado",
};

// ── Helpers puros compartidos. ────────────────────────────────────────

/** Genera un número de pedido legible y único-por-tiempo: "SO-LXXXXXX-XXXX". */
export function makeSupplierOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SO-${ts}-${rand}`;
}

/** Slug estable a partir del nombre del negocio (sin acentos, kebab-case). */
export function slugifySupplier(businessName: string): string {
  return businessName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos combinables (á→a)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "proveedor";
}
