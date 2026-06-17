═══════════════════════════════════════════════════════════════════════════
## NOM-RLS — RLS deny-all FALTANTE (portal paciente + IA recetas + labs B2B) ✅ EN RAMA feat/nom-rls (56b1e9f, 2026-06-17) · NO en main
═══════════════════════════════════════════════════════════════════════════
QUÉ SE HIZO: cierra AC-10 / AC-14 y el gap #26 del audit
docs/compliance/NOM024_AUDIT_2026-06-17.md (Área 9 — Control de acceso). Habilita
RLS + policy RESTRICTIVE deny-all a (anon, authenticated) en las 16 tablas que hoy
NO la tenían. Base legal: LFPDPPP art. 19 + NOM-024-SSA3-2012 §6.3.2. Defense-in-
depth: una fuga del anon key ya NO expone passwordHash/tokenHash del portal del
paciente ni los datos del módulo de laboratorios vía PostgREST. El service role
bypassa RLS por diseño → la app (Prisma server-side) sigue igual; estas policies
son inertes para el cliente.

PATRÓN (idéntico a sql/rls-deny-all-policies.sql): helper público
_apply_deny_all_rls(text) → ALTER TABLE ... ENABLE ROW LEVEL SECURITY + CREATE
POLICY <tabla>_deny_anon AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false), sólo si no existe; envuelto en EXCEPTION WHEN
undefined_table; DROP FUNCTION al final. Idempotente y re-ejecutable.

TABLAS CUBIERTAS (16):
- Portal del paciente (3): patient_accounts, patient_account_links,
  patient_account_sessions   (def. sql/patient-portal.sql)
- IA de recetas (1): prescription_ai_checks   (def. sql/prescription-ai-check.sql;
  OJO: el nombre real es PLURAL — el audit lo nombraba "prescription_ai_check")
- Laboratorios B2B (12): dental_labs, dental_lab_users, dental_lab_services,
  dental_lab_orders, dental_lab_order_events, dental_lab_order_files,
  dental_lab_traffic_history, dental_lab_bank_accounts, dental_lab_fiscal_data,
  dental_lab_invoices, dental_lab_chat_threads, dental_lab_chat_messages
  (def. sql/laboratorios.sql / Prisma @@map, verificado 1:1)

