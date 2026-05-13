/**
 * Centralized revalidatePath helper for endpoints that mutate cross-screen data.
 *
 * Why: many panel mutations affect data shown on several screens (a new doctor
 * shows up in /dashboard/team, /dashboard/agenda, /dashboard/clinical, sidebar
 * counts, etc.). Manually listing paths in each endpoint drifts over time as
 * new pages start consuming the same data. Centralizing the path lists keeps
 * endpoints consistent and makes "when a new page consumes X, add it here"
 * a one-edit change.
 *
 * Pattern in endpoint handler:
 *   import { revalidateAfter } from "@/lib/cache/revalidate";
 *   // ... after successful mutation, before return:
 *   revalidateAfter("team");
 *
 * The complement client-side is `useRouter().refresh()` in the component
 * that triggered the mutation, so the current tab also picks up the changes
 * without a hard refresh.
 */

import { revalidatePath } from "next/cache";

export const CACHE_GROUPS = {
  team: [
    "/dashboard/team",
    "/dashboard/agenda",
    "/dashboard/clinical",
    "/dashboard/settings",
    "/dashboard",
  ],
  resources: [
    "/dashboard/resources",
    "/dashboard/agenda",
    "/dashboard/resource-bookings",
    "/dashboard/clinic-layout",
  ],
  appointments: [
    "/dashboard/agenda",
    "/dashboard/appointments",
    "/dashboard/patients",
    "/dashboard",
  ],
  patients: [
    "/dashboard/patients",
    "/dashboard/clinical",
    "/dashboard/billing",
    "/dashboard/agenda",
  ],
  treatments: [
    "/dashboard/treatments",
    "/dashboard/patients",
    "/dashboard/packages",
  ],
  packages: [
    "/dashboard/packages",
    "/dashboard/treatments",
    "/dashboard/patients",
  ],
  procedures: [
    "/dashboard/procedures",
    "/dashboard/settings",
    "/dashboard/treatments",
    "/dashboard/agenda",
    "/dashboard/billing",
  ],
  clinic: ["/dashboard"],
  clinicLayout: [
    "/dashboard/clinic-layout",
    "/dashboard/tv-modes",
  ],
  inbox: ["/dashboard/inbox", "/dashboard"],
  clinicalNotes: [
    "/dashboard/clinical",
    "/dashboard/patients",
  ],
  referrals: [
    "/dashboard/inbox",
    "/dashboard/patients",
    "/dashboard",
  ],
} as const satisfies Record<string, readonly string[]>;

export type CacheGroup = keyof typeof CACHE_GROUPS;

export function revalidateAfter(group: CacheGroup): void {
  for (const p of CACHE_GROUPS[group]) {
    revalidatePath(p);
  }
}

export function revalidateAfterGroups(...groups: CacheGroup[]): void {
  // Dedup via Set in case groups overlap.
  const seen = new Set<string>();
  for (const g of groups) {
    for (const p of CACHE_GROUPS[g]) {
      if (!seen.has(p)) {
        seen.add(p);
        revalidatePath(p);
      }
    }
  }
}
