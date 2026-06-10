// ─────────────────────────────────────────────────────────────────────────────
// DIRECTORIO PÚBLICO DE CLÍNICAS (/descubre) — CONTRATO ÚNICO.
// Única fuente de verdad para:
//   1. Las 17 categorías visibles del directorio (espejo del enum ClinicCategory
//      de prisma/schema.prisma — el schema NO se toca; OTHER queda fuera del grid
//      pero sus clínicas sí aparecen en el listado general y la búsqueda).
//   2. Los shapes de la API pública GET /api/directory/clinics.
//   3. El estado de reserva del popup y sus llaves de URL/sessionStorage.
//   4. Los contratos EXTERNOS que el popup REUTILIZA (ya existen en main):
//      · GET  /api/public/availability?slug=&date=YYYY-MM-DD&doctorId=
//        → sin date: { clinic, doctors, schedules }
//        → con date: { clinic, doctors, slots: string[], allSlots, bookedSlots }
//          o { slots: [], reason: string }. Slots de 30 min "HH:MM".
//      · POST /api/public/book
//        body { slug, doctorId, date, startTime, type, firstName, lastName,
//               phone, email?, notes? }
//        → 200 { success, appointmentId, patientId, message }
//        → 400/404/409/429/500 { error }. Rate limit 10/min/IP.
//        Teléfono: mínimo 10 dígitos tras limpiar [\s\-\(\)\+].
//      · AUTH DE PACIENTES (la construye OTRA terminal — aquí NO se implementa,
//        solo se consume el contrato): sesión = cookie patient_session;
//        GET /api/paciente/me → 200 { id, name, email, phone } | 401.
//        Si 401 al confirmar → redirigir a /paciente/registro?next=<url actual
//        con la selección en el querystring> y al volver se reabre el popup.
// Importable desde server y client: sin "use client" y sin dependencias.
// ─────────────────────────────────────────────────────────────────────────────

/** Valores del enum ClinicCategory de Prisma (prisma/schema.prisma). */
export type ClinicCategoryValue =
  | "DENTAL" | "MEDICINE" | "NUTRITION" | "PSYCHOLOGY" | "DERMATOLOGY"
  | "AESTHETIC_MEDICINE" | "HAIR_RESTORATION" | "BEAUTY_CENTER" | "BROW_LASH"
  | "MASSAGE" | "LASER_HAIR_REMOVAL" | "HAIR_SALON" | "ALTERNATIVE_MEDICINE"
  | "NAIL_SALON" | "SPA" | "PHYSIOTHERAPY" | "PODIATRY" | "OTHER";

export interface DirectoryCategory {
  /** Slug de URL: /descubre/[slug] */
  slug: string;
  /** Valor exacto del enum ClinicCategory en Prisma */
  category: ClinicCategoryValue;
  /** Label corto para chips/cards */
  label: string;
  /** Plural natural para copy/SEO ("clínicas dentales") */
  plural: string;
  /** Descripción corta para hero de categoría y meta description */
  description: string;
  /** Nombre del icono de lucide-react (mapeado en CategoryGrid) */
  icon: string;
}

