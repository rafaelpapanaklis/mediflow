===========================================================================
## WS2-T3 - "Importar mi clinica": wizard de migracion (UI, cliente mock) [feat/import-wizard-ui, 2026-06-18]
===========================================================================
QUE SE HIZO: traduje el prototipo design/import-clinic/ a componentes reales del
panel (Next.js 14 App Router, TS). Wizard completo navegable con datos SIMULADOS
(sin backend). Lanzador en la pagina de Pacientes + estado vacio mejorado.

CONTRATO DE FRONTEND (un solo punto de inyeccion; T4 mete el cliente real):
- interface ImportClient { getOrigins, preview, commit, templateUrl, submitAssisted }
- Tipos: Origin, Entity, ColumnMapping, DetectedColumn, TargetField, PreviewRow,
  PreviewResult, CommitResult, AssistedResult.
- MockImportClient devuelve las cifras/filas exactas del prototipo (1,240 validos,
  18 errores, 7 duplicados; resumen 1,240 pacientes / $340,000 / 85 citas).
- TODO(T4) marcados: plantilla real multi-pestana, preview/commit reales contra
  /api/import, reporte de errores real, ticket de migracion asistida.

ARCHIVOS NUEVOS (src/components/import/, 11):
- import-client.ts    contrato + MockImportClient + ORIGINS + DATA_TYPES + helpers
- import-wizard.tsx   modal .modal--wide (Radix Dialog) + stepbar 6 pasos + maquina
                      de estado + validaciones + commit/progreso simulado
- step-origin / step-export / step-what / step-upload / step-mapping / step-review
- importing-panel / result-panel / assisted-panel

ARCHIVOS MODIFICADOS (4):
- src/app/dashboard/patients/patients-client.tsx: boton "Importar mi clinica" en la
  toolbar (junto a Nuevo paciente) + estado vacio grande (0 pacientes y sin filtros)
  con CTA grande + "Migracion asistida"; monta ImportWizard (open local, recarga la
  lista al terminar). Nuevo sub-componente ImportClinicEmpty.
- src/app/globals.css: seccion "Importar mi clinica" (clases .imp-) sobre los tokens
  del panel; reusa .btn-new / .badge-new / .table-new / .switch / .modal. Light y Dark
  por variables (sin color hardcodeado por tema), hover/focus-visible, responsive y
  prefers-reduced-motion.
- src/i18n/dictionaries/es.json y en.json: namespace shell.importClinic (es + en),
  microcopy del prototipo en espanol neutro; plurales con {one,other}.

FIDELIDAD AL PROTOTIPO: 6 pasos (Origen, Exportar, Que importar, Subir, Mapear,
Revisar) + Importando + Resultado + Migracion asistida (acuse 48 h). 11 origenes
(9 con perfil = auto-mapeo + instrucciones; Excel/Otro = manual + plantilla).
Dropzone 4 estados (vacio/arrastrando/cargado/error; .xlsx o .csv; max 5 MB; teclado).
Mapeo auto vs manual con "sin mapear" en ambar. Revisar: stat-cards + tabla con
motivo en hover/foco + switch omitir duplicados.

ACCESIBILIDAD: Radix Dialog (role=dialog, aria-modal, Esc, focus-trap, cierre por
backdrop), aria-pressed en tarjetas de origen, dropzone operable por teclado
(Enter/Espacio), foco visible, labels en selects, tooltip accesible por foco.

BUILD: npm run build (prisma generate + next build), sin pipes. EXIT 0,
"Compiled successfully", type-check OK, dashboard/patients en el manifest (dynamic,
20.4 kB). Los prisma:error DATABASE_URL son del prerender sin DB en este entorno y
no afectan el exit (igual que el resto de worktrees).

SIN SQL. SIN envs nuevas. Cliente real = WS2-T4 (no se creo src/lib/import/client.ts).
NO mergeado a main: pendiente QA de Rafael en Preview.
design/import-clinic/ queda como referencia local (no commiteado).




═══════════════════════════════════════════════════════════════════════════
## WS2-T1 — Motor de importación "Importar mi clínica" (backend núcleo) ✅ EN RAMA feat/import-engine (NO main, 2026-06-18)
═══════════════════════════════════════════════════════════════════════════
Extrae y generaliza el motor de /api/patients/import a src/lib/import (agnóstico a entidad) y
agrega 2 entidades nuevas: saldos y citas. NO toca main. Build EXIT 0. SIN SQL (usa tablas
existentes Patient/Invoice/Appointment).

ARCHIVOS NUEVOS:
  - src/lib/import/types.ts    — contrato ÚNICO (Entity, ColumnMapping, PreviewRow, PreviewResult,
    CommitResult). WS2-T2 (profiles) y WS2-T3 (UI) importan de aquí.
  - src/lib/import/engine.ts   — parseSpreadsheet (exceljs, magic bytes, tope 5MB/5000 filas),
    applyMapping, autodetect, parseImportForm, ImportError+importErrorResponse, runImport
    (pipeline genérico preview/commit + audit). Inyección de deps: engine NO importa entities
    (sin ciclos). Helpers de parseo (norm/parseDate/parsePhone/parseAmount/last10/normName).
  - src/lib/import/entities.ts — validadores patientsHandler (reusa normalización original) /
    balancesHandler (Invoice de apertura) / appointmentsHandler + resolución paciente/doctor.
  - src/app/api/import/balances/route.ts       (entity="balances")
  - src/app/api/import/appointments/route.ts   (entity="appointments")
ARCHIVO REFACTOR:
  - src/app/api/patients/import/route.ts — usa el engine; acepta columnMapping opcional; en
    dry-run AÑADE columns + suggestedMapping. Respuesta 100% COMPATIBLE con el modal viejo
    (total/validos/invalidos/duplicados/preview intactos; solo añade campos nuevos).

CONTRATO (las 3 rutas, mismo shape · FormData: file, dryRun, skipDuplicates, columnMapping?):
  dry-run → { entity, total, validos, invalidos, duplicados, columns, suggestedMapping, preview[] }
  commit  → { entity, created, skipped, duplicates, errors[] }
  Row = { row, data, status:"ok"|"error"|"duplicate", errors[], warnings[] }

DECISIONES / LÓGICA:
  - columnMapping: si viene se SANEA (solo headers reales + campos válidos de la entidad); si no,
    autodetección (HEADER_VARIANTS) = suggestedMapping. Campo "" = no importar.
  - SALDOS: Invoice "factura de apertura" (invoiceNumber MF-#### continuando la secuencia; items
    "Saldo inicial migrado"; subtotal=total=balance=monto; status PENDING; SIN CFDI). Resuelve
    paciente por phone(last10)→email→nombre. Idempotente: paciente ya migrado o repetido = duplicado.
    parseAmount tolera "$1,250.00" / "1.250,50".
  - CITAS: resuelve patientId (phone/email/nombre) + doctorId (nombre→User activo de la clínica),
    fecha+hora (default 09:00), endsAt=+duración (default 30 min), type default "Consulta", status
    SCHEDULED. Dedup por (paciente+horario) en archivo y contra DB.
  - Multi-tenant: clinicId SIEMPRE de getAuthContext (nunca del body); rateLimit(3/min) + logAudit
    en las 3 rutas. Seguridad conservada: exceljs (no SheetJS), magic bytes, topes 5MB/5000 filas.

BUILD: npm run build (worktree; node_modules vía junction al repo principal; SIN pipes). ✓ Compiled
  successfully · type-check sin errores · /api/import/balances + /api/import/appointments +
  /api/patients/import en el manifest · EXIT 0. Los prisma:error DATABASE_URL son del prerender
  sin DB (patrón conocido).

