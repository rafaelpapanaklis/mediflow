import { redirect } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { BrandGlyph } from "@/components/public/landing/primitives/logo";
export default async function OnboardingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true } });
  if (dbUser) redirect("/dashboard");
  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="w-full max-w-md px-6 py-10 text-center sm:px-10"
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-2)",
        }}
      >
        <div
          className="mx-auto mb-5 flex h-16 w-16 items-center justify-center"
          style={{
            background: "var(--brand-grad)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-1)",
          }}
        >
          <BrandGlyph size={34} mono="#fff" />
        </div>
        <h1
          className="mb-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[21px] font-bold tracking-[-0.01em]"
          style={{ color: "var(--text-1)" }}
        >
          <Loader2
            size={20}
            strokeWidth={1.75}
            aria-hidden="true"
            className="shrink-0 animate-spin motion-reduce:animate-none"
            style={{ color: "var(--brand)" }}
          />
          Configurando tu clínica…
        </h1>
        <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          Si esto tarda más de 30 segundos,{" "}
          <a
            href="/login"
            className="-mx-1.5 -my-3 inline-block rounded-md px-1.5 py-3 font-semibold text-[color:var(--brand)] underline-offset-4 transition-[color,box-shadow] duration-150 ease-[var(--ease)] hover:text-[color:var(--violet-700)] hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ring)] active:scale-[.98] motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[color:var(--violet-400)] dark:hover:text-[color:var(--violet-300)]"
          >
            vuelve a iniciar sesión
          </a>
          .
        </p>
      </div>
    </div>
  );
}