/** Las 17 categorías visibles del directorio (OTHER se excluye a propósito). */
export const DIRECTORY_CATEGORIES: DirectoryCategory[] = [
  { slug: "dental",               category: "DENTAL",               label: "Dental",               plural: "clínicas dentales",                icon: "Smile",       description: "Limpiezas, ortodoncia, implantes y más. Encuentra tu clínica dental y agenda en línea." },
  { slug: "medicina",             category: "MEDICINE",             label: "Medicina general",     plural: "consultorios médicos",             icon: "Stethoscope", description: "Consulta general y especialidades médicas con doctores verificados cerca de ti." },
  { slug: "nutricion",            category: "NUTRITION",            label: "Nutrición",            plural: "consultorios de nutrición",        icon: "Apple",       description: "Planes alimenticios y seguimiento profesional con nutriólogos certificados." },
  { slug: "psicologia",           category: "PSYCHOLOGY",           label: "Psicología",           plural: "consultorios de psicología",       icon: "Brain",       description: "Terapia individual, de pareja y más. Agenda con psicólogos de confianza." },
  { slug: "dermatologia",         category: "DERMATOLOGY",          label: "Dermatología",         plural: "clínicas de dermatología",         icon: "ScanFace",    description: "Cuidado de la piel, tratamientos y procedimientos dermatológicos profesionales." },
  { slug: "medicina-estetica",    category: "AESTHETIC_MEDICINE",   label: "Medicina estética",    plural: "clínicas de medicina estética",    icon: "Syringe",     description: "Tratamientos estéticos con seguimiento médico: toxina, rellenos y más." },
  { slug: "injerto-capilar",      category: "HAIR_RESTORATION",     label: "Injerto capilar",      plural: "clínicas de injerto capilar",      icon: "Sprout",      description: "Restauración capilar con evaluación profesional y seguimiento de resultados." },
  { slug: "centro-de-belleza",    category: "BEAUTY_CENTER",        label: "Centro de belleza",    plural: "centros de belleza",               icon: "Sparkles",    description: "Tratamientos faciales y corporales en centros de belleza verificados." },
  { slug: "cejas-y-pestanas",     category: "BROW_LASH",            label: "Cejas y pestañas",     plural: "estudios de cejas y pestañas",     icon: "Eye",         description: "Diseño de cejas, extensiones de pestañas y lifting con profesionales." },
  { slug: "masajes",              category: "MASSAGE",              label: "Masajes",              plural: "centros de masaje",                icon: "Waves",       description: "Masaje relajante, descontracturante y terapéutico. Reserva tu sesión." },
  { slug: "depilacion-laser",     category: "LASER_HAIR_REMOVAL",   label: "Depilación láser",     plural: "clínicas de depilación láser",     icon: "Zap",         description: "Depilación láser por zona con paquetes y seguimiento por sesión." },
  { slug: "salon-de-cabello",     category: "HAIR_SALON",           label: "Salón de cabello",     plural: "salones de cabello",               icon: "Scissors",    description: "Corte, color y tratamientos capilares con estilistas profesionales." },
  { slug: "medicina-alternativa", category: "ALTERNATIVE_MEDICINE", label: "Medicina alternativa", plural: "centros de medicina alternativa",  icon: "Leaf",        description: "Acupuntura, homeopatía y terapias complementarias con especialistas." },
  { slug: "salon-de-unas",        category: "NAIL_SALON",           label: "Salón de uñas",        plural: "salones de uñas",                  icon: "Paintbrush",  description: "Manicure, pedicure y uñas esculpidas en salones con agenda en línea." },
  { slug: "spa",                  category: "SPA",                  label: "Spa",                  plural: "spas",                             icon: "Flower2",     description: "Rituales, faciales y experiencias de relajación. Reserva tu momento." },
  { slug: "fisioterapia",         category: "PHYSIOTHERAPY",        label: "Fisioterapia",         plural: "clínicas de fisioterapia",         icon: "Activity",    description: "Rehabilitación y terapia física con programas de ejercicio personalizados." },
  { slug: "podologia",            category: "PODIATRY",             label: "Podología",            plural: "clínicas de podología",            icon: "Footprints",  description: "Cuidado profesional del pie: evaluación, ortesis y pie diabético." },
];

export function getCategoryBySlug(slug: string): DirectoryCategory | undefined {
  return DIRECTORY_CATEGORIES.find((c) => c.slug === slug);
}

export function getCategoryByEnum(category: string): DirectoryCategory | undefined {
  return DIRECTORY_CATEGORIES.find((c) => c.category === category);
}

/** Label legible para CUALQUIER valor del enum (incluye OTHER). */
export function categoryLabel(category: string): string {
  return getCategoryByEnum(category)?.label ?? "Especialidad";
}

// ── API GET /api/directory/clinics ───────────────────────────────────────────
// Query params: category=<slug es> (opcional) · q=<texto nombre/ciudad> (opcional)
//               page=<n base 1> (opcional, default 1) · slug=<clinicSlug> (lookup
//               puntual para reabrir el popup al volver del registro).
// SOLO datos públicos. Nunca exponer: email interno, tokens, billing, configs.
// city=<slug de ciudad> (opcional; se resuelve contra el texto libre de
//   Clinic.city vía @/lib/directory/cities).

export const DIRECTORY_API = "/api/directory/clinics";
export const DIRECTORY_PAGE_SIZE = 12;

// ── API GET /api/directory/cities ────────────────────────────────────────────
// Query params: category=<slug es> (opcional) — acota las ciudades a esa
// categoría. Devuelve las ciudades REALES derivadas de la DB con su conteo.
export const DIRECTORY_CITIES_API = "/api/directory/cities";

/** Param de ciudad compartido por la API de clínicas y la URL del explorador. */
export const DIRECTORY_CITY_PARAM = "city";

export type { CityOption } from "./cities";
export interface DirectoryCitiesResponse {
  cities: import("./cities").CityOption[];
}

