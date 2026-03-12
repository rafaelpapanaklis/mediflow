import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CTABanner() {
  return (
    <section className="section-pad px-6">
      <div className="container-tight">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-violet-700 p-12 text-center text-white">
          {/* Decorative blobs */}
          <div className="absolute top-0 left-0 w-64 h-64 bg-white/5 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl" />
          <div className="absolute bottom-0 right-0 w-64 h-64 bg-violet-500/20 rounded-full translate-x-1/2 translate-y-1/2 blur-3xl" />

          <div className="relative">
            <div className="text-4xl mb-4">✦</div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
              ¿Listo para transformar tu clínica?
            </h2>
            <p className="text-lg text-white/75 max-w-xl mx-auto mb-8">
              Únete a miles de profesionales que ya usan MediFlow.
              Sin tarjeta de crédito requerida.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="xl" variant="white" asChild>
                <Link href="/register">✦ Empieza 14 días gratis</Link>
              </Button>
              <Button
                size="xl"
                className="bg-white/15 hover:bg-white/25 border border-white/30 text-white shadow-none"
                asChild
              >
                <Link href="/dashboard">Ver demo →</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
