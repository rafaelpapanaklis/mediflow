// Paginación por offset para listados (directorios del marketplace, admin,
// catálogos). Acota queries que escalan mal sin romper filtros ni orderBy.
//   ?take  → 1..100, default 50
//   ?page  → 1-indexado (skip = (page-1)*take)

export const DEFAULT_TAKE = 50;
export const MAX_TAKE = 100;

export interface PageParams {
  take: number;
  skip: number;
  page: number;
}

export function parsePageParams(searchParams: URLSearchParams): PageParams {
  const takeRaw = Number.parseInt(searchParams.get("take") ?? "", 10);
  const take = Number.isFinite(takeRaw)
    ? Math.min(Math.max(takeRaw, 1), MAX_TAKE)
    : DEFAULT_TAKE;

  const pageRaw = Number.parseInt(searchParams.get("page") ?? "", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return { take, skip: (page - 1) * take, page };
}
