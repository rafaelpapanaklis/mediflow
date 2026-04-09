import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Cache reviews for 1 hour to avoid hitting API limits
const reviewsCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function GET(req: NextRequest) {
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const clinic = await prisma.clinic.findUnique({
    where: { slug },
    select: { googlePlaceId: true, name: true },
  });

  if (!clinic?.googlePlaceId) {
    return NextResponse.json({ reviews: [], rating: null, total: 0, configured: false });
  }

  // Check cache
  const cached = reviewsCache.get(clinic.googlePlaceId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ reviews: [], rating: null, total: 0, configured: false, error: "API key not configured" });
  }

  try {
    const fields = "rating,user_ratings_total,reviews";
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${clinic.googlePlaceId}&fields=${fields}&language=es&key=${apiKey}`;

    const res  = await fetch(url, { next: { revalidate: 3600 } });
    const data = await res.json();

    if (data.status !== "OK") {
      console.error("Google Places error:", data.status, data.error_message);
      return NextResponse.json({ reviews: [], rating: null, total: 0, configured: true, error: data.status });
    }

    const result = data.result;
    const reviews = (result.reviews ?? []).map((r: any) => ({
      name:       r.author_name,
      rating:     r.rating,
      text:       r.text,
      date:       new Date(r.time * 1000).toLocaleDateString("es-MX", { month: "long", year: "numeric" }),
      photoUrl:   r.profile_photo_url,
      relativeTime: r.relative_time_description,
    }));

    const responseData = {
      reviews,
      rating:      result.rating ?? null,
      total:       result.user_ratings_total ?? 0,
      configured:  true,
    };

    // Cache it
    reviewsCache.set(clinic.googlePlaceId, { data: responseData, ts: Date.now() });

    return NextResponse.json(responseData);
  } catch (err) {
    console.error("Google Places fetch error:", err);
    return NextResponse.json({ reviews: [], rating: null, total: 0, configured: true, error: "fetch_error" });
  }
}
