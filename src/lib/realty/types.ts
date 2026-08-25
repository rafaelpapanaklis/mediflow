// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — contrato compartido del vertical.
// Espejo de src/lib/barber/types.ts. ÚNICA fuente de verdad de tipos,
// catálogos, flujos de estado, terminología y rutas del producto de bienes
// raíces. NADIE más lo toca en la Ola 1: las terminales lo LEEN.
//
// Inmuebles es un producto SEPARADO del dental y de barber. Multi-tenant:
// accountId sale SIEMPRE de la sesión (getRealtyContext en
// src/lib/realty-auth.ts), NUNCA del body/query. Ojo Prisma: un accountId
// undefined BORRA el filtro — jamás dejar pasar un undefined a un where.
//
// TERMINOLOGÍA (obligatoria en TODA la UI del vertical, español de México):
// prospecto / inquilino / propietario / asesor / inmueble / recámara /
// cochera / predial / escrituración. PROHIBIDO: "paciente", "doctor",
// "clínica", "barbero", y también los regionalismos de otros países
// ("toilette", "ambiente", "cochera" sí, "garage" no). Ver REALTY_TERMS.
//
// 🔴 NO EXISTE FACTURACIÓN EN ESTE VERTICAL. Ni CFDI, ni timbrado, ni
// complemento de pago. Lo que se le entrega a quien paga es un RECIBO
// (RealtyPayment.receiptUrl). Si una pantalla dice "factura", está mal.
//
// ── LOS TRES MODOS (el eje del producto entero) ─────────────────────────
// El interruptor real del producto NO es el tamaño de la cuenta: es
// ¿las propiedades son TUYAS o las vendes de alguien más?
//   AGENCY = inmobiliaria con agentes  → vende/renta inmuebles de terceros
//   AGENT  = asesor independiente solo → vende/renta inmuebles de terceros
//   OWNER  = propietario/rentista      → administra LO SUYO
// El modo vive en RealtyAccount.mode y arma el sidebar solo (campo `modes`
// de REALTY_NAV_ITEMS). Van en el contrato DESDE la Ola 0 a propósito:
// meterlos después obliga a reescribir diez pantallas.
//
// ── CONTRATO DE RUTAS ───────────────────────────────────────────────────
// Panel (sesión inmobiliaria, guard en src/app/inmobiliaria/(panel)/layout):
//   /inmobiliaria                → router (login / suscripción / inicio)
//   /inmobiliaria/registro       → alta pública con selector de MODO
//   /inmobiliaria/inicio         → tablero del día
//   /inmobiliaria/inmuebles      → cartera de propiedades
//   /inmobiliaria/prospectos     → CRM de leads
//   /inmobiliaria/visitas        → agenda de visitas y llaves
//   /inmobiliaria/propietarios   → dueños de los inmuebles + exclusivas
//   /inmobiliaria/rentas         → contratos de arrendamiento
//   /inmobiliaria/cobranza       → cargos, pagos, depósitos y gastos
//   /inmobiliaria/comisiones     → operaciones cerradas y su reparto
//   /inmobiliaria/equipo         → usuarios, roles y oficinas
//   /inmobiliaria/mi-web         → editor de la web pública
//   /inmobiliaria/portales       → feed propio y sincronización
//   /inmobiliaria/whatsapp       → inbox y plantillas
//   /inmobiliaria/calculadoras   → ISAI, crédito y rendimiento
//   /inmobiliaria/reportes       → números del negocio
//   /inmobiliaria/soporte        → tickets a DaleControl
//   /inmobiliaria/configuracion  → datos de la cuenta
//   /inmobiliaria/suscripcion    → plan y pago DaleControl
// Público (SIN sesión):
//   /i/[slug]                    → web pública de la cuenta
//   /i/[slug]/[propertyId]       → ficha del inmueble
//   /inmobiliarias               → landing del vertical (NO es de la Ola 0;
//                                  la ruta queda LIBRE y reservada)
// APIs (prefijo /api/realty/*; multi-tenant desde sesión):
//   POST /api/realty/auth/register → alta cuenta + OWNER   (Ola 0 ✓)
//   POST /api/realty/auth/logout   → signOut                (Ola 0 ✓)
//   El resto lo define cada terminal BAJO /api/realty/<área>. Lo público
//   va en /api/realty/public/… y jamás recibe un accountId del request.
// ═══════════════════════════════════════════════════════════════════════

// ── Enums (espejo 1:1 de los enums Prisma; como union types para poder
//    importarlos desde componentes "use client" sin el runtime de Prisma). ──
export type RealtyMode = "AGENCY" | "AGENT" | "OWNER";
export type RealtyPlanId = "PROPIETARIO" | "ASESOR" | "INMOBILIARIA";
export type RealtyRole = "OWNER" | "MANAGER" | "AGENT" | "ASSISTANT";
export type RealtyWhatsappSender = "PLATFORM" | "OWN_WABA";
export type RealtyPropertyKind =
  | "CASA"
  | "DEPARTAMENTO"
  | "TERRENO"
  | "BODEGA"
  | "LOCAL"
  | "EDIFICIO"
  | "OFICINA"
  | "RANCHO";
export type RealtyOperation = "VENTA" | "RENTA" | "AMBAS";
export type RealtyPropertyStatus = "DISPONIBLE" | "APARTADO" | "VENDIDO" | "RENTADO";
export type RealtyCurrency = "MXN" | "USD";
export type RealtyTourKind = "TOUR_3D" | "TOUR_360" | "PANO_PROPIA" | "VIDEO";
export type RealtyDocumentKind =
  | "ESCRITURA"
  | "PREDIAL"
  | "REGIMEN"
  | "IDENTIFICACION"
  | "OTRO";
export type RealtyContactKind = "PROSPECTO" | "PROPIETARIO" | "INQUILINO";
export type RealtyLeadStage =
  | "NUEVO"
  | "CONTACTADO"
  | "CALIFICADO"
  | "VISITA"
  | "OFERTA"
  | "CIERRE"
  | "PERDIDO";
