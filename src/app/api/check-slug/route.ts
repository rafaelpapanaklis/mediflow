import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug || slug.length < 3) return NextResponse.json({ available: false });
  const reserved = ["admin","app","api","www","mail","support","help","dashboard","login","register","mediflow","test","demo"];
  if (reserved.includes(slug)) return NextResponse.json({ available: false });
  const existing = await prisma.clinic.findUnique({ where: { slug } });
  return NextResponse.json({ available: !existing });
}
