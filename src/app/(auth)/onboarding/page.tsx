import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
export default async function OnboardingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const dbUser = await prisma.user.findUnique({ where: { supabaseId: user.id } });
  if (dbUser) redirect("/dashboard");
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center text-white text-2xl font-extrabold mx-auto mb-4">M</div>
        <h1 className="text-xl font-extrabold mb-2">Configurando tu clínica…</h1>
        <p className="text-sm text-muted-foreground">Si esto tarda más de 30 segundos, <a href="/login" className="text-brand-600 hover:underline">vuelve a iniciar sesión</a>.</p>
      </div>
    </div>
  );
}