export type RealtyCreditKind =
  | "INFONAVIT"
  | "FOVISSSTE"
  | "BANCARIO"
  | "CONTADO"
  | "NINGUNO";
export type RealtyLeadActivityKind =
  | "NOTA"
  | "LLAMADA"
  | "WHATSAPP"
  | "CORREO"
  | "VISITA"
  | "CAMBIO_ETAPA"
  | "ASIGNACION";
export type RealtyVisitStatus =
  | "PROGRAMADA"
  | "CONFIRMADA"
  | "REALIZADA"
  | "CANCELADA"
  | "NO_ASISTIO";
export type RealtyLeaseStatus = "BORRADOR" | "ACTIVO" | "VENCIDO" | "TERMINADO";
export type RealtyLeasePartyRole = "INQUILINO" | "AVAL" | "FIADOR";
export type RealtyScreeningStatus = "PENDIENTE" | "APROBADO" | "RECHAZADO";
export type RealtyIncreaseRule = "INPC" | "FIJO" | "NINGUNO";
export type RealtyChargeStatus = "PENDIENTE" | "PARCIAL" | "PAGADO" | "VENCIDO";
export type RealtyPaymentMethod = "EFECTIVO" | "SPEI" | "TARJETA" | "OTRO";
export type RealtyDepositStatus = "RETENIDO" | "DEVUELTO" | "APLICADO";
export type RealtyMaintenanceStatus = "ABIERTO" | "EN_PROCESO" | "RESUELTO";
export type RealtyExpenseKind =
  | "PREDIAL"
  | "AGUA"
  | "MANTENIMIENTO"
  | "REPARACION"
  | "OTRO";
export type RealtyInventoryCheckKind = "ENTRADA" | "SALIDA";
export type RealtyDealKind = "VENTA" | "RENTA";
export type RealtyDealStatus = "EN_PROCESO" | "CERRADO" | "CANCELADO";
export type RealtyCommissionParty =
  | "CAPTADOR"
  | "COLOCADOR"
  | "OFICINA"
  | "FRANQUICIA"
  | "EXTERNO";
export type RealtyPortalListingStatus = "BORRADOR" | "PUBLICADO" | "PAUSADO" | "ERROR";
export type RealtyMessageDirection = "INBOUND" | "OUTBOUND";
export type RealtyMessageStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
export type RealtyTicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_REPLY" | "CLOSED";
export type RealtyTicketPriority = "LOW" | "NORMAL" | "HIGH";
/** AGENCY = alguien de la cuenta; ADMIN = soporte DaleControl. */
export type RealtyTicketAuthor = "AGENCY" | "ADMIN";
/** Parámetros de las calculadoras mexicanas. CAMBIAN CADA AÑO (ver tabla). */
export type RealtyCalcParamKind =
  | "ISAI"
  | "UMA"
  | "UDI"
  | "INPC"
  | "INFONAVIT"
  | "FOVISSSTE";

// ── Los tres modos: helpers ─────────────────────────────────────────────
// Regla de lectura: `isOwner` NO significa "es el dueño de la cuenta" (eso
// es el ROL OWNER). Significa que la cuenta administra inmuebles PROPIOS.
// Rol y modo son ejes distintos y se cruzan: un AGENT independiente tiene
// rol OWNER de su cuenta en modo AGENT.
export const REALTY_MODES = ["AGENCY", "AGENT", "OWNER"] as const;

export function isRealtyMode(v: unknown): v is RealtyMode {
  return typeof v === "string" && (REALTY_MODES as readonly string[]).includes(v);
}

/** Inmobiliaria con agentes: equipo, oficinas y reparto de comisiones. */
export function isAgency(mode: RealtyMode): boolean {
  return mode === "AGENCY";
}

/** Asesor independiente: trabaja solo, sin equipo ni oficinas. */
export function isAgent(mode: RealtyMode): boolean {
  return mode === "AGENT";
}

/** Propietario/rentista: los inmuebles son SUYOS. Sin CRM ni comisiones. */
export function isOwner(mode: RealtyMode): boolean {
  return mode === "OWNER";
}

/** ¿La cuenta comercializa inmuebles de TERCEROS? (AGENCY o AGENT). */
export function sellsThirdPartyProperties(mode: RealtyMode): boolean {
  return mode !== "OWNER";
}

export const REALTY_MODE_UI: Record<
  RealtyMode,
  { label: string; short: string; help: string }
> = {
  AGENCY: {
    label: "Inmobiliaria con agentes",
    short: "Inmobiliaria",
    help: "Tienes un equipo de asesores y vendes o rentas inmuebles de otras personas.",
  },
  AGENT: {
    label: "Asesor independiente",
    short: "Asesor",
    help: "Trabajas por tu cuenta y comercializas inmuebles de otras personas.",
  },
  OWNER: {
    label: "Tengo propiedades en renta",
    short: "Propietario",
    help: "Los inmuebles son tuyos y quieres administrarlos: contratos, cobranza y mantenimiento.",
  },
};

// ── Terminología del producto. La UI se escribe con estas palabras. ──
export const REALTY_TERMS = {
  prospect: "prospecto",
  tenant: "inquilino",
  landlord: "propietario",
  agent: "asesor",
  property: "inmueble",
  bedroom: "recámara",
  parking: "cochera",
  propertyTax: "predial",
  deedProcess: "escrituración",
} as const;
export type RealtyTermKey = keyof typeof REALTY_TERMS;

// ── Rutas base ──────────────────────────────────────────────────────────
/** Base del panel interno. */
export const REALTY_PANEL_BASE = "/inmobiliaria" as const;
/**
 * Base pública de las webs de cada cuenta (/i/[slug]). Verificada libre en
 * la Ola 0: no existe src/app/i y una ruta estática SIEMPRE gana al
 * catch-all /[slug] de especialidades dentales.
 *
 * Sin dominio propio del cliente: el vertical vive en subdirectorio.
 */
