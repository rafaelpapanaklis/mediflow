/**
 * Página pública del socio (/socio/<slug>) — CONTRATO ÚNICO.
 *
 * Aquí vive TODO lo que define qué puede personalizar un afiliado: el catálogo
 * de secciones, el tope de la presentación, los estados de moderación y las
 * funciones que deciden qué se publica y qué es borrador.
 *
 * PURO Y SIN PRISMA A PROPÓSITO: lo importan el panel del afiliado (cliente),
 * el admin y la página pública. Si abriera una conexión a la base, el catálogo
 * de secciones no podría vivir también en el navegador y acabaríamos con dos
 * listas que se desincronizan. Lo que sí toca la base vive en page-store.ts.
 *
 * Lo que el afiliado edita son TRES cosas: su foto, una presentación escrita y
 * qué secciones se ven y en qué orden. Ni el hero, ni los colores, ni la
 * tipografía: la estética de dalecontrol.com es la misma para todos.
 */

/* ── Estados de la moderación ─────────────────────────────────────────────
   Texto, no un enum de Postgres (mismo criterio que
   AffiliateSupportTicket.status): los valores válidos son ESTOS y la columna
   solo los guarda. */

export const PAGE_STATUSES = ["draft", "pending", "approved", "rejected"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

/**
 * Cualquier cosa que venga de la base cae en un estado válido. Un valor
 * desconocido —una fila tocada a mano, una migración a medias— se lee como
 * 'draft': el estado que NO publica nada. Ante la duda, no publicar.
 */
export function normalizeStatus(raw: unknown): PageStatus {
  return typeof raw === "string" && (PAGE_STATUSES as readonly string[]).includes(raw)
    ? (raw as PageStatus)
    : "draft";
}

/** Mientras está en revisión el borrador se congela: ni el afiliado lo toca. */
export function canEditPage(status: unknown): boolean {
  return normalizeStatus(status) !== "pending";
}

/* ── La presentación escrita ──────────────────────────────────────────────
   600 caracteres: da para una presentación de verdad (~100 palabras) y sigue
   cabiendo en la página sin empujar el resto del contenido fuera de la
   primera pantalla. El tope vive AQUÍ y no en un varchar(600) porque es una
   regla de producto, y en la columna cambiarla costaría un ALTER. */

export const BIO_MAX_CHARS = 600;

/**
 * Cuenta como cuenta el usuario: por caracteres visibles, no por unidades
 * UTF-16. Sin esto un emoji gastaría dos del cupo y el contador de la pantalla
 * discreparía del tope del servidor justo cuando el afiliado está a punto de
 * enviar a revisión.
 */
export function bioLength(value: string): number {
  return Array.from(value ?? "").length;
}

/**
 * Deja la presentación lista para guardarse. NO es un sanitizador de HTML: el
 * texto se pinta como TEXTO PLANO (React escapa solo), así que si alguien
 * escribe `<b>hola</b>` se lee literalmente `<b>hola</b>` — que es la conducta
 * correcta y, de paso, lo que Rafael ve al moderar.
 *
 * Lo que sí se hace es quitar lo que rompe el renglón: caracteres de control
 * invisibles y párrafos vacíos en cadena. Los saltos de línea SE CONSERVAN
 * (máximo dos seguidos) porque una presentación con dos párrafos se lee mejor
 * que un ladrillo.
 *
 * Devuelve null para el texto vacío: en la base, "sin presentación" es null,
 * no "".
 */
export function sanitizeBio(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const clean = raw
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    // Controles invisibles fuera. El salto de línea sobrevive a propósito:
    // una presentación de dos párrafos se lee mejor que un ladrillo, y el
    // .replace de abajo ya limita cuántos seguidos se permiten.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!clean) return null;

  const chars = Array.from(clean);
  if (chars.length <= BIO_MAX_CHARS) return clean;
  // Se recorta en vez de rechazar: el tope ya se enseña en la pantalla, y
  // devolver un 400 por dos caracteres de más perdería lo que escribió.
  const cut = chars.slice(0, BIO_MAX_CHARS).join("").trim();
  return cut || null;
}

/* ── El catálogo de secciones ─────────────────────────────────────────────
   El ORDEN de este array es el orden por defecto de la página, o sea cómo se
   ve hoy /socio/<slug>. Un afiliado que no toque nada tiene exactamente esto.

   `slot` dice dónde puede estar cada sección:
     top     — antes del bloque movible. Fija.
     movable — el afiliado la enciende, la apaga y la mueve.
     bottom  — después del bloque movible. Fija.

   Las fijas lo son por una razón concreta y ESCRITA (fixedReason): todas
   llevan un botón de registro con el código del socio. Apagarlas le quitaría
   puertas de alta a él mismo, así que la pantalla se lo explica en vez de
   dejar un interruptor gris sin motivo. */

export type SectionSlot = "top" | "movable" | "bottom";

export interface PartnerSectionDef {
  id: string;
  label: string;
  /** Qué contiene, en una frase, para el afiliado. */
  hint: string;
  slot: SectionSlot;
  /** Por qué no se puede apagar. Solo en las fijas. */
  fixedReason?: string;
}

export const PARTNER_SECTIONS: readonly PartnerSectionDef[] = [
  {
    id: "portada",
    label: "Portada",
    slot: "top",
    hint: "Tu nombre, el titular y el primer botón para crear cuenta.",
    fixedReason:
      "Es la que lleva tu nombre y el primer botón de registro: sin ella nadie sabe que la recomendación es tuya ni tiene por dónde darse de alta.",
  },
  {
    id: "presentacion",
    label: "Tu presentación",
    slot: "top",
    hint: "Tu foto y lo que escribas sobre ti.",
    fixedReason:
      "Es justo lo que estás editando en esta pantalla. Aparece sola en cuanto tengas foto o texto aprobados, y desaparece si los dejas vacíos.",
  },

  {
    id: "prueba-social",
    label: "Prueba social",
    slot: "movable",
    hint: "Las cifras y las señales de confianza de DaleControl.",
  },
  {
    id: "funciones",
    label: "Funciones",
    slot: "movable",
    hint: "La rejilla con todo lo que hace la plataforma.",
  },
  {
    id: "destacados",
    label: "Módulos destacados",
    slot: "movable",
    hint: "Los módulos explicados uno por uno, con su captura.",
  },
  {
    id: "comparativa",
    label: "Comparativa",
    slot: "movable",
    hint: "DaleControl frente a llevar la clínica con herramientas sueltas.",
  },
  {
    id: "testimonios",
    label: "Testimonios",
    slot: "movable",
    hint: "Lo que dicen las clínicas que ya lo usan.",
  },
  {
    id: "preguntas",
    label: "Preguntas frecuentes",
    slot: "movable",
    hint: "Las dudas de siempre: permanencia, datos, facturación.",
  },

  {
    id: "calculadora",
    label: "Calculadora de ahorro",
    slot: "bottom",
    hint: "El simulador de tiempo administrativo.",
    fixedReason:
      "Termina en un botón de registro con tu código: apagarla te quitaría una de las puertas de alta que ya tienes trabajando.",
  },
  {
    id: "cierre",
    label: "Cierre e invitación",
    slot: "bottom",
    hint: "El bloque final que vuelve a invitar a crear cuenta.",
    fixedReason: "Es el último botón de registro de la página, el que más altas produce.",
  },
  {
    id: "pie",
    label: "Pie de página",
    slot: "bottom",
    hint: "Tu nombre y un último enlace de registro.",
    fixedReason: "Lleva tu último enlace de alta y el crédito de que la recomendación es tuya.",
  },
];

/** Las únicas que viajan en sectionsConfig. Las fijas nunca se guardan. */
export const MOVABLE_SECTIONS: readonly PartnerSectionDef[] = PARTNER_SECTIONS.filter(
  (s) => s.slot === "movable",
);

const MOVABLE_IDS = new Set(MOVABLE_SECTIONS.map((s) => s.id));

export function sectionDef(id: string): PartnerSectionDef | undefined {
  return PARTNER_SECTIONS.find((s) => s.id === id);
}

/* ── La configuración de secciones ────────────────────────────────────── */

export interface SectionSetting {
  id: string;
  visible: boolean;
  orden: number;
}

/** Todas encendidas, en el orden del catálogo: la página tal cual es hoy. */
export function defaultSections(): SectionSetting[] {
  return MOVABLE_SECTIONS.map((s, i) => ({ id: s.id, visible: true, orden: i + 1 }));
}

/**
 * Convierte CUALQUIER cosa en una lista completa y ordenada de secciones.
 *
 * Es el punto que garantiza que nada se rompa: null, un jsonb con basura, una
 * sección que se retiró del catálogo o una que se agregó después de que este
 * afiliado guardó su configuración — todo cae en una lista válida con las diez
 * decisiones tomadas. Por eso lo llaman igual la página pública, el panel y el
 * admin: si cada uno improvisara su propio respaldo, un jsonb viejo pintaría
 * tres páginas distintas.
 *
 * Reglas: se ignora lo que no esté en el catálogo, se descartan los
 * duplicados, se ordena por `orden` y lo que falte se añade al final ENCENDIDO
 * (una sección nueva del producto aparece sola; nadie se queda con media
 * página por haber guardado su orden hace tres meses). Al final se renumera
 * 1..N para que `orden` nunca tenga huecos ni empates.
 */
export function normalizeSections(raw: unknown): SectionSetting[] {
  if (!Array.isArray(raw)) return defaultSections();

  // Number.MAX_SAFE_INTEGER = "sin orden declarado". Al ordenar caen al final
  // conservando el orden en que llegaron (Array.sort es estable).
  const NO_ORDER = Number.MAX_SAFE_INTEGER;

  const seen = new Set<string>();
  const parsed: SectionSetting[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = typeof (item as any).id === "string" ? (item as any).id : "";
    if (!MOVABLE_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);

    const orden = Number((item as any).orden);
    parsed.push({
      id,
      // Solo un `false` explícito apaga una sección. Un jsonb sin la clave
      // `visible` deja la sección encendida, que es el estado por defecto.
      visible: (item as any).visible !== false,
      orden: Number.isFinite(orden) ? orden : NO_ORDER,
    });
  }

  for (const s of MOVABLE_SECTIONS) {
    if (!seen.has(s.id)) parsed.push({ id: s.id, visible: true, orden: NO_ORDER });
  }

  parsed.sort((a, b) => a.orden - b.orden);
  return parsed.map((s, i) => ({ id: s.id, visible: s.visible, orden: i + 1 }));
}

/** Los ids movibles ENCENDIDOS, ya en orden. Es lo que pinta la página. */
export function visibleSectionIds(sections: SectionSetting[]): string[] {
  return sections.filter((s) => s.visible).map((s) => s.id);
}

/* ── Publicado vs borrador ────────────────────────────────────────────────
   La regla que sostiene la moderación entera:

     photoUrl / bio / sectionsConfig    → PUBLICADO. Lo único que lee
       /socio/<slug>. Solo lo escribe una aprobación del admin.
     photoUrlPending / bioPending / …   → BORRADOR. Lo escribe el afiliado.
       Nadie del público lo ve nunca.

   Mientras algo está en revisión —o si se rechaza— la página pública sigue
   mostrando lo último aprobado. Un socio no puede tumbar su propia página
   dejando un borrador a medias, y un texto sin revisar no llega a un
   visitante ni por accidente. */

/**
 * Lo mínimo para pintar la página pública: las TRES columnas publicadas.
 *
 * Es un tipo aparte y no la fila entera a propósito. /socio/<slug> selecciona
 * exactamente esto, así que las columnas del borrador ni siquiera salen de la
 * base en la petición que sirve la página: lo que espera revisión no puede
 * filtrarse a un visitante por un descuido de render.
 */
export interface PublishedPageRow {
  photoUrl: string | null;
  bio: string | null;
  sectionsConfig: unknown;
}

export interface PartnerPageRow extends PublishedPageRow {
  pageStatus: string | null;
  photoUrlPending: string | null;
  bioPending: string | null;
  sectionsConfigPending: unknown;
}

export interface PartnerPageContent {
  photoUrl: string | null;
  bio: string | null;
  sections: SectionSetting[];
}

/** Lo que ve el público. */
export function publishedPage(row: PublishedPageRow): PartnerPageContent {
  return {
    photoUrl: row.photoUrl ?? null,
    bio: row.bio ?? null,
    sections: normalizeSections(row.sectionsConfig),
  };
}

/**
 * ¿Hay borrador? Se decide por `sectionsConfigPending`, y no por "alguno de
 * los tres campos pendientes no es null", porque TODA escritura de borrador
 * guarda los tres a la vez (ver buildDraftPatch). Ese invariante es el que
 * permite distinguir "no ha empezado a editar" de "editó y borró su foto y su
 * texto" — dos cosas que con la otra regla serían indistinguibles, y la
 * segunda acabaría enseñándole su contenido publicado como si fuera su
 * borrador.
 */
export function hasDraft(row: PartnerPageRow): boolean {
  return row.sectionsConfigPending != null;
}

/** Lo que el afiliado edita. Sin borrador empezado, parte de lo publicado. */
export function draftPage(row: PartnerPageRow): PartnerPageContent {
  if (!hasDraft(row)) return publishedPage(row);
  return {
    photoUrl: row.photoUrlPending ?? null,
    bio: row.bioPending ?? null,
    sections: normalizeSections(row.sectionsConfigPending),
  };
}

/** ¿Este socio tiene algo personalizado ya publicado? */
export function isPublishedEmpty(row: PartnerPageRow): boolean {
  const p = publishedPage(row);
  return !p.photoUrl && !p.bio && p.sections.every((s) => s.visible);
}

/**
 * El estado completo de la página tal como viaja al panel del afiliado.
 *
 * Vive aquí, y no junto a la consulta que lo arma (page-store.ts), porque lo
 * importa el componente CLIENTE de la pantalla: page-store.ts trae Prisma, y
 * aunque un `import type` se borre al compilar, el tipo del contrato no tiene
 * por qué depender de que ese borrado ocurra.
 *
 * Las fechas van como ISO: cruzan la frontera servidor→cliente y un Date a
 * medio serializar es un dolor de cabeza garantizado.
 */
export interface PartnerPageState {
  status: PageStatus;
  rejectReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  /** ¿Tiene cambios sin publicar? */
  hasDraft: boolean;
  /** Lo que edita. Sin borrador empezado, es una copia de lo publicado. */
  draft: PartnerPageContent;
  /** Lo que el público ve AHORA MISMO en /socio/<slug>. */
  published: PartnerPageContent;
  /** ¿Su página pública sigue siendo la de fábrica? */
  publishedEmpty: boolean;
}

export interface DraftChanges {
  photoUrl?: string | null;
  bio?: string | null;
  sections?: SectionSetting[];
}

export interface DraftPatch {
  photoUrlPending: string | null;
  bioPending: string | null;
  sectionsConfigPending: SectionSetting[];
  pageStatus?: PageStatus;
}

/**
 * El patch que deja el borrador COMPLETO tras un cambio parcial.
 *
 * Guarda siempre los tres campos, aunque solo cambie uno: el borrador es una
 * foto fija del estado propuesto, nunca un diff. Eso hace que aprobar sea
 * copiar tres columnas, que el "antes y después" del admin no tenga que
 * adivinar qué significa un null, y que hasDraft() pueda fiarse de
 * sectionsConfigPending.
 *
 * El estado: 'approved' vuelve a 'draft' en cuanto toca algo (lo publicado
 * sigue intacto, pero ya no coincide con lo que tiene en pantalla).
 * 'rejected' se QUEDA en 'rejected' hasta que reenvíe, para no borrarle de la
 * pantalla el motivo que tiene que corregir.
 */
export function buildDraftPatch(row: PartnerPageRow, changes: DraftChanges): DraftPatch {
  const base = draftPage(row);
  const status = normalizeStatus(row.pageStatus);

  const patch: DraftPatch = {
    photoUrlPending: changes.photoUrl !== undefined ? changes.photoUrl : base.photoUrl,
    bioPending: changes.bio !== undefined ? changes.bio : base.bio,
    sectionsConfigPending: changes.sections !== undefined ? changes.sections : base.sections,
  };

  if (status === "approved") patch.pageStatus = "draft";
  return patch;
}
