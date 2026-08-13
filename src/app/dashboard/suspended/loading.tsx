/**
 * Skeleton PROPIO de la pantalla de pago/activación.
 *
 * Sin este archivo la ruta heredaba el DashboardSkeleton genérico de
 * src/app/dashboard/loading.tsx (barra + 4 tarjetas de KPI + dos bloques
 * anchos), que no se parece en nada a esta pantalla: durante la primera carga
 * daba la sensación de página vacía o rota justo donde la clínica paga.
 *
 * Replica la GEOMETRÍA real de page.tsx + suspended-client.tsx para que el
 * relleno no salte al hidratar: encabezado centrado (pill + título + subcopy),
 * selector mensual/anual, las TRES tarjetas de plan (md:grid-cols-3) y el
 * bloque de pago de 560px. Estilo neutro (dark + light), sólo pulse Tailwind,
 * igual que los skeletons compartidos del panel.
 */

function SkelLine({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted/60 ${className}`} />;
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1000px] px-6 pb-20 pt-12">
        {/* Encabezado: pill + h1 + subcopy, centrados como en page.tsx */}
        <div className="mb-8 flex flex-col items-center gap-4">
          <SkelLine className="h-[38px] w-[190px] rounded-full" />
          <SkelLine className="h-10 w-[min(420px,90%)]" />
          <SkelLine className="h-5 w-[min(560px,95%)]" />
        </div>

        {/* Selector mensual / anual */}
        <div className="mb-7 flex justify-center">
          <SkelLine className="h-[46px] w-[260px] rounded-full" />
        </div>

        {/* Las tres tarjetas de plan */}
        <div className="mb-7 grid items-stretch gap-[18px] md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex flex-col gap-[13px] rounded-[18px] border border-border bg-card p-[22px]"
            >
              <SkelLine className="h-[22px] w-[92px] rounded-full" />
              <SkelLine className="h-[21px] w-1/2" />
              <SkelLine className="h-[34px] w-2/3" />
              <div className="my-0.5 h-px bg-border" />
              <div className="flex flex-col gap-[9px]">
                {[0, 1, 2, 3, 4].map((f) => (
                  <SkelLine key={f} className="h-[15px] w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bloque de pago: método + CTA */}
        <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 rounded-[18px] border border-border bg-card p-[22px]">
          <SkelLine className="h-[52px] w-full rounded-[13px]" />
          <SkelLine className="h-[52px] w-full rounded-[13px]" />
          <SkelLine className="h-4 w-[200px]" />
        </div>
      </div>
    </div>
  );
}
