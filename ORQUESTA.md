

═══════════════════════════════════════════════════════════════════════════
## WS-billing · T1 — Sincronizar cupo de IA (aiTokensLimit) con el plan ✅ EN MAIN (a2182b1, 2026-06-15)
═══════════════════════════════════════════════════════════════════════════
Commit a2182b1. Build VERDE (npx next build, EXIT 0; los prisma:error DATABASE_URL
son del prerender sin DB en este entorno, no afectan el exit ni hay errores TS).

BUG: Clinic.aiTokensLimit nunca se sincronizaba con el plan (default 50000 = BASIC)
aunque el plan fuera PRO/CLINIC. Cambiar de plan cobraba distinto en Stripe pero el
cupo de IA seguía igual. Fuente única de cupos: src/lib/plans.ts → getPlanLimits(plan)
.aiTokensDefault (BASIC 50000 · PRO 200000 · CLINIC 1000000).

ARCHIVOS TOCADOS:
- src/app/api/billing/change-plan/route.ts: el update {plan, subscriptionStatus} ahora
  fija aiTokensLimit = getPlanLimits(targetPlanId).aiTokensDefault.
- src/app/api/webhooks/stripe/route.ts (webhook de PLATAFORMA; NO el de teleconsulta):
  · checkout.session.completed / kind="platform-subscription": si isPlanId(metadata.plan)
    → fija plan + aiTokensLimit acorde (spread condicional, si no, deja lo existente).
  · customer.subscription.created/updated: si isPlanId(sub.metadata.plan) → fija plan +
    aiTokensLimit (cubre cambios desde el dashboard/portal de Stripe).
- src/app/api/auth/register/route.ts: el clinic.create fija aiTokensLimit según data.plan.
- sql/backfill_ai_tokens_limit_by_plan.sql (NUEVO): alinea el cupo al plan vigente por CASE.

REGLAS RESPETADAS: NO se tocaron precios (siguen en src/lib/billing/plans.ts), NO se
resetea aiTokensUsed ni aiLastResetAt, clinicId siempre del contexto/metadata (nunca del
body), plan validado con isPlanId (metadata inválida → no se toca plan/cupo). El monedero
de recargas IA (sql/ai-billing.sql) es otro sistema, intacto.

🔴 PENDIENTE (Rafael): aplicar A MANO sql/backfill_ai_tokens_limit_by_plan.sql en Supabase
(no se aplica solo). No toca aiTokensUsed. Sin envs nuevas.

---

═══════════════════════════════════════════════════════════════════════════
## WS3 · Equipos de Vendedores (afiliados) — ✅ COMPLETO en main (2026-06-10)
═══════════════════════════════════════════════════════════════════════════
Branch feat/afiliados-equipo → main (fast-forward). Commit 34438de. Build VERDE.

QUÉ: un afiliado (padre) registra manualmente a sus vendedores (login propio).
Cada venta del equipo reparte el % del nivel del padre — el vendedor gana su %
(que el padre le asigna, CONGELADO al alta = no retroactivo) y el padre el
OVERRIDE. La plataforma NO paga de más: sellerMxn + overrideMxn === comisión
total del nivel.

DÓNDE:
- schema: AffiliateSeller, AffiliateSellerAttribution, AffiliateSellerCommission
  (sidecar, idempotente por stripeInvoiceId) + sellerId nullable en
  affiliate_links/affiliate_coupons. FKs + RLS deny-all en sql/afiliados-equipo.sql.
- split: webhook Stripe — el override del padre REDUCE affiliate_commissions y la
  porción del vendedor va al sidecar, en una transacción idempotente. Clínicas sin
  vendedor: comportamiento idéntico al actual (100% al padre).
- atribución: en el alta, por link (?c=campaña) o cupón del vendedor; anti
  self-referral + exige vendedor activo e hijo del padre atribuido. La clínica
  SIGUE ligada al PADRE por clinics.affiliateId (cuenta para su nivel).
- "Mi equipo" /afiliados/equipo (sidebar): alta / editar % / activar / eliminar
  vendedor + stats por vendedor (clics, clínicas, pendiente, pagado). Cap del % =
  nivel vigente del padre.
- panel del vendedor /afiliados/vendedor: inicio (sus comisiones), herramientas
  (sus links con campaña + su cupón) y datos de pago (CLABE propia, mismo flujo y
  mínimo del afiliado). Login routeado por /api/afiliados/whoami (afiliado vs vendedor).
- admin: GET /api/admin/affiliates/[id]/sellers + POST .../sellers/[sellerId]/payouts
  (marca pagado al vendedor) + UI "Ver equipo" en affiliates-client.