export const REALTY_PUBLIC_BASE = "/i" as const;
/** Landing pública del vertical. Ruta RESERVADA (no construida en la Ola 0). */
export const REALTY_LANDING_BASE = "/inmobiliarias" as const;

/** Bucket de Supabase Storage del vertical (fotos, tours, documentos). */
export const REALTY_FILES_BUCKET = "realty-files" as const;

// ── Máquina de estados del PROSPECTO (el corazón del CRM) ───────────────
// Flujo canónico lineal NUEVO → CONTACTADO → CALIFICADO → VISITA → OFERTA
// → CIERRE. PERDIDO se permite desde cualquier estado NO terminal (y pide
// lostReason). CIERRE y PERDIDO son terminales.
//
// Se puede RETROCEDER una etapa a propósito: en bienes raíces un prospecto
// que ya visitó y se enfría vuelve a CONTACTADO en vez de perderse. Lo que
// NO se puede es saltar hacia adelante (un lead no pasa de NUEVO a OFERTA
// sin haber sido calificado: eso ensucia todo el embudo de reportes).
export const REALTY_LEAD_FLOW: RealtyLeadStage[] = [
  "NUEVO",
  "CONTACTADO",
  "CALIFICADO",
  "VISITA",
  "OFERTA",
  "CIERRE",
];

export const REALTY_LEAD_STAGE_FLOW: Record<RealtyLeadStage, RealtyLeadStage[]> = (() => {
  const map: Record<RealtyLeadStage, RealtyLeadStage[]> = {
    NUEVO: [],
    CONTACTADO: [],
    CALIFICADO: [],
    VISITA: [],
    OFERTA: [],
    CIERRE: [],
    PERDIDO: [],
  };
  for (let i = 0; i < REALTY_LEAD_FLOW.length; i++) {
    const from = REALTY_LEAD_FLOW[i];
    const next = REALTY_LEAD_FLOW[i + 1];
    const prev = REALTY_LEAD_FLOW[i - 1];
    const out: RealtyLeadStage[] = [];
    if (next) out.push(next);
    if (prev) out.push(prev); // retroceso de UNA etapa (el lead se enfrió)
    map[from] = out;
  }
  // PERDIDO: alcanzable desde cualquier etapa que no sea terminal.
  for (const stage of REALTY_LEAD_FLOW) {
    if (stage !== "CIERRE") map[stage] = [...map[stage], "PERDIDO"];
  }
  // Terminales sin salidas.
  map.CIERRE = [];
  map.PERDIDO = [];
  return map;
})();

/** ¿Es válida la transición `from` → `to` según el embudo canónico? */
export function canTransition(from: RealtyLeadStage, to: RealtyLeadStage): boolean {
  return REALTY_LEAD_STAGE_FLOW[from]?.includes(to) ?? false;
}

/** Etapas alcanzables desde `from` (incluye el retroceso y PERDIDO). */
export function nextStages(from: RealtyLeadStage): RealtyLeadStage[] {
  return [...(REALTY_LEAD_STAGE_FLOW[from] ?? [])];
}

export function isTerminalLeadStage(stage: RealtyLeadStage): boolean {
  return stage === "CIERRE" || stage === "PERDIDO";
}

/** Posición de la etapa en el embudo (para barras de progreso). -1 = PERDIDO. */
export function leadStageIndex(stage: RealtyLeadStage): number {
  return REALTY_LEAD_FLOW.indexOf(stage);
}

// ── Labels es-MX + tono semántico (para badges/botones de la UI). ───────
export const REALTY_LEAD_STAGE_UI: Record<
  RealtyLeadStage,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "danger" | "neutral" }
> = {
  NUEVO: { label: "Nuevo", tone: "info" },
  CONTACTADO: { label: "Contactado", tone: "neutral" },
  CALIFICADO: { label: "Calificado", tone: "brand" },
  VISITA: { label: "Visita agendada", tone: "brand" },
  OFERTA: { label: "Oferta", tone: "warning" },
  CIERRE: { label: "Cerrado", tone: "success" },
  PERDIDO: { label: "Perdido", tone: "danger" },
};

/** Etiqueta de acción del botón que LLEVA a cada etapa. */
export const REALTY_LEAD_STAGE_ACTION_LABELS: Record<RealtyLeadStage, string> = {
  NUEVO: "Regresar a nuevo",
  CONTACTADO: "Marcar contactado",
  CALIFICADO: "Calificar prospecto",
  VISITA: "Agendar visita",
  OFERTA: "Registrar oferta",
  CIERRE: "Cerrar operación",
  PERDIDO: "Marcar perdido",
};

/** Motivos de pérdida sugeridos (String en BD; la ola de CRM los usa). */
export const REALTY_LOST_REASONS = [
  "PRECIO",
  "CREDITO_RECHAZADO",
  "ELIGIO_OTRO",
  "SIN_RESPUESTA",
  "FUERA_DE_ZONA",
  "SOLO_CURIOSEABA",
  "OTRO",
] as const;
export type RealtyLostReason = (typeof REALTY_LOST_REASONS)[number];
export const REALTY_LOST_REASON_LABELS: Record<RealtyLostReason, string> = {
  PRECIO: "El precio no le funcionó",
  CREDITO_RECHAZADO: "Le rechazaron el crédito",
  ELIGIO_OTRO: "Se fue con otro inmueble",
  SIN_RESPUESTA: "Dejó de contestar",
  FUERA_DE_ZONA: "Buscaba otra zona",
  SOLO_CURIOSEABA: "Solo andaba viendo",
  OTRO: "Otro motivo",
};