NO TOCADO: src/lib/import/profiles/ (WS2-T2), frontend/wizard (WS2-T3), main, design/ (prototipo).

PENDIENTES / TODO:
  - ¿Restringir balances/appointments a ADMIN? hoy basta sesión válida (paridad con patients).
  - Pacientes con una sola columna "nombre completo" (sin apellido aparte): patients sigue exigiendo
    firstName+lastName (compat). Un profile de WS2-T2 podría dividir el nombre.
  - QA: dry-run + commit de las 3 entidades con archivos reales (xlsx y csv con ; y ,).
  - Merge a main lo hace Rafael tras QA (orden con WS2-T2/T3).
## WS2-T2 — Importar mi clínica · Backend periférico (perfiles + plantilla + asistida) ✅ EN RAMA feat/import-profiles (NO main, build EXIT 0, 2026-06-18)
═══════════════════════════════════════════════════════════════════════════
Rama feat/import-profiles (base 18a64fb). Build `npm run build` EXIT 0 — ✓ Compiled
successfully, type-check sin errores, 278/278 páginas (+2 = mis 2 endpoints nuevos). Los
prisma:error DATABASE_URL son del prerender sin DB en este entorno y no afectan el exit.

QUÉ: las 3 piezas de backend/datos REALES detrás del prototipo design/import-clinic/
(diseño puro). NO toqué el engine ni types.ts (territorio de T1) ni la UI (T3).

1) PERFILES DE ORIGEN — src/lib/import/profiles/ (un archivo por origen):
   - origin.ts: tipos LOCALES (DcField, OriginInstruction, OriginProfile, Origin). A
     propósito NO se llama types.ts (ese es de T1); si T1 publica un contrato equivalente,
     se re-exporta desde ahí.
   - 9 con perfil (dentalink, medilink, identalsoft, opendental, dentrix, eaglesoft,
     gesden, dentidesk, dentalcore) + excel/otro (hasProfile:false, mapeo manual).
   - HONESTIDAD: TODOS verified:false. Sin export de muestra real, los mapeos son
     PLAUSIBLES por convención (columna del sistema → campo canónico de DaleControl).
     Dentalink (Reportes→Excel) y Open Dental (Query→CSV) llevan instrucciones realistas.
   - index.ts: ORIGIN_PROFILES (orden del grid del prototipo), getOriginProfile(id),
     listOrigins() → proyección al contrato.
   - campoDC alineado al importador real (HEADER_VARIANTS de patients/import): firstName,
     lastName, email, phone, dob, gender, address, bloodType, notes + fullName/rfc/balance.

2) GET /api/import/origins → Origin[] (forma del contrato, array tal cual). Sesión
   requerida + rateLimit; datos estáticos (no DB, no clinicId). Incluye `verified` como
   extra (superset del contrato, ignorable por T1/T3).

3) POST /api/import/assisted (FormData file ≤50MB + note) → { ok, ticketId? }:
   - Sube el archivo al bucket PRIVADO patient-files bajo import-assisted/{clinicId}/
     (aislado por clínica, cliente admin de Supabase).
   - Abre un ticket de SOPORTE existente (createTicket) → notifica al equipo por email +
     folio #DC-#### de seguimiento. category "DUDA" (el módulo no tiene "migración"; el
     asunto la identifica), priority "ALTA".
   - Adjunta el archivo al ticket (inyección server-side vía Prisma, A PROPÓSITO: el
     archivo excede los topes de adjuntos de soporte 5MB/imagen-PDF; el path es de
     confianza y acotado por clinicId; la capa de lectura solo firma, no re-valida).
   - rateLimit + logAudit (entityType "clinic", action "create"). SIN tabla nueva.
   - ⚠️ Límite de infra: en Vercel el body de una function tope ~4.5MB; archivos mayores
     necesitarían signed upload URL directo a storage (followup). Hoy se respeta el
     contrato (FormData) y se documenta.

4) GET /api/patients/import/template → refactor de 1 hoja a .xlsx de 3 HOJAS (Pacientes,
   Saldos, Citas), encabezados + 1 fila de muestra c/u. xlsx SOLO para generar (output de
   confianza); el parseo de subidas sigue por exceljs. Encabezados de "Pacientes"
   coinciden con los que reconoce el importador real.

REGLAS: clinicId SIEMPRE del ctx (nunca del body), rateLimit + logAudit en endpoints con
efectos, multi-tenant estricto. NO se creó worktree ni se tocó main. NO mergeado (Rafael
QA + merge en orden).

ARCHIVOS (16): src/lib/import/profiles/{origin,index,dentalink,medilink,identalsoft,
opendental,dentrix,eaglesoft,gesden,dentidesk,dentalcore,excel,otro}.ts (13) +
src/app/api/import/origins/route.ts + src/app/api/import/assisted/route.ts (nuevos) +
src/app/api/patients/import/template/route.ts (refactor 1→3 hojas).

SIN SQL nuevo. SIN envs nuevas (usa las de Supabase ya existentes). design/ NO se commitea
(es referencia del prototipo, no producto).

🔴 PENDIENTE Rafael: QA. (a) /api/import/origins responde el catálogo; (b) migración
asistida sube archivo y crea ticket #DC-#### con adjunto descargable en /admin/soporte;
(c) la plantilla baja con 3 hojas. Followups: subida directa a storage para archivos
>~4.5MB (límite Vercel); verificar perfiles contra exports reales para subir verified:true
por sistema.

═══════════════════════════════════════════════════════════════════════════
## WS-RT-INBOX merge — Inbox en tiempo real (polling) ✅ EN MAIN (6b4b2e6, 2026-06-17)
═══════════════════════════════════════════════════════════════════════════
QUÉ SE HIZO: merge de la rama feat/rt-inbox a main y push (deploy auto en Vercel).
El inbox ahora recibe mensajes/cambios sin recargar, vía polling ligero cada 5s.

PROCESO:
- Rebase de feat/rt-inbox sobre main: LIMPIO, 0 conflictos. La rama estaba 1 commit
  detrás (main tenía solo 22931a5 = meta-etiqueta SEO en layout.tsx; el commit del
  inbox no toca layout.tsx → sin solapamiento). merge-base 45771ac.
  Tras rebase: ab35564 → 6b4b2e6 (mismo árbol, reparentado sobre 22931a5).
- Merge a main: git merge --ff-only feat/rt-inbox → Fast-forward 22931a5..6b4b2e6.
  Sin commit de merge (FF puro), por eso no hay commit nuevo con Co-Author.
- Push: 22931a5..6b4b2e6  main -> main. OK.

ARCHIVOS (3, +343/-7):
- src/app/api/inbox/since/route.ts (NUEVO, 203 líneas): GET ligero de polling. Devuelve
  sólo lo cambiado desde ?ts=<ISO>: threads (lastMessageAt|updatedAt > ts), messages del
  hilo abierto (?threadId), counts.byChannel y serverTime (cursor del próximo poll, evita
  clock skew). Despierta SNOOZED vencidos. take:200.
- src/app/api/inbox/threads/route.ts (+serverTime): captura serverTime al inicio y lo
  devuelve para sembrar el cursor del cliente. Sin otro cambio.
- src/app/dashboard/inbox/inbox-client.tsx (+135/-6): poll cada 5s, merge de threads/
  messages por id (sin recargar), pausa en document.hidden, reconciliación silenciosa.

AISLAMIENTO MULTI-TENANT (revisado, NO debilitado):
- clinicId SIEMPRE de getDbUser() (cookie firmada de clínica activa + supabaseId); nada
  del request puede ampliar el alcance. Toda query lleva clinicId: dbUser.clinicId.
