import type { MetadataRoute } from "next";
import { SPECIALTY_SLUGS } from "@/lib/specialty-data";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`,         lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_URL}/clinicas`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];

  const specialtyEntries: MetadataRoute.Sitemap = SPECIALTY_SLUGS.map((slug) => ({
    url: `${SITE_URL}/${slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.9,
  }));

  return [...staticEntries, ...specialtyEntries];
}