export const REALTY_PROPERTY_KIND_LABELS: Record<RealtyPropertyKind, string> = {
  CASA: "Casa",
  DEPARTAMENTO: "Departamento",
  TERRENO: "Terreno",
  BODEGA: "Bodega",
  LOCAL: "Local comercial",
  EDIFICIO: "Edificio",
  OFICINA: "Oficina",
  RANCHO: "Rancho",
};

export const REALTY_OPERATION_LABELS: Record<RealtyOperation, string> = {
  VENTA: "En venta",
  RENTA: "En renta",
  AMBAS: "Venta o renta",
};

export const REALTY_PROPERTY_STATUS_UI: Record<
  RealtyPropertyStatus,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "danger" | "neutral" }
> = {
  DISPONIBLE: { label: "Disponible", tone: "success" },
  APARTADO: { label: "Apartado", tone: "warning" },
  VENDIDO: { label: "Vendido", tone: "neutral" },
  RENTADO: { label: "Rentado", tone: "brand" },
};

export const REALTY_ROLE_LABELS: Record<RealtyRole, string> = {
  OWNER: "Dueño de la cuenta",
  MANAGER: "Gerente",
  AGENT: "Asesor",
  ASSISTANT: "Asistente",
};

export const REALTY_CONTACT_KIND_LABELS: Record<RealtyContactKind, string> = {
  PROSPECTO: "Prospecto",
  PROPIETARIO: "Propietario",
  INQUILINO: "Inquilino",
};

export const REALTY_CREDIT_KIND_LABELS: Record<RealtyCreditKind, string> = {
  INFONAVIT: "Infonavit",
  FOVISSSTE: "Fovissste",
  BANCARIO: "Crédito bancario",
  CONTADO: "De contado",
  NINGUNO: "Todavía no lo define",
};

export const REALTY_TOUR_KIND_LABELS: Record<RealtyTourKind, string> = {
  TOUR_3D: "Recorrido 3D",
  TOUR_360: "Recorrido 360°",
  PANO_PROPIA: "Panorámica propia",
  VIDEO: "Video",
};

export const REALTY_DOCUMENT_KIND_LABELS: Record<RealtyDocumentKind, string> = {
  ESCRITURA: "Escritura",
  PREDIAL: "Predial",
  REGIMEN: "Régimen de condominio",
  IDENTIFICACION: "Identificación",
  OTRO: "Otro documento",
};

export const REALTY_VISIT_STATUS_UI: Record<
  RealtyVisitStatus,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "danger" | "neutral" }
> = {
  PROGRAMADA: { label: "Programada", tone: "info" },
  CONFIRMADA: { label: "Confirmada", tone: "brand" },
  REALIZADA: { label: "Realizada", tone: "success" },
  CANCELADA: { label: "Cancelada", tone: "neutral" },
  NO_ASISTIO: { label: "No llegó", tone: "danger" },
};

export const REALTY_LEASE_STATUS_UI: Record<
  RealtyLeaseStatus,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "danger" | "neutral" }
> = {
  BORRADOR: { label: "Borrador", tone: "neutral" },
  ACTIVO: { label: "Activo", tone: "success" },
  VENCIDO: { label: "Vencido", tone: "warning" },
  TERMINADO: { label: "Terminado", tone: "neutral" },
};

export const REALTY_LEASE_PARTY_ROLE_LABELS: Record<RealtyLeasePartyRole, string> = {
  INQUILINO: "Inquilino",
  AVAL: "Aval",
  FIADOR: "Fiador",
};

export const REALTY_SCREENING_STATUS_LABELS: Record<RealtyScreeningStatus, string> = {
  PENDIENTE: "Investigación pendiente",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
};

export const REALTY_INCREASE_RULE_LABELS: Record<RealtyIncreaseRule, string> = {
  INPC: "Según la inflación (INPC)",
  FIJO: "Porcentaje fijo",
  NINGUNO: "Sin incremento",
};

export const REALTY_CHARGE_STATUS_UI: Record<
  RealtyChargeStatus,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "danger" | "neutral" }
> = {
  PENDIENTE: { label: "Pendiente", tone: "info" },
  PARCIAL: { label: "Pago parcial", tone: "warning" },
  PAGADO: { label: "Pagado", tone: "success" },
  VENCIDO: { label: "Vencido", tone: "danger" },
};

export const REALTY_PAYMENT_METHOD_LABELS: Record<RealtyPaymentMethod, string> = {
  EFECTIVO: "Efectivo",
  SPEI: "Transferencia (SPEI)",
  TARJETA: "Tarjeta",
  OTRO: "Otro",
};

export const REALTY_DEPOSIT_STATUS_LABELS: Record<RealtyDepositStatus, string> = {
  RETENIDO: "Depósito retenido",
  DEVUELTO: "Depósito devuelto",
  APLICADO: "Depósito aplicado",
};

export const REALTY_MAINTENANCE_STATUS_UI: Record<
  RealtyMaintenanceStatus,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "danger" | "neutral" }
> = {
  ABIERTO: { label: "Abierto", tone: "warning" },
  EN_PROCESO: { label: "En proceso", tone: "brand" },
  RESUELTO: { label: "Resuelto", tone: "success" },
};

export const REALTY_EXPENSE_KIND_LABELS: Record<RealtyExpenseKind, string> = {
  PREDIAL: "Predial",
  AGUA: "Agua",
  MANTENIMIENTO: "Mantenimiento",
  REPARACION: "Reparación",
  OTRO: "Otro gasto",
};

export const REALTY_INVENTORY_CHECK_KIND_LABELS: Record<RealtyInventoryCheckKind, string> = {
  ENTRADA: "Inventario de entrada",
  SALIDA: "Inventario de salida",
};

export const REALTY_DEAL_KIND_LABELS: Record<RealtyDealKind, string> = {
  VENTA: "Venta",
  RENTA: "Renta",
};

export const REALTY_DEAL_STATUS_UI: Record<
  RealtyDealStatus,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "danger" | "neutral" }
