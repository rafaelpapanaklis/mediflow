/* ============================================================
   QUÉ DE UN PROVEEDOR O UN LABORATORIO PUEDE VIAJAR AL NAVEGADOR.

   Dos LISTAS BLANCAS, una por modelo. Igual que la del equipo
   (@/lib/team/member-fields) y por el mismo motivo: con una lista de
   campos prohibidos, la siguiente columna secreta que alguien añada sale
   al cliente por default.

   ── LO QUE ESTABA PASANDO (B2B-12) ────────────────────────────
   `mpAccessToken` es el Access Token de MercadoPago del vendedor: con él
   se cobra A SU NOMBRE. No es un secreto de la plataforma, es de un
   tercero. Y salía por siete sitios:

     · GET  /api/admin/labs        y  /api/admin/suppliers       (findMany
       sin select → la fila entera de CADA vendedor)
     · PATCH /api/admin/labs/[id]  y  /api/admin/suppliers/[id]  (devuelven
       `updated` completo al aprobar o rechazar)
     · /admin/labs y /admin/suppliers — los peores: son Server Components
       que bajan hasta 100 filas enteras a un componente "use client", así
       que el token viaja en el payload RSC con solo ABRIR la lista, sin
       que nadie pulse nada.
     · PATCH /api/laboratorios/traffic, que responde la fila del propio
       laboratorio.

   El módulo ya declaraba la regla contraria en
   /api/laboratorios/profile (`const { mpAccessToken, ...safe } = lab`, y
   solo expone `mpConnected`). Estos siete puntos se la saltaron.

   ── POR QUÉ LISTA BLANCA Y NO `{ mpAccessToken, ...safe }` ────
   Ese destructuring es lista NEGRA: funciona hoy porque hoy hay un solo
   secreto por tabla. `Supplier` y `DentalLab` ya tienen cuentas bancarias
   en tablas hermanas (clabe, número de cuenta) y no cuesta imaginar la
   siguiente columna. Con la lista blanca, una columna nueva no sale hasta
   que alguien venga aquí a decir que puede salir.

   Módulo SOLO de servidor: se usa en rutas y en server components.
   ============================================================ */

/**
 * Campos de `DentalLab` que pueden salir al navegador.
 *
 * NO está `mpAccessToken`, y no es olvido. Si una pantalla necesita saber
 * si el laboratorio conectó MercadoPago, la respuesta es el booleano
 * `payMercadoPagoEnabled` —que sí está— o un `mpConnected` derivado en el
 * servidor, nunca la credencial.
 */
export const LAB_SELECT = {
  id: true,
  name: true,
  slug: true,
  rfc: true,
  email: true,
  phone: true,
  whatsapp: true,
  website: true,
  address: true,
  mapsUrl: true,
  city: true,
  state: true,
  logoUrl: true,
  coverImageUrl: true,
  description: true,
  founded: true,
  services: true,
  hours: true,
  coverageZones: true,
  rating: true,
  ratingCount: true,
  onTimePct: true,
  totalOrders: true,
  status: true,
  approvedAt: true,
  rejectedReason: true,
  trafficLevel: true,
  trafficManualMin: true,
  trafficManualMax: true,
  trafficNote: true,
  trafficUpdatedAt: true,
  paySpeiEnabled: true,
  payCardEnabled: true,
  payCardStripeConnected: true,
  payCashEnabled: true,
  payInvoiceEnabled: true,
  payMercadoPagoEnabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Campos de `Supplier` que pueden salir al navegador. Mismo criterio. */
export const PROVEEDOR_SELECT = {
  id: true,
  businessName: true,
  slug: true,
  rfc: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  logoUrl: true,
  description: true,
  categories: true,
  paymentMethods: true,
  payTransferEnabled: true,
  payCashEnabled: true,
  payMercadoPagoEnabled: true,
  status: true,
  approvedAt: true,
  rejectedReason: true,
  whatsapp: true,
  website: true,
  mapsUrl: true,
  minOrderAmount: true,
  shippingNote: true,
  rating: true,
  ratingCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Los secretos de estas dos tablas. Solo para que las pruebas los nombren. */
export const SECRETOS_DE_VENDEDOR = ["mpAccessToken"] as const;
