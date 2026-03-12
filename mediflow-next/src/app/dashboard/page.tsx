import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Dashboard — MediFlow",
};

/* Full dashboard is implemented in Part 2.
   This placeholder keeps routing functional. */
export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center min-h-screen bg-slate-50 text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center text-white text-2xl font-extrabold mb-6 shadow-card-md">
        M
      </div>
      <h1 className="text-2xl font-extrabold text-foreground mb-2">Dashboard listo</h1>
      <p className="text-muted-foreground text-sm max-w-sm mb-6 leading-relaxed">
        El dashboard completo (sidebar, módulos, gráficas, modales) se implementa en la
        <strong className="text-foreground"> Parte 2</strong>.
      </p>
      <div className="flex gap-3 flex-wrap justify-center">
        <Button asChild>
          <Link href="/dashboard/patients">Pacientes →</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">← Volver al sitio</Link>
        </Button>
      </div>
    </div>
  );
}