ALCANCE EXTENDIDO (+2 sobre el gap #26, deliberado): patient_account_links (mismo
cluster de PII: mapea cuenta↔paciente↔clínica) y el padre dental_labs (datos del
lab + mpAccessToken de b2b-payments.sql). Dejar hermanos del mismo archivo sin RLS
contradecía el objetivo. Verificado contra TODOS los sql/*.sql: ninguna de las 16
tenía RLS previa (ai-billing, afiliados, supplier, quotes, etc. ya cubren las suyas).

ARCHIVOS (1, +112): sql/nom-rls-missing.sql (NUEVO). NO toca schema.prisma ni rutas.

SQL A APLICAR (a mano, Supabase SQL editor, tras revisar la rama):
  → sql/nom-rls-missing.sql
La verificación viene al pie del archivo (debe devolver 16 filas con
policyname LIKE '%_deny_anon').

BUILD: npx next build (sin pipes), EXIT 0, ✓ Compiled successfully, 276/276 páginas.
(El build es sólo confirmación de no-regresión: sql/ no se compila; cero cambios de código.)

RAMA: feat/nom-rls (commit SQL 56b1e9f). NO mergeada a main. Sin envs nuevas.
QA (Rafael): aplicar el SQL en Supabase; confirmar que portal del paciente, bot de
IA de recetas y módulo de labs siguen operando (van por service role) y que la
query de verificación devuelve 16 policies.

═══════════════════════════════════════════════════════════════════════════
## [NOM-CONSERVACION] Anti-hard-delete / conservación (NOM-004 / NOM-024 §7) ✅ rama feat/nom-conservacion — NO main (2026-06-17)
═══════════════════════════════════════════════════════════════════════════
QUÉ SE HIZO: cierra Ola 1·fila 1 del audit (docs/compliance/NOM024_AUDIT_2026-06-17.md):
RX-11, RX-06, RET-01, RET-12. El borrado FÍSICO del expediente se sustituye por
anulación/borrado LÓGICO con motivo + preservación. Ningún DELETE destruye ya
recetas, radiografías, modelos 3D, ni el expediente al "eliminar" una clínica.

CAMBIOS:
1) Receta (RX-11/RX-06) — api/prescriptions/[id]/route.ts: DELETE ya NO hace
   prisma.delete; ANULA (status=VOIDED + voidedAt + voidedBy + voidReason),
   idempotente, motivo opcional { reason } en el body. Se quitó el bloqueo por
   cofeprisFolio (anular ≠ destruir).
   · Verificación pública (el QR sigue resolviendo, muestra "ANULADA"):
     api/prescriptions/[id]/verify/route.ts (valid=!expired && !voided; isVoided +
     voidReason) y portal/prescription/[id]/verify/page.tsx (banner rojo "⛔ Receta
     ANULADA — no debe ser surtida" + motivo; oculta botón Descargar PDF).
   · Anuladas ocultas de listas ACTIVAS (where status:"ACTIVE"): prescriptions/
     route.ts, paciente/recetas, patients/[id]/timeline, patients/[id]/export,
     patients/[id]/export-cda. El backup db-export NO se filtra (conserva todo).
2) Radiografías + Modelos 3D (RET-01) — soft-delete de PatientFile:
   api/xrays/[id]/route.ts y api/patients/[id]/models-3d/[fileId]/route.ts (DELETE)
   ya NO borran blob de Storage ni fila → marcan deletedAt/deletedBy/deleteReason;
   el blob se CONSERVA. Filtro deletedAt:null en vistas activas: xrays/route.ts,
   dashboard/xrays/[patientId]/page.tsx, patients/[id]/timeline, patients/[id]/
   models-3d/route.ts, patients/[id]/export, dashboard/home/doctor (count).
3) Clínica (RET-01/RET-12) — api/admin/clinics/[id]/route.ts: DELETE ya NO hace
   prisma.clinic.delete (CASCADE que destruía pacientes/recetas/radiografías/
   bitácora) ni borra Storage. ARCHIVA: archivedAt + archivedBy(=IP) + archiveReason
   + isPublic=false + landingActive=false. El expediente y los archivos se CONSERVAN.
   Roster admin (admin/clinics/page.tsx) filtra archivedAt:null. Guard "única
   clínica" ahora cuenta solo activas.
4) Bitácora — lib/audit.ts: AuditAction y logMutation aceptan void|soft_delete|
   archive; preservan before + after (con el motivo).

SCHEMA (prisma/schema.prisma) — aditivo (nullable salvo status):
- Prescription: status @default("ACTIVE"), voidedAt, voidedBy, voidReason
- PatientFile:  deletedAt, deletedBy, deleteReason + @@index([clinicId, deletedAt])
- Clinic:       archivedAt, archivedBy, archiveReason

SQL A APLICAR (a mano, tras desplegar): sql/nom-conservacion.sql — idempotente
(ADD COLUMN / CREATE INDEX IF NOT EXISTS), cero DROP. prescriptions.status NOT NULL
DEFAULT 'ACTIVE' (filas viejas → ACTIVE, siguen visibles). ⚠️ aplicar junto al
deploy (feature en main sin su SQL = outage en tabla core).

BUILD: npx next build (sin pipe) → EXIT 0, ✓ Compiled successfully, type-check OK,
276/276 páginas. prisma generate OK (cliente compartido por junction). Los
prisma:error DATABASE_URL son del prerender sin DB en este entorno (igual que main).

MULTI-TENANT: sin cambios; clinicId siempre de la sesión en cada query.

PENDIENTE / FOLLOW-UPS (fuera de esta tarea):
- PDF de verificación (lib/pdf/prescription-pdf.ts) no estampa "ANULADA" aún → por
  eso se oculta el botón Descargar PDF en recetas anuladas.
- Clínica archivada sale del directorio público (isPublic=false) y del roster admin,
  pero NO se filtra de crons ni de ~30 clinic.findMany restantes; evaluar en QA.
- Falta UI para capturar el motivo al borrar (hoy { reason } es opcional en el body).
- No hay "desanular"/restaurar desde UI (reactivar = poner el campo a null).
- QA: anular receta→QR ANULADA; borrar rx/3D→desaparece pero el blob persiste;
  archivar clínica→el expediente persiste.

RAMA: feat/nom-conservacion (worktree mediflow-worktrees/nom-conservacion). NO main.
═══════════════════════════════════════════════════════════════════════════
## NOM-BITACORA — Bitácora de auditoría INMUTABLE + auditar mutaciones/lecturas (NOM-024 §6.3.5) 🟡 EN RAMA feat/nom-bitacora (NO main, 2026-06-17)
═══════════════════════════════════════════════════════════════════════════
Cierra los gaps #7, #8, #9 y #10 de la auditoría NOM-024
(docs/compliance/NOM024_AUDIT_2026-06-17.md, Área 4 AUD-2..AUD-5). NO toca main.
Build VERDE (npx next build, sin pipes), EXIT 0.

QUÉ SE HIZO:
1) INMUTABILIDAD (gap #7 / AUD-2) — SQL nuevo a aplicar a MANO: sql/nom-audit-immutable.sql.
   Trigger BEFORE UPDATE OR DELETE en audit_logs que lanza excepción → la tabla queda
   APPEND-ONLY (solo INSERT). Idempotente.
2) FK clinics→audit_logs CASCADE → RESTRICT (gap #8 / AUD-3) — en el mismo .sql. Borrar una
   clínica con bitácora ahora FALLA en vez de destruir el rastro. El DO-block localiza la FK
   existente por catálogo (nombre auto-generado variable) y la recrea como
   audit_logs_clinicId_fkey ON DELETE RESTRICT. Idempotente. También se actualizó
   prisma/schema.prisma (AuditLog.clinic onDelete Cascade→Restrict) para que el ORM no
   reintroduzca CASCADE en un futuro db push. NO cambia el client generado.
3) DEJÓ DE BORRAR LA BITÁCORA (gap #8 / AUD-3) — src/app/api/cron/retention/route.ts: se
   eliminó el bloque auditLog.deleteMany (>7 años), su entrada en summary (auditLogsDeleted)
   y la var sevenYearsAgo. El resto del cron (anonimización inbox >2a y arco >5a por clínica)
   queda INTACTO. El archivado WORM off-site lo sigue haciendo el cron db-export (no se toca).
   JSDoc actualizado.
4) AUDITAR MUTACIONES antes sin registro (gap #9 / AUD-4) — logMutation de @/lib/audit,
   clinicId/userId SIEMPRE de sesión (getAuthContext), nunca del body:
   - treatments POST (crear plan)  → entityType "treatment", create.
   - treatments/[id] PATCH (add_session, cambio de estado, edición general) y DELETE.
   - periodontal POST (crear registro) → entityType "periodontal" (nuevo en el union).
   - body-map POST (crear anotación)   → entityType "body-map" (nuevo en el union).
5) AUDITAR LECTURA del expediente (gap #10 / AUD-5) — src/app/dashboard/patients/[id]/page.tsx:
   al abrir el detalle del paciente se registra logAudit action "view", entityType "record",
   entityId = patientId, con IP/UA vía headers(). Mismo patrón que el read-log ya existente
   en /api/records GET.
   NO se tocó clinical-notes/route, clinical/route ni appointments/[id]/complete (otra terminal).

ARCHIVOS (8 modificados + 1 nuevo):
- sql/nom-audit-immutable.sql              (NUEVO — aplicar a mano en Supabase)
- prisma/schema.prisma                     (AuditLog.clinic onDelete → Restrict + comentario)
- src/app/api/cron/retention/route.ts      (−auditLog.deleteMany; summary y JSDoc ajustados)
- src/app/api/treatments/route.ts          (audit POST)
- src/app/api/treatments/[id]/route.ts     (audit PATCH ×3 + DELETE)
- src/app/api/periodontal/route.ts         (audit POST)
- src/app/api/body-map/route.ts            (audit POST)
- src/app/dashboard/patients/[id]/page.tsx (audit READ del expediente)
- src/lib/audit.ts                          (+entityType "periodontal" | "body-map")

🔴 SQL A APLICAR A MANO (Supabase SQL Editor, NO prisma migrate):
   sql/nom-audit-immutable.sql — trigger append-only + FK RESTRICT. Idempotente.
   ⚠️ CONSECUENCIA ESPERADA tras aplicar: borrar una clínica que tenga audit_logs fallará
   (FK RESTRICT). Es el comportamiento NOM-024 correcto; el flujo "eliminar clínica" del
   /admin (admin/clinics/[id]) deberá archivar/desligar la bitácora antes de borrar →
   followup separado, fuera de esta terminal.

BUILD: npx next build (worktree; node_modules vía junction al repo principal; SIN pipes).
   ✓ Compiled successfully · type-check sin errores · ✓ Generating static pages (276/276) ·
   EXIT 0. Los prisma:error DATABASE_URL son del prerender sin DB en este entorno y NO
   afectan el exit (patrón conocido). Rutas tocadas presentes en el manifest como ƒ.

RAMA: feat/nom-bitacora (worktree mediflow-worktrees/nom-bitacora). NO mergear a main sin QA.

QA (Rafael):
- Aplicar sql/nom-audit-immutable.sql en Supabase; verificar trigger + FK (queries al pie del
  .sql). Probar que un UPDATE/DELETE manual a audit_logs FALLA.
- Crear/editar/borrar un plan de tratamiento, un registro periodontal y una anotación de
  body-map, y abrir un expediente → confirmar filas nuevas en audit_logs (acción correcta,
  clinicId de la clínica activa, IP/UA en la lectura).
- Confirmar que el cron de retención ya NO reporta auditLogsDeleted ni borra bitácora.

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