- Permiso: denyIfMissingPermission(dbUser, "inbox.view").
- threadId se valida {id, clinicId} con findFirst ANTES de leer mensajes; un threadId
  ajeno → owned null → 0 mensajes. El cliente nunca envía clinicId.

BUILD: npx next build (sin pipes), EXIT 0, ✓ Compiled successfully, 276/276 páginas.
/api/inbox/since presente en el manifest como ƒ (dynamic, force-dynamic). Los
prisma:error DATABASE_URL son del prerender sin DB en este entorno y no afectan el exit.

SIN SQL, SIN envs nuevas. COMMIT FINAL EN MAIN: 6b4b2e6.
QA (Rafael): abrir Inbox en 2 pestañas/usuarios de la MISMA clínica; un WhatsApp/cambio
entrante debe aparecer en ≤5s sin refrescar; verificar que otra clínica NO ve nada.

═══════════════════════════════════════════════════════════════════════════
## WS-billing · T3 — "Cambiar de plan" en trial actualiza el plan in-place ✅ EN MAIN (6f12a94, 2026-06-16)
═══════════════════════════════════════════════════════════════════════════
Commit 6f12a94. Build VERDE (npx next build, sin pipes; ✓ Compiled successfully +
type-check sin errores TS; los prisma:error DATABASE_URL son del prerender sin DB en
este entorno y no afectan el exit ni el typecheck).

BUG: En cuenta en trial / sin suscripción Stripe, Settings › Suscripción → "Cambiar a
este plan" NO cambiaba el plan: redirigía a /dashboard/suspended?prefill=PLAN, y suspended
IGNORA ?prefill (solo lee ?pending y preselecciona clinic.plan, el viejo). Resultado: el
usuario elegía Básico pero suspended seguía mostrando el plan anterior. El ?prefill era
código muerto (único productor: este route; cero consumidores en todo src/).

FIX: en trial el plan es solo preferencia (no se cobra hasta "Activar/pagar"). Ahora el
cambio es IN-PLACE: se actualiza clinic.plan de inmediato y suspended lo preselecciona solo.

ARCHIVOS TOCADOS (4):
- src/app/api/billing/change-plan/route.ts: la rama `if (!clinic.stripeSubscriptionId)`
  ya no devuelve {mode:"checkout", redirectUrl:.../suspended?prefill=...}. Ahora:
  prisma.clinic.update {plan: targetPlanId, aiTokensLimit: getPlanLimits(targetPlanId)
  .aiTokensDefault} + logAudit(action update; plan before/after; _source
  "self-service-change-plan-trial") → return {mode:"in-place", plan}. NO toca
  subscriptionStatus (sigue trial/pending hasta que pague). Docstring actualizado.
- src/components/dashboard/subscription-tab.tsx: applyPlanChange ya manejaba in-place
  (toast + router.refresh). Se eliminó la rama muerta mode:"checkout"/window.location.href
  (el endpoint ya nunca devuelve checkout) y se quitó redirectUrl del tipo de respuesta.
- src/i18n/dictionaries/es.json + en.json: copy de changePlanDescCheckout y
  confirmChangeBodyCheckout (caso sin-sub) ya no prometen checkout → "Cambiaremos tu plan
  ahora; el cobro se realiza cuando actives tu plan." (es/en).

NO TOCADO: src/app/dashboard/suspended/ (page.tsx ya preselecciona clinic.plan vía
getCurrentUser→clinic.plan; con el plan ya correcto el botón muestra "Pagar <plan>" solo).

REGLAS RESPETADAS: clinicId siempre del ctx (nunca del body), getPlanLimits como fuente
única de cupos (mismo patrón que la rama con-sub), sin SQL nuevo, sin envs nuevas.

QA (Rafael): trial + "Cambiar a Básico" → TU PLAN: Básico, y "Activar/pagar mi plan" →
suspended con Básico preseleccionado y "Pagar Básico — $499".

---

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

---

## WS-billing · T2 — Planes editables desde el admin (Fase 1: fundación + editor + gating) ✅ EN MAIN (c93d63a, 2026-06-15)

**Objetivo:** una sola fuente de verdad para los planes, editable desde el panel admin SIN redeploy (precio mensual/anual, límites de storage/tokens IA/whatsapp, máximos de pacientes/usuarios con "ilimitado", y permisos por módulo). Antes vivían hardcodeados y DESINCRONIZADOS en 3 archivos.

**Modelo + datos**
- Modelo Prisma `PlanConfig` (`@@map("plan_configs")`): planId @id, label, priceMxnMonthly, priceMxnAnnual, storageBytes (BigInt — 100GB no cabe en Int), aiTokensDefault, whatsappMonthly, maxPatients/maxUsers (Int? null=ilimitado), features Json ({moduleKey:boolean}), updatedAt.
- `sql/plan_configs.sql`: CREATE TABLE IF NOT EXISTS + seed idempotente (ON CONFLICT DO NOTHING) con los valores ACTUALES correctos (499/999/1999, anual ×10, límites de PLAN_LIMITS, features por plan). **⚠️ Aplicar a mano en Supabase.**

**Fuente única (server)**
- `src/lib/plan-shared.ts` (NUEVO, PURO/client-safe): tipos (PlanLimits, ResolvedPlan), `formatBytes`, catálogo `PLAN_MODULES` (casillas), `PLAN_MARKETING` (bullets) y `FALLBACK_PLAN_CONFIG` (= seed). Se separó porque `formatBytes` lo importan client components y plans.ts pasó a server-only.
- `src/lib/plans.ts` (ahora `server-only`): `getPlanLimits` (async), `getResolvedPlan`/`getResolvedPlans`, `clearPlanConfigCache`. Lee `plan_configs` con caché en memoria (TTL 60s) + FALLBACK a constantes (no rompe sin tabla/DB). Patrón espejo de `ai-billing/pricing.ts`.
- `src/lib/billing/plans.ts`: queda SOLO con tipos/validadores (PlanId, PLAN_IDS, isPlanId). Eliminados `PLANS` y `getPlan`.
- Consumidores server a `await`: register, webhook (×2), change-plan, admin/clinics/[id]/usage. checkout y change-plan usan `getResolvedPlan` (mismo monto de cobro). suspended/page, pricing y spec-pricing pasan a async server components con el resolver.
- Legacy alineado: `stripe-subscriptions.ts` pierde `PLAN_PRICES` (299/499/799) + `createSubscription`/`createOxxoPayment` (dead code); `createCheckoutForSubscription` (lo usa admin) usa el resolver. `lib/plans.ts` ya no trae 49/99/249.

**Client (sin precios hardcodeados):** `GET /api/plans` (público) devuelve los planes resueltos; lo consumen `subscription-tab.tsx` y el paso 3 del registro vía fetch. El editor admin recibe los planes como props del server page.

**Editor admin**
- Tab "Precios" → **"Planes"** en `admin/settings/settings-client.tsx`: de solo-lectura a editor (precio mensual/anual, storage en GB, tokens IA, whatsapp, máximos con toggle "Ilimitado", casillas de módulos). `admin/settings/page.tsx` ahora async y pasa `planConfigs`.
- `PATCH /api/admin/plan-config/[planId]`: guard admin existente (cookie admin_token), valida, upsert, invalida caché. Auditoría: config GLOBAL (sin clinicId/userId) → `logAudit` (FK a clinic/user) no aplica; rastro estructurado en logs, igual que el editor de precios de IA.

**Gating de navegación (suave):** `getActiveClinicModuleKeys` ahora también devuelve los módulos del plan habilitados (`features[key] !== false`); en trial o ante fallo → TODOS (fail-open). Se cableó `moduleKey` en items del sidebar: ai-assistant, inbox, whatsapp, marketplace, analytics, reports, landing, tv-modes. Seed: BASIC sin ai-assistant/analytics/tv-modes; PRO/CLINIC con todo. El patient page (otro consumidor) solo lee keys de especialidad → no se afecta.

