import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { PantallaOnboarding } from "./pantalla";

export default async function OnboardingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true } });
  if (dbUser) redirect("/dashboard");
  return <PantallaOnboarding />;
}