REGLAS CONGELADAS (no cambiar sin avisar): máx 2 niveles (el vendedor jamás registra
gente ni tiene equipo). Cap del % del vendedor = % del nivel vigente del padre
(validado en alta/edición + clamp de seguridad en el webhook). Desactivar un
vendedor: pierde acceso y no recibe NUEVAS atribuciones, pero conserva su % en las
clínicas que ya trajo (no retroactivo en ambos sentidos). El vendedor SIEMPRE debe
compartir un link con campaña (lleva su sellerId); sin ?c= no se le atribuiría.

QA: A9 (seguridad/multi-tenant) + A10 (responsive/UX) → SIN P0. Identidad siempre de
sesión, ownership verificado, idempotencia y suma del split correctas, cero voseo,
todo responsive. Fixes aplicados: gate "padre APPROVED" en vendedor/me; findUnique
por supabaseId en seller-auth; texto accesible en botón editar %.

🔴 PENDIENTE (Rafael): correr sql/afiliados-equipo.sql en Supabase. Es ADITIVO e
idempotente; sin él NADA existente rompe, pero: no hay split (100% al padre), "Mi
equipo" muestra "pendiente de activar" y la atribución de vendedor se omite. NO hay
env nuevas.

Orquestación: 1 fundación (schema/SQL/split-math/seller-auth/seller-stats, hecho por
el principal) + 5 agentes constructores en paralelo (A2 Mi equipo, A3 vendedor, A4
split, A5 atribución, A8 admin) + 2 QA (A9/A10). Archivos disjuntos → 0 colisiones.

---

## WS2-T1 (follow-up) — Filtro por ciudad + SEO programático categoría+ciudad ✅ EN MAIN (dcb4507, 2026-06-10)

Todo sobre el directorio /descubre. NO se tocó el schema (campos existentes city/address).

Qué se hizo:
- **Filtro de ciudad**: `CityFilter` (typeahead con ciudades REALES derivadas de la DB; se oculta si no hay ninguna) cableado en `DirectoryExplorer`, combinable con categoría + búsqueda (+ el "cerca de mí / mapa" de la otra terminal). La API `/api/directory/clinics` admite `?city=` (slug normalizado contra el texto libre de `Clinic.city`). Nueva API `/api/directory/cities`.
- **Páginas programáticas** `/descubre/[categoria]/[ciudad]` (SSG + ISR 24h, dynamicParams): H1 y copy únicos, listado SERVER-RENDERED (página 1 en el HTML) + "cargar más", metadata única + canonical, JSON-LD `ItemList` + `BreadcrumbList`, breadcrumbs visibles. SOLO combinaciones con ≥1 clínica; vacías → 404 noindex (cero thin content). `generateStaticParams` con combos reales.
- **Sitemap** (ahora async): /descubre, las 17 categorías, combos categoría+ciudad válidos y landings de clínicas públicas. DB en try/catch → build sin DATABASE_URL OK.
- **Interlinking**: bloque "por ciudad" en [categoria], cross-links (otras ciudades de la categoría + otras especialidades en la ciudad) en cada ciudad, footer "búsquedas populares" en /descubre.
- **Capa nueva**: `cities.ts` (normalización a slug canónico + alias CDMX/DF/GDL/MTY/…) y `query.ts` (fuente ÚNICA del select público + helpers + combos; reusada por API, páginas, sitemap e interlinking).

Orquestación: el principal hizo la capa de datos (cities.ts/query.ts/types/2 API) + la página SEO; 4 agentes en paralelo (A2 filtro UI, A3 listado "cargar más", A5 sitemap, A6 interlinking). Archivos disjuntos → 0 colisiones.

Rebase: conflicto con la otra terminal del directorio (mapa + "cerca de mí" con Leaflet/OSM) en route.ts / types.ts / DirectoryExplorer.tsx → resuelto **preservando AMBAS features** (su lat/lng/distance + mi ?city=; `query.ts` ganó latitude/longitude para satisfacer el tipo). 2.º rebase sobre "afiliados-equipos" sin conflicto.

Gotchas resueltos (junction de node_modules de main desactualizado vs el propio main):
- Cliente Prisma obsoleto (faltaban `AffiliatePrefs`/`AffiliateClick`) → `npx prisma generate`.
- Faltaban deps `leaflet`/`react-leaflet`/`@types/leaflet` (las metió la terminal del mapa) → `npm install --no-save` de esas versiones del package.json (NO materializa el junction; arregla el node_modules compartido). Si otra terminal con junction truena por esto: corre ese generate + install.

Build: `npx next build` limpio (EXIT 0). /descubre ○ estático · [categoria] ● SSG (17) · [categoria]/[ciudad] ● SSG · sitemap.xml/robots.txt ○.
Env nuevas: NINGUNA. SQL nuevo: NINGUNO.
