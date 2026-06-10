import Link from "next/link";
import { getCategoryCityCombos } from "@/lib/directory/query";

// ─────────────────────────────────────────────────────────────────────────────
// Bloques de INTERLINKING del directorio (SERVER COMPONENTS, async). Cada uno
// hace su propia lectura y la envuelve en try/catch: en build SIN DB devuelven
// null (no rompen el build); en runtime/Vercel (con DB) se llenan e ISR-cachean.
//
// Fuente única y eficiente: getCategoryCityCombos() → TODAS las combinaciones
// (categoría × ciudad) con conteo. Filtrar en memoria evita N queries.
//
// Estilo BLANCO + VIOLETA (.mfh / CSS vars). Copy natural en español neutro con
// tú, sin keyword stuffing. 100% responsive. Solo enlazar combinaciones con ≥1
// clínica (las que devuelve getCategoryCityCombos ya cumplen eso).
//
// EXPORTS (no cambiar firmas — las páginas dependen de ellas):
//
//   CategoryCityLinks({ categorySlug, categoryPlural })
//     → Para /descubre/[categoria]: bloque "Explora <plural> por ciudad" con
//       chips/links a /descubre/[categoria]/[ciudad] de las ciudades de esa
//       categoría (orden por conteo). Null si no hay ninguna.
//
//   CityCrossLinks({ categorySlug, citySlug, cityLabel, categoryLabel })
//     → Para /descubre/[categoria]/[ciudad]: dos bloques:
//       (a) "Otras ciudades con <categoryLabel>" → /descubre/[categoria]/[otra]
//       (b) "Otras especialidades en <cityLabel>" → /descubre/[otra]/[ciudad]
//       Excluir la combinación actual. Null si no hay nada que enlazar.
//
//   TopCombosFooter()
//     → Footer de /descubre: grid con las TOP combinaciones (p.ej. 12) tipo
//       "Clínicas dentales en Guadalajara" → /descubre/[cat]/[ciudad].
//       Null si no hay combinaciones.
// ─────────────────────────────────────────────────────────────────────────────

/** Primera letra en mayúscula: "clínicas dentales" → "Clínicas dentales". */
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Estilo de chip reutilizado del directorio (espejo de PILL_IDLE en CategoryGrid).
const CHIP =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[color:var(--line)] bg-white px-3.5 py-2 text-[13px] font-semibold text-[color:var(--ink)] no-underline transition hover:-translate-y-0.5 hover:border-[color:var(--v200)] hover:bg-[color:var(--tint2)]";

// ── (a) /descubre/[categoria]: ciudades de esa categoría ─────────────────────
export async function CategoryCityLinks({
  categorySlug,
  categoryPlural,
}: {
  categorySlug: string;
  categoryPlural: string;
}) {
  let combos;
  try {
    combos = await getCategoryCityCombos();
  } catch {
    return null;
  }

  const cities = combos.filter((c) => c.categoria === categorySlug).slice(0, 24);
  if (cities.length === 0) return null;

  return (
    <nav aria-label={`Ciudades con ${categoryPlural}`}>
      <div className="mfh-head" style={{ alignItems: "flex-start", marginBottom: "clamp(20px, 3vw, 32px)" }}>
        <h2 className="mfh-h2 mfh-balance">Explora {categoryPlural} por ciudad</h2>
        <p className="mfh-lede">
          Elige tu ciudad para ver clínicas con agenda en línea cerca de ti.
        </p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {cities.map((c) => (
          <Link key={c.ciudad} href={`/descubre/${categorySlug}/${c.ciudad}`} className={CHIP}>
            {c.cityLabel}
            <span className="font-medium text-[color:var(--muted)]">· {c.count}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

// ── (b) /descubre/[categoria]/[ciudad]: cross-links en dos direcciones ────────
export async function CityCrossLinks({
  categorySlug,
  citySlug,
  cityLabel,
  categoryLabel,
}: {
  categorySlug: string;
  citySlug: string;
  cityLabel: string;
  categoryLabel: string;
}) {
  let combos;
  try {
    combos = await getCategoryCityCombos();
  } catch {
    return null;
  }

  const otherCities = combos
    .filter((c) => c.categoria === categorySlug && c.ciudad !== citySlug)
    .slice(0, 12);
  const otherCategories = combos
    .filter((c) => c.ciudad === citySlug && c.categoria !== categorySlug)
    .slice(0, 12);

  if (otherCities.length === 0 && otherCategories.length === 0) return null;

  return (
    <section className="mfh-section--tight" aria-label="Enlaces relacionados del directorio">
      <div className="mfh-container">
        <div className="flex flex-col gap-[clamp(28px,4vw,44px)]">
          {otherCities.length > 0 ? (
            <nav aria-label={`Otras ciudades con ${categoryLabel}`}>
              <h2 className="mfh-h3 mfh-balance" style={{ marginBottom: 16 }}>
                Otras ciudades con {categoryLabel}
              </h2>
              <div className="flex flex-wrap gap-2.5">
                {otherCities.map((c) => (
                  <Link key={c.ciudad} href={`/descubre/${categorySlug}/${c.ciudad}`} className={CHIP}>
                    {c.cityLabel}
                  </Link>
                ))}
              </div>
            </nav>
          ) : null}
          {otherCategories.length > 0 ? (
            <nav aria-label={`Otras especialidades en ${cityLabel}`}>
              <h2 className="mfh-h3 mfh-balance" style={{ marginBottom: 16 }}>
                Otras especialidades en {cityLabel}
              </h2>
              <div className="flex flex-wrap gap-2.5">
                {otherCategories.map((c) => (
                  <Link key={c.categoria} href={`/descubre/${c.categoria}/${citySlug}`} className={CHIP}>
                    {c.categoryLabel}
                  </Link>
                ))}
              </div>
            </nav>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ── (c) Footer de /descubre: top combinaciones populares ─────────────────────
export async function TopCombosFooter() {
  let combos;
  try {
    combos = await getCategoryCityCombos();
  } catch {
    return null;
  }

  const top = combos.slice(0, 12);
  if (top.length === 0) return null;

  return (
    <section className="mfh-section--tight" aria-labelledby="top-combos-heading">
      <div className="mfh-container">
        <div className="mfh-head mfh-center" style={{ marginBottom: "clamp(24px, 4vw, 40px)" }}>
          <h2 id="top-combos-heading" className="mfh-h2 mfh-balance">Búsquedas populares</h2>
          <p className="mfh-lede">
            Las combinaciones de especialidad y ciudad que más buscan los pacientes.
          </p>
        </div>
        <nav aria-label="Búsquedas populares">
          <ul className="grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {top.map((c) => (
              <li key={`${c.categoria}/${c.ciudad}`}>
                <Link
                  href={`/descubre/${c.categoria}/${c.ciudad}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--line)] bg-white px-4 py-3 text-sm font-semibold text-[color:var(--ink)] no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-[color:var(--v200)] hover:bg-[color:var(--tint2)]"
                >
                  <span>{capitalize(c.plural)} en {c.cityLabel}</span>
                  <span aria-hidden="true" className="text-[color:var(--b)]">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}
