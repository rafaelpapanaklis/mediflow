import type { MetadataRoute } from "next";
import { SPECIALTY_SLUGS as NEW_SPECIALTY_SLUGS } from "@/lib/specialty-data";
import { SPECIALTY_SLUGS as LEGACY_SPECIALTY_SLUGS } from "@/lib/specialty-content";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`,         lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_URL}/clinicas`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];

  const newSpecialtyEntries: MetadataRoute.Sitemap = NEW_SPECIALTY_SLUGS.map((slug) => ({
    url: `${SITE_URL}/${slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.9,
  }));

  // Legacy slugs que NO se solapan con los nuevos
  const legacyOnly = LEGACY_SPECIALTY_SLUGS.filter(s => !NEW_SPECIALTY_SLUGS.includes(s));
  const legacySpecialtyEntries: MetadataRoute.Sitemap = legacyOnly.map((slug) => ({
    url: `${SITE_URL}/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...staticEntries, ...newSpecialtyEntries, ...legacySpecialtyEntries];
}
