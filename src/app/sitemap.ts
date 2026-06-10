import type { MetadataRoute } from "next";
import { SPECIALTY_SLUGS } from "@/lib/specialty-data";
import { SITE_URL } from "@/lib/seo";
import { getCategoryCityCombos, getListedClinicSlugs } from "@/lib/directory/query";
import { DIRECTORY_CATEGORIES } from "@/lib/directory/types";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`,         lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_URL}/clinicas`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/descubre`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ];

  const specialtyEntries: MetadataRoute.Sitemap = SPECIALTY_SLUGS.map((slug) => ({
    url: `${SITE_URL}/${slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.9,
  }));

  // Las 17 categorías del directorio — lista ESTÁTICA, sin DB (siempre segura).
  const categoryEntries: MetadataRoute.Sitemap = DIRECTORY_CATEGORIES.map((c) => ({
    url: `${SITE_URL}/descubre/${c.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  // Combinaciones categoría+ciudad reales (DB). En build sin DATABASE_URL → [].
  let comboEntries: MetadataRoute.Sitemap = [];
  try {
    const combos = await getCategoryCityCombos();
    comboEntries = combos.map((combo) => ({
      url: `${SITE_URL}/descubre/${combo.categoria}/${combo.ciudad}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    }));
  } catch {
    comboEntries = [];
  }

  // Landings públicas de clínicas (DB, cap 5000). En build sin DATABASE_URL → [].
  let clinicEntries: MetadataRoute.Sitemap = [];
  try {
    const slugs = await getListedClinicSlugs();
    clinicEntries = slugs.map((slug) => ({
      url: `${SITE_URL}/${slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    }));
  } catch {
    clinicEntries = [];
  }

  return [
    ...staticEntries,
    ...specialtyEntries,
    ...categoryEntries,
    ...comboEntries,
    ...clinicEntries,
  ];
}