> = {
  EN_PROCESO: { label: "En proceso", tone: "warning" },
  CERRADO: { label: "Cerrado", tone: "success" },
  CANCELADO: { label: "Cancelado", tone: "neutral" },
};

/** Quién cobra cada parte de la comisión de una operación. */
export const REALTY_COMMISSION_PARTY_LABELS: Record<RealtyCommissionParty, string> = {
  CAPTADOR: "Quien captó el inmueble",
  COLOCADOR: "Quien trajo al comprador",
  OFICINA: "La oficina",
  FRANQUICIA: "La franquicia",
  EXTERNO: "Asesor externo",
};

export const REALTY_PORTAL_LISTING_STATUS_UI: Record<
  RealtyPortalListingStatus,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "danger" | "neutral" }
> = {
  BORRADOR: { label: "Sin publicar", tone: "neutral" },
  PUBLICADO: { label: "Publicado", tone: "success" },
  PAUSADO: { label: "Pausado", tone: "warning" },
  ERROR: { label: "Con error", tone: "danger" },
};

export const REALTY_MESSAGE_STATUS_LABELS: Record<RealtyMessageStatus, string> = {
  PENDING: "Pendiente",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  READ: "Leído",
  FAILED: "Falló",
};

export const REALTY_TICKET_STATUS_UI: Record<
  RealtyTicketStatus,
  { label: string; tone: "info" | "brand" | "warning" | "success" | "danger" | "neutral" }
> = {
  OPEN: { label: "Abierto", tone: "info" },
  IN_PROGRESS: { label: "En curso", tone: "brand" },
  WAITING_REPLY: { label: "Esperando respuesta", tone: "warning" },
  CLOSED: { label: "Cerrado", tone: "neutral" },
};

export const REALTY_TICKET_PRIORITY_LABELS: Record<RealtyTicketPriority, string> = {
  LOW: "Baja",
  NORMAL: "Normal",
  HIGH: "Alta",
};

/** Catálogo canónico de categorías de ticket (String en BD, como el dental). */
export const REALTY_TICKET_CATEGORIES = ["BUG", "DUDA", "COBRO", "SUGERENCIA"] as const;
export type RealtyTicketCategory = (typeof REALTY_TICKET_CATEGORIES)[number];
export const REALTY_TICKET_CATEGORY_LABELS: Record<RealtyTicketCategory, string> = {
  BUG: "Algo falla",
  DUDA: "Tengo una duda",
  COBRO: "Mi suscripción y el cobro",
  SUGERENCIA: "Sugerencia",
};

export const REALTY_CALC_PARAM_KIND_LABELS: Record<RealtyCalcParamKind, string> = {
  ISAI: "ISAI (impuesto de adquisición)",
  UMA: "UMA",
  UDI: "UDI",
  INPC: "INPC (inflación)",
  INFONAVIT: "Infonavit",
  FOVISSSTE: "Fovissste",
};

// ── Amenidades: catálogo semilla del Json `amenities` de RealtyProperty ──
// Es una LISTA SUGERIDA, no una reja: la ola de inmuebles puede agregar
// llaves libres. Los nombres son de México (recámara, cochera, alberca).
export const REALTY_AMENITIES = [
  { key: "alberca", label: "Alberca" },
  { key: "jardin", label: "Jardín" },
  { key: "roofGarden", label: "Roof garden" },
  { key: "elevador", label: "Elevador" },
  { key: "seguridad", label: "Vigilancia 24 h" },
  { key: "privada", label: "Fraccionamiento privado" },
  { key: "amueblado", label: "Amueblado" },
  { key: "cocinaIntegral", label: "Cocina integral" },
  { key: "cuartoServicio", label: "Cuarto de servicio" },
  { key: "closets", label: "Clósets" },
  { key: "aireAcondicionado", label: "Aire acondicionado" },
  { key: "calentadorSolar", label: "Calentador solar" },
  { key: "cisterna", label: "Cisterna" },
  { key: "areaLavado", label: "Área de lavado" },
  { key: "salonEventos", label: "Salón de eventos" },
  { key: "gimnasio", label: "Gimnasio" },
  { key: "areaJuegos", label: "Área de juegos" },
  { key: "aceptaMascotas", label: "Acepta mascotas" },
] as const;
export type RealtyAmenityKey = (typeof REALTY_AMENITIES)[number]["key"];
export const REALTY_AMENITY_KEYS: string[] = REALTY_AMENITIES.map((a) => a.key);
export function realtyAmenityLabel(key: string): string {
  return REALTY_AMENITIES.find((a) => a.key === key)?.label ?? key;
}

// ── Slug ────────────────────────────────────────────────────────────────
/** Slug URL-safe a partir del nombre de la cuenta (para /i/[slug]). */
export function makeRealtySlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    // Rango de marcas diacríticas ESCAPADO a propósito: barber lo tiene con
    // los caracteres crudos dentro de la clase y cualquier editor que
    // normalice el archivo lo puede mutilar sin que nadie lo note.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40)
    .replace(/-+$/g, ""); // el slice puede dejar un guion colgando
  return base || "inmobiliaria";
}

/** Folio corto que el asesor dicta por teléfono ("INM-7K3Q"). Único por cuenta. */
const FOLIO_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I,O,0,1 (se confunden)
export function makeRealtyFolio(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += FOLIO_ALPHABET[Math.floor(random() * FOLIO_ALPHABET.length)];
  }
  return `INM-${out}`;
}

