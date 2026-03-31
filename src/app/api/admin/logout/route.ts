import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  cookieStore.delete("admin_token");
  return NextResponse.redirect(new URL("/admin/login", req.url));
}
