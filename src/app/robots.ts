import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/admin",
          "/portal",
          "/reservar",
          "/api",
          "/auth",
          "/login",
          "/register",
          "/pago",
          "/consent",
          "/consentimiento",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
