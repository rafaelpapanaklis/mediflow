import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      {/* Minimal auth nav */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-b border-border/60 h-14 flex items-center px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-extrabold text-[17px] text-brand-600 tracking-tight"
        >
          <span className="w-2 h-2 rounded-full bg-brand-600" />
          MediFlow
        </Link>
      </div>
      <div className="pt-14">{children}</div>
    </div>
  );
}