// ── Mapa / "cerca de mí" ─────────────────────────────────────────────────────
// La API acepta además (todos opcionales):
//   lat,lng  — punto del usuario; activan orden por distancia + distanceKm.
//   radius   — km; filtro duro opcional (bounding box + círculo). Sin radius,
//              near-me solo ordena por distancia (no esconde clínicas lejanas).
//   limit    — modo mapa: devuelve hasta DIRECTORY_MAP_MAX en una sola página.

/** Tope de markers que la API devuelve en modo mapa (?limit=). Acota la query a un set plotable. */
export const DIRECTORY_MAP_MAX = 200;

/** Centro por defecto del mapa (CDMX) cuando no hay ubicación del usuario ni clínicas con pin. */
export const MAP_DEFAULT_CENTER = { lat: 19.4326, lng: -99.1332 } as const;

/** Punto geográfico simple (grados decimales). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface DirectoryDoctor {
  id: string;
  firstName: string;
  lastName: string;
  specialty: string | null;
  color: string;
  avatarUrl: string | null;
  /** Nombres de servicios que atiende (User.services en Prisma) */
  services: string[];
}

/** dayOfWeek: 0=Lunes … 6=Domingo (convención del schema, NO la de JS Date). */
export interface DirectorySchedule {
  dayOfWeek: number;
  enabled: boolean;
  openTime: string;  // "09:00"
  closeTime: string; // "18:00"
}

export interface DirectoryClinic {
  id: string;
  name: string;
  slug: string;
  category: ClinicCategoryValue;
  city: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  coverUrl: string | null;      // Clinic.landingCoverUrl
  description: string | null;
  tagline: string | null;       // Clinic.landingTagline
  themeColor: string | null;    // Clinic.landingThemeColor — acento del popup
  landingActive: boolean;       // si false, /[slug] muestra "disponible pronto"
  /** Hasta 6 servicios destacados (User.services ∪ landingServices[].name) */
  featuredServices: string[];
  doctors: DirectoryDoctor[];
  schedules: DirectorySchedule[];
  /** Pin del mapa (grados decimales). null → la clínica no sale en el mapa, solo en lista. */
  latitude: number | null;
  longitude: number | null;
  /** Distancia en km al punto del usuario; presente SOLO en modo "cerca de mí". */
  distanceKm?: number | null;
}

export interface DirectoryClinicsResponse {
  items: DirectoryClinic[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Reserva (popup) ──────────────────────────────────────────────────────────

export interface BookingSelection {
  clinicSlug: string;
  service: string | null;   // se manda como `type` en POST /api/public/book
  doctorId: string | null;
  date: string | null;      // YYYY-MM-DD
  slot: string | null;      // HH:MM
}

/** Llaves del querystring que serializan la selección (para ?next= y compartir). */
export const BOOKING_PARAM_KEYS = {
  clinic: "reservar",
  service: "servicio",
  doctor: "doctor",
  date: "fecha",
  slot: "hora",
} as const;

export const BOOKING_STORAGE_KEY = "dc-directory-booking";
export const BOOKING_OPEN_EVENT = "dc:directory-booking-open";

/** Servicio comodín cuando la clínica no tiene servicios listados. */
export const DEFAULT_SERVICE = "Consulta general";

// ── Contrato de auth de pacientes (lo implementa otra terminal) ──────────────

export interface PatientMe {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export const PATIENT_ME_API = "/api/paciente/me";
export const PATIENT_REGISTER_PATH = "/paciente/registro";

// ── Endpoints públicos de booking REUTILIZADOS (ya existen en main) ──────────

export const PUBLIC_AVAILABILITY_API = "/api/public/availability";
export const PUBLIC_BOOK_API = "/api/public/book";

export interface AvailabilityWithDateResponse {
  clinic?: { id: string; name: string; specialty: string; phone: string | null; address: string | null; city: string | null; logoUrl: string | null };
  doctors?: { id: string; firstName: string; lastName: string; specialty: string | null; color: string }[];
  slots?: string[];       // disponibles "HH:MM"
  allSlots?: string[];
  bookedSlots?: string[];
  reason?: string;        // ej. "La clínica no atiende este día"
  error?: string;
}

export interface BookRequestBody {
  slug: string;
  doctorId: string;
  date: string;       // YYYY-MM-DD
  startTime: string;  // HH:MM
  type: string;       // nombre del servicio / motivo
  firstName: string;
  lastName: string;
  phone: string;      // ≥10 dígitos
  email?: string;
  notes?: string;
}

export interface BookResponse {
  success?: boolean;
  appointmentId?: string;
  patientId?: string;
  message?: string;
  error?: string;
}