// ── Navegación del panel (la consume el layout + RealtySidebar). ────────
// label se resuelve vía i18n: realty.shell.nav.<key> (src/i18n/dictionaries/realty).
// featureKey gatea por PLAN (realty_plan_configs.features); permission por
// ROL (src/lib/realty/permissions.ts); `modes` por MODO de la cuenta.
// Los tres son AND: si falla cualquiera, el item no se pinta.
//
// 🔴 `modes` es lo que evita los ifs regados por diez pantallas. El sidebar
// de un OWNER (rentista) no enseña Prospectos ni Comisiones porque no vende
// para nadie; el de un AGENT no enseña Equipo porque trabaja solo. Eso sale
// de AQUÍ, de un solo lugar, y las pantallas no vuelven a decidirlo.
// icon = nombre lucide que RealtySidebar sabe mapear.
export interface RealtyNavItemDef {
  key: string;
  href: string;
  icon: string;
  section: "operacion" | "arrendamiento" | "negocio" | "crecimiento" | "cuenta";
  permission: string | null;
  featureKey: string | null;
  /** Modos de cuenta que VEN este item. Nunca vacío. */
  modes: RealtyMode[];
}

const ALL_MODES: RealtyMode[] = ["AGENCY", "AGENT", "OWNER"];
/** Comercializa para terceros: tiene embudo de prospectos y comisiones. */
const BROKER_MODES: RealtyMode[] = ["AGENCY", "AGENT"];

export const REALTY_NAV_ITEMS: RealtyNavItemDef[] = [
  { key: "inicio", href: "/inmobiliaria/inicio", icon: "home", section: "operacion", permission: null, featureKey: null, modes: ALL_MODES },
  { key: "inmuebles", href: "/inmobiliaria/inmuebles", icon: "building", section: "operacion", permission: "properties.view", featureKey: "properties", modes: ALL_MODES },
  // Prospectos y Visitas: el embudo de quien COMERCIALIZA. Un rentista
  // administra lo suyo y no lleva un CRM de compradores; sus interesados
  // entran directo como contrato (Rentas) o como visita del inmueble.
  { key: "prospectos", href: "/inmobiliaria/prospectos", icon: "users", section: "operacion", permission: "leads.view", featureKey: "leads", modes: BROKER_MODES },
  { key: "visitas", href: "/inmobiliaria/visitas", icon: "calendar-check", section: "operacion", permission: "visits.manage", featureKey: null, modes: BROKER_MODES },
  { key: "rentas", href: "/inmobiliaria/rentas", icon: "file-text", section: "arrendamiento", permission: "leases.manage", featureKey: "rentals", modes: ALL_MODES },
  { key: "cobranza", href: "/inmobiliaria/cobranza", icon: "wallet", section: "arrendamiento", permission: "payments.manage", featureKey: "rentals", modes: ALL_MODES },
  // Propietarios: la libreta de DUEÑOS de los inmuebles en cartera. En modo
  // OWNER el dueño es la propia cuenta, así que la pantalla no aplica.
  { key: "propietarios", href: "/inmobiliaria/propietarios", icon: "contact", section: "negocio", permission: "owners.manage", featureKey: null, modes: BROKER_MODES },
  { key: "comisiones", href: "/inmobiliaria/comisiones", icon: "percent", section: "negocio", permission: "commissions.view", featureKey: "commissions", modes: BROKER_MODES },
  // Equipo: usuarios, roles y oficinas. Un asesor independiente está solo.
  { key: "equipo", href: "/inmobiliaria/equipo", icon: "user-plus", section: "negocio", permission: "team.manage", featureKey: null, modes: ["AGENCY"] },
  { key: "reportes", href: "/inmobiliaria/reportes", icon: "chart", section: "negocio", permission: "properties.view", featureKey: null, modes: ALL_MODES },
  { key: "mi-web", href: "/inmobiliaria/mi-web", icon: "globe", section: "crecimiento", permission: "web.edit", featureKey: "publicWeb", modes: ALL_MODES },
  { key: "portales", href: "/inmobiliaria/portales", icon: "share", section: "crecimiento", permission: "portals.manage", featureKey: "portalsFeed", modes: ALL_MODES },
  // WhatsApp NO está en el plan PROPIETARIO ($199) — lo gatea featureKey,
  // no el modo: un rentista con plan ASESOR sí lo tiene y le sirve para
  // hablarle a sus inquilinos.
  { key: "whatsapp", href: "/inmobiliaria/whatsapp", icon: "message-circle", section: "crecimiento", permission: "whatsapp.view", featureKey: "whatsapp", modes: ALL_MODES },
  { key: "calculadoras", href: "/inmobiliaria/calculadoras", icon: "calculator", section: "crecimiento", permission: "calculators.use", featureKey: "calculators", modes: ALL_MODES },
  { key: "suscripcion", href: "/inmobiliaria/suscripcion", icon: "credit-card", section: "cuenta", permission: "billing.manage", featureKey: null, modes: ALL_MODES },
  { key: "configuracion", href: "/inmobiliaria/configuracion", icon: "settings", section: "cuenta", permission: "settings.edit", featureKey: null, modes: ALL_MODES },
  { key: "soporte", href: "/inmobiliaria/soporte", icon: "life-buoy", section: "cuenta", permission: "support.view", featureKey: null, modes: ALL_MODES },
];

/** ¿Este item de menú se ve en este modo de cuenta? */
export function navItemAllowsMode(item: RealtyNavItemDef, mode: RealtyMode): boolean {
  return item.modes.includes(mode);
}

/** Item de navegación YA resuelto (label + visibilidad) que recibe el sidebar. */
export interface RealtyNavItem {
  key: string;
  href: string;
  icon: string;
  section: "operacion" | "arrendamiento" | "negocio" | "crecimiento" | "cuenta";
  label: string;
}

// ── DTOs — shape JSON que devuelven las APIs del vertical. ──────────────
// Fechas como ISO string; Decimals de Prisma como number (Number(x)).
// 🔴 storageUsedBytes es BigInt en Prisma: JSON.stringify REVIENTA con un
// BigInt sin convertir ("Do not know how to serialize a BigInt"). Siempre
// Number(row.storageUsedBytes) al armar el DTO.
export interface RealtyAccountDTO {
  id: string;
  mode: RealtyMode;
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
  plan: RealtyPlanId;
  subscriptionStatus: string;
  storageUsedBytes: number;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseExpiresAt: string | null;
  isActive: boolean;
}

