import Link from "next/link";
import { AdminNav } from "./admin-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <nav className="bg-slate-900 border-b border-slate-700 px-6 h-14 flex items-center gap-4">
        <Link href="/admin" className="flex items-center gap-2 font-extrabold text-brand-400">
          <div className="w-6 h-6 rounded-lg bg-brand-600 flex items-center justify-center text-[11px] font-extrabold text-white">M</div>
          MediFlow Admin
        </Link>
        <AdminNav />
      </nav>
      {children}
    </div>
  );
}
