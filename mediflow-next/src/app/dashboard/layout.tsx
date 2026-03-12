import Link from "next/link";
import { redirect } from "next/navigation";

/* This layout wraps ALL dashboard routes.
   Full sidebar + topbar implementation is in Part 2.
   This file exports the shell so routes resolve correctly. */

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 font-sans">
      {children}
    </div>
  );
}
