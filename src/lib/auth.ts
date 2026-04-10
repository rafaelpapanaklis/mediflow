import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export async function getSession() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function requireAuth() {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

export async function getCurrentUser() {
  const supabaseUser = await requireAuth();
  const cookieStore = cookies();
  const activeClinicId = cookieStore.get("activeClinicId")?.value;

  // If there's an active clinic cookie, try to find the user in that clinic
  if (activeClinicId) {
    const user = await prisma.user.findFirst({
      where: { supabaseId: supabaseUser.id, clinicId: activeClinicId, isActive: true },
      include: { clinic: true },
    });
    if (user) return user;
  }

  // Fallback: find the first active user record for this supabase account
  const user = await prisma.user.findFirst({
    where: { supabaseId: supabaseUser.id, isActive: true },
    include: { clinic: true },
    orderBy: { createdAt: "asc" },
  });
  if (!user) redirect("/onboarding");
  return user;
}

/**
 * Get all clinics the current supabase user has access to.
 */
export async function getUserClinics() {
  const supabaseUser = await requireAuth();
  const users = await prisma.user.findMany({
    where: { supabaseId: supabaseUser.id, isActive: true },
    include: { clinic: { select: { id: true, name: true, category: true, plan: true, logoUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  return users.map(u => ({
    clinicId: u.clinic.id,
    clinicName: u.clinic.name,
    category: (u.clinic as any).category ?? "OTHER",
    plan: u.clinic.plan,
    logoUrl: u.clinic.logoUrl,
    role: u.role,
    userId: u.id,
  }));
}
