import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// These paths should NOT be treated as clinic slugs
const RESERVED_PATHS = new Set([
  "admin","api","dashboard","auth","login","register",
  "pricing","features","contact","consentimiento","portal",
  "favicon.ico","_next","fonts","images",
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    try {
      const token = request.cookies.get("admin_token")?.value;
      const secret = process.env.ADMIN_SECRET_TOKEN;
      if (!token || !secret || token !== secret) {
        const url = request.nextUrl.clone();
        url.pathname = "/admin/login";
        return NextResponse.redirect(url);
      }
    } catch {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/dashboard")) {
    return await updateSession(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
