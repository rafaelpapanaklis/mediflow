export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fuzzyScore(query: string, target: string): number {
  const q = normalize(query);
  const t = normalize(target);
  if (!q) return 1;
  if (!t) return 0;

  if (t.includes(q)) {
    return t.startsWith(q) ? 1 : 0.9;
  }

  const qTokens = q.split(" ").filter(Boolean);
  if (qTokens.length === 0) return 0;

  const found = qTokens.filter((tok) => t.includes(tok)).length;
  if (found === 0) return 0;

  return (found / qTokens.length) * 0.7;
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getHaystack: (item: T) => string,
): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, getHaystack(item)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}
