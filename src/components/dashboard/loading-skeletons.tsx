/**
 * Skeletons compartidos para loading.tsx de cada ruta del dashboard.
 * Renderizan inmediatamente al navegar (Next.js suspense boundary), evitando
 * la pantalla blanca mientras los server components hacen su query inicial.
 *
 * Estilo neutro para que matchee dark + light. Sin emojis, sin animaciones
 * pesadas — solo pulse Tailwind.
 */

interface LineProps {
  className?: string;
  children?: React.ReactNode;
}

function SkelLine({ className = "" }: LineProps) {
  return <div className={`bg-muted/60 rounded animate-pulse ${className}`} />;
}

function SkelBlock({ className = "", children }: LineProps) {
  return <div className={`bg-card border border-border rounded-xl ${className}`}>{children}</div>;
}

export function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <SkelLine className="h-8 w-64" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <SkelBlock key={i} className="h-24 p-4">
            <SkelLine className="h-3 w-1/2 mb-2" />
            <SkelLine className="h-7 w-3/4" />
          </SkelBlock>
        ))}
      </div>
      <SkelBlock className="h-72" />
      <SkelBlock className="h-96" />
    </div>
  );
}

export function AgendaSkeleton() {
  return (
    <div className="flex flex-col h-screen">
      {/* Topbar */}
      <div className="bg-card border-b border-border px-3 py-2 flex items-center gap-2">
        <SkelLine className="h-6 w-24" />
        <SkelLine className="h-7 w-44" />
        <SkelLine className="h-6 w-32 ml-2" />
        <div className="flex-1" />
        <SkelLine className="h-7 w-24" />
        <SkelLine className="h-7 w-24" />
        <SkelLine className="h-7 w-20" />
      </div>
      {/* Sub-toolbar */}
      <div className="bg-card border-b border-border px-4 py-2 flex items-center justify-between">
        <SkelLine className="h-4 w-40" />
        <SkelLine className="h-7 w-44" />
      </div>
      {/* Grid */}
      <div className="flex-1 grid grid-cols-[52px_1fr] grid-rows-[52px_1fr] bg-background">
        <div />
        <div className="grid grid-cols-3 gap-2 p-2">
          {[0, 1, 2].map((i) => <SkelLine key={i} className="h-9" />)}
        </div>
        <div className="border-r border-border" />
        <div className="grid grid-cols-3 gap-2 p-2">
          {[0, 1, 2].map((c) => (
            <div key={c} className="space-y-2">
              {[0, 1, 2, 3, 4, 5].map((r) => <SkelLine key={r} className="h-12" />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="p-6 space-y-3">
      <div className="flex items-center justify-between">
        <SkelLine className="h-7 w-48" />
        <SkelLine className="h-9 w-32" />
      </div>
      <SkelBlock className="overflow-hidden">
        <div className="border-b border-border p-3">
          <SkelLine className="h-4 w-1/4" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="border-b border-border p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-muted/60 animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <SkelLine className="h-4 w-1/3" />
              <SkelLine className="h-3 w-1/2" />
            </div>
            <SkelLine className="h-3 w-16" />
            <SkelLine className="h-7 w-20" />
          </div>
        ))}
      </SkelBlock>
    </div>
  );
}

export function PatientDetailSkeleton() {
  return (
    <div className="p-6 space-y-4">
      {/* Hero + side cards */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <SkelBlock className="h-32 p-4">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-muted/60 animate-pulse" />
            <div className="flex-1 space-y-2">
              <SkelLine className="h-5 w-1/3" />
              <SkelLine className="h-3 w-1/2" />
            </div>
          </div>
        </SkelBlock>
        <SkelBlock className="h-32 p-4 space-y-2">
          <SkelLine className="h-3 w-1/2" />
          <SkelLine className="h-6 w-3/4" />
        </SkelBlock>
      </div>
      {/* Tabs strip */}
      <div className="flex items-center gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => <SkelLine key={i} className="h-8 w-24" />)}
      </div>
      {/* Content */}
      <SkelBlock className="h-96" />
    </div>
  );
}
