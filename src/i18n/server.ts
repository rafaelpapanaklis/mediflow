// src/i18n/server.ts
//
// Helpers de i18n para el SERVIDOR (server components / route handlers). Evitan
// repetir en cada módulo el boilerplate del cast defensivo + fallback "es" +
// makeT(getDict(...)). Es server-only por transitividad: importa getCurrentUser
// (prisma/supabase). NUNCA lo importes desde un componente cliente — usa useT().
import { getCurrentUser } from "@/lib/auth";
import { getDict } from "@/i18n/dictionaries";
import { makeT, type TFunction } from "@/i18n/t";

// Locale de una clínica de la sesión. Cast defensivo (igual que el patrón de
// permissionsOverride / subscriptionStatus del repo) por si un Prisma client
// cacheado de un build viejo todavía no expone `locale`. Único lugar con el cast.
export function localeFromClinic(
  clinic: { locale?: string | null } | null | undefined,
): string {
  return clinic?.locale ?? "es";
}

// t + locale a partir de un locale ya resuelto. Úsalo cuando YA tienes la
// clínica en mano (p.ej. el layout, que llamó getCurrentUser para otras cosas)
// y quieres evitar una segunda query: serverTForLocale(localeFromClinic(clinic)).
export function serverTForLocale(locale: string): { t: TFunction; locale: string } {
  return { t: makeT(getDict(locale)), locale };
}

// t + locale derivados de la sesión en una línea. Úsalo en server components /
// route handlers del panel que NO tienen la clínica a mano:
//   const { t } = await getServerT();
// (Hace su propia query de sesión vía getCurrentUser.)
export async function getServerT(): Promise<{ t: TFunction; locale: string }> {
  const user = await getCurrentUser();
  return serverTForLocale(localeFromClinic(user.clinic));
}