**Build:** `npx next build` OK — `✓ Compiled successfully`, type-check sin errores (0 errores TS), 276 rutas (`prisma generate` corrido). Los `prisma:error DATABASE_URL` del build son del shell sin env; el resolver los captura y cae al fallback.

**Pendiente Rafael:** aplicar `sql/plan_configs.sql` en Supabase (sin eso, todo corre con el fallback = mismos valores).

**Para Fase 2 (enforcement duro — NO hecho):**
- Bloqueo real en APIs/endpoints por permiso de módulo (hoy solo se oculta del sidebar; las rutas siguen accesibles por URL).
- Enforcement de `maxPatients`/`maxUsers`/storage (hoy solo se guardan/muestran).
- Precio anual: el checkout sigue calculando anual como mensual×meses; cablear `priceMxnAnnual` del DB.
- Landing pública estática: refleja el precio del build; añadir `revalidate` para que un cambio del admin se vea sin redeploy (el checkout SÍ es live).
- Otros precios legacy fuera de alcance T2: `admin/billing` activate_clinic (299/499/799) y `affiliates/stats.ts` (fallback MRR) — solo aplican cuando `clinic.monthlyPrice` es null.

Env nuevas: NINGUNA. SQL nuevo: `sql/plan_configs.sql` (aplicar a mano).

---

## WS2-T4 — "Importar mi clínica": cliente REAL (adaptador) + integración E2E ✅ EN `integ/import-clinic` (NO main, 2026-06-19)

**Objetivo:** reemplazar el `MockImportClient` del wizard por un cliente REAL que habla con las APIs del motor de importación (T1) usando perfiles/plantilla de T2, traduciendo entre los shapes del backend y los de la UI. El wizard ya no inventa cifras: previsualiza e importa de verdad.

**ADAPTADOR, no passthrough.** El backend (`src/lib/import/types.ts` + `entities.ts`) y la UI (`src/components/import/import-client.ts`) usan shapes DISTINTOS a propósito. **No se tocó ninguno de los dos contratos**; el cliente traduce.

**Nuevo: `src/lib/import/client.ts` → `RealImportClient implements ImportClient`**
- `getOrigins()`: `GET /api/import/origins` (backend: id/name/hasProfile/verified/instructions/mapping) **fusionado** con el catálogo local `ORIGINS` de T3 para añadir `color`/`glyph` por id. Si el endpoint falla → cae al catálogo local (el wizard nunca queda sin orígenes).
- `preview(entity,file,mapping)`: POST `dryRun=true` al endpoint de la entidad. **Traduce** `{total,validos,invalidos,duplicados,columns:string[],suggestedMapping,preview[]}` → UI `{totalRows, columns:DetectedColumn[] (header + sugerencia + muestra de la 1.ª fila con valor para ese campo), targetFields (campos canónicos REALES de la entidad), stats:{valid,errors,duplicates}, rows (name/phone/balance + status + motivo de errors/warnings)}`.
- `commit(entity,file,mapping,opts)`: POST `dryRun=false`. Traduce `{created,skipped,duplicates,errors[]}` → UI `{created, errors:errors.length, duplicates, summary, errorReportUrl}`.
- `templateUrl()`: `/api/patients/import/template` (la plantilla de 3 hojas de T2).
- `submitAssisted(file,note)`: POST `/api/import/assisted` → `{ok,ticketId}` (tolera el caso `{ok:true,warning}` = archivo guardado pero ticket no creado → ok:true igual).
- **fetch con timeout** (AbortController) + **errores en español** (red/timeout/HTTP no-ok leyendo `{error,detalle}` del backend).

**Clave de la traducción — `targetFields` = campos canónicos.** Los `value` de cada `<select>` del paso 5 son los campos canónicos REALES de cada entidad (entities.ts), NO las etiquetas del mock (nombre/telefono/saldo):
- patients: firstName · lastName · phone · email · dob · gender · bloodType · address · notes
- balances: name · phone · email · amount
- appointments: name · phone · email · doctor · date · time · type · duration · notes

Así el `columnMapping` que arma la UI (`{header → campo}`) es JUSTO lo que el backend espera, sin reconversión. (Se declaran en client.ts en vez de importar entities.ts porque ese módulo arrastra Prisma = server-only y este cliente vive en el bundle del navegador.)

**Inyección (`import-wizard.tsx`):**
- Cliente por defecto: `new MockImportClient()` → `new RealImportClient()` (se puede seguir inyectando un mock por prop para tests). **Sin tocar** el mount en `patients-client.tsx`.
- **Multi-entidad (paso 3):** `runImport()` ahora importa, EN ORDEN, las entidades elegidas (pacientes → saldos → citas) desde el MISMO archivo. Pacientes primero, para que saldos/citas resuelvan al paciente recién creado. Pacientes usa el mapeo del paso 5; **saldos/citas se autodetectan** (su mapeo no se edita en esta UI → se mandan SIN `columnMapping`). El **resumen se acumula por entidad**. Si una entidad secundaria no tiene columnas en el archivo (no hay "saldo"/"fecha") el backend responde error y esa entidad se **omite** sin abortar el resto; si la PRIMERA falla sin nada importado → toast con el mensaje real + volver al paso 6. La barra "crece" mientras corren los commits reales y se completa SOLO al terminar (no se simula el éxito).