export interface RealtyUserDTO {
  id: string;
  accountId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: RealtyRole;
  publicProfileEnabled: boolean;
  active: boolean;
  lastLogin: string | null;
}

export interface RealtyOfficeDTO {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  isMain: boolean;
  isActive: boolean;
}

export interface RealtyAgentProfileDTO {
  id: string;
  realtyUserId: string;
  displayName: string;
  photoUrl: string | null;
  bio: string | null;
  zones: string[];
  specialties: string[];
  credentials: Record<string, unknown> | null;
  socials: Record<string, unknown> | null;
  publicSlug: string | null;
  active: boolean;
}

export interface RealtyPropertyPhotoDTO {
  id: string;
  sortOrder: number;
  url: string;
  width: number | null;
  height: number | null;
  bytes: number;
  isCover: boolean;
  watermarked: boolean;
}

export interface RealtyPropertyTourDTO {
  id: string;
  kind: RealtyTourKind;
  /** Proveedor detectado (ver REALTY_TOUR_PROVIDERS en @/lib/realty/tours). */
  provider: string;
  externalUrl: string | null;
  fileUrl: string | null;
  bytes: number;
  sortOrder: number;
}

export interface RealtyPropertyDocumentDTO {
  id: string;
  kind: RealtyDocumentKind;
  name: string;
  url: string;
  bytes: number;
  createdAt: string;
}

export interface RealtyPropertyDTO {
  id: string;
  accountId: string;
  officeId: string | null;
  /** NULLABLE A PROPÓSITO: un inmueble puede estar en cartera sin asesor. */
  assignedUserId: string | null;
  assignedUserName: string | null;
  /** El dueño. En modo OWNER la cuenta es su propio dueño y viene null. */
  ownerId: string | null;
  ownerName: string | null;
  kind: RealtyPropertyKind;
  operation: RealtyOperation;
  status: RealtyPropertyStatus;
  price: number;
  currency: RealtyCurrency;
  rentPrice: number | null;
  maintenanceFee: number | null;
  landM2: number | null;
  builtM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  halfBathrooms: number | null;
  parking: number | null;
  ageYears: number | null;
  amenities: Record<string, unknown> | null;
  address: string | null;
  colonia: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  /** false = la web pública enseña SOLO colonia y ciudad (privacidad). */
  showExactAddress: boolean;
  title: string;
  description: string | null;
  /** NUNCA sale a la web pública. Solo panel. */
  internalNotes: string | null;
  commissionPct: number | null;
  /** Independiente del estatus comercial: despublicar no es "vendido". */
  isPublished: boolean;
  publicUrlSlug: string | null;
  shortTermFolio: string | null;
  createdAt: string;
  photos: RealtyPropertyPhotoDTO[];
  tours: RealtyPropertyTourDTO[];
}

export interface RealtyPropertyOwnerDTO {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  rfc: string | null;
  notes: string | null;
  createdAt: string;
}

export interface RealtyExclusiveDTO {
  id: string;
  propertyId: string;
  ownerId: string;
  startsAt: string;
  endsAt: string;
  commissionPct: number;
  signedDocUrl: string | null;
}

export interface RealtyContactDTO {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  kind: RealtyContactKind;
  source: string | null;
  assignedUserId: string | null;
  createdAt: string;
}

export interface RealtyLeadDTO {
  id: string;
  accountId: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  propertyId: string | null;
  propertyTitle: string | null;
  portal: string | null;
  stage: RealtyLeadStage;
  lostReason: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  creditKind: RealtyCreditKind;
  /** El reloj del negocio: cuánto tardó alguien en contestarle. */
  firstResponseAt: string | null;
  assignedAt: string | null;
  assignedUserId: string | null;
  createdAt: string;
}

export interface RealtyLeadActivityDTO {
  id: string;
  leadId: string;
  kind: RealtyLeadActivityKind;
  note: string | null;
  userId: string | null;
  createdAt: string;
}

/** Lo que BUSCA un contacto. Alimenta el MATCH AUTOMÁTICO con la cartera. */
export interface RealtySearchProfileDTO {
  id: string;
  contactId: string;
  kinds: Record<string, unknown> | null;
  operation: RealtyOperation;
  zones: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  bedroomsMin: number | null;
  notifyByWhatsapp: boolean;
}

export interface RealtyTaskDTO {
  id: string;
  userId: string;
  leadId: string | null;
  propertyId: string | null;
  dueAt: string;
  done: boolean;
  title: string;
  createdAt: string;
}

export interface RealtyVisitDTO {
  id: string;
  propertyId: string;
  propertyTitle: string | null;
  leadId: string | null;
  userId: string | null;
  scheduledAt: string;
  status: RealtyVisitStatus;
  feedback: string | null;
}

/** Quién tiene las llaves AHORA. returnedAt null = siguen fuera. */
export interface RealtyKeyDTO {
  id: string;
  propertyId: string;
  holderUserId: string | null;
  holderNote: string | null;
  takenAt: string;
  returnedAt: string | null;
}

export interface RealtyLeaseDTO {
  id: string;
  accountId: string;
  propertyId: string;
  propertyTitle: string | null;
  startsAt: string;
  endsAt: string;
  rentAmount: number;
  currency: RealtyCurrency;
  /** Día del mes en que toca pagar (1-31). */
  paymentDay: number;
  depositAmount: number;
  increaseRule: RealtyIncreaseRule;
  increasePct: number | null;
  status: RealtyLeaseStatus;
  signedDocUrl: string | null;
  createdAt: string;
}

export interface RealtyLeasePartyDTO {
  id: string;
  leaseId: string;
  role: RealtyLeasePartyRole;
  contactId: string;
  contactName: string;
  screeningStatus: RealtyScreeningStatus | null;
}

