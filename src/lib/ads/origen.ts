// Origen de una clínica (de dónde llegó) para /admin — WS1-T10.
//
// Entrada: la fila de clinic_ads_clicks de esa clínica (o null si no hay: nadie
// guardó un clic ni UTM en su alta). Salida: la etiqueta corta que se pinta.
//
//   «Meta · <campaña> · <anuncio>»   anuncio = utm_content
//   «Google Ads»
//   «Otro · <utm_source>»            llegó con UTM de otra fuente (newsletter…)
//   «Orgánico»                       sin clic de anuncio ni UTM
//
// OJO con «Orgánico»: significa «no hay clic ni UTM guardado». Las clínicas que
// se registraron ANTES de este cambio (o antes de aplicar el SQL) también salen
// así: de ellas no se guardó nada y no hay forma de saberlo después.
//
// Módulo PURO: sin base, sin red.

export interface FilaOrigen {
  platform?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  utmSourceFirst?: string | null;
  utmMediumFirst?: string | null;
  utmCampaignFirst?: string | null;
  utmContentFirst?: string | null;
  utmSourceLast?: string | null;
  utmMediumLast?: string | null;
  utmCampaignLast?: string | null;
  utmContentLast?: string | null;
}

export type CanalOrigen = "meta" | "google" | "otro" | "organico";

export interface Origen {
  canal: CanalOrigen;
  /** Lo que se pinta: «Meta · campaña · anuncio», «Google Ads», «Orgánico»… */
  etiqueta: string;
}

/** utm_source con los que Meta marca sus enlaces (los de la plataforma y los habituales de un anunciante). */
const FUENTES_META = new Set(["meta", "facebook", "fb", "instagram", "ig", "facebook.com", "instagram.com"]);
const MEDIOS_PAGADOS = new Set(["cpc", "ppc", "paid", "paid_social", "paidsocial", "paid-social", "social_paid"]);

const t = (v: string | null | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const minus = (v: string | null) => (v ? v.toLowerCase() : "");

export function tieneClicGoogle(f: FilaOrigen): boolean {
  return !!(t(f.gclid) || t(f.gbraid) || t(f.wbraid));
}

/** Los UTM que mandan: los del último toque; si faltan, los del primero. */
export function utmVigente(f: FilaOrigen) {
  const ultimo = {
    source: t(f.utmSourceLast), medium: t(f.utmMediumLast), campaign: t(f.utmCampaignLast), content: t(f.utmContentLast),
  };
  const primero = {
    source: t(f.utmSourceFirst), medium: t(f.utmMediumFirst), campaign: t(f.utmCampaignFirst), content: t(f.utmContentFirst),
  };
  return ultimo.source || ultimo.medium || ultimo.campaign || ultimo.content ? ultimo : primero;
}

export function etiquetaMeta(campaign: string | null, content: string | null): string {
  return ["Meta", campaign, content].filter(Boolean).join(" · ");
}

export function origenDeClinica(f: FilaOrigen | null | undefined): Origen {
  if (!f) return { canal: "organico", etiqueta: "Orgánico" };
  const utm = utmVigente(f);
  const fuente = minus(utm.source);

  // 1) La plataforma del último clic manda. Filas viejas (sin "platform"): por el id que haya.
  const plataforma = t(f.platform) ?? (tieneClicGoogle(f) ? "google" : t(f.fbclid) ? "meta" : null);
  if (plataforma === "meta") return { canal: "meta", etiqueta: etiquetaMeta(utm.campaign, utm.content) };
  if (plataforma === "google") return { canal: "google", etiqueta: "Google Ads" };

  // 2) Sin id de clic pero con UTM (el enlace del anuncio los trae aunque el navegador no conserve el fbclid).
  if (FUENTES_META.has(fuente)) return { canal: "meta", etiqueta: etiquetaMeta(utm.campaign, utm.content) };
  if ((fuente === "google" || fuente === "googleads" || fuente === "adwords") && MEDIOS_PAGADOS.has(minus(utm.medium))) {
    return { canal: "google", etiqueta: "Google Ads" };
  }
  if (utm.source) return { canal: "otro", etiqueta: `Otro · ${utm.source}` };
  if (utm.campaign || utm.medium) return { canal: "otro", etiqueta: `Otro · ${utm.campaign ?? utm.medium}` };

  return { canal: "organico", etiqueta: "Orgánico" };
}

// ── Para las pantallas de /admin ────────────────────────────────────────────

export interface FilaOrigenAdmin extends FilaOrigen {
  createdAt?: Date | string | null;
  clickedAt?: Date | string | null;
  metaClickedAt?: Date | string | null;
  utmFirstAt?: Date | string | null;
  utmLastAt?: Date | string | null;
}

export interface UtmDTO {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  /** ISO del toque, o null. */
  at: string | null;
}

/** Serializable (sin Date, sin ids de clic completos): viaja a los componentes de cliente. */
export interface OrigenClinicaDTO extends Origen {
  /** null si de esa clínica no se guardó nada. */
  detalle: {
    plataforma: "google" | "meta" | null;
    conClicGoogle: boolean;
    conClicMeta: boolean;
    primero: UtmDTO | null;
    ultimo: UtmDTO | null;
    /** ISO del alta (cuando se guardó la fila). */
    registradaAt: string | null;
  } | null;
}

const iso = (v: Date | string | null | undefined): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export function dtoDeOrigen(f: FilaOrigenAdmin | null | undefined): OrigenClinicaDTO {
  const o = origenDeClinica(f);
  if (!f) return { ...o, detalle: null };
  const utm = (s: unknown, m: unknown, c: unknown, k: unknown, at: Date | string | null | undefined): UtmDTO | null => {
    const u = { source: t(s as string), medium: t(m as string), campaign: t(c as string), content: t(k as string) };
    return u.source || u.medium || u.campaign || u.content ? { ...u, at: iso(at) } : null;
  };
  const plataforma = t(f.platform);
  return {
    ...o,
    detalle: {
      plataforma: plataforma === "google" || plataforma === "meta" ? plataforma : null,
      conClicGoogle: tieneClicGoogle(f),
      conClicMeta: !!t(f.fbclid),
      primero: utm(f.utmSourceFirst, f.utmMediumFirst, f.utmCampaignFirst, f.utmContentFirst, f.utmFirstAt),
      ultimo: utm(f.utmSourceLast, f.utmMediumLast, f.utmCampaignLast, f.utmContentLast, f.utmLastAt),
      registradaAt: iso(f.createdAt),
    },
  };
}

/** «fuente meta · medio paid_social · campaña X · anuncio Y» (solo lo que haya). */
export function resumenUtm(u: Pick<UtmDTO, "source" | "medium" | "campaign" | "content">): string {
  return [
    u.source && `fuente ${u.source}`,
    u.medium && `medio ${u.medium}`,
    u.campaign && `campaña ${u.campaign}`,
    u.content && `anuncio ${u.content}`,
  ].filter(Boolean).join(" · ");
}

/** ¿El primer y el último toque dicen lo mismo? (para no pintarlo dos veces) */
export function mismoUtm(a: UtmDTO | null, b: UtmDTO | null): boolean {
  return !!a && !!b && resumenUtm(a) === resumenUtm(b);
}