**Migración asistida (`/api/import/assisted`) — revisada: YA estaba completa** (no era TODO vacío): sube el archivo al bucket privado Supabase aislado por `clinicId`, abre ticket de soporte (notifica al equipo + folio #DC-####), adjunta el archivo y deja auditoría. El cliente la consume tal cual.

**Build:** `npm run build` **EXIT 0** — `✓ Compiled successfully`, type-check sin errores (0 TS). Baseline (sin mi código) y build con T4 son idénticos salvo mi módulo: mismos **150** `DATABASE_URL` de prerender sin env (ruido conocido, captado por los resolvers; Skipping linting por config). `prisma generate` corrido por el build.

**Limitaciones / followups (Rafael / próxima ola):**
1. **Resumen de saldos = CONTEO, no suma de dinero.** El diseño muestra "$340,000" en la píldora "en saldos", pero el `CommitResult` del backend devuelve cuántas facturas de apertura creó, no la suma. Hoy se muestra el conteo. Para el monto total, el endpoint de balances tendría que devolver la suma (cambio de backend = fuera de alcance T4).
2. **Una sola hoja por archivo.** El motor (T1) lee solo `worksheets[0]`. La plantilla de 3 hojas (Pacientes/Saldos/Citas) solo importaría la 1.ª hoja por entidad. El multi-entidad funciona perfecto con un archivo PLANO (nombre/tel/saldo/fecha en la misma fila); para hojas separadas el motor tendría que seleccionar hoja por entidad (followup backend).
3. **Muestras del paso 5 solo en columnas mapeadas + filas con error sin nombre crudo.** El backend devuelve `data` por campo canónico (no la fila cruda): las columnas sin mapear no traen muestra y las filas con error de saldos/citas se ven con nº de fila + motivo pero sin el nombre original. (Pacientes —la entidad previsualizada— sí muestra nombre parcial.) Limitación del contrato del backend.
4. **Reporte de errores descargable:** el backend no genera archivo de reporte → `errorReportUrl` queda `undefined`; el wizard muestra los errores en la tabla de revisión + el aviso existente. (TODO de diseño, no bloqueante.)
5. **Tope ~4.5MB en migración asistida** (body serverless de Vercel) ya documentado en el route: archivos 4.5–50MB necesitarían subida directa a storage (signed URL). Pre-existente.

**Pendiente:** QA de Rafael (E2E con un export real de una clínica) + merge a main. **NO mergeado.**

Env nuevas: NINGUNA. SQL nuevo: NINGUNO.

===========================================================================
## QA · import-clinic (revisión adversarial pre-merge a main) [integ/import-clinic @ 01e2fad, 2026-06-20]
===========================================================================
MÉTODO: 6 subagentes en paralelo (adaptador · seguridad/multi-tenant · resolución
de entidades · i18n · UI/UX · código muerto) + build completo. Revisión, SIN tocar
código. Cero P0. Resumen: el aislamiento multi-tenant y el build están sólidos; los
P1 son latentes o de calidad de datos que un export REAL de clínica sí va a tocar.

### Tabla de hallazgos

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| P1 | api/import/assisted/route.ts:64-89 | Subida asistida SIN validar tipo/magic-bytes: acepta cualquier archivo (incl. ejecutables) y lo guarda en el bucket clínico `patient-files` confiando en el MIME (spoofeable). Radio de daño chico (solo lo baja el equipo DaleControl por signed URL), pero es malware-at-rest. | Correr `dangerousExecutable()` sobre los primeros bytes y rechazar; idealmente bucket de cuarentena aparte y nunca `Content-Disposition: inline`. |
| P1 | api/import/assisted/route.ts:103-104,141-148 | Inyecta el path `import-assisted/{clinicId}/...` directo en `SupportMessage.attachments` saltándose `validateAttachmentsMeta` (que exige prefijo `support/{clinicId}/` y bloquea `..`). Seguro HOY (path server-generado), pero rompe el invariante de prefijo por tenant y queda sin backstop. | Aserción `path.startsWith('import-assisted/'+ctx.clinicId+'/')` antes del updateMany, o helper compartido `assertOwnedStoragePath(path, clinicId)`. |
| P1 | lib/import/entities.ts:98-111 (y 493-509) | `commit()` ABORTA el resto del lote ante cualquier error de DB no-P2002 (cada `createMany` de 200 filas es atómico). Un fallo (p.ej. FK P2003 si borran patientId/doctorId entre dry-run y commit) deja importación PARCIAL, 500 genérico y sin reporte por fila. | Ante fallo de slice no-P2002, reintentar fila por fila (o halving) para aislar la mala y marcarla `error`; mínimo capturar P2003 y reportar conteos en `CommitResult.errors`. |
| P1 | lib/import/entities.ts:195-227 | Dedup de pacientes compara teléfono con `parsePhone` crudo (conserva lada/«+»), NO con `last10` como el resolver: el mismo número en dos formatos (`+52 55…` vs `55…`) se importa DOS veces → crea el duplicado que el resolver luego marca «coincide con varios» y bloquea saldos/citas de ese paciente. | Normalizar con `last10` tanto en `seenPhones` como en el query de existencia, consistente con `loadPatientIndex`. |
| P1 | lib/import/client.ts:66-94 → step-mapping.tsx:87 | En el flujo REAL (no solo el mock) las etiquetas del desplegable de mapeo («Nombre», «Apellido», «Teléfono»…) en `CANONICAL_FIELDS` están hardcodeadas en español, fuera de `t()`: en locale EN se ve español en el paso 5. Igual los orígenes «Mi Excel»/«Otro». No rompe función ni el lanzamiento ES-first. | Namespace `shell.importClinic.targetFields.*` y resolver `f.value`→label traducido en el render. |
| P2 | api/import/balances/route.ts:20 ; appointments/route.ts:19 | Sin restricción de rol (el código tiene `TODO(revisar)`): cualquier miembro activo (incl. DOCTOR) puede importar en masa pacientes, saldos (registros financieros) y citas. Intra-tenant, no cross-tenant. | Decidir política; si debe ser ADMIN/RECEPCIONISTA, añadir `requireRole`. |
| P2 | lib/rate-limit.ts:30-32 | Rate-limit en memoria por instancia y por `x-forwarded-for` (spoofeable): freno antispam, no control DoS. | Para rutas de import, keyear por `ctx.clinicId`/`userId` post-auth. |
| P2 | lib/import/entities.ts:62-71 | «Gana el primer eje que matchea»: si el teléfono (compartido en casa, común en MX) coincide con 2 pacientes pero el email con 1, la fila se rechaza como ambigua aunque el email la identifica; nunca cruza que el hit de teléfono y el de email sean el mismo paciente. | Intersectar candidatos por ejes; intersección=1 → resolver; vacía → error «datos en conflicto»; ambiguo solo si un eje da >1 sin que otro lo acote. |
| P2 | lib/import/entities.ts:411-416 | Índice de doctores = TODOS los usuarios activos (sin filtro de rol): una cita puede quedar con `doctorId` de recepción/asistente si el nombre coincide. | Filtrar por rol(es) profesionales como en la agenda. |
| P2 | lib/import/entities.ts:252,347,507 | `createMany({skipDuplicates:true})` es el único backstop de DB: si falta el índice único esperado (`(clinicId,email)`/`(clinicId,phone)`/nº factura) es no-op silencioso; `skipped` no trae motivo por fila. | Confirmar los índices únicos en schema/migraciones. |
| P2 | lib/import/client.ts:184-190 + import-wizard.tsx:125 | Solo se previsualiza `"patients"`; saldos/citas nunca tienen dry-run, así que la tabla del paso 6 y el conteo de «válidos» reflejan SOLO pacientes (el adaptador sí soporta cualquier entidad; el hueco es el wizard). Coincide con followup #3 del T4. | Previsualizar cada entidad elegida, o documentar que la revisión es de pacientes. |
| P2 | lib/import/profiles/*.ts (dentalink:31-32, dentalcore:19-20, gesden:30) | Drift latente INERTE: los perfiles mapean a `fullName`/`rfc`/`balance`, campos que el handler de pacientes no reconoce. Inofensivo hoy (el `mapping` del perfil nunca se usa: `getOrigins` lo descarta y el wizard siembra desde `suggestedMapping`). | Reconciliar `DcField` con los campos reales del handler antes de cablear el mapping del perfil. |
| P2 | globals.css:1051 | `.modal__footer { background: rgba(0,0,0,0.2) }` es tinte negro fijo en ambos temas: en claro ensucia el footer sobre tarjetas `#FFFFFF`. | Token `var(--bg-elev-2)` o override `:root:not(.dark)`. |
| P2 | globals.css:3248 | Tooltip de filas con error (`imp-tip__bubble`) usa `white-space: nowrap` sin `max-width`: motivos largos no envuelven y se recortan en pantallas chicas. | `max-width` + `white-space: normal`/`overflow-wrap`. |
| P2 | step-mapping.tsx:80-86 | (a11y borderline) El `<select>` sin mapear no expone `aria-invalid`/`aria-describedby` (solo color ámbar + badge); el error de subida tampoco se ata al input. No bloqueante (texto de estado legible por AT). | `aria-invalid={unmapped}` en el select; atar el error con `aria-describedby`. |
| P2 | dashboard/import-patients-modal.tsx + es.json/en.json:560 (`shell.importPatients`) | Modal HUÉRFANO (lo reemplaza el wizard; 0 referencias en todo el árbol) y su namespace i18n solo lo consume ese modal. NO es import roto ni botón muerto: Pacientes ya monta `ImportWizard`. | Borrar el archivo y el bloque `importPatients` de ambos diccionarios juntos. |
| P2 | components/import/import-client.ts:200 (`MockImportClient`) | Clase de test sin usar (el resto del módulo SÍ vive: es el contrato de tipos/constantes del wizard). | Dejar como stub de test, o borrar si no habrá harness. |

### Lo que está BIEN (verificado, no inventado)
- **Multi-tenant: impecable.** Los 6 routes exigen sesión (`getAuthContext`→401) antes de trabajar; `clinicId` SIEMPRE sale de `ctx`, NUNCA del body/query/headers (grep = 0 lecturas). Todo insert/select va con `where:{clinicId}`. Cookie de clínica activa con HMAC (timingSafeEqual) + re-chequeo de pertenencia. **Cero P0, cero IDOR.**
- **Validación de spreadsheet fuerte (motor):** magic-bytes, 5 MB, 5000 filas, exceljs (no SheetJS), `columnMapping` saneado contra allow-list, inserts con whitelist de campos (no spread). Sin SSRF.
- **Resolución — el riesgo estrella NO ocurre:** nombre/teléfono/email ambiguos → fila `error`, jamás merge silencioso a «el primero». `process()` es fail-clean por fila; soft-deleted excluidos; migración de saldos idempotente; normalización simétrica.
- **Adaptador:** traduce de verdad (no passthrough); request/response calzan con los 4 routes; `CANONICAL_FIELDS` idéntico a los campos del handler; todo `res.ok` antes de `res.json()` con `.catch(()=>null)`; `getOrigins` degrada al catálogo local; NaN/fechas no se propagan a la UI.
- **i18n:** TODA clave `t()` resuelve en es.json Y en.json (incl. 3 familias dinámicas + plurales); bloques `importClinic` es/en idénticos en estructura; ningún key crudo se renderiza. (El hueco es data sin `t()`, no claves faltantes.)
- **UI/UX:** sin anchos fijos (modal `min(920px,100%)`, grids responsivos, tablas con `overflow-x` contenido); 100% tokenizado light/dark; a11y sólida (Radix Dialog = Esc/focus-trap/restore/`role=dialog`; `:focus-visible` global; dropzones operables por teclado; `aria-live` en progreso; labels asociados).
- **Migración asistida:** ya completa (bucket privado por `clinicId` + ticket #DC-#### + auditoría).
- **BUILD: EXIT 0.** `✓ Compiled successfully`, type-check 0 errores TS, `✓ static pages (280/280)`, 6 rutas de import registradas. Único `⚠` = nota genérica preexistente de edge-runtime. Los ~150 `prisma:error: DATABASE_URL` son ruido conocido de SSG sin env (rutas preexistentes /admin, /[slug]); el build igual cierra EXIT 0. Sin warnings nuevos de import-clinic.

### VEREDICTO
**NO mergeable a `main` productivo TAL CUAL** — no por riesgo de seguridad cross-tenant (no lo hay) ni por el build (verde), sino porque 3 de los 5 P1 los toca un import REAL de clínica el primer día:
1. **entities.ts:195-227** — dedup de teléfono por formato → crea pacientes duplicados (los formatos de teléfono varían entre exports).
2. **entities.ts:98-111** — abort parcial del lote sin reporte → importación a medias y opaca ante un solo error de FK.
3. **assisted/route.ts:64-89** — magic-bytes en asistida (si se va a usar el flujo asistido en prod).

Arreglar esos 3 y re-buildear → **mergeable**. El resto (i18n EN, gating de rol, código muerto, pulido UI, los otros P2) = ola de followup post-merge, NO bloquea.
Si el merge es solo para **preview/QA interno** (no producción): mergeable tal cual, con los P1 anotados como deuda inmediata.

**Pendiente:** decisión de Rafael sobre los 3 P1 + (si aplica) prompt de fix. Reporte sin tocar código; solo este ORQUESTA.md.

===========================================================================
## QA · import-clinic — RE-VERIFICACIÓN independiente [integ/import-clinic @ 01e2fad, 2026-06-21]
===========================================================================
MÉTODO: 12 subagentes (6 dimensiones × review + verificación adversarial — cada hallazgo
se RE-LEYÓ en sus líneas exactas para confirmar / rechazar / ajustar) + build completo
aparte. SIN tocar código. Segunda pasada sobre la QA del 2026-06-20 (`3caff8e`): RATIFICA
sus 5 P1 con evidencia de línea (0 rechazados por el verificador) y suma hallazgos nuevos.
NOTA: la carpeta `design/import-clinic/` que citan los comentarios NO EXISTE en el repo →
no se pudo cotejar contra el prototipo (no se inventaron specs). Cero P0. Cero fuga cross-tenant.

Cruce adversarial: de TODOS los hallazgos (prior + nuevos), 0 rechazados; 1 ajuste de alcance
(MockImportClient) y 1 disputa de severidad (labels i18n: dimensión adapter=P1, dimensión i18n=P2).

### Tabla (▲ = NUEVO vs 2026-06-20 · ✓ = confirma prior)

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| P1 ✓ | lib/import/entities.ts:170,195-223 vs 54,64 | Normalización de teléfono ASIMÉTRICA: dedup-al-insertar compara `parsePhone` crudo (mantiene `+`/lada) mientras el resolver indexa/busca por `last10`. El mismo número en 2 formatos se inserta DOS veces → luego el resolver lo ve como «coincide con varios» y BLOQUEA su saldo/cita. Schema sin `@@unique(clinicId,phone)` (solo `patientNumber`). | Canonizar a `last10` (o E.164) en dedup Y storage; o `@@unique([clinicId, phone_norm])`. |
| P1 ✓ | lib/import/entities.ts:98-111,489-512 | `commit()` SIN transacción entre lotes (createMany por 200). Un error no-P2002 a mitad (p.ej. FK P2003 si borran patient/doctorId entre dry-run y commit) deja import PARCIAL, 500 genérico, sin `logAudit` y sin reporte por fila. | `$transaction` por entidad, o degradar FK a fila `error` en `errors[]`; re-validar FKs dentro de commit. |
| P1 ▲ | api/patients/import/template/route.ts:43 vs entities.ts:267-272 | La plantilla de Saldos trae columna `tipo`(adeudo\|favor), pero el handler NO la lee (no está en `headerVariants`): un saldo «a favor» con monto positivo se importa como ADEUDO → **signo financiero invertido**. Además ignora `apellido` → la resolución por nombre cae solo al teléfono. Lo toca un import real que use la plantilla provista. | Quitar `tipo`/`apellido` de la plantilla, o que el handler combine nombre+apellido y niegue el monto si `tipo=favor`. |
| P1 ✓ | api/import/assisted/route.ts:97,99-104 | Subida asistida SIN magic-bytes: confía en `file.type` y sube cualquier binario (≤50MB) al bucket privado `patient-files` por service-role. La ruta hermana de soporte SÍ valida. Malware-at-rest (solo lo baja staff DaleControl por signed URL → contenido, no cross-tenant). | `dangerousExecutable()/validateMagicNumber` (ya en `validate-upload.ts`) antes de subir; allow-list por firma. |
| P1 ✓ | api/import/assisted/route.ts:94-96,141-148 | Inyecta path `import-assisted/{clinicId}/` en `SupportMessage.attachments` saltando `validateAttachmentsMeta` (exige prefijo `support/{clinicId}/`, bloquea `..`). Seguro HOY (path 100% server-gen, sin input), pero rompe el invariante de prefijo por tenant y el read-path firma sin re-validar. **Latente, NO lo toca un import normal.** | Guardar bajo `support/{clinicId}/`, o `assert path.startsWith('import-assisted/'+ctx.clinicId+'/')` antes del `updateMany`. |
| P1 ✓ (disputado) | lib/import/client.ts:61-94 → step-mapping.tsx:88 | Labels de `CANONICAL_FIELDS` (Nombre/Apellido/Teléfono…) hardcoded en español fuera de `t()`: en locale EN el paso 5 (Mapear) sale en español. Idem orígenes «Mi Excel»/«Otro». Dimensión adapter=P1, dimensión i18n=P2. **NO bloquea: launch ES-first.** | Mover a `shell.importClinic.fields.*` (es/en) y resolver con `t()`. |
| P2 ✓ | api/import/balances:20 ; appointments:19 ; patients/import:23 | Sin gate de rol (`TODO(revisar)`): cualquier miembro activo (incl. DOCTOR) importa en masa saldos (Invoice), citas y pacientes. Intra-tenant, no cross-tenant. | `requireRole(ADMIN/RECEPCIONISTA)` (helper en `auth-context.ts:152`). |
| P2 ✓ | lib/rate-limit.ts:27-51 | Rate-limit en memoria por instancia y por `x-forwarded-for` (spoofable) → freno antispam, no DoS; corre ANTES de auth. | Keyear por `ctx.clinicId`/`userId` post-auth; store compartido (Upstash/Redis). |
| P2 ✓ | lib/import/entities.ts:62-71 | «Gana `sets[0]`»: no intersecta ejes. Teléfono coincide con 2 pero email con 1 → se rechaza ambigua aunque el email la identifica. | Intersectar id-sets; resolver si intersección=1; ambiguo solo si nada sobrevive. |
| P2 ✓ | lib/import/entities.ts:411-416 | Índice de doctores = TODOS los usuarios activos SIN filtro de rol → una cita puede recibir `doctorId` de recepción/asistente por coincidencia de nombre. | Filtrar por rol clínico al armar `byDoctor`. |
| P2 ✓ | lib/import/entities.ts:252,347,506 | `createMany({skipDuplicates})` NO es backstop real: los únicos índices son sobre el número secuencial; **Appointment NO tiene `@@unique` → no-op total**. Toda la idempotencia vive en memoria al dry-run → ventana TOCTOU antes del commit (imports concurrentes/repetidos duplican). | Índices únicos por clave semántica (phone_norm/email; opening-balance; `(clinicId,patientId,startsAt)`); dedup dentro de commit. |
| P2 ✓ | import-wizard.tsx:125 + step-review.tsx:36-63 | Solo `patients` tiene dry-run/preview; saldos y citas se comprometen a CIEGAS (sin pantalla de validación previa). La columna «Saldo» del paso 6 queda siempre «—». | Preview por entidad, o etiquetar el paso 6 como «pacientes». |
| P2 ▲ | lib/import/client.ts:323 + es.json/en.json:751 | El pill de resultado «en saldos / in balances» sugiere un total $ (el mock muestra $340,000) pero el adapter llena un CONTEO de facturas → «12 in balances» se lee como $12. | Cambiar copy a conteo, o que commit devuelva el monto sumado para `formatMoney`. |
| P2 ▲ | lib/import/client.ts:277-291 (adaptPreview) | Lee `b.columns.map`/`b.preview.slice` sin guard de forma; `post()` solo valida `res.ok` + objeto. Un 200 con body no-preview lanza TypeError (lo atrapa el wizard → toast genérico, opaco). Riesgo bajo hoy. | `if(!Array.isArray(b?.columns)||!Array.isArray(b?.preview)) throw …`. |
| P2 ▲ | app/globals.css:955 (.switch) | Track OFF `rgba(255,255,255,0.1)` sin override de tema → en claro el switch apagado es invisible (blanco sobre blanco). Lo usa el toggle «Omitir duplicados». (El más impactful del set cosmético: control sin afordancia OFF.) | Token `var(--bg-elev-2)`/`color-mix` + borde interno. |
| P2 ▲ | components/import/step-upload.tsx:94 | Error de archivo rechazado (tipo/tamaño) no va en `aria-live`/`role=alert` ni atado al dropzone (`aria-describedby`/`aria-invalid`): SR/teclado no se entera. | `role="alert"` + `aria-invalid` + `aria-describedby`. |
| P2 ▲ | components/import/import-wizard.tsx:347 | Modal `width:min(920px,100%)` con overlay propio SIN padding → en móvil la tarjeta toca ambos bordes, sin gutter (el body sí tiene padding interno). | `min(920px, calc(100% - 32px))` o padding lateral en overlay. |
| P2 ✓ | app/globals.css:1051 (.modal__footer) | Tinte negro fijo `rgba(0,0,0,0.2)` en ambos temas → ensucia el footer del wizard sobre tarjeta blanca en claro. (Componente base reusado, afecta todos los modales.) | `var(--bg-elev-2)` o override `:root:not(.dark)`. |
| P2 ✓ | app/globals.css:3248 (.imp-tip__bubble) | `white-space:nowrap` sin `max-width` → motivos de error largos no envuelven y se recortan en pantallas chicas. | `max-width:min(280px,80vw); white-space:normal; word-break:break-word`. |
| P2 ✓ (ajustado) | components/import/step-mapping.tsx:80 | `<select>` sin mapear no expone `aria-invalid`/`aria-describedby` (solo color ámbar + celda de estado). El `<label htmlFor>` SÍ está. (La cláusula prior «upload error» se reasignó a step-upload, arriba.) | `aria-invalid={unmapped}` + `aria-describedby` a la celda de estado. |
| P2 ✓ | lib/import/profiles/*.ts (dentalink:31-32, dentalcore:19-20, gesden:30-31) | `mapping` apunta a `rfc/balance/fullName` que el handler no acepta. **INERTE confirmado 3 vías** (getOrigins descarta `mapping`; el wizard siembra de `suggestedMapping`; `sanitizeMapping` los filtra). | Reconciliar `DcField` antes de cablear `profile.mapping`. |
| P2 ✓ (ajustado) | components/dashboard/import-patients-modal.tsx + es.json/en.json:560 | Modal HUÉRFANO (0 referencias; Pacientes monta `ImportWizard`). NO es import roto. Borrar archivo + bloque `shell.importPatients` (560-600 en AMBOS dicts). | Borrar modal + bloque i18n juntos. |
| P2 ✓ (ajustado) | components/import/import-client.ts:200 | `MockImportClient` muerto (default = `RealImportClient`). **PERO el archivo es load-bearing** (interface/ORIGINS/DATA_TYPES/helpers usados por 9 archivos). AJUSTE al prior «borrar archivo»: borrar SOLO la clase (~195-238) + fixtures `SAMPLE_*`/`TARGET_FIELDS`/`delay`, no el archivo. | Borrar la clase + sus fixtures, o dejar como stub de test. |

**Notas menores (sub-P2, del verificador):**
- **Seguridad:** el `file.name` del cliente se guarda sin sanitizar, pero el render de `/admin/soporte` lo escapa (React text/attrs) → **NO hay stored-XSS** (revisado y descartado, no es hallazgo).
- **Seguridad:** si el paso de ticket falla TRAS subir, queda un blob huérfano en el bucket (higiene, sin impacto de seguridad/tenant).
- **Seguridad:** el tope «50MB» es INALCANZABLE — Vercel corta el body ~4.5MB; backups grandes por este FormData fallan con 413 en plataforma antes del handler. Avisar al dueño del merge.
- **Resolución:** `normName` solo quita UN honorífico al INICIO → «Juan Pérez (Dr.)» / «Pérez, Dr. Juan» no matchean (error de fila limpio, no corrupción).
- **Resolución:** la llave de idempotencia de saldo es el string mágico exacto `'Saldo inicial migrado'` (frágil, sin constraint que lo fuerce).
- **Adapter:** `getOrigins` cae al catálogo local también ante un 200 con array VACÍO (mostraría los 11 orígenes hardcoded en vez de «ninguno»).

### Lo que está BIEN (verificado, no inventado)
- **Multi-tenant: sólido, cero P0/IDOR.** Las 6 rutas exigen sesión antes de trabajar; `clinicId` SIEMPRE de `ctx`, NUNCA del body/query/header (grep = 0 lecturas); todo insert/select/resolución/dedup scopeado por `clinicId`. Cookie de clínica HMAC con fallback que jamás selecciona una clínica ajena.
- **Validación de spreadsheet fuerte (motor):** allow-list xlsx/csv, 5MB, 5000 filas, exceljs (no SheetJS), magic-bytes + bloqueo de ejecutables, `columnMapping` saneado contra allow-list, inserts con whitelist (no spread).
- **Adaptador REAL (no passthrough):** request calza con las 5 rutas; `CANONICAL_FIELDS` IDÉNTICO a los campos del handler en las 3 entidades (0 drift); edge cases (no-ok HTTP, JSON inválido/vacío, NaN, fechas ISO, timeouts/abort) degradan limpio antes de la UI.
- **Resolución fail-clean por fila:** no-match/ambiguo → fila `error`, jamás merge silencioso al «primero»; el batch NO aborta en validación (solo en commit). Email y nombre normalizados de forma simétrica; soft-deleted excluidos.
- **i18n keyed completo:** `shell.importClinic` estructuralmente idéntico es/en (0 claves faltantes a cualquier lado); las ~140 claves `t()` (incl. familias dinámicas step2/step3/steps + plurales ICU) resuelven en ambos idiomas. El hueco es DATA sin `t()`, no claves.
- **UI/UX:** sin anchos fijos (tablas `overflow-x` + `min-width:540`, media queries 680/420px), Radix Dialog (Esc/focus-trap/restore), `:focus-visible` global, `aria-live` en progreso, prefers-reduced-motion. Las roturas de tema viven en componentes base reusados (`.modal__footer`/`.switch`), no en `.imp-*` (que está 100% tokenizado).
- **BUILD: EXIT 0.** `✓ Compiled successfully`, type-check 0 errores, `✓ 280/280` páginas estáticas, 6 rutas de import registradas, sin warnings nuevos (solo el ruido conocido `prisma:error DATABASE_URL` del SSG sin env).

### VEREDICTO
**Ratifica la QA del 2026-06-20: NO mergeable a `main` PROD tal cual** — no por seguridad cross-tenant (no hay) ni por el build (verde). Bloqueadores que un import REAL toca día 1 (todos confirmados línea por línea):
1. **entities.ts:195-223** — dedup de teléfono asimétrico → duplica pacientes y bloquea sus saldos/citas.
2. **entities.ts:98-111** — abort parcial sin transacción ni reporte → import a medias y opaco.
3. **template/route.ts:43** ▲NUEVO — un saldo «a favor» se importa como adeudo (signo invertido) por `tipo` ignorado.
4. **assisted/route.ts:99-104** — magic-bytes en asistida (si se usa el flujo asistido en prod).

Arreglar esos 4 + re-build → **mergeable a PROD.** El resto (assisted path-prefix latente, i18n EN, gating de rol, idempotencia/índices únicos, código muerto, pulido UI y demás P2) = ola de followup, NO bloquea.
Para **preview/QA interno** (no producción): mergeable tal cual con los P1 anotados como deuda inmediata.

**Pendiente:** decisión de Rafael sobre los 4 P1 + (si aplica) prompt de fix. Reporte sin tocar código; solo este ORQUESTA.md.

===========================================================================
## QA · import-clinic — FIX de P1 aplicado [integ/import-clinic, 2026-06-21]
===========================================================================
Se implementaron los 3 P1 bloqueantes del scope de Rafael + 3 quick-wins. **Build EXIT 0**
(`✓ Compiled successfully`, type-check 0 errores, `✓ 280/280` páginas, 6 rutas de import
registradas, sin warnings nuevos — solo el ruido conocido `prisma:error DATABASE_URL` del SSG).

### Estado de los hallazgos tras el fix

| # | Hallazgo (QA 2026-06-21) | Estado | Qué se hizo |
|---|--------------------------|--------|-------------|
| P1 | entities.ts — dedup de teléfono asimétrico | ✅ RESUELTO | `process()` de pacientes deduplica por `last10(phone)` en archivo Y contra DB (carga el padrón y normaliza, sin `IN` crudo), igual que `resolvePatient`/`loadPatientIndex`. |
| P1 | entities.ts/engine.ts — commit aborta el lote ante error ≠ P2002 | ✅ RESUELTO | Nuevo `insertSliceByRow`: si un `createMany` de slice falla con algo distinto a P2002 (p. ej. FK P2003), reintenta fila por fila, inserta las válidas y marca SOLO la mala como `error` (fluye al reporte por fila). Aplicado a pacientes/saldos (`insertNumbered`) y a citas (commit propio). `skipped` ya descuenta las filas en error. Sin import parcial + 500 genérico. |
| P1 | assisted/route.ts — sin veto de ejecutables | ✅ RESUELTO | Nuevo `detectDangerousExecutable()` (reusa `dangerousExecutable` de `validate-upload.ts`): lee los primeros bytes y rechaza MZ/ELF/Mach-O con **400** ANTES de subir. Acepta el resto (xlsx/csv/zip/sql/txt). |
| P2 | client.ts — labels de `CANONICAL_FIELDS` hardcoded en español | ✅ RESUELTO | `TargetField.labelKey` + claves `shell.importClinic.fields.*` (es/en); `step-mapping.tsx` renderiza `t(f.labelKey)`. El paso 5 ya respeta el idioma activo. |
| P2 | código muerto: modal huérfano + i18n `importPatients` | ✅ RESUELTO | Borrado `src/components/dashboard/import-patients-modal.tsx` + bloque `shell.importPatients` en ambos diccionarios (grep = 0 referencias). |
| P2 | gating de rol en /balances y /appointments | ✅ RESUELTO | `requireRole(ctx, "ADMIN", "RECEPTIONIST")` en ambas rutas (SUPER_ADMIN incluido por el helper); el DOCTOR ya no importa saldos/citas en masa. |

### 🔴 SIGUE ABIERTO (NO estaba en el scope de este fix)
- **P1 ▲ template/route.ts:43 — `tipo`(adeudo\|favor) ignorado → un saldo «a favor» se importa como ADEUDO (signo invertido).** Este era el 4.º bloqueador de la QA y **NO se tocó** (Rafael pidió 3 P1). **⇒ El gate de PROD NO está 100% verde aún:** un import real que use la columna `tipo` de la plantilla de Saldos mete el signo equivocado. Decidir: quitar `tipo`/`apellido` de la plantilla, o que el handler los honre.
- **Gating de rol en `/api/patients/import`**: se dejó solo-sesión a propósito (el scope #6 fue saldos+citas). Si pacientes también debe ser ADMIN/RECEPCIONISTA, es un cambio de 2 líneas.
- **P2 de followup** (no bloquean): assisted path-prefix latente, rate-limit por XFF, no-intersección de ejes, índice de doctores sin filtro de rol, `skipDuplicates`/índices únicos (TOCTOU), preview solo-pacientes, label conteo-vs-$ en saldos, guard de `adaptPreview`, switch OFF invisible en claro, error de upload sin `aria-live`, modal sin gutter móvil, tinte `.modal__footer`, tooltip `nowrap`, orígenes «Mi Excel»/«Otro» sin `t()`.

### VEREDICTO actualizado
3/4 bloqueadores resueltos + build verde. **Para preview/QA interno: listo.** Para **PROD**, falta cerrar el P1 del signo de saldos (`template tipo`) o documentar que la plantilla de Saldos NO debe usar la columna `tipo` (usar monto negativo para «a favor»). Pendiente QA de Rafael con un export real.
