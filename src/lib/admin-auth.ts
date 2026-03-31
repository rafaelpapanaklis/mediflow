import { NextRequest, NextResponse } from "next/server";

export function adminMiddleware(request: NextRequest) {
  const token = request.cookies.get("admin_token")?.value;
  const validToken = process.env.ADMIN_SECRET_TOKEN;

  if (!token || token !== validToken) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
