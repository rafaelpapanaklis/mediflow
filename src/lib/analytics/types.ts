// ─────────────────────────────────────────────────────────────────────────────
// DaleControl — Analítica de primera parte (self-hosted).
// CONTRATO CONGELADO compartido cliente ⇄ servidor ⇄ panel admin.
// Todo lo que autoría paralela consume vive aquí. No romper sin actualizar
// tracker (cliente), /api/track (ingesta) y /admin/analytics (lectura).
// ─────────────────────────────────────────────────────────────────────────────

/* ============================ INGESTA (cliente → /api/track) ================= */

export type TrackEventType =
  | "pageview"
  | "click"
  | "scroll"
  | "custom"
  | "rage_click"
  | "ping"; // heartbeat: sólo refresca lastSeenAt; no se persiste como evento

export interface TrackEvent {
  type: TrackEventType;
  /** Pathname sin query (para agrupar). Ej. "/", "/descubre", "/dashboard". */
  path: string;
  /** Timestamp del cliente (ms epoch) — sólo para orden; el server sella con su reloj. */
  t: number;
  title?: string;
  referrer?: string;
  /** Nombre del evento custom. */
  name?: string;
  /** Click: x como fracción del ancho del viewport (0..1). */
  x?: number;
  /** Click: y absoluto en px desde el tope del documento (pageY). */
  y?: number;
  /** Viewport / documento al momento del click (para normalizar el heatmap). */
  vw?: number;
  vh?: number;
  docH?: number;
  /** Profundidad de scroll alcanzada (0..100) para eventos scroll. */
  scrollPct?: number;
  /** Click: selector CSS aproximado del target. */
  selector?: string;
  /** Click: texto del target (truncado, PII-safe: nunca de inputs). */
  text?: string;
  /** Pageview: tiempo en la página previa (ms). */
  durationMs?: number;
  /** Extra libre. */
  meta?: Record<string, unknown>;
}

export interface TrackPayload {
  /** Session id (uuid generado en cliente). */
  sid: string;
  /** Visitor id anónimo persistente (localStorage). */
  vid: string;
  events: TrackEvent[];
  screenW?: number;
  screenH?: number;
  language?: string;
  timezone?: string;
  /** Atribución de entrada (se manda una vez; reenviarlo es inocuo). */
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  gclid?: string;
}

/* ============================ LECTURA (panel admin) ========================== */

export type AnalyticsSurface = "public" | "dashboard" | "portal" | "all";

export interface AnalyticsFilters {
  from: Date;
  to: Date;
  /** "public" | "dashboard" | "portal" | "all" (o cualquier surface persistido). */
  surface: string | null;
  /** Aislar una clínica identificada. */
  clinicId: string | null;
}

export type BucketUnit = "hour" | "day" | "month";

/* --- Overview --- */
export interface OverviewKpis {
  visits: number;
  uniqueVisitors: number;
  pageviews: number;
  bounceRate: number; // %
  avgDurationMs: number;
  pagesPerVisit: number;
  clicks: number;
  newVisitors: number;
  returningVisitors: number;
  identifiedVisits: number;
  liveNow: number;
}
export interface TimeseriesPoint {
  bucket: string; // ISO o "YYYY-MM-DD" / "YYYY-MM-DDTHH" / "YYYY-MM"
  visits: number;
  visitors: number;
  pageviews: number;
}
export interface CountSlice {
  key: string;
  count: number;
}
export interface OverviewResponse {
  kpis: OverviewKpis;
  bucket: BucketUnit;
  timeseries: TimeseriesPoint[];
  devices: CountSlice[];
  browsers: CountSlice[];
  os: CountSlice[];
}

/* --- Fuentes / adquisición --- */
export interface SourceRow {
  key: string;
  visits: number;
  visitors: number;
  bounceRate: number; // %
}
export interface SourcesResponse {
  referrerTypes: SourceRow[];
  referrers: SourceRow[];
  utmSources: SourceRow[];
  utmCampaigns: SourceRow[];
  entryPages: SourceRow[];
}

/* --- Geo --- */
export interface GeoRow {
  country: string | null;
  region?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  visits: number;
  visitors: number;
}
export interface GeoResponse {
  countries: GeoRow[];
  cities: GeoRow[];
  /** Puntos con lat/lng para el mapa. */
  points: GeoRow[];
}

/* --- Páginas --- */
export interface PageRow {
  path: string;
  pageviews: number;
  visitors: number;
  avgDurationMs: number;
  entries: number;
  exits: number;
  bounceRate: number; // %
}
export interface PagesResponse {
  pages: PageRow[];
}

/* --- Heatmap --- */
export interface HeatPoint {
  x: number; // fracción viewport 0..1
  y: number; // px absoluto
  docH: number;
  vw: number;
}
export interface HeatElement {
  selector: string;
  text?: string | null;
  count: number;
}
export interface HeatmapPathOption {
  path: string;
  clicks: number;
}
export interface HeatmapResponse {
  path: string;
  points: HeatPoint[];
  elements: HeatElement[];
  total: number;
  /** Rutas con clicks disponibles (para el selector). */
  paths: HeatmapPathOption[];
}

/* --- Identificados (clínicas / usuarios registrados) --- */
export interface IdentifiedRow {
  clinicId: string | null;
  clinicName: string | null;
  plan: string | null;
  identityType: string; // staff | patient
  visits: number;
  pageviews: number;
  lastSeenAt: string; // ISO
  publicVisits: number;
  dashboardVisits: number;
  distinctUsers: number;
  emails: string[];
}
export interface IdentifiedResponse {
  clinics: IdentifiedRow[];
  totalIdentifiedVisits: number;
  totalIdentifiedClinics: number;
}

/* --- En vivo --- */
export interface LiveVisitor {
  sid: string;
  surface: string;
  identityType: string;
  clinicName: string | null;
  email: string | null;
  path: string;
  country: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  device: string | null;
  browser: string | null;
  referrerType: string | null;
  pageviews: number;
  startedAt: string; // ISO
  lastSeenAt: string; // ISO
}
export interface LiveResponse {
  visitors: LiveVisitor[];
  count: number;
  countByCountry: { country: string; count: number }[];
  windowMinutes: number;
  /** Ventana "activo ahora" en segundos (más preciso que windowMinutes). */
  windowSeconds: number;
}
