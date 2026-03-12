import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

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
  const user = await prisma.user.findUnique({
    where: { supabaseId: supabaseUser.id },
    include: { clinic: true },
  });
  if (!user) redirect("/onboarding");
  return user;
}
