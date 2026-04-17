"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin",              label: "Dashboard" },
  { href: "/admin/clinics",      label: "Clinicas"  },
  { href: "/admin/onboarding",   label: "Onboarding" },
  { href: "/admin/payments",     label: "Facturación" },
  { href: "/admin/coupons",      label: "Cupones"   },
  { href: "/admin/churn",        label: "Churn"     },
  { href: "/admin/announcements", label: "Anuncios" },
  { href: "/admin/settings",     label: "Config"    },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 ml-4">
      {NAV_ITEMS.map(item => {
        const isActive = item.href === "/admin"
          ? pathname === "/admin"
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-slate-700 text-white"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