export interface RealtyRentChargeDTO {
  id: string;
  leaseId: string;
  /** "YYYY-MM" del periodo que cubre el cargo. */
  periodMonth: string;
  dueAt: string;
  amount: number;
  status: RealtyChargeStatus;
}

/**
 * Un pago recibido. 🔴 receiptUrl es un RECIBO, no una factura: este
 * vertical NO timbra CFDI ni menciona facturación en ninguna pantalla.
 */
export interface RealtyPaymentDTO {
  id: string;
  chargeId: string | null;
  leaseId: string | null;
  dealId: string | null;
  amount: number;
  method: RealtyPaymentMethod;
  paidAt: string;
  reference: string | null;
  receiptUrl: string | null;
  createdAt: string;
}

export interface RealtyDepositDTO {
  id: string;
  leaseId: string;
  amount: number;
  status: RealtyDepositStatus;
  resolvedAt: string | null;
  note: string | null;
}

export interface RealtyMaintenanceDTO {
  id: string;
  propertyId: string;
  leaseId: string | null;
  reportedBy: string | null;
  description: string;
  photoUrls: string[];
  status: RealtyMaintenanceStatus;
  vendorName: string | null;
  cost: number | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface RealtyExpenseDTO {
  id: string;
  propertyId: string;
  kind: RealtyExpenseKind;
  amount: number;
  paidAt: string;
  note: string | null;
  receiptUrl: string | null;
}

export interface RealtyInventoryItemDTO {
  id: string;
  checkId: string;
  room: string;
  item: string;
  condition: string;
  photoUrls: string[];
}

export interface RealtyInventoryCheckDTO {
  id: string;
  leaseId: string;
  kind: RealtyInventoryCheckKind;
  performedAt: string;
  signedBy: string | null;
  notes: string | null;
  items: RealtyInventoryItemDTO[];
}

export interface RealtyCommissionSplitDTO {
  id: string;
  dealId: string;
  /** null = la parte es de la oficina, la franquicia o alguien EXTERNO. */
  realtyUserId: string | null;
  realtyUserName: string | null;
  /**
   * Nombre de la contraparte cuando no hay realtyUserId. Sin esto la pantalla
   * de comisiones pinta una fila anónima con un monto.
   */
  externalName: string | null;
  party: RealtyCommissionParty;
  pct: number;
  amount: number;
  paidAt: string | null;
}

export interface RealtyDealDTO {
  id: string;
  accountId: string;
  propertyId: string;
  propertyTitle: string | null;
  kind: RealtyDealKind;
  contactId: string | null;
  contactName: string | null;
  closedAt: string | null;
  amount: number;
  commissionAmount: number;
  status: RealtyDealStatus;
  createdAt: string;
  splits: RealtyCommissionSplitDTO[];
}

export interface RealtyLandingConfigDTO {
  id: string;
  template: string;
  data: Record<string, unknown>;
  published: boolean;
  /** Bloqueo optimista: se manda de vuelta al guardar; si no coincide → 409. */
  version: number;
  updatedAt: string;
}

export interface RealtyPortalAccountDTO {
  id: string;
  portal: string;
  externalAccountId: string | null;
  /** apiKey NUNCA sale al navegador: el DTO solo dice si está configurada. */
  hasApiKey: boolean;
  maxListings: number;
  active: boolean;
}

export interface RealtyPortalListingDTO {
  id: string;
  propertyId: string;
  portal: string;
  externalId: string | null;
  status: RealtyPortalListingStatus;
  lastPushedAt: string | null;
  lastError: string | null;
}

export interface RealtyThreadDTO {
  id: string;
  contactId: string | null;
  contactName: string | null;
  phone: string;
  lastMessageAt: string;
  unread: number;
  archived: boolean;
}

export interface RealtyMessageDTO {
  id: string;
  threadId: string;
  direction: RealtyMessageDirection;
  body: string | null;
  mediaUrl: string | null;
  templateName: string | null;
  externalId: string | null;
  status: RealtyMessageStatus;
  /** Número de Meta. El texto lo cambian; el número no. */
  errorCode: number | null;
  errorTitle: string | null;
  createdAt: string;
}

/** Adjunto de soporte: archivo en REALTY_FILES_BUCKET. */
export interface RealtySupportAttachment {
  path: string;
  name: string;
  size: number;
  type: string;
}

export interface RealtySupportTicketDTO {
  id: string;
  subject: string;
  /** Ver REALTY_TICKET_CATEGORIES (String en BD, como el dental). */
  category: string;
  status: RealtyTicketStatus;
  priority: RealtyTicketPriority;
  lastMessageAt: string;
  closedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface RealtySupportMessageDTO {
  id: string;
  ticketId: string;
  authorType: RealtyTicketAuthor;
  /** AGENCY → realty_users.id; ADMIN → id del admin DaleControl (sin FK). */
  authorUserId: string | null;
  body: string;
  attachments: RealtySupportAttachment[];
  createdAt: string;
}

/**
 * Parámetro de una calculadora mexicana. CAMBIAN CADA AÑO (el ISAI es
 * estatal y la UMA se publica en enero): por eso viven en tabla editable
 * y JAMÁS quemados en el código. effectiveFrom permite tener el valor
 * viejo y el nuevo conviviendo y elegir por fecha de la operación.
 */
export interface RealtyCalcParamDTO {
  id: string;
  kind: RealtyCalcParamKind;
  /**
   * Clave del estado ("JAL", "CMX"). "MX" = federal. La columna es NOT NULL
   * con default "MX", así que NUNCA llega null: una comparación contra null
   * no se ejecutaría jamás y trataría los parámetros federales como los de
   * un estado inventado.
   */
  stateCode: string;
  year: number;
  value: number;
  meta: Record<string, unknown> | null;
  effectiveFrom: string;
}
