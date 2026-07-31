// ─────────────────────────────────────────────────────────────────────────────
// Páginas de producto por módulo — contrato de contenido.
//
// Las 8 páginas (/software-agenda-dental, /expediente-clinico-dental, …) son
// la MISMA plantilla con distinto contenido y distinto acento. Todo lo que
// cambia entre ellas vive en src/lib/producto/data.ts como un `ProductoModule`;
// los componentes de src/components/producto/ sólo lo pintan.
//
// El contenido es el de los diseños aprobados (Claude Design, variante
// "B - Viva") — ver C:\Users\Rafael\ClauCode\MediFlow\disenos-modulos\.
// No inventar funciones: cualquier cambio de copy se valida contra el diseño.
// ─────────────────────────────────────────────────────────────────────────────

/** Paletas de los chips de sección y de los íconos (ver .pm-t-* en producto.css). */
export type Tone =
  | "blue" | "navy" | "green" | "emerald"
  | "violet" | "indigo" | "cyan" | "amber" | "red" | "teal";

export type ProductoSlug =
  | "software-agenda-dental"
  | "expediente-clinico-dental"
  | "portal-del-paciente-dental"
  | "caja-y-cobros-clinica-dental"
  | "facturacion-dental-cfdi"
  | "radiografias-3d-cbct-dental"
  | "reportes-clinica-dental"
  | "software-multiclinica-dental";

/**
 * Acento de la página. Se inyecta como custom properties CSS en el <div> raíz
 * (themeVars) para que producto.css sea uno solo para las 8 rutas.
 */
export type ProductoTheme = {
  /** Los dos halos radiales y la base del hero oscuro. */
  glowA: string;
  glowB: string;
  heroBase: string;
  /** Halo detrás de la escena 3D del hero. */
  glowScene: string;
  /** Píldora "Módulo de …" del hero. */
  pillBg: string;
  pillBorder: string;
  pillText: string;
  /** Color del span del H1, del punto de la píldora y de los ✓ del hero. */
  accent: string;
  /** Color de los enlaces del breadcrumb del hero. */
  crumb: string;
  /** Degradado de la franja de beneficios. */
  band: string;
  /** Píldora "Paso a paso" + línea punteada, sobre el fondo #0f172a. */
  stepsBg: string;
  stepsBorder: string;
  stepsText: string;
  stepsDash: string;
  /** Color del círculo de cada uno de los 4 pasos. */
  stepNums: [string, string, string, string];
  /** Degradado del CTA final + color del texto del botón blanco + nota. */
  cta: string;
  ctaInk: string;
  ctaNote: string;
  /** Color de enlace de la sección de blog y de "otros módulos". */
  link: string;
  linkBorder: string;
  /** Píldora y signo "+" del FAQ. */
  faqBg: string;
  faqText: string;
  /** Tono de los chips de las secciones de blog y FAQ. */
  faqTone: Tone;
  blogTone: Tone;
};

export type Benefit = {
  /** Glifo unicode del diseño (✓ ◷ ⟳ ▤ ◇ ◉ ★ ✦ $). Decorativo. */
  glyph: string;
  title: string;
  body: string;
};

export type ProblemCard = {
  glyph: string;
  tone: Tone;
  title: string;
  body: string;
};

/** Bloque alternado: texto a un lado, mockup del panel al otro. */
export type Capability = {
  eyebrow: string;
  tone: Tone;
  title: string;
  body: string;
  bullets: string[];
  /** Clave del mockup (ver src/components/producto/mockups/*). */
  mock: string;
  /** true → figura a la izquierda (row-reverse), como en el diseño. */
  reverse?: boolean;
};

export type Step = {
  title: string;
  body: string;
};

export type Faq = {
  q: string;
  a: string;
};

/** Artículo real del blog — el slug se valida contra el sitemap público. */
export type RelatedPost = {
  slug: string;
  kicker: string;
  tone: Tone;
  title: string;
  excerpt: string;
};

export type ProductoModule = {
  slug: ProductoSlug;
  /** Nombre corto para "otros módulos" y para el breadcrumb. */
  name: string;
  /** Descripción de una línea en la rejilla de "otros módulos". */
  tagline: string;
  theme: ProductoTheme;

  // ── SEO ──
  /** ≤ 60 caracteres, con la keyword al inicio. */
  metaTitle: string;
  /** 140-160 caracteres. */
  metaDescription: string;
  keywords: string[];

  // ── Hero ──
  badge: string;
  /** El H1 va partido: `h1a` + <em>{h1accent}</em> + `h1b` (uno solo por página). */
  h1a: string;
  h1accent: string;
  h1b?: string;
  lede: string;
  heroChecks: [string, string, string];
  /** Clave del mockup del hero — SIEMPRE en SSR: es el elemento LCP. */
  heroMock: string;

  // ── Cuerpo ──
  benefits: [Benefit, Benefit, Benefit, Benefit];
  problem: { title: string; sub: string; cards: [ProblemCard, ProblemCard, ProblemCard] };
  capabilities: Capability[];
  steps: { sub: string; items: [Step, Step, Step, Step] };
  blog: { title: string; posts: [RelatedPost, RelatedPost, RelatedPost] };
  faq: [Faq, Faq, Faq, Faq];
  cta: { title: string; body: string };
};
