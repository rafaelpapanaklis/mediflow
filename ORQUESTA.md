═══════════════════════════════════════════════════════════════════════════
## BILLING-EMAILS-MERGE — Correos de billing → MAIN ✅ (2026-06-29)
═══════════════════════════════════════════════════════════════════════════
MERGE: d50b28fe (`--no-ff` de feat/billing-emails @ 8708ac17 sobre main f52400dd) · BUILD EXIT 0
(✓ Compiled successfully). 0 conflictos: sin solapamiento de archivos (main solo había tocado 3
componentes UI del DateField; la rama toca email.ts/webhook/schema/sql/ORQUESTA). Pusheado a
origin/main → Vercel auto-deploy. SQL `sql/billing-email-log.sql` YA aplicado en Supabase (aparte).
Sin envs nuevas. Detalle de la feature ↓.

═══════════════════════════════════════════════════════════════════════════
## ONBOARDING-EMAILS — Correos "plan activado" (1er pago) + "plan renovado" (Resend) ✅ (2026-06-29) · rama feat/billing-emails → MERGEADA a main
═══════════════════════════════════════════════════════════════════════════
COMMIT: dd014101 · MERGE a main: d50b28fe (29-jun) · BUILD EXIT 0 (✓ Compiled successfully, sin warnings).
SQL billing-email-log.sql YA aplicado. QA: validar con pago de prueba real en prod (que llegue el correo).

OBJETIVO: 2 correos branded (mismo estilo dark que sendWelcomeEmail) disparados desde el
webhook de Stripe:
  A) "Plan activado"  — cuando la clínica COMPLETA su 1er pago.
  B) "Plan renovado"  — en cada renovación del ciclo.

HELPERS (src/lib/email.ts):
  - sendPlanActivatedEmail({ email, firstName?, clinicName, planName, dashboardUrl })
      HTML dark + texto plano. Felicita, badge "Suscripción activa", CTA → SITE_URL/dashboard,
      4 primeros pasos (paciente, agenda WhatsApp, RFC/CFDI, equipo), soporte@dalecontrol.com.
  - sendPlanRenewedEmail({ email, firstName?, clinicName, planName, amountPaid, currency,
      nextBillingDate?, receiptsUrl })
      Tono recibo: tabla Plan / Monto cobrado / Próximo cobro + CTA → recibos
      (/dashboard/settings?tab=subscription).
  - Utils privados: formatBillingMoney (Intl currency, fallback "$X CUR") y formatBillingDate
      (fecha larga es-MX; devuelve null si Invalid Date — Intl.format LANZA con fechas inválidas).

ENGANCHE (src/app/api/webhooks/stripe/route.ts · case invoice.paid / invoice.payment_succeeded):
  - Sección de correos AL INICIO del case, ANTES del `break` por afiliado (~L343) → llega a
    TODAS las clínicas, no solo a las referidas (ese break temprano era el riesgo).
  - UN solo lookup de clínica (select ampliado): id, name, email, plan, nextBillingDate,
    users (SUPER_ADMIN activo más antiguo: email+firstName) + affiliateId/affiliate (lo previo).
  - Distingue por invoice.billing_reason: subscription_create → A; subscription_cycle → B;
    resto → ignora. Destinatario = owner.email ?? clinic.email; si no hay, omite sin romper.
  - planName desde PLAN_MARKETING (Básico/Profesional/Clínica). SITE_URL = NEXT_PUBLIC_SITE_URL.
  - Próxima fecha (B): invoice.lines.data[0].period.end, fallback clinic.nextBillingDate.
  - Fire-and-forget (.catch(()=>{})) + try/catch de toda la sección → no bloquea el 200 ni
    la lógica de afiliado (que queda INTACTA).

IDEMPOTENCIA: model BillingEmailLog (@@map "billing_email_logs"; invoiceId @unique; @@index clinicId).
  El INSERT de la fila ÚNICA por invoiceId es el candado atómico: solo el 1er evento gana y envía;
  el 2.º (Stripe dispara invoice.paid + invoice.payment_succeeded para la misma factura) cae en
  P2002 → no reenvía. Si la tabla aún no existe (pre-SQL) o el guard falla → NO envía (no rompe).

SQL PENDIENTE (NO aplicado — lo pega Rafael en Supabase):
  sql/billing-email-log.sql → CREATE TABLE "billing_email_logs" + UNIQUE(invoiceId) +
  INDEX(clinicId) + RLS deny-all. Aditivo e idempotente.

ARCHIVOS: src/lib/email.ts (+195), webhook route (+91), prisma/schema.prisma (+17),
  sql/billing-email-log.sql (nuevo). 4 files, +303.

PENDIENTE RAFAEL: (1) aplicar sql/billing-email-log.sql; (2) QA = pago de prueba real y
  confirmar que llega el correo; (3) merge a main tras QA OK.

═══════════════════════════════════════════════════════════════════════════
## SEC-FAILBAN-FIX — Rate-limit (anti-flood) ≠ lockout (anti-fuerza-bruta) ✅ (2026-06-23) · rama feat/sec-failban (NO main)
═══════════════════════════════════════════════════════════════════════════
COMMIT: 67f114a2 · BUILD EXIT 0 (✓ Compiled successfully; solo el ruido conocido
prisma:error DATABASE_URL del SSG sin env). NO mergeado a main: pendiente review + QA.

PROBLEMA (QA): en /api/admin/auth el persistentRateLimit era { limit: 3, windowSec: 15min },
que disparaba al 4.º request — ANTES del lockout (threshold 5). El usuario veía "Demasiados
intentos" al 4.º fallo y el lockout con backoff nunca llegaba a actuar. Rate-limit (anti-flood)
y lockout (anti-fuerza-bruta) se estaban solapando.

DECISIÓN / DISEÑO:
  - El rate-limit (persistentRateLimit, por IP, ventana deslizante) es ANTI-FLOOD: generoso.
    Un humano que se equivoca de contraseña NO debe chocar con él.
  - La fuerza bruta la controla el LOCKOUT (failbanGuard + recordAuthFailure): threshold 5 /
    15min con backoff exponencial (60s → 30min). Ese es el que bloquea (al 5.º fallo).
  - Invariante: rate-limit.limit >> lockout.threshold (5) → el lockout corta SIEMPRE primero en
    el camino de fallos; el rate-limit solo frena ráfagas/DoS que NO cuentan como fallo.
  - Constante compartida nueva en src/lib/failban.ts (documentada para no volver a bajarla):
      export const AUTH_FLOOD_RATE_LIMIT = { limit: 15, windowSec: 60 };  // 15/60s

LÍMITES NUEVOS POR ENDPOINT (rate-limit anti-flood → quién corta primero):
  - /api/admin/auth        3/15min → 15/60s | lockout 5/15min | + delay 1s anti-bruteforce (conservado)
  - /api/paciente/login    8/60s   → 15/60s | lockout 5/15min
  - /api/paciente/verify   10/60s  → 15/60s | lockout 5/15min (+ gate DB verifyAttempts)
  - /api/auth/register     5/60s   → 15/60s | lockout 5/15min (por IP)
  - /api/auth/check-email  10/60s  → 15/60s | lockout 60/15min (CHECK_EMAIL_POLICY, anti-enumeración)
  - /api/auth/login-attempt 30/60s (SIN cambio) | lockout 5/15min
        → se deja en 30: cada intento de login llama este endpoint varias veces
          (check + fail/success); 30 sigue MUY por encima del threshold 5.

RESULTADO ESPERADO (admin): fallos 1–4 → "Contraseña incorrecta"; 5.º fallo → lockout y desde
ahí 429 con Retry-After (backoff creciente). Coherencia verificada en el resto: el rate-limit ya
no corta antes que el lockout en ningún endpoint de credenciales.

NOTA check-email: su lockout es 60/15min (anti-enumeración, no es "5 strikes"). Ahí rate-limit
(15/60s, anti-ráfaga) y lockout (60/15min, anti-escaneo sostenido) son capas COMPLEMENTARIAS, no
solapadas — no hay UX de backoff por contraseña que romper.

ARCHIVOS: src/lib/failban.ts (constante) + los 6 routes. 7 files, +41/-15.

🔴 PENDIENTE DE RAFAEL:
  - Review + QA del flujo (idealmente con Upstash configurado para probar la persistencia real;
    sin UPSTASH_* el failban cae a memoria por instancia — degradado pero funcional).
  - Merge a main SOLO tras QA OK.

═══════════════════════════════════════════════════════════════════════════
## IMPORT→MAIN — Integración a main: import (fix UX mapeo) + saldo a favor + buscador ✅ EN MAIN (2026-06-22)
═══════════════════════════════════════════════════════════════════════════
OBJETIVO: dejar en main (producción) DOS arreglos de forma segura — el wizard
"Importar mi clínica" (con fix UX del mapeo) y el buscador de pacientes por nombre
completo. Build EXIT 0 por paso; main intacto ante cualquier fallo.

FIX UX DEL MAPEO (commit bd888a5d · src/components/import/import-wizard.tsx):
  El paso 5 (Mapear) y 6 (Revisar) asumían SIEMPRE la entidad "patients": el
  preview se pedía fijo con "patients", así que al importar solo Saldos/Citas el
  dropdown ofrecía campos de paciente y Revisar salía en 0/duplicados.
  - principalEntity = primera entidad elegida en el paso 3 (prioridad pacientes >
    saldos > citas; el orden de DATA_TYPES ya lo refleja).
  - El preview del paso 5 se pide con principalEntity → targetFields =
    CANONICAL_FIELDS[principalEntity] (Saldo→Monto, Tipo, Concepto…); el paso 6
    muestra montos/estado reales de esa entidad.
  - runImport aplica el mapeo del paso 5 a la entidad PRINCIPAL (no solo a
    pacientes); las demás se autodetectan. Commit multi-entidad intacto.
  - Volver al paso 3 y cambiar la selección invalida preview/mapeo (evita
    arrastrar un mapeo de paciente a un commit de saldos).

ORDEN DE INTEGRACIÓN (ajuste seguro vs. el plan): la rama fix/patient-search-
  fullname NO era aislada — su historia es main (e60679cd) + 1 commit del buscador.
  Mergearla tal cual habría arrastrado todo NOM-024 y dado los conflictos schema/
  i18n EN el paso del buscador (al revés del plan). Por eso INVERTÍ el orden:
  primero traje main a integ, luego el buscador (que así aporta solo patients/
  route.ts). Resultado final idéntico al objetivo.

FUSIONADO EN integ/import-clinic:
  1) fix UX mapeo → bd888a5d (build EXIT 0).
  2) merge origin/main (e60679cd) → be6db6e8. Auto-fusión (ort) SIN conflictos;
     verifiqué la UNIÓN a mano: schema conserva PatientCredit Y NOM-024
     (archivedAt/deletedAt/AuditLog); es/en.json conservan importClinic.*
     (fields.amount, step6.kindCredit) Y claves NOM; JSON válido. Build EXIT 0.
  3) merge --no-ff fix/patient-search-fullname → e7940d99. Limpio: solo
     patients/route.ts (búsqueda v2 por tokens — cada token matchea en algún campo
     → encuentra por nombre completo) + ORQUESTA.md. Build EXIT 0.
  Push integ: 11d9f92f..e7940d99.

MERGE A MAIN: git merge --no-ff integ/import-clinic → b19de73e. main era ancestro
  de integ → SIN conflictos. Build (prisma generate && next build) EXIT 0 · Compiled
  successfully · 279/279 páginas · rutas /api/patients/import y /dashboard/patients
  en el manifest. Push origin main: e60679cd..b19de73e (Vercel auto-deploy).
  Reemplaza el modal viejo import-patients-modal.tsx.

NOTAS: sql/patient-credits.sql YA está aplicado en Supabase (sin acción). design/
  (prototipo local untracked/ignored) NO se tocó. Los prisma:error DATABASE_URL son
  del prerender sin DB (patrón conocido), no fatales.
ESTADO: main = import + saldo a favor + buscador. ✅

===========================================================================
## WS2-T3 - "Importar mi clinica": wizard de migracion (UI, cliente mock) [feat/import-wizard-ui, 2026-06-18]
===========================================================================
QUE SE HIZO: traduje el prototipo design/import-clinic/ a componentes reales del
panel (Next.js 14 App Router, TS). Wizard completo navegable con datos SIMULADOS
(sin backend). Lanzador en la pagina de Pacientes + estado vacio mejorado.
## WS2-T6 — Visor 3D: auto-ventana por histograma + presets de densidad (CBCT sin HU fijos) ✅ EN RAMA feat/viewer-auto-window (9d56e318, 2026-06-22) · NO main
═══════════════════════════════════════════════════════════════════════════
Ramificada de main (e60679cd). OWNERSHIP estricto: `src/components/patient-3d/Dicom3DVolume.tsx` y NADA más.

**Problema**
El CBCT no entrega Hounsfield (HU) estables: dos tomógrafos —o dos exposiciones— asignan números
distintos al MISMO hueso. Por eso la ventana/umbral FIJOS del render volumétrico (`u_clim=[0.12,0.9]`,
iso 0.36, slider 0.12–0.6) no caían exactos en todos los estudios y el volumen salía mal contrastado.

**Solución (auto-ventana en gray values RELATIVOS, no HU)**
Sobre la normalización p1/p99 que YA existía (estira el rango real del estudio a 0–255), ahora se
construye el histograma de 256 bins EN LA MISMA pasada de escritura (sin 2.º barrido) y de él se
localizan los 3 hitos de densidad del propio estudio:
- `gAir`  = frontera aire/fondo ↔ cabeza  → **Otsu** global (libre de parámetros, se adapta solo).
- `gBone` = frontera tejido blando ↔ hueso → **Otsu** dentro de la cabeza (bins > gAir).
- `gHi`   = techo de densidad útil          → **percentil 99.5** (ignora metal/artefacto).
Con orden garantizado y separaciones mínimas (la ventana nunca colapsa).

**Qué se ve ahora**
- **Auto-contraste por defecto:** al cargar, iso + ventana se fijan al preset `bone` derivado de los
  hitos → hueso/diente nítido sin tocar nada.
- **Presets de densidad** (botones "Densidad: Hueso · Tejido · Aire"), todos RELATIVOS al estudio:
  · Hueso → iso=gBone, ventana=[medio(gAir,gBone), gHi] (superficie ósea con relieve / defecto).
  · Tejido → iso apenas dentro de la piel (30% gAir→gBone) → envolvente facial; ventana abierta.
  · Aire → iso casi en la piel + ventana baja [0, medio] → resalta cavidades (senos / vía aérea).
- **Slider "Umbral" data-driven:** min/max/step salen de los hitos (no 0.12–0.6 fijos); afina iso
  dentro del preset. El preset también mueve el thumb (sincronizado).
- En MIP la ventana del preset también aplica (el colormap usa `u_clim`).

**Se conservan intactos:** ray casting `VolumeRenderShader1`, colormap óseo (marrón→marfil), toggle
MIP/Sólido, render bajo demanda y la robustez ante pérdida de contexto WebGL.

**Implementación (1 archivo)**
- Helpers a nivel de módulo: `clamp`, `lerp`, `otsuBin`, `computeAutoWindowFromHist` (→ `AutoWindow`),
  `FALLBACK_WINDOW` (= comportamiento fijo anterior, para estudio plano / antes del 1.er cálculo).
- Estado/refs nuevos: `preset`+`presetRef`, `auto`+`autoRef` (límites de UI / acceso a handlers sin
  closure obsoleto), `climRef` (la ventana ahora es ref pura). `u_clim` se empuja al shader CADA frame
  desde `climRef` (init + loop), igual patrón que iso/estilo.
- `applyPreset(key)` reubica iso+ventana, sincroniza slider y pide un cuadro; NO re-ejecuta el efecto
  pesado del visor.

**Build:** `npx next build` → **EXIT 0**. `✓ Compiled successfully`, type-check sin errores (0 TS),
275 rutas generadas. Los `prisma:error DATABASE_URL` son del shell sin `.env` (igual que main y el
resto de worktrees) y no rompen la build.

**Pendiente Rafael:** QA visual en Preview con CBCT real (verificar que `bone` sale bien por defecto y
que Tejido/Aire son útiles); merge a main SOLO tras QA OK. **Env nuevas: NINGUNA. SQL nuevo: NINGUNO.**

═══════════════════════════════════════════════════════════════════════════
## NOM-OLA1-INTEG — Integración de las 5 ramas NOM Ola 1 + fix P2 (PDF receta anulada) 🟡 EN RAMA integ/nom-ola1 (NO main, 2026-06-17)
═══════════════════════════════════════════════════════════════════════════
Integra en UNA rama las 5 ramas de la Ola 1 NOM-024 + arregla el P2 (PDF de receta anulada
sin sello "ANULADA"). NO toca main. Build VERDE, EXIT 0.

RAMAS MERGEADAS (git merge --no-ff, en este orden) sobre main (18a64fb):
  a) feat/nom-rls          → 34b6fe3  (RLS deny-all faltante + sql/nom-rls-missing.sql)
  b) feat/nom-cie10        → 265f49d  (selector CIE-10 real en medicine/dental/dermatology forms)
  c) feat/nom-expediente   → 5c8fd23  (validación de campos mínimos + audit de notas/firma clínica)
  d) feat/nom-conservacion → e9865b7  (anulación lógica receta + soft-delete archivos + archivado clínica; DUEÑA del schema)
  e) feat/nom-bitacora     → 263c7d2  (bitácora inmutable + audit de mutaciones/lecturas)

CONFLICTOS (schema.prisma + audit.ts): NO hubo conflicto de merge real. Los cambios de
conservacion y bitacora caen en regiones DISJUNTAS → git (ort) los auto-fusionó. VERIFIQUÉ a
mano que quedó la UNIÓN de ambos (no se descartó nada):
  - prisma/schema.prisma: conservacion (Clinic.archivedAt/archivedBy/archiveReason;
    PatientFile.deletedAt/deletedBy/deleteReason + @@index([clinicId, deletedAt]);
    Prescription.status/voidedAt/voidedBy/voidReason) Y bitacora (AuditLog.clinic onDelete
    Cascade→Restrict + comentario, L2095). Modelos distintos.
  - src/lib/audit.ts: conservacion (AuditAction +"void"|"soft_delete"|"archive"; logMutation
    soporta esas acciones) Y bitacora (AuditEntityType +"periodontal"|"body-map").
  `npx prisma generate` corrido tras el merge. ORQUESTA.md también se auto-fusionó (rls + conservacion + bitacora).

FIX P2 — PDF de receta ANULADA (RX-06):
  El builder COMPARTIDO src/lib/pdf/prescription-pdf.ts ya hace su propio query con `include`
  (sin select) → rx.status/voidReason/voidedAt YA estaban disponibles, NO hubo que tocar los
  endpoints. Ahora pasa voided=(status==="VOIDED")/voidReason/voidedAt a PrescriptionDocument,
  que estampa (a) watermark diagonal "ANULADA" (rojo, fixed, todas las páginas) y (b) banner
  rojo "RECETA ANULADA — SIN VALIDEZ" con motivo + fecha. Cubre los 3 consumidores del builder:
  prescriptions/[id]/pdf (dashboard), prescriptions/[id]/verify/pdf (público) y
  paciente/recetas/[id]/pdf (portal). @react-pdf/renderer v4.5.1 (transform/opacity OK).
  Archivos: prescription-document.tsx (+props + estilos watermark/banner + render),
  prescription-pdf.ts (pasa los 3 campos).

BUILD: npx next build (worktree; node_modules vía junction; SIN pipes). ✓ Compiled successfully ·
  type-check sin errores · ✓ Generating static pages (275/275) · EXIT 0. Los prisma:error
  DATABASE_URL son del prerender sin DB (patrón conocido). Las 3 rutas PDF en el manifest.

🔴 SQL A APLICAR A MANO (Supabase SQL Editor, NO prisma migrate; idempotentes):
  1) sql/nom-rls-missing.sql      — RLS deny-all en las 16 tablas sin RLS (portal paciente, IA recetas, labs).
  2) sql/nom-conservacion.sql     — columnas/índices de borrado lógico (archivado / soft-delete / anulación).
  3) sql/nom-audit-immutable.sql  — trigger append-only en audit_logs + FK clinics→audit_logs RESTRICT.
  ⚠️ Tras (3): borrar una clínica con bitácora FALLARÁ (FK RESTRICT) — comportamiento NOM-024
  correcto; conservacion ya cambió el endpoint admin/clinics/[id] a archivado lógico → validar en QA.

RAMA: integ/nom-ola1 (worktree mediflow-worktrees/nom-integ). Pusheada a origin. NO mergear a main sin QA.
QA: aplicar los 3 SQL en orden; anular una receta → su PDF (dashboard/portal/verify) sale con
  watermark+banner "ANULADA"; smoke de RLS, CIE-10 en consulta, validación de notas, conservación
  (anti-hard-delete) y bitácora inmutable. Aislamiento multi-tenant intacto (clinicId de sesión).

FIX UX (followup, 2026-06-18) — fix: lista de recetas muestra anuladas con badge ANULADA (antes las ocultaba).
  El GET /api/prescriptions filtraba status:"ACTIVE" → al anular una receta desaparecía de la lista y
  parecía borrada, contradiciendo la conservación NOM-004/§7. Ahora el GET devuelve TODAS (activas +
  anuladas; status/voidedAt/voidReason ya venían por ser escalares), ordenadas vigentes primero y
  anuladas al final (sort estable → issuedAt desc dentro de cada grupo). prescriptions-tab.tsx: badge
  rojo "ANULADA", tarjeta atenuada (opacity) + título tachado, muestra motivo + fecha de anulación; en
  anuladas se ocultan WhatsApp/Correo/Eliminar (ni se reenvía ni se re-anula) y se mantienen PDF
  (sellado) + Verificación. i18n es/en (statusVoided/voidedOn/voidReason). SIN SQL. Build EXIT 0.
  OTRAS superficies que aún filtran status:"ACTIVE" (NO tocadas — decisión de producto, reportadas a
  Rafael): timeline del paciente (api/patients/[id]/timeline), export JSON (api/patients/[id]/export) y
  export-CDA (api/patients/[id]/export-cda). Portal del paciente (api/paciente/recetas) se deja como
  está por indicación expresa. Aislamiento multi-tenant intacto (clinicId de sesión).
  Archivos: api/prescriptions/route.ts, components/dashboard/patient-detail/prescriptions-tab.tsx,
  i18n/dictionaries/es.json + en.json.

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
## [NOM024-AUDIT] Auditoría de cumplimiento NOM-024 / NOM-004 / LFPDPPP 🔍 (SOLO LECTURA, 2026-06-17)
═══════════════════════════════════════════════════════════════════════════
QUÉ SE HIZO: auditoría EXHAUSTIVA de cumplimiento normativo del panel contra el código real de main (HEAD 18a64fb). NO se tocó código. Orquestada con workflow multi-agente: 12 auditores en paralelo → verificación adversarial por área ("schema presente ≠ funcional end-to-end") → síntesis (25 agentes, ~2.3M tokens, 853 tool calls).

REPORTE COMPLETO: `docs/compliance/NOM024_AUDIT_2026-06-17.md` (resumen ejecutivo + tabla requisito-por-requisito de las 12 áreas + gaps por riesgo legal + plan de cierre). Toda afirmación cita evidencia file:line.

CUMPLIMIENTO GLOBAL ESTIMADO: ≈ 44% (ponderado por riesgo ~42%).
- NOM-024 (identificadores, catálogos, bitácora, CDA, acceso) ≈ 47%
- NOM-004 (expediente, firma, receta, referencia) ≈ 46%
- LFPDPPP (cifrado, retención, ARCO/aviso) ≈ 42%

POR ÁREA: 1 Identificadores 55% ⚠️ · 2 Catálogos CIE/CUMS 48% ⚠️ · 3 Expediente NOM-004 44% ❌ · 4 Bitácora 32% ❌ · 5 Firma FIEL/SAT 33% ❌ · 6 Receta electrónica 60% ⚠️ · 7 HL7 CDA R2 38% ❌ · 8 Referencia/contrarreferencia 33% ❌ · 9 Control de acceso/RLS 62% ⚠️ · 10 Cifrado 33% ❌ · 11 Retención/backups 48% ⚠️ · 12 ARCO/aviso 46% ⚠️.

HALLAZGOS DE RIESGO ALTO (bloquean conformidad como ECE):
1. FIRMA: el motor FIEL real (PKCS#7 + AES-256-GCM) existe pero NINGUNA pantalla firma notas SOAP/consentimientos; la "firma" de nota es un flag JSON `status:'SIGNED'` sin hash; la verificación pública declara "válida" solo por `expiresAt`, jamás verifica la firma.
2. BITÁCORA: no es inmutable — el cron de retención hace `auditLog.deleteMany`, hay `ON DELETE CASCADE` desde clinics, el cierre/firma del expediente no deja rastro, y la clínica no puede consultar su bitácora (endpoint sin UI).
3. EXPEDIENTE EN CLARO: SOAP, recetas, alergias, padecimientos, vitals y `specialtyData` se guardan sin cifrar a nivel app; el módulo crypto existe pero está descableado.
4. RECETAS/REFERENCIAS DESTRUIBLES: `DELETE /api/prescriptions/[id]` hace hard delete (rompe el QR público); la hoja de referencia imprimible es código muerto.
5. CDA NO INTEROPERABLE: OIDs de ejemplo (rompen datatype II), sin validación XSD/Schematron, sin importación; el flujo de consulta ni siquiera codifica el diagnóstico (CIE-10 hardcodeado falso).
6. ARCO: el ejecutor de acceso/rectificación/cancelación/oposición tiene CERO llamadores; "archivar paciente" no anonimiza PII; sin seguimiento del plazo de 20 días.
7. ACCESO: tablas del portal del paciente sin RLS; /admin con un único `ADMIN_SECRET_TOKEN` compartido sobre PHI de TODAS las clínicas.

VEREDICTO: NO se puede acreditar conformidad como Expediente Clínico Electrónico ni de protección de datos sensibles HOY. Sí opera como sistema de gestión clínica básico. (Auditoría técnica de código, no dictamen legal — validar riesgos altos con asesoría legal/INAI/COFEPRIS.)

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

===========================================================================
## UI · Progreso REAL al subir/importar archivo (paso 5 Mapear + commit) [integ/import-clinic, 2026-06-22]
===========================================================================
Se reemplazó el spinner genérico **«Leyendo tu archivo…»** (paso 5) y la barra **simulada** de
«Importando…» (commit) por **progreso REAL de subida**: % medido + barra + tiempo restante (ETA), y
al 100% una fase honesta **«Procesando…»** (indeterminada) mientras el servidor parsea/inserta.
**No se inventa ningún %** del procesamiento (no es medible por fila en una sola respuesta).
**Build EXIT 0** (`✓ Compiled successfully`, type-check 0 errores, `✓ 280/280` páginas; solo el ruido
conocido `prisma:error DATABASE_URL` del SSG sin env). Aislado por `clinicId` (sin cambios de datos). NO en `main`.

### Qué se construyó
- **`src/lib/import/client.ts` (RealImportClient) — fetch → XMLHttpRequest en `post()`**: el POST con
  archivo (lo usan `preview()` dry-run y `commit()`) ahora va por XHR para exponer el progreso de
  subida vía `xhr.upload.onprogress`. Se **conservan**: timeout (ahora `xhr.timeout`, mismo 60s),
  parseo tolerante de JSON (incluso en respuestas !ok, para extraer `{error,detalle}`) y los mismos
  mensajes de error en español (timeout vs red, vía `UploadTimeoutError`/`UploadNetworkError`).
  `getOrigins`/`submitAssisted` siguen con `fetchWithTimeout` (intactos). `xhr.upload.onload` emite un
  100% final garantizado → la UI pasa a «Procesando…».
- **Contrato `src/components/import/import-client.ts`**: tipos nuevos `UploadProgressEvent`
  `{loaded,total,pct}` + `OnUploadProgress`; `preview`/`commit` aceptan un `onProgress?` opcional
  (último parámetro). `MockImportClient` lo acepta y lo ignora (es el doble de tests; no se simula %).
- **Componente nuevo `src/components/import/upload-progress.tsx`** (reutilizable, 2 variantes
  inline/panel): fase `uploading` = «Subiendo archivo… NN%» + barra + ETA; fase `processing` =
  spinner + «Procesando…». A11y: la barra es `role="progressbar"` con `aria-valuenow/min/max` +
  `aria-label`; «Procesando…» en `role="status"`/`aria-live="polite"` (anuncio único, sin floodear el
  lector con cada %). Responsive + claro/oscuro por variables (reusa `.imp-progress`).
- **`import-wizard.tsx`**: se eliminó la simulación con `setInterval` (`pct`/`progLabel` → estado único
  `uploadProg`). ETA = `loaded/segundos` → `(total-loaded)/velocidad`, formateada «~Xs» / «~Xm Ys»
  (umbral de 0.25s para que sea fiable). **Paso 5**: la vista previa (dry-run de pacientes) cablea
  `onProgress`. **Commit multi-entidad**: cada entidad (pacientes→saldos→citas) vuelve a subir el
  MISMO archivo, así que se mide su subida por separado con etiqueta «Pacientes · 1 de 3» (solo si >1).
- **`importing-panel.tsx`**: ahora solo pinta `<UploadProgress variant="panel">` bajo el título.
- **i18n es/en** (espejo): `shell.importClinic.upload.{uploading,processing,eta,aria}` +
  `importing.step` + `importing.ent.{patients,balances,appointments}` (se quitaron las etiquetas de la
  barra simulada `prep/validating/scheduling/finishing`, ya muertas).
- **CSS** `globals.css`: bloque `.imp-upprog*` (reduced-motion ya cubierto por `.imp-progress > i`).

### Decisiones / notas
- **Honestidad del %**: solo la SUBIDA es medible (`fetch` no la expone → XHR). El procesamiento del
  servidor NO se finge: barra → 100% → «Procesando…» indeterminado hasta la respuesta.
- **Multi-entidad**: progreso POR entidad (la barra se reinicia por cada subida del archivo). Es lo
  fiel a la realidad; el contador «N de M» lo explica. Alternativa descartada: una barra agregada
  mezclaría subida medible con procesamiento no medible.
- Con archivos chicos el % pasa volando (correcto); la mejora se nota con archivos grandes.

### 🔴 Pendiente de Rafael
- **QA** del flujo con un archivo grande real (idealmente con throttling de red) para ver la barra/ETA;
  verificar es/en y claro/oscuro, y la transición a «Procesando…».
- Nota: el P2 previo «error de upload sin `aria-live`» es del **paso 4** (`step-upload.tsx`), distinto
  de esta barra; sigue abierto en la tabla de QA de arriba (fuera de alcance de esta tarea).

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

===========================================================================
## FEAT · Crédito de paciente / Saldo a favor — CIERRA el P1 del signo [integ/import-clinic, 2026-06-21]
===========================================================================
Se creó el concepto de **saldo a favor (crédito) por paciente** (no existía: el balance del
paciente siempre era ≥0) y con él se cierra el **4.º P1** de la QA: la columna `tipo`
(adeudo|favor) de la plantilla de Saldos ahora se HONRA → ya no se invierte el signo.
**Build EXIT 0** (`✓ Compiled successfully`, type-check 0 errores, `✓ 280/280` páginas; solo
el ruido conocido `prisma:error DATABASE_URL` del SSG sin env). Multi-tenant: todo aislado por
`clinicId`. NO en `main`.

### Qué se construyó
- **Schema** `prisma/schema.prisma`: modelo `PatientCredit` (id, clinicId, patientId, amount>0,
  description?, source @default("migrated"), creditDate @default(now()), createdAt) +
  `@@index([clinicId, patientId])` + `@@map("patient_credits")` + relación inversa en Patient y
  Clinic. Saldo a favor del paciente = SUM(amount). **v1 SIN consumo** (no se descuenta de adeudos).
- **SQL A MANO — PENDIENTE DE APLICAR** `sql/patient-credits.sql`: CREATE TABLE/INDEX IF NOT EXISTS
  + FKs con guard sobre pg_constraint + RLS deny-all (patrón supplier-marketplace, policy
  `patient_credits_deny_anon`). Idempotente. NO usa current_setting (el proyecto aísla Prisma-side).
- **Backend** `src/lib/patient-credit.ts`: `getPatientCreditBalance(clinicId, patientId)` y
  `getClinicCreditTotal(clinicId)` = SUM(amount), aislado por clínica. **Resilientes**: si la tabla
  aún no está migrada (P2021/P2022) devuelven 0 → el perfil del paciente y la cobranza NO se rompen
  tras el deploy (mismo espíritu que la resiliencia de clinic-layout).
- **Import** `src/lib/import/entities.ts` (balancesHandler):
  - `headerVariants` reconoce ahora `lastName`(apellido), `type`(tipo), `description`(concepto), `date`(fecha).
  - Resuelve al paciente combinando **nombre + apellido** (antes solo `nombre`).
  - `classifyBalance`: `tipo`=favor → crédito; adeudo/vacío → factura de apertura (como hoy). Sin
    columna `tipo`, respeta el signo del monto (negativo=favor). **El monto se guarda SIEMPRE positivo.**
  - `commit` dividido por tipo: favor → `PatientCredit` (`insertCredits`, commit resiliente por
    lote/fila); adeudo → Invoice de apertura `MF-####` (idéntico a antes, `insertNumbered`).
  - **Idempotencia por tipo**: adeudo = 1 factura de apertura/paciente (como hoy); favor = no duplica
    un crédito migrado equivalente (mismo paciente + monto). Dedup en-archivo también por tipo.
- **UI perfil paciente**: card "Finanzas" + sidebar "Estado de cuenta" muestran **"Saldo a favor: $X"
  en VERDE** (var --success / emerald-600) solo cuando >0, distinto del adeudo en rojo. `page.tsx` lo
  trae aislado por clínica (helper resiliente).
- **UI cobranza** `billing-client.tsx`: KPI "Saldo a favor" (total de la clínica) cuando >0; el grid de
  KPIs pasó a `auto-fit` (responsive a 4/5 tarjetas, sin anchos fijos).
- **Wizard import**: `CANONICAL_FIELDS.balances` ofrece Apellido/Tipo/Concepto/Fecha en el mapeo; el
  paso 6 (revisión) **etiqueta cada fila "a favor" (verde) o "adeudo"** y colorea el monto a favor.
- **i18n** es/en (espejo): `patients.summary.credit`, `patients.sideCards.creditBalance`,
  `billing.billingClient.kpiCredit`, `shell.importClinic.fields.balanceType`/`.concept`,
  `shell.importClinic.step6.kindCredit`/`.kindDebt`.

### Estado del P1
| Hallazgo | Estado |
|---|---|
| **P1 ▲ template `tipo`(adeudo\|favor) ignorado → saldo «a favor» importado como ADEUDO (signo invertido)** | ✅ **RESUELTO** — el handler honra `tipo`; favor→`PatientCredit`, adeudo→Invoice; monto siempre positivo; preview lo distingue. |

### 🔴 Pendiente de Rafael
- **Aplicar `sql/patient-credits.sql`** a mano en Supabase **ANTES** de usar el import de saldos a
  favor. (Sin la tabla, los adeudos siguen importando normal; los créditos «favor» se marcan como
  error de fila, no tumban el import — degradación elegante.)
- QA con un export real que use la columna `tipo` (preview debe mostrar «a favor»/«adeudo» por fila).
- Decisión heredada de la QA previa: gating de rol en `/api/patients/import` si pacientes también
  debe ser ADMIN/RECEPCIÓN (saldos/citas ya lo tienen).

===========================================================================
## FIX · El preview del paso 5 ya no se queda en spinner eterno [integ/import-clinic, 2026-06-22]
===========================================================================
**Bug confirmado por Rafael:** `/api/patients/import` responde 200 OK pero el wizard se queda en
«Leyendo tu archivo…» para siempre. **Build EXIT 0** (`✓ Compiled successfully`, type-check 0 errores,
`✓ 280/280`; solo el ruido conocido `prisma:error DATABASE_URL` del SSG sin env). NO en `main`.
Commit `1113a439`.

### Causa raíz (PRE-EXISTENTE — ya estaba en `25ff0505`, NO la introdujo la ola de progreso)
El `useEffect` que carga el preview al entrar al paso 5 tenía **`previewLoading` en sus dependencias**.
`setPreviewLoading(true)` re-disparaba el efecto → el cleanup del primer run ponía `alive=false` →
cuando el fetch resolvía, el `.then` hacía `if(!alive) return` y **descartaba la respuesta 200**, sin
apagar nunca el loading. (Verificado con `git show 25ff0505:…import-wizard.tsx` → la dep ya estaba.)

### Qué se arregló (`src/components/import/import-wizard.tsx`)
1. **Causa raíz:** se quita `previewLoading` de las deps. La carga se extrae a `loadPreview()` y la
   staleness deja de atarse al ciclo del efecto: se decide con un **token por petición**
   (`previewReqRef`, un `useRef`) atado al **archivo/montaje**. Solo la petición MÁS RECIENTE aplica su
   resultado y SIEMPRE apaga el loading; `stale()` reemplaza al viejo `alive`. Deps del efecto ahora =
   `[flow, step, file, preview, origin]`. La re-entrada se evita por la guarda (`preview`/`previewError`)
   y los lanzamientos concurrentes los gana el último (token). El token se invalida en
   **desmontaje, open-reset, handleFile, removeFile y startWizard** → ninguna respuesta vieja (de otro
   archivo o de una sesión anterior) pisa a la nueva. **No hay bucle**: setear `preview` re-corre el
   efecto pero la guarda `|| preview` corta.
2. **Estado de error real:** nuevo `previewError`. Si el preview falla (incluye el **timeout de 60s**
   del XHR), se muestra **«No pudimos leer tu archivo» + botón «Reintentar»** (re-dispara `loadPreview`)
   en vez del spinner infinito. i18n es/en (`shell.importClinic.step5.errorTitle/errorDesc/retry`),
   `role="alert"`, icono en `var(--danger)`, responsive claro/oscuro (CSS `.imp-error`).
3. **Commit/importing:** revisado — `runImport()` NO comparte el patrón. Es una acción async del
   usuario (no un efecto con deps/cleanup), así que no descarta respuestas. Sin cambios ahí.

### 🔴 Pendiente de Rafael
- **QA**: re-probar el paso 5 con el 200 real (antes se colgaba) → debe pasar a Mapear. Forzar un fallo
  (p. ej. cortar la red) para ver «No pudimos leer tu archivo» + «Reintentar», y que el reintento cargue.
- El `errPreview` (toast) quedó sin uso en código (la ruta de error ahora es inline); la clave i18n
  sigue por si se reusa.
## FIX · Buscador de pacientes no encuentra por nombre completo [fix/patient-search-fullname, 2026-06-22]

**Bug:** en `src/app/api/patients/route.ts` (búsqueda v2) el search hacía un `where.OR` de
`contains` del término **COMPLETO** en cada campo por separado. Por eso "Juan Perez Lopez" NO
encontraba al paciente firstName="Juan" / lastName="Perez Lopez" (ninguna columna sola contiene la
frase entera), aunque "Perez Lopez" sí.

**Fix:** se tokeniza el search por espacios y se exige que **cada token matchee en ALGÚN campo**
(AND de ORs). El orden deja de importar.

```ts
const tokens = search.split(/\s+/).filter(Boolean);
if (tokens.length) {
  const prev = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [
    ...prev,
    ...tokens.map((tok): Prisma.PatientWhereInput => ({
      OR: [
        { firstName: { contains: tok, mode: "insensitive" } },
        { lastName:  { contains: tok, mode: "insensitive" } },
        { email:     { contains: tok, mode: "insensitive" } },
        { phone:     { contains: tok, mode: "insensitive" } },
        { patientNumber: { contains: tok, mode: "insensitive" } },
      ],
    })),
  ];
}
```

### Por qué `where.AND` y NO `where.OR` (bonus: cierra un leak de visibilidad)
`buildPatientWhere` (auth-context.ts) fija `where.OR` a los **doctores** para que solo vean SUS
pacientes (`primaryDoctorId` / con cita / con expediente suyo). El código viejo hacía
`where.OR = [search…]`, **pisando ese OR** → un doctor que buscaba veía pacientes de OTROS doctores
de la clínica (intra-tenant, el `clinicId` seguía aplicando). Al mover el search a `where.AND`,
Prisma combina `clinicId` + `(OR visibilidad)` + `(AND tokens)` todos con AND → se respeta la
visibilidad del doctor Y se arregla el nombre completo. (No es regresión del scope: el `clinicId`
nunca se tocó; multi-tenant intacto.)

### Filtros conservados
- `status`, `gender`, `doctorId`, `source` → campos escalares: sin cambio.
- `quickFilter`: "vip" → `where.tags` (escalar); "debt"/"nextAppt"/"birthdayWeek"/"noContact6m" →
  post-fetch. **Ninguno toca `where.AND`/`where.OR`** → no choca con el search.
- `clinicId` (multi-tenant) → siempre presente vía `buildPatientWhere`. El `count()` usa el MISMO
  `where`, así que el total pagina consistente con la lista.

### Consistencia con el código existente
El endpoint dedicado `/api/patients/search/route.ts` (autocompletar) YA hacía exactamente esto
(`AND: tokens.map(t => ({ OR: [...] }))`). Este fix alinea la lista v2 con ese patrón ya probado.

### Casos verificados (por forma de query Prisma; ver nota)
Paciente firstName="Juan", lastName="Perez Lopez":
- "Juan" → firstName ✓ · "Perez Lopez" → lastName(Perez) ∧ lastName(Lopez) ✓ · "Juan Perez Lopez" ✓
- "Lopez Juan" (orden invertido) → lastName(Lopez) ∧ firstName(Juan) ✓
- teléfono parcial → phone contains ✓ · email (o parte) → email contains ✓ · apellido solo → ✓

### Build / estado
- **Build EXIT 0**: `✓ Compiled successfully`, type-check 0 errores (la anotación
  `(tok): Prisma.PatientWhereInput =>` evita el widening de `mode`), `✓ 275/275` páginas; solo el
  ruido conocido `prisma:error DATABASE_URL` del SSG sin env. NO en `main`.
- `npm install` corrido (faltaba node_modules en el worktree).

### 🔴 Pendiente de Rafael / followups (fuera de alcance)
- **QA con datos reales**: la verificación de arriba es por forma de query (en build NO hay
  `DATABASE_URL`, no se corren queries). Probar en la lista de Pacientes los 7 casos.
- **Handler legacy** (`legacyHandler`, ~líneas 439-444): combobox/modales siguen con el OR del
  término completo → MISMO bug latente al teclear nombre+apellido. No tocado por scope; fix trivial
  idéntico si se quiere. (`/api/patients/search` ya está bien.)

---

## [Menu-Suspendido] — 2026-07-23

**Commit en main:** (tip de `feat/suspended-menu`, pusheado con `git push origin HEAD:main`)
**Build:** `npx next build` → EXIT 0 (Generating static pages 308/308; los `prisma:error` del log son por falta de `DATABASE_URL` en build, esperado y no fatal).

### Qué hace
Cuando la clínica está suspendida (`isPlanExpired === true`), el sidebar deja el menú normal y muestra SOLO **Facturación** (→ `/dashboard/suspended`, ícono `CreditCard`) y **Soporte** (→ `/dashboard/soporte`). Soporte quedó NAVEGABLE estando suspendida. Clínica NO suspendida: todo idéntico a hoy (cero cambios de comportamiento).

### Archivos tocados (6)
- `src/lib/plan-status.ts` — nuevo helper compartido `isAllowedWhileSuspended(pathname)` (permite `/dashboard/suspended` + `/dashboard/soporte(/*)`), usado por el layout Y el modal para no desincronizarse. Además `/api/support` y `/api/switch-clinic` agregados a `PLAN_GATE_ALLOWLIST_BASES`.
- `src/app/dashboard/layout.tsx` — el redirect server-side usa `!isAllowedWhileSuspended(pathname)`; pasa `isExpired` al `<Sidebar>`.
- `src/components/dashboard/expired-plan-modal.tsx` — el guard de cliente (soft-nav) usa el MISMO helper.
- `src/components/dashboard/sidebar.tsx` — prop `isExpired`; item `facturacion` (`suspendedOnly`) en `NAV_ITEMS` + constante `SUSPENDED_NAV_IDS`; `shouldShowItem` oculta `suspendedOnly` en el flujo normal; `sidebarInner` bifurca al menú reducido cuando `isExpired` (logo + [switcher condicional] + 2 items + bloque de usuario).
- `src/i18n/dictionaries/{es,en}.json` — label `sidebar.nav.facturacion` ("Facturación" / "Billing").

### Los gates: eran 5, no 3
El prompt listaba 3 (layout redirect, modal cliente, sidebar). Había 2 más de API: `auth-context.ts:106` (getAuthContext → 401) y `auth.ts:47` (getCurrentUser → redirect). Las pantallas `/dashboard/soporte` son **client components** que hacen `fetch` a `/api/support/*` (tickets, messages, attachments); ese `/api` NO estaba exento → 401 estando suspendida → soporte se veía pero no cargaba/enviaba nada. Fix: exentar `/api/support`. Multi-tenant intacto: las rutas de support sacan `clinicId` de la sesión (getAuthContext), exentar el plan-gate NO afecta el aislamiento.

### Switcher de clínicas (caso SUPER_ADMIN multi-clínica)
El `SidebarFooter` (bloque de usuario) solo tiene logout, NO cambia de clínica; el cambio vive únicamente en `ClinicSwitcher`. Para no dejar varado a un dueño con varias sedes y UNA suspendida, en el menú reducido se CONSERVA el `ClinicSwitcher` **solo si `allClinics.length > 1`**. Con una sola clínica el menú queda mínimo y limpio (logo + 2 items + bloque de usuario). Para que el switch funcione bajo suspensión se exentó `/api/switch-clinic`. Al cambiar a una clínica activa, `isExpired=false` y vuelve el menú normal. NO se puso redirect-guard en `/dashboard/suspended` a propósito: `subscription-tab.tsx:305` manda clínicas ACTIVAS ahí para cambiar/pagar plan; un guard rompería ese flujo.

### Notas
- Sin SQL, sin cambios de schema. Responsive OK: el menú reducido reusa `renderItem` + `SidebarFooter`, así que funciona igual en sidebar colapsado (icon-only) y en drawer móvil.

---

## [Eliminar-Paciente] — 2026-07-25

**Commit en main:** tip de `feat/eliminar-paciente`, pusheado con `git push origin HEAD:main`
**Build:** `npx next build` → **EXIT 0** (`Generating static pages 308/308`, type-check sin errores). Los `prisma:error DATABASE_URL` del log son el ruido conocido del SSG sin `.env` en el worktree, no fatales. Sin SQL, sin cambios en `prisma/schema.prisma`.

### Qué hace
El ticket era "no se pueden eliminar pacientes ya creados". El menú de 3 puntitos de la ficha del paciente ahora tiene, **como última opción y en rojo**, "Eliminar paciente" (ícono `Trash2`, separado por un divisor). Abre un modal con **dos salidas**:

- **Archivar** (seguro, siempre disponible) → `PATCH { status: "ARCHIVED" }`. Sale de la lista activa, conserva historial/citas/facturas, se recupera desde el filtro "Archivados" que ya existía.
- **Eliminar definitivamente** → `DELETE /api/patients/:id?mode=hard`. Borra la fila de verdad. Exige escribir la palabra `ELIMINAR` (localizada: `DELETE` en inglés) — no es un solo clic.

El ítem solo se renderiza si la sesión tiene el permiso **`patients.delete`** ("Archivar/eliminar pacientes"), que ya existía en el catálogo y en el modal de permisos del equipo.

### Por qué DOS niveles (decisión de diseño)
`patientId` cuelga de ~200 relaciones. Un borrado duro arrastra en cascada expediente, radiografías, facturas y consentimientos. Por eso el borrado real está condicionado y el default es archivar.

### Qué BLOQUEA el borrado duro, y por qué
El precheck vive en `src/lib/patient-deletion.ts` (`getPatientDeleteBlockers`). Dos familias, por razones distintas:

1. **Fiscal / contable** — facturas, pagos y CFDI. En el schema `Invoice → Patient` es **`Cascade`**: la BD SÍ los borraría **en silencio**. El bloqueo es de **negocio, no técnico**. Un CFDI timbrado ante el SAT no se puede desaparecer (conservación NOM-024 + cuadre contable) y `CfdiRecord` ni siquiera cuelga del paciente: apunta a la factura por `invoiceId` **sin relación Prisma**, así que borrar dejaría el timbre huérfano apuntando a la nada.
2. **Clínico con `onDelete: Restrict`** — las 5 tablas confirmadas en el schema: `EndodonticDiagnosis` (:4015), `VitalityTest` (:4043), `EndodonticTreatment` (:4102), `Implant` (:4444), `ImplantConsent` (:4709). Aquí el bloqueo **ya existe a nivel BD**; se cuentan ANTES solo para poder explicarlo en español en vez de reventar con un error de foreign key.

Si algo bloquea → **409** con `{ blocked: true, reasons: [{ type, count }] }`. La UI lo traduce a lenguaje humano ("Tiene 3 facturas registradas"), **sin nombres de tabla**, y ofrece archivar.

### Endpoints
- `DELETE /api/patients/:id` → **archiva** (comportamiento histórico, intacto; hoy no lo llamaba nadie en el repo).
- `DELETE /api/patients/:id?mode=hard` → **borra**. Precheck → 409 si hay bloqueos; si pasa, `logMutation` (action `delete`, `before` con nombre + folio) y `$transaction` con `deleteMany` scopeado a la clínica. `catch` de `P2003`/`P2014` → 409 `type: "related"` (no un 500) por si el precheck se queda corto en una carrera.
- **NUEVO** `GET /api/patients/:id/deletable` → `{ deletable, reasons }`. Solo lectura, mismo permiso. Existe para que el modal explique el bloqueo **de entrada** en vez de hacer que el usuario escriba ELIMINAR para recibir un 409 en la cara. **No es la autoridad**: el DELETE reejecuta el mismo precheck.

Multi-tenant estricto en los tres: el `where` SIEMPRE lleva `clinicId: ctx.clinicId` **+ `patientVisibilityAnd(ctx)`** (mismo criterio que PUT/PATCH). Si no es de la clínica o el usuario no lo puede ver → **404, nunca 403 con datos**.

### El permiso ahora manda de verdad
`ctx.isAdmin` → `denyIfMissingPermission(ctx, "patients.delete")` en los **dos** caminos que archivan (había 2, no 1): el handler `DELETE` y la rama `status === "ARCHIVED"` del `PATCH`. **No rompe el archivado masivo de la lista de pacientes**: ADMIN y SUPER_ADMIN tienen `patients.delete` por default, así que para ellos el comportamiento es idéntico; la diferencia es que ahora se le puede **conceder a una recepcionista** o **retirar a un admin** desde el modal de equipo. El modal de permisos ya reflejaba bien la key (`PERMISSION_GROUPS` → "Pacientes") — **no hizo falta arreglarlo**.

### Archivos tocados (9 · 3 nuevos)
- **NUEVO** `src/lib/patient-deletion.ts` — precheck compartido (tipos `PatientDeleteBlockerType` + `getPatientDeleteBlockers`).
- **NUEVO** `src/app/api/patients/[id]/deletable/route.ts` — GET del precheck.
- **NUEVO** `src/components/dashboard/patient-detail/delete-patient-modal.tsx` — modal de 2 acciones (Radix `Dialog` + `Button`/`Input`/`Label` + `react-hot-toast` ya del proyecto; **cero dependencias nuevas**).
- `src/app/api/patients/[id]/route.ts` — DELETE con `?mode=hard`; gate por permiso en DELETE y en el PATCH→ARCHIVED.
- `src/components/dashboard/patient-detail/hero-card.tsx` — props `canDelete` + `onDelete`; ítem rojo al final del popover.
- `src/components/dashboard/patient-detail/patient-detail.module.css` — `.heroMenuDivider` + `.heroMenuItemDanger` (tokens `var(--danger)` / `var(--danger-soft)`, **ningún hex suelto**; calificado con `.heroMenuItem` para ganarle al `:hover` base sin depender del orden).
- `src/app/dashboard/patients/[id]/patient-detail-client.tsx` — prop `canDeletePatient`, estado `showDelete`, montaje del modal.
- `src/app/dashboard/patients/[id]/page.tsx` — resuelve el permiso en el **server** con `hasPermission(user, "patients.delete")` y lo baja como prop (el cliente NO lo deduce del rol).
- `src/i18n/dictionaries/{es,en}.json` — `patients.heroCard.deletePatient` + el nodo `patients.deleteModal.*` (incluye `reasons.*` con formas plurales `one`/`other`).

### 🔴 Pendiente de Rafael / followups
- **QA con datos reales**: la verificación es por forma de query + build (en build NO hay `DATABASE_URL`). Probar los 4 casos: admin ve la opción · recepcionista sin el permiso no la ve y recibe 403 · paciente con facturas → 409 con motivo claro · paciente recién creado → se borra y redirige a `/dashboard/patients`.
- **`PatientCredit` NO bloquea** (decisión consciente). Cascadea igual que las facturas y es dinero (saldo a favor del paciente), pero el spec enumeró explícitamente qué bloquea y no lo incluía. Si se quiere, agregarlo es **una línea** en `getPatientDeleteBlockers`. En la práctica un crédito sin ninguna factura es raro.
- **Log de intento**: `logMutation` se escribe ANTES del DELETE (como pedía el spec, para que el snapshot `before` exista). Si el borrado falla por una FK que el precheck no vio, queda un registro de intento en la bitácora. Asumido a propósito: preferible un log de más que un borrado sin rastro.
- **A un SUPER_ADMIN no se le puede quitar `patients.delete`** — `PATCH /api/team/[id]/permissions` rechaza editar permisos de otro SUPER_ADMIN (anti-lockout, preexistente, no tocado).

---

## [Fix-Factura-Cancelada] — 2026-07-25

**Commit en main:** tip de `fix/factura-cancelada`, pusheado con `git push origin HEAD:main`
**Build:** `npx next build` → **EXIT 0** (`Generating static pages 308/308`, type-check sin errores). Sin SQL, sin cambios en `prisma/schema.prisma`, sin dependencias nuevas.

### El dato que explica TODO el bug
`POST /api/invoices/[id]/cancel` marca `status: "CANCELLED"` pero **NO pone `balance` en 0** — deja la columna intacta. Y como `cancel` exige `paid === 0`, una factura cancelada queda con **`balance === total`** en BD. Resultado: **cualquier suma de `balance` que no filtre por status cuenta la factura anulada como deuda viva**. No es un bug de un archivo, es ese patrón repetido.

### Causa raíz confirmada (lo reportado)
- `INV_STATUS` (patient-detail-client.tsx) solo mapeaba 4 de los 6 valores del enum `InvoiceStatus`. Con `INV_STATUS[inv.status] ?? INV_STATUS.PENDING`, CANCELLED y DRAFT caían a **"Pendiente" amarillo**.
- El `useMemo` de `totalPlan/totalPaid/totalBalance` reducía sobre TODAS las facturas → el card "Estado de cuenta", el botón "Cobrar ahora · $1,800", `pendingBalance` del hero y `pctPaid` contaban MF-0151.

### Dónde MÁS estaba el mismo bug (esto es lo importante)
| # | Superficie | Qué se veía mal |
|---|---|---|
| 1 | `patients/[id]/patient-detail-client.tsx` | badge "Pendiente" + Estado de cuenta + Cobrar ahora + % cobertura (lo reportado) |
| 2 | ídem, columna **Saldo** de la tabla | la fila decía "Cancelada" y al lado $1,800 **en rojo** |
| 3 | `api/patients/route.ts` (**3 queries**) | columna Saldo de la **LISTA** de pacientes, KPI "pacientes con deuda" + "monto adeudado", filtro rápido "Con deuda", `hasDebt` y el sort por balance |
| 4 | `portal/[token]/portal-client.tsx` | **el paciente veía la deuda fantasma en SU portal**; el badge era un ternario que mandaba CANCELLED a "Pendiente" **en rojo**; y la columna "Pendiente" por factura |
| 5 | `api/analytics/patients-value/route.ts` | CTE `inv` sin filtro → facturado/saldo por paciente y totales. Alimenta el KPI **"Saldo pendiente" del CRM** (`analytics/crm`) |
| 6 | `api/analytics/churn-risk/route.ts` | CTE `inv` sin filtro → marcaba deuda falsa y **subía el score de riesgo de fuga** del paciente |
| 7 | `lib/caja.ts` → `deriveWindow` `discountAgg` | la línea **"Descuentos" del corte** sumaba descuentos de facturas canceladas/borrador |

### Lo que YA estaba bien (verificado uno por uno, NO tocado)
`api/finanzas` (porCobrar/vencido/ventas/porDoctor) · `lib/caja.ts` → `computeDayBilling` (billedToday/pendingToday/overdueToday) · `dashboard/caja/page.tsx` (totalPaid/Pending/Overdue) · `dashboard/reports` · `api/dashboard` · `api/dashboard/home/{admin,receptionist}` (vencidas) · `api/dashboard/home/revenue` · `api/analytics/{doctor-performance,payroll-pdf}` · `api/analytics/cohorts` · `admin/clinics/[id]` · `api/paciente/summary` · `api/paciente/payments`.

Dato revelador: **`billing-client.tsx` y `invoice-detail-modal.tsx` YA tenían los 6 estados bien mapeados** (CANCELLED neutro, DRAFT brand). O sea: el modal que se abre al hacer clic en la fila mostraba "Cancelada" correctamente mientras la fila de atrás decía "Pendiente". `INV_STATUS` de la ficha simplemente se quedó atrás.

### Dejado a propósito (incluye canceladas, y está bien)
- `dashboard/caja/page.tsx:65` `monthInvoices` — es un **conteo de documentos emitidos** en el mes, no dinero. Una cancelada sí se emitió.
- `patient-detail-client.tsx` `facturacion: invoices.length` — badge de conteo del nav; el tab las lista todas a propósito.
- `api/paciente/payments` **lista** las canceladas (`status: { not: "DRAFT" }`) — correcto: el paciente debe VER que se canceló. Sus totales ya las excluyen explícitamente.
- `openChargeShortcut` — verificado: busca DRAFT/PENDING/PARTIAL/OVERDUE, excluye CANCELLED por construcción. **No tocado**, como pedía el prompt.
- `POST /api/invoices/[id]/cancel` — **no tocado**.

### Archivos tocados (8)
`src/app/dashboard/patients/[id]/patient-detail-client.tsx` · `src/app/api/patients/route.ts` · `src/app/portal/[token]/portal-client.tsx` · `src/app/api/analytics/patients-value/route.ts` · `src/app/api/analytics/churn-risk/route.ts` · `src/lib/caja.ts` · `src/i18n/dictionaries/{es,en}.json`

### Criterio de filtrado (por qué CANCELLED y no DRAFT)
En la ficha se excluye **solo CANCELLED**. Los DRAFT SÍ suman a propósito: en el expediente son facturas en curso y son justo lo que `openChargeShortcut` prioriza cobrar — excluirlos habría hecho desaparecer el botón "Cobrar ahora" de un paciente cuya única factura es borrador. Mismo criterio en `api/patients` para que la LISTA y la FICHA den el mismo número. En `caja.ts` sí se usa `notIn: ["DRAFT","CANCELLED"]` porque es el filtro que ya usaba el resto de ese archivo (`issuedToday`). **Reembolsada ≠ cancelada**: un reembolso no pasa por `status = CANCELLED`, así que ningún filtro de estos lo toca.

### 🔴 Nota de estilo para Rafael (decisión que se aparta del prompt)
El prompt pedía **DRAFT en estilo neutro**. Lo puse en **brand** (violeta) porque `billing-client.tsx` y `invoice-detail-modal.tsx` ya lo pintan así — y el modal del borrador se abre **desde esa misma fila**, así que en gris se vería un badge distinto antes y después del clic. CANCELLED sí quedó **neutro**, que coincide con el prompt y con las otras dos superficies. Si lo prefieres gris, es una línea en `INV_STATUS`.

---

## [Fix-Borrar-Cancelada] — 2026-07-25

**Commit en main:** tip de `fix/borrar-paciente-factura-cancelada`, pusheado con `git push origin HEAD:main`
**Build:** `npx next build` → **EXIT 0** (`Generating static pages 308/308`, type-check sin errores). Los `prisma:error DATABASE_URL` del log son el ruido conocido del SSG sin `.env` en el worktree. **Sin SQL**, sin cambios en `prisma/schema.prisma`, sin dependencias nuevas.

### El bug
Patricia Mendoza Lara **#P0118** tiene una sola factura, **MF-0151 de $1,800 CANCELADA**, y el modal "Eliminar paciente" la seguía declarando no eliminable: *"Tiene 1 factura registrada"*. Una factura anulada no es dinero ni obligación: no debe bloquear nada.

Es la continuación directa de **[Fix-Factura-Cancelada]** (88484652): el mismo `balance`/conteo sin filtrar por `status`, ahora en el precheck de borrado en vez de en las sumas de deuda.

### Causa
`src/lib/patient-deletion.ts` → `getPatientDeleteBlockers()` hacía
`prisma.invoice.findMany({ where: { patientId, clinicId } })` **sin filtrar por status**, y ese array alimentaba directamente el blocker `invoices` (`if (invoices.length)`).

### El matiz que hace que NO sea un one-liner
La tentación es meter `status: { not: "CANCELLED" }` en el `where` del `findMany`. **Sería un bug fiscal.** Ese mismo array aporta los `invoiceIds` que son la única llave para llegar a `Payment` y a `CfdiRecord` (ninguno de los dos tiene `patientId` propio). Si las canceladas salen de la query, se pierden sus ids y **dejaríamos de detectar su timbre**: un CFDI timbrado ante el SAT y cancelado después **sigue siendo un documento fiscal conservable (NOM-024 / SAT)** y **sí debe seguir bloqueando** el borrado.

La solución separa las dos preguntas:
- `invoices` (**todas**, canceladas incluidas) → de aquí salen `invoiceIds` para pagos/CFDI y el respaldo `cfdiUuid`.
- `activeInvoices = invoices.filter(i => i.status !== "CANCELLED")` → **solo esto** cuenta como blocker `invoices`.

Los **pagos** se siguen contando sobre todas: aunque `cancel` exige `paid === 0`, el camino "reembolsar → cancelar" deja `paid` en 0 pero **las filas `Payment` siguen ahí** (el reembolso vive como `method: "refund"`), y ese movimiento de dinero sí es historia contable. No se asumió nada.

### Los otros blockers: revisados, y a propósito NO se tocan
Las 5 tablas de endodoncia/implantes **no** aplican el criterio de "ignorar anulados", aunque `EndodonticDiagnosis`/`VitalityTest`/`EndodonticTreatment` tengan `deletedAt` (soft-delete real, el resto del módulo filtra `deletedAt: null`) y `Implant` tenga `removedAt`/`currentStatus: REMOVED`. Razón: son **`onDelete: Restrict`**. La fila soft-borrada **sigue existiendo en la BD** y Postgres rechaza el DELETE igual. Descontarlas daría un "sí se puede borrar" falso que revienta después como FK y cae al bloqueo genérico `related` — peor UX y encima un `logMutation` de un borrado que no ocurrió. Diferencia de fondo: en facturas el bloqueo es **de negocio** (Cascade, la BD sí borraría), en clínico es **técnico** (la BD manda).

### Cosmético — Saldo de una factura cancelada
`src/components/dashboard/billing/invoice-detail-modal.tsx`: el resumen mostraba **Saldo $1,800 en rojo** (`var(--danger)`) en una factura cuyo badge decía "Cancelada", porque `cancel` no pone `balance` a 0 en BD. Ahora, con `isCancelled`, el saldo sale **$0 en neutro** (`text-muted-foreground`). El **Total sigue diciendo $1,800**: eso sí se facturó; lo que es 0 es el **saldo exigible**. Mismo criterio que la columna Saldo de la ficha y del portal (que en 88484652 quedaron en "—").

### Repaso de los 4 casos
| Caso | Antes | Ahora |
|---|---|---|
| Única factura **CANCELADA**, sin pagos ni timbre | ❌ bloqueado *"Tiene 1 factura registrada"* | ✅ **se puede eliminar** |
| Factura **activa** (DRAFT/PENDING/PARTIAL/PAID/OVERDUE) | bloqueado | **sigue bloqueado** por `invoices` |
| Factura **cancelada PERO timbrada** (`cfdiUuid` / fila `CfdiRecord`) | bloqueado | **sigue bloqueado** por `cfdi` (NOM-024/SAT) |
| Paciente con **pagos** (incluye reembolsados) | bloqueado | **sigue bloqueado** por `payments` |

### Archivos tocados (2)
`src/lib/patient-deletion.ts` · `src/components/dashboard/billing/invoice-detail-modal.tsx`

### NO tocado (como pedía el prompt)
`POST /api/invoices/[id]/cancel` · `DELETE /api/patients/[id]` (el handler no cambia: sigue llamando al mismo precheck) · `GET /api/patients/[id]/deletable` · el modal `delete-patient-modal.tsx` (los tipos de blocker y sus textos i18n siguen igual). **Reembolsada ≠ cancelada.**

---

## [Fix-Edad-IA] — 2026-07-25

**Commit en main:** `4512bc7a`, tip de `fix/ai-age-offbyone`, pusheado con `git push origin HEAD:main` sobre `6c903357`.
**Build:** `npm run build` (`prisma generate && next build`) en worktree limpio desde `origin/main` → **EXIT 0** (`Generating static pages 308/308`, type-check sin errores; ambas rutas listadas como `ƒ`). Los `prisma:error DATABASE_URL` y los `DYNAMIC_SERVER_USAGE` de `[admin-auth]` en el log son el ruido conocido del SSG sin `.env` en el worktree. **Sin SQL**, sin cambios en `prisma/schema.prisma`, sin dependencias nuevas.

### El bug
Los dos endpoints que le mandan contexto clínico del paciente a la IA calculaban la edad así:

```ts
const age = patient.dob
  ? new Date().getFullYear() - new Date(patient.dob).getFullYear()
  : null;
```

Restar años a secas no da la edad: da **la edad que el paciente va a cumplir este año**.

### El error no es ±1, es siempre +1 (siempre hacia "más viejo")
Vale la pena precisarlo porque cambia la lectura clínica del riesgo. La resta de años solo puede dar dos resultados:

- Cumpleaños **ya pasado** este año → edad correcta.
- Cumpleaños **aún no pasado** → **edad + 1**.

Nunca subestima. O sea: durante la fracción del año anterior a su cumpleaños — en promedio **la mitad de los pacientes en cualquier día dado** — la IA veía al paciente **un año mayor de lo que es**, que es justo la dirección peligrosa:

- Un paciente de **17 años y 11 meses** se enviaba como de **18** → cruza el umbral pediátrico/adulto.
- Un niño de **5 años nacido en noviembre** se enviaba como de **6** de enero a octubre → sube el escalón de dosis.

La IA usa la edad para banderas de dosis pediátrica y contraindicaciones por rango etario, así que el off-by-one no era cosmético: alteraba el análisis devuelto.

### El fix
Se reemplazó por la lógica de cumpleaños en ambos archivos, extraída a un helper local `calcAge(dob)` junto a los demás helpers de cada ruta (misma convención `/** */` que ya usaban):

```ts
function calcAge(dob: Date): number {
  const today = new Date();
  const dobD = new Date(dob);
  let age = today.getFullYear() - dobD.getFullYear();
  const mo = today.getMonth() - dobD.getMonth();
  if (mo < 0 || (mo === 0 && today.getDate() < dobD.getDate())) age--;
  return age;
}
```

Los call sites quedan en una línea: `const age = patient.dob ? calcAge(patient.dob) : null;`

### Nota sobre la referencia del prompt
El prompt mandaba copiar `calcAge` de `src/lib/ai/consult-context.ts`. **Ese archivo no existe en `main`**: vive en `feat/consult-ai-assist` (PR #115, aún sin mergear). La versión canónica que **sí** está en main es `src/app/api/patients/route.ts:508` — lógica idéntica, y es la que se replicó. No se tocó ese archivo ni se creó un helper compartido en `src/lib/`: duplicar el helper por ruta es el patrón que ya sigue el repo, y centralizarlo se salía del "no cambies nada más".

### `dob` en el select: ya estaba en las dos
Verificado, no hizo falta tocar ninguna query:
- `check-contraindications` → `prisma.patient.findFirst` ya seleccionaba `dob` (junto a `gender`, `isChild`, `allergies`, `chronicConditions`, `currentMedications`).
- `xrays/[id]/analyze` → `prisma.patient.findUnique` ya seleccionaba `dob`.

### Efecto colateral bueno: la cache se auto-invalida
En `check-contraindications` la edad entra en `ctxNorm`, que es lo que se hashea para la cache de `prescription_ai_checks`. Al cambiar la edad cambia el hash, así que **las respuestas cacheadas con la edad inflada dejan de reusarse solas** — no hizo falta ningún borrado manual de cache.

### Conocido y NO corregido (fuera de alcance)
`dob` viene de Prisma como `Date` en UTC-medianoche, y `getMonth()/getDate()` leen en hora local. En UTC-6 eso hace que el cumpleaños "caiga" un día antes. Es un desfase de **1 día**, es el comportamiento que ya tiene todo el resto de la app (incluido el `calcAge` de `patients/route.ts`), y arreglarlo aquí solo habría dejado estos dos endpoints fuera de fase con el resto. El bug reportado era de **1 año**; eso es lo que se arregló.

### Archivos tocados (2)
`src/app/api/prescriptions/check-contraindications/route.ts` · `src/app/api/xrays/[id]/analyze/route.ts`

### NO tocado
Nada más de esos dos endpoints: ni prompts al modelo, ni wallet de tokens IA, ni el gate `assertPatientVisible`, ni la cache, ni el parseo de respuesta. Tampoco `patients/route.ts` ni la rama de PR #115.

═══════════════════════════════════════════════════════════════════════════
## Fix-Ficha-Responsive — cabecera del expediente rota en laptops ✅ (2026-07-28)
═══════════════════════════════════════════════════════════════════════════
BUILD EXIT 0 (`npx next build`, 320 rutas). Sin SQL, sin dependencias nuevas, sin cambios de diseño.
Archivos: `patient-detail.module.css` · `patients.module.css` (solo CSS, 0 .tsx).

### El bug (reportado por una clienta, con captura)
En la ficha del paciente la cabecera se desarmaba: el nombre partido en varias líneas, el
`#P0118 · edad · sexo · teléfono · email` encimado sobre las píldoras de métricas y el botón
"Cobrar" cortado por el borde derecho. Reproducido y medido en Chrome con el componente real
(`HeroCard`) dentro de una réplica del shell del dashboard.

### Causa raíz — confirmada con números
`.heroMain` era `grid-template-columns: auto 1fr auto auto` y su único breakpoint era
`@media (max-width: 1100px)`. Medido en Chrome con un paciente realista (nombre largo, teléfono,
email, saldo de 5 cifras), el contenido que **no encoge** de esa fila suma **1130px**:

| bloque | ancho |
|---|---|
| avatar + ring | 75px |
| 3 gaps de la grilla | 54px |
| 3 píldoras `.metric` (max-content) | 522px |
| 4 botones `.heroActions` (`white-space: nowrap`) | 479px |
| **total rígido** | **1130px** |

Debajo de eso la columna `1fr` colapsaba a **0px** (verificado: `heroInfo.clientWidth === 0`), el
nombre y los datos se salían de su caja y se pintaban ENCIMA de las píldoras, y el resto quedaba
recortado por el `overflow: hidden` del `.hero` — sin barra para alcanzarlo. Medido: la fila se
rompía por debajo de **1440px de ancho propio del hero**, y a 1366px de viewport el hero solo mide
**1073px**. Franja rota real: **de 1101px a ~1740px de viewport**, no de 1101 a 1500.

Extra encontrado leyendo el bloque viejo: `.heroAvatar { grid-area: avatar }` y
`.heroActions > .btnIcon { grid-area: menu }` no hacían NADA — el hijo directo del grid es
`.heroAvatarRing`, y `.btnIcon` es hijo del flex, no del grid. La celda "menu" nunca se usó.

### La solución: `@container`, no un breakpoint más alto
El ancho útil del hero NO se deduce del viewport: depende del sidebar
(`clamp(180px,14vw,232px)` expandido vs **68px** colapsado — 164px de diferencia), del padding del
`<main>` (`clamp(12px,1.5vw,28px)`) y del escalado de Windows. **Ningún `@media` puede acertar en
los dos estados del sidebar a la vez**: el número que evita el desborde con el sidebar abierto apila
la cabecera de más cuando está colapsado. Por eso `.hero` es ahora un query container
(`container-type: inline-size; container-name: patientHero`) y la cabecera se mide a sí misma.

- **Base = layout APILADO** (avatar+datos / métricas / acciones). Es el que no puede desbordar, y
  además es el que se degrada bien si un navegador ignorara `@container`.
- **`@container patientHero (min-width: 1380px)` = fila de escritorio** (la de siempre).
  El número sale de la medición: 1130px de contenido rígido + ~250px para nombre y datos.
  Verificado que a 1380px exactos la fila entra sin envolver (`metricsH` 90px, `actionsH` 36px).
  Equivalencias de viewport: **≈1740px con el sidebar expandido, ≈1580px colapsado.**

### Red de seguridad — que no dependa del número
Aunque el umbral fallara, el hero ya no puede romperse:
- `.heroName` / `.heroMeta`: `overflow-wrap: anywhere`. El email largo es UN token de ~250px y era
  el que más inflaba el min-content de la columna. Se decidió **envolver, no truncar**: en una ficha
  clínica esconder parte del nombre detrás de un `title` es peor.
- `.heroMetrics` / `.heroActions`: `flex-wrap: wrap`. Si no caben, la píldora o el botón entero
  BAJAN de línea en vez de encogerse por debajo de su contenido (que es lo que cortaba "Cobrar").
  Sin efecto visual mientras quepan. Se descartó colapsar los secundarios dentro del menú "…":
  el CTA que la clienta necesita es justamente "Cobrar", esconderlo sería peor que bajarlo de fila.
- `minmax(0, 1fr)` en la columna de datos y `grid-area` explícito en los 4 hijos reales.

### Verificación (Chrome, componentes reales)
Barrido automático de **346 anchos de hero, de 320px a 1700px de 4 en 4**, buscando cualquier hijo
con `scrollWidth > clientWidth` (overflow visible) o cuyo borde derecho pasara del content-box del
hero: **0 roturas en los 346**. Conmutación fila↔apilado exactamente en el umbral (1428px de
border-box = 1382px de contenido).

Matriz **5 anchos × 2 estados del sidebar**, midiendo escapes / píxeles fuera de vista / scroll
horizontal de página. En las 10 combinaciones: **ninguno, ninguno, 0**.

| viewport | ancho del hero (expandido) | layout | ancho del hero (sidebar 68px) | layout |
|---|---|---|---|---|
| 1280×720 | 984px | apilado | 1112px | apilado |
| 1366×768 | 1073px | apilado | 1196px | apilado |
| 1440×900 | 1134px | apilado | 1268px | apilado |
| 1536×864 | 1214px | apilado | 1361px | apilado |
| 1920×1080 | 1571px | **fila** | 1735px | **fila** |

A 1920 la columna de datos recibe 439px ≥ 426px que mide el nombre → **nombre en 1 línea, diseño
idéntico al de hoy**. En 1440/1536 la fila NO cabe de verdad (1130px rígidos contra 1134/1214px de
hero): apilar es la respuesta correcta, no un capricho del umbral.

Capturas en `C:\Users\Rafael\Documents\GitHub\capturas-ficha-responsive\`:
`ANTES-1280.png` · `ANTES-1366.png` · `DESPUES-1280.png` · `DESPUES-1366.png` · `DESPUES-1920.png`.

### Barrido — la MISMA falla en la lista de pacientes (arreglada)
Auditadas todas las reglas `grid-template-columns` de pistas fijas del repo + los `grid-cols-[...]`
de Tailwind. Un solo hallazgo real, y grave:

**`/dashboard/patients` — la tabla se recortaba SIN barra entre 1367px y ~1600px.**
`.tableWrap` tenía `overflow: hidden` en la base y solo activaba `overflow-x: auto` dentro del
`@media (max-width: 1366px)`. Medido en Chrome con la tabla real (10 columnas): min-content
**1313px** en su forma ancha. Ancho útil del panel: 1120px a 1367, **1180px a 1440**, **1260px a
1536**. Resultado: **la última columna (WhatsApp / llamar / agendar) quedaba fuera y sin forma de
llegar a ella** — y afectaba justo a 1440 y 1536, los más comunes.

Fix (mismo patrón que el hero: primero que no pueda romperse, después el número):
1. `.tableWrap` en la BASE → `overflow-x: auto; overflow-y: hidden` (el `y` sigue recortando las
   esquinas contra el `border-radius`). Ya no se recorta nada a ningún ancho.
2. Tope de la forma compacta **1366px → 1639.98px**: la forma ancha solo cabe desde ~1620px
   (1313px justos a 1600px). 1640px deja ~35px de holgura para emails/nombres más largos.
   De paso, en 1367-1639 las acciones vuelven a ser visibles sin hover (`opacity: 1`).

Verificado a 1024/1280/1366/1367/1440/1536/1600/1640/1700/1920: `overflow-x: auto` en todos y
**cero recortes sin salida**; sin barra horizontal a partir de 1600.

### Revisado y SANO (no se tocó)
- **`.layout` de la ficha (220px 1fr 320px, `@media 1366`)** — probado en el borde exacto: a 1367px
  la columna central queda en 547px y lo único que pasa es que la tabla de Facturación scrollea
  14px dentro de su `.tableScrollB` (`overflow-x: auto`, por diseño). A 1400+ ni eso. **No hay zona
  muerta entre el hero y el layout**: el hero ya no depende del viewport, así que la coordinación
  de breakpoints que pedía el prompt deja de existir como problema.
- **Rail derecho (`.sidePanel`) y quick-nav de 220px** — 0 desbordes en las 10 combinaciones.
- **Agenda** — la grilla de días (`minmax(160px,1fr)` × N) vive dentro de `.scrollArea
  { overflow: auto }`; el `.page` es `1fr + 320/280px`. Sin recortes.
- **Caja** — sus 3 tablas ya van envueltas en `<div style={{overflowX:"auto"}}>`.
- **Dashboard de inicio** — Tailwind fluido, cero pistas fijas.
- **Odontograma** — `.odo-chart` es `width:100%` con dientes `flex:1 1 0; min-width:0` y
  `svg{width:100%}`. Encoge solo, no recorta.
- **Tablas de la ficha (`.tableB`)** — ya iban en `.tableScrollB` con `overflow-x: auto`.

### Limitación honesta de la verificación
No hay `.env` local ni token de Vercel vigente (`vercel whoami` → "The specified token is not
valid"), así que el dev server no puede levantar las páginas que tocan la BD. La cabecera y la tabla
de pacientes se verificaron con **los componentes y el CSS reales** montados en un banco de pruebas
temporal que replica el shell del dashboard (sidebar + padding del `<main>`), emulando cada viewport
con su ancho de sidebar/padding exactos y activando las media queries reales vía CSSOM. El banco de
pruebas **se borró antes de commitear** (`src/app/dev-responsive/`, no está en el commit). Agenda,
Caja y el home se auditaron por código, no en pantalla.

### Ojo para quien siga
`@container` exige que el contenedor esté declarado en un ANCESTRO (`.hero`), no en el elemento que
consulta (`.heroMain`), y el bloque `@container` debe ir DESPUÉS de las reglas base: misma
especificidad, gana el orden de fuente (es el mismo tropiezo que documenta el comentario de
`.sidePanel` en la línea ~334 de ese archivo). Verificado que sobrevive a la minificación de
producción: `@container patientHero (min-width: 1380px){...}` aparece literal en
`.next/static/css/*.css`.

---

## Fix-AI-Usage-Copy — el panel de IA prometía 6× más de lo que da ✅ (2026-07-29)

**Rama:** `fix/ai-usage-copy` → push directo a main (`3ef3e885..96a597f0`). Sin PR, sin SQL.
**Archivos:** `src/i18n/dictionaries/es.json`, `src/i18n/dictionaries/en.json`,
`src/app/dashboard/settings/settings-client.tsx` (3 archivos, +12/−5).

### Antes vs ahora

**1. `settings.client.aiHowItWorksBody`** (el callout "¿Cómo funciona?")

- ANTES: _"Cada consulta con el asistente usa aproximadamente 800 tokens. El límite se renueva
  automáticamente el primer día de cada mes. **Usa Claude Haiku — el modelo más eficiente de
  Anthropic.**"_
- AHORA: _"El consumo depende de la función: una pregunta al chat gasta ~800 tokens, mientras que un
  análisis completo de consulta (que lee todo el expediente) gasta entre 3,000 y 8,000. El límite se
  renueva automáticamente el primer día de cada mes. El chat usa Claude Haiku (rápido y económico) y
  los análisis clínicos usan Claude Sonnet, el modelo de mayor capacidad de razonamiento."_

Por qué era falso: **Haiku solo lo usan 2 de los 9 endpoints que cobran cupo** — `/api/ai` (chat,
`claude-haiku-4-5-20251001`) y `/api/homeopatia/suggest-remedies`. Los que más consumen van con
**Sonnet** (`claude-sonnet-4-6`): `consult/ai-assist:14`, `xrays/[id]/analyze:388`,
`prescriptions/check-contraindications:25`, `clinic-layout/optimize:191`.

**2. Tarjeta del medidor** (`settings-client.tsx`, hoy línea ~964)

- ANTES: `Math.floor(aiRemaining/800)` bajo la etiqueta **"Consultas aprox."**
- AHORA: `Math.floor(aiRemaining/AVG_CONSULT_TOKENS)` bajo **"Análisis aprox."** / _"Approx.
  analyses"_, con `const AVG_CONSULT_TOKENS = 5000` documentado arriba del componente.

Con 992,608 tokens restantes la tarjeta pasa de **1240 → 198** (6.3× menos). 800 es lo que cuesta un
chat corto de Haiku; el análisis de consulta lee expediente + odontograma + consultas previas +
recetas + tratamientos y gasta ~3k–8k. La clínica planeaba con un número inflado y chocaba con el
límite mucho antes de lo prometido. 5k es promedio conservador a propósito: subestima el total de
interacciones posibles en vez de inflarlo.

### Lo que NO se tocó (decisión de Rafael)
**Sonnet se queda.** Cero cambios de `model:`/`MODEL` en ningún route, ni en la lógica del wallet,
ni en `/api/ai/usage`. Esto fue solo texto + un divisor.

### ⚠️ El punto 3 del prompt ya estaba resuelto — NO se tocó
El prompt pedía (opcionalmente) suavizar "Otro consumo sin detalle" hacia algo como _"desglose por
función próximamente"_, partiendo de que **los endpoints no registraban `feature` y todo caía en
"otros"**. Eso **ya no es cierto desde `938524bf`**: existe la tabla `AiQuotaUsage`, la lista cerrada
`AI_FEATURES` en `src/lib/ai-tokens.ts`, y **los 9 callers de `addAiTokens` pasan su slug real**
(`chat`, `consult_assist`, `xray_analysis`, `dictation`, `contraindications`, `homeopathy`,
`ai_insight`, `no_show_prediction`, `clinic_layout`). El desglose se pinta en
`settings-client.tsx:967-991` desde `byFeature`.

Y `aiBreakdownUntracked` ("Otro consumo sin detalle") **no es un placeholder**: es la fila de
reconciliación entre `aiTokensUsed` y la suma del desglose, o sea la IA gastada *antes* de que el
desglose existiera (ver el comentario en `settings-client.tsx:184-193`). Cambiarla a "próximamente"
habría metido una mentira nueva justo en el commit que venía a quitar mentiras, así que se dejó
como está. **Si en producción esa fila sale al 100%, la causa es otra: falta aplicar
`sql/ai-quota-usage.sql` en Supabase** (el insert del desglose es fail-open y se pierde en silencio).

### Follow-up pendiente
- **Verificar que `sql/ai-quota-usage.sql` esté aplicado en Supabase.** Es lo que decide si el
  desglose por función se ve real o si todo el consumo se acumula en la fila "sin detalle".
- El corte **por usuario** sigue pendiente: `AiQuotaUsage.userId` ya se guarda pero `/api/ai/usage`
  no lo expone (marcado como follow-up en el propio endpoint).
- `AVG_CONSULT_TOKENS = 5000` es una estimación, no telemetría. Con el desglose real ya en la BD se
  puede sustituir por el promedio medido de `consult_assist` del mes.

### Verificación
`npx next build` completo en el worktree → **exit code 0**, cero errores de tipos (los
`prisma:error DATABASE_URL` son el ruido esperado de no tener `.env` en el worktree). Ambos
diccionarios parsean y las 2 claves existen **en es.json y en.json con el mismo nombre**. Render
comprobado string por string: menciona Haiku para chat ✓, Sonnet para análisis clínicos ✓, el rango
3,000–8,000 ✓, el espacio inicial del string sobrevive a la concatenación tras el `<strong>` ✓,
1240 → 198 ✓, español neutro con "tú" sin voseo ✓.

---

## [Admin badge soporte sin responder] — el sidebar de DaleControl ya avisa ✅ EN MAIN (2026-07-30, `24f8f347`)

**Qué se pedía:** que el panel `/admin` muestre en el sidebar cuántos tickets de soporte esperan MI
respuesta, sin entrar a la bandeja. Sin SQL.

### La regla (una sola, en un solo lugar)
"Espera respuesta de soporte" = el ticket está en `SUPPORT_OPEN_STATUSES`
(`ABIERTO` · `EN_PROGRESO` · `ESPERANDO_RESPUESTA`) **y** (`!lastSupportMessageAt` ||
`lastClinicMessageAt > lastSupportMessageAt`).

Es la MISMA regla de `unanswered24h` pero **sin el corte de 24 h**: aquí cuentan todos, no solo los
que ya se pasaron de tiempo. Para que no quedara escrita por tercera vez en el archivo, se extrajo a
`awaitingSupportReply({ lastClinicMessageAt, lastSupportMessageAt })` y ahora la usan los tres
consumidores: el `clinicIsWaiting` que ya existía (que además chequea el estado), `unanswered24h` y
el contador nuevo. Cero cambio de comportamiento — la expresión inline vieja de `unanswered24h` era
literalmente equivalente.

### Archivos tocados (6)
1. **`src/lib/support/service.ts`** — nuevo `awaitingSupportReply()` (helper privado, fuente única
   de la regla); `clinicIsWaiting()` ahora delega en él; `getAdminMetrics()` calcula `pendingReply`
   **en la misma pasada de `openTickets`** (`waitingTickets` se filtra una vez y `unanswered24h`
   sale de ese subconjunto — **ninguna query nueva**); nuevo export
   `countAdminPendingReply(): Promise<number>` con `findMany` de select mínimo
   (`lastClinicMessageAt`, `lastSupportMessageAt`) y `try/catch → 0`.
2. **`src/lib/support/types.ts`** — `pendingReply: number` en `SupportAdminMetrics`.
3. **`src/app/admin/layout.tsx`** — `getNavCounts()` mete `countAdminPendingReply()` **dentro del
   `Promise.all` que ya existía** (en paralelo con los 2 counts de clínicas, no en serie) y devuelve
   `supportPending`; el `catch` externo también lo devuelve en 0.
4. **`src/app/admin/admin-nav.tsx`** — `counts?: { clinics?, atRisk?, supportPending? }`; en
   `renderItem`, `/admin/soporte` toma `counts?.supportPending` y es el único ítem con el
   modificador de alerta; el badge lleva `title="N tickets sin responder"`.
5. **`src/app/panel-chrome-va.css`** — nuevo `.nav-item-new__count--alert` (rojo `--danger-soft` +
   `#b91c1c` light / `#fca5a5` dark). Va aquí porque **la clase base vive en dos lados**: la
   definición neutra está en `globals.css` (prohibido tocarla) y el override del panel externo está
   en este archivo, scopeado bajo `.mf-extpanel`. Se repite la regla bajo `:root:not(.dark)` a
   propósito: el override light existente tiene especificidad (0,4,0) y solo se le gana empatando y
   yendo después.
6. **`src/app/admin/soporte/soporte-admin-client.tsx`** — KPI **"Sin responder"** con
   `metrics.pendingReply`, icono `Hourglass`, `tone="danger"` (número en rojo) cuando es > 0 y delta
   _"Esperan tu respuesta" / "Bandeja al día"_. El KPI de **>24 h se dejó intacto**; la fila pasó de
   `xl:grid-cols-4` a `xl:grid-cols-5`.

El endpoint `/api/admin/support/tickets?metrics=1` no se tocó: reenvía lo que devuelve
`getAdminMetrics()`, así que `pendingReply` viaja solo.

### Detalles que valen recordarse
- El badge del sidebar y el KPI "Sin responder" **siempre muestran el mismo número** (misma regla,
  distinta query) — si algún día divergen, es que alguien tocó una de las dos y no la otra.
- `countAdminPendingReply()` **nunca lanza**: el sidebar se renderiza en TODAS las páginas de
  `/admin`, así que un fallo de DB devuelve 0 en vez de tumbar el panel entero.
- Se dejó **sin `take`** a propósito (a diferencia del `take: 2000` de `getAdminMetrics`): es un
  conteo, y un tope silencioso mentiría en el badge. La query es de 2 columnas de fecha sobre
  tickets abiertos.
- El badge se calcula en el Server Component del layout → se refresca en cada navegación del panel,
  no hay polling ni estado cliente.

### Verificación
- `npx tsc --noEmit` → **0 errores** (antes y después del rebase sobre `origin/main`, que venía 9
  commits adelante con el merge de PR #117).
- `npm run build` → **exit 0**, output completo leído: `✓ Generating static pages (347/347)`, tabla
  de rutas completa, `/admin/soporte` compila en 6.02 kB / 100 kB First Load. **Cero**
  `Failed to compile`, `Type error` o `Module not found`. Los 41 `PrismaClientInitializationError`,
  los 11 `Dynamic server usage` y el `Critical dependency` de `file-type` son el ruido preexistente
  de correr sin `.env` local, no de este cambio.
- **Sin SQL**: no hay columnas ni tablas nuevas; todo sale de `SupportTicket` tal como está.

---

## [Admin cobrado-del-mes $0 / pagos Stripe no registrados]

**Commits:** `1e4e460d` (webhook) + `73587155` (admin) — push directo a `main`.

### El bug
Stripe ya había cobrado el primer mes de $19 a un cliente real y el panel `/admin` marcaba
**"Cobrado este mes: $0"**. La causa: el webhook de `invoice.paid` / `invoice.payment_succeeded`
mandaba los correos de ciclo de vida y calculaba la comisión de afiliado, pero **nunca creaba un
`SubscriptionInvoice`** — ese archivo no mencionaba `subscriptionInvoice` en ninguna línea. Y
`subscription_invoices` es la **única** fuente de "Cobrado este mes" (`src/app/admin/page.tsx`), de
`/admin/payments` y de `/admin/reports`. Resultado: los únicos cobros visibles eran los registrados
a mano por `/api/admin/subscriptions`; **todo** lo cobrado por Stripe era invisible.

### Qué se hizo
1. **`src/lib/billing/record-stripe-invoice.ts`** (nuevo) — `recordStripeInvoice(invoice, clinicId)`.
   Mapea `amount_paid/100`, `currency` en mayúsculas, `status: "paid"`, `method: "stripe"`,
   `reference: invoice.id`, el periodo de `lines.data[0].period` (fallback `created` + 1 mes, con el
   mismo `ONE_MONTH_MS` que ya usa el webhook), `paidAt` de `status_transitions.paid_at` y
   `notes: "Stripe <billing_reason> <number>"`. **Idempotente** por `reference` (upsert con
   `update: {}` — Stripe dispara los DOS eventos para la misma factura). **Nunca lanza**: todo va en
   try/catch con `console.error`.
2. **`src/app/api/webhooks/stripe/route.ts`** — llama al helper justo después de resolver `clinic`
   y **antes** del `break` por afiliado, así que cubre a TODAS las clínicas (no solo a las
   referidas). Un fallo ahí no rompe el 200 ni los correos ni la comisión.
3. **`prisma/schema.prisma`** — `SubscriptionInvoice.reference` pasa a `@unique`. Prisma exige el
   unique **en el schema** para poder hacer `upsert({ where: { reference } })`; no basta el índice
   en la BD.
4. **`src/app/admin/page.tsx`** — `paidMonth` medía por `createdAt` (fecha de alta de la fila) y
   ahora mide por `(paidAt ?? createdAt)`. La query pasó a `OR` de `createdAt`/`paidAt >= prev1`
   para que una factura creada el mes pasado y **pagada este mes** no quede fuera del cálculo.
5. **`src/app/admin/page.tsx`** — fuera el hardcode `PLAN_PRICES = { BASIC: 419, PRO: 689,
   CLINIC: 1719 }`. Los precios salen de `plan_configs` vía `getPlanLimits` (el mismo helper que ya
   usa `/api/admin/billing`), que trae su propio fallback a `plan-shared` si la tabla no responde.
   Afecta MRR, MRR potencial **y** el `$/mes` de cada fila de la tabla de clínicas (había un tercer
   uso del hardcode en la línea 372 que el diagnóstico no listaba).
6. **`POST /api/admin/billing/backfill-stripe`** (nuevo, `isAdminAuthed`) — importa lo ya cobrado.
   Body `{ months? }` (default 6, tope 36). Pagina con `autoPagingEach` sobre
   `invoices.list({ status: "paid" })`, resuelve la clínica con un mapa `stripeCustomerId → clinicId`
   precargado (una sola query, no una por factura) e inserta con **el mismo** `recordStripeInvoice`.
   Devuelve `{ scanned, inserted, skipped, unmatched, months, truncated }`.
   **SOLO LECTURA sobre Stripe**: la única llamada es `invoices.list`.
7. **`src/app/admin/payments/payments-client.tsx`** — botón **"Importar pagos de Stripe"** en el
   header, con `useConfirm` (el mismo patrón del resto de `/admin`) y toast con el resumen; hace
   `router.refresh()` solo si se insertó algo.

### Detalles que valen recordarse
- **El índice va COMPLETO, no parcial.** El prompt pedía `WHERE reference IS NOT NULL`, pero un
  índice **parcial no lo infiere `ON CONFLICT (reference)`** (Postgres exigiría repetir el
  predicado y Prisma no lo emite) → el upsert habría fallado igual en producción. En Postgres los
  NULL nunca chocan entre sí en un índice único, así que el índice completo es **igual de
  permisivo** con los cobros manuales sin referencia (efectivo, depósito) y sí funciona con el
  upsert. El nombre es el que Prisma genera para `@unique`, para que no haya drift.
- **Orden obligatorio**: el SQL va **antes** del deploy. Si el código llega sin el índice, el upsert
  truena — pero el helper nunca lanza, así que el webhook seguiría respondiendo 200 y el cobro solo
  no se registraría (falla suave, no caída).
- Se registran también las facturas con `billing_reason: "subscription_update"` (los prorrateos de
  upgrade del PR #117): son dinero real cobrado y deben contar en "Cobrado este mes".
- El backfill tiene un tope duro de **1000 facturas** por corrida; cuando lo alcanza devuelve
  `truncated: true` y el toast lo dice — nada de truncado silencioso.
- **Queda un hardcode fuera de alcance**: `src/app/admin/payments/payments-client.tsx:15` tiene su
  propio `PLAN_PRICES` literal, usado solo como fallback del autorrelleno del monto cuando la
  clínica no tiene `monthlyPrice`. Es un client component, no puede llamar a `getPlanLimits`: para
  matarlo hay que bajarle los precios por props desde `page.tsx`. No se tocó en este cambio.

### Verificación
- `npx prisma generate` → OK (v5.22.0).
- `npx tsc --noEmit` → **0 errores**.
- `npm run build` → **exit 0**, output completo leído (sin `| tail`): `✓ Generating static pages
  (347/347)`, `/api/admin/billing/backfill-stripe` presente en la tabla de rutas, `/admin` compila
  en 212 B / 98.2 kB. Cero `Failed to compile` / `Type error` / `Module not found`. Los 117
  `prisma:error` son `Environment variable not found: DATABASE_URL` — el ruido preexistente de
  correr sin `.env` local.

### SQL pendiente (lo aplica Rafael a mano, ANTES del deploy)
`sql/subscription_invoices_stripe_ref.sql` — el PASO 1 lista `reference` duplicadas; si devuelve
filas hay que resolverlas antes, porque el `CREATE UNIQUE INDEX` fallaría.

---

## [Admin cobros fallidos + heatmap con pagina de fondo]

Rama `feat/admin-fallidos-heatmap` (worktree, desde `origin/main` = `42506d2a`). Tres commits:
`d4cb89a6` (parte A), `e9fdc487` (parte B rescatada) y `e90beddb` (fix de alineación encontrado
al verificar B en el navegador).

### PARTE A — los cobros FALLIDOS de Stripe dejan de ser invisibles

1. **`src/lib/billing/record-stripe-invoice.ts`** — tercer parámetro
   `outcome: "paid" | "failed" = "paid"`. En `failed` el monto sale de `amount_due` (en una
   factura rechazada `amount_paid` es **0**, así que con el campo de antes el panel habría
   mostrado "$0 por cobrar"), `paidAt` queda `null` y las notas añaden el intento
   (`… — cobro fallido (intento N)`).
2. **La trampa del reintento**, que es el motivo real de que esto no fuera un cambio de una
   línea: Stripe reintenta la **MISMA** factura (mismo `invoice.id`), así que un cobro primero
   falla y días después se paga. Con el `update: {}` de antes, la fila se habría quedado clavada
   en `failed` para siempre y ese ingreso **nunca** habría contado en "Cobrado este mes". Reglas
   implementadas:
   - `failed → paid`: **SÍ** promueve — `UPDATE` explícito de `status`/`paidAt`/`amount`.
   - `paid → failed`: **JAMÁS** degrada — un webhook fuera de orden no puede borrar un ingreso real.
   - `notes` **nunca** se pisa al actualizar (puede tener notas del admin).
   - El alta nueva **sigue siendo `upsert`**, no `create`: la lectura previa no es atómica y
     `invoice.paid` + `invoice.payment_succeeded` pueden llegar a la vez. El candado real sigue
     siendo `reference` `@unique`.
   - Devuelve `{ created, promoted }` y sigue sin lanzar nunca.
3. **`src/app/api/webhooks/stripe/route.ts`** — el caso `invoice.payment_failed` ya resolvía la
   clínica con `resolveClinicIdByCustomer(customerId)` (misma búsqueda por `stripeCustomerId` que
   usa `invoice.paid`), así que **no hizo falta cambiar la resolución**. Solo se añade la llamada
   `recordStripeInvoice(invoice, clinicId, "failed")` al final del bloque, en su propio try/catch:
   ni toca la suspensión por `past_due` ni el audit log ni el 200.
4. **`src/app/admin/page.tsx`** — el KPI dejaba de contar lo rechazado. Ahora `pendingPay` suma
   `pending` **+** `failed` y el delta se lee `"$1,234 por cobrar · 2 fallidos"` (sin el sufijo
   cuando no hay fallidos). Todo sale de las filas de `subscription_invoices`, sin inventar precios.
5. **`POST /api/admin/billing/backfill-stripe`** — importa también lo rechazado del rango. Sigue
   siendo **SOLO LECTURA** sobre Stripe (`invoices.list`), respeta `MAX_INVOICES` y `maxDuration`
   **compartidos entre pasadas** (si la primera agota el tope, las demás ni arrancan y sale
   `truncated: true`). Suma `insertedFailed` al resumen; `promoted` va al `console.log`.
6. **`src/app/admin/payments/payments-client.tsx`** — el botón no se movió; el toast ahora dice
   también los fallidos importados y el `router.refresh()` se dispara si entró cualquiera de los dos.
   La tabla ya pintaba el badge "Fallido" (tone danger) — no se tocó.

**Qué status de Stripe se usó para detectar las fallidas** (la pregunta explícita): la API fijada
en `src/lib/stripe.ts` es **`2024-06-20`**, que **no tiene un status `failed`**. Una factura cuyo
cargo se rechaza se queda en **`open`** (Stripe sigue reintentando) o acaba en **`uncollectible`**
(se dio por perdida). El backfill hace una pasada por cada uno de esos dos y descarta en código las
que no son un cobro rechazado de verdad: exige **`invoice.attempted === true`** (si Stripe nunca
intentó cobrarla es una factura recién emitida, no dinero rechazado) y `amount_due > 0`. No se
inventó ningún status que esa versión no acepte.

### PARTE B — heatmap sobre la página real

`git cherry-pick ecf8443c` → **un solo conflicto: `next.config.mjs`**. Los otros 4 archivos
entraron limpios y el commit resultante tiene las mismas **367 inserciones / 16 borrados** que el
original: **no se descartó nada del commit viejo**.

- **Conflicto resuelto conservando main**: main había añadido `https://www.facebook.com` y
  `https://staticxx.facebook.com` a `frame-src` (SDK de Meta). Se quedó **la línea de main** y
  encima se montó el único cambio del commit viejo en esa zona: `frame-ancestors 'none'` → `'self'`.
- **Revisión de seguridad del cambio de CSP**: `X-Frame-Options: SAMEORIGIN` y
  `frame-ancestors 'self'` habilitan **solo el propio origen**. Terceros siguen sin poder
  enmarcarnos (clickjacking cubierto). No afloja nada más. **No hay ningún dominio hardcodeado**
  que corregir (mediflow vs dalecontrol.com): `heatmap-stage.tsx` construye el `src` con
  `window.location.origin`, así que funciona en cualquier dominio.
- **Guard anti-tracking verificado contra el tracker de hoy**, no asumido: `tracker-core.ts` solo
  exporta `start`, `pageview` y `stop`; `pageview()` y `stop()` arrancan con `if (!started) return`
  y el único sitio que pone `started = true` es `start()`, que ahora sale antes si
  `window.self !== window.top`. Comprobado en el navegador: en los 3 iframes la condición del guard
  da `true`. `AnalyticsTracker` (root layout) solo llama a esos tres. El tracker de afiliados
  tampoco se dispara: exige un `?ref=`, y el iframe carga un pathname pelado.

### BUG encontrado al verificar B (commit `e90beddb`)

El commit rescatado **medía mal el alto del contenido** y los puntos caían muy por debajo de su
elemento — justo lo que la tarea pedía arreglar. `measure()` tomaba el máximo incluyendo
`documentElement.scrollHeight`, que **nunca baja del alto del propio iframe** (es el viewport del
frame). Medido en el navegador con una página de 874px dentro de un lienzo de 1472px
(el placeholder `refW * 1.15`): `body.scrollHeight` = 874 pero `documentElement.scrollHeight` = 1472.
El canvas se estiraba a 1472 → cada punto caía **1.68x más abajo**, y se realimentaba (el iframe ya
medía eso, así que la siguiente medición devolvía lo mismo).

Arreglo: se mide por `body.scrollHeight` / `body.offsetHeight` / `documentElement.offsetHeight`
(los tres content-driven; el `offsetHeight` del `<html>` sí daba 874) y el alto de sondeo inicial
baja de `refW*1.15` a **320px**, para que un `min-height: 100vh` —habitual en la app— no vuelva a
falsear la medida. Converge: al fijar el alto real, viewport = contenido.

### Verificación en navegador (banco de pruebas temporal, ya borrado)

La ventana real es de 2752px, así que `resize_window` no sirve para probar anchos: los viewports se
emularon por CSSOM con contenedores de ancho fijo. Se montó una página con elementos en posiciones
**medidas** y clusters de clicks apuntando a su centro exacto.

- Antes del fix: los clusters caían en la "zona media", ~130px por debajo de los botones.
- Después: caen **centrados** en el logo del navbar, en los 3 botones y en el botón del pie.
- **1280 / 1366 / 1536 x sidebar abierto y colapsado** (las 6 combinaciones): `canvas.height` ==
  `iframe.height` == 874 en todas, y la escala se recalcula sola (panel 736 / 794 / 907 px con el
  sidebar colapsado → `scale` 0.574 / 0.619 / 0.707). El bloque responde al **ancho del contenedor**
  vía `ResizeObserver`, no a media queries, así que el sidebar lo reajusta sin recargar.

### Verificación
- `npx tsc --noEmit` → **0 errores**.
- `npm run build` → **exit 0**, output completo leído (sin `| tail`).
- Sin SQL nuevo: `reference @unique` y su índice ya están en producción.

### Ojo al pushear
El `main` **local** tiene un commit que no está en `origin/main`: `a882e874`
("perf(costos): ISR en /tv + rate limit…"). Esta rama sale de `origin/main`, así que al pushear
`HEAD:main` ese commit local queda divergido — no se pierde, pero hay que rebasarlo o pushearlo aparte.

---

## [Heatmap alineacion de clicks] — 2026-07-30

**Estado:** EN MAIN (`66e2fe32` + `8ca10438`, pusheados a `origin/main`).
**Rama:** `fix/heatmap-align` (worktree `mediflow-worktrees/heatmap-align`).
**Pendiente de Rafael:** aplicar `sql/analytics_events_yfixed.sql` en Supabase (hoy mismo).

La página real ya se veía de fondo, pero los clicks no caían sobre los elementos. Los 4 puntos del
diagnóstico se confirmaron en el código antes de tocar nada.

### FIX 1 — La Y se dibuja en píxeles absolutos

`heatmap-canvas.tsx` proyectaba `y = (p.y / p.docH) * H`. El tracker guarda `y = pageY`, un **píxel
absoluto**: esa fórmula lo convertía en una *proporción* del alto de la página **el día del click** y
la re-multiplicaba por el alto de la página **hoy**. Con contenido dinámico (un dashboard con más
pacientes es más alto) el mapa entero se estira o se comprime. La Y no necesita reproyección: el
iframe se renderiza al ancho de referencia, así que las posiciones absolutas ya coinciden.

- El punto se dibuja en `y = p.y` (solo se lleva a la resolución interna del lienzo, que sigue
  acotada por `MAX_PX`). `x = p.x · refW` no cambia.
- El alto del escenario pasa a ser `max(frameH, p95(points[].y) + 120)`. **P95 y no el máximo**: un
  solo outlier no debe estirar el lienzo entero.
- **El iframe conserva su alto real** (`frameH`); el que crece es el escenario. Estirar el iframe
  haría crecer su `min-height:100vh` y **realimentaría la medición** — justo el bug que arregló
  `85b71d38`. El excedente queda como fondo del escenario.
- Aviso discreto sobre el mapa si el alto de la página hoy difiere **>40%** del `docH` mediano de los
  clicks ("la alineación vertical es aproximada"). Es honesto y evita perseguir un bug inexistente.
- El comentario de cabecera de los 3 archivos ya no documenta la fórmula proporcional.

### FIX 2 — No mezclar viewports

Selector **Dispositivo** junto al de página: Escritorio (`vw >= 1024`) · Tablet (640–1023) ·
Móvil (`< 640`), con el conteo en cada opción. Default = grupo con **más clicks**; se re-calcula al
cambiar de página y respeta la elección manual. `refW` pasa a ser la mediana de los `vw` **de ese
grupo**, así el iframe se renderiza al ancho representativo real (antes, un click de móvil con
`vw~375` se dibujaba sobre un layout de ~1280 y caía donde no existe nada). Chip
`"N de M clicks"` para que se note que hay datos en los otros grupos. **Filtrado en cliente**: los
puntos ya vienen todos, el endpoint no se tocó para esto.

### FIX 3 — Elementos fixed / sticky

`a.mf-sidebar-item` es `position:fixed`. Con `pageY = clientY + scrollY`, un click en el menú
después de scrollear quedaba cientos de px más abajo de donde se ve.

- `onClick()` recorre el target y hasta **8 ancestros** (`getComputedStyle().position`); si alguno es
  `fixed`/`sticky` guarda `y = clientY` y `yFixed = true`. Dentro del `try/catch` que ya existía.
- Nueva columna `AnalyticsEvent.yFixed` (Boolean, default false), presente en `TrackEvent`, en el
  schema de `/api/track`, en el `select` del endpoint de heatmap y en `HeatPoint`.
- El visor dibuja esos puntos en `y = p.y` tal cual (el iframe muestra la página desde arriba, así
  que el elemento fijo está en su posición natural) y los excluye del p95 del escenario.
- **Solo arregla los clicks NUEVOS.** Los ya guardados no se pueden recuperar: se anotó un `pageY`
  que no corresponde a lo que se veía.

### Extra no pedido: ventana de despliegue

El deploy de Vercel entra antes que el SQL manual. Sin la columna, `createMany` con `yFixed` tira
**P2022** y se pierde **toda** la analítica hasta que se aplique (y el `select` rompe la pestaña).
Ambos sitios reintentan sin la columna al ver P2022, con comentario de que ese fallback se puede
borrar una vez aplicado el SQL.

### Verificación

Sin `.env` local no hay BD (`.env.e2e` no trae `DATABASE_URL`), así que **no se pudo comprobar con
los 438 clicks reales de `/dashboard`**. En su lugar se montó un banco de pruebas temporal (ya
borrado, nunca commiteado): una página con sidebar `position:fixed` y marcadores en coordenadas
absolutas conocidas, con clicks sintéticos apuntando a su centro. La comprobación es **numérica**,
no a ojo: se leen los picos del perfil de intensidad del canvas y se comparan con el rect **medido
en vivo** dentro del iframe.

| Objetivo (medido en el iframe) | Pico del mapa | Delta |
|---|---|---|
| `Menú 2` del sidebar, capa fixed, y=322 | 319.5 | 2.5 px |
| marcador y=1430 | 1429.2 | 0.8 px |
| marcador y=2430 | 2429.3 | 0.7 px |
| click bajo el contenido, y=3000 | 2999.2 | 0.8 px |
| x sidebar 120 / x marcadores 500 | 118.8 / 499.3 | <= 1.2 px |

Los deltas son del orden del jitter que se le metió a los puntos (+-2px). **La prueba clave**: los
picos salen **idénticos** con `docH=2600` (igual al alto real) y con `docH=1000` (muy distinto). Con
la fórmula vieja, el segundo caso mandaba el click de y=1430 a `(1430/1000)*2600 = 3718`, **2288px
por debajo de su elemento**. Visualmente confirmado también: la mancha cae centrada sobre `Menú 2`.
El aviso de tamaño aparece solo en el caso `docH=1000`, y el escenario se extendió a 3118px
(`p95 = 2998 + 120`) para no recortar el click de y=3000.

Nada ensució la analítica real: sin `DATABASE_URL` los `POST /api/track` del banco de pruebas
murieron en Prisma y devolvieron 204 (verificado en el log del dev server).

- `npx prisma generate` → ok.
- `npx tsc --noEmit` → **0 errores**.
- `npx eslint` sobre los 7 archivos tocados → **0 errores**.
- `npm run build` → **exit 0**, output completo leído (sin `| tail`), 347/347 páginas.

═══════════════════════════════════════════════════════════════════════════
## Fix-Caja-Fecha — "ventas del día" que en realidad eran del TURNO ✅ (2026-07-31) · rama fix/caja-fecha-turno
═══════════════════════════════════════════════════════════════════════════
BUILD EXIT 0 (output completo leído, sin pipes) · `npx tsc --noEmit` 0 errores · sin SQL · sin
dependencias nuevas · **los totales del arqueo NO se tocaron**.

### El reporte

En `/dashboard/caja`, la tabla "Finanzas · ventas del día" mostraba solo la HORA de cada
movimiento. En prod se veía "06:00 p.m." ARRIBA de "03:09 p.m." aunque el servidor ordena
`paidAt: "asc"` y el cliente no invierte nada: eran de días distintos. La caja llevaba días
abierta ("Historial de cortes (0)").

### La causa

`src/lib/caja.ts` deriva la ventana desde `reg.openedAt`, no desde medianoche. **Eso es correcto
para un corte de turno** y no se cambió. El problema era de etiquetado y de formato:

- El título decía "del día" cuando los datos son del turno. El comentario del código y el de la
  exportación ya decían "turno": quien lo escribió lo sabía, la etiqueta visible quedó mal.
- Con solo la hora, un turno que cruza días vuelve imposible saber de qué día es cada cobro. En un
  arqueo eso descuadra dinero real.

### Qué cambió (4 archivos)

**`src/app/dashboard/caja/caja-client.tsx`**
1. **Título honesto**: "Finanzas · ventas del turno" + subtítulo "Abierto desde el 30-jul,
   09:00 a.m." (de `reg.openedAt`). El KPI `kpiIncome` también decía "Ingresos del día" siendo del
   turno → "Ingresos del turno" (se usa en 4 puntos, todos de turno).
2. **Fecha en las filas, solo cuando hace falta**. `daySpan()` cuenta los días naturales de la
   clínica que toca el turno — contando también `openedAt`, porque un turno abierto ayer que solo
   cobró hoy TAMBIÉN cruza días. Si son >1:
   - fila separadora por día dentro de la tabla ("Jueves 30 de jul" + "3 movimientos · $2,450.00"),
   - y la fecha apilada sobre la hora en cada fila ("30-jul" / "03:09 p.m."), no al lado: así la
     columna NO se ensancha y la tabla no desborda,
   - el encabezado pasa de "Hora" a "Fecha y hora".
   Con un turno de un solo día no aparece nada de esto: se ve igual que siempre.
3. **CSV**: ahora "Fecha" y "Hora" en columnas separadas (`dd/mm/aaaa` + 24 h), SIEMPRE, cruce o no
   días. Antes iba `fmtDateTime` ("27-jul, 06:00 p.m.": sin año y como texto, Excel no lo parsea).
4. **`summary.list`** (modal post-cierre) y **`printSummary`**: mismo criterio, con `openedAt` y
   `closedAt` como anclas del turno.
5. **Aviso de caja sin cortar**: banner ámbar cuando la caja lleva >= 18 h abierta **o** cruzó a
   otro día natural. "Esta caja lleva abierta desde el 30-jul, 09:00 a.m. (38 h)." + recomendación
   de cerrar el turno. **No cierra nada ni bloquea nada.**
6. **Zona horaria**: se respeta `timeZone` en todos los formatos nuevos. Además, si `timezone`
   llegara inválida, `Intl` lanzaba `RangeError` y tumbaba la página entera; ahora degrada a la
   zona del navegador.

**`src/i18n/dictionaries/{es,en}.json`** — `thDateTime`, `shiftSalesTitle`, `shiftSalesSince`,
`dayGroupMeta` (con plural one/other), `staleShiftTitle`, `staleShiftDesc`; y `kpiIncome`
recalibrado. **`src/lib/caja.ts`** — solo un comentario en `getCajaState` explicando que la ventana
arranca en `openedAt` a propósito y que por eso la UI debe fechar las filas.

### Gotchas

- **Hidratación**: el aviso depende de la hora actual. Calcularlo en el render daría distinto en el
  servidor y en el navegador. Se resuelve en un `useEffect` (`nowMs`), y se refresca cada 60 s.
- **Clave de día**: `Intl.DateTimeFormat(...).formatToParts()` en vez del truco de pedir locale
  `en-CA`, para que el formato "AAAA-MM-DD" no dependa de los locales del navegador.
- El subtotal por día del separador es **solo presentación** (agrupa las mismas filas de la tabla);
  el arqueo sigue viniendo entero del servidor.

### Verificación

Lógica de fechas comprobada con un script aparte (turno de 1 día, turno que cruza, turno abierto
ayer con cobros solo hoy, CSV, umbral del aviso, zona horaria inválida) — todo como se esperaba.

Render comprobado en Chrome con el **componente real** (`CajaClient` montado en una página temporal
fuera del matcher del middleware, ya borrada, nunca commiteada), porque sin `.env` no hay BD:

| Escenario | Resultado |
|---|---|
| Turno de 1 día | encabezado "Hora", solo hora, sin separadores, **sin banner** |
| Turno que cruza días | "Fecha y hora", separadores "Jueves 30 de jul" / "Viernes 31 de jul", fecha en cada fila |
| Modal post-cierre (fetch stubbeado) | "Fecha y hora" + las 5 filas fechadas |
| CSV en turno de 1 día | `"31/07/2026","09:40",...` — la fecha va igual |
| Ancho útil 1180px (laptop 1440 con sidebar) | tabla 1122px: **no desborda**, sin scroll horizontal de página |

No hizo falta `@container`: la fecha va apilada sobre la hora, así que la tabla no crece de ancho, y
el contenedor ya tenía `overflow-x:auto`.

**Pendiente de QA en prod**: que el aviso aparezca en la caja real que lleva días abierta, y que el
Excel descargado abra con las columnas Fecha/Hora bien parseadas.
---

## [Fix-AI-Copy-Upsell] — el chat decía Sonnet corriendo en Haiku, y el plan sin IA decía "límite alcanzado" ✅ (2026-07-31)

**Rama:** `fix/ai-copy-y-upsell` (worktree desde `origin/main` @ `5b0721cb`) → push directo a main. Sin PR, **sin SQL**.
**Archivos:** 7 modificados + 1 nuevo (+80/−4):
`src/lib/ai/models.ts` (nuevo), `src/app/api/ai/route.ts`, `src/app/api/consult/ai-assist/route.ts`,
`src/app/dashboard/ai-assistant/page.tsx`, `src/components/clinical/dental/ai-consult-panel.tsx`,
`src/components/clinical/dental/ai-consult-panel.module.css`, `src/i18n/dictionaries/es.json`, `.../en.json`.

### TAREA A — copy de Configuración → Asistente IA: **ya estaba hecha, no se tocó**

`settings.client.aiHowItWorksBody` en es.json/en.json **ya dice exactamente** el texto pedido
(espacio inicial incluido) desde `96a597f0` (2026-07-29, ver la entrada _Fix-AI-Usage-Copy_ más
arriba). Se comparó string por string contra el prompt: **idéntico**, no había nada que cambiar.

- Estado hoy (es.json:3115): _" El consumo depende de la función: una pregunta al chat gasta ~800
  tokens, mientras que un análisis completo de consulta (que lee todo el expediente) gasta entre
  3,000 y 8,000. El límite se renueva automáticamente el primer día de cada mes. El chat usa Claude
  Haiku (rápido y económico) y los análisis clínicos usan Claude Sonnet, el modelo de mayor
  capacidad de razonamiento."_ · en.json:3115 con la traducción fiel.
- Lo FALSO que menciona el prompt ("...usa aproximadamente 800 tokens... Usa Claude Haiku — el
  modelo más eficiente de Anthropic") **ya no existe en main**. Las líneas del prompt (es.json:3046)
  quedaron corridas: la clave vive en la 3115.

### TAREA B — "Consultas aprox.": **ya estaba hecha, no se tocó**

Mismo commit `96a597f0`. `settings-client.tsx:79` ya declara `const AVG_CONSULT_TOKENS = 5000` con
el comentario de por qué 5k (y una frase extra sobre que subestima a propósito), la tarjeta ya usa
`Math.floor(aiRemaining/AVG_CONSULT_TOKENS)` (línea 1014) y la etiqueta
`settings.client.aiStatConsultations` ya es **"Análisis aprox." / "Approx. analyses"** (es/en.json:3107).
Con 992,608 restantes da **198**, no 1240. Verificado leyendo el código, no asumido.

### TAREA C — el badge del chat decía Sonnet, pero el chat es Haiku ✅ ARREGLADO

- ANTES: `dashboard/ai-assistant/page.tsx` imprimía la cadena literal **`claude-sonnet-4-6`** en DOS
  sitios (cabecera del chat, línea 682; badge de cada mensaje del asistente, línea 804), mientras
  `POST /api/ai` responde con **`claude-haiku-4-5-20251001`**. La pantalla mentía sobre qué modelo
  contestaba.
- AHORA: **nuevo `src/lib/ai/models.ts`** con `export const AI_CHAT_MODEL = "claude-haiku-4-5-20251001"`.
  Lo importan el route (`model: AI_CHAT_MODEL`, **mismo id de siempre**) y las dos etiquetas de la UI.
  Si algún día cambia el modelo del chat, la etiqueta se mueve sola: ya no pueden divergir.
- El id largo cabe: `.modelBadge` es mono de 9px y `.chatMeta` de 11px.
- **No se centralizaron los modelos clínicos** (Sonnet): tocar sus `MODEL` estaba prohibido y
  ninguna pantalla los muestra todavía. Queda dicho en el docblock del archivo nuevo.

### TAREA D — el bloqueo por plan ahora VENDE ✅

**D1 · `POST /api/consult/ai-assist`** (justo después del `findUnique` de la clínica, **antes** del
reseteo mensual y del gate de cupo):

- ANTES: una clínica BÁSICO (`aiTokensLimit = 0`) caía en el mismo 429 que una que sí agotó su cupo:
  _"Límite mensual de IA alcanzado (0 tokens). Se renueva el 1 de …"_ — confuso, nunca tuvo IA.
- AHORA: `if (clinic.aiTokensLimit <= 0)` → **403** con
  `{ error: "Tu plan no incluye IA. Sube de plan para analizar consultas con el asistente.", noPlan: true, isAdmin }`.
  El **429 de cupo agotado queda intacto** (solo se alcanza con `aiTokensLimit > 0`), igual que el
  **503** de `ANTHROPIC_API_KEY` ausente.
- `<= 0` en vez de `=== 0`: mismo criterio que ya usa `ai-quota-banner.tsx:80`
  (`if (!usage.limit || usage.limit <= 0)`) — un límite negativo no debe caer en el mensaje de cupo.
- Va **antes** del reseteo mensual a propósito: sin cupo que resetear, no hay por qué escribir en la BD.
- `isAdmin` sale de la **sesión** (`ctx.isAdmin`), nunca del cliente — mismo patrón que el 402 de
  cupo de pacientes (`api/patients/route.ts:557`).

**D2 · i18n** (`clinical.aiConsult`, en **es.json Y en.json**, mismos nombres):

| clave | es | en |
|---|---|---|
| `noPlan` | Tu plan no incluye IA. Sube de plan para analizar consultas con el asistente. | Your plan does not include AI. Upgrade to analyze consults with the assistant. |
| `noPlanCta` | Ver planes y mejorar | See plans and upgrade |
| `noPlanAskAdmin` | Pídele a un administrador de la clínica que mejore el plan | Ask a clinic administrator to upgrade the plan |

Voz calcada de lo que ya existe (`aiNoPlanNotice` :3113, `aiNoPlan` :4448, `voiceNoPlan` :7182,
`quotaNoPlan` :7187 → todos "Tu plan no incluye IA. Sube de plan para…"). `noPlanCta`/`noPlanAskAdmin`
reusan literalmente el texto de `shell.newPatient.limitCta`/`limitAskAdmin`, que es el CTA de upgrade
que ya existía en el repo.

**D3 · `components/clinical/dental/ai-consult-panel.tsx`** (única superficie: la monta `dental-form.tsx:456`):

- ANTES: `503 → notConfigured`, `429 → monthlyLimit`, `!ok → genericError`. El 403 caía en el genérico
  _"No se pudo generar el análisis. Intenta de nuevo."_
- AHORA: caso **403** ANTES del genérico. Lee el body: si trae `noPlan` pinta la caja de venta; si no
  (403 de **permisos**, `medicalRecord.create`) sigue cayendo en el genérico — no se le vende un plan
  a quien solo le falta permiso.
- Estado `noPlan` **separado de `error`** para que se pinte como oferta y no como fallo rojo: caja de
  marca (`--border-brand` / `--brand-softer`) con el texto + CTA morado a
  **`/dashboard/settings?tab=subscription`** (la MISMA ruta del trial-banner, el modal de cupo de
  pacientes y patient-photos-tab) y flecha `ArrowRight`.
- **Ese tab es admin-only**: `settings-client.tsx:91-98` redirige a "clinica" si el rol no es
  ADMIN/SUPER_ADMIN. Por eso el CTA solo se le muestra al admin y un doctor ve
  `noPlanAskAdmin` — mismo criterio documentado en `api/patients/route.ts:554-556`. Sin esto, el
  gancho mandaba al doctor (el usuario típico del panel) a una pestaña que no es.
- **El botón "Analizar con IA" sigue visible para BÁSICO**: es el gancho, tal como se decidió.
- CSS nuevo (`.upsell`, `.upsellText`, `.upsellCta`, `.upsellAskAdmin`) **en el module.css del panel**,
  no en globals.css, con tokens `var(--*)` y fallback.

### Fuera de alcance (anotado, NO implementado)

1. **Misma distinción noPlan/cupo en `xrays/[id]/analyze` y `prescriptions/check-contraindications`.**
   Nota: esos dos NO inlinean el gate, usan el helper `aiTokenLimitError` (`src/lib/ai-tokens.ts:63`),
   que hoy devuelve un mensaje **fusionado** — _"Tu plan no incluye esta función de IA o agotaste el
   cupo mensual. Sube de plan."_ — con 429. Arreglarlos = partir ese helper en dos (403 noPlan / 429
   cupo) y ajustar a todos sus callers de golpe, no copiar el bloque de aquí.
2. **Desglose real por función en "¿En qué se fue tu IA?".** ⚠️ Ojo, el supuesto del prompt ya no es
   cierto: **los 9 callers de `addAiTokens` YA pasan su `feature`** (lista cerrada `AI_FEATURES`,
   `ai-tokens.ts:11`) y este endpoint cobra con `"consult_assist"` (línea 176). Si en producción todo
   sale como "otro consumo sin detalle", la causa es que **falta aplicar `sql/ai-quota-usage.sql`** en
   Supabase: el insert del desglose es fail-open y se pierde en silencio. Verificar eso primero; ahí
   no hay nada que programar.
3. **El menú "IA asistente" se le muestra a BÁSICO** porque `plan_configs` (editable en /admin) trae
   `ai-assistant` activo para ese plan, desincronizado de `plan-shared.ts:168` (`false`). **No se tocó
   por código**: es dato de Rafael en /admin.

### Verificación

- `npx next build` **completo** en el worktree (sin `| tail`) → **exit code 0**, `Checking validity of
  types` pasado, 355 páginas, `/api/consult/ai-assist` y `/dashboard/ai-assistant` compilados. Los
  `prisma:error … DATABASE_URL` durante "Collecting page data" son el ruido esperado de un worktree
  sin `.env`.
- Ambos diccionarios parsean (`require()` de es.json y en.json) y las **3 claves nuevas existen en los
  dos con el mismo nombre** — si faltara en uno, `t()` imprimiría la clave literal.
- (a) y (b) comprobados leyendo el código: el copy menciona Haiku para chat y Sonnet para análisis
  clínicos con el rango 3,000–8,000 ✓; 992,608/5,000 = **198** ✓; no queda ni una cadena
  `claude-sonnet-4-6` en la pantalla del chat (solo en un comentario que explica por qué se quitó) ✓.
- (c) **verificado por código, no en runtime**: sin `.env` local no hay BD ni clínica BÁSICO contra la
  que pulsar el botón. La ruta del 403 → `noPlan` → caja de venta está trazada línea por línea, pero
  la comprobación en vivo queda para el deploy.
- Cero cambios de `model:`/`MODEL` en ningún endpoint (Sonnet se queda), ni en la lógica del wallet,
  ni en `/api/ai/usage`. El único `model:` tocado es el de `/api/ai`, y solo para leer **el mismo id**
  desde la constante compartida.
## [Admin sesion se cae cada pocos minutos] — 2026-07-31 (`8a5a8f15` + `0c17c10f`)

Nada revocaba las sesiones: el panel expulsaba al admin porque **un fallo de infraestructura se
renderizaba como "no estás logueado"**, y porque la cookie llegaba a faltar aunque la sesión
siguiera viva en BD.

### FIX 1 — Un fallo de BD ya no pide credenciales

`getAdminSession()` envolvía todo en `try/catch` y devolvía `null` ante **cualquier** error, así que
un timeout del pooler o un cold start de Prisma era indistinguible de un visitante sin cookie, y el
layout renderizaba el login.

`src/lib/admin-auth.ts` ahora tiene `getAdminSessionResult()` con tres estados:

| estado | cuándo | qué se ve |
|---|---|---|
| `ok` | sesión viva + AdminUser activo | panel normal |
| `anonymous` | `no-cookie` / `not-found` / `revoked` / `expired` / `user-inactive` | login |
| `error` | la consulta **lanzó** (conexión/timeout) | pantalla de reintento, **sin pedir nada** |

- **Reintento único** a los 150 ms ante `error` antes de darlo por malo.
- **`console.warn` con el motivo exacto en cada rechazo** (`[admin-auth] rechazado: expired`,
  `[admin-auth] rechazado: error de BD <PrismaClientInitializationError>`). La próxima vez los logs
  de Vercel dicen la causa en vez de adivinarla.
- `getAdminSession()` e `isAdminAuthed()` **conservan su firma** y siguen fail-closed (`null` en
  `anonymous` y en `error`): `/api/admin/*` no cambió de comportamiento, ahí fail-closed está bien.
- `src/app/admin/layout.tsx` distingue los tres estados. `error` → `<AdminSessionError />`:
  "No pudimos verificar tu sesión (problema de conexión)" + botón Reintentar. **No borra la cookie.**

Detalle que importa: `cookies()` se lee **fuera** del `try`. Si se traga lo que lanza ahí, el
bail-out de render estático de Next se disfrazaría de error de BD.

### FIX 2 — Renovación deslizante (12h) y cómo se refresca la cookie

- `SESSION_TTL_MS` 8h → **12h**.
- `touchAdminSession(sessionId, currentExpiresAt)`: extiende `expiresAt` a `now + TTL` **solo si le
  queda menos de la mitad del TTL**; si le sobra vida devuelve `null` **sin tocar la BD**. Con TTL de
  12h eso es como mucho un UPDATE cada ~6h de uso, no uno por request. El `where` exige
  `revokedAt: null` y `expiresAt > now`, así que nunca resucita una sesión muerta.
- Se llama desde `getAdminSessionResult()` en fire-and-forget (`void … .catch(()=>{})`): no añade
  latencia ni puede tumbar la petición.

**Mecanismo elegido para la cookie: `POST /api/admin/session/touch` + `<AdminSessionKeepalive />`**
montado en el layout (dispara al montar, cada 5 min y al volver a la pestaña). Por qué éste y no
otro: un Server Component **no puede escribir cookies**, así que extender `expiresAt` en BD sin
refrescar el `maxAge` dejaría al navegador tirando la cookie con la sesión aún viva — exactamente el
síntoma que se quería matar. Las alternativas eran peores: colgarlo de una respuesta existente de
`/api/admin/*` depende de qué pantalla visites (hay secciones que no llaman a ninguna) y meterlo en
el middleware es imposible (Edge no ve Prisma). El endpoint re-emite la **misma** cookie con el
`maxAge` alineado a la expiración vigente, y es `POST` para heredar el CSRF origin-check del
middleware. Fail-closed: sin sesión válida devuelve 401 y no toca la cookie.

### FIX 3 — `sameSite: strict` → `lax`

Con `strict` la cookie **no viaja** al entrar desde ningún enlace externo (correo, marcador abierto
desde otro sitio, el panel de Vercel): la primera carga llega sin cookie y se ve como cierre de
sesión aleatorio. `lax` sigue sin mandarla en POST cross-site y las mutaciones de `/api/admin/*` ya
están cubiertas por `csrfOriginMismatch` del middleware. `httpOnly` y `secure` intactos.

### FIX 4 — /admin/sesiones sirve para diagnosticar

Contador de **sesiones vivas** arriba (ámbar a partir de 10, con el aviso de que entonces lo que
falla es la cookie y no la expiración), fecha de creación y de expiración legibles por sesión — y el
**tiempo restante** al lado ("en 11 h"), calculado solo tras montar para no desfasar la hidratación.
El pie ya no miente: 12h que se renuevan mientras trabajas.

### Verificación

**Guard de seguridad confirmado explícitamente**: ningún caller de `isAdminAuthed()` se quedó sin
`await`. Grep de todas las apariciones filtrando `await isAdminAuthed`: solo quedan imports,
comentarios, la definición, y `src/app/api/admin/auditoria/route.ts`, que declara su **propia**
`isAdminAuthed()` local **síncrona** (no importa la compartida) — ahí `!isAdminAuthed()` es correcto.
Igual para `getAdminSession()`: los ~40 call sites usan `await`.

> Hallazgo aparte, **no tocado** (fuera del alcance): esa `isAdminAuthed()` local de
> `/api/admin/auditoria` es legado — compara la cookie contra `ADMIN_SECRET_TOKEN`, pero desde las
> sesiones en BD la cookie lleva un token aleatorio, así que esa ruta responde 401 siempre.

Sin `.env` local no hay BD (`.env.e2e` no trae `DATABASE_URL`), así que **no se pudo entrar al panel
con login real**. Pero la BD ausente **es** el escenario del bug, y se reprodujo apuntando
`DATABASE_URL` a un host inalcanzable en `next dev`:

| escenario | resultado | log |
|---|---|---|
| cookie `admin_token` presente + BD caída | **200 con "No pudimos verificar tu sesión" + Reintentar** (antes: login) | `[admin-auth] rechazado: error de BD PrismaClientInitializationError: Can't reach database server` |
| sin cookie | 307 → `/admin/login`, login renderizado | `[admin-auth] rechazado: no-cookie` |
| `POST /api/admin/session/touch` sin sesión | `401 {"error":"Unauthorized"}` | idem error de BD |

**El motivo que aparece en los logs al reproducirlo es `error de BD`** — justo el caso que antes
acababa en la pantalla de contraseña.

Umbral de la renovación comprobado sin BD (la rama que no escribe sale antes de tocar Prisma):

| vida restante | resultado |
|---|---|
| 12h (recién creada) | `null`, **no escribió** |
| 6.5h | `null`, **no escribió** |
| 5.5h | intenta el UPDATE |
| 0.5h | intenta el UPDATE |

- `npx tsc --noEmit` → **0 errores**.
- `npx next build` → **exit 0**, output completo leído (2566 líneas, sin `| tail`), 355/355 páginas.
  `/api/admin/session/touch` aparece como ƒ. Los únicos errores del log son 41
  `PrismaClientInitializationError` por el `DATABASE_URL` ausente en local — preexistentes, de
  páginas públicas, no de este cambio. (`npm run build` falla antes, en `prisma generate`, por un
  EPERM de Windows: otro proceso node tiene tomado `query_engine-windows.dll.node`. El schema no se
  tocó, así que el client ya generado sirve.)

### Sin SQL

`expiresAt` ya existe. Nada que aplicar en Supabase.

---

## [Admin auditoria guard viejo] — la ruta de Auditoría devolvía 401 siempre ✅ (2026-08-01)

Rama `fix/auditoria-guard` → **main**. Sin SQL.

### El bug

`src/app/api/admin/auditoria/route.ts` definía una función **local** homónima que tapaba al guard
real por sombreado de nombre:

```ts
function isAdminAuthed() {                                   // ← local, síncrona
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}
...
if (!isAdminAuthed()) return 401;                            // ← sin await (no hacía falta: era la local)
```

Es el modelo **anterior** a las sesiones en BD. Desde WS2-T3 la cookie `admin_token` lleva un token
aleatorio de 32 bytes por sesión, no el valor de la env → la comparación **nunca** daba `true` y
`GET /api/admin/auditoria` respondía **401 siempre**. La pantalla `/admin/auditoria` no podía
cargar datos para ningún admin.

Segundo problema, más grave que el 401: era una **puerta lateral**. Quien tuviera
`ADMIN_SECRET_TOKEN` entraba poniéndose la cookie a mano — sin pasar por bcrypt, sin TOTP, y sin
quedar sujeto a la revocación de sesiones ni a la expiración de 12h.

### El arreglo

`src/app/api/admin/auditoria/route.ts`:
- Borrada la función local y el import de `cookies` (quedó sin uso).
- `import { isAdminAuthed } from "@/lib/admin-auth"` + `if (!(await isAdminAuthed())) → 401`.

El `await` no es cosmético: `isAdminAuthed` es `async`, y una Promise es **truthy**, así que
`if (!isAdminAuthed())` con el guard real dejaría pasar a cualquiera. Se verificó explícitamente
(ver abajo).

### Comentarios desactualizados

Describían el modelo viejo (`cookie admin_token === ADMIN_SECRET_TOKEN`). **Solo comentarios: en
los 5 archivos el CÓDIGO ya usaba el guard correcto** — `toggle-clinic-module.ts` y
`bug-audit/run/route.ts` con `await isAdminAuthed()`, `plan-config/[planId]` con
`getAdminSession()`, `affiliates/config` con `await isAdminAuthed()`, y `bug-audit/page.tsx` es una
page servida bajo el layout de `/admin` (que sí valida). Ninguno necesitó arreglo de código.

- `src/app/actions/admin/toggle-clinic-module.ts`
- `src/app/admin/bug-audit/page.tsx`
- `src/app/api/admin/affiliates/config/route.ts`
- `src/app/api/admin/bug-audit/run/route.ts`
- `src/app/api/admin/plan-config/[planId]/route.ts`
- `src/app/admin/ai-billing/page.tsx` ← **fuera de la lista del encargo**, mismo defecto: afirmaba
  "la auth admin la maneja el middleware". El middleware solo hace un *presence gate* de la cookie
  (no toca BD: Prisma no corre en Edge); la validación real la hacen el layout y cada ruta.

### Barrido de seguridad — no hay más guards caseros

- **Definiciones locales de un guard admin**: la de `auditoria/route.ts` era la **única** en todo
  `src/`. Buscado `function (isAdminAuthed|isAdmin|requireAdmin|checkAdmin|assertAdmin)`.
  El único otro resultado es `requireAdmin()` en `src/lib/auth-context.ts:248`, que es **otra cosa
  y es legítima**: comprueba `ctx.isAdmin` del `AuthContext` de la app de clínicas (rol dentro de
  una clínica), no el panel de plataforma.
- **Comparaciones cookie ↔ `process.env`**: cero fuera de la ruta arreglada.
- **Las 12 menciones de `ADMIN_SECRET_TOKEN` en `src/`** quedan así: 5 eran los comentarios de
  arriba + el de `admin-auth.ts` (histórico, correcto: dice "Antes: ..."), y los usos vivos son
  legítimos — `env.ts` (schema zod, opcional), `admin/settings` (checklist de envs presentes) y
  `lib/affiliates/stats.ts:140` (fallback de salt para hashear IPs de clicks, nada que ver con
  auth).

### Verificación

- **`isAdminAuthed()` sin `await` en `src/`: NINGUNO.** Confirmado con lookbehind de .NET
  (`Select-String '(?<!await\s*\(?\s*)...'`, ripgrep no soporta look-around): los 10 aciertos que
  quedan son **todos líneas de comentario**, ni una sola llamada ejecutable. Los ~50 call sites
  reales usan `await isAdminAuthed()`.
- `npx tsc --noEmit` → **0 errores**.
- `npm run build` → **exit 0** (`BUILD_EXIT=0`), output completo leído (2554 líneas, sin `| tail`),
  355/355 páginas. Los únicos errores del log son `PrismaClientInitializationError` por
  `DATABASE_URL` ausente en el worktree — preexistentes y ambientales, de páginas públicas que ya
  los capturan; no vienen de este cambio.
- El worktree se creó desde `origin/main` sin `node_modules` → `npm ci` + `npx prisma generate`
  antes de compilar.

### Sin SQL

Nada que aplicar en Supabase.
## [Afiliados · Motor de comisiones configurable] — 2026-08-01

El programa de afiliados ya no sabe solo multiplicar un porcentaje. Ahora paga **montos fijos por
plan**, con dos modalidades por afiliado (**fijo recurrente** o **pago único**), y **todo se edita
desde /admin/affiliates sin tocar código**. El modo de % por niveles no se borró: sigue disponible,
solo dejó de ser el default.

### Tabla que quedó cargada (fila id=1 de `affiliate_payout_config`)

| Plan | Precio real | Fijo recurrente (MXN/mes) | Pago único (MXN) |
|---|---|---|---|
| Básico | $419 | $40 | $350 |
| Profesional | $689 | $90 | $650 |
| Clínica | $1,719 | $250 | $1,400 |

La columna "Precio real" NO está escrita en ningún lado del código nuevo: sale de `plan_configs` vía
`getResolvedPlans()`. Si mañana subes el Profesional a $749, la equivalencia "$90 = 13.1%" se
recalcula sola en el admin.

### Las 6 reglas del motor

1. **El primer cobro no paga.** El mes promocional ($19/$29/$39) no comisiona: arranca en
   `startAtInvoiceNo` (default 2, editable 1–12).
2. **Modalidad elegible por el afiliado** (`recurring` | `onetime`) desde su panel, solo si
   `allowAffiliateChoice` está encendido.
3. **La modalidad se CONGELA por clínica** al alta (`affiliate_clinic_terms`), igual que
   `AffiliateSellerAttribution.sellerPct`. Cambiarla afecta únicamente a clínicas futuras.
4. **Los montos NO se congelan**: se lee el valor vigente al generarse cada comisión (mismo criterio
   que el % de nivel). Si la clínica sube de BASIC a PRO, la comisión sigue al plan de esa factura.
5. **Anual = 12 meses de golpe**: `fijo × round((periodEnd − periodStart)/30.44)`, clamp [1,12].
6. **El pago único se entrega una sola vez por clínica**, en el cobro `oneTimeAtInvoiceNo` exacto,
   con candado atómico `oneTimePaidAt`.

### Arquitectura

`src/lib/affiliates/payout-core.ts` — **matemática pura, sin Prisma** (client-safe, testeable):
`monthsCovered`, `fixedAmountFor`, `resolveCommission`, `equivalentPct`, `paybackMonths`,
`simulateProgram`. Mismo corte que `plan-shared.ts` / `plans.ts`: el simulador del admin es un client
component y no puede arrastrar Prisma al bundle.

`src/lib/affiliates/payout.ts` — helpers con BD (`getPayoutConfig`, `getInvoiceNo`,
`getClinicTerms`, `ensureClinicTerms`, `claimOneTimePayout`, `effectiveAffiliateMode`) +
`export * from "./payout-core"`, así el server importa de un solo lugar.

**Degradación (lesson_ortho_schema_drift):** si `affiliate_payout_config` no existiera,
`getPayoutConfig()` devuelve `null` y TODO cae al comportamiento anterior (% del nivel). Ni un 500.

### Webhook (`invoice.paid` / `invoice.payment_succeeded`)

Sustituye el `pct` único por: meses cubiertos → `getPayoutConfig` → `getInvoiceNo` → términos
congelados (con backstop `ensureClinicTerms` para las clínicas referidas ANTES de esta ola) →
`resolveCommission`. Si el motor no puede decidir (config ausente, número de cobro indeterminable),
usa la ruta histórica EXACTA — se verificó que `calcCommissionMxn` y la rama `pct` dan el mismo
número al centavo.

El **candado del pago único** es la primera sentencia de la `$transaction`: `claimOneTimePayout` hace
`updateMany where oneTimePaidAt: null`; si otro proceso ya lo reclamó, lanza un sentinela que aborta
la transacción y el `catch` lo trata como no-op (igual que el P2002). No basta con el `@unique` de la
factura: la misma clínica puede pagar muchas facturas.

**Vendedores:** con montos fijos el % ya no aplica al monto de la factura, así que se reparte por
PROPORCIÓN con `computeSellerSplitFromTotal(total, parentLevelPct, frozenSellerPct)` y el override se
calcula por RESTA. `computeSellerSplit` queda intacta para el modo pct. La regla de oro
`sellerMxn + overrideMxn === totalMxn` se comprueba con `===` exacto (sin tolerancia) en 9 casos,
incluidos los feos (1080/12%/5% → 450+630; 1080/7%/3% → 462.86+617.14).

### /admin/affiliates

- **Sección "Esquema de pago"**: los 6 montos, cada uno con su equivalencia VIVA leída de
  `plan_configs` ("Profesional · $90/mes = 13.1% de $689" y "$650 = 0.9 meses de $689"); `defaultMode`,
  `defaultPayoutMode`, `allowAffiliateChoice`, y los dos "cobro #". Warning ámbar NO bloqueante cuando
  el pago único supera lo cobrado hasta su cobro de disparo. Auditado con `logAdminGlobalEvent`.
- **Simulador**: "X básicos, Y profesionales, Z clínicas" → ingreso mensual y anual, y las DOS
  modalidades lado a lado (cuánto pagas, qué % del ingreso representa, en cuántos meses se recupera
  el único). Usa los valores del FORMULARIO, no los guardados, para ver el efecto antes de guardar.
- **Métricas globales**: costo mensual comprometido (suma de los fijos recurrentes de las clínicas
  activas referidas), el % que representa del MRR referido, desglose por modalidad y por tipo de
  comisión generada.
- **Ficha por afiliado (`/admin/affiliates/[id]`, nueva)**: datos, nivel, links, cupón, datos de pago;
  su modalidad con cambio desde admin; tabla de clínicas referidas (plan, estado, alta, **en qué
  cobro va**, modalidad congelada, comisión acumulada, si el único ya se pagó); historial completo de
  comisiones con tipo, meses cubiertos, filtro por estado y **export CSV**; bloque de dinero con
  proyección mensual SEGÚN LA MODALIDAD REAL; y sus vendedores.

### Panel del afiliado

- `/afiliados/configuracion`: selector de modalidad con los montos reales por plan, cuántos meses del
  fijo equivale cada pago único, y la advertencia de que solo aplica a clínicas nuevas. Solo-lectura
  si el programa no permite elegir.
- `projectedMonthlyMxn` deja de ser `mrr × pct/100`: ahora suma el fijo de cada clínica pagando según
  SU modalidad congelada (las de pago único no aportan al mensual).
- `LevelProgress` en modo "fixed" ya no pinta la escalera de porcentajes: muestra la tabla de montos
  por plan. Se aplicó en **/inicio y en /herramientas** (las dos superficies que lo renderizan).
- El pie de estadísticas decía siempre "la proyección equivale a ≈ X% del MRR"; ahora explica la suma
  de fijos cuando corresponde.
- Reportes: Excel y PDF de estado de cuenta llevan **Tipo** y **Meses cubiertos**; el PDF además
  desglosa el total por tipo. Privacidad intacta: `affiliateId` siempre de la sesión, de las clínicas
  solo el nombre.

### Bugs REALES encontrados y arreglados durante la ola

1. **Prorrateo de upgrade pagaba un mes fijo completo y movía la numeración.** Una factura
   `billing_reason: "subscription_update"` cubre días sueltos de un periodo YA comisionado. Además
   contaba como cobro, así que un upgrade en el mes 1 hacía que el pago único se disparara sobre un
   cargo de $50 (o que se perdiera para siempre al correr la numeración). Ahora `resolveCommission`
   la ignora en modo fijo y `getInvoiceNo` la excluye (por el prefijo de `notes` que escribe
   `recordStripeInvoice`). En modo pct no cambia nada.
2. **`getInvoiceNo` descartaba los cobros con `reference` NULL** (los manuales): `{ not: ref }` no
   matchea NULL en Postgres. Rama `OR` explícita — misma lección que el filtro de WhatsApp.
3. **El fallback de `startAtInvoiceNo` era 1**: con la columna nula, el cobro promocional de $19
   habría pagado $90. Ahora cae al default del programa (2), que es el propósito de la regla.
4. **El admin podía guardar una config que apagaba el pago único en silencio**: con
   `oneTimeAtInvoiceNo < startAtInvoiceNo` no se paga NUNCA (el arranque corta ese cobro y la
   igualdad exacta corta los siguientes) y la pantalla se veía válida. Ahora se rechaza con 400 y el
   cliente avisa antes de gastar el viaje.

### RIESGOS ABIERTOS (decisiones de negocio, NO se tocaron)

- ~~**El pago único es una igualdad exacta (`!==`), tal como se especificó.**~~ **CERRADO** — ver
  "Correcciones del motor" al final de este documento.
- ~~**Plan ANUAL**: la factura #1 cubre 12 meses y no comisiona (regla 1).~~ **CERRADO** — ver
  "Correcciones del motor" al final de este documento.
- **Vendedores en modo fijo**: el reparto usa el % del nivel del padre como referencia. Si ese % es 0
  (legacy `commissionPct = 0`), el padre cobra el fijo completo y el vendedor $0.
- `monthsCovered` clampa a 12: un prepago de 2-3 años comisiona un año.

### Verificación

- `npx prisma generate` → ok. **Ojo Windows**: el `next start -p 3112` que corría desde el 30/jul
  mantenía bloqueado `query_engine-windows.dll.node` y hacía fallar el generate con EPERM; encima
  dejó el cliente a medio escribir y el primer `npm run build` falló con un type error fantasma
  (`payoutMode` "inexistente"). Se detuvo ese proceso, se limpiaron 6 `.tmp` huérfanos y se
  regeneró. **Si quieres el servidor local de vuelta: `npm start`.**
- `npx tsc --noEmit` → **0 errores** en todo el repo.
- `npm run test:afiliados` (nuevo) → **53/53**. `npm run test:billing` → **94/94** (sin regresión).
- `npm run build` completo, SIN pipe → **exit 0**, 357/357 páginas. Verificado en el manifiesto que
  compilaron `/admin/affiliates/[id]`, `/api/admin/affiliates/[id]/detail`,
  `/api/admin/affiliates/payout-config` y `/api/afiliados/payout-mode`.
- **No se pudo correr `npx prisma db pull`**: no hay `DATABASE_URL` local y el token del CLI de Vercel
  está caducado (`vercel whoami` → "The specified token is not valid"). El schema se verificó columna
  por columna contra `sql/afiliados-comisiones.sql` (que es lo que ya corriste): 13 columnas de
  `affiliate_payout_config`, 6 de `affiliate_clinic_terms` y las 4 aditivas, con sus tipos
  (`double precision`→`Float`, `timestamp(3)`→`DateTime`, `text`→`String`), el `@unique` de
  `clinicId` y el índice de `affiliateId`. Coinciden al carácter.

### QUÉ PROBAR EN PROD (lista exacta)

1. **/admin/affiliates → sección "Esquema de pago"**: que cargue con 40/90/250 y 350/650/1400 y que
   cada monto muestre su equivalencia contra el precio real ($90 ≈ 13.1% de $689).
2. Cambia un monto (p. ej. Profesional a $100), **Guardar**, recarga: debe persistir y el KPI de
   "Costo mensual comprometido" debe moverse. Déjalo en $90 después.
3. **Simulador**: mete 10 profesionales → ingreso $6,890/mes, recurrente $900/mes (13.1%), único
   $6,500 recuperable en ~0.9 meses.
4. **Validación**: pon "el pago único se entrega en el cobro #1" con arranque en 2 → debe rechazarlo
   con el mensaje de que no se pagaría nunca.
5. **/admin/affiliates → "Ver ficha"** en cualquier afiliado: que abra, cargue clínicas referidas con
   su "cobro #N" y modalidad, el historial con Tipo/Meses, y que el **Export CSV** baje el archivo.
6. En la ficha, **cambia la modalidad** del afiliado y recarga: debe persistir (y NO debe cambiar la
   modalidad de sus clínicas ya referidas — se ve en la columna "modalidad congelada").
7. **Panel del afiliado → Configuración**: que aparezca el selector con los montos reales y la
   advertencia; cámbialo y verifica que el admin lo ve reflejado.
8. **Panel → Inicio**: el hero ya no debe prometer un %; el KPI debe decir "Tu modalidad"; la tarjeta
   de nivel debe listar montos por plan, no la escalera de porcentajes. Lo mismo en **Herramientas**.
9. **Reportes**: baja el Excel de comisiones (columnas Tipo y Meses cubiertos) y el PDF de estado de
   cuenta (7 columnas, sin desbordes).
10. **La prueba de fuego (dinero)**: cuando entre el **segundo** cobro real de una clínica referida,
    revisa que la comisión sea el MONTO FIJO del plan (no un %) y que `kind = "recurring"`. En una
    clínica de afiliado con modalidad `onetime`, que llegue el pago único UNA vez y que
    `oneTimePaidAt` quede sellado.
11. **Regresión**: que el primer cobro de una clínica nueva NO genere comisión.

---

## Correcciones del motor de comisiones (sobre d2c494f6)

Los dos primeros RIESGOS ABIERTOS de la lista de arriba, cerrados por decisión de Rafael. Cirugía en
`resolveCommission` + tests + las superficies que explican la regla. **Sin cambios de schema ni SQL
nuevo.**

### 1. El plan ANUAL comisiona desde su PRIMERA factura

`startAtInvoiceNo` existe para no pagar sobre el **mes promocional** ($19/$29/$39 del primer mes en
facturación mensual). El plan anual no tiene promoción: se cobra el año completo de golpe
($3,264 / $5,376 / $13,404). Como esa es la factura #1, no comisionaba, y la #2 llegaba 12 meses
después: el afiliado que vendía anual no cobraba nada durante un año.

El arranque ahora **solo aplica a facturas de un mes**:

```ts
if (invoiceNo < startAt && months < 2) return null;
```

Y en modalidad `onetime`, la misma excepción: una factura multi-mes entrega el pago único ahí mismo,
sin esperar a `oneTimeAtInvoiceNo`.

**Números** (montos default, Profesional): anual recurrente #1 → **$1,080** (90 × 12) donde antes
daba $0; Básico **$480**, Clínica **$3,000**. Anual `onetime` #1 → **$650** completos (Básico $350,
Clínica $1,400), sellando `oneTimePaidAt`. Semestral (6 meses) → $540. El umbral son 2 meses.

**La verificación que sostiene la excepción**: una mensualidad normal nunca da `months = 2`. El mes
de calendario más largo son 31 días y 31 / 30.44 = 1.018 → `round` 1. Está como comentario en el
motor y como test que lo calcula con `monthsCovered` (30, 31 y 28 días), no con un número a mano.

**El prorrateo NO se cuela por esta puerta**: `isProration` sigue cortando antes, así que un upgrade
que cubriera varios meses tampoco comisiona en modo fijo.

**Modo `pct`**: la excepción vive en el guard COMPARTIDO del arranque, encima de la rama pct — una
regla en un solo lugar. Consecuencia querida y explícita: en `pct` la anual #1 **también** comisiona
ahora (antes daba $0). No puede pagar de más porque el % se aplica sobre lo que la clínica realmente
pagó. Todo lo demás de `pct` quedó intacto, con test propio.

### 2. El pago único ya no se pierde si se salta su cobro

Era una igualdad exacta (`invoiceNo !== cfg.oneTimeAtInvoiceNo → null`): una clínica que no pasara
justo por ese cobro dejaba el pago único en $0 para siempre. Ahora es **"en ese cobro o después"**:

```ts
if (invoiceNo < oneTimeAt && months < 2) return null;
```

**No adelanta nada**: el momento sigue siendo el cobro #2 y en el caso normal el comportamiento es
idéntico. Solo evita perderlo. El candado atómico (`oneTimePaidAt` + `claimOneTimePayout` dentro de
la `$transaction`) **no se tocó** — nunca fue la igualdad lo que protegía del doble pago, y hay un
test que simula el webhook cobro a cobro (#7 paga $650, #8 y #9 ya no).

**Efecto lateral de cambiar `!==` por `<`**: un `NaN` en la columna (fila vieja, UPDATE a mano)
volvía la condición contraria verdadera y habría pagado en el primer cobro disponible. Se le puso el
mismo respaldo que ya tenía `startAtInvoiceNo` (default del programa), con test.

**Config `disparo < arranque`**: ya no es la trampa silenciosa que documentaba el bug #4 — el
arranque manda y el pago único sale en el primer cobro que sí comisiona. La validación de
`/api/admin/affiliates/payout-config` se conserva (para que el número guardado sea el que manda),
pero su mensaje ya no dice "no se pagaría nunca", que había dejado de ser cierto.

### Superficies

- **/admin/affiliates → "Esquema de pago"**: nota bajo *"La comisión empieza en el cobro #"* con la
  excepción anual. El otro campo pasó a llamarse *"El pago único se entrega **desde** el cobro #"*
  con su propia nota ("es un piso, no una cita exacta"). El párrafo de cierre explica las dos reglas.
- **/afiliados/configuracion**: cada modalidad muestra su argumento de venta anual destacado (no
  escondido): recurrente → *"cobras los 12 meses de golpe, en su primera factura"*; pago único →
  *"cobras tu pago único de inmediato"*. Se pinta en las dos vistas (editable y solo-lectura) y solo
  con el motor vivo.

### Lo que NO se hizo (a propósito)

- **Simulador del admin distinguiendo mensual/anual**: se evaluó y se descartó por tamaño (el
  presupuesto era ~40 líneas). Los precios anuales existen (`priceMxnAnnual` en `plan-shared`), pero
  haría falta pasarlos por `/api/admin/affiliates/payout-config` (que hoy mapea solo
  `{id, label, priceMxn}`), 3 inputs de conteo más, y sobre todo **un modelo de costo distinto**: una
  venta anual recurrente paga 12× el fijo por adelantado y luego nada en 12 meses, así que el KPI
  "costo mensual comprometido" deja de significar algo. Son ~80-120 líneas. El simulador sigue
  cotizando en mensual.

### Riesgos de la lista original que SIGUEN VIVOS

- **Vendedores en modo fijo**: el reparto usa el % del nivel del padre como referencia. Si ese % es 0
  (legacy `commissionPct = 0`), el padre cobra el fijo completo y el vendedor $0.
- **`monthsCovered` clampa a 12**: un prepago de 2-3 años comisiona un año. Ahora pesa un poco más,
  porque esas facturas multi-mes sí entran desde la #1.
- **Nuevo, menor**: una factura de ~46+ días (46 / 30.44 = 1.51 → `round` 2) cuenta como multi-mes y
  comisionaría en la #1. Ningún ciclo mensual de Stripe llega ahí; solo un periodo alargado a mano.

### Verificación

- `npm run test:afiliados` → **63/63** (53 previos + 10; **3 se reescribieron**: eran los que
  documentaban a propósito la igualdad exacta y la config inalcanzable, justo el comportamiento que
  estas correcciones cambian).
- `npm run test:billing` → **94/94**, sin regresión.
- `npx tsc --noEmit` → 0 errores. `npm run build` completo, SIN pipe → **verde, 357/357 páginas**;
  compilaron `/admin/affiliates`, `/afiliados/configuracion` y `/api/admin/affiliates/payout-config`.

### Qué probar en prod

1. **Regresión (lo más importante)**: el primer cobro MENSUAL de una clínica nueva sigue sin generar
   comisión.
2. Una clínica que contrate **anual**: su primera factura debe generar comisión ya — `kind`
   `recurring` con `monthsCovered = 12` y monto = fijo × 12, o `onetime` con el pago único completo.
3. Una clínica de afiliado `onetime` que ya iba en el cobro #5/#9: en su siguiente cobro debe llegar
   el pago único **una vez**, y `oneTimePaidAt` quedar sellado.
4. **/admin/affiliates → "Esquema de pago"**: que se lean las dos notas nuevas y que guardar con
   "desde el cobro #1" y arranque en 2 siga rechazándose (con el mensaje nuevo).

---

## [Afiliados · Puerta de entrada pública] — 2026-08-01

El programa estaba completo por dentro (motor, panel, equipos, estadísticas, PDF) y era **invisible**
por fuera: cero páginas que lo vendieran, cero enlaces desde la web pública, fuera del sitemap. Un
afiliado sólo entraba si Rafael le pasaba la URL a mano. Esta ola es **puro frontend público**: no se
tocó el motor de comisiones ni el webhook, y **no hay SQL ni cambios de schema**.

### La regla que ordena todo

Los montos de comisión se tratan **igual que los precios de los planes**: no se escriben, se leen.
`src/lib/affiliates/public-offer.ts` (nuevo) es la fuente única — resuelve `getPayoutConfig()`
(affiliate_payout_config) + `getResolvedPlans()` (plan_configs) y nunca lanza. Si Rafael cambia $90 a
$100 desde /admin, `/afiliados` lo publica en ≤5 min **sin deploy** (ISR 300, verificado en
`prerender-manifest.json`: `initialRevalidateSeconds: 300`).

El corte server/client se respetó: `public-offer.ts` y `payout.ts` arrastran Prisma y viven sólo en
server components; la calculadora es `"use client"` e importa **sólo** `payout-core` (matemática
pura). Los montos le llegan como props. Mismo corte que plan-shared / plans.

### Qué se construyó

| Archivo | Qué es |
|---|---|
| `src/lib/affiliates/public-offer.ts` | **NUEVO.** Fuente única de la oferta pública: 3 planes con precio real + fijo recurrente + pago único + equivalencia en meses, `topRecurringMxn`, `startAtInvoiceNo`. Degrada a `DEFAULT_PAYOUT_CONFIG` si la tabla no existe. |
| `src/app/afiliados/page.tsx` | **NUEVO.** Landing pública, server component, `revalidate = 300`. Shell de `/herramientas` (SalesNavSession + SalesFooter + Inter + `.mfh` + sales.css). 7 secciones: hero, comisiones, calculadora, cómo funciona, para quién es, FAQ, CTA. |
| `src/app/afiliados/afiliados.css` | **NUEVO.** Todo scoped a `.afi-*`. No toca globals.css. Grids `auto-fit + minmax(min(100%,…))`, tipografía en `clamp()`, cero anchos fijos, cero animaciones nuevas. |
| `src/components/afiliados/landing/calculadora.tsx` | **NUEVO.** Client. `simulateProgram` de payout-core; steppers −/+ accesibles; 3 resultados (al mes / acumulado 12 meses / pago único de golpe). |
| `src/components/afiliados/landing/faq-afiliados.tsx` | **NUEVO.** Client. Acordeón con las mismas clases `.mfh-faq*` de la home; las preguntas llegan por prop. |
| `src/app/terminos-afiliados/page.tsx` | **NUEVO.** Copia el patrón exacto de `/terminos` (mismo `Section`, mismo `PROVIDER`, mismo layout). 9 secciones. |

### Decisiones que vale la pena conocer

- **El FAQ vive en `page.tsx` (server)** y alimenta a la vez el acordeón y el JSON-LD `FAQPage`. Es
  imposible que lo que ve Google y lo que ve el visitante se desincronicen.
- **El aviso del mes promocional NO está escondido.** Es un bloque destacado con icono, no letra
  chica: "La comisión arranca en el segundo cobro de la clínica". El ordinal se **deriva** de
  `startAtInvoiceNo` (helper `cobroOrdinal`): si el admin lo mueve a 3, la página dice "tercer cobro"
  sola. Lo mismo en la calculadora: el acumulado a 12 meses son `12 − (startAt − 1)` pagos, y el
  texto explica por qué son 11 y no 12. Ningún "11" escrito a mano.
- **Se menciona la excepción del plan anual** (comisiona desde su primera factura porque no hay mes
  promocional) — verificado contra `resolveCommission`: `if (invoiceNo < startAt && months < 2)`.
- **Degradación sin ceros feos.** Si un plan está apagado en la config no se lista ni entra en la
  calculadora; si `topRecurringMxn` es 0 el H1 cambia a "Gana una comisión recurrente…" en vez de
  imprimir "$0".
- **`.mfh-fgrid` es de 3 columnas y los pasos son 4** → `.mfh .afi-steps` lo pasa a `auto-fit`
  (especificidad 0,2,0 para ganarle a los `@media` de sales.css, sin `!important`).

### Cada afirmación de la página, verificada contra el código de hoy

| Se dice en /afiliados | Dónde está en el código |
|---|---|
| Comisión recurrente sin límite de tiempo | `resolveCommission` → `kind: "recurring"` en cada `invoice.paid`, sin tope |
| Dos modalidades, la modalidad se congela por clínica | `AffiliateClinicTerms` + `ensureClinicTerms` (inmutable por diseño) |
| Arranca en el segundo cobro (mes promocional) | `startAtInvoiceNo` (default 2) en `payout-core` |
| Link propio + links por campaña | `affiliate_links` con `campaign` (`@@unique([affiliateId, campaign])`) |
| Cupón con su código | tabla `affiliate_coupons` |
| Panel con clics/altas/comisiones en vivo | `/afiliados/estadisticas`, `/api/afiliados/stats` |
| Estado de cuenta en PDF | `/api/afiliados/reportes/estado-cuenta` |
| Equipo de vendedores con su propio % | `AffiliateSeller.commissionPct` + `/afiliados/equipo` |
| El autorreferido está bloqueado | `src/app/api/auth/register/route.ts:116` — anula la atribución, así que no se genera comisión |
| SPEI o PayPal | `PAYOUT_METHODS` del registro / `payoutMethod` |
| Aprobación **manual**, no instantánea | el alta queda en revisión (`/afiliados/pendiente`) |

Nada del Marketplace. Sin ingresos garantizados: la calculadora cierra con "Es una estimación con los
montos vigentes hoy. No es una promesa de ingresos." y la sección de perfiles con "No garantizamos
ingresos: lo que ganas depende de cuántas clínicas recomiendes y de que sigan suscritas."

### Dónde quedaron los enlaces (esto es lo que rompe la invisibilidad)

1. **`sales/v2/landing-data.ts`** (el footer que montan home, blog, /descubre, /casos-de-uso,
   /herramientas y las 8 páginas de módulo):
   - `FOOTER.product` → "Programa de afiliados" → `/afiliados`
   - `FOOTER.legal` → "Términos del programa de afiliados" → `/terminos-afiliados`
   - `navHref()` deja pasar intactas las rutas absolutas (sólo prefija las anclas), verificado.
2. **`public/landing/footer.tsx`** (footer v4 con `COLUMNS`) — **sigue montándose**, en 3 rutas:
   `/roadmap`, `/[slug]` y `specialty-page.tsx`. Se añadió el enlace en la columna "Producto".
3. **`sitemap.ts`** → `/afiliados` (priority 0.8, monthly) y `/terminos-afiliados` (priority 0.3,
   yearly).
4. **Panel de la clínica** → tarjeta discreta al final de **Configuración → Clínica**
   (`settings-client.tsx`, 25 líneas), hermana de la tarjeta "Portal del paciente". Icono `Handshake`,
   sin montos, abre `/afiliados` en pestaña nueva. **Sin gate de plan**: la pantalla sólo pide el
   permiso `settings.view`, así que se ve en todos los planes. Nada de banners ni modales.
5. **`/afiliados/registro`** → ahora es server component: resumen de lo que gana con los montos leídos
   de la config, enlace "← Conoce el programa" y **checkbox obligatorio** de
   `/terminos-afiliados` + `/privacidad` (patrón del signup de clínicas).
6. **`/afiliados/login`** → enlace "Conoce el programa →" bajo el de registro.

### Verificación

- `npm run build` completo, **SIN pipe**, output entero leído → **verde**.
- En el manifiesto compilaron **`○ /afiliados`** (5.66 kB / 205 kB First Load, ISR 300) y
  **`○ /terminos-afiliados`** (215 B / 98.3 kB, estático puro).
- Cero montos escritos a mano en toda la ola (grep de `$<dígito>` sobre los archivos nuevos: sin
  hits fuera de comentarios).
- Los errores `DATABASE_URL not found` del build son los de siempre (no hay `.env` local) y no
  rompen: `getPublicOffer()` cae a los defaults por diseño.

### ⚠️ QUÉ DEBE REVISAR RAFAEL EN PROD

1. **`affiliate_payout_config.defaultMode` TIENE que estar en `"fixed"`.** Es lo más importante de
   esta lista. La página publica montos fijos por plan; si el programa está en modo `"pct"` (niveles
   bronce/plata/oro, el comportamiento histórico), el motor paga un % y **la página estaría
   publicando números que no se pagan**. `/afiliados` no cubre el modo `pct` — no se construyó una
   segunda variante porque el modelo de negocio de esta ola es el fijo. Míralo en /admin →
   "Esquema de pago".
2. **Que `sql/afiliados-comisiones.sql` esté aplicado.** Si la tabla no existe, `getPayoutConfig()`
   devuelve null y la página muestra los **defaults del motor** (40 / 90 / 250 y 350 / 650 / 1400).
   Se ve perfecta y no truena — pero publicaría montos que quizá no son los tuyos.
3. **Abrir `/afiliados` y confirmar que los 6 montos y los 3 precios son los reales**, no los
   defaults. Es la prueba de fuego de los puntos 1 y 2.
4. **Cambiar un monto en /admin y esperar ≤5 min**: la página debe reflejarlo sin deploy (ISR 300).
5. **La afirmación de los 10 días.** "Las comisiones de un mes se pagan dentro de los primeros 10 días
   del mes siguiente" aparece en la página, en el FAQ y en los términos. **No hay nada en el código
   que lo automatice** — es una promesa operativa tuya. Si el calendario real es otro, cámbialo en
   los 3 lugares (`page.tsx` PASOS + faq, `terminos-afiliados/page.tsx` §5).
6. **El checkbox de términos del registro es un gate de UI**, no viaja a la API: no se tocó el body
   del `fetch` a `/api/afiliados/auth/register` para no romper su validación. Es el mismo criterio
   que el signup de clínicas. Si quieres constancia de aceptación, hace falta una columna y una ola
   aparte.
7. **`hola@dalecontrol.com`** es el contacto que quedó en los términos del programa (los de servicio
   usan `soporte@`). Confirma que es el buzón correcto.

### Anotado para después (fuera del alcance de esta ola)

- **`public/landing/footer.tsx` tiene 9 enlaces muertos**: `/integrations`, `/about`, `/contact`,
  `/docs`, `/status`, `/support` y los cuatro `/legal/*` (`/legal/terms`, `/legal/privacy`,
  `/legal/cfdi`, `/legal/nom-024` — los reales son `/terminos` y `/privacidad`). Además sus anclas
  `#features`, `#pricing` y `#specialties` no existen en la home v4 (que usa `#funciones`,
  `#precios`, `#comparativa`). Se montó el enlace nuevo porque el footer **sí sigue vivo** en 3
  rutas, pero esa columna "Legal" no se amplió: arreglar ese footer merece su propia ola.
- En `sales/footer.tsx` la columna "Producto" usa `<a href>` (recarga dura) mientras Legal y Funciones
  usan `<Link>`. Es preexistente; el enlace a `/afiliados` hereda ese comportamiento.
- La tarjeta del panel está en español fijo, sin `t()`, igual que sus dos vecinas ("Portal del
  paciente" y el selector de idioma). Con el panel en inglés se verá en español, como ellas.
- `SELLER_PAYOUT_METHODS` admite un tercer método `"OTHER"` que ni la landing ni los términos
  mencionan (sólo SPEI y PayPal). Si se usa de verdad, hay que añadirlo a los términos §5.

---

## [Afiliados · Correos del alta] — 2026-08-01

Con `/afiliados` recién publicada (`5bb37799`) el hueco empezaba a costar altas reales: nadie se
enteraba de nada. Rafael tenía que entrar a `/admin/affiliates` de casualidad para ver si alguien se
había registrado, y el afiliado no recibía **ningún** correo — ni al registrarse, ni al ser aprobado,
ni al ser rechazado. Se registraba, veía `/afiliados/pendiente` y quedaba en silencio para siempre.

Ola chica: **sin SQL, sin cambios de schema, sin campos nuevos en `Affiliate`**. Los 4 correos viven
en `src/lib/affiliate-emails.ts` siguiendo el patrón de los 5 que ya existían.

### Los 4 correos

| # | Función | Se dispara | Destinatario |
|---|---|---|---|
| 1 | `sendAffiliateApplicationAdminEmail` | POST `/api/afiliados/auth/register` | `ADMIN_NOTIFY_EMAIL` |
| 2 | `sendAffiliateApplicationReceivedEmail` | el mismo registro | el solicitante |
| 3 | `sendAffiliateApprovedEmail` | PATCH `/api/admin/affiliates/[id]` → `APPROVED` | el afiliado |
| 4 | `sendAffiliateRejectedEmail` | el mismo PATCH → `REJECTED` | el afiliado |

**1. "Nuevo afiliado esperando aprobación: <nombre>"** — nombre, correo, método de pago declarado,
fecha en hora de Ciudad de México, y **cuántas solicitudes hay en cola** (`count` de PENDING; si el
count falla el correo sale igual sin ese dato). Botón directo a `/admin/affiliates/<id>`.

**2. "Recibimos tu solicitud ✅"** — dice explícitamente que la revisión es **a mano** y no
automática, que la respuesta llega por correo **"en los próximos días hábiles"** (sin prometer un
plazo que no se cumple) y que si lo aprobamos, en ese correo van su enlace y su código. Enlaza
`/terminos-afiliados` en el cuerpo y `/afiliados` en el botón.

**3. "¡Tu cuenta de afiliado está aprobada! 🎉"** — el que decide si el afiliado empieza a vender.
Es accionable, no un aviso: su enlace `/socio/<slug>`, su código de referido en monoespaciada, los
montos por plan **leídos en vivo** de `affiliate_payout_config`, el recordatorio de que la comisión
arranca en el **segundo cobro** (ordinal derivado de `startAtInvoiceNo`, no escrito) y botón a
`/afiliados/login`.

**4. "Sobre tu solicitud de afiliado"** — corto y respetuoso, sin humillar y **sin inventar un
motivo**: `Affiliate` no tiene `rejectedReason` y no se agregó ninguna columna. Deja
`hola@dalecontrol.com` para quien quiera preguntar. Es el único sin botón.

### Detalles que importan

- **Ni un monto escrito a mano.** El correo de aprobación usa `getPublicOffer()`, la misma fuente que
  la landing. Y va más lejos: los montos **sólo se imprimen si `getPayoutConfig()` devolvió config
  real Y el programa está en modo `"fixed"`**. Si la tabla no está aplicada (fallback a los defaults
  del motor) o el programa está en `"pct"` (se paga un % del nivel, no los fijos), el correo sale
  igual —con enlace y código— pero remite a `/afiliados` en vez de prometer montos que quizá no se
  pagan. Es el riesgo que quedó anotado en la ola anterior, cerrado en el punto donde más dolería.
- **Idempotencia.** El PATCH lee el `status` anterior en un `findUnique` propio y sólo manda correo
  cuando `status !== prevStatus`. Un doble clic o un reintento no manda tres veces "tu cuenta está
  aprobada". Ese select va **aparte** del de `payoutMode` a propósito: `status` es columna de siempre
  y no puede caerse junto con `payout_mode` si esa columna faltara.
- **Nada puede romper el flujo.** Las 4 funciones llevan su `try/catch` interno y jamás tiran; los
  callers usan `void fn().catch(() => {})`, el mismo patrón que `sendAffiliatePayoutPaidEmail`. Un
  fallo de Resend no tumba un registro ya guardado ni una aprobación ya escrita. Sin
  `RESEND_API_KEY`, `sendEmail` cae a su stub que sólo loguea.
- **Estos 4 NO consultan `AffiliatePrefs`.** Esas preferencias (`notifySignup` / `notifyConversion` /
  `notifyPayout`) son para la actividad de referidos; un acuse de solicitud o un aviso de aprobación
  son transaccionales —nadie se da de baja de saber si lo aprobaron— y además el afiliado ni siquiera
  tiene panel donde configurarlas hasta que se le aprueba.
- **`affiliateEmailHtml` creció de forma aditiva**: `extraBox` (segunda caja) y `cta` opcional. Al
  omitirlos, el CTA histórico ("Ir a mi panel →") se conserva, así que **los 5 correos que ya existían
  salen exactamente igual que antes**. No se refactorizó nada más.
- **`SUSPENDED` no manda correo**, decisión deliberada: es una acción que Rafael toma sabiendo lo que
  hace, y avisarla por correo automático invita a una discusión que conviene tener a mano. Si algún
  día se quiere, el hueco está justo al lado del `REJECTED` en el PATCH.

### Env var nueva

**`ADMIN_NOTIFY_EMAIL`** — a dónde llega el aviso #1. **Es opcional**: sin ella el correo cae en
`hola@dalecontrol.com`, así que **no hay que tocar Vercel para que funcione**. Agrégala sólo si
quieres que las solicitudes lleguen a otra dirección (o a varias, si el proveedor lo permite).

### Verificación

- `npm run build` completo, **SIN pipe**, output entero leído → **verde**, sin errores de tipos.
- Los `DATABASE_URL not found` del build son los de siempre (no hay `.env` local).

### Cómo probar cada uno

1. **#1 y #2 juntos** — regístrate en `/afiliados/registro` con un correo real. Deben llegar dos:
   el aviso a `ADMIN_NOTIFY_EMAIL` (o a `hola@`) y el acuse al solicitante. Comprueba que el botón
   del aviso abre la ficha correcta y que el contador de pendientes cuadra con `/admin/affiliates`.
2. **#3** — en `/admin/affiliates`, aprueba esa solicitud. Revisa en el correo que **el enlace
   `/socio/<slug>` abra de verdad**, que el código coincida con el de la ficha, y **que los montos
   sean los tuyos y no los defaults** (40/90/250 y 350/650/1400 son la señal de que la config no se
   está leyendo — ver la ola anterior).
3. **Idempotencia** — vuelve a mandar el mismo PATCH de aprobación (o dale doble clic al botón). **No
   debe llegar un segundo correo.** Es la prueba que más vale la pena hacer.
4. **#4** — rechaza otra solicitud de prueba. Correo corto, sin motivo, sin botón.
5. **A prueba de fallos** — con `RESEND_API_KEY` ausente o inválida, el registro y la aprobación
   deben seguir funcionando igual (en los logs sale `[email stub]` o el error de Resend, pero la
   operación se completa).

---

# Landing pública de afiliados — rediseño (diseño `Afiliados-DaleControl.dc.html`)

Se reemplazó **el contenido visual completo** de `/afiliados` por el diseño que aprobó Rafael.
Sin SQL, sin cambios de schema, sin dependencias nuevas. Build verde y en `main`.

## Qué se reemplazó y dónde quedó cada pieza

| Pieza | Archivo |
|---|---|
| Página entera (10 secciones, JSON-LD, FAQ nativo) | `src/app/afiliados/page.tsx` |
| Calculadora con slider de horizonte (client) | `src/components/afiliados/landing/calculadora.tsx` |
| Las 3 escenas 3D en CSS puro | `src/components/afiliados/landing/escenas.tsx` *(nuevo)* |
| Keyframes, hover/focus, media queries, reset | `src/app/afiliados/afiliados.css` *(reescrito)* |
| Variante `affiliate` del nav compartido | `src/components/public/landing/sales/nav.tsx` + `nav-session.tsx` |
| Acordeón viejo (`.mfh-faq`) | **borrado** — `faq-afiliados.tsx` quedó huérfano al pasar a `<details>` nativo |

El orden de las secciones es el del diseño: hero → "No es cuánto pagamos" → #comisiones →
#calculadora → tres perfiles → #como-funciona → qué recibes → para quién es → #faq → cierre.
Los cuatro ids de ancla se conservan tal cual.

### Lo que se preservó de la página anterior
`revalidate = 300`, el `buildMetadata` completo (title/description/keywords/ogImage),
los tres bloques de JSON-LD, `getPublicOffer()` como única fuente de montos, `SalesNavSession`
y `SalesFooter`, y los 6 CTAs a `/afiliados/registro` + 2 a `/afiliados/login` + los enlaces a
`/terminos-afiliados`. Verificado en el DOM ya renderizado: 6 / 2 / 3 (el tercero de términos lo
aporta la columna Legal del footer compartido, como antes).

### Nav
El diseño traía nav propio. En vez de duplicarlo se le agregó a `SalesNav` una bandera
**opcional** `affiliate` que sólo usa esta página: cambia el grupo de la derecha por
"Ya soy afiliado" + "Registrarme gratis" y agrega la píldora "Afiliados" junto al logo.
Sin la bandera el nav es idéntico al de siempre — verificado en `/` después del cambio:
anclas, "Soy paciente", "Iniciar sesión" y "Crear cuenta" intactos.

## Cero montos escritos a mano

Éste era el requisito duro y se cumplió al 100%. Auditoría: no existe **ni un solo** literal
`$<dígito>` en los tres archivos nuevos (los dos únicos hits del grep son comentarios).
Las 23 cifras distintas que la página imprime salen todas de `getPublicOffer()`:

- **Tarjetas de plan** — los 6 montos y los 3 precios, directo de la config.
- **Escena 3D #1 (prisma)** — las caras `$40 / $90 / $250` se construyen recorriendo
  `offer.plans`; si un plan se apaga, esa cara se sustituye sola por una de herramienta.
- **Escena 3D #2 (pila)** — las 4 tarjetas y el total "$470" se suman de la config.
- **"No es cuánto pagamos"** — `$650` vs `$3,150` calculados; **la altura de las dos barras
  también** (31px y 150px salen de la proporción, no del diseño).
- **Los 3 perfiles** — `$880 / $1,250 / $540`, los chips de desglose y los acumulados
  `$30,800 / $43,750 / $18,900` se calculan desde `mix` + config. Cada total cuadra con su
  propia composición (8×Pro+4×Básico = 880 ✓, 5×Clínica = 1250 ✓, 6×Pro = 540 ✓).
- **Calculadora** — fórmula del diseño íntegra, con los montos parametrizados.

**El "−1" tampoco está escrito.** Sale de `startAtInvoiceNo − 1`, así que si mueves el arranque
en /admin cambian a la vez la fórmula de la calculadora, la nota "(12 × 5 − 1)", el pie de los
perfiles, el texto de "35 cobros" y la redacción del FAQ — y si lo pones en 1, las frases pasan
solas a "cada cobro comisiona", sin `− 0` huérfano.

## Textos que hubo que ajustar para que coincidan con el sistema

Se auditaron las 13 afirmaciones del diseño contra el código. Nueve eran correctas tal cual.
Estas cuatro se corrigieron:

1. **Cupón** — el diseño decía que el código "cuenta la venta aunque no usen tu link", a secas.
   En realidad el afiliado lo *solicita* y nace **inactivo** hasta que un admin lo activa
   (`api/afiliados/coupon/route.ts:101`). Ahora dice *"Al activarlo, tu código acredita la
   venta…"*, tanto en la tarjeta de herramientas como en el paso 3.
2. **Método de cobro** — el diseño afirmaba que se elige SPEI o PayPal al registrarse. El campo
   es **opcional** y trae "Lo defino después". El paso 1 ahora dice *"…o lo defines después"*, y
   el FAQ agrega que se puede cambiar cuando quieras desde el panel (sí existe: PATCH
   `/api/afiliados/me`).
3. **Autorreferido** — "el sistema bloquea el autorreferido" era más fuerte que la
   implementación: la validación compara **el correo**. El FAQ ahora dice *"Si el alta usa tu
   propio correo, el sistema anula la atribución y esa venta no genera comisión"*.
4. **Cambio de modalidad** — el diseño lo daba por hecho, pero depende de
   `cfg.allowAffiliateChoice`; con la bandera apagada el endpoint responde 403. El FAQ y el
   aviso de la sección de comisiones ahora se redactan solos según esa bandera.

Además, el paso 5 ("Sigues todo desde tu panel") dejó de prometer *"en tiempo real"* —los datos
se refrescan al cargar, no hay push— y ahora enumera lo que el panel sí muestra
(clics, altas, activas, pagando, PDF y proyección).

Nota: **el kit de materiales sí existe** y es más completo de lo que decía el diseño
(`src/lib/affiliates-marketing-content.ts`: 8 copys, 6 objeciones, 6 plantillas, logo SVG), así
que ese texto se conservó y se detalló.

**El JSON-LD se actualizó junto con la FAQ.** El diseño cambió preguntas y respuestas, así que el
`FAQPage` se regeneró del mismo array que pinta el acordeón. Verificado en el DOM renderizado:
11 preguntas y 11 respuestas, coincidencia carácter por carácter entre el marcado y lo visible.

## Rendimiento y responsive

- `/afiliados` sigue siendo **estática (`○`)** con ISR: 6.51 kB de ruta, **206 kB** de First Load
  JS — por debajo de la home (213 kB). Al quitar los ~22 iconos de `lucide-react` y pasar todo a
  SVG inline, la página pesa menos que antes del rediseño.
- Sin librerías nuevas, sin WebGL, sin imágenes remotas, sin fuentes extra: `Inter` se declara
  con **los mismos pesos que la landing v4 (400–800)**, así que next/font sirve el archivo que
  la home ya tiene en caché.
- Las 3 escenas animan **sólo `transform`** (cero reflow), llevan `aria-hidden` y se congelan
  enteras bajo `prefers-reduced-motion`.
- **Verificado a 375px en el navegador**: `scrollWidth === clientWidth`, o sea **cero
  desbordamiento horizontal**. Los 3 breakpoints disparan bien (escena 1 a `scale(.72)`, escena 3
  oculta, píldora del nav oculta), las 3 tarjetas de plan se apilan y la calculadora cae a una
  columna. Los 6 botones ± miden **exactamente 44×44**, y las 4 etiquetas de la calculadora
  apuntan a un input real.
- Namespace `dcaf-` en todas las clases y keyframes (`dcafSpin/Sway/Ring/RingRev/Float`): no
  choca con los `dcSpinB/dcPulse/dcMarquee` de `landing-v2.css`, que convive en la misma página.
  No se tocó `globals.css` ni `landing-v2.css`.

## Qué debe revisar Rafael en prod

1. **Que los montos vivos se vean bien.** El build corrió sin BD, así que todo lo que verifiqué
   usa los defaults del motor (40/90/250, 350/650/1400) y los precios de respaldo
   (419/689/1719) — que resultan idénticos a los del diseño. En prod los lee de
   `affiliate_payout_config` y `plan_configs`: vale la pena mirar que las 23 cifras cuadren.
2. **Mover un monto en /admin** y confirmar que en ≤5 min (ISR) cambian a la vez las tarjetas,
   el prisma, la pila, la comparación, los 3 perfiles y la calculadora.
3. **Migraciones**: la página afirma cosas que dependen de `sql/afiliados-ventas.sql`,
   `afiliados-equipo.sql` y `afiliados-comisiones.sql`. Si alguna no está aplicada en prod, esas
   promesas (links por campaña, cupón, equipo, elegir modalidad) son ciertas en el código pero
   no en la práctica. Conviene confirmarlo contra la BD.
4. **Los 10 días de pago** son un compromiso de los términos, no una automatización: no hay nada
   en el código que dispare el pago en esa ventana; el admin lo marca a mano.
5. La rama de trabajo era `feat/landing-v4`; Vercel **no compila ramas `feat/*`**, así que la
   verificación se hizo en local con `next start` y el push fue directo a `main`.

---

## [Fix-Cache-Afiliados] — la landing publicaba comisiones viejas ✅ (2026-08-02)

Bug REAL en producción: la BD ya tenía los montos nuevos (80/140/300 y 400/680/1450, guardados
desde `/admin/affiliates`), `/afiliados/registro` los mostraba bien, y `/afiliados` seguía
publicando 40/90/250 y 350/650/1400 aunque se le cambiara el query string.

### La causa

No era la lectura: `getPublicOffer()` funciona y no tiene caché propia
(`getPayoutConfig()` va directo a Prisma en cada llamada). Era el **caché de página**:

```
src/app/afiliados/page.tsx  →  export const revalidate = 300
```

Con ISR, la página se sirve del HTML ya generado y **sólo se regenera cuando vence su
temporizador**. Guardar en el admin escribía en `affiliate_payout_config` pero no tocaba ese
HTML, así que la landing publicaba la foto vieja hasta que el temporizador expiraba. Por eso
`/afiliados/registro` sí estaba al día: es `force-dynamic`, se renderiza en cada request.
Confirmado en `.next/prerender-manifest.json`, donde `/afiliados` aparece con
`initialRevalidateSeconds`.

### El arreglo — revalidación bajo demanda

Nuevo helper `src/lib/cache/public-pricing.ts` (hermano de `@/lib/blog/revalidate`, mismo
criterio de try/catch por ruta: **la revalidación jamás puede tumbar el guardado**, la config ya
está en la BD y el peor caso es esperar el temporizador). Expone dos funciones y devuelve un
booleano para que el endpoint pueda reportar la verdad:

| Función | Rutas que invalida | Quién la llama |
|---|---|---|
| `revalidateAffiliateLanding()` | `/afiliados` | `PUT /api/admin/affiliates/payout-config` |
| `revalidatePublicPricing()` | `/`, las 17 landings de especialidad, `/afiliados` | `PATCH /api/admin/plan-config/[planId]` |

Y como red de seguridad, `revalidate` de `/afiliados` baja de **300 → 60 s**: cubre el caso de
cambiar la config por SQL directo en Supabase sin pasar por el admin. No cuesta rendimiento —
la regeneración son dos SELECT y las visitas se siguen sirviendo del caché; la página quedó
igual en el build (`○ /afiliados`, 6.51 kB / 206 kB First Load JS, idéntico a antes).

**La página NO se puso en `force-dynamic`**: eso habría tirado el rendimiento que costó llegar
a 94 en PageSpeed. Sigue siendo estática.

### Sí, el mismo patrón afectaba a los precios de los planes

Se revisó y **el problema existía**, no era hipotético. Las tres superficies públicas que
muestran precios de `plan_configs` son ISR (verificado en el `prerender-manifest.json` del
build):

| Ruta | `initialRevalidateSeconds` | Qué muestra |
|---|---|---|
| `/` | 600 | tarjetas de precio de la landing v4 (`buildPlanCards`) |
| `/<especialidad>` × 17 | 300 | `SpecPricing` (`getResolvedPlans`) |
| `/afiliados` | 60 (antes 300) | rótulo "plan de $689/mes" en cada tarjeta de comisión |

O sea: cambiar un precio en `/admin/settings` → Planes se congelaba hasta **10 minutos** en la
home. `clearPlanConfigCache()` ya estaba en ese endpoint, pero sólo limpia la caché **en memoria
de la instancia que atendió el PATCH** — no tiene nada que ver con el HTML cacheado de la
página. Ahora el PATCH también llama a `revalidatePublicPricing()`.

Las **17 landings se enumeran una por una** (desde `SPECIALTY_SLUGS`) en vez de invalidar el
patrón `/[slug]` completo: esa misma ruta sirve las landings de clínica, que no muestran precios
y no hay razón para regenerarlas.

**Fuera del alcance a propósito**: las 8 páginas de producto (`/software-agenda-dental` y
compañía, `revalidate = 3600`) **no listan ningún precio** — se comprobó por grep, no se tocan.

**Límite conocido que queda**: `getResolvedPlans()` tiene además una caché en memoria de 60 s por
instancia. La regeneración disparada por `revalidatePath` puede caer en otra instancia con hasta
60 s de precio viejo. Es el TTL documentado de `lib/plans.ts`, no se tocó: el salto real es de
10 minutos a ≤60 s.

### El admin ya no deja la duda

Rafael perdió tiempo creyendo que el guardado había fallado. Los dos editores ahora lo dicen, y
lo dicen **con la verdad**: los endpoints devuelven `revalidated` y el toast cambia si la
invalidación falló, en vez de prometer algo que no pasó.

- `/admin/affiliates` → *"Esquema de pago guardado · la página pública /afiliados ya muestra
  estos montos"*.
- `/admin/settings` → Planes → *"Plan X guardado · las páginas públicas ya muestran este
  precio"*.

### Archivos

- `src/lib/cache/public-pricing.ts` — **nuevo**, los dos helpers.
- `src/app/api/admin/affiliates/payout-config/route.ts` — `revalidateAffiliateLanding()` tras el
  upsert; responde `revalidated`.
- `src/app/api/admin/plan-config/[planId]/route.ts` — `revalidatePublicPricing()` tras el upsert;
  responde `revalidated`.
- `src/app/afiliados/page.tsx` — `revalidate` 300 → 60 (sólo red de seguridad).
- `src/app/admin/affiliates/affiliates-client.tsx`, `src/app/admin/settings/settings-client.tsx`
  — mensajes de éxito.

Sin SQL, sin cambios de schema, sin tocar el motor de comisiones ni el diseño de la landing.
Ningún monto vive en el código: siguen todos en la BD.

### Verificación

`npm run build` completo y **verde**: 360/360 páginas estáticas, 0 errores de tipos. Los
warnings (`file-type` critical dependency, clases ambiguas de Tailwind) son preexistentes.

**Cómo comprobarlo en prod** — cambia un monto en `/admin/affiliates` (por ejemplo el fijo del
plan Profesional), guarda, y recarga `dalecontrol.com/afiliados` **de inmediato**: debe mostrar
el valor nuevo sin esperar. Ojo con dos detalles al probarlo:

1. La primera visita después de guardar es la que dispara la regeneración. Si Vercel te devuelve
   el HTML viejo en ese primer golpe, **recarga una segunda vez** — es cómo funciona
   `revalidatePath` (stale-while-revalidate), no es que el arreglo falle.
2. Cambian a la vez las 6 tarjetas de comisión, el prisma del hero, la pila, la comparación a 3
   años, los 3 perfiles y la calculadora: todos salen del mismo `getPublicOffer()`.

Para los precios, el mismo ejercicio en `/admin/settings` → Planes: guarda y recarga la home;
el precio nuevo debe aparecer en ≤60 s (el TTL en memoria de `lib/plans.ts`), no en 10 minutos.

---

## [Calculadora de afiliados · horizonte por escalones] — 2026-08-02

El horizonte de la calculadora de `/afiliados` era un slider continuo de 1 a 10 años. Ahora son
**seis escalones** —1 mes · 6 meses · 1 año · 3 años · 5 años · 10 años— manejables con chips o
con el slider. Arranca en **1 año** (antes 5).

Un solo archivo de lógica: `src/components/afiliados/landing/calculadora.tsx`, más el hover de
los chips y el alto del slider en `src/app/afiliados/afiliados.css` y el call site en
`page.tsx` (que ya no pasa horizonte: el default vive en el componente).

### El estado es el ÍNDICE, no los meses

`<input type="range" min="0" max="5" step="1">` corre sobre el índice del escalón, así que los
saltos del slider son parejos aunque los valores no lo sean (de 1 a 6 meses mide lo mismo que de
5 a 10 años). Los seis chips son `<button type="button">` con `aria-pressed`, y **chips y slider
son dos caras del mismo estado**: mover uno marca el otro — verificado en las dos direcciones.

### La matemática

`cobros = max(0, mesesDelEscalón − skip)` y `acumulado = mensual × cobros`. El `skip` sigue
saliendo de `startAtInvoiceNo − 1` (prop `cobrosSinComision`), nunca de un literal: si el admin
mueve el arranque, el "−1" lo sigue solo.

La fórmula visible habla en la unidad del escalón: **"6 meses − 1"** cuando se eligieron 6 meses
y **"12 × 3 − 1"** cuando se eligieron 3 años. Ya no dice "12 × 1 − 1" para horizontes cortos.

**El escalón de 1 mes da $0 y así se publica**, pero explicado en positivo: *"Todavía $0 en 1 mes
— tu primera comisión llega con el segundo cobro de la clínica. A partir de ahí, $X al mes con
todas activas."* El ordinal se deriva de la config (`skip + 1`), no está escrito. El ingreso
mensual y el pago único se muestran normales: ninguno depende del horizonte.

### La gráfica se adapta

1 mes → 1 barra; 6 meses → 6; 1 año → **12 barras por mes**; 3 / 5 / 10 años → 3, 5 y 10 barras
por año, como antes. Nunca pasan de 12, así que no hace falta agrupar ni se encima ninguna. El
pie del eje cambia entre "meses del horizonte" y "años del horizonte", y cada barra usa la misma
fórmula (`mensual × max(0, mesesHastaAhí − skip)`).

Dos arreglos visuales que sólo aparecen con los escalones cortos nuevos:

- **La etiqueta "Pago único" chocaba con la leyenda.** Cuando el pago único va arriba (todo
  escalón corto), su línea punteada queda pegada al borde superior y la píldora se encimaba con
  "Recurrente acumulado". Ahora, por encima del 80%, la etiqueta baja al otro lado de la línea.
- **Una sola barra se estiraba de lado a lado** y parecía una regla, no una barra. Con
  `bars.length === 1` se limita a 96px y se centra; con dos o más no cambia nada.

### Texto de cierre que compara las dos modalidades

Habla siempre del horizonte elegido. Y cuando la diferencia sale negativa —cosa que ahora pasa
seguido con 1 mes o 6 meses— en vez de dejar el número solo dice **en qué mes lo alcanza**:
*"En 6 meses el pago único todavía va arriba. El fijo recurrente lo alcanza en el mes 9 y de ahí
en adelante nunca se detiene."* El cruce se calcula (`skip + ceil(único / mensual)`), no se
teclea.

### Accesibilidad y móvil (medido en el navegador)

- Chips: `<button>` reales de **115×44** en escritorio y **90×44** a 375px, con `aria-pressed` y
  dentro de un `role="group"` etiquetado.
- Slider: `aria-valuetext="3 años"` (nunca el índice crudo) y franja táctil de **44px** de alto,
  con el pulgar a 32px.
- A 375px los seis chips caen en **dos filas de tres** exactas, sin texto recortado y sin
  desbordar: `scrollWidth − clientWidth = 0` en el documento, en la rejilla y en cada chip.

### Verificación

`npm run build` completo y verde: 360/360 páginas, 0 errores de tipos. `/afiliados` sigue
estática (`○`), 7.24 kB de ruta y 207 kB de First Load JS (+0.7 kB por los chips).

Los seis escalones se probaron **en el navegador** contra la página real (`next start`). Ahí no
hay BD, así que los montos son los defaults del motor (40/90/250) → mensual $310. Lo que importa
es el multiplicador, y salió exacto:

| Escalón | Cobros | Acumulado (mensual $310) | Con los montos vivos (mensual $500) |
|---|---|---|---|
| 1 mes | 0 | $0 | **$0** |
| 6 meses | 5 | $1,550 | **$2,500** |
| 1 año | 11 | $3,410 | **$5,500** |
| 3 años | 35 | $10,850 | **$17,500** |
| 5 años | 59 | $18,290 | **$29,500** |
| 10 años | 119 | $36,890 | **$59,500** |

La columna de la derecha es la tabla pedida (1 Básico + 3 Profesional = 1×80 + 3×140 = $500 con
los montos de hoy en la BD): mismos cobros verificados, otro multiplicando. Los montos siguen
llegando por props desde `getPublicOffer()` — ni uno escrito a mano — y el componente sigue
importando sólo de `payout-core`.

---

## [Calculadora de afiliados · el eje cuenta meses COBRANDO] — 2026-08-02

Cambio de **semántica del horizonte**, no de diseño. Antes el escalón medía tiempo desde el alta
de la clínica y por eso la fórmula restaba un cobro (`meses − 1`): el primer mes de la clínica es
promocional y no comisiona. Efecto feo: el escalón de "1 mes" daba **$0**.

Ahora el escalón mide **cuántos meses lleva cobrando el afiliado**. El mes 1 del eje ya es su
primer cobro real (que en la vida de la clínica es el segundo). Las etiquetas visibles no
cambian; lo que cambió es dónde empieza a contar el eje.

    acumulado = mensual × mesesDelEscalón        (antes: mensual × (meses − 1))

Un solo archivo: `src/components/afiliados/landing/calculadora.tsx`.

### Qué se movió

- **Fuera el −1** del acumulado y de cada barra del gráfico. La granularidad no cambia: barras
  por mes hasta 1 año (1, 6 y 12) y por año de 3 en adelante (3, 5 y 10).
- **Fuera el caso especial de $0** ("Todavía $0 — tu primera comisión llega con el segundo
  cobro"): con la fórmula nueva ningún escalón da cero, así que sobraba.
- **Default: 6 meses** (antes 1 año).
- **La fórmula visible es directa**: *"Cálculo: $500 al mes × 6 cobros = $3,000."* Ya no habla de
  "12 × años − 1".
- **El pie del eje dice "meses cobrando" / "años cobrando"**, para que el origen no quede a
  interpretación.

### La regla se sigue diciendo

Correrle el origen al eje no puede servir para esconder que el mes promocional no comisiona.
Debajo del resultado, a la vista: *"El conteo empieza en tu primer cobro, que llega con el
segundo mes de la clínica: el primero entra con precio promocional y no comisiona."*

El texto sale de `cobrosSinComision` (`startAtInvoiceNo − 1`), que ya no entra en la fórmula pero
sigue mandando en la nota: con el arranque en 1 la nota desaparece sola, y con 2 o más el plural
se ajusta. El ordinal ("segundo mes") se deriva, no se teclea.

### ⚠️ Esto es la landing, no el motor

`payout-core.ts` y el webhook **no se tocaron**: ahí el primer cobro de cada clínica sigue sin
comisionar. Lo que cambió es dónde arranca el eje de una estimación para el visitante. Queda
anotado en la cabecera del componente para que nadie confunda las dos cosas.

### Verificación

`npm run build` completo y verde: 360/360 páginas, 0 errores de tipos. `/afiliados` sigue
estática, 7.09 kB de ruta / 207 kB First Load (bajó 0.15 kB al quitar el caso especial).

Los seis escalones, probados en la página real con `next start` (sin BD → montos por defecto del
motor, mensual $310). Lo verificado es el **multiplicador**, que salió exacto —1, 6, 12, 36, 60 y
120, sin restas—:

| Escalón | Cobros | Local (mensual $310) | Con los montos vivos (mensual $500) |
|---|---|---|---|
| 1 mes | 1 | $310 | **$500** |
| 6 meses ← default | 6 | $1,860 | **$3,000** |
| 1 año | 12 | $3,720 | **$6,000** |
| 3 años | 36 | $11,160 | **$18,000** |
| 5 años | 60 | $18,600 | **$30,000** |
| 10 años | 120 | $37,200 | **$60,000** |

También verificado: el pago único NO cambia entre escalones ($2,300 en los seis), la frase que
compara ambas modalidades sigue hablando del horizonte elegido (y el mes de cruce ahora se
calcula sobre el eje nuevo: `ceil(único / mensual)`, sin el arranque), y ya no aparece ningún
"$0" en toda la calculadora. Los chips, el slider, su sincronización y la accesibilidad quedaron
intactos.

---

## [Admin metodo de pago real vs signup]

**Rama:** `fix/metodo-pago-real` → pusheada a `main` (`724a9c92` + `66c2bafd`).
**SQL:** ninguno. No hay columnas nuevas: el dato vivo se lee de Stripe en cada carga.

### El engaño

`Clinic.paymentMethodCollected` / `paymentMethodType` / `paymentMethodLast4` **solo** se
escriben en el alta — `src/app/api/auth/register/route.ts` (~202) y
`register-oauth/route.ts` (~134) — con lo que mandó el formulario. Nada más los vuelve a
tocar: ni el webhook de Stripe, ni el checkout, ni el portal de cliente. Una clínica que se
registró sin tarjeta y después pagó por Stripe Checkout se queda en `false` **para siempre**,
y el panel afirmaba sobre ella "esta clínica no capturó un método de pago". Caso real:
*Menta Dental*, activa y pagando.

### Cambios

**1. Método de pago real (`src/lib/admin/stripe-payment-method.ts`, nuevo).**
`getLivePaymentMethod()` consulta `default_payment_method` de la suscripción y, si no lo
tiene, `invoice_settings.default_payment_method` del customer; extrae marca, últimos 4 y
vencimiento. Solo lectura: no crea, no cobra, no modifica. Timeout de 4 s y
`maxNetworkRetries: 0` por request (el cliente compartido de `@/lib/stripe` trae 15 s × 2
reintentos = hasta 45 s, demasiado para un render) más un plazo duro con `Promise.race`.
**Nunca lanza**: devuelve tres estados — `found`, `none` y `unavailable`. Stripe sin
configurar cae en `unavailable`, no en "sin método". La consulta solo se dispara si hay
`stripeCustomerId`.

**2. Bloque rediseñado (`src/components/admin/clinic-payment-method-card.tsx`, nuevo).**
Se llama "Método de pago" y tiene dos filas que no significan lo mismo:
- *Cobro actual (Stripe)*: "Visa •••• 4242 · vence 11/28" con badge Vigente/Vencida; o
  "Sin método de pago en Stripe" en **ámbar** (la próxima renovación va a fallar); o
  "No se pudo consultar Stripe" en tono **neutro** — no saber no es negar.
- *Capturado en el registro*: lo que mostraba antes, etiquetado como dato del formulario de
  alta, con la nota de que se escribe una sola vez y no implica nada sobre el cobro vigente.
Sin `stripeCustomerId` solo se muestra la segunda fila y se dice que no hay cliente en Stripe.
Salió a su propio archivo para poder renderizarlo aislado (así se verificó) y para no seguir
engordando el `clinic-detail-client.tsx`.

**3. Otras superficies.** La lista (`clinics-client.tsx`) **no** consulta Stripe por fila —
sería una llamada por clínica: el chip del alta ahora dice "· del alta" con `title`
explicativo, y cuando el campo viene vacío se sigue sin pintar nada. En
`/admin/clientes` el campo pasó a "Método de pago (alta)" y ya no responde "No registrado"
cuando hay `stripeCustomerId` (dice "Se cobra por Stripe").

**4. KPIs.** `KpiCard` acepta un `hint` opcional (estilo inline con tokens, sin tocar
`globals.css`). "Ingresos" y "Facturas" llevan subtítulo aclarando que son de la clínica **a
sus pacientes**. Además la pestaña Facturación muestra lo que esa clínica **te ha pagado a
ti**, leyendo `subscription_invoices`: suma de los `paid`, cuántos son, y fecha/monto/método
del último. En `try/catch` y filtrando `paidAt` no nulo (en Postgres un `ORDER BY DESC`
pondría los nulos primero y el "último pago" saldría mal).

### Verificación

- `npx tsc --noEmit` → 0 errores (también sobre el estado intermedio del primer commit).
- `npm run build` → **exit 0**, output completo revisado. Los 162 mensajes
  `Environment variable not found: DATABASE_URL` son el ruido conocido de no tener BD local;
  cero `Failed to compile`, `Type error` o `Error occurred prerendering`.
  Nota: `prisma generate` truena con EPERM porque otro proceso tiene tomado el query engine;
  como `prisma/schema.prisma` no se tocó, el gate se corrió con `npx next build`.
- Render real de los 5 estados en Chrome (página temporal, ya borrada), en tema oscuro:
  tarjeta vigente con signup en `false` (el caso Menta Dental), tarjeta vencida, sin método
  en Stripe, Stripe caído, y clínica sin `stripeCustomerId`. Ninguno rompe la página y el
  único error de consola es el de Vercel Analytics sin red. Los tres KpiCard con `hint`
  miden lo mismo (135 px): el subtítulo no descuadra la fila.

### Pendiente

Medir cuánto engañaba el panel. No hay `DATABASE_URL` en local (ni en el entorno ni en
`.env*`), así que la query quedó sin correr:

```sql
SELECT COUNT(*) AS clinicas_mal_reportadas
FROM clinics
WHERE "paymentMethodCollected" = false
  AND "stripeCustomerId" IS NOT NULL
  AND "subscriptionStatus" IN ('active', 'trialing', 'paid');
```

---

## [Afiliados — bonos por hitos + fuera "La idea en una frase"]

**Commit:** `210d6e7e` (+ este reporte en `5d0af78c`) → pusheado a `main`.
**SQL:** `sql/afiliados-hitos.sql` — **YA APLICADO** en Supabase antes de este commit. El
archivo queda para el histórico (aditivo e idempotente: `ADD COLUMN IF NOT EXISTS`).
**Build:** `npm run build` **exit 0**, log completo revisado (360/360 páginas estáticas; los
166 `Environment variable not found: DATABASE_URL` son el ruido conocido de no tener BD
local). `npm run test:afiliados` **63/63**.

### 🚨 LO QUE NO EXISTE: el cálculo de los hitos

**Esta ola SOLO anuncia los bonos y los deja configurables. El sistema no los calcula, no
avisa cuando alguien llega y no registra los bonos pagados. El seguimiento es MANUAL.**

Para construir el motor haría falta, como mínimo:

1. **Definir "clínica activa" en código.** Hoy la promesa dice "3 mensualidades pagadas y
   suscripción vigente". Eso es un `COUNT` sobre `subscription_invoices` con
   `status = 'paid'` por clínica (ojo: los prorrateos van etiquetados
   `Stripe subscription_update` en `notes` y no deberían contar) cruzado con el
   `subscriptionStatus` de la clínica. `getInvoiceNo()` en `payout.ts` ya resuelve la mitad
   difícil de ese conteo.
2. **Una foto mensual por afiliado.** El bono exige que el número **se sostenga 3 meses
   seguidos**, así que no basta con consultar el presente: hace falta una tabla tipo
   `affiliate_active_snapshot (affiliateId, mes, clinicasActivas)` escrita por un cron
   mensual. Sin histórico, un afiliado que sube a 50 y baja a 40 en el mismo mes es
   indistinguible de uno que se sostuvo.
3. **Registro de bonos entregados**, con el mismo candado atómico que el pago único
   (`claimOneTimePayout` es el patrón): `affiliate_milestone_payout (affiliateId, hito,
   claimedAt, paidAt, mitad)`, porque el hito grande puede pagarse en dos partes. Cada bono
   se entrega **una sola vez** aunque el conteo baje y vuelva a subir.
4. **Verificación de titularidad.** "Cada clínica debe ser un negocio distinto, con su
   propio titular" no es computable con lo que hay: RFC, razón social y titular no están
   normalizados entre clínicas. Por eso la promesa pública dice que DaleControl **verifica
   antes de pagar** — a mano.

Mientras tanto: **si alguien reclama un bono, se revisa y se paga a mano.** No hay nada en
el panel del afiliado que lo prometa ni que lo cuente.

### Cambio 1 — Fuera la sección "La idea en una frase"

Se borró completa la banda azul con "No es cuánto pagamos: es que se repite": las dos
columnas comparando pago único contra recurrente a 3 años, las dos barras y la nota de los
35 cobros. Con ella se fue todo el cálculo que sólo ella usaba (`ref`, `refAcum`,
`refUnico`, `refMax`, `ALTO_BARRA`, `altoAcum`, `altoUnico`, `formulaRef`). `ANIOS_REF` y
`mesesRef` **se quedan**: los usan los tres perfiles de ejemplo y su nota al pie. No había
CSS propio en `afiliados.css` que borrar — la sección sólo usaba `dcaf-balance`, que sigue
vivo en todos los encabezados.

**Ritmo visual verificado en Chrome** (no a ojo): recorriendo `#dcaf-main > section` y
leyendo el `backgroundColor` computado, la página va oscuro → blanco → `#f8fafc` → blanco →
`#f8fafc` → blanco → `#f8fafc` → blanco → oscuro. Ninguna pareja de secciones consecutivas
comparte fondo.

### Cambio 2 — Bonos por hitos en /afiliados

Bajo las tres tarjetas de plan y el recuadro azul del arranque. Tres tarjetas (una columna
en móvil, `1fr 1fr 1.24fr` desde 900px: la de 50 clínicas es **más ancha**, morada
`#6d28d9`, con más sombra y el monto más grande; las otras dos, azules). Cada una lleva
ícono 3D, número de clínicas, monto, "pago único" y una línea de qué significa.

**Ni un número está escrito.** Los seis salen de `affiliate_payout_config` vía
`getPublicOffer().milestones`, incluido el total acumulado ($112,500 = la suma de los tres,
porque son acumulables). Con `milestonesEnabled` en false el bloque entero desaparece.

Debajo, las seis condiciones visibles (no en letra escondida) y el enlace a
`/terminos-afiliados`.

### Cambio 3 — /admin/affiliates

Sub-bloque "Bonos por hitos" dentro de "Esquema de pago": el switch y los seis campos. Al
lado de cada monto, la equivalencia calculada con datos reales — `$100,000 ÷ 50 = $2,000 por
clínica · 22.2 meses del fijo de Profesional ($90)` — igual que las comisiones. Apagado, los
campos siguen editables pero se ven al 55% de opacidad: se puede dejar la promoción lista
antes de encenderla.

Validación en cliente y en el `PUT`: umbrales **enteros y crecientes** (1 &lt; 2 &lt; 3; si no,
**400**) y montos entre 0 y 1,000,000. Auditado con `logAdminGlobalEvent`, con los hitos
también en el `before` (si no, el log diría que aparecieron de la nada en cada guardado).

### Cambio 4 — /terminos-afiliados

Sección nueva con las reglas: las seis condiciones, que DaleControl verifica antes de pagar,
que el bono mayor **puede entregarse en dos partes** (mitad al cumplirse la ventana de 3
meses y mitad tres meses después si el conteo se sostiene) y que las altas fraudulentas o de
negocios relacionados entre sí lo invalidan. Los montos y umbrales se **leen** de la config,
igual que en la landing.

La página pasó de estática a `async` con `revalidate = 600`, y **la numeración de las
secciones se calcula** (`const S = {...}`): con la promoción apagada la sección desaparece y
los términos van del 4 al 5 sin saltos, con las referencias cruzadas ("conforme al
calendario de la sección N") apuntando a donde deben.

### Dónde viven los hitos en el código

En la **misma fila** que el esquema de pago (`affiliate_payout_config`, id=1) pero **fuera
de `PayoutConfig`**, a propósito: `resolveCommission` no los conoce y el motor de comisiones
quedó intacto (de ahí que `test:afiliados` siga en 63/63 sin tocar un test). Contrato nuevo
en `payout-core.ts` (puro, client-safe): `MilestonesConfig`, `DEFAULT_MILESTONES`,
`normalizeMilestones()`, `milestoneTiers()` —ordena por umbral y descarta el escalón con
umbral o monto en 0— y `milestonesTotalMxn()`. En `payout.ts`, `getPayoutSettings()` trae
las dos mitades en **una sola** lectura (las superficies públicas necesitan ambas;
`getPayoutConfig()` sigue igual para el motor).

Degradación intacta: sin la tabla —o sin las columnas nuevas, que Prisma pide en el mismo
SELECT— todo cae a los defaults del DDL y nada lanza.

### Íconos 3D (`src/components/afiliados/landing/hitos.tsx`)

CSS puro, mismo lenguaje que `escenas.tsx`: `perspective` + `preserve-3d`, keyframes
`dcafHito*` en `afiliados.css`, **sólo** `transform` (cero reflow), `aria-hidden`, y el
bloque `prefers-reduced-motion: reduce` que ya existía los congela sin tocar nada. Cero
librerías, cero imágenes, cero WebGL.

- **Regalo** (hito 1): cubo de 4 caras con listones cruzados y moño, balanceo de 18 s.
- **Monedas** (hito 2): 4 discos con `conic-gradient` girando 22 s. Nacieron a `rotateX(74deg)`
  y con 5 discos: en Chrome se veían como un **resorte**, no como una pila. A 62° y con 10 px
  de separación cada canto se distingue.
- **Trofeo** (hito 3): copa con asas, pie y base morada, con dos destellos que giran y
  laten. Es la más llamativa, pero sigue a 20 s: son acento, no espectáculo.

### Verificación

- `npm run build` → **exit 0**, sin `Failed to compile`, `Type error` ni
  `Error occurred prerendering`. `prerender-manifest.json` confirma el ISR de las dos
  páginas: `/afiliados` 60 s, `/terminos-afiliados` 600 s.
- `npm run test:afiliados` → **63/63**.
- Render real en Chrome contra `next start` (sin BD, o sea con los defaults del DDL):
  las tres tarjetas con sus tres íconos, anchos 328/328/**407** px, `$112,500` en el lede,
  las seis condiciones, y `/terminos-afiliados` con las secciones 1→10 sin saltos y los tres
  umbrales impresos desde la config. Sin scroll horizontal.

### Nota de entorno (no del código)

`node_modules/.bin` no existía —restos del clobber del junction del worktree—, así que ni
`npx` ni `npm run` encontraban binarios. Se restauró con `npm install` (38 paquetes
relinkeados, sin tocar `package-lock.json`: el único cambio que metió se revirtió). Además,
un `next start -p 3131` del 2 de agosto tenía tomado el query engine y hacía fallar
`prisma generate` con EPERM; se detuvo, se generó el cliente y se volvió a levantar.

## [Afiliados — el bloque de bonos: regalo, ritmo, serpentina y nombre] — 2026-08-04

**Commit:** ver `git log` de esta fecha → pusheado a `main`.
**SQL:** ninguno. No se tocó el schema, ni el motor de comisiones, ni la calculadora.
**Build:** `npx next build` **exit 0**, log completo revisado (360/360 páginas estáticas; los
`Environment variable not found: DATABASE_URL` son el ruido conocido de no tener BD local).
Se corrió sin `prisma generate` a propósito: el `next start -p 3131` del usuario tenía tomado
el query engine (EPERM conocido) y el cliente generado ya era más nuevo que `schema.prisma`,
así que regenerarlo no aportaba nada y habría exigido matar su servidor.

### 1. El segundo hito ya no son monedas

`HitoMonedas` **se borró entero**, junto con su keyframe `dcafHitoSpin` y la clase
`.dcaf-hito-spin`. A 86 px la pila se leía como unas rayas sueltas: no se entendía qué era.

Los dos primeros escalones comparten ahora `HitoRegalo`, parametrizado con **una sola prop**
(`tono: "azul" | "violeta"`) en vez de duplicar el componente. La variación es mínima a
propósito, para que las dos tarjetas no se lean como copia-pega: el segundo lleva el listón y
el moño en violeta (`#f5f3ff → #ddd6fe`) y un **12 % más de escala**. El cubo NO cambia de
color, porque en la tarjeta los dos escalones son azules.

⚠️ El `scale()` va en la caja EXTERIOR, no en la que anima: `dcafHitoSway` reescribe
`transform` entero y se comería cualquier `scale()` puesto ahí. Como `transform` no provoca
reflow, crecer un 12 % no mueve nada de la tarjeta.

### 2. Ritmo de los íconos: ~40 % más rápidos

Sólo los del bloque de hitos. Las escenas grandes (`.dcaf-spin`, `.dcaf-sway`, `.dcaf-ring*`,
`.dcaf-float*` — hero, pasos y cierre) **conservan su ritmo lento**, que es intencional.

| clase | antes | ahora |
|---|---|---|
| `.dcaf-hito-sway` | 18s | **11s** |
| `.dcaf-hito-float` | 20s | **12s** |
| `.dcaf-hito-sparkle` | 15s | **9s** |
| `.dcaf-hito-sparkle--b` | 19s (delay -7s) | **11.5s** (delay -4.2s) |

Los dos `sparkle` no venían en la lista explícita del encargo, pero llevan el prefijo
`.dcaf-hito-*` y son los destellos del trofeo: dejarlos a 15/19 s mientras su flotación baja a
12 s los descoordinaba. Bajan en la misma proporción.

### 3. Serpentina — `src/components/afiliados/landing/serpentina.tsx` (NUEVO)

La primera vez que la tarjeta grande entra en pantalla, estalla confeti. **Una sola vez por
carga**: el `IntersectionObserver` hace `disconnect()` dentro de su propio callback, así que
subir y bajar no la repite. Es el único `"use client"` del bloque; el resto sigue siendo
server component.

Decisiones que conviene no deshacer:

- **CSS puro.** 38 tiras que animan **sólo** `transform` y `opacity`. Cero librerías, cero
  canvas, cero imágenes.
- **Cero `Math.random()`.** La tabla de tiras sale de tres secuencias deterministas (pasos 17,
  29 y 7, coprimos con 38, así que cada una recorre los 38 valores en desorden). Mismo
  resultado en servidor y cliente → imposible el error de hidratación. Visualmente no se
  distingue del azar.
- **Cero `calc()` en el keyframe.** Las tres paradas del vuelo (arranque, punto más alto,
  caída) se calculan en JS y viajan ya resueltas a nueve custom properties; el centrado lo
  hacen `margin` negativos estáticos. El keyframe queda en
  `translate3d(var(--dcaf-xa), var(--dcaf-ya), 0)` pelado.
- **`isIntersecting` NO basta.** Se pone en `true` con un solo píxel visible, sin importar el
  `threshold`: sin mirar también `intersectionRatio`, la serpentina salía al asomar el borde
  superior de la tarjeta. El callback exige `ratio >= 0.38`.
- **`prefers-reduced-motion: reduce` la cancela ENTERA**, ni atenuada: se comprueba antes de
  observar, así que no se dispara nunca. El reset de `afiliados.css` ya apaga toda animación
  dentro de `.dcaf-root`, pero eso habría dejado 38 nodos congelados a media pantalla.
- **Se vacía al terminar** (2 600 ms): no quedan 38 nodos animando de fondo.
- El contenedor es `position: absolute` + `pointer-events: none` + `aria-hidden`.

### Verificación en Chrome (`next start` en un puerto aparte, sin BD)

El `IntersectionObserver` **no se pudo disparar de verdad**: la pestaña del automatismo se
queda en `visibilityState: "hidden"` y Chrome no la pinta, así que ni un IO de prueba dispara
(gotcha ya conocido). Se verificó todo lo demás inyectando las mismas 38 tiras y midiendo:

- Keyframe `dcafSerpentina` resuelto; vuelo muestreado con la Web Animations API:
  `0% (0,0) op 0 escala .3` → `14% (32,-25) op 1` → `46% (84,-63)` = el punto más alto, que
  coincide **exacto** con `--dcaf-xb/yb` → `80% (92,2)` → `100% (106,112) op .09`. La caída
  acelera, como debe.
- Duración total **1.45–2.28 s** (delay incluido).
- **Excursión horizontal máxima: 112 px** contra los 165.5 px de media tarjeta a 375 px de
  viewport → ninguna tira se sale por los costados. `scrollWidth` **2737 → 2737**: cero scroll
  horizontal.
- **CLS 0**: alto de la tarjeta **331 → 331 px** con las 38 tiras dentro.
- Íconos: 2 × `dcaf-hito-sway` a 11 s (el segundo con `matrix(1.12,…)` y el listón violeta),
  1 × `dcaf-hito-float` a 12 s, y **0** `dcaf-hito-spin`.

### 4 y 5. El rótulo: «Bonos por hitos» → «Bono por Clínicas Activas»

Ni un monto ni un umbral se escribieron a mano: el «3» sigue saliendo de
`hitos.tiers.length` y el total de la suma calculada. Sólo se agregó la palabra «bonos»
después del número («…habrá cobrado los **3 bonos**, $112,500 en total»).

El rótulo aparecía en más sitios de los cuatro archivos del encargo, y se dejó consistente:

- `src/app/afiliados/page.tsx` — kicker de la sección.
- `src/app/admin/affiliates/affiliates-client.tsx` — título de la sección y el checkbox
  («Anunciar el bono por clínicas activas en la página pública»).
- `src/app/terminos-afiliados/page.tsx` — encabezado de la sección 5 y la `description` del
  metadata. Va con los otros porque el bloque de la landing **enlaza ahí**: el rótulo tenía
  que coincidir al llegar. No hay ancla ni id derivados del título, así que no rompe enlaces.
- Comentarios de código de esos archivos, más `afiliados.css`.

El kicker se sigue **renderizando** en mayúsculas (`BONO POR CLÍNICAS ACTIVAS`): el
`textTransform: uppercase` es del estilo `KICKER` compartido por todas las secciones de la
landing, igual que antes con «Bonos por hitos». En el código el texto está tal cual se pidió.

### Lo que sigue sin existir

Igual que en la ola anterior: **nadie calcula ni paga estos bonos**. Sigue siendo un anuncio
configurable desde `/admin/affiliates` y el seguimiento es manual.

---

## Avisos flotantes en la landing de afiliados (`/afiliados`)

Tarjeta chica en la **esquina inferior izquierda** que entra deslizándose, se queda unos
segundos y se va. Luego otra, con ritmo irregular. Ola chica: **sin SQL, sin schema, sin tocar
el motor de comisiones**.

- `src/lib/affiliates/public-activity.ts` — decide el modo y redacta los mensajes (server).
- `src/components/afiliados/landing/avisos.tsx` — pinta y cronometra (client).
- `src/app/afiliados/afiliados.css` — bloque `dcaf-aviso*` (namespace propio, como el resto).
- `src/app/afiliados/page.tsx` — una llamada y un `<AvisosFlotantes>` dentro de `.dcaf-root`.

### Qué modo está activo hoy: INFORMATIVO

El widget elige solo, en el servidor, y hoy sale **modo informativo**: el modo real necesita
**3 o más comisiones en `affiliate_commissions` de los últimos 90 días** y todavía no las hay.
No hay nada que encender ni configurar — en cuanto existan tres comisiones recientes, la
siguiente regeneración de la página (ISR, 60 s) empieza a publicar eventos reales sola.

| | Modo INFO (hoy) | Modo REAL |
|---|---|---|
| Se activa | por defecto | ≥ 3 comisiones en 90 días |
| Qué dice | cómo funciona el programa | comisiones que existen de verdad |
| Segunda línea | no tiene | fecha relativa (+ estado, si se puede) |

Son **10 mensajes** en modo info y hasta **10** en modo real.

### Reglas de privacidad aplicadas (modo real)

- **Al navegador no baja ni un id, correo, nombre ni fecha exacta.** El server manda la frase
  ya redactada y nada más; `affiliateId`/`clinicId` no salen de `public-activity.ts`.
- **El estado sólo aparece con 5+ afiliados distintos** comisionando en la ventana. Con dos
  afiliados en el programa, decir «Jalisco» es señalar con el dedo. Por debajo de ese umbral
  la tarjeta dice sólo «Un afiliado».
- **Fechas relativas y redondeadas** («esta semana», «hace unas semanas»), nunca el día.
- **Máximo 2 tarjetas por afiliado**, para que el ciclo entero no permita reconstruir la
  actividad de una sola persona. Si tras ese tope quedan menos de 3, se cae a modo info.
- **Ninguna tarjeta afirma que alguien cobró si no cobró**: el verbo lo manda el `status` de
  la fila. `paid` → «Un afiliado cobró $140 por una clínica del plan Profesional»; cualquier
  otro status → «Comisión de $140 por una clínica del plan Profesional», sin sujeto cobrando.

### GOTCHA: `Affiliate` no tiene estado; el que se publica es el de la CLÍNICA

El encargo pedía «Un afiliado **en Jalisco** cobró…», pero **`Affiliate` no tiene columna de
ubicación** — sólo `Clinic` tiene `state`/`city`. Atribuirle al afiliado el estado de la
clínica sería inventar un dato que la BD no guarda, así que la frase publica **el estado de la
clínica** y el estado viaja en la **segunda línea**, no en la principal:

```
Un afiliado cobró $140 por una clínica del plan Profesional
Jalisco · esta semana
```

Si algún día se le pide el estado al afiliado en el registro, el cambio es de una línea.

### Los montos: ni uno escrito a mano

Todo sale de `getPublicOffer()` (plan_configs + affiliate_payout_config), igual que el resto
de la página: si Rafael cambia $140 por $160 en `/admin`, estas tarjetas cambian solas. Los
mensajes de bono **sólo salen con `milestonesEnabled` encendido**, y de más de dos escalones
se publican el primero y el grande, para no comerse el ciclo con bonos.

### Comportamiento

- Primera tarjeta a los **6–8 s**; cada una dura **5–6 s**; pausa **variable de 9–18 s**.
  Todo sorteado tarjeta por tarjeta: un intervalo fijo delata el widget en tres apariciones.
- **Una sola a la vez**, ciclo infinito, sin repetir el mismo mensaje dos veces seguidas; al
  agotar la lista se rebaraja (y si la primera de la nueva ronda es la que se acaba de ver, se
  cambia por la siguiente).
- Se **congela con `document.hidden`** y sigue al volver a la pestaña.
- **Hover o foco dentro** detienen el temporizador de salida. El foco cuenta además para que
  la tarjeta no se desmonte con el botón de cerrar enfocado y el foco se caiga al `body`.
- La **×** la apaga para el resto de la sesión (`sessionStorage: dcaf-avisos-off`).

### Decisión de móvil: por debajo de 480px NO se muestra

Evaluado y descartado a propósito. En esa franja la tarjeta ocupa casi un tercio del alto útil
y **no hay forma de garantizar que no tape lo que se está leyendo**; un aviso decorativo no
vale eso. Lo esconde el CSS (`@media (max-width: 479px) { display: none }`) y además el
componente **ni programa su reloj** ahí (mismo breakpoint por `matchMedia`, con listener por si
se rota el aparato).

Entre **480 y 767px** sí sale, a ancho casi completo (12px de margen), y ahí vigila los botones
«Registrarme gratis»: mide `a[href^="/afiliados/registro"]` y, si uno cae en la franja de 132px
de abajo, la tarjeta se va o no llega a salir. Se busca por `href` y no por una marca en el
JSX para no depender de que alguien recuerde etiquetar cada botón nuevo.

### Movimiento reducido, CLS y accesibilidad

- **`prefers-reduced-motion: reduce` → aparición directa, sin deslizamiento.** No hizo falta
  una regla nueva: el reset de `afiliados.css` ya apaga toda animación bajo `.dcaf-root`. La
  clave es que **el estado base de la tarjeta es el visible** y la entrada es un keyframe que
  la trae desde fuera; al revés se quedaría congelada en `opacity: 0`.
- **CLS 0**: el contenedor es `position: fixed`, está fuera del flujo y no puede empujar nada.
  Sólo se animan `transform` y `opacity`.
- `role="status"` + `aria-live="polite"` en un contenedor que **vive siempre en el DOM** aunque
  esté vacío: un `aria-live` que se inserta junto con su contenido no se anuncia.
- Cerrar tiene `aria-label`, foco visible propio (el de la página está acotado a `.dcaf-main`
  y esto vive fuera) y **nunca se roba el foco**.
- `z-index: 40`: por debajo del nav sticky (60) y de cualquier modal.
- Nada de `Math.random()` en el render: el sorteo, el `sessionStorage` y el `matchMedia` viven
  todos dentro de `useEffect`. El primer render —servidor y cliente— es el contenedor vacío.
- La consulta a Prisma va en try/catch: si falla, cae a modo informativo y la página carga
  normal. Importa, porque **la landing se prerenderiza en el build, donde no hay BD**.

### GOTCHA: la columna de texto son 236px, y los mensajes están MEDIDOS

Con icono de 34, gap de 11 y fuente de 13.5 la columna se quedaba en **223px** y **5 de los 10
mensajes se cortaban a media frase** («…y asignarles su…»). El clamp de dos líneas hacía su
trabajo, pero el resultado se leía como un bug. Se corrigió por los dos lados:

- Medidas de dentro: icono 30, gap 9, padding 12, botón 22, fuente 13px/1.42 → **236px**.
- Copy más corto («Se paga dentro de los primeros 10 días…», «Registra a tus propios
  vendedores…») y el estado movido a la segunda línea en modo real.

Verificado en el navegador contra la caja real: **0 de 12 mensajes** (los 10 informativos más
las dos variantes del modo real) desbordan. **Si tocas cualquiera de esos cuatro números o
alargas un mensaje, vuelve a comprobarlo en pantalla.**

### Verificación en Chrome (`next dev` en un puerto aparte, sin BD)

- Tarjeta a 20px del borde izquierdo y 20px del inferior, 330px de ancho, `z-index` 40,
  `position: fixed`. Fondo blanco, radio 14px, icono azul a la izquierda, × a la derecha.
- **Hover congela la salida**: la tarjeta siguió viva **13 s** (contra los 5–6 s de vida).
- **Cerrar**: desaparece el contenedor entero, `sessionStorage` queda en `"1"`, no revive a los
  9 s y **sigue apagada tras recargar**.
- **Franja de CTA**: la geometría detecta en los dos sentidos (CTA dentro de los 132px de abajo
  → `true`; lejos o quitado → `false`).
- **El ciclo**, con un `MutationObserver` durante 112 s: **4 tarjetas, las 4 distintas**, cero
  repeticiones seguidas y **nunca más de una en pantalla** (`maxSimultáneas: 1`).
- Las tres reglas CSS confirmadas desde el CSSOM (base / ≤767px / ≤479px) y el selector de
  CTAs encuentra los **6** «Registrarme gratis» de la página.

**GOTCHA de verificación** (primo del ya conocido con `IntersectionObserver`): la pestaña del
automatismo se queda en `visibilityState: "hidden"` y Chrome **no la pinta**, así que el
`document.hidden` del propio widget lo congela y no sale ni una tarjeta. Hay que parchear
`Object.defineProperty(document,'hidden',{get:()=>false})` — y aun así Chrome **estrangula los
timers a ~1/s**, con lo que los tiempos se ven al doble de lo que son. El `.html` prerenderizado
de `.next/server/app/` **no sirve para comprobar esto**: está desactualizado (tampoco tiene la
serpentina, que lleva en `main` desde antes).

### Build

`next build` verde, sin pipe. `/afiliados` sigue **estático** (`○`), 9.34 kB / 209 kB de First
Load JS. **`prisma generate` se saltó a propósito**: un `next start` del propio Rafael en el
puerto 3131 tiene tomado `query_engine-windows.dll.node` y el paso muere con EPERM (gotcha ya
conocido). Esta ola **no toca el schema**, así que el cliente generado ya era el bueno y
`next build` —que es el gate real: tipos + compilación + prerender de las 360 páginas— corrió
entero. Si hiciera falta regenerar, hay que cerrar antes ese servidor.

### Lo que NO se hizo

No se tocó el motor de comisiones, la calculadora ni `globals.css`. No hay librerías nuevas, ni
SQL, ni cambios de schema. **Nadie calcula ni paga nada distinto por esto**: es sólo una
superficie de lectura.

## [Afiliados — segundo tipo de aviso flotante: el sueldo mensual] — 2026-08-04

El widget de la esquina de `/afiliados` ya no dice sólo cómo funciona el programa: ahora
alterna con mensajes que dicen **cuánto se cobra al mes** con tantas clínicas activas. Ola
chica: **sin SQL, sin schema, sin tocar el motor de comisiones ni la calculadora**.

- `src/lib/affiliates/public-activity.ts` — la tabla `SUELDOS` y `avisosSueldo()` (server).
- `src/components/afiliados/landing/avisos.tsx` — el tipo `AvisoTipo`, el icono `grafica` y
  `intercala()`, que es quien hace la mezcla (client).

### Los DOS tipos de mensaje y de dónde salen los números

| | `regla` | `sueldo` |
|---|---|---|
| Qué dice | una condición del programa | lo que se cobra al mes |
| Ejemplo | «Se paga dentro de los primeros 10 días del mes siguiente» | «Una persona con 18 clínicas del plan Profesional cobra $2,520 al mes» |
| Icono | moneda / regalo / calendario / escudo / personas | **barras ascendentes** (nuevo) |
| Cuántos | hasta 10 (3 planes + 2 hitos + 5 fijos) | hasta 10 recetas |

**Ni una cifra escrita a mano, en ninguno de los dos.** Todo sale de `getPublicOffer()` —
precios de `plan_configs`, montos de `affiliate_payout_config`—, así que si Rafael mueve el
fijo del Profesional de $140 a $160 en `/admin`, **los diez sueldos se recalculan solos** en la
siguiente regeneración de la página (ISR, 60 s, o al instante si el cambio pasa por el admin,
que revalida).

Cada receta es una **mezcla** (`18 × PRO`, `15 × PRO + 10 × BASIC`) y el monto es
`Σ cantidad × fijo recurrente del plan`. La frase **tampoco teclea la cantidad**: la lee del
mismo contexto que calculó el monto, así que texto y número no se pueden desincronizar. Si un
plan de la receta está **apagado** en `/admin` (fijo en 0), la receta se descarta **entera** —
quitar sólo esa parte dejaría «25 clínicas» al lado del monto de 15.

Verificado contra el `.rsc` prerenderizado (config por defecto, 40/90/250): los 10 cuadran —
`18×90=1,620`, `30×40=1,200`, `12×250=3,000`, `1×90=90`, `45×40=1,800`, `5×250=1,250`,
`8×90=720`, `15×90+10×40=1,750`, `10×90+6×250=2,400`, `20×40=800`.

### Cómo están redactados (y por qué así)

- **Presente genérico y sujeto indefinido**: «cobra», «se cobran», «deja». Describen la
  mecánica del programa, no algo que le pasó a alguien.
- **Sin marcas temporales** («hace 28 minutos», «hoy») y **sin nombres, correos, iniciales ni
  ciudades**. No son eventos: son la tabla de comisiones dicha en pesos.
- Tono de dato: ni un signo de exclamación.
- **Largo medido**, igual que las reglas: el más largo son **68 caracteres** con las etiquetas
  de plan de hoy, por debajo de los 71 que caben en los dos renglones de la tarjeta (236px de
  columna, ver el bloque `dcaf-aviso*` de `afiliados.css`). Alargar uno no rompe nada, pero el
  clamp lo corta a media palabra.

### La mezcla: `intercala()` en vez de la baraja a secas

El widget barajaba la lista y ya. Con dos tipos eso encadena tres reglas seguidas cada dos por
tres, así que cada tarjeta trae ahora su `tipo` y la cola se arma con el **voraz de
«reorganizar sin adyacentes iguales»**: en cada paso se toma del montón más grande que no sea
el del tipo recién usado. Detalles que importan:

- **La costura entre vueltas cuenta.** El tipo de la última tarjeta mostrada (`ultimoTipo`)
  entra como semilla de la vuelta siguiente; sin eso, la repetición aparece justo en el punto
  que nadie mira al probarlo.
- **Degrada, no rompe.** El **modo real es de un solo tipo**: ahí no hay alternancia posible y
  el voraz cae a la baraja de siempre en vez de quedarse sin tarjetas.
- Con los **10 y 10** de hoy la alternancia es perfecta (comprobado: 10.000 tarjetas simuladas,
  **0** del mismo tipo seguidas). Si el admin apaga los hitos (8 reglas + 10 sueldos) salen 2
  adyacentes por vuelta, que es el **mínimo teórico** de ese reparto (`2M − n`), no un fallo.
- El tope pasó a ser **por tipo** (`MAX_POR_TIPO = 10`) y no sobre el total: un tope común
  dejaría pasar 9 reglas y 1 sueldo, y la mezcla se iría al garete. El modo real conserva el
  suyo (`MAX_REALES = 10`).

Total del ciclo en modo info: **20 tarjetas** (antes 10). Son ~6 min de vuelta completa, así
que un visitante normal **no ve ninguna repetida**.

### Alcance heredado: esto publica los montos FIJOS

Como **toda** la landing, estos mensajes asumen el programa en modo `fixed` (montos por plan).
En modo `pct` (% del nivel) la página entera diría otra cosa, no sólo estas tarjetas — la
limitación es la de siempre, no se amplía ni se arregla aquí.

### Build

`next build` verde, sin pipe. `/afiliados` sigue **estático** (`○`), 9.56 kB / 209 kB de First
Load JS. **`prisma generate` se saltó otra vez a propósito**: el `next start` de Rafael en el
puerto 3131 tiene tomado `query_engine-windows.dll.node` y el paso muere con EPERM. Esta ola no
toca el schema, así que el cliente ya era el bueno y `next build` —tipos + compilación +
prerender de las 360 páginas— corrió entero. Los `prisma:error` de `DATABASE_URL` durante el
prerender son los de siempre (no hay `.env` local) y los come el `try/catch`, que es
justamente lo que deja la página en modo info.

### Lo que NO cambia

El **modo real** sigue igual: con 3+ comisiones en `affiliate_commissions` el widget cambia
solo a datos verdaderos, con sus reglas de privacidad intactas (nada de ids, estado sólo con
5+ afiliados, máximo 2 por afiliado). Los **ajustes de ritmo** (6-8 s la primera, 5-6 s de
vida, 9-18 s de hueco) y el **tope de retención por hover** quedaron sin tocar, igual que
`globals.css`, el motor de comisiones, la calculadora y los hitos.

---

## [Sello «Datos cifrados» · footers públicos + login] — 2026-08-04

Commit **`9a1ed79e`** en `main` (directo, sin PR). Sin SQL, sin envs, sin dependencias.

### Archivos

- **`src/components/public/landing/primitives/secure-badge.tsx`** — NUEVO. Componente de
  presentación puro: sin `"use client"`, sin estado y sin efectos, para que sirva igual en los
  dos footers (server) y dentro del login (client) sin arrastrar a nadie al bundle de cliente.
- **`src/components/public/landing/sales/footer.tsx`** — `<SecureBadge tone="dark" />` entre el
  `©` y «Hecho en México», más `alignItems: "center"` en esa barra (sin él la pastilla se
  estiraba a la altura de la fila en vez de quedar centrada).
- **`src/components/public/landing/footer.tsx`** — `<SecureBadge tone="token" />` como hijo del
  medio de `.ld-footer-bottom`: queda `[logo + ©] · [sello] · [redes]`. No se tocó su CSS; el
  media query de 768px que pasa esa fila a columna ya funcionaba con tres hijos.
- **`src/components/public/auth/login/login-form.tsx`** — el sello en versión `light` justo
  debajo del `</form>` y antes de «¿No tienes cuenta?». La lógica de fail-ban quedó intacta.

### El copy es el que se puede sostener con el código

«Datos cifrados» + «TLS + AES-256». Es lo verificable: TLS en tránsito, AES-256 en reposo y el
sobre AES-256-GCM de `src/lib/crypto/envelope.ts`. **Nada de «100% seguro», «extremo a extremo»
ni «certificado»**: no son ciertos y son reclamables. El `title`/`aria-label` dicen la frase
larga («Cifrado TLS en tránsito y AES-256 en reposo») para que el lector de pantalla no reciba
sólo la sigla.

### Tres tonos porque son tres fondos

`dark` con hex fijos para el `SalesFooter` (#080d1a); `token` con los `--ld-*` para el footer
viejo, que vive bajo el tema de la landing y seguiría el tema si esas páginas dejaran de ser
oscuras; `light` para la tarjeta blanca del login. Bajo **380px** el `@media` local del
componente esconde el separador y «TLS + AES-256» y deja sólo «Datos cifrados» — ahí `@media` sí
es correcto: no hay sidebar que cambie el ancho real del contenedor (footer a todo lo ancho,
tarjeta de login ocupando casi el viewport).

### Presupuesto: cero peso extra

El icono va **inline como SVG**, no como archivo: ni una request más, ni PSI móvil ni CLS
tocados. No se editaron `globals.css` ni `landing-v2.css`, no hay `href` (el sello **no** es un
enlace) y ningún otro copy de la landing cambió.

### Build

`npm run build` completo y **verde**, sin pipe: `prisma generate` OK, tipos OK, **360/360**
páginas prerenderizadas y tabla de rutas impresa. Los `prisma:error` de `DATABASE_URL` del
prerender son los de siempre (no hay `.env` local). Warnings preexistentes sin relación: las 3
clases ambiguas de Tailwind y el `Critical dependency` de `file-type`.

### Dónde se ve ahora el sello

- **`SalesFooter`** → home, blog, `/casos-de-uso`, `/herramientas`, `/descubre`, las 8 páginas de
  módulo y `/afiliados`.
- **`Footer`** → páginas de especialidad `/[slug]` y `/roadmap`.
- **Login** (`/login`) → dentro de la tarjeta blanca, bajo el botón de «Iniciar sesión».

---

## [Sello «Datos cifrados» · /signup] — 2026-08-04

Commit **`4b033861`** en `main` (directo, sin PR). Continuación de `9a1ed79e` (footers + login).
Sin SQL, sin envs, sin dependencias.

### Archivo tocado (uno solo)

**`src/components/public/auth/signup/signup-form.tsx`** — el import de `SecureBadge` y un bloque
de 5 líneas. **6 inserciones, 0 borrados**: no se tocó `handleSubmit`, ni el `submitLockRef`, ni
el tracking de conversión (`trackSignupConversionAndRedirect`), ni el `Stepper`, ni ninguno de
los tres `step-N-*.tsx`, ni un solo copy existente.

### Por qué se ve en los 3 pasos

El sello va como **último hijo del contenedor raíz** del `return` (el `<div>` con
`flexDirection: "column", gap: 24`), **fuera** de los tres `{step === N && (…)}`. Ese div se
renderiza siempre, así que el sello no depende del paso: queda debajo del bloque activo, sea el
de cuenta, el de clínica o el de plan y pago — que es justo donde más pesa, porque es el paso
donde el usuario mete la tarjeta. Como cuelga del contenedor con `gap: 24`, hereda la
separación del formulario sin margen propio.

`tone="light"` porque `AuthShell` pinta la tarjeta en blanco (#ffffff), igual que el login. El
sello **no es un enlace** (sin `href`), y `globals.css` / `landing-v2.css` quedaron intactos.

### Verificación previa

`git checkout main && git pull origin main` trajo la rama local **39 commits atrás** hasta
`9a68043c`, y ahí se confirmó que `src/components/public/landing/primitives/secure-badge.tsx`
**sí existe** — el requisito para no duplicar el componente. El paso 0 pedía detenerse si
faltaba; no fue el caso.

### Build

`npm run build` completo y **verde**, sin pipe: `prisma generate` OK, tipos OK, **360/360**
páginas prerenderizadas. `/signup` pasó de **17.2 kB → 17.3 kB**, con el **First Load JS igual
en 224 kB**: el icono va inline como SVG y el componente no arrastra dependencias. Los
`prisma:error` de `DATABASE_URL` del prerender son los de siempre (no hay `.env` local), y los
warnings (3 clases ambiguas de Tailwind, `Critical dependency` de `file-type`) son
preexistentes.

### Estado del sello tras esta ola

Las dos superficies de autenticación cubiertas — **`/login`** y **`/signup`**, ambas en versión
`light` — más los dos footers públicos de `9a1ed79e` (`SalesFooter` en home, blog,
`/casos-de-uso`, `/herramientas`, `/descubre`, las 8 páginas de módulo y `/afiliados`; `Footer`
en las especialidades `/[slug]` y `/roadmap`).

---

## Afiliados · Un dueño de clínica ya puede registrarse como afiliado (vinculación)

### El bug

`POST /api/afiliados/auth/register` paso (d) llamaba a `auth.admin.createUser({ email, password })`.
Afiliados y usuarios de clínica viven en el **mismo** proyecto de Supabase Auth, así que si el
correo ya existía —porque esa persona es dueña o staff de una clínica— Supabase devolvía
`email_exists` y el endpoint cortaba con un **400 "Este email ya tiene una cuenta"**: un error
muerto, sin salida. La persona con más razones para ser afiliado (un cliente que ya usa y confía
en el producto) era justamente la que no podía registrarse — y el enlace desde Configuración del
panel llevaba directo a ese muro.

Ser cliente y ser afiliado son **roles independientes**. Una misma persona puede tener ambos.

### La trampa de seguridad, y cómo se evitó

El arreglo ingenuo —"si el correo existe, reutiliza ese usuario"— es un **secuestro de cuentas**:
el formulario pide contraseña, así que cualquiera que conociera el correo de un dentista podría
mandar el registro de afiliado con una contraseña nueva y quedarse con su cuenta de clínica.

Regla aplicada, sin excepciones: **si el correo ya existe en Supabase Auth, el registro no crea
usuario, no cambia la contraseña y no toca esa cuenta de ninguna forma.** La única vía es que la
persona demuestre que es dueña del correo **iniciando sesión**.

Cómo se sostiene en el código:

- `/api/afiliados/auth/link` (la ruta que da de alta al que ya existe) **no importa el admin
  client de Supabase**. No hay `createUser`, ni `updateUserById`, ni `deleteUser` en todo el
  archivo: sólo `INSERT` en `affiliates` y `affiliate_users`. La contraseña es inalcanzable desde
  ahí.
- El `supabaseId` y el correo salen de `supabase.auth.getUser()` — sesión **verificada contra el
  servidor de Auth**—, nunca del body. El body sólo aporta nombre y datos de pago.
- El rollback best-effort de `deleteUser` sigue existiendo **sólo** en el registro normal, y sólo
  sobre `created.user`, el usuario que ese request acaba de crear. La rama del correo preexistente
  sale antes de llegar ahí, así que nunca puede borrar a un usuario que ya estaba.

### Los tres casos del registro

`POST /api/afiliados/auth/register` ahora distingue:

| Caso | Detección | Respuesta |
|---|---|---|
| (a) Correo nuevo | `createUser` OK | 201 — flujo de siempre, intacto |
| (b) Ya es afiliado | `Affiliate.email` (@unique) existe | 400 `{ error, loginUrl: "/afiliados/login" }` |
| (c) Existe en Auth, **no** es afiliado | `createUser` → `email_exists` | **409 `{ needsLogin: true, linkUrl }`** |

**Por qué se detecta por el error de `createUser` y no con una búsqueda.** El SDK instalado
(`@supabase/supabase-js ^2.45`) expone `admin.listUsers({ page, perPage })` **sin filtro por
correo** — lo verifiqué en `node_modules/@supabase/auth-js/.../GoTrueAdminApi.js`: sólo manda
`page` y `per_page`. Recorrer todas las páginas de usuarios en cada registro no es viable. Usar
`createUser` como sonda es seguro porque es un `INSERT` puro: ante un correo repetido devuelve
422 `email_exists` y **no modifica** al usuario existente. La detección (`isEmailTakenError`) mira
el `code` (`email_exists` / `user_already_exists`) y, como red, el mensaje.

El caso (b) se resuelve por `Affiliate.email` porque **todo `Affiliate` nace junto a su
`AffiliateUser` en la misma transacción** (`createAffiliateAccount`) — no existen afiliados
huérfanos. El chequeo por `supabaseId` vive donde sí hay identidad verificada: en `/link`.

### El flujo nuevo

`/afiliados/vincular` — pantalla propia, no un segundo paso del registro. Se eligió así porque
tiene que servir a **dos** perfiles y ser enlazable por sí sola:

1. **Sin sesión** (rebotado del registro con 409): escribe su contraseña **de siempre** →
   `signInWithPassword` → sólo si eso funciona se llama a `/link`. Contraseña mala = se corta
   antes del fetch, no se crea nada.
2. **Con sesión abierta**: no pide correo ni contraseña, sólo confirma.

Los datos ya escritos (nombre, método y datos de pago) viajan en **`sessionStorage`**, no en query
params: `payoutDetails` puede traer una CLABE y la query string acaba en el historial del
navegador y en los logs de acceso. Se lee una sola vez y se borra (`consumeSignupDraft`). El
correo sí va en `?email=` porque sólo prellena el input — la identidad real la decide la sesión.

`POST /api/afiliados/auth/link` valida en este orden:

1. Sesión verificada en servidor → si no hay, **401**.
2. ¿Ya tiene `AffiliateUser`? → no duplica: `{ alreadyLinked: true, home }` → a su panel.
3. ¿Es **vendedor** de un equipo? → **409**. Convertirlo también en afiliado lo dejaría sin su
   panel: `/api/afiliados/whoami` prioriza afiliado sobre vendedor y lo mandaría al equivocado.
4. ¿Existe un `Affiliate` con ese correo no vinculado a esta sesión? → **409**, no se adopta.
   Adoptarlo sería un camino de apropiación de cuenta ajena (p. ej. si el correo de aquel afiliado
   cambió en Auth y otra persona lo reusó).
5. Nombre obligatorio; método/datos de pago opcionales.
6. Alta con el **mismo helper** que el registro normal.

Además: check de **origen** (mismo criterio que el guard CSRF de `/api/admin` en `middleware.ts`) y
rate-limit por IP (10/min). La ruta muta estado y autentica por cookie; la cookie de Supabase es
`SameSite=lax`, pero el check explícito no depende de esa configuración.

### Núcleo compartido

`src/lib/affiliates/signup.ts` — `createAffiliateAccount()` + `sendAffiliateSignupEmails()` +
`normalizePayoutMethod()`. Lo usan las **dos** puertas de entrada, así que slug, `referralCode`,
`status PENDING` y los **dos correos** (aviso a la casa + acuse al solicitante) salen idénticos por
ambas. El registro normal quedó más corto: delega en el helper en vez de repetir la transacción.

### El camino corto (punto 4 — sí entró)

`/afiliados/registro` es server component `force-dynamic`, así que resuelve la sesión antes de
pintar (`getAffiliateLinkState()`, que nunca lanza). Con sesión abierta y sin cuenta de afiliado,
el formulario **esconde correo y contraseña** y manda a `/link`: un clic, sin reescribir nada. Si
esa sesión ya es afiliada, muestra "Ya tienes cuenta de afiliado" con enlace a su panel en vez de
un formulario inútil.

En Configuración del panel se agregó un segundo botón, **"Activar mi cuenta de afiliado →"**, que
apunta directo a `/afiliados/registro` (el existente "Conocer el programa" se quedó igual).

Límite conocido: `/afiliados/*` **no** está en el matcher de `src/middleware.ts`, así que ahí no se
refresca la cookie de Supabase. Con un access token vencido, `getAffiliateLinkState()` devuelve
`sessionEmail: null` y la persona simplemente escribe su contraseña en `/afiliados/vincular` — el
flujo sigue completo, sólo pierde el atajo. No se tocó el middleware a propósito.

### Convivencia de los dos roles — lo que revisé

Es lo más delicado del cambio: tras vincular, un mismo `supabaseId` tiene rol de clínica **y** de
afiliado.

**No se confunden porque leen tablas distintas y no comparten campos.**

- `getAuthContext()` → `prisma.user.findFirst({ supabaseId, isActive })` sobre `users`. Nunca lee
  `affiliate_users`.
- `getAffiliateContext()` → `prisma.affiliateUser.findFirst({ supabaseId, isActive })` sobre
  `affiliate_users`. Nunca lee `users`.
- `getAffiliateSellerContext()` → `affiliate_sellers`.

**No heredan permisos** porque no tienen dónde: `AffiliateContext` expone
`{ affiliateUserId, affiliateId, affiliate, status }` — **sin `clinicId`, sin `role`, sin
`permissionsOverride`**. `AuthContext` no expone `affiliateId`. No hay un campo por el que un rol
pueda leer al otro.

Verificación mecánica: recorrí los 21 archivos que usan `getAffiliateContext` /
`getAffiliateSellerContext` buscando cuáles usan además `getAuthContext` o `getCurrentUser`.
**Resultado: cero solapamientos.** Ningún archivo del repo mezcla contexto de clínica y de
afiliado, así que no hay superficie donde uno pueda filtrarse al otro.

**Aislamiento intacto.** `/api/afiliados/stats` sigue filtrando por `Clinic.affiliateId ===
ctx.affiliateId` (las clínicas que **ese afiliado refirió**) y devolviendo agregados; el `id` que
selecciona es sólo para cruzar términos congelados y no sale en la respuesta. Que la persona sea
además dueña de una clínica no cambia el scope: su propia clínica sólo aparecería si estuviera
atribuida a su `affiliateId`, y eso lo bloquea el anti self-referral.

**Anti self-referral: verificado, y ahora más sólido.** `git diff` sobre
`src/app/api/auth/register/route.ts` y `src/lib/affiliates.ts` sale **vacío** — el motor de
atribución no se tocó. El guard compara `Affiliate.email` con el correo del alta y anula sólo la
atribución. Con la vinculación, `Affiliate.email` sale de la **sesión verificada**, no de un campo
tecleado, así que coincide con el correo real de la persona: el chequeo es más fiable que antes.
Ser dueño de una clínica y afiliado a la vez es legítimo; usar tu propio enlace para tu propia
clínica sigue sin comisionar. (Límite preexistente, fuera de alcance: si la segunda clínica se da
de alta con **otro** correo, el guard por correo no lo detecta.)

**Consecuencia de UX que conviene saber:** la sesión de Supabase es **una sola** para ambos roles.
`POST /api/afiliados/auth/logout` hace `signOut()` global, así que cerrar sesión desde el panel de
afiliado **también cierra la del panel de la clínica** (y al revés). No es una fuga —es el mismo
usuario— pero es lo que se va a sentir. Es comportamiento preexistente de la sesión compartida
(igual que labs/proveedores), no algo que introduzca esta ola.

### Recorrido de verificación

| # | Escenario | Resultado |
|---|---|---|
| 1 | Correo nuevo | Alta normal, sin cambios: `createUser` → Affiliate PENDING + AffiliateUser → 201 → `/afiliados/login` |
| 2 | Correo de dueño de clínica | 409 `needsLogin` → tarjeta "Ya tienes una cuenta en DaleControl… inicia sesión y activamos tu cuenta" + botón a `/afiliados/vincular`. **No** es un error rojo |
| 3 | Mismo correo, contraseña **equivocada** | `signInWithPassword` falla → mensaje y `return` **antes** del fetch a `/link`. Nada creado. Aunque se saltara el cliente, `/link` sin sesión da 401 |
| 4 | Mismo correo, contraseña **correcta** | Affiliate PENDING + AffiliateUser sobre su `supabaseId` existente → `/afiliados/pendiente`. La contraseña **no cambia**: `/link` no importa el admin client |
| 5 | Correo que ya es afiliado | 400 "Este correo ya tiene una cuenta de afiliado." con enlace a `/afiliados/login` pintado **dentro** del aviso |
| 6 | Tras vincular, ambos paneles | `/dashboard` resuelve por `users`, `/afiliados/*` por `affiliate_users`. Sin solapamiento (verificado arriba). PENDING cae en `/afiliados/pendiente` hasta la aprobación |

### Build

`npm run build` completo y **verde**, sin pipe: `prisma generate` OK, **0 errores de tipos**,
**362/362** páginas prerenderizadas. Rutas nuevas en el manifest: `ƒ /afiliados/vincular` (4.18 kB)
y `ƒ /api/afiliados/auth/link`. `/afiliados/registro` pasó de 3.33 → 3.39 kB. Los `prisma:error` de
`DATABASE_URL` del prerender son los de siempre (no hay `.env` local) y los warnings (clases
ambiguas de Tailwind, `Critical dependency` de `file-type`) son preexistentes.

**Sin SQL ni cambios de schema** — se reusan `affiliates` y `affiliate_users` tal cual. No se
tocaron el motor de comisiones, la landing ni `globals.css`.

---

## [Blurb del footer alineado al title SEO] — 2026-08-05

Commit **`950853b7`** en `main` (directo, sin PR). Cambio de copy: sin SQL, sin envs, sin
dependencias. **2 archivos, 2 inserciones y 2 borrados.**

### Archivos tocados

- **`src/components/public/landing/sales/v2/landing-data.ts`** (línea 308) — el valor de
  `FOOTER.blurb`. Ninguna otra clave de `FOOTER` (`product`, `funciones`, `legal`, `contact`,
  `copyright`, `madeIn`) ni ninguna otra constante del archivo se tocó.
- **`src/components/public/landing/sales/footer.tsx`** (línea 30) — solo `maxWidth: "30ch"` →
  `"34ch"` en el `<p>` del blurb. `fontSize`, `lineHeight`, `color` y `marginTop` quedaron
  igual, y el `SecureBadge` de la barra inferior no se rozó.

Antes: «El software de gestión para clínicas dentales en México. Todo en un solo lugar, en
español y en pesos.»
Después: «El software dental más completo de México. Agenda, expediente, WhatsApp y facturación
CFDI 4.0 en una sola plataforma.»

### Por qué sube el ancho de la columna

El texto pasa de **102 a 118 caracteres** (+16, medidos sobre el archivo, no a ojo). El
`maxWidth` sube un 13% (30→34ch) para absorber ese 16%: la columna de marca es la primera de un
`flex` con `flex: 1 1 260px`, así que cada renglón de más la estira hacia abajo y la descuadra
contra las cuatro columnas de enlaces. **El conteo de renglones no se verificó en navegador**
(no hay `.env` local para levantar el sitio); el `34ch` es el que venía indicado en el encargo.

### Alcance: se propaga a todo el sitio público

`FOOTER.blurb` tiene **un solo consumidor**, `sales/footer.tsx`, pero ese `SalesFooter` se monta
en **19+ rutas públicas**: home, blog, `/casos-de-uso`, `/herramientas`, `/descubre`, las **8
páginas de módulo** y `/afiliados`. El copy nuevo aparece en todas a la vez — es lo esperado, no
un efecto colateral. Las especialidades `/[slug]` y `/roadmap` usan el **otro** footer
(`landing/footer.tsx`), que no lee esta constante y por tanto no cambia.

### Verificación

- `grep` de la frase vieja («software de gestión para clínicas dentales») sobre `src/`: **0
  resultados**. Antes del cambio había exactamente 1, en `landing-data.ts:308`.
- «CFDI 4.0» es **exacto**: `src/lib/facturapi.ts` integra CFDI 4.0 y el resto de la landing ya
  lo nombra así (`lib/landing-data.ts:79`, `lib/specialty-data.ts:80`).
- `npm run build` completo y **verde**, sin pipe: `prisma generate` OK, tipos OK, **362/362**
  páginas prerenderizadas (el conteo subió de 360 a 362 con los commits que entraron entre
  olas). `/` sigue **estático** (`○`), 11.1 kB / 213 kB de First Load JS. Los `prisma:error` de
  `DATABASE_URL` del prerender son los de siempre (no hay `.env` local) y los warnings —3 clases
  ambiguas de Tailwind y el `Critical dependency` de `file-type`— son preexistentes.

### Nota sobre el claim

«El software dental **más completo** de México» es un superlativo comparativo: a diferencia de
«TLS + AES-256» del sello, no hay nada en el repo con lo que sostenerlo, y es el tipo de frase
que un competidor o PROFECO pueden pedir que se acredite (LFPC art. 32, información veraz y no
engañosa). Se dejó **tal cual lo pidió Rafael** —el encargo fijaba el texto palabra por palabra
y prohibía añadir o quitar nada—, pero queda anotado aquí por si algún día conviene cambiarlo
por una afirmación demostrable. El resto del blurb sí es verificable: agenda, expediente,
WhatsApp y timbrado CFDI 4.0 existen los cuatro.

---

## Afiliados — atribución por cookie, links cortos, bono en el panel y soporte con manager (5 ago 2026)

Cuatro frentes en una sola ola. El que importa de verdad es el primero: hasta hoy un afiliado
podía hacer todo el trabajo y no cobrar.

### El agujero que se cierra

La atribución dependía de que `?ref=` **sobreviviera en la URL hasta el registro**
(`src/app/api/auth/register/route.ts`). Si el visitante entraba por el link del afiliado, se
iba, y volvía tres días después escribiendo `dalecontrol.com` a mano, el afiliado **no
cobraba**. No existía ninguna cookie de atribución — verificado antes de empezar: cero
ocurrencias de `dc_ref`/`aff_ref` en el repo.

### La regla de atribución, escrita una vez

Cookie **`dc_aff`**, `httpOnly` · `Secure` · `SameSite=Lax` · `path=/` · **90 días**.
Contenido: `v1.<referralCode>.<campaña>.<epochMs>` — sin un solo dato personal (ni nombre, ni
correo, ni IP).

**Server-side obligatorio.** La escribe el route handler con `Set-Cookie`, nunca
`document.cookie`: Safari (ITP) borra a los 7 días las cookies escritas por JavaScript, así que
por JS los 90 días habrían sido **7 en iPhone**.

**PRIMER TOQUE.** Si ya hay cookie vigente **no se sobrescribe ni se renueva** — ni por otro
afiliado, ni por otra campaña, ni por el mismo. En `/r/[code]` eso es literalmente
`if (!parseAttribution(...)) setAttributionCookie(...)`. A los 90 días expira y **deja de
atribuir a nadie**: quien vuelva el día 91, por donde sea, no es de ningún afiliado. Sin
renovación por visitas posteriores.

La consecuencia contraintuitiva se respeta a propósito y está escrita en los términos: **cookie
de A + clic en el link de B + registro inmediato ⇒ la comisión es de A.** Eso significa primer
toque.

`parseAttribution()` revalida los 90 días **en el servidor** además del `maxAge`: una cookie de
91 días que sobreviva (reloj adelantado, proxy que la reinyecte) no atribuye.

### `/r/[code]` — la ruta corta

`src/app/r/[code]/route.ts`, route handler de redirección (no página). `/r` **no cae en el
matcher del middleware**, así que corre en Node sin `updateSession`.

Resuelve en orden: (a) `AffiliateLink.publicCode` → afiliado + campaña, y suma 1 a `clicks` de
ese link; (b) `Affiliate.referralCode` → link base sin campaña; (c) nada → home limpia.

**Nunca un 404.** Un link roto compartido en WhatsApp o impreso en un QR lleva al sitio, no a un
muro. Afiliado no `APPROVED` → mismo trato: redirige, sin cookie. Añadí también `/r` a secas
(sin código), que redirige igual: pasa cuando un link se trunca al compartirse.

Registra el clic reusando lo de `/api/afiliados/track` (`hashIp` con salt — **jamás IP cruda**).
El rate limit gatea **solo las escrituras**: el visitante siempre redirige y siempre recibe su
cookie, nunca un 429 en la cara. Redirección **302 explícita** (`NextResponse.redirect` es 307
por defecto). Aterriza en `dalecontrol.com` limpio, sin querystring.

### El registro lee la cookie

En `register/route.ts`, `refCode` y la campaña salen **siempre de la misma fuente ganadora**:
cookie vigente si la hay, si no el `?ref`/`?c` de siempre (comportamiento histórico intacto).
Mezclarlas habría descuadrado las conversiones por campaña del panel y la atribución a vendedor
por `affiliateId_campaign`.

Si gana la cookie pero su afiliado ya no resuelve (suspendido, borrado), **no se cae de vuelta
al `?ref`**: se queda sin atribución. Volver al `?ref` le regalaría al último toque una comisión
que era del primero. Todo en try/catch: una cookie corrupta no rompe un alta. El anti
self-referral se aplica igual, venga el ref de donde venga.

Precedencia real, que no estaba escrita en ningún lado y ahora sí está en los términos:
**cookie vigente > `?ref` de la URL > cupón** (el bloque del cupón solo corre si no hay ya
atribución).

### Links del afiliado

`MAX_LINKS` 20 → **15** (solo el del afiliado; el de vendedores se queda en 20). Quien ya tenga
más **no pierde ninguno**: solo no puede crear más.

Los links nuevos llevan `publicCode`: 8 caracteres `[a-z0-9]` con `randomBytes` (no
`Math.random`, que es lo que usa `referralCode`), único global, con reintento ante colisión. Un
`?c=facebook` adivinable dejaba manipular las campañas de otro afiliado; el código opaco lo
evita. La URL que se muestra y se copia es `dalecontrol.com/r/<publicCode>`.

`campaign` **no se tocó**: sigue siendo la llave de las estadísticas y de la atribución a
vendedor, y las URLs `/socio/<slug>?c=<campaign>` ya compartidas siguen funcionando. Los links
creados antes de la migración tienen `publicCode` null y conservan su URL histórica. El **título
que escribe el afiliado** ("Facebook", "Expo dental") sigue siendo lo que ve en su panel junto a
clics y registros: opaco hacia afuera, legible hacia adentro.

Dos cosas que salieron de paso:

- **La URL estaba duplicada en tres sitios** y la page SSR de `/afiliados/herramientas` armaba la
  plantilla a mano en vez de usar la función de la route — un link recién creado y uno viejo
  podían mostrarse con **formatos distintos en la misma pantalla**. Ahora las tres pasan por
  `src/lib/affiliates/link-url.ts`.
- **Regresión evitada:** con `publicCode` ya en el schema, cualquier `findMany` sin `select`
  pide esa columna, así que sin el SQL aplicado habría reventado la pantalla entera de
  herramientas. Se añadió un reintento sin la columna.

El **link base** ahora tiene su propia fila con botón de copiar y QR (antes no se podía copiar
desde esa pantalla), claramente marcado como "sin campaña".

### Aviso de privacidad y términos

`/privacidad` **no mencionaba cookies ni una sola vez** (verificado: 0 ocurrencias). Sección
nueva **"3. Cookies"** con qué cookie, para qué, cuánto dura, que no lleva datos personales, que
no se comparte y cómo borrarla — más las estrictamente necesarias de sesión, que sí existen. Las
seis secciones posteriores se renumeraron a mano (la numeración está hardcodeada en el string
del título).

En `/terminos-afiliados`, la ventana de primer toque y 90 días entró **dentro** de la sección 3
existente, sin tocar el objeto `S` de numeración dinámica (crear sección nueva habría obligado a
correr los ternarios `hitosOn ? N : N-1` de todas las posteriores y sus referencias cruzadas).
Cubre los cinco casos, incluido el del día 91 y el de borrar cookies o cambiar de dispositivo.

### Bono por Clínicas Activas, en el panel

Los hitos ya se configuraban en `/admin` pero **nadie los calculaba** — el propio schema lo
decía: *"Sólo se ANUNCIAN y se configuran: el sistema NO los calcula ni los paga"*. Ahora el
afiliado ve su progreso en `/afiliados/inicio`: los tres escalones con su monto (leídos de
`affiliate_payout_config`, ni un número a mano), los ya alcanzados marcados, y una barra hacia
el siguiente. Si `milestonesEnabled` está apagado, el bloque no aparece.

**El número es el que CALIFICA, no el bruto.** Los términos dicen "al menos 3 mensualidades
pagadas y su suscripción sigue vigente", y eso es lo que se cuenta. Si la barra mostrara altas o
activas a secas, el afiliado vería "50/50" y no cobraría: reclamo garantizado. Cuando el
conteo que califica difiere del total de activas, se muestran **los dos** con su explicación
("42 activas · 38 ya califican · 4 aún no llegan a las 3 mensualidades").

Cómo se calcula, en `src/lib/affiliates/milestones-progress.ts` (fuente única, la usan el panel
y el admin):

1. Clínicas del afiliado que pasan `activeClinicWhere()` → solo los ids (privacidad: ni nombres
   ni planes salen al navegador).
2. **Una** `subscriptionInvoice.groupBy` por `clinicId` con `status:"paid"` — sin N+1.
3. Califica la que llega a `MIN_PAID_INVOICES` (3), vía el predicado compartido
   `clinicQualifies()`.

**Los prorrateos no cuentan.** Un cambio de plan a mitad de ciclo genera una factura pagada que
no es una mensualidad; contarla habría pintado "ya califica" a una clínica que al verificar el
bono no calificaría — justo el reclamo que el bloque existe para evitar. Se excluyen con el
**mismo criterio que ya usaba `getInvoiceNo()`** del motor de comisiones, para que "mensualidad"
signifique lo mismo en las dos partes del sistema. La rama `{ notes: null }` del filtro es
obligatoria: en Postgres un `NOT LIKE` descarta los NULL, y sin ella las facturas sin nota —la
mayoría— se habrían caído del conteo y nadie habría llegado nunca a un hito.

Sin caché: son dos lecturas pequeñas y un progreso personal congelado se lee como bug ("ya di de
alta la clínica y sigo en 4"). La condición de sostenerse 3 meses se menciona en el bloque, con
enlace a los términos. **Nada de esto paga nada**: los bonos se siguen entregando a mano.

### Soporte del afiliado, con manager de cuenta

**Tablas propias, no `support_tickets`.** El soporte de clínicas está acoplado a `clinicId` de
punta a punta (incluidos los adjuntos, con prefijo `support/{clinicId}/`); tocarlo para meter
afiliados arriesgaba soporte en producción. `AffiliateSupportTicket` y `AffiliateSupportMessage`
son un espejo 1:1 con `affiliateId`, al final del schema. Folio propio **`#AF-0001`**,
independiente de los `#DC-` de las clínicas. Categorías propias también: un afiliado no reporta
bugs del expediente, pregunta por su dinero (COMISIONES · PAGOS · MATERIAL · CUENTA · DUDA).

`/afiliados/soporte` (entrada nueva en el sidebar): arriba la **tarjeta del manager** con foto,
nombre, si está en línea según su horario y botón de WhatsApp con mensaje prellenado que lo
identifica. **Sin manager asignado, cae al canal general** — nunca una tarjeta vacía. Debajo,
sus tickets con folio, estado y aviso de respuesta sin leer, más crear ticket y la conversación
en `/afiliados/soporte/[id]`.

**Aislamiento:** `affiliateId` siempre de `getAffiliateContext()`, jamás del request. Lecturas y
escrituras por id van con `where` compuesto `{ id, affiliateId }`, y un ticket ajeno da **404,
no 403** (un 403 confirmaría que existe). El route de mensajes verifica propiedad **antes** de
escribir.

**Notas internas:** se filtran en el `where` de Prisma (`messages: { where: { internalNote:
false } }`), no en el render, y el cliente vuelve a descartarlas por si acaso. Un afiliado no
puede crear una nota interna ni mandándola forjada en el body: `internalNote` solo es válido con
`authorType === "support"`.

En el admin: asignar/cambiar manager desde la ficha del afiliado (**auditado con
`logAdminGlobalEvent`** — la asignación de clínicas no lo está), y bandeja
`/admin/soporte-afiliados` con filtros, métricas, responder, notas internas y cambio de estado.
El selector de managers se **extrajo a un componente compartido** con el de clínicas en vez de
duplicar 300 líneas; las dos pantallas de tickets sí se duplicaron, porque compartirlas exigía
generizar componentes del soporte de clínicas en producción.

En `/admin/affiliates`, un bloque nuevo con **cuántos afiliados van por cada hito** (5+, 25+,
50+) y el monto comprometido: un afiliado acercándose a 50 es una salida de $100,000 que
conviene ver venir con meses de anticipación. Usa exactamente el mismo criterio que el panel —
si contara distinto, no sabrías cuál de los dos números creer.

### Recorrido de verificación

| # | Escenario | Resultado |
|---|---|---|
| 1 | Clic en `/r/<code>` | Cookie puesta por `Set-Cookie`, clic registrado, `clicks` +1, aterriza en la home limpia |
| 2 | **Vuelve 3 días después escribiendo la URL y se registra** | **Comisión del afiliado. Este es el caso que hoy está roto** |
| 3 | Cookie de A + clic en link de B + alta inmediata | Sigue siendo de **A** (primer toque) |
| 4 | Cookie de 91 días | `parseAttribution` la descarta → no atribuye a nadie |
| 5 | Sin cookie, con `?ref=` | Funciona como siempre, sin cambios |
| 6 | Afiliado suspendido / pendiente | Redirige a la home sin cookie ni clic |
| 7 | Auto-referido | Sigue bloqueado, venga el ref de la cookie o de la URL |
| 8 | Origen de la cookie | `Set-Cookie` del handler, `httpOnly` — JS no puede leerla ni escribirla |
| 9 | Barra del bono | Cuenta activas con ≥3 mensualidades pagadas, **sin prorrateos**; muestra el bruto aparte |
| 10 | Ticket de otro afiliado por id en la URL | 404 en leer, responder y marcar leído |
| 11 | Nota interna | Filtrada en el `where`; nunca llega al panel del afiliado |
| 12 | Afiliado sin manager | La pantalla funciona igual, con el canal general |

### Build

`npm run build` completo y **verde**, sin pipe: `prisma generate` OK, **0 errores de tipos**,
**365/365** páginas prerenderizadas. Rutas nuevas en el manifest: `ƒ /r`, `ƒ /r/[code]`,
`ƒ /afiliados/soporte` + `/[id]`, `ƒ /admin/soporte-afiliados` + `/[id]`,
`ƒ /api/afiliados/soporte/*`, `ƒ /api/admin/affiliate-support/tickets/*` y
`ƒ /api/admin/affiliates/[id]/account-manager`. Los `prisma:error` de `DATABASE_URL` del
prerender son los de siempre (no hay `.env` local) y los warnings (clases ambiguas de Tailwind,
`Critical dependency` de `file-type`) son preexistentes.

### Qué probar en producción

1. **El caso 2 de la tabla**, que es el que justifica la ola: entra por `/r/<código>`, cierra el
   navegador, vuelve al día siguiente escribiendo `dalecontrol.com` y regístrate. La clínica
   tiene que quedar atribuida.
2. Que la cookie `dc_aff` aparezca en DevTools → Application → Cookies **con `HttpOnly` marcado**
   y expiración a 90 días.
3. Crear un link nuevo en `/afiliados/herramientas`: debe mostrar `dalecontrol.com/r/<8 chars>`,
   copiarse bien y **redirigir a la home**, no a la página de socio.
4. Que un link viejo (`/socio/<slug>?c=...`) siga funcionando y sumando clics.
5. El bloque del bono en `/afiliados/inicio` con una cuenta real: comprobar que el número que
   califica cuadra con las mensualidades pagadas de sus clínicas.
6. Asignar un manager a un afiliado desde `/admin/affiliates/<id>` y ver la tarjeta con el botón
   de WhatsApp en `/afiliados/soporte`.
7. Abrir un ticket como afiliado, responderlo desde `/admin/soporte-afiliados`, y **guardar una
   nota interna**: confirmar que no aparece del lado del afiliado.

### Límites conocidos

- **Adjuntos fuera de esta ola.** El bucket `affiliate-support` no existe en Supabase y crearlo
  es manual. El campo `attachments` queda en la BD y en los DTO (siempre `[]`); cuando exista el
  bucket, se activa en `service.ts` más el input de archivos.
- **GA4 y Google Ads siguen sin documentarse** en el aviso de privacidad. Existen
  (`src/lib/analytics/ga4.ts` y el tag inline del layout) y son un hueco **preexistente**. El
  texto nuevo se escribió **sin ninguna frase de exhaustividad** para que no mienta hoy, pero
  documentarlos obligaría además a listar a Google en la sección de Transferencias.
- El afiliado no puede cerrar ni calificar su ticket (el admin sí cambia estado); la UI ya
  muestra el rating en solo lectura si algún día se agrega.
- Se corrigió de paso un bug del menú del admin: `isActive` usaba `startsWith(href)` suelto, así
  que `/admin/soporte-afiliados` encendía también "Soporte".

**SQL:** `sql/afiliados-atribucion-soporte.sql` — ya aplicado en Supabase; se guarda para el
histórico y como red de auto-reparación (cada columna con `ADD COLUMN IF NOT EXISTS`, así que
re-correrlo completa cualquier diferencia sin tocar datos). Incluye RLS deny-all en las dos
tablas nuevas. No se tocaron el motor de comisiones, `globals.css`, `src/lib/support/**` ni las
tablas de soporte de clínicas.

---

## Rediseño del PANEL DE AFILIADO + el mismo lenguaje en todo el panel

Diseño de origen: `C:\Users\Rafael\ClauCode\MediFlow\disenos\Panel-Afiliado-DaleControl.dc.html`
(Claude Design, ~64 KB). El archivo traía **dos estados apilados** —"Afiliado nuevo" y
"Afiliado activo"— que **no son dos pantallas**: son la misma con datos distintos. Se
implementó **una sola ruta y una sola composición**; lo que cambia sale de los datos.

### Dónde viven los patrones compartidos

| Archivo | Qué contiene |
|---|---|
| `src/app/afiliados/panel.css` | **La única hoja de estilo del panel.** Namespace `dcafp` (para no chocar con `dcaf-` de `afiliados.css`, la landing pública, que ya define `dcafSpin`/`dcafSway`). Tokens de la paleta, chrome del sidebar, y los patrones: tarjeta, encabezado, eyebrow, chip, botón, icon-button, botón-código, formulario, aviso, barra de progreso, estado vacío, tabla (rejilla y `<table>`), rejillas, KPI, fila de enlace, escalón del bono, piezas 3D y toast. |
| `src/components/afiliados/ui/panel-ui.tsx` | Primitivas **server-safe**: `PageHead`, `PanelCard`, `SectionHead`, `Eyebrow`, `Chip`, `EmptyState`, `ProgressBar`, `StatRow`/`Stat`, `Kpi`, `Note`, `Footnote`, `GridTable`/`GridRow`. |
| `src/components/afiliados/ui/copy-button.tsx` | `CopyButton`, `CopyIconButton`, `CopyCodeButton`. Conservan el respaldo `<textarea>`+`execCommand` del diseño: `navigator.clipboard` no existe en el navegador in-app de Facebook, que es justo donde muchos afiliados abren el panel. |
| `src/components/afiliados/ui/panel-toast.tsx` | El `toastIn` del diseño (píldora oscura abajo al centro). Una sola instancia montada en el shell, alimentada por un bus de módulo: dos copiados seguidos no apilan dos píldoras. |
| `src/components/afiliados/ui/tier-pieces.tsx` | Las tres piezas 3D (regalo `sway`, monedas `spinZ`, trofeo `spinY`). CSS puro, sin librerías, sólo `transform`/`opacity`, `aria-hidden` en la raíz. |

**Dos redes para que ninguna pantalla quedara a medias:** dentro de `.dcafp`, `panel.css`
(1) **remapea los tokens semánticos** de la app (`--text-1`, `--bg-elev-2`, `--border-soft`,
`--violet-400`, `--brand-soft`, `--brand-grad`…) a la paleta clara del diseño, y
(2) **sobrescribe las clases heredadas** (`.card`, `.table-new`, `.btn-new`, `.input-new`,
`.badge-new`, `.icon-btn-new`) con `.dcafp X` (0,2,0), que le gana a la base (0,1,0). Así, un
componente que todavía no lleve clases `dcafp` igual aterriza en la paleta nueva.

### Páginas migradas (todas)

| Ruta / componente | Estado |
|---|---|
| `/afiliados/inicio` | ✅ Composición completa del diseño |
| `/afiliados/herramientas` + los 5 de `tools/` | ✅ |
| `/afiliados/estadisticas` + `estadisticas-client` | ✅ (colores del gráfico repintados para fondo claro) |
| `/afiliados/reportes` + `reportes-client` | ✅ |
| `/afiliados/equipo` + `team-manager` | ✅ |
| `/afiliados/configuracion` + `payout-form`, `payout-mode-form` | ✅ |
| `/afiliados/soporte` + lista, detalle, `affiliate-manager-card` | ✅ |
| `affiliate-shell` (sidebar, navegación, pie) | ✅ Reescrito |
| `seller-shell` + `/vendedor/{inicio,herramientas,configuracion}` + `seller-tools`, `seller-payout-form` | ✅ |
| `level-progress`, `milestones-card`, `referral-links` | ✅ |

**No quedó ninguna página con el estilo viejo.** `grep` de `CardNew|KpiCard|BadgeNew|table-new|
btn-new|sidebar-new|nav-item-new` en todo el panel: 0 usos (sólo aparece en un comentario).

### Ni un monto escrito a mano

- **Comisión mensual** (`$2,940` en el diseño) → `projectFixedMonthlyMxn()` de
  `src/lib/affiliates/stats.ts` sobre las clínicas que hoy pagan cruzadas con su **modalidad
  congelada** (`affiliateClinicTerms`). Es la **misma función** que alimenta
  `/api/afiliados/stats`: si aquí y allá se contara distinto, el afiliado vería dos números
  suyos que no cuadran.
- **Montos por plan** (`$80/$140/$300`) → `fixedAmountFor()` con las etiquetas de
  `plan_configs`. Un plan en `$0` es un plan apagado: no se lista.
- **Bonos** (`2,500/10,000/100,000`) → `milestoneTiers()` de la config editable en `/admin`.
- **Código de referido** (`W64W6PKH`) y los tres enlaces → sesión + `baseReferralUrl()`.
- **"90 días"** → `AFFILIATE_COOKIE_DAYS`, no un literal.
- **"3 mensualidades"** → `progress.minPaidInvoices` (`MIN_PAID_INVOICES`).
- `grep` de `W64W6PKH|2500|10000|100000|\$80|\$140|\$300|2,940|8,300|1,240|7,060` en el código
  nuevo: **0 coincidencias**.

El conteo del bono usa `getMilestoneProgress()` → **el que CALIFICA** (activas con ≥3
mensualidades pagadas, prorrateos excluidos), nunca el bruto de altas. La diferencia entre
referidas / activas / que califican se **explica en pantalla**, que es justo donde nacen los
reclamos.

### Decisiones que vale la pena conocer

- **El panel es claro y punto.** El script de `<head>` en `layout.tsx` sólo aplica `.dark` en
  `/dashboard` y `/admin`, así que `/afiliados` nunca fue oscuro por elección del usuario. No
  hay bloque `.dark` en `panel.css`: sería código muerto.
- **`@container`, no `@media`, para el contenido.** `.dcafp-main` es el contenedor con nombre
  (`container-name: dcafp`) y todos los bloques miden **el ancho real disponible**, no la
  ventana. Las únicas `@media` que quedan son las del **chrome** (el sidebar decide su propio
  colapso: 1080px → barra superior, 900px → cajón con hamburguesa) y
  `prefers-reduced-motion`.
- **La tarjeta de enlaces se destaca sólo mientras haga falta**: con `accent` + etiqueta
  "EMPIEZA AQUÍ" cuando aún no hay ganancias; en cuanto entra la primera comisión, deja de
  gritar. Igual que el diseño.
- **El estado vacío no es una pared de ceros**: las cifras en cero van en gris (`tone="idle"`,
  se leen como "todavía no" y no como una pérdida), los montos por plan suben a rejilla grande
  porque son *la promesa*, y la tabla de comisiones trae un `EmptyState` con la acción que la
  desbloquea.
- **La barra del bono marca los escalones ya cobrados** (una muesca por umbral superado) en
  vez de un reparto mudo; persiguiendo el primero, cae al reparto en quintos del diseño.
- **El regalo 3D cambia a dorado y se detiene** cuando ese escalón ya se ganó: un premio
  conseguido no sigue girando pidiendo atención.
- **Modalidades que el diseño no cubría.** El mockup asume montos fijos recurrentes. Con
  **pago único** un "$X al mes" siempre daría $0, así que la cifra grande pasa a lo acumulado
  y el copy cambia; con el motor en **%** o inactivo se conserva `<LevelProgress>` debajo,
  porque la escalera de niveles es información real que el hero no muestra (en modo fijo se
  omite: sería duplicar).
- **La tabla de comisiones conserva todo.** El diseño mostraba 4 columnas; se mantuvieron
  también *estado* y *factura que la originó* (sin ella no se puede cuadrar una comisión con
  su cobro). Estrechada, la rejilla baja a 3 columnas y el **estado reaparece como chip bajo
  el nombre** — un "pendiente" escondido a 375px es justo el dato por el que se abre un ticket.
- **`referral-links.tsx` dejó de ser client component**: sólo copiar es interactivo y eso vive
  en `ui/copy-button`. `/afiliados/inicio` bajó a **1.23 kB** de JS de cliente.
- **Bug real arreglado de paso**: el mosaico del "logo para fondos oscuros" del kit de
  marketing usaba `--bg-elev-2` (que aquí es `#f8fafc`) y el SVG es **blanco** → era invisible
  en el panel claro. Ahora va sobre `--dcafp-ink`.
- **El botón de WhatsApp del manager** pasó de verde `#16a34a` al primario morado; el glifo es
  lo que carga el reconocimiento. Volver al verde es una línea.
- Los toasts de **error** siguen en `react-hot-toast`: el toast del panel es la confirmación de
  copiado y no tiene tono de error. Sólo el copiado usa la píldora del diseño.

### Verificación

- **`npm run build` completo, sin pipe, verde**: exit 0, `prisma generate` OK, **0 errores de
  tipos**, **365/365** páginas prerenderizadas. Los `prisma:error` de `DATABASE_URL` del
  prerender son los de siempre (no hay `.env` local) y los warnings (clases ambiguas de
  Tailwind, `Critical dependency` de `file-type`) son preexistentes.
- **Verificado en Chrome** con una página temporal fuera del gate de sesión (ya borrada),
  en los dos estados:
  - Estado vacío: `$0` en gris, rejilla de montos, "EMPIEZA AQUÍ", barra sin relleno con 4
    muescas, las 3 piezas girando.
  - Estado activo: `$2,940`, barra al 72 % con la muesca sobre el escalón de 5 clínicas ya
    cobrado, regalo dorado "Conseguido" y estático, "TU SIGUIENTE META" en el de 25.
  - **A 375px: `scrollWidth == clientWidth == 375`, cero desbordes horizontales** en el
    contenido y **cero objetivos táctiles por debajo de 24px**. El `@container` conmuta: hero a
    una columna, tabla a 3 columnas, botón "Copiar" a ancho completo.
  - `prefers-reduced-motion`: la regla existe y apaga toda animación bajo `.dcafp`; las piezas
    quedan **congeladas en una pose legible**, no desaparecen. Los 4 contenedores 3D están
    `aria-hidden`.

### Pendientes / huecos conocidos (ninguno bloquea)

- **`panel.css` no tiene** patrón de *caja anidada genérica* (`surface-2` + `line-nested` +
  `r-box`), que se repite inline en 3 archivos de `tools/`; ni *segmented control* (los
  selectores de rango y de tipo de reporte usan `dcafp-btn--outline` como "activo"); ni
  *esqueleto de carga*, *modal*, *burbuja de chat* ni *tarjeta de opción seleccionable*. Todos
  resueltos inline con `var(--dcafp-*)`; son los candidatos naturales del próximo pase.
- `Chip` no tiene tono `info` ni `gold`: `ABIERTO`/`EN_PROGRESO` de soporte caen los dos en
  `brand`, y el nivel Oro pide prestado el violeta de marca.
- `Kpi` no acepta `tone`, así que una rejilla de KPIs no puede apagarse a gris en vacío (por
  eso la portada usa `StatRow`/`Stat`).
- **Recharts** no acepta `var(--dcafp-*)` en `stroke`/`stopColor` (son atributos SVG, no
  `style`): los colores del gráfico de estadísticas van en hex dentro de una constante `CHART`
  con el token equivalente anotado en cada línea. Es el único punto del diff con colores
  literales.
- No se tocaron `globals.css`, `panel-chrome-va.css` (compartido con `/admin`,
  `/laboratorios` y `/proveedores`), `afiliados.css` (landing pública), el motor de comisiones
  ni ninguna query, endpoint o validación. **Sin SQL, sin cambios de schema.**

## Afiliados — el contador de clics contaba bots (5 ago 2026)

Bug de producción. Medido en la base de datos: de **149 clics registrados, 133 eran bots y
solo 16 humanos** — **89 % de basura**. El afiliado veía un embudo con casi diez veces más
clics de los reales, y la discrepancia contra Google Analytics no tenía explicación visible.

### Por qué no se veía venir

Los bots que inflaban el número **no ejecutan JavaScript**: los generadores de vista previa de
enlaces (WhatsApp, Facebook, Telegram, Slack, Twitter, LinkedIn, Discord) golpean cada URL en
cuanto alguien la comparte en un chat, y los crawlers la revisitan solos cada tanto. Por eso
**no aparecían ni en GA4 ni en el chat en vivo** —que se cargan desde el navegador— pero sí
sumaban en el servidor, que es donde vivía el conteo de afiliados.

El repo **ya tenía** detector de bots (`src/lib/analytics/ua.ts`) y la analítica general **ya
lo usaba** (`src/app/api/track/route.ts`: `if (ua.device === "bot") return;`). El tracking de
afiliados simplemente nunca lo llamó.

### Qué se filtra

Un solo detector, un solo lugar: se **amplió** `src/lib/analytics/ua.ts` en vez de escribir uno
nuevo, así que la analítica general se beneficia del mismo cambio. El genérico `bot` ya cubría
a TelegramBot, Slackbot, Twitterbot, LinkedInBot, Discordbot, Applebot, GPTBot, AhrefsBot…, y
`preview` a BingPreview y SkypeUriPreview. Lo que se añadió son los que **no llevan "bot" en el
nombre**: `Slack-ImgProxy`, `GoogleOther`, `Google-InspectionTool`, `Mediapartners`,
`FeedFetcher`, `Discourse`, monitores de uptime (`pingdom`, `datadog`, `betterstack`,
`checkly`, `statuscake`) y clientes HTTP de servidor (`okhttp`, `node-fetch`, `undici`,
`apache-httpclient`, `java/`, `postman`, `insomnia`, `libwww`).

**WhatsApp va aparte y ANCLADO** (`/^whatsapp\//`), y esto es lo delicado del cambio: el
generador de vista previa se identifica como `WhatsApp/2.23.20.0 A` —el UA **entero** empieza
por `WhatsApp/`—, mientras que el **navegador integrado** de WhatsApp lleva `WhatsApp/2.x` al
**final** de un UA normal con prefijo `Mozilla/5.0 (…)`. Ese segundo es **una persona**, y en
México es de los caminos más comunes para abrir un link compartido. Buscar `whatsapp` suelto
habría tirado a la basura clics reales — justo el error opuesto y peor.

`src/lib/analytics/ua.test.ts` (nuevo, `npm run test:ua`, **5/5 verde**) fija ese contrato por
los dos lados: los 11 bots de vista previa se detectan, y los 5 navegadores reales **más el
navegador integrado de WhatsApp** no. Sin user-agent tampoco se asume bot: se cuenta.

### La ventana de dedupe: 30 minutos

Segunda fuente de inflado: una recarga valía otro clic. Ahora, antes de contar, se comprueba si
ya hay un clic del **mismo `ipHash` + mismo `ref`** en los **últimos 30 minutos**; si lo hay,
no cuenta. La consulta usa el índice `[ref, createdAt]` que ya existía — **sin SQL nuevo, sin
cambios de schema**.

Dos reglas de seguridad, ambas hacia contar de más antes que de menos:

- **Sin `ipHash` disponible se cuenta.** Mejor un falso positivo que perder un clic real.
- **La consulta va en `try/catch` y devuelve "cuenta" si falla.** Base caída, tabla ausente,
  lo que sea: jamás romper la redirección.

### El criterio vive en un solo archivo

`src/lib/affiliates/click-guard.ts` (nuevo) es el **único** lugar que decide si una visita
suma. Lo consultan las tres superficies que contaban, que antes no compartían criterio:

| Superficie | Qué contaba de más |
|---|---|
| `src/app/r/[code]/route.ts` | incrementaba `clicks` e insertaba la fila sin mirar el UA |
| `src/app/api/afiliados/track/route.ts` | guardaba el UA pero no lo filtraba |
| `src/app/socio/[slug]/page.tsx` | es `force-dynamic`: **incrementaba en CADA carga** |

En `/r/[code]` las dos escrituras (contador del link + fila de clic) se movieron abajo del
todo para que **compartan UNA sola decisión** y no se puedan desfasar: antes el contador subía
arriba, en la rama (a), y la fila se insertaba 40 líneas después.

**El bot NO se bloquea.** Recibe su redirección 302 y su cookie de atribución exactamente igual
que siempre — solo que no se le cuenta. Si `/r` le devolviera un error, WhatsApp dejaría de
generar la vista previa del enlace y el afiliado perdería el empujón visual del link que
comparte: peor negocio que el contador sucio.

En `/socio/[slug]` el dedupe se apoya en las filas de `affiliate_clicks` que siembra
`<RefClickTracker />` desde el navegador: la primera visita cuenta y crea la fila, y las
recargas de los 30 minutos siguientes ya se topan con ella.

De regalo, `/api/afiliados/track` resuelve el guard **antes** de buscar al afiliado: un bot ya
ni siquiera gasta esa consulta.

### Verificación

- **`npm run build` completo, sin pipe, verde**: exit 0, `prisma generate` OK, **0 errores de
  tipos**, **365/365** páginas prerenderizadas, `/r/[code]` y `/socio/[slug]` siguen dinámicas
  (`ƒ`). Los `prisma:error` del prerender son los de siempre (no hay `.env` local) y los
  warnings (clases ambiguas de Tailwind, `Critical dependency` de `file-type`) son
  preexistentes.
- **`npm run test:ua`: 5/5**.

### Lo que NO se tocó

- **La cookie de atribución**, intacta: se sigue sembrando igual, **también para bots**.
- **El motor de comisiones**, intacto. Esto solo cambia un número de vanidad del embudo; el
  dinero se calcula desde `clinics.affiliateId`, no desde `affiliate_clicks`.

### Pendiente

- **Los 133 clics basura históricos los limpia Rafael con un SQL aparte** — esta ola es solo el
  código que deja de generarlos. Hasta que corra esa limpieza, el embudo del panel seguirá
  arrastrando los números viejos.
- `clientIp()` en `src/lib/affiliates/stats.ts` pasó de recibir `Headers` a un tipo estructural
  (`{ get }`) para aceptar también el `ReadonlyHeaders` de `next/headers`. Cambio de tipo, no
  de comportamiento.
- El dedupe **no distingue campaña**: dos links distintos del mismo afiliado abiertos por la
  misma persona dentro de la ventana cuentan una vez. Es lo correcto para el embudo (una
  persona = un clic), pero conviene saberlo al leer el desglose por campaña.

---

## Afiliados — el dedupe de clics ya no va por IP, va por navegador (5 ago 2026)

La ola anterior dejó el dedupe en **`ipHash` + `ref` a 30 minutos**, y eso en México **pierde
clics reales**:

- **CGNAT.** Telcel, AT&T y los ISP móviles mexicanos meten a **miles de usuarios detrás de una
  misma IP pública**. Dos dentistas con dos teléfonos distintos contaban como **uno**.
- **WiFi compartido.** Tres personas del mismo consultorio abriendo el link contaban como
  **una**.

Y como el link se comparte por WhatsApp, **casi todo el tráfico es móvil**: el subconteo no era
hipotético, era el caso normal.

### La cookie `dc_vid` — identificar al navegador, no a la red

`src/lib/affiliates/visitor-cookie.ts` (nuevo). Identificador **aleatorio opaco**
(`randomUUID`), `httpOnly`, `secure` en producción, `sameSite: "lax"`, `path: "/"`, **1 año**,
sembrado **server-side con `Set-Cookie`** (nunca `document.cookie`: Safari/ITP borra a los 7
días lo que escribe el JS).

**No se deriva de la IP ni del user-agent** a propósito — sería el mismo bug con otro nombre.
Es un identificador **técnico de conteo**: no lleva nada personal dentro y su único uso es
responder "¿este navegador ya contó en los últimos 30 minutos?". No se confunde con `dc_aff`
(atribución/comisión, primer toque, 90 días): son cookies independientes.

### La regla, en este orden

`src/lib/affiliates/click-guard-core.ts` (nuevo, puro y probado; `click-guard.ts` quedó como el
cableado a Prisma):

0. **Bot** → no cuenta. Sin cambios: mismo detector único (`src/lib/analytics/ua.ts`).
1. **Trae `dc_vid`** → dedupe por **`ref` + `vid`, 30 min**. La IP **ni se mira**: dos
   navegadores de la misma red son **dos clics**.
2. **No trae `dc_vid`** → es un visitante **nuevo por definición** (la cookie se siembra en la
   primera visita, así que si no la trae es que nunca había estado aquí): **cuenta**, y se le
   siembra. Aquí **NO** hay dedupe por IP a 30 minutos — ese era exactamente el bug.
3. **Único respaldo por IP, y muy corto: 2 minutos.** Para quien tiene las cookies bloqueadas y
   recarga varias veces seguidas. Empata además el **user-agent completo** (lo que ya se
   guardaba en la fila), que es lo más cerca de "el mismo navegador" que se puede estar sin
   cookie: así tres personas del mismo WiFi, con navegadores distintos, **siguen contando por
   separado aunque entren en el mismo segundo**.

La fila del clic guarda el **`vid` efectivo** —el recién sembrado en la primera visita, no el
que traía la petición—; si no, la recarga siguiente no tendría contra qué deduplicar. Y la
decisión se toma **siempre con la cookie entrante**: un id recién creado no tiene historial y
se saltaría el respaldo corto.

### Qué pasa sin cookies

| Situación | Resultado |
|---|---|
| Cookies bloqueadas, 3 recargas en 1 min | **1 clic** (respaldo corto por IP + user-agent) |
| Cookies bloqueadas, recargas cada 3 min | 1 clic por recarga — **se sobrecuenta a propósito**: no hay forma de distinguirlo de tres personas distintas de la misma red, y la ola existe para dejar de perder gente real |
| Sin IP disponible (proxy raro) | cuenta |
| Consulta de dedupe caída | cuenta |

El criterio de siempre, intacto: **mejor un falso positivo que perder un clic real**, y esto
**nunca** bloquea ni rompe una visita.

### Las tres superficies

| Superficie | Lee `dc_vid` | Siembra `dc_vid` |
|---|---|---|
| `src/app/r/[code]/route.ts` | sí | **sí** (en el mismo 302, junto a `dc_aff`) |
| `src/app/api/afiliados/track/route.ts` | sí | **sí** (en el 204) |
| `src/app/socio/[slug]/page.tsx` | sí | **no puede** |

**El hueco de `/socio/<slug>`:** es un server component y un server component **no puede mandar
`Set-Cookie`** (solo un route handler o una server action). Quien siembra ahí es el POST de
`<RefClickTracker />` a `/api/afiliados/track`, milisegundos después. Consecuencia real: la
**primera** carga se decide sin cookie —y cuenta, que es lo correcto: es un visitante nuevo— y
de la segunda en adelante ya hay identificador. Por eso el 204 de `track` se arma **al
principio** de la función y **todas** las salidas devuelven ese mismo response: si alguna se
fuera por su cuenta, ese visitante se quedaría sin identificador y volvería a contar en cada
recarga.

### Rate limit: 30 → 120 por minuto

`/r/[code]` frenaba las **escrituras** a 30/min por IP. Con la IP compartida (CGNAT, WiFi de la
clínica), un afiliado que tira su link a un grupo grande de WhatsApp llenaba la cuota con gente
legítima y esos clics se tiraban. Ahora **120/min**. La **redirección nunca se frena** — eso ya
estaba bien y no se tocó.

**También se subió en `/api/afiliados/track`** (30 → 120), que no venía en el encargo: es la
misma IP compartida y el mismo grupo de WhatsApp, y además es la ruta que **siembra la cookie**
en `/socio` — un 429 ahí deja al visitante sin identificador y lo devuelve al conteo por IP.

### ⚠️ PENDIENTE — el `ALTER TABLE` (Rafael lo corre a mano)

Para deduplicar por `vid` hay que **guardarlo en la fila del clic**, y `affiliate_clicks` no
tenía dónde. Está en el schema de Prisma y en **`sql/affiliate-click-vid.sql`**:

```sql
ALTER TABLE "affiliate_clicks"
  ADD COLUMN IF NOT EXISTS "vid" TEXT;
```

Sin índice nuevo a propósito: las consultas filtran por `ref` + `createdAt` (índice
`affiliate_clicks_ref_createdAt_idx`, ya existente) con ventanas de 2 y 30 minutos, así que
`vid` solo afina un puñado de filas.

**Si el SQL no se corre, NO se rompe nada ni se pierde un solo clic**, que es la trampa clásica
de una columna nueva (un insert que la menciona truena y el `catch` se lo traga en silencio):

- `createAffiliateClick()` **reintenta el insert sin `vid`** si el primero falla.
- La consulta por `vid` devuelve "no pude" (≠ "no encontré") y el guard **cae al respaldo corto
  por IP** en vez de contar a ciegas.
- Ninguna lectura existente de `affiliate_clicks` se rompe: todas usan `select`, `count`,
  `groupBy` o `$queryRaw` — ninguna pide la fila completa.

Degrada al comportamiento de antes **menos** el dedupe largo por IP; en cuanto corra el SQL,
empieza a deduplicar por navegador solo. Los clics guardados mientras tanto quedan con `vid`
nulo y no estorban.

### Verificación

`npm run test:click-guard` (nuevo, **8/8 verde**) — cada caso de la ola es un test, con el
mundo de filas y el reloj inyectados:

1. **Dos teléfonos distintos en la misma red móvil, sin cookie, con minutos de diferencia →
   2 clics.** Peor caso a propósito: **mismo modelo de teléfono** (mismo user-agent) y misma IP
   de Telcel. Antes: 1.
2. Tres navegadores desde el WiFi de la clínica, **en el mismo instante** → 3 clics.
3. El mismo navegador recargando 5 veces en un minuto → 1 clic.
4. El mismo navegador 40 minutos después → 2 clics (la ventana expiró).
5. Cookies bloqueadas, 3 recargas en un minuto → 1 clic.
6. Bot de vista previa → no cuenta y sigue recibiendo su redirección.
7. Sin el SQL aplicado → degrada, no pierde clics.

`npm run build` completo: **verde**, 365/365 páginas. `/r/[code]`, `/socio/[slug]` y
`/api/afiliados/track` siguen dinámicas (`ƒ`).

### Residual conocido

**Dos teléfonos idénticos** (mismo user-agent), en la misma IP, entrando **con menos de 2
minutos de diferencia** → 1 clic. Es el precio de que el caso 5 siga funcionando: sin cookie no
hay forma de distinguir "otra persona con el mismo teléfono en la misma red" de "el mismo
navegador recargando". Con 2 minutos la ventana es lo bastante estrecha para que sea raro, y
con **un user-agent distinto no se pierde ni dentro de la ventana**. Queda como test para que
se vea el trade-off en el código.

### Lo que NO se tocó

- **La cookie de atribución `dc_aff`** y su regla de primer toque: intactas.
- **El motor de comisiones**: intacto. Esto solo cambia el número del embudo; el dinero se
  calcula desde `clinics.affiliateId`.
- **El filtro de bots**: intacto, mismo detector único.
- **La redirección de `/r`**: nunca se frena, nunca devuelve error.

══════════════════════════════════════════════════════════════════════════
## Admin pagos fecha real y MRR unico ✅ (2026-08-05) · rama fix/pagos-fecha-mrr → main
══════════════════════════════════════════════════════════════════════════
2 commits sobre `origin/main` (rebasado encima de `aaa1ea0f`): `4fb18b04` (fecha) y el de MRR +
aviso de precio heredado. **Sin SQL. Sin escrituras a Stripe.** `npx tsc --noEmit` 0 errores ·
`npm run build` **exit 0** (365/365 páginas) · `npm run test:mrr` **10/10** (nuevo).

### El diagnóstico, confirmado

Las dos cosas eran ciertas, y apareció una tercera:

- **(A) Fecha.** `payments-client.tsx` y `/admin` pintaban `inv.createdAt`, que es cuándo se
  insertó LA FILA. Como los cobros históricos entraron de golpe por
  `POST /api/admin/billing/backfill-stripe`, todos comparten el día de la importación. La fecha
  buena ya estaba en `paidAt` (`recordStripeInvoice` la toma de `status_transitions.paid_at`).
- **(B) MRR $0.** `/admin/payments` sumaba `Clinic.monthlyPrice`, columna que sólo escriben
  `verify_payment` y `activate_clinic` de `/api/admin/billing`. Quien paga por Stripe Checkout
  nunca la recibe → suma 0. `/admin` calculaba por plan contra `plan_configs` → otro número.
- **(C) Extra: había un TERCER cálculo.** `GET /api/admin/billing` (línea 69) repetía el mismo
  `_sum: { monthlyPrice }` con el mismo bug. Hoy no lo consume ninguna pantalla, pero era una
  cuarta versión de la verdad esperando a que alguien la usara. Migrado también.

De paso, `/admin/clientes/[supabaseId]` ya hacía `inv.paidAt ?? inv.createdAt` desde antes: las
otras dos superficies eran las que estaban desalineadas, no al revés.

### CAMBIO 1 — la fecha que se ve es la del cobro

`src/lib/admin/payment-date.ts` (nuevo, puro, sin prisma: lo importan las pages server y el
client component, que recibe las fechas ya serializadas). Las dos superficies muestran
`paidAt ?? createdAt`; sin pagar, `paidAt` es null y `createdAt` sí es lo correcto (alta del
cobro pendiente).

**El orden fue lo delicado.** El aviso del prompt era exacto: en Postgres `ORDER BY x DESC` pone
los **NULL PRIMERO**, así que `orderBy: [{paidAt:"desc"},{createdAt:"desc"}]` habría puesto los
pendientes encabezando la lista. Y forzarlos al final tampoco sirve: los hunde a todos y la
columna Fecha se ve desordenada. Prisma no sabe ordenar por un `COALESCE`, así que:

- **/admin/payments**: dos consultas — las que tienen `paidAt` (ordenadas por `paidAt`) y las
  que no (ordenadas por `createdAt`), cada una con su tope de 100 — y el orden final se decide
  en JS con el comparador compartido. No es cosmética: como los conjuntos son disjuntos y cada
  tanda viene ordenada por SU fecha, la unión contiene con certeza los 100 más recientes de
  verdad. Traer "los 100 últimos por createdAt" y ordenarlos después dejaría fuera un cobro
  viejo verificado hoy.
- **/admin**: esa consulta no tiene `take`, así que basta ordenar en JS antes del `slice(0,10)`.

**Matiz sin columna nueva:** cuando el cobro es más de 48 h anterior al alta de la fila, la
fecha lleva `cursor: help`, una marca `·imp` y un `title` con "importado el <fecha>". El umbral
de 48 h está en la constante `IMPORT_GAP_MS`: un cobro por Stripe lo registra el webhook el
mismo día, así que esa distancia sólo pasa en un backfill.

### CAMBIO 2 — un solo MRR

`src/lib/admin/mrr.ts` es ahora el único punto de entrada; la aritmética vive en `mrr-core.ts`
(puro, sin prisma — convención `-core` del repo, como `payout-core` o `audit-core`, para poder
probarla sin base de datos). Lo usan **/admin**, **/admin/payments** y el GET de
`/api/admin/billing`. Precedencia, documentada en el código:

1. `clinic.monthlyPrice` si es **> 0** — precio negociado / activación manual;
2. si no, el precio del plan desde `plan_configs` vía `getPlanLimits`.

Cero números literales. `/admin` reusa las filas que ya cargó (`computeMrr`) en vez de
consultar otra vez; `/admin/payments`, que no las tiene, llama a `getAdminMrr()`.

Dos decisiones que quedaron por escrito para que nadie las "arregle" mal después:

- **Sólo cuenta `subscriptionStatus === "active"`.** NO se usa `ACTIVE_SUBSCRIPTION_STATUSES`
  (`@/lib/plan-status`), que incluye `trialing` y `paid` porque responde a otra pregunta —quién
  tiene ACCESO al panel—. Una clínica en trial paga $0: contarla inflaría el MRR. Hay un test.
- **Un plan que no exista en `plan_configs` vale 0**, no un precio inventado.

El desglose por plan se devuelve y además se enseña bajo el KPI en las dos pantallas
("2 BASIC · 1 PRO · 2 CLINIC"), para poder auditar el total sin abrir la base.

### CAMBIO 3 — aviso de precio heredado en Stripe

`getLivePaymentMethod` pasó a ser `getLiveSubscriptionSnapshot`: la **misma** llamada a
`subscriptions.retrieve` que ya se hacía para el método de pago devuelve ahora también el
importe recurrente (`items.data[0].price.unit_amount × quantity`, su `interval` y su
`interval_count`). **Cero llamadas extra**, misma disciplina: sólo lectura, timeout 4 s, y si
Stripe no responde la ficha se renderiza igual.

La ficha de clínica compara ese importe contra el precio del plan en `plan_configs` y, si no
coinciden, saca el aviso ámbar: *"Stripe cobra $X/mes pero el plan Profesional son $Y/mes —
precio heredado"*. **No corrige nada**: cambiar precios en Stripe es decisión tuya.

Tres cosas que evitan avisos falsos:

- **La promo de primer mes no interfiere.** Lo verifiqué en `first-month-promo.ts`: se aplica
  con un **cupón `duration: "once"`**, no con un Price distinto, así que el price conserva el
  importe de lista. Un cliente recién dado de alta no dispara el aviso.
- **Ciclos raros** (`interval_count` ≠ 1, tipo "cada 3 meses") no tienen precio de plan
  comparable: se informa el importe y no se acusa a nadie.
- **Suscripciones `canceled`/`incomplete_expired`** no reportan importe: ya no van a cobrar.

### Verificación — y qué NO pude verificar

- `npx tsc --noEmit` → **0 errores**.
- `npm run build` → **exit 0**, salida completa leída (4,350 líneas): sin `Failed to compile`,
  sin `Type error`, sin `Module not found`; 365/365 páginas. Los únicos `error:` del log son los
  `DATABASE_URL not found` del prerender, que ya salían antes de tocar nada.
- `npm run test:mrr` → **10/10** (script nuevo en package.json).

**No pude comparar las dos pantallas contra datos reales: no hay `.env` local, así que no hay
DATABASE_URL y las páginas de /admin no rinden con datos.** En vez de afirmar que las vi
iguales, lo aseguré por construcción y con tests: hay un caso que corre las mismas filas por
los dos caminos (`/admin` con filas ya cargadas, `/admin/payments` consultando) y exige el mismo
total, y otro que reproduce el bug (5 clínicas activas sin `monthlyPrice` ya no dan $0). Al ser
literalmente la misma función, divergir exigiría pasarle universos distintos.

### El número: qué MRR da y de dónde sale cada peso

Con los precios vigentes de `plan_configs` (BASIC $419 · PRO $689 · CLINIC $1,719) y **ninguna
clínica con precio negociado**, el resultado es **$4,965/mes**, que es exactamente lo que ya
mostraba `/admin` — el que estaba mal era `/admin/payments` con su $0. El desglose:

| Plan   | Clínicas | Precio lista | Subtotal |
|--------|----------|--------------|----------|
| BASIC  | 2        | $419         | $838     |
| PRO    | 1        | $689         | $689     |
| CLINIC | 2        | $1,719       | $3,438   |
| **Total** | **5** |              | **$4,965** |

Con 5 clínicas activas y esos tres precios, **ésa es la única combinación que suma $4,965** (lo
comprobé caso por caso), así que el reparto es ese salvo que alguna clínica tenga
`monthlyPrice > 0`. Si la tiene, su precio negociado manda y el total cambia: **el desglose real
lo tienes en vivo bajo el KPI**, y las clínicas con precio negociado se cuentan aparte en
`byPlan[].negotiated` precisamente para poder auditarlo.

### Riesgo conocido que NO toqué (decisión tuya)

`verify_payment` escribe `monthlyPrice: invoice.amount` **tal cual**. Si registras a mano un
pago que cubre 3 meses (el formulario deja poner el monto y el periodo libres), la clínica se
queda con `monthlyPrice` = el total de los 3 meses, y por la regla de precedencia ese número
manda sobre el del plan → MRR inflado para esa clínica. `activate_clinic` no tiene el problema
(usa `getPlanLimits`). No lo cambié porque la regla de precedencia es la pedida y arreglarlo es
decidir qué significa "monto" en ese formulario; queda anotado.

---

## [Login-Redesign] Robot 3D de Spline + spotlight + animación de éxito

Integración del handoff `Login rediseño en revisión.zip` sobre `origin/main` (c781bd43), en
worktree `feat/login-redesign`.

### Archivos tocados

**Nuevos**
- `src/components/ui/splite.tsx` — wrapper `lazy()` de `@splinetool/react-spline`.
- `src/components/ui/spotlight.tsx` — foco que sigue al cursor (framer-motion).
- `src/components/public/auth/login/login-success-animation.ts` — secuencia de éxito ≈1.15 s.

**Modificados**
- `src/components/public/auth/login/login-visual.tsx` — escena 3D + spotlight + copy nuevo.
- `src/components/public/auth/login/login-form.tsx` — refs + animación entre toast y navegación.
- `src/components/public/auth/auth-shell.tsx` — prop `visualVariant`.
- `src/app/login/page.tsx` — pasa `visualVariant="dark"`.
- `next.config.mjs` — CSP.
- `src/components/public/landing/primitives/secure-badge.tsx` — bug de hidratación preexistente.
- `package.json` / `package-lock.json` — `@splinetool/react-spline` + `@splinetool/runtime`.

### CSP

Añadido al array de la Content-Security-Policy:

```
"worker-src 'self' blob:",
```

No lo di por bueno de palabra: el runtime instalado crea **3** workers desde blob
(`new Worker(URL.createObjectURL(new Blob(...)))` en `@splinetool/runtime/build/runtime.js` —
decodificador Draco/meshopt, navmesh y ordenador de splats). Sin la directiva caen en
`default-src 'self'` y el navegador los mata sin decir nada. `script-src`, `connect-src` e
`img-src` no hicieron falta.

### Copy: el dato falso fuera

`+2,400 clínicas confían en DaleControl` **eliminado**. En su lugar, mismo hueco y mismo peso
visual (17px bold + 12px atenuado, sobre el mismo borde superior):

**CFDI 4.0** · Facturación timbrada ante el SAT

Es un sello de cumplimiento, no una métrica inventada. De paso, el rediseño ya se llevaba por
delante el testimonial *"Dr. Fernando Ruiz · Clínica Dental Roma Norte — me ahorra 10 horas de
papeleo cada semana"*, que también era inventado.

**Sigue vivo el mismo dato falso en otra pantalla:** `signup-visual.tsx:88` dice *"Únete a
2,400+ clínicas"*. No lo toqué porque el encargo pedía que el signup quedara idéntico.

### Revisión crítica (los 5 puntos, uno por uno)

1. **Lógica del form intacta.** fail-ban (`check`/`fail`/`success`), `signOut()` previo,
   `post-login`, manejo de errores y botones sociales, todos verbatim. El handoff **borraba el
   enlace "Soporte"** del pie legal; lo repuse.
2. **La animación nunca bloquea.** Va en `try/catch` en el form, y además le puse un
   **watchdog de 2.5 s** dentro del módulo: framer-motion avanza con rAF, así que si la pestaña
   se va a segundo plano a mitad de la secuencia la promesa no resolvería nunca y el usuario se
   quedaba atrapado en el login. Ahora gana la carrera el watchdog y se navega igual.
3. **El gate de 3D sí impide la descarga.** Probado en el build, no de palabra: el runtime vive
   en un chunk propio de **1970 kB** que **no aparece** en la carga inicial de `/login`
   (`app-build-manifest.json` → 14 archivos, 762 kB). Y a 375px la pestaña Network no registra
   **ni una** petición con `splinetool` / `.splinecode`.
4. **Signup idéntico.** El handoff ponía `flex:1; display:flex` en el wrapper del visual para
   los dos variants. `SignupVisual` tiene `height:100%` y un spacer `flex:1`, así que eso le
   habría estirado el panel y bajado el testimonial. Lo dejé **condicionado a `dark`**.
5. **i18n y textos.** Ningún texto sale de `dictionaries` en estas pantallas; el único texto
   existente que el handoff eliminaba era "Soporte", ya repuesto.

### Dos arreglos que no venían en el encargo

- **Hidratación rota en `/login` y `/signup` (preexistente).** Los hijos de texto de un
  `<style>` con comillas rectas (o `< > &`) los escapa React **solo** en el servidor: el
  cliente veía otro texto, la hidratación se invalidaba y **la raíz entera caía a
  client-render**. Dos focos: el comentario de `secure-badge.tsx` y el de `auth-shell.tsx`.
  Reescribí ambos comentarios sin esos caracteres — cero cambio visual. Verificado sobre el
  HTML del servidor: **0 entidades escapadas** en los 3 bloques `<style>` de cada página.
- **Fuga de listeners en `spotlight.tsx`.** El snippet pasaba arrows nuevas a
  `addEventListener` y a `removeEventListener`, así que `mouseenter`/`mouseleave` nunca se
  desregistraban. Handlers con identidad estable.

### Un ajuste estructural que hacía falta

`Spotlight` le escribe `position:relative` + `overflow:hidden` **a su elemento padre**. Tal
como venía, ese padre era la capa `position:absolute; inset:0` de la escena → el `relative` la
habría devuelto al flujo y **colapsado a 0 px de alto, con el canvas dentro**. Le puse un host
propio de 100%×100% que ya nace relative. Medido en vivo: el host queda en 864×903, no en 0.

### Verificación en navegador

Con `next dev` en :3100. El panel de `/login` se ocultó `<1024px` por CSS, así que para tener
anchos exactos monté cada viewport en un **iframe same-origin** (viewport real: dentro de él
las media queries y `matchMedia` se evalúan contra su propio tamaño, no simulado).

| # | Comprobación | Resultado |
|---|---|---|
| a | 1920 y 1440 | Robot carga. Spotlight sigue al cursor (medido: pasa de `left:-300px` a seguir el puntero). **Sin scroll horizontal** (`scrollWidth == clientWidth` en ambos). |
| b | Consola | **0 violaciones de CSP** y **0 errores de hidratación** tras los arreglos. |
| c | 1280 y 1366 | Columnas 640/640 y 683/683, tarjeta de 464px **entera dentro del viewport**, sello CFDI visible, sin scroll horizontal. |
| d | 375 | Panel `display:none`, `hasCanvas:false`, y en **Network ni una** petición de Spline. |
| e | Login correcto | toast+capa 215 ms → convergen 595 → verde+palomita 776 → velo 1195 → opaco 1395 → `pagehide` 1623. **≈1.18 s de animación** y luego navega. |
| f | Login fallido | *"Email o contraseña incorrectos."* inline con icono, **sin animación** (inputs nunca ocultos, form nunca atenuado, sin velo), se queda en `/login`. |
| g | `prefers-reduced-motion` | Solo velo: aparece 214 ms, opaco 415 ms (**~200 ms**), navega 682 ms. La secuencia larga **no corre**. |

Cómo se probaron (e), (f) y (g) sin base de datos: (f) es real de punta a punta (Supabase
apuntando a un host que no autentica → `authError`). Para (e) y (g) stubeé **solo la respuesta
HTTP de Supabase**; todo lo demás —fail-ban, post-login, toast, animación, navegación— es el
código real del form. En (g) además se emula `matchMedia('(prefers-reduced-motion: reduce)')`,
que es exactamente la entrada en la que se ramifica el módulo.

### Build

`npx next build` → **BUILD_EXIT=0** real (leído del código de salida, no de un `echo`), 365/365
páginas, sin `Failed to compile`, sin `Type error`, sin `Module not found`.
`npx tsc --noEmit` → 0 errores. `/login`: 9 kB de ruta, 231 kB First Load (vs 225 kB de
`/laboratorios/login`) — los ~6 kB de diferencia confirman que el runtime 3D no viaja ahí.

### Detalle cosmético que dejo anotado, no cambiado

En desktop **"Datos cifrados · TLS + AES-256" sale dos veces**: la pastilla nueva abajo a la
derecha del panel (la trae el handoff, tapa la esquina de la marca de Spline) y el `SecureBadge`
que ya existía dentro de la tarjeta. Se ve redundante. No borré ninguno por mi cuenta: quitar el
del form cambia algo que hoy está en producción y quitar el del panel destapa la marca de
Spline. Dime cuál prefieres y lo quito en un commit de una línea.

---

## Afiliados — el % del vendedor ahora es su parte de TU comisión (2026-08-10) · `3fc8e9ba` en main

Retomé un cambio que una terminal anterior dejó **sin commitear** en el working tree (la PC se
trabó dos veces a mitad de la edición). No descarté nada: revisé lo que había, lo cerré, lo
verifiqué y lo subí.

### El significado nuevo

El número que un afiliado escribe en "Mi equipo" no significaba lo que aparentaba.
`computeSellerSplitFromTotal` repartía `total × (sellerPct / nivelDelPadre)` y el formulario
limitaba el campo a `[0, nivel del padre]`. Con un padre en **Bronce (10 %)** y una clínica
**Básico ($80 de comisión)**, asignarle **"10 %"** a un vendedor le entregaba los **$80
completos** y dejaba al padre en **$0**. El "10" se leía como "diez por ciento" y valía "todo".

Ahora `commissionPct` es el **porcentaje de la comisión del padre**, rango **0-100**:

```
sellerMxn   = round(totalMxn × sellerPct / 100)
overrideMxn = totalMxn − sellerMxn        ← por RESTA, siempre cuadra
```

| Comisión del padre | 10 % | 30 % | 50 % | 100 % |
|---|---|---|---|---|
| Básico $80 | $8 / $72 | $24 / $56 | $40 / $40 | $80 / $0 |
| Profesional $140 | $14 / $126 | **$42 / $98** | $70 / $70 | $140 / $0 |

El **nivel del padre deja de ser tope y denominador** del reparto: se fue de `clampSellerPct`
(que queda vivo **solo** para el modo histórico "pct"), de la validación de los dos endpoints
de equipo, del formulario y de los textos. `computeSellerSplit` (la del modo % sobre la
factura) **no se tocó** y conserva sus propios tests. **DaleControl paga exactamente lo mismo**:
esto solo redistribuye entre padre y vendedor.

### Qué encontré a medias al retomar

El grueso estaba hecho y era coherente — la terminal anterior alcanzó a dejar el corte
`team-split.ts` (matemática pura, client-safe), el webhook llamando a la firma nueva de dos
argumentos, los dos endpoints con tope 100, el formulario con la equivalencia viva y la
migración escrita. Lo que faltaba y cerré yo:

- **`prisma/schema.prisma` seguía documentando el significado viejo** en cinco comentarios:
  `commissionPct … (0..nivel del padre)`, `commissionMxn … (amount × min(%congelado, nivel%))`,
  `sellerPct … CONGELADO al alta` sin decir de qué, y dos cabeceras que decían que las dos
  porciones "suman el % del nivel del padre". Es el documento donde alguien va a buscar qué
  significa la columna; quedaba contradiciendo al código.
- **Dos textos sueltos**: el comentario `GET: … + cap del nivel` del endpoint de equipo y el
  subtítulo de la página ("asigna a cada uno su porcentaje de comisión" → "qué parte de tu
  comisión se lleva").
- **Dos huecos en el script de migración** (detalle abajo).

Verifiqué además que **nada quedó colgando**: cero referencias a `currentParentLevelPct` (la
función borrada), cero llamadas a `computeSellerSplitFromTotal` con la firma vieja de tres
argumentos, y el congelado del alta (`api/auth/register`) ya copiaba `seller.commissionPct`
tal cual, sin clampear al nivel — o sea que bajo el significado nuevo ya era correcto.

### La migración de datos — NO LA CORRÍ

`scripts/migrate-seller-share-pct.mts` convierte `nuevoPct = round(viejoPct / nivel × 100)`
(clamp a 100) en los **dos** lugares donde vive el número:

- `affiliate_sellers.commissionPct` — la asignación vigente.
- `affiliate_seller_attributions.sellerPct` — el **congelado por clínica**, que es el que
  decide lo que se paga de verdad en cada factura.

Sin esta conversión, un vendedor al 5 % con un padre en Bronce —que cobraba **la mitad** de la
comisión— pasaría a cobrar el 5 %. Dinero prometido que se evapora.

**Comando (PowerShell), en dos pasos:**

```powershell
$env:DATABASE_URL = "postgresql://..."   # el de producción

# 1) INFORME — no escribe una sola fila. Imprime tabla vieja→nueva y un token.
npx tsx scripts/migrate-seller-share-pct.mts

# 2) APLICAR — solo con el token que imprimió el informe de arriba.
npx tsx scripts/migrate-seller-share-pct.mts --apply --token=<token>
```

**Cuántas filas toca:** exactamente las que el informe lista como `[convertibles]` — toda fila
de esas dos tablas con `pct > 0` cuyo padre tenga un % de nivel utilizable. Las de `pct = 0` y
las de un padre sin nivel se saltan y salen en `[sin conversión]`. **No pude contarlas yo: no
me conecté a la base** (el informe del paso 1 es justo el que da el número antes de escribir
nada). Si el módulo de equipos todavía no tiene vendedores dados de alta, el script sale con
`NO HAY NADA QUE CONVERTIR` y no toca nada.

**Los dos huecos que le cerré al script:**

1. **Se podía convertir dos veces.** El token caduca al cambiar los datos, sí — pero si
   alguien re-corría el informe **después** de aplicar y copiaba el token nuevo, el segundo
   `--apply` volvía a dividir entre el nivel y disparaba los porcentajes. Ahora hay un segundo
   candado: si alguna fila ya trae un % por encima del nivel más alto del programa (imposible
   con el significado viejo, que clampaba al nivel), `--apply` **se niega** y hay que pasar
   `--force` a propósito. El informe también avisa por adelantado de que el comando se negará.
2. **En modo legacy marcaba TODO como dudoso.** Sin tabla de niveles el denominador es el
   `Affiliate.commissionPct` fijo, que no se mueve; el "⚠ casos dudosos" solo tiene sentido
   cuando el padre pudo cambiar de nivel desde que asignó el %.

### Verificación

- **`npm run test:afiliados` → 66/66 verde.** Los cuatro casos de la especificación más una
  **malla de 20 totales × 16 porcentajes** (320 combinaciones, con $0.01, $0.07, $19.99,
  100/3, 33.33 %, 66.67 %, 99.9 %) comprobando `sellerMxn + overrideMxn === totalMxn`
  **en centavos enteros y con `===`**. En pesos esa comprobación no valdría nada: `0.01 + 0.06`
  da `0.06999999999999999` en binario, así que un reparto perfecto "fallaría" y uno malo podría
  pasar. Por eso el reparto entero se hace en centavos y el override sale por resta.
- **`npm run test:billing` → 94/94 verde. `npm run test:click-guard` → 8/8 verde.** Sin regresión.
- **`npm run build` completo → verde.** `Checking validity of types` sin un solo error,
  365/365 páginas, sin `Failed to compile` ni `Module not found`. Los `Environment variable not
  found: DATABASE_URL` del log son los de siempre al compilar sin `.env` local.
- **`npx tsc --noEmit` sobre el `.mts`** de la migración → 0 errores (el `include` del
  `tsconfig` es `**/*.ts` y no alcanza a los `.mts`, así que `next build` no lo tipa).

### Nota sobre la equivalencia en pesos del formulario

El hint bajo el campo —"Con 30 %, por cada clínica que él traiga (cada mes que siga activa):
Profesional: él **$42** y tú **$98**"— sale de `getPublicOffer()` y se reparte con
`computeSellerSplitFromTotal`, **la misma función que escribe el dinero en el webhook**. Ni un
monto escrito a mano. Elige recurrente o pago único según la modalidad congelada del afiliado,
y si el programa estuviera en modo "% del nivel" (sin montos fijos) explica el reparto sobre
"cada $100 de comisión", donde el significado del % es idéntico. Por eso `team-split.ts` nace
como archivo aparte: `team.ts` arrastra imports de servidor y el formulario es un client
component.

## Afiliados — BONOS POR RED del equipo de vendedores (2026-08-10) · `8e31d93a` + `5fa7d9dd` en main

Premia al afiliado por las clínicas **activas que trajeron sus vendedores**. Es el primer bono
del programa que **una máquina calcula y paga sola**: los bonos por clínicas activas siguen
siendo una promesa comercial con seguimiento manual, estos no. Por eso casi todo lo que sigue
habla de dinero saliendo sin que nadie apriete un botón.

Se retomó un working tree a medias: la sesión anterior murió antes de commitear (tercera vez).
Nada se descartó; abajo está lo que faltaba.

### El criterio de conteo — una sola definición para los dos programas

**Qué se cuenta:** clínicas cuyo alta registró un `AffiliateSellerAttribution` con
`affiliateId` = el afiliado padre. Esa tabla **solo tiene fila cuando un VENDEDOR trajo la
clínica** (`/api/auth/register` la escribe únicamente si el link o el cupón resolvieron un
`sellerId` válido e hijo del padre), así que las clínicas que el afiliado trajo por su cuenta
**no aparecen ahí y no entran en este bono** — para esas está el Bono por Clínicas Activas.
Ninguna clínica cuenta en los dos.

**Qué califica:** el predicado se extrajo a `src/lib/affiliates/qualifying-clinic.ts`
(`MIN_PAID_INVOICES = 3` + `clinicQualifies`), un módulo **puro, sin una línea de BD**.
`milestones-progress.ts` ya no lo declara: lo importa y lo re-exporta, así que los callers
históricos siguen funcionando y **hay una sola definición de "clínica que califica" en todo el
repo**. Los dos programas de bonos, el admin y el cron cuentan exactamente igual.

Sobre eso, tres condiciones más, iguales a las de los bonos propios: activas **al mismo
tiempo**, el conteo **sostenido 3 meses seguidos** (`SUSTAIN_MONTHS`), y **cada escalón una sola
vez** por afiliado (índice único `(affiliateId, tier)`).

**Privacidad:** de la red del afiliado solo salen **conteos**. Ni un nombre, ni un plan, ni un
correo de las clínicas que trajeron sus vendedores.

### La elección — nada se paga antes

Al cumplirse los 3 meses el award pasa a `pending_choice` con los dos montos **congelados** y
**no paga nada**. El afiliado elige en su panel entre pago único o mensual; la elección es
**definitiva por escalón** y se le enseñan los dos números y en cuántos meses el mensual supera
al único (`compareChoices`, la misma función que usa el correo y el admin) **antes** de decidir.
Mientras no elija, el bono no vence ni se pierde, pero tampoco avanza. Escalones acumulables,
cada uno con su propia elección.

### Cómo funciona el cron

`/api/cron/affiliate-network-bonus`, Vercel Cron **`0 8 1 * *`** (08:00 UTC el día 1). El
archivo de la ruta **no decide nada**: autentica con `CRON_SECRET`, invoca y manda los correos.

Toda la lógica de dinero vive en `runNetworkBonusSweep` (con BD) sobre su cerebro **puro**
`decideNetworkSweep` (`network-bonus-core.ts`), que se prueba sin base de datos. Una pasada:
recuenta la red de todos los afiliados en **tres queries agregadas** (sin N+1), y por cada uno
produce un plan de acciones — `start-tracking`, `refresh-tracking`, `reset-streak`, `award`,
`pay-monthly`, `pause`, `resume`, `touch` — que el aplicador solo ejecuta.

**Por qué una vez al mes:** la cláusula cuenta MESES sostenidos, no días. Correrlo más seguido
no adelantaría ningún bono (`monthsElapsed` redondea hacia abajo) y solo multiplicaría
escrituras. El día 1 hace además que el mes del reloj y el mes que se paga sean el mismo.

**Pausa y reactivación** son simétricas y **no cuestan un nuevo periodo de 3 meses**: el trato
publicado es "mientras sostengas". Si la red cae, el mensual pasa a `monthly_paused` y deja de
pagar; si vuelve, se reactiva solo y cobra el mes en curso. Un `pending_choice` **no se revoca**
aunque la red baje: ya se ganó con los 3 meses.

**Degradación:** sin el SQL aplicado o con el programa apagado el barrido devuelve `ran: false`
y la ruta responde 200 con `skipped` — un deploy adelantado al SQL no pinta de rojo el panel de
crons.

### DÓNDE ESTÁ EL CANDADO DE IDEMPOTENCIA

En el **índice único de `affiliate_commissions."stripeInvoiceId"`** (que ya existía). Cada
mensualidad se escribe con la referencia **`netbonus:<awardId>:<YYYY-MM>`**
(`commissionRefMonthly`), y esa comisión va en la **MISMA `$transaction`** que la actualización
del award. Correr el cron dos veces el mismo mes **no paga doble**: el segundo intento choca
contra el índice y el rollback deja también el award como estaba, así que no queda un
`lastMonthlyKey` avanzado sin su comisión. El filtro por `lastMonthlyKey` es solo el atajo
barato que evita intentarlo; **la garantía es la base de datos, no una lectura previa** — esa
carrera se pierde. Los choques se cuentan en `duplicatesBlocked` y en una corrida sana son 0.

El pago único lleva la misma protección con **`netbonus:<awardId>:once`**, y **otorgar** es un
`updateMany` condicionado a `status = 'tracking'`, así que dos instancias simultáneas tampoco
otorgan el mismo escalón dos veces. La elección del afiliado repite el `status` en el WHERE por
la misma razón (doble clic o dos pestañas).

Los bonos entran a `affiliate_commissions` con `kind = "network_bonus"`, `clinicId = ""` y
`amountMxn = 0`, para cobrarse **por el mismo flujo de pago y reportes que ya existe**.

### Verificación

- **`npm run test:bonos-red` → 31/31 verde** (`network-bonus-core.test.ts`, nuevo). Cubre los
  puntos donde un bug cuesta dinero real: 2 mensualidades **no** cuentan y 3 sí · alcanzar un
  escalón **no paga** (y sigue sin pagar por muchas corridas que pasen) · el modo único paga
  **una sola vez** · **el cron dos veces el mismo mes no emite un segundo pago** (y a la décima
  corrida tampoco), pero el mes siguiente **sí** · la referencia del candado es determinista ·
  la red cae → pausado, sube → reactivado **sin repetir los 3 meses** · reactivar el mismo mes
  en que ya cobró **no duplica** · los montos **congelados** no se mueven si se edita la config
  (pero un `tracking` sí sigue los vivos, porque todavía no se prometió nada).
  La config de los tests trae números **distintos** a los defaults: si el motor tuviera un
  umbral tecleado dentro, los tests lo verían.
- **`npm run test:afiliados` → 66/66 · `npm run test:click-guard` → 8/8.** Sin regresión en el
  motor de comisiones.
- **`npm run build` completo → verde**, exit 0, `Checking validity of types` sin un error,
  365/365 páginas. Las tres rutas nuevas y las tres páginas tocadas salen en el manifest.
- **Aislamiento entre afiliados:** el `affiliateId` sale **siempre** de la sesión
  (`getAffiliateContext`) y viaja **dentro del WHERE**, no como comprobación posterior — el
  award de otro afiliado sencillamente no existe para esa consulta, así que un `awardId`
  adivinado devuelve 404 y no hay ventana entre "leer el dueño" y "escribir la elección".

### Qué encontré a medias al retomar

El núcleo estaba completo y coherente (lógica pura, helpers con BD, las tres rutas, el admin
entero, los correos y los cuatro reportes). Faltaba, y se hizo ahora:

1. **`network-bonus-card.tsx` no existía.** `network-bonus-choice.tsx` ya lo citaba como "el
   server component" y la importación habría roto el build. Es el bloque del panel: conteo,
   barra al siguiente escalón, los cinco escalones, el pendiente de elección bien visible con
   sus dos botones y los ya elegidos con su estado.
2. **El bloque no estaba enganchado** en `/afiliados/inicio`.
3. **No existía la sección de bonos de red en `/terminos-afiliados`** ni la mención en la
   landing `/afiliados`.
4. **No había tests** — y `npm run test:bonos-red`, citado en tres comentarios del código, no
   existía en `package.json`.
5. **`SUSTAIN_MONTHS` usado donde iba `MIN_PAID_INVOICES`** en el texto del admin. Los dos valen
   3, así que se leía bien por accidente: exactamente la "segunda verdad" que el resto del
   módulo se esfuerza en evitar.
6. **La tabla de comisiones recientes del panel** pintaba una "Clínica" fantasma en la fila de
   un bono. Las otras cuatro superficies ya estaban corregidas; esta se había quedado fuera.
7. **La unión `ChooseResult` no compilaba.** El `tsconfig` corre con `strict: false` y sin
   `strictNullChecks` TypeScript **no estrecha una unión por un discriminante booleano**: dentro
   de `if (!result.ok)` el tipo sigue siendo la unión entera. Se agregó la guarda
   `isChooseFailure`, que funciona igual con `strict` en true o en false. **Esto tumbaba el
   build.**
8. **Los bonos se colaban en los avisos flotantes públicos de `/afiliados`.** Ese widget lee
   `affiliate_commissions` y redacta *"Un afiliado cobró $X **por una clínica**"*, resolviendo
   el plan desde `clinicId`. Un bono no nace de ninguna clínica, así que la landing pública
   habría publicado *"Un afiliado cobró $400,000 por una clínica"* — falso, y justo sobre el
   pago más grande del programa. Se excluyen por `kind`.

### El encuadre, que no es cosmético

En el panel, en los términos y en la landing se dice lo mismo: **se cobra por CLÍNICAS ACTIVAS
que contratan y pagan un producto, nunca por incorporar personas al equipo**. Los términos lo
dicen explícitamente ("registrar vendedores no genera por sí mismo ningún pago… ni existe cuota,
compra ni inscripción alguna para participar") y la landing cierra con "un equipo grande sin
clínicas activas no genera ningún bono". Es lo que separa un programa de ventas de un esquema
piramidal y **ninguna reescritura de esos bloques puede aflojarlo** — hay un comentario en cada
uno de los tres archivos diciéndolo.

### QUÉ DEBE PROBAR RAFAEL EN PROD

El SQL ya está corrido, así que la tabla y las 16 columnas existen. Lo que falta es de operación:

1. **`/admin` → Afiliados → Esquema de pago.** Confirmar que el bloque "Bono por su equipo"
   carga los valores **vivos** (5→$3,000/$400 · 20→$15,000/$1,800 · 50→$40,000/$5,000 ·
   150→$120,000/$16,000 · 500→$400,000/$55,000) y **no** los defaults del DDL. Si aparece el
   aviso ámbar de "falta correr sql/afiliados-bonos-red.sql", algo no cuadra: avisar.
   Guardar sin cambiar nada y verificar que responde OK y que dice que la landing se revalidó.
2. **Las equivalencias del formulario.** Cada escalón imprime en cuántos meses el mensual
   alcanza al único y qué % del ingreso de esa red se lleva. Con $3,000/$400 deben salir
   **8 meses** para igualar. Es la cifra que verá el afiliado al decidir.
3. **La validación.** Poner el umbral del escalón 3 por debajo del 2 y comprobar que el guardado
   **se rechaza** con un mensaje que nombra los dos escalones.
4. **`/afiliados` y `/terminos-afiliados`.** Que la mención y la sección salgan con los montos
   vivos, y que la sección de los términos **no salte** la numeración.
5. **El cron, en seco.** Dispararlo a mano con el `Bearer $CRON_SECRET`. Con nadie cerca de un
   umbral debe responder `ok: true` con todos los contadores en 0 (o `started` > 0 si algún
   vendedor ya trajo suficientes). **Dispararlo DOS VECES seguidas** y comprobar que la segunda
   no genera comisiones y que `duplicatesBlocked` sigue en 0 (el filtro barato ya lo evita).
6. **Un award real, de punta a punta.** Es lo único que no se puede probar sin datos: cuando
   algún afiliado llegue a `pending_choice`, revisar que le llegó el correo con las dos
   opciones, que el panel enseña los dos botones, que al elegir se genera **una** comisión con
   `stripeInvoiceId` = `netbonus:<id>:once` o `netbonus:<id>:<YYYY-MM>`, y que el segundo clic
   responde 409.
7. **La bandeja del admin.** La alerta anticipada (`approaching`, 80 % del umbral) es lo que
   permite ver venir una salida de $400,000 con meses de antelación. Vale la pena mirarla de vez
   en cuando aunque hoy esté toda en cero.

**Ojo con el mensual:** es un costo **recurrente** mientras el afiliado sostenga el número, no
una salida única. El formulario avisa en ámbar si un mensual pasa del 15 % del ingreso estimado
de esa red, pero el aviso **no bloquea**.

---

## AFILIADOS — EL SEGUNDO NIVEL, REHECHO (ago 2026)

### Por qué se tiró el modelo anterior

El segundo nivel estaba **muerto por diseño**. Un "vendedor" cobraba una fracción de la comisión
de quien lo había reclutado, sin elegir modalidad, sin bonos propios y sin poder armar su propio
equipo. Comparado con registrarse directo en DaleControl, siempre perdía — así que a nadie le
convenía entrar por el link de otro afiliado, y el número lo confirmaba: **0 vendedores y 0
atribuciones en la base**. Eso permitió rehacerlo limpio: no hubo nada que migrar y nadie dejó
de cobrar.

### El modelo nuevo, en cuatro reglas

1. **El invitado es un afiliado NORMAL, idéntico al que lo invitó.** Misma comisión por plan
   ($80/$140/$300, de la config), elige su propia modalidad (fijo recurrente o pago único), gana
   sus propios bonos por clínicas activas (5/25/50), puede invitar gente a su vez y usa el panel
   normal. Cero diferencias. No hay un tipo de cuenta "de segundo nivel": hay afiliados.
2. **Quien invita NO cobra por las clínicas de su invitado.** Ni reparto, ni override, ni nada
   mensual. Su premio son los **BONOS POR RED**, y únicamente como **PAGO ÚNICO**:
   $3,000 / $15,000 / $40,000 / $120,000 / $400,000 al llegar a 5, 20, 50, 150 o 500 clínicas
   activas de sus invitados. La modalidad mensual de esos bonos se apagó entera.
3. **UN SOLO NIVEL.** Si A invita a B y B invita a C, las clínicas de C cuentan para el bono de
   red de B y **nada** para A. Nunca se acumula hacia arriba. No es una preferencia de producto:
   es lo que mantiene el programa lejos de un esquema piramidal y lo que hace el costo
   predecible. Se cumple **por construcción**, no por una validación: el conteo mira
   `Affiliate.invitedByAffiliateId` a un salto y no existe una sola consulta que recorra el árbol.
4. **Vínculo permanente y visible.** El invitado ve en su panel quién lo invitó, presentado como
   un dato normal. El vínculo se escribe UNA vez, en `createAffiliateAccount`, y **ninguna ruta,
   pantalla o acción lo cambia o lo borra** — ni el panel ni el admin. Si se pudiera romper,
   cualquiera se desvincularía el día antes de que su invitador cobrara un bono que ya se ganó.

### El link de invitación: por qué NO es `/r/<code>`

`/r/<code>` es el link de **clientes**: siembra la cookie de atribución `dc_aff` y manda a la
home para que la clínica que se dé de alta después cuente como referida. Meter ahí también las
invitaciones entre afiliados habría mezclado dos atribuciones distintas en la misma cookie —el
invitado habría quedado además marcado como "clínica referida" de su invitador— y vuelto ambiguo
qué significa un clic.

La invitación es un acto explícito de una sola pantalla, así que viaja como parámetro visible del
registro: **`/afiliados/registro?inv=<referralCode>`**, sin cookie y sin tocar la atribución de
clínicas. El nombre del parámetro vive en `INVITE_PARAM` (`@/lib/affiliates/invites`), fuente
única. El `inv` se propaga también a `/afiliados/vincular` para que el vínculo no se pierda
cuando alguien que ya tiene cuenta de clínica cambia de pantalla a mitad del alta.

**Nada de esto puede romper un alta.** Código inválido, invitador que no está APPROVED, o
auto-invitación → `resolveInviterId` devuelve null y la cuenta se crea igual, sin vínculo.
Perder una invitación es recuperable; perder el alta de alguien que ya llenó el formulario, no.

**Anti auto-invitación, doble candado**: la app la bloquea por correo y por id, y la BD tiene un
`CHECK (invitedByAffiliateId IS NULL OR invitedByAffiliateId <> id)`. Es la regla que impide
fabricarse una red de una sola persona y cobrarse un bono por el propio trabajo.

### Qué se eliminó

Barrido completo, sin dejar imports muertos ni endpoints que no responden a nada:

- **El reparto de comisión.** `computeSellerSplitFromTotal` y toda su rama en el webhook de
  Stripe; `computeSellerSplit` (modo pct) se fue con ella por no tener llamadores. El webhook
  quedó con **un solo `create`** bajo un comentario que fija la regla: la comisión es íntegra del
  afiliado atribuido, y si algún día reaparece ahí un segundo `create` con otro `affiliateId`, es
  que el modelo cambió.
- **La atribución de vendedor en el alta de clínicas** (`/api/auth/register`): el bloque que
  resolvía `sellerId` desde el campaign o el cupón y congelaba un `sellerPct`.
- **El panel de vendedor entero**: `/afiliados/vendedor/*`, `/api/afiliados/vendedor/*`,
  `seller-shell.tsx`, `seller-tools.tsx`, `seller-payout-form.tsx`.
- **El formulario de equipo** (`team-manager.tsx`, `/api/afiliados/equipo/*`) y su campo
  "% de tu comisión".
- **El login diferenciado**: `/api/afiliados/whoami` ruteaba afiliado vs vendedor. Ahora todos
  son afiliados y la ruta se simplificó.
- **La elección de modalidad del bono por red**: `network-bonus-choice.tsx`,
  `POST /api/afiliados/bonos-red`, `chooseNetworkBonus`, `compareChoices`, `normalizeChoice`,
  `commissionRefMonthly`, y los estados `pending_choice` / `monthly_active` / `monthly_paused`.
- `src/lib/affiliate-seller-auth.ts`, `team.ts`, `team-split.ts`, `seller-stats.ts`, los dos
  correos de vendedor, las rutas de admin de vendedores y `scripts/migrate-seller-share-pct.mts`.

### Los bonos por red, después del ajuste

- **Solo pago único.** Al cumplirse la racha, el escalón se otorga **y su comisión se genera en
  la misma transacción**. No hay estado intermedio en el que un bono ganado se quede esperando un
  clic, ni pantalla que preguntar. Ciclo de vida entero: `tracking → awarded`.
- **El conteo** pasó de `AffiliateSellerAttribution` a `Affiliate.invitedByAffiliateId`.
- **Se conservan** las condiciones: activas al mismo tiempo · 3+ mensualidades pagadas cada una ·
  sostenido 3 meses · una vez por escalón · un solo nivel.
- **El predicado de "clínica que califica" sigue siendo UNO SOLO** (`qualifying-clinic.ts`),
  compartido con los bonos propios. Nunca se reescribió.
- **El candado** sigue siendo el índice único de `affiliate_commissions.stripeInvoiceId`, ahora
  con una sola forma: `netbonus:<awardId>:once`. Las dos escrituras van en la misma `$transaction`,
  así que un choque revierte también el cambio de estado del award.
- `normalizeAwardStatus` mapea los cuatro estados de la etapa con mensualidad
  (`pending_choice`, `once_paid`, `monthly_active`, `monthly_paused`) a **`awarded`, nunca a
  `tracking`**. No había ni una fila cuando se retiró la modalidad, pero degradar un bono ya
  otorgado al estado que cuenta la racha lo volvería a otorgar y a pagar: el sentido del error
  importa más que la probabilidad.

### Privacidad del invitador

El invitador ve de cada invitado **nombre, desde cuándo, y conteos de clínicas** (activas y
cuántas califican para su bono). Jamás sus comisiones, su modalidad, sus datos de pago, su correo
ni un solo dato de las clínicas que trajo. Cobra por un número, así que ve ese número.
`getInvitedAffiliates` no selecciona nada más, y la página de "Mi red" no tiene una sola columna
de dinero.

### El encuadre, que no es cosmético

En el panel, en los términos y en la landing se dice lo mismo: **se cobra por CLÍNICAS ACTIVAS
que contratan y pagan un producto, nunca por incorporar personas**. Y **es un solo nivel**, dicho
con el ejemplo A→B→C. Ese lenguaje tiene que seguir siendo consistente en las tres superficies:
ninguna reescritura de esos bloques puede aflojarlo.

### DEUDA — tablas y columnas muertas

**No se dropeó nada** (destructivo). Queda sin uso y sin un solo lector en el código:

- Tablas `affiliate_sellers`, `affiliate_seller_attributions`, `affiliate_seller_commissions`
  (0 filas). Sus modelos siguen en `prisma/schema.prisma` con una nota de deuda encima, para no
  provocar drift.
- Columnas `affiliate_links.sellerId` y `affiliate_coupons.sellerId`.
- Columnas `affiliate_payout_config.networkTier<N>MonthlyMxn` (1..5), puestas en 0. No entran al
  `select` de `getNetworkBonusConfig`, no viajan a la UI del admin y ninguna escritura las
  menciona.
- Columnas de `affiliate_network_bonus_awards` que eran de la elección/mensualidad: `chosenAt`,
  `choice`, `monthlyMxn`, `lastMonthlyAt`, `lastMonthlyKey`, `monthlyPaidCount`, `pausedAt`.
- `sql/afiliados-equipo.sql` quedó marcado como **ARCHIVO MUERTO — NO CORRER** y
  `sql/afiliados-bonos-red.sql` con un aviso de qué dos cosas de las que describe ya no son
  ciertas.

### SQL

`sql/afiliados-invitaciones.sql` (aditivo e idempotente) — **ya corrido**. Deja la columna, su FK
`ON DELETE SET NULL` (borrar a un invitador jamás puede borrar las cuentas ni las comisiones de
la gente que invitó), el índice y el CHECK anti auto-invitación; y pone los montos mensuales de
los bonos por red en 0.

### Las superficies, una por una

- **Panel del afiliado.** "Mi equipo" → **"Mi red"** (`/afiliados/equipo`, misma ruta). Su link de
  invitación con botón de copiar —reusando el `CopyButton` que ya existía, no uno nuevo—, la lista
  de invitados, el progreso al siguiente escalón y la explicación honesta. El copy aclara que
  **este link no trae clínicas**: el de referidos sigue en Herramientas. Tener dos links en el
  mismo panel era la confusión más probable.
- **Panel del invitado.** En `/afiliados/inicio` ve "Te invitó {nombre}" como un dato normal al pie
  de la tarjeta de comisión, con la línea que importa: *ganas exactamente lo mismo que cualquier
  afiliado; tu invitador no recibe ninguna parte de tus comisiones*. Sin recuadro de advertencia y
  sin letra chica.
- **Tarjeta de bonos por red.** Sin `PendingAward` ni botones de elección: un escalón otorgado
  muestra su monto congelado, cuándo se otorgó y que ya entró al corte. Si no ha invitado a nadie,
  explica cómo empezar y enlaza a su sección de invitaciones.
- **Admin.** En la ficha del afiliado: quién lo invitó y a quiénes invitó él (con conteos), y una
  línea que deja explícito que el invitador no cobra de las comisiones de sus invitados — es la
  aclaración que evita que alguien del equipo lo lea al revés. **El vínculo no es editable desde
  ahí**: no hay botón, select ni acción que lo toque. En "Esquema de pago" los campos mensuales
  desaparecieron de la interfaz. **La alerta anticipada se conserva** (`approaching`, 80 % del
  umbral): es lo que permite ver venir una salida de $400,000 con meses de antelación.
- **Login.** `/api/afiliados/whoami` ya solo devuelve `affiliate` o `none`. El redirect a
  `/afiliados/pendiente` nunca fue suyo: lo hace `(panel)/layout.tsx`.

### Tests

92 en verde: `test:bonos-red` **27**, `test:afiliados` **57**, `test:click-guard` **8**.

Los que fijan el modelo nuevo y conviene no borrar nunca:
- *la comisión de una clínica es ÍNTEGRA del afiliado que la trajo* — la regla 2, en el motor.
- *normalizeAwardStatus: los estados legados degradan a `awarded`, NO a `tracking`* y *un status
  legado tampoco vuelve a otorgar al pasar por el barrido* — el espejo del anterior: no basta con
  probar el mapeo, hay que probar que el barrido tampoco lo re-otorga.
- *un award `awarded` NO se revoca si su red se cae: ya se ganó*.
- *la vista suma los montos CONGELADOS del award, no los vigentes*.

### QUÉ DEBE PROBAR RAFAEL EN PROD

El SQL ya está corrido. Lo que falta es de operación:

1. **El link de invitación.** Entrar a `/afiliados/equipo` con una cuenta aprobada, copiar el link
   y abrirlo **en otro navegador**: debe salir `/afiliados/registro?inv=<CODE>` con el aviso
   "Te invitó {nombre}". Registrar una cuenta de prueba y verificar en la ficha del admin que el
   vínculo quedó en los DOS lados (el invitado ve a su invitador, el invitador ve al invitado).
2. **Auto-invitación.** Abrir el propio link estando con el propio correo: el alta debe seguir
   funcionando **sin** crear vínculo. No debe salir un error.
3. **Un código basura** (`?inv=XXXXXXXX`): el registro debe funcionar igual, sin aviso y sin
   vínculo. Esto es lo que nunca puede romperse.
4. **Que el invitado cobre igual.** Con la cuenta de prueba invitada, revisar en `/admin` que su
   esquema de comisión y su modalidad son idénticos a los de un afiliado directo. Si algún día una
   clínica de ese invitado genera comisión, confirmar que se creó **una sola** fila en
   `affiliate_commissions` y que su `affiliateId` es el del invitado, no el del invitador.
5. **`/admin` → Afiliados → Esquema de pago.** Que el bloque de bonos por red cargue los umbrales y
   **un solo monto** por escalón, sin rastro de campos mensuales. Guardar sin cambiar nada y
   verificar que responde OK y que la landing se revalidó. Probar que poner el umbral del escalón 3
   por debajo del 2 **se rechaza**.
6. **El cron, en seco.** Dispararlo a mano con el `Bearer $CRON_SECRET`. Sin nadie cerca de un
   umbral debe responder `ok: true` con los contadores en 0. **Dispararlo dos veces seguidas** y
   comprobar que la segunda no genera comisiones y que `duplicatesBlocked` sigue en 0.
7. **`/afiliados` y `/terminos-afiliados`.** Que la mención y la sección salgan con los montos
   vivos, con un solo monto por escalón, y que la numeración de secciones de los términos no salte.
8. **Un award real, de punta a punta.** Es lo único que no se puede probar sin datos: cuando un
   afiliado llegue a un escalón, revisar que le llegó el correo, que el panel lo muestra como
   otorgado, y que se generó **una** comisión con `stripeInvoiceId` = `netbonus:<awardId>:once`.

Y lo que **nadie debe "arreglar" sin pensarlo dos veces**: el conteo mira `invitedByAffiliateId` a
un salto. Si alguien alguna vez lo convierte en recursivo "para que sea más justo", el programa
deja de ser de un solo nivel y el costo deja de ser predecible.

---

## [Fix-Email-Equipo] · El correo de un miembro no se guardaba (no-op silencioso)

**El síntoma.** En `/dashboard/team`, editar el Email de un doctor terminaba en "Datos
actualizados" y el correo seguía siendo el de antes. El `PATCH /api/team/[id]` armaba su objeto
`data` campo por campo — `firstName`, `lastName`, `specialty`, `color`, `phone`, `avatarUrl`,
`role`, `isActive`, `services` y los NOM-024 — y **`email` no estaba en la lista**. Llegaba en el
body y se tiraba a la basura sin un solo error. El administrador creía haber guardado.

Un detalle del reporte que no era exacto: el input **sí estaba bloqueado** (`disabled={isEdit}` en
`team-client.tsx`). O sea que había dos capas del mismo agujero — la UI no dejaba escribir y el
endpoint no dejaba guardar. Se quitaron las dos.

**Por qué no era una línea.** El email de un miembro no es una columna de Prisma: es su
**identidad de login en Supabase Auth**. Añadirlo al `update` de Prisma y nada más habría sido peor
que el bug: el panel mostraría el correo nuevo y el doctor seguiría entrando con el viejo, sin nada
en la pantalla que explicara por qué. Se aplica en los dos lados.

**El orden, que es lo delicado.** Supabase primero — es la fuente de verdad del login — con
`supabaseAdmin.auth.admin.updateUserById(supabaseId, { email, email_confirm: true })`, el mismo
patrón de `reset-password/route.ts`. El `email_confirm` no es decorativo: sin él el correo queda
pendiente de confirmar y el doctor se queda fuera esperando un mail que nunca pidió. Si Supabase
falla, **Prisma no se toca** y no se guarda ningún campo del formulario. Sólo si Auth respondió OK
se escribe en Prisma. Y si Prisma truena después, se revierte el correo en Supabase; si la
reversión también falla, queda un `console.error` con las dos direcciones y el mensaje al usuario
dice literalmente con cuál correo quedó entrando la cuenta, para que soporte no tenga que
adivinarlo.

**La consistencia real es a N filas, no a dos lados.** El schema es
`@@unique([supabaseId, clinicId])`: una persona tiene **una fila `User` por clínica**, y
`/api/clinics` crea cada sucursal nueva con el `supabaseId` del dueño. Supabase Auth, en cambio, es
global: cambiar el login lo cambia para todas sus sedes de golpe. Tocar sólo la fila de la clínica
activa habría dejado a las demás mostrando el correo viejo — la misma desincronización que este fix
viene a cerrar, sólo que escondida un nivel más abajo. Por eso el `$transaction` actualiza la fila
del path y, en la misma transacción, las filas hermanas del mismo `supabaseId`. Todas o ninguna.
Esto además importa porque `User.email` **no es `@unique`** y varios flujos lo usan como llave de
identidad a mano (`auth/check-email`, `auth/register-oauth`): una fila con el correo viejo no es
cosmética, contamina esas búsquedas.

**Validaciones, todas antes de escribir nada.** Formato (mismo patrón que `EMAIL_RE` de
`lib/import/engine.ts`, declarado local para no arrastrar exceljs a la ruta); duplicado dentro de la
clínica — el mismo chequeo que ya hacía el alta en `team/route.ts`, extendido a todas las clínicas
donde vamos a escribir y hecho `insensitive` para atrapar filas viejas guardadas con mayúsculas; y
si el correo es idéntico al actual **no pasa nada**: cero llamadas a Supabase, cero escrituras, cero
aviso. Esa comparación también es case-insensitive, porque el modal reenvía el formulario completo y
un `Doctor@X.com` guardado hace años no debe contar como cambio. El caso "ese correo ya tiene cuenta
en DaleControl" devuelve el mismo texto entendible que ya devolvía el alta, no el error crudo de
Supabase.

**Sobre el self-edit — se permite, a propósito.** El guard que ya existía bloquea dos cosas al
editarse uno mismo: cambiarse el rol (escalada) y desactivarse (lock-out). Cambiarse el correo no es
ninguna de las dos. `getAuthContext` resuelve la sesión por `supabaseId` — el `sub` del JWT, que no
cambia al cambiar el email — y la contraseña sigue siendo la misma, así que ni se cae la sesión
abierta ni se pierde el acceso. Es además el caso legítimo más común: el dueño de la clínica cambia
su propio correo. Queda documentado en el código para que no parezca un olvido.

**Lo que sí se cerró es el vector inverso.** Un ADMIN podía quedar habilitado para cambiarle el
correo a un SUPER_ADMIN, y eso es apoderarse de su cuenta: con el correo nuevo se pide "olvidé mi
contraseña" y se toma el login del dueño de la plataforma. El guard existente sólo cubría rol y
estado. Ahora un no-SUPER_ADMIN tampoco puede tocarle el correo — mismo criterio que ya aplicaban
`reset-password` y el `DELETE`.

**Auditoría.** `logMutation` ya corría aquí, y como el `before` es la fila completa leída antes y el
`after` es la que devuelve el `update` (ninguno lleva `select`), `diffObjects` registra
`email: {before, after}` solo. Quedó anotado en el código que a ninguno de los dos se le puede meter
un `select`: un cambio de identidad de login tiene que seguir siendo rastreable.

**La UI ya lo dice.** El input se desbloqueó, el hint en edición avisa que se está tocando el correo
de inicio de sesión y que la contraseña no cambia, y al guardar un correo distinto sale un banner
persistente — no un toast, que se lo lleva el tiempo — con el nombre del miembro y el correo nuevo,
recordando que el anterior ya no sirve para entrar. El endpoint devuelve `emailChanged` para que ese
aviso salga cuando cambió de verdad y no cuando el admin simplemente volvió a guardar el formulario.

**Lo que nadie debe "simplificar" después:** el orden Supabase → Prisma y la actualización de las
filas hermanas. Invertir el orden deja cuentas que el panel jura que existen y que Auth no reconoce;
quitar el `updateMany` de las hermanas reintroduce el mismo bug para cualquier clínica con
sucursales, que es justo donde más caro sale depurarlo.

**Sin SQL y sin tocar `prisma/schema.prisma`** — no hacía falta ninguno de los dos.

---

## [Sidebar-Recursos] · Los sillones se fueron de CATÁLOGO a ADMINISTRACIÓN

**Commit:** `c85914a1` (mergeado a `main` en `151ebdae`) · `src/components/dashboard/sidebar.tsx`, 9 líneas
arriba y 5 abajo. Sin SQL, sin schema, sin dependencias.

**El problema era de vecindario, no de código.** "Recursos" —los sillones y consultorios— vivía en
CATÁLOGO, entre Paquetes e Inventario y pegado a Proveedores, Mis compras y Laboratorios. Todo lo que
lo rodeaba era cosas que la clínica *compra*. Un sillón no se compra desde ahí: se da de alta para
que la Agenda pueda asignarle citas, exactamente igual que se da de alta a un miembro del Equipo.
Ahora está en ADMINISTRACIÓN, justo arriba de Equipo, que es donde el dueño ya va a configurar quién
y con qué atiende.

**El cambio es de una línea y de un lugar.** `section: "catalogo"` → `section: "admin"`, y el objeto
completo se movió dentro de `NAV_ITEMS` para quedar inmediatamente antes de `team` — en este sidebar
el orden del array *es* el orden de render, no hay campo `order` que ajustar. Se conservaron intactos
`id`, `label`, `href`, `icon: DoorOpen`, `adminOnly: true`, el array `categories` de siete categorías
y `permission: "resources.view"`. El gating no se movió ni un milímetro: el filtro se aplica en
`shouldShowItem`, que no mira la sección para nada.

**Lo que se revisó antes de darlo por bueno**, con el componente REAL montado en el navegador (una
page temporal fuera del matcher del middleware, ya borrada — el panel no levanta sin `.env`):

- **20 combinaciones de rol × categoría** (SUPER_ADMIN / ADMIN / DOCTOR / RECEPTIONIST × DENTAL / SPA
  / NUTRITION / PSYCHOLOGY / PODIATRY). Recursos sale exactamente cuando el rol es dueño/admin **y**
  la categoría está en su lista, y en las 20 quedó dentro de ADMINISTRACIÓN e inmediatamente arriba
  de Equipo. Cero desviaciones. Una clínica de NUTRICIÓN sigue sin verlo, y recepción y doctores
  tampoco, esté en la sección que esté.
- **Encabezados huérfanos: no hay riesgo, y no es mérito nuevo.** Las dos ramas de render ya venían
  guardadas con `itemsBySection[sec].length > 0 ? … : null` (la expandida y la icon-only), así que
  una sección sin ítems visibles no pinta ni el título. Se forzó el caso real: usuario con
  `permissionsOverride` sin ningún permiso de catálogo y clínica de NUTRICIÓN → CATÁLOGO **entera**
  desaparece, no queda el título solo. Prueba adicional gratis: ESPECIALIDADES lleva oculta desde
  `HIDE_SPECIALTIES` y su encabezado nunca aparece en ningún dump.
- **Secciones colapsadas por usuario:** los ids de sección no cambiaron (`clinico | catalogo |
  specialties | admin`, y `COLLAPSIBLE_SECTIONS` está duplicado a propósito en el componente y en
  `src/app/actions/sidebar.ts`), así que lo que cada usuario tenga guardado en `User.sidebarCollapsed`
  sigue siendo válido tal cual — nadie queda con un valor apuntando a una sección que ya no existe.
  Verificado que con ADMINISTRACIÓN colapsada el cuerpo mide 0px, lleva `inert` y el chevron reporta
  `aria-expanded="false"`; al expandir vuelven los 586px. El único efecto real del cambio es que un
  usuario que ya tenía ADMINISTRACIÓN colapsada tiene que abrirla para ver Recursos, igual que para
  ver Equipo o Caja.
- **Móvil y modo icono:** el drawer se probó en un viewport de 397px (el `<aside>` de escritorio ni
  se monta, el drawer abre con el evento `mf:open-mobile-sidebar` y trae el mismo orden), y el modo
  icon-only de 68px —que es otra rama de render, sin encabezados— también deja Recursos entre
  Reportes y Equipo. Los dos consumen el mismo `sidebarInner`, así que no había forma de que
  divergieran, pero se miró igual.

**Gate:** `npx next build` completo, **exit 0**, 358/358 páginas estáticas, sin errores de tipos ni de
compilación. Los `prisma:error` del log son el ruido conocido de correr el build en un worktree sin
`.env` (`DATABASE_URL` ausente), no del cambio.

**Nada más se tocó.** El diff son 14 líneas en un solo archivo y no hay ninguna otra superficie que
dependa de en qué sección estaba el ítem: la paleta de comandos no agrupa por sección, el título de
la ruta en el topbar sale de un mapa por `href` y las traducciones se resuelven por `id`
(`sidebar.nav.resources`), no por sección.

---

## [Forzar-Cambio-Password]

**Qué se cerró.** La contraseña temporal de 12 caracteres no caducaba ni obligaba a nada: el doctor
podía quedarse con ella para siempre, y esa contraseña la conoció quien lo dio de alta. En un
expediente clínico eso significa que las notas firmadas por un médico las pudo escribir su
administrador, y el `AuditLog` no tendría cómo distinguirlo. Ahora quien entra con una contraseña
que **generó el sistema** define la suya antes de poder usar el panel.

Columna `users.mustChangePassword` (`sql/must-change-password.sql`, ya aplicado por Rafael) + campo
en `prisma/schema.prisma`. Se marca en los tres puntos donde el sistema genera la contraseña —
`POST /api/team`, `POST /api/team/[id]/reset-password` y el reset del admin de plataforma — y sólo
**después** del OK de Supabase: si Auth falla no hay contraseña nueva, así que no hay nada que
exigir. La generación de la temporal y el banner amarillo de `/dashboard/team` no se tocaron.

### El orden frente al gate de 2FA: 2FA primero, contraseña después

El gate nuevo va **después** del de 2FA y **antes** del de plan. Los tres viven en
`src/app/dashboard/layout.tsx`, que corre en cada render con la BD en mano.

- **Después del 2FA porque el 2FA es autenticación.** El segundo factor decide si quien tiene la
  sesión es de verdad esa persona; cambiar la contraseña es una operación *sobre la cuenta ya
  autenticada*. Al revés sería un agujero real y no un detalle de orden: quien se hiciera con la
  contraseña temporal —que viaja por WhatsApp o se dicta en un pasillo— entraría a la pantalla de
  cambio, se pondría una contraseña propia y se quedaría con la cuenta **saltándose justo el factor
  que existe para impedirlo**. Los dos redirects no se pelean porque `/dashboard/2fa*` sale antes
  por su propio `return`: cuando corre el bloque de contraseña, el 2FA ya está resuelto.
- **Antes del gate de plan, y con `return` propio, porque si no hay loop.** Si el gate de plan
  llegara a correr sobre `/dashboard/cambiar-contrasena`, la mandaría a `/dashboard/suspended`, y
  allí el gate de contraseña la devolvería a `/dashboard/cambiar-contrasena`, indefinidamente. Con
  el `return` la ruta nunca llega al gate de plan. El efecto es que una clínica suspendida cambia
  primero la contraseña y cae en la pantalla de pago en el render siguiente — que además es el orden
  correcto: pagar con una credencial que generó el sistema y que un tercero conoce es exactamente lo
  que esto viene a cerrar. `isAllowedWhileSuspended` no se tocó.

El layout mínimo (sin sidebar ni topbar) que ya usaba el 2FA se extrajo a una constante y ahora lo
comparten las dos barreras: las dos son previas al panel y pintar el panel detrás de ellas sería
exponerlo.

### El caso Google, que era el riesgo serio

Un usuario de OAuth no tiene contraseña propia; exigirle una es pedirle que invente una credencial
que su login no usa. Se resolvió **en el punto de la marca y no en el gate**, y con una segunda red
por si acaso:

1. `markMustChangePassword` consulta las `identities` de Supabase Auth y **no marca** a una cuenta
   sin identidad de correo. El punto que más importa es el reset del admin de plataforma: es el
   único que puede tocar a un `SUPER_ADMIN`, que es justo el rol que suele haberse dado de alta con
   Google. (`POST /api/team` no necesita la consulta: `auth.admin.createUser` acaba de crear esa
   cuenta con contraseña, es de correo por construcción.)
2. La pantalla tiene un **escape**: si aun así llega una fila marcada de una cuenta sin identidad de
   correo, limpia la marca y la deja pasar al panel. Cubre lo que la comprobación de arriba no puede
   —una fila marcada antes de que este chequeo existiera, una cuenta que dejó de tener identidad de
   correo— y cuesta una llamada al Admin API sólo en esa página, que sólo se renderiza si la marca
   está puesta; no se paga en cada render del dashboard.

Ante la duda (Admin API caído, sin service role, `identities` vacío) se asume "usuario de
contraseña". Eso nunca atrapa a nadie: en el peor caso muestra una pantalla que funciona igual para
cualquier cuenta —el cambio va por Admin API, no por la sesión— y desde la que **siempre** se puede
cerrar sesión, que es el botón que la pantalla lleva a propósito.

### Filas hermanas

Una persona tiene una fila `User` **por clínica** (`@@unique([supabaseId, clinicId])`) y la
contraseña vive en Supabase Auth, que es **global**. La marca se pone y se quita en **todas** las
filas del mismo `supabaseId` — mismo criterio que el correo del staff en `10fc1b52`. Si sólo se
tocara la fila de la clínica activa, bastaría el switcher de sedes para saltarse el gate en un
sentido, o pediría cambiar de nuevo una contraseña ya cambiada en el otro.

**Un agujero que salió de tirar de ese hilo:** el gate lee la fila de la clínica **activa**, y
`POST /api/clinics` crea la sede nueva con una fila del mismo `supabaseId` cayendo al default
`false`. Una sesión marcada podía llamar a ese endpoint directo —el gate está en el layout, no cubre
`/api`—, estrenar una sede sin marca y entrar por el switcher con la temporal todavía viva. La sede
nueva ahora hereda la marca (commit aparte, `18e77a58`).

### Verificación

`npx next build` completo: **exit 0**, sin errores de tipos ni de compilación, con
`/dashboard/cambiar-contrasena` y `/api/auth/change-password` registradas como dinámicas. Los
`prisma:error` del log son el ruido conocido de correr el build en un worktree sin `.env`. Lo que
sigue es **trazado sobre el código**, no ejecutado contra Supabase: en este entorno no hay `.env`, así
que el flujo con credenciales reales queda para prod (ver abajo).

1. **Alta → temporal → pantalla → panel.** `POST /api/team` crea la fila con la marca puesta. Al
   entrar, el layout redirige a `/dashboard/cambiar-contrasena` y la sirve con layout mínimo. El
   `POST /api/auth/change-password` valida, cambia en Auth, limpia la marca en todas las hermanas y
   el cliente hace navegación dura a `/dashboard`, que ya monta el panel completo. La navegación es
   dura a propósito: el gate es del layout de servidor y un `router.push` reusaría el árbol y
   rebotaría de vuelta.
2. **Entrar con la nueva.** La marca quedó en `false` en todas las filas; ningún gate dispara.
3. **La temporal vieja ya no sirve** por `updateUserById`, que reemplaza el hash en Auth.
4. **Resetear desde Equipo vuelve a exigir**: `markMustChangePassword` sobre el `supabaseId` del
   target, después del OK de Supabase.
5. **Usuario existente no ve nada.** La columna entra con `DEFAULT false` y nada marca hacia atrás.
   Confirmado además que el `SUPER_ADMIN` dueño no se marca por accidente: se da de alta por
   `POST /api/auth/register` (nested `users: { create: … }`), que no toca el campo. Sólo existen dos
   sitios que crean filas `User` — `POST /api/team` y `seed-clinics` — más los nested writes de
   `register` y `clinics`; los cuatro revisados uno por uno.
6. **Usuario de Google**: los dos mecanismos de arriba.

**Clínica suspendida**: sin loop, por el `return` propio; el orden es cambiar contraseña → pantalla
de pago. El endpoint vive bajo `/api/auth/*`, que ya está en el allowlist del gate de plan, así que
una clínica suspendida puede completar el cambio. **Portal del paciente**: intacto, cuelga de
`/portal/[token]`, fuera de `/dashboard`, y los paneles de proveedores, laboratorios y afiliados
usan tablas de usuario propias.

**Rechazar quedarse con la temporal.** La temporal no se guarda en ningún lado —a propósito—, así
que no hay con qué compararla: la única prueba fiable de "es la misma" es que **autentique**. Se
intenta un login con la candidata en un cliente desechable (`persistSession:false`, no toca las
cookies de la sesión abierta) y si entra, se rechaza. Si esa comprobación no se puede hacer (sin
anon key, fallo de red) queda como red la del propio GoTrue. La contraseña no se escribe **en
ningún** log: ni en el `AuditLog` ni en consola; el `logMutation` registra el hecho, y su
`before/after` refleja si el cambio fue forzado o voluntario en vez de inventar una transición.

**Fuerza mínima**: se importa `scorePassword` del sitio público en vez de reescribir la regla, así
que la pantalla exige exactamente lo mismo que el registro y la recuperación por correo (mínimo 8 +
fuerza ≥ "Regular"), más el tope de 72 caracteres de bcrypt. La pantalla reusa `password-input` y
`password-strength`; no tiene botón de omitir, y es responsive por `@container` sobre un
`container-type` propio (los toasts viven en el layout raíz, fuera de ese contenedor).

**Nota de entorno:** durante la tarea hubo otra sesión escribiendo en el mismo worktree; el gate del
layout y el helper llegaron a quedar pisados por una versión distinta. Se detectó comparando
`git status` contra lo escrito, se reaplicó y se verificó archivo por archivo antes de compilar y
commitear. Vale la pena mirar el diff de `src/app/dashboard/layout.tsx` con eso en mente.
## Tesorería de IA: el consumo clínico deja de ser invisible (`feat/ai-treasury-clinical-cost`)

**El agujero.** Convivían dos contabilidades que no se hablaban. El contador de tokens del plan
(`Clinic.aiTokensUsed`) lo movían las cuatro rutas clínicas, pero no generaba ni un registro de
dinero. El monedero (`AiWallet`/`AiUsageEvent`) solo lo tocaba el bot de WhatsApp. Resultado: cada
"Analizar con IA" le costaba dólares reales a DaleControl y la Tesorería mostraba $0 — y como esa
pantalla lista la unión de clínicas *con evento* o *con monedero*, una clínica que solo usara IA
clínica (el caso de Clínica Dental Mariel, 4,311 tokens) ni siquiera aparecía en la tabla.

### Qué se registra ahora

Nace `recordUsageNoCharge()` en `src/lib/ai-billing/record-usage.ts`: **mide, no cobra**. Calcula el
costo real con lo que ya existía (`getPricingConfig()` + `computeCostUsdMicros()`), escribe UN
`AiUsageEvent` con ese `costUsdMicros`, el `fxRate` y `feePct` vigentes, y **`billedCents: 0`**. No
toca `AiWallet`: no crea monedero, no descuenta saldo, no dispara recargas. Todo dentro de un
try/catch con `console.error` — cuando se llega ahí la IA ya le respondió al doctor, así que un
fallo de medición se traga y no rompe nada.

Se llama en las cuatro rutas, justo después del `addAiTokens` que ya estaba, sin tocar ningún
`MODEL`, ni el gate de cupo, ni los 429/403/503:

| Ruta | feature | modelo |
|---|---|---|
| `POST /api/ai` | `chat_assistant` | `AI_CHAT_MODEL` (Haiku) |
| `POST /api/consult/ai-assist` | `consult_analysis` | Sonnet |
| `POST /api/xrays/[id]/analyze` | `xray_analysis` | Sonnet |
| `POST /api/prescriptions/check-contraindications` | `prescription_check` | Sonnet |

**Cache hits: cero eventos.** Las tres rutas con atajo (radiografía por `fileId`, dos rutas de ella,
y receta por hash) devuelven *antes* del `fetch` a Anthropic; el punto de registro está después de
un `response.ok`, así que un hit no puede generar costo fantasma. Tampoco registra si los tokens
vienen en cero (respuesta mock o vacía).

**Un ajuste de precisión que no pedía el encargo, y conviene revisar.** `computeCostUsdMicros`
cobraba *todo* el cache al precio de LECTURA (0.30 USD/Mtok) y `cacheWriteUsdPerMtok` (3.75) estaba
en la config, editable en el panel, sin usarse en ningún cálculo. Al bot le daba igual porque no
manda `cache_control`, pero las tres rutas clínicas sí lo mandan: con cache frío eso subestimaba el
costo real ~25%. Se añadió un sexto parámetro **opcional** `cacheWriteTokens` (default 0), así que
`chargeUsage` y el prepago se comportan exactamente igual que antes, y las rutas clínicas pasan
`cache_creation` y `cache_read` por separado. La columna `cacheTokens` sigue guardando el total.

### Cómo quedó separado el margen

El separador es `billedCents`, y los dos bloques cubren todos los eventos sin solaparse:

- **Prepago (WhatsApp), `billedCents > 0`** — tiene ingreso, así que tiene margen. `margin.allTime`
  y `margin.month` ahora se calculan **solo** con estos eventos. El margen del prepago no se movió
  ni un peso por culpa del consumo clínico, que era justo el riesgo: meter costo sin ingreso
  enfrente lo habría pintado negativo y mentiroso.
- **Incluido en el plan, `billedCents = 0`** — bloque nuevo `absorbed` en el payload, con costo en
  USD **y** en MXN (convertido con el `fxRate` histórico de cada evento, igual que el prepago). En
  la UI es una tarjeta ámbar, "Costo absorbido (incluido en planes)", con el subtítulo *"La clínica
  no paga extra; sale de su mensualidad."*

Encima de los dos, un bloque `cost` con el **costo total del mes (prepago + absorbido)** — ese es el
cheque real a Anthropic — y una sección "Este mes" que lo desglosa en tres tarjetas. El saldo de
Anthropic, la quema y el runway **sí** suman los dos bloques: es dinero que sale, venga de donde
venga. Al desplegarse, el saldo va a bajar y el runway a acortarse; eso no es una regresión, es que
por fin se está contando la IA clínica.

En la tabla por clínica: `balanceCents` viaja como `null` cuando no hay monedero y se pinta **"—"**,
no `$0.00` — un cero se leía como deuda. Se añadió la columna **Tipo de consumo** (Prepago /
Incluido en plan / Prepago + plan), el consumo prepago va "—" si nunca hubo cobro, y
**Participación** pasó a repartirse sobre el **costo total** en vez de sobre lo facturado: con
clínicas que solo tienen consumo absorbido, repartir sobre lo facturado le daba 0.0% a todas y la
columna no decía nada. El orden pone primero los monederos (saldo más bajo primero, que es lo
urgente) y después las clínicas sin monedero por costo descendente.

`MAX_ROWS` (500) se respeta y ahora recorta **antes** de pedir los nombres: el `IN` de
`clinic.findMany` crecía con cada clínica que hubiera tocado la IA alguna vez. `capped` se levanta
tanto si se llenaron los monederos como si la lista completa pasó el tope, y el subtítulo de la
tabla dice cuántas de cuántas se están viendo (antes imprimía el mismo número dos veces).

### Dos efectos secundarios que había que atajar

1. **El historial del monedero de la clínica** (`GET /api/ai-wallet`, pantalla WhatsApp → bot →
   saldo) listaba los últimos 20 `AiUsageEvent` **sin filtro**. Con el cambio se habría llenado de
   renglones de $0.00 que la clínica nunca pagó, empujando fuera de los 20 los consumos reales del
   bot. Ahora filtra `billedCents > 0`: un monedero solo enseña lo que salió del monedero. La
   pantalla sigue sin ver USD, fx ni fee.
2. **La Tesorería es solo de DaleControl.** Costo en USD, fee y margen viven exclusivamente en
   `/api/admin/ai-billing`, detrás de `isAdminAuthed()`. Ninguna superficie de clínica los recibe.

### El desglose "¿En qué se fue tu IA este mes?" — confirmado, pero la causa no era la que parecía

Se verificó y **el diagnóstico previo no se sostiene**: las cuatro rutas ya le pasaban su `feature`
a `addAiTokens` (`chat`, `consult_assist`, `xray_analysis`, `contraindications`), así que sí se
estaba etiquetando. Lo que pasa es que `/api/ai/usage` lee `AiQuotaUsage`, y esa tabla depende de
`sql/ai-quota-usage.sql`, que sigue **sin aplicar**. Sin tabla, el `groupBy` cae en su `catch`,
`byFeatureTotal` queda en 0 y toda la barra se va a la fila "sin detalle" → el 100% que se veía.
Registrar `AiUsageEvent` no arreglaba eso por sí solo: son tablas distintas.

Como el encargo prohíbe SQL, se resolvió por el otro lado: `/api/ai/usage` ahora tiene un **plan B**
que arma el desglose desde `AiUsageEvent` —que sí existe en producción— cuando el desglose del cupo
viene vacío. Solo entra si vino vacío (sumar las dos fuentes duplicaría: la misma llamada escribe en
ambas) y filtra `billedCents <= 0`, porque el prepago del bot sale del monedero, no del cupo del
plan, y no pinta en esa pantalla. Los tokens se suman con el mismo criterio que usó el contador
(entrada + salida + cache), así que el desglose cuadra con `used` y la fila "sin detalle" se
encoge sola.

Para que las dos contabilidades den la misma etiqueta, `normalizeAiFeature` aprendió los slugs de
la Tesorería como alias (`chat_assistant`→`chat`, `consult_analysis`→`consult_assist`,
`prescription_check`→`contraindications`, `xray_analysis` ya coincidía), con guarda de
`hasOwnProperty` para que un slug heredado de `Object` no devuelva una función. Las etiquetas
quedaron en es/en: **Chat del asistente · Análisis de consulta · Análisis de radiografías · Revisión
de recetas**. Y las etiquetas de `AiUsageEvent.feature` viven ahora en un mapa compartido en
`src/lib/ai-billing/types.ts`, que la pantalla del saldo del bot ya consume en vez de su `if`
suelto.

### Sin SQL, confirmado

**No se creó ninguna migración ni ningún `.sql`.** `AiUsageEvent.feature` ya era `String` (no un
enum de Postgres) con default `whatsapp_bot`, y el modelo ya traía `model`, `inputTokens`,
`outputTokens`, `cacheTokens`, `costUsdMicros`, `fxRate`, `feePct` y `billedCents`. `schema.prisma`
no se tocó. Todo lo nuevo son valores dentro de columnas que ya existían.

**Gate:** `npx next build` completo, 358/358 páginas, tipos válidos, sin errores de compilación;
`npx tsc --noEmit` limpio. Los `prisma:error` del log son el ruido conocido de correr el build en un
worktree sin `.env` (`DATABASE_URL` ausente), no del cambio.

### Lo que falta y es de Rafael

Las cuatro verificaciones de punta a punta —evento con `feature: consult_analysis`, costo > 0 y
`billedCents = 0`; Mariel apareciendo con Saldo "—"; el margen del prepago intacto; y el desglose
sin el 100% de "otro consumo"— **no se pudieron correr aquí**: el worktree no tiene `.env`, así que
no hay base contra la que pegarle. Quedan como QA manual. Y sigue pendiente aplicar
`sql/ai-quota-usage.sql`: con él, el desglose vuelve a salir de la fuente primaria y el plan B se
apaga solo.

---

## La reserva pública de las mini-webs ya no muere en un 401

`POST /api/public/book` exige sesión del portal del paciente desde hace tiempo y responde
`401 { error: "Inicia sesión para reservar tu cita", requiresAuth: true }`. **Nadie en todo `src/`
manejaba esa bandera** — el único match de `requiresAuth` era la línea que la emite. Las cuatro
plantillas hacían `throw new Error(data.error)` y pintaban ese texto en una caja roja sin botón ni
link: el visitante había elegido doctor, día y hora, y ahí se acababa. Classic era el espejo del
mismo callejón por el otro extremo: su `openBooking()` consultaba la sesión ANTES de abrir el modal
y, si no había, mandaba a `/paciente/registro` sin dejarle ver un solo horario.

### Lo que se hizo

Nace **`src/app/[slug]/_shared/booking-session.tsx`**, la pieza compartida entre el modal de
futurista/healthtech/calido (`_shared/booking-modal.tsx`) y el modal inline de classic
(`landing-client.tsx`). Nada de duplicar el gate en cinco archivos:

- **`usePatientSession(open)`** — un solo `GET /api/paciente/me`, y solo **al abrir el modal**:
  la mini-web es pública y estática, no se le cuelga un fetch de sesión a cada visita. Con sesión
  precarga nombre / teléfono / correo; sin sesión deja el estado en `anonymous`.
- **`BookingSessionBadge`** — "Reservas como {name}" arriba del paso de datos, con **Usar otros
  datos** (limpia los campos para agendar a un tercero) y el camino de vuelta, **Usar mis datos**.
- **`BookingAuthChoices`** — los dos caminos, en el paso de datos y **antes de que llene nada**:
  *Ya soy paciente · Iniciar sesión* → `/paciente/login?next=%2F{slug}` y *Es mi primera vez ·
  Crear cuenta* → `/paciente/registro?next=%2F{slug}`. La letra chica dice "Tu cuenta te sirve en
  cualquier clínica con DaleControl"; **los botones no dicen DaleControl**, porque el paciente
  conoce a su dentista, no a la plataforma.
- **`savePendingBooking` / `takePendingBooking` / `useBookingReopen`** — el hueco elegido
  (`{ doctorId, date, slot, service }`) viaja en `sessionStorage` bajo clave **por clínica**
  (`dc:pending-booking:<slug>`), se guarda en el `onClick` del enlace (antes de que el navegador se
  vaya) y al volver reabre el modal en esa selección y **borra la clave**. El `?reservar=1` del gate
  viejo de classic se sigue reconociendo para no romper enlaces en vuelo.

**El hueco ya tomado no falla seco.** Al reponer la selección se revalida contra
`/api/public/availability`: si el horario ya no está, aviso ámbar ("El horario de las 10:00 ya fue
reservado. Elige otro, por favor.") y de vuelta al calendario con ese día seleccionado, en vez de
un 409 en la cara. El mismo criterio se aplicó al 409 del `POST`: quita el horario de la lista y
regresa al paso 2. **Red de seguridad:** si el `POST` responde 401 a media reserva (sesión vencida),
se guarda el hueco y salen esos mismos dos botones — nunca más el texto rojo.

**Con sesión el flujo quedó igual de corto que antes**: doctor → fecha/hora → datos precargados →
confirmar. Cero pasos extra.

### Lo que NO se tocó

`/api/public/book` y la vinculación de expedientes quedaron intactos: `resolveBookingPatient` sigue
creando/reutilizando el `Patient` de ESA clínica y la clave de `sessionStorage` es por slug, así que
nada de otra clínica se asoma. **Sin SQL, sin envs, sin dependencias nuevas.**
`registro-form.tsx` **ya** propagaba `?next=` (a `/paciente/verificar` y a `/paciente/login`) con el
mismo `safeNext` anti open-redirect que `login-form.tsx`: verificado, no hizo falta cambiarlo.

Único retoque visual fuera del alcance estricto, y era necesario: los campos del modal compartido
llevan `text-gray-900` explícito. En **futurista** heredaban el `color: inkText` (#e7eef5) de la
raíz de la plantilla y el nombre precargado quedaba casi invisible sobre la tarjeta blanca — el
defecto ya existía, pero solo se veía ahora que los campos llegan llenos.

### Archivos

| Archivo | Qué |
|---|---|
| `src/app/[slug]/_shared/booking-session.tsx` | **nuevo** — hook de sesión, los dos caminos, el hueco guardado |
| `src/app/[slug]/_shared/booking-modal.tsx` | gate + reposición + 401/409 (futurista, healthtech, calido) |
| `src/app/[slug]/landing-client.tsx` | classic: mismo gate; muere el redirect a `/paciente/registro` |
| `src/app/[slug]/templates/template-futurista.tsx` | `useBookingReopen` + `restore` |
| `src/app/[slug]/templates/template-healthtech.tsx` | `useBookingReopen` + `restore` |
| `src/app/[slug]/templates/template-calido.tsx` | `useBookingReopen` + `restore` |

**Commit:** `c8995508` (rebasado sobre `origin/main` `57a9a3cc`, que iba 9 commits adelante — sin
solape de archivos).

### Verificación

**Build:** `npm run build` completo, sin pipes, **exit 0**, 360/360 páginas estáticas, tipos
válidos, `/[slug]` en 3.87 kB / 240 kB. Los `prisma:error` del log son el ruido conocido de correr
el build sin `.env` (`DATABASE_URL` ausente), no del cambio. `npx tsc --noEmit` limpio.

**A mano, en Chrome**, con una página temporal fuera del middleware que montaba las 4 plantillas con
clínica falsa y `fetch` mockeado (`/api/paciente/me`, `/api/public/availability`, `/api/public/book`)
— borrada antes de commitear:

| Estado | futurista | healthtech | cálido | classic |
|---|---|---|---|---|
| **Con sesión** (hueco repuesto) | ✅ | ✅ | ✅ | ✅ |
| **Sin sesión** (los dos botones) | ✅ | ✅ | ✅ | ✅ |

- **Con sesión:** el modal se reabre solo en el paso "Tus datos", con el resumen `mar, 11 de agosto ·
  10:00 · Dr/a. Ana`, el aviso "RESERVAS COMO María Fernanda Pérez López" y los cuatro campos
  precargados; el motivo repuesto (`Limpieza dental`) aparece seleccionado en el `<select>`.
- **Sin sesión:** mismo resumen, "Solo falta identificarte" y los dos botones con
  `href="/paciente/login?next=%2Fclinica-demo"` y `.../registro?next=%2Fclinica-demo` — verificados
  en el DOM. Al hacer clic, `sessionStorage` queda con
  `{"doctorId":"doc-1","date":"2026-08-11","slot":"10:00","service":"Limpieza dental"}`; antes del
  clic estaba en `null`, o sea que la clave sembrada se consumió y se borró al reabrir.
- **Hueco tomado:** el modal se queda en "Fecha y hora" con el aviso ámbar y el 10:00 ya no aparece
  entre los horarios.
- **401 a media reserva:** con sesión en la UI, al pulsar "Confirmar cita" el formulario se cambia
  por los dos botones (nada de caja roja) y el hueco vuelve a `sessionStorage`.
- **Flujo limpio sin sesión (classic):** "Agendar cita" ya **no** expulsa al registro — abre el modal,
  deja elegir doctor, día y horario, y solo en "Tus datos" pide identificarse.
- Consola del navegador: sin errores de React ni avisos de hidratación (solo los scripts de Vercel
  Analytics que no cargan en localhost).

### Lo que falta

Nada del encargo. Queda como QA de Rafael probarlo contra una clínica real con cuenta de paciente
real: aquí no hay `.env` con `DATABASE_URL`, así que el login y el `POST` de verdad no se ejercieron
end-to-end — se ejercieron sus contratos (401 / 409 / 200), que es lo que consume la UI.

---

## Reserva pública — las otras dos puertas (`/reservar` y el directorio)

**Commit:** `96579ea9` · rama `main` (sobre `4dd0bbf5`, que ya traía la puerta 1)
**Build:** `npm run build` completo, exit code 0, sin `Failed to compile` ni `Type error`.
`npx tsc --noEmit` limpio. Sin SQL, sin envs, sin dependencias nuevas.

### Qué reutilicé del helper (y qué tuve que hacer crecer)

La lógica de la puerta 1 vivía dentro de `src/app/[slug]/_shared/booking-session.tsx`, mezclada con
UI que pinta con el `theme` de cada mini-web. Las otras dos superficies tienen estilo propio
(oscuro en `/reservar`, violeta del directorio en el popup), así que **moví la lógica a un módulo
sin piel** y dejé la piel donde estaba:

- **Nuevo:** `src/lib/patient-portal/booking-auth.ts` — sesión (`usePatientSession`,
  `fetchBookingAccount`), hueco guardado (`savePendingBooking` / `takePendingBooking` /
  `useBookingReopen`), `patientAuthHref` + `safeNextPath` + `currentBookingNext`, el copy
  (`BOOKING_AUTH_COPY`), los dos caminos como datos (`bookingAuthLinks`), la salida por teléfono
  (`bookingPhoneExit`), `requiresPatientAuth`, `splitFullName` y la decisión del hueco al llegar la
  disponibilidad (`pendingSlotOutcome` + `slotTakenNotice`).
- `_shared/booking-session.tsx` **re-exporta** todo eso y conserva sus tres componentes con estilo
  de mini-web. Las 4 plantillas y los dos modales siguen importando exactamente lo mismo.
- `patientAuthHref` creció de `(kind, slug)` a `(kind, next)` para que el `?next=` sea la ruta real
  de cada superficie; `BookingAuthChoices` mantiene su prop `slug` y arma `/${slug}` como antes.
- `src/lib/directory/booking-state.ts`: `fetchPatientMe` y `buildRegistroUrl` ahora delegan en el
  módulo compartido — el `fetch` de `/api/paciente/me` existe UNA sola vez en el repo.
- `BookingAuthChoices` acepta ahora `next` y `phone` opcionales. **Las mini-webs no los pasan**: la
  puerta 1 se renderiza idéntica.

### Qué agregué en cada superficie

**A. `/reservar/[slug]` (`booking-client.tsx`)** — la trampa era real: ya llamaba a
`/api/paciente/me`, pero para **expulsar**. Sin sesión, al abrir la página redirigía a
`/paciente/registro` antes de que el visitante viera a la clínica; y el 401 del POST hacía lo mismo.
- Fuera el redirect de entrada: ahora se elige servicio → doctor → día y hora sin cuenta.
- Paso 4: `loading` → línea discreta; `anonymous` → los dos caminos con estilo oscuro + "Tu cuenta
  te sirve en cualquier clínica con DaleControl" + "o llámanos al …"; `authenticated` → chip
  "Reservas como {name}" con "Usar otros datos" y los campos precargados.
- `useBookingReopen` repone el hueco al volver (doctor, día, motivo y horario) y salta al paso 4.
- 401 del POST → guarda el hueco y muestra los dos botones con copy de "Tu sesión se cerró".
- 409 → aviso ámbar nuevo (`AmberNotice`), quita el horario de la lista y regresa al calendario.

**B. Directorio (`components/directory/BookingSchedule.tsx`)** — no tenía nada: un solo botón
"Continuar con mi cuenta" que mandaba al registro.
- Mismo contrato con la piel del directorio (ShieldCheck, violeta, blanco): los dos caminos,
  el pie de cuenta portátil y "o llámanos al …".
- Chip "Reservas como {name}" con salida a datos de otra persona.
- 401 del POST → persiste la selección y vuelve a los dos botones (antes caía en el `else` rojo).
- El hueco NO usa el `sessionStorage` de las mini-webs: el directorio ya tenía algo mejor
  (`persistSelection` + URL `?reservar=&servicio=&doctor=&fecha=&hora=` que reabre el popup en el
  paso 4 vía `BookingPopupController`). Se conserva y el `?next=` sale de esa misma URL.

### `next` en el registro

`registro-form.tsx` **ya** lo propagaba con `safeNext` (a `/paciente/verificar?...&next=` y al link
de login), y `verificar-form.tsx` cierra la cadena con `window.location.assign(next || "/paciente")`.
No hizo falta tocarlos.

### Archivos

- `src/lib/patient-portal/booking-auth.ts` (nuevo)
- `src/app/[slug]/_shared/booking-session.tsx`
- `src/app/reservar/[slug]/booking-client.tsx`
- `src/components/directory/BookingSchedule.tsx`
- `src/lib/directory/booking-state.ts`

### Cómo lo probé (sin `DATABASE_URL` local)

Página `probe-tmp` temporal fuera del middleware, con `window.fetch` stubeado para
`/api/paciente/me`, `/api/public/availability` y `/api/public/book` (200 / 401 / 409). **Borrada
antes del commit** — `git status` limpio salvo los 5 archivos de arriba.

- **`/reservar` sin sesión:** ya no expulsa; el paso 4 muestra "Solo falta identificarte", los dos
  botones (`/paciente/login?next=…` y `/paciente/registro?next=…` con la ruta actual **y su
  querystring**) y "o llámanos al 999 123 4567". Al hacer clic queda
  `dc:pending-booking:clinica-sonrisa` con doctor/día/hora/motivo.
- **`/reservar` con sesión:** al volver reabre en el paso 4 con el mismo hueco, chip "Reservas como
  María Pérez García" y los 4 campos precargados; "Usar otros datos" los vacía y ofrece volver.
- **`/reservar` hueco tomado:** al volver con un horario que ya no está → "El horario de las 11:00
  ya fue reservado. Elige otro, por favor." en el calendario, con el día y el motivo conservados.
- **`/reservar` 401 a media reserva:** el formulario se cambia por los dos botones con "Tu sesión se
  cerró" y el hueco vuelve a `sessionStorage`. Cero caja roja.
- **`/reservar` 409:** aviso ámbar "Ese horario ya fue reservado", el 09:30 desaparece de la lista y
  vuelve al paso 3.
- **Directorio sin sesión:** los dos botones con `?next=` de la URL actual y la selección completa
  en `dc-directory-booking` (`{clinicSlug, service, doctorId, date, slot, savedPath}`).
- **Directorio con sesión:** chip + campos precargados, sin pasos extra.
- **Directorio 401 / 409:** 401 → dos botones y selección persistida; 409 → sigue igual que antes
  ("Ese horario se acaba de ocupar" + "Elegir otro horario").
- **Puerta 1 intacta:** el modal compartido de las plantillas se ve idéntico, sus enlaces siguen
  siendo `?next=%2Fclinica-sonrisa` (la mini-web, no la ruta actual) y **no** aparece la línea de
  teléfono. Con sesión, el chip y el prefill siguen funcionando.

### Detalle que conviene saber

El encargo pedía la salida por teléfono "igual que en las mini-webs": **las mini-webs no la tenían**.
El helper ya la soporta (`phone` opcional); pasarla en `booking-modal.tsx` y `landing-client.tsx` es
una línea en cada uno, pero no la puse para no cambiar el render de las 4 plantillas. Se enciende
cuando digas.

---

## [Píxel de Meta en el sitio público] — 2026-08-11 (`189f43db`)

El sitio no tenía **ningún** píxel. La campaña de Meta Ads optimiza a "vistas de la página de
destino", que es un evento que **solo el píxel puede medir**: sin él, Meta no tiene señal a la que
optimizar y no reparte. De ahí las 19 h con 1 sola impresión.

Se instaló el conjunto de datos **1692815882024068** — "DaleControl Web". El viejo de tipo app
(`1485010419522177`) se dejó como estaba: sigue inactivo, con 0 eventos, y no se toca.

### Archivos tocados (3)

| Archivo | Qué |
| --- | --- |
| `src/lib/analytics/meta-pixel.ts` | **nuevo** — `META_PIXEL_ID`. Constante en el código, mismo criterio que `GA4_MEASUREMENT_ID` y el tag de Ads: es un identificador público, no cambia entre entornos, y como variable de entorno un deploy sin la var dejaría la campaña midiendo cero en silencio. |
| `src/components/analytics/meta-pixel-pageview.tsx` | **nuevo** — `<MetaPixelPageview />`, espejo de `<GaPageview />`. |
| `src/app/layout.tsx` | 2 imports, el `<Script id="meta-pixel">` con el arranque de `fbq` justo después del de `ga-gtag`, y el componente montado junto a `<GaPageview />`. |

Sin SQL y sin tocar `schema.prisma`, como venía en el encargo.

### El reparto init / PageView

Igual que GA4 con `send_page_view:false`: el layout hace **únicamente** `fbq('init', …)` y el
PageView —uno por navegación real, ni cero ni dos— sale del componente. El App Router no dispara
PageView solo: el snippet oficial tal cual mediría la primera página de la visita y ninguna más
(una visita de 5 páginas contaría 1).

El componente copia las tres decisiones de `ga-pageview.tsx`:

- **`<Suspense fallback={null}>`** alrededor del interno. `useSearchParams` lo exige o `next build`
  revienta con `missing-suspense-with-csr-bailout` y las páginas públicas pierden el prerender.
- **deps `pathname` + `searchParams.toString()`** (el string, no el objeto: el objeto cambia de
  referencia en cada render y dispararía un hit por render). `query` no se lee en el cuerpo —el
  PageView de Meta no acepta la ruta como parámetro, el píxel lee `location` por su cuenta—, está
  en las deps a propósito para que un cambio de solo query string cuente como navegación; lleva su
  `eslint-disable-next-line` con la razón escrita.
- **reintento 100 ms × 40** mientras `window.fbq` no sea función. El `<Script>` es
  `afterInteractive`, así que en la primera carga el efecto corre **antes** de que `fbq` exista y
  sin el reintento se perdería el PageView de entrada de cada visita, que es justo el que le
  importa a la campaña. Si se agota (adblock) se rinde en silencio; `clearTimeout` en el cleanup.

### Privacidad — la regla no se duplicó

El guard es **el mismo `PRIVATE_PATH_PATTERN` de `src/lib/analytics/ga4.ts`**, importado en los dos
únicos sitios que lo aplican: el `<Script>` inline (decide si llega a hacer `init`) y el componente
(vía `isPrivatePath`, decide si manda el PageView). La regex no se copió a ningún lado, así que
`/afiliados/loquesea` nuevo sigue naciendo excluido igual que en GA4.

Consecuencia concreta: en `/dashboard`, `/admin`, `/portal`, `/paciente`, `/proveedores`,
`/laboratorios`, `/onboarding`, `/live` y `/tv` **ni siquiera se descarga `fbevents.js`** y `fbq`
nunca se define. No es solo higiene de medición: `/paciente` y `/portal` son datos de pacientes y
no pueden mandar señales a Meta.

Por lo mismo **no** se añadió el `<noscript><img>` del snippet oficial: este es el layout **raíz**,
y ese pixel de respaldo se renderizaría también en las rutas privadas — justo lo que el guard
existe para impedir.

Efecto lateral que conviene conocer: si una visita **empieza** en una ruta privada, `fbq` no se
define en toda esa sesión de SPA; si después navega en cliente a una pública, no se manda PageView
(el reintento se agota y calla). Es fail-closed a propósito y es exactamente lo que ya hace GA4.

### CSP: confirmada, no tocada

Se revisó `next.config.mjs` y no hizo falta ni una línea:

- `script-src` ya trae `https://connect.facebook.net` (entró con el SDK de WhatsApp) → `fbevents.js`.
- `img-src 'self' data: blob: https: http:` → el beacon `facebook.com/tr?…`.
- `connect-src 'self' https: wss:` → los envíos por fetch/`sendBeacon`.
- `frame-src` ya lista `www.facebook.com` y `staticxx.facebook.com`, por si `fbevents` monta iframe.

El `<meta name="facebook-domain-verification">` ya estaba en el `<head>` y no se duplicó.

### Build

`npm run build` completo, **exit 0** (marcador `BUILD_DONE_EXIT=0` en el log; sin `| tail`, que
enmascara el código de salida). `✓ Generating static pages (360/360)`.

Cero `missing-suspense-with-csr-bailout` y **ninguna pública perdió el prerender**: `○ /`,
`○ /afiliados`, `○ /casos-de-uso`, `○ /herramientas`, `○ /reservar`, `● /[slug]`,
`● /casos-de-uso/[slug]` siguen estáticas. Los avisos del log son los de siempre y ajenos a esto:
las 3 clases ambiguas de Tailwind, el `Critical dependency` de `file-type`, y el ruido de
`DATABASE_URL not found` por buildear sin `.env`.

### Falta por verificar (no lo pude hacer yo)

El build no prueba que Meta reciba nada. Cuando Vercel termine el deploy de `main`:

1. **Events Manager → DaleControl Web → Probar eventos**: abrir `www.dalecontrol.com` y esperar el
   `PageView`; navegar a `/precios` y confirmar que llega un **segundo** PageView (eso valida que
   el componente hace su trabajo y que no hay duplicados).
2. Abrir `/dashboard` y confirmar que **no** llega nada — ni una petición a `connect.facebook.net`
   en la pestaña Red.
3. Con eso el conjunto deja de estar en 0 eventos y la campaña ya tiene a qué optimizar.

---

## Mini-webs v2: cuatro plantillas, un solo flujo de reserva y editor por manifiesto — 2026-08-11

Cinco fases, en orden, cada una con su build completo verde antes de empujar. Todo está en `main`.

| Fase | Qué | Commit | Build |
|---|---|---|---|
| 1 | SQL + esquema | `c8155c3f` | exit 0 · 360 páginas |
| 2 | Un solo flujo de reserva + vía sin cuenta | `914a4571` | exit 0 · 361 páginas |
| 3 | Bandeja de solicitudes en la agenda | `db907085` | exit 0 · 361 páginas |
| 4 | Las cuatro plantillas nuevas | `512b2998` | exit 0 · 361 páginas |
| 5 | Editor que se dibuja solo + fin del retraso de 5 min | `2a98c3d1` | exit 0 · 361 páginas |

Ninguna fase se empujó sin `npm run build` completo (sin `| tail`, leyendo el exit code de un
marcador `EXIT=$?`, no de la notificación de fondo).

### Fase 1 — datos

`sql/landing-v2.sql` (**ya aplicado y verificado por Rafael en Supabase**) + `prisma/schema.prisma`.

- `clinics` gana `landingSections`, `landingPhotos` (jsonb), `landingUrgentText` (text) y
  `landingMsiPlazos` (integer[]). La duración por servicio **no** es columna: va como `durationMin`
  dentro del JSON de `landingServices`, que ya existía.
- Nace `booking_requests` (16 columnas + RLS deny-all). El paciente que reserva sin cuenta genera
  una **solicitud**, no una cita: `appointments.patientId` es obligatorio y sin expediente no puede
  existir la cita.
- Tres decisiones que conviene recordar:
  - Se añadió `rejectedReason` (no estaba en la lista) porque la fase 3 pide rechazar con motivo y
    si no, habría hecho falta un segundo SQL.
  - `createdPatientId` / `createdAppointmentId` van **sin FK y sin relación Prisma**: el borrado de
    paciente se calcula desde el DMMF y una relación nueva entraría en ese cálculo.
  - RLS deny-all porque la tabla guarda nombre, fecha de nacimiento y WhatsApp de gente que ni
    siquiera tiene cuenta, y entra por un endpoint público.

### Fase 2 — un solo flujo de reserva

El flujo bueno estaba copiado en cuatro archivos. Ahora vive **una vez** en
`src/app/[slug]/_shared/booking-flow.tsx` y lo montan las ocho plantillas, `/reservar` y el popup
del directorio. Saldo: **−2 472 líneas, +1 802**.

- `_shared/booking-modal.tsx` quedó como el traductor de `LandingClinic` al contrato del flujo.
- `_shared/booking-session.tsx` quedó como re-export (su UI se fue al flujo).
- `components/directory/BookingSchedule.tsx` **se borró**.
- Pasos: doctor → fecha → hora → procedimiento → identificarse. Los que no aplican se saltan solos.
  La piel sale de `surface` (clara/oscura) y todo el acento de `landingThemeColor`.

**"Cualquier disponible" fue cambio de API, no de UI:**

- `GET /api/public/availability` sin `doctorId` ya no suma las citas de toda la clínica en una
  bolsa (con tres doctores, una sola cita de las 10:00 borraba las 10:00 para los otros dos). Ahora
  el horario está libre si **al menos un** doctor lo tiene libre, y devuelve `slotDoctors`. Con
  `doctorId`, comportamiento idéntico al de antes.
- `POST /api/public/book` acepta `doctorId: "any"` y elige al doctor **dentro de la misma
  transacción** que crea la cita. Si pierde la carrera contra la constraint EXCLUDE reintenta
  (puede quedar otro libre) y sólo entonces responde 409. `resolveBookingPatient` y las
  restricciones de la agenda quedaron intactas.

**`POST /api/public/booking-request`** (nuevo, sin sesión): crea la solicitud, valida que el horario
exista en la agenda de ese día, **no** bloquea el hueco, rate limit persistente por IP, campo trampa
anti-bots, dedupe del doble envío y `clinicId` siempre resuelto desde el slug en el servidor. El
copy dice "solicitud enviada, te confirmamos por WhatsApp", nunca "cita agendada". Avisa a la
clínica por WhatsApp (a su propio número) y con una tarjeta en la campana del panel.

### Fase 3 — bandeja en la agenda

Panel lateral "Solicitudes por confirmar" arriba de las citas del día; se pinta sola cuando hay
pendientes. Cada tarjeta trae nombre, día y hora pedidos, duración, doctor solicitado (o "cualquier
doctor"), procedimiento, WhatsApp con enlace directo, fecha de nacimiento y edad.

"Crear paciente y confirmar" hace todo en **una** transacción: `Patient` con folio de
`nextPatientNumber` (jamás `count + 1`), `Appointment` resolviendo el doctor si pidió "cualquiera",
procedimiento y notas arrastrados a las notas de la cita, y la solicitud `ACEPTADA` apuntando a lo
que creó.

El hueco nunca estuvo apartado, así que puede habérselo ganado alguien: cuando pasa, el 409 vuelve
**con los horarios que sí quedan libres ese día** y la recepción reagenda desde la misma tarjeta.

Rechazar guarda el motivo. Las solicitudes vencidas se marcan `EXPIRADA` al abrir la bandeja —
nunca se borran. Aceptar exige `agenda.create` **y** `patients.create`. Todo se busca por
`(id, clinicId)`, nunca por id solo.

### Fase 4 — las cuatro plantillas

`equipo`, `sonrisa`, `consultorio`, `especialistas`, registradas en el switch de
`clinic-landing-server`, en `TEMPLATES` y en `TemplateThumb`, con sus llaves de traducción.

- **consultorio** no usa **ninguna** foto y esa es su razón de existir: el patrón del hero es un SVG
  en data-uri y los doctores salen con iniciales.
- Tipografía: la del panel (IBM Plex Sans/Mono), que **ya** carga el layout raíz como `--font-sans`
  y `--font-mono`. Ninguna plantilla importa fuentes de Google.
- Todo el color deriva del acento, incluido el fondo oscuro de "especialistas". La única excepción
  es el ámbar de urgencias en "consultorio", que es semántico.
- **Cero copy comercial inventado**: valores, credenciales y cifras se arman sólo con lo que la
  clínica capturó. Si el dato no está, la tarjeta no existe.
- Cada sección se oculta sin datos: sin galería, sin testimonios, sin fotos de casos o con un solo
  doctor, la página se ve terminada.
- Piezas nuevas compartidas: `_shared/landing-data.ts` (lectura normalizada de los campos v2, con
  la cadena de respaldo ranura → `landingCoverUrl` → galería) y `_shared/landing-pieces.tsx`
  (comparador antes/después —arrastrable también con el teclado— y simulador de MSI).

### Fase 5 — el editor se dibuja solo

`_shared/template-manifest.ts` con el manifiesto de las **ocho** plantillas: secciones, ranuras de
foto y textos. `manifest-editor.tsx` se pinta leyendo eso y no conoce ninguna plantilla por su
nombre: **añadir una novena es escribir su manifiesto**.

- Secciones: reordenables con interruptor; contacto y reservar ni se apagan ni se mueven.
- Fotos: tarjeta por ranura con nombre, proporción, foto actual y un **diagrama** de la plantilla
  que resalta dónde va a salir antes de subirla.
- Textos: un campo por texto, con el valor por defecto de placeholder.
- Duración por servicio (viaja como número), urgencias y MSI con su interruptor.
- `/api/landing-upload` acepta el id de ranura y lo valida contra el manifiesto: `field` entra en la
  ruta del objeto y no puede ser texto libre del cliente.
- Vista previa en vivo al lado (iframe de `/landing-preview`), escritorio y móvil, recargada en cada
  guardado.
- **El retraso de 5 minutos se acabó**: el PATCH de `/api/clinic-landing` revalida `/[slug]`, la
  vista previa y la ficha del directorio.

### Qué queda pendiente (no lo pude hacer yo)

1. **Nadie ha mandado todavía una solicitud real.** Falta la prueba de punta a punta en producción:
   abrir la mini-web de una clínica, reservar **sin cuenta**, y confirmar que (a) llega el WhatsApp
   al número de la clínica, (b) aparece la tarjeta en la campana y en la bandeja de la agenda, y
   (c) "Crear paciente y confirmar" deja el expediente con folio correcto y la cita en su hueco.
2. **El aviso por WhatsApp a la clínica sale con texto libre.** Si el número de la clínica está
   fuera de la ventana de 24 h de Meta, ese mensaje **no llega y falla mudo** (el mismo agujero de
   `whatsapp_sin_plantillas`). La solicitud igual queda guardada y visible en el panel, pero
   conviene registrar una plantilla para este aviso.
3. **La expiración de solicitudes corre al abrir la bandeja**, no por cron. Si nadie abre la agenda
   en varios días, quedan `PENDIENTE` en la tabla (la campana ya no las anuncia porque filtra por
   `requestedAt >= ahora`). Si molesta, es un cron de dos líneas sobre `expirePastRequests`.
4. **Las plantillas nuevas no se han visto con datos reales de una clínica**, sólo compiladas.
   Vale la pena abrir `/landing-preview/<slug>?preview=equipo|sonrisa|consultorio|especialistas`
   con una clínica que tenga servicios, doctores y fotos cargados.
5. **`landingGallery` y `landingCoverUrl` siguen vivas** junto a `landingPhotos`: las plantillas
   viejas las usan y las nuevas caen a ellas como respaldo. No hay migración de datos y no hace
   falta, pero conviene saberlo antes de tocar el uploader viejo.

---

## WhatsApp: entrega real y plantillas aprobadas (P0 M-09 + Ola 1 de la auditoría)

**Fecha:** 2026-08-11 · **Rama:** `main`

El problema de fondo: WhatsApp solo deja escribir libremente durante las 24 h siguientes al último
mensaje **del paciente**. `sendWhatsAppMessage` mandaba SIEMPRE `type:"text"`, así que a todo el que
no le hubiera escrito antes a la clínica **no le llegaba nada** — Meta respondía 131047 y el panel lo
pintaba como "Enviado". Encima el webhook no leía el array `statuses` de Meta, de modo que ni la
doble palomita del Inbox ni el estado del recordatorio se enteraban jamás de si el mensaje llegó.

### Fase 1 — Columnas de entrega y de plantillas · `c433cb85`

`sql/whatsapp-entrega-y-plantillas.sql` (**aplicado por Rafael en Supabase**) y su reflejo en
`prisma/schema.prisma`:

- `inbox_messages`: `deliveryStatus` (SENT|DELIVERED|READ|FAILED), `deliveredAt`, `readAt`,
  `errorCode`, `errorTitle`. El código va aparte del texto porque Meta cambia la redacción y el
  idioma del mensaje, pero nunca el número.
- Índice `inbox_messages_externalId_idx`: un status de Meta trae el wamid y nada más, y el
  `@@unique([threadId, externalId])` que ya existía no sirve para buscar por `externalId` a secas
  porque su columna guía es `threadId`.
- `clinics`: `waTemplates` (jsonb) y `waBillingOk` (bool).

Se usó `TIMESTAMPTZ(3)` con `@db.Timestamptz(3)` en Prisma: sin la precisión explícita el DDL queda
en microsegundos y el schema en milisegundos, y el schema acabaría mintiendo sobre la base.

### Fase 2 — Estado de entrega real (M-06, M-10)

**Webhook** (`src/app/api/whatsapp/webhook/route.ts`): procesa `value.statuses[]` **antes** del
early-return de `messages` — un payload de status no trae `messages` y hasta hoy salía por ahí sin
que nadie lo leyera. Por cada status localiza el mensaje y actualiza su entrega.

El wamid está guardado de dos formas según quién mandó el mensaje: crudo (respuesta del staff, ecos
de coexistence) o dentro de `sys:<kind>:<wamid>` (envíos automáticos — **los recordatorios, que son
justo los que importan**). Se prueban las dos por igualdad exacta para que la consulta use el índice;
un `endsWith` recorrería la tabla de mensajes entera en cada status que manda Meta.

**`src/lib/whatsapp/delivery-status.ts`** (puro, 18 tests) decide si un status se aplica. Un status
solo entra si su rango supera al actual, y de ahí salen las tres garantías: idempotencia, sin
retroceso (READ nunca vuelve a DELIVERED) y ningún evento tardío pisa una confirmación buena.

> **Decisión que conviene conocer:** `FAILED` va **entre** SENT y DELIVERED, no arriba del todo.
> Meta manda `failed` *en lugar de* `delivered`, nunca después, así que su posición solo decide qué
> pasa ante un duplicado fuera de orden. Se eligió que no pise a DELIVERED/READ porque esos los
> confirma el teléfono del paciente: marcar "no llegó" un mensaje que consta como leído sería otra
> mentira, sólo que en el sentido contrario a la que arregla esta auditoría. El caso que de verdad
> importa —Meta acepta y rechaza segundos después con 131047— es SENT → FAILED, y ese sí se aplica.

**`src/lib/whatsapp/errors.ts`** (nuevo): `WhatsAppApiError` con `code`, `subcode`, `title` y
`httpStatus`. Extiende `Error` y su `message` sigue siendo el texto de Meta con `(#código)` al
frente, así que los ~15 llamadores que solo leen `e.message` no cambiaron.

- **Token revocado (190 / HTTP 401)** → `markWhatsAppDisconnected` apaga `waConnected` en vez de
  reintentar en silencio cada tick del cron. Solo esos dos códigos: apagar la conexión deja a la
  clínica sin envíos, y un falso positivo cuesta más caro que seguir intentando.
- **`WhatsAppReminder` dice la verdad**: la cola guarda el wamid en `payload.wamid` al enviar, y
  cuando Meta reporta el fallo minutos después el webhook pasa la fila a FAILED con el código. Sin
  eso la fila se quedaba en SENT para siempre por más que el mensaje nunca llegara.

**Inbox**: la palomita ahora es real — una palomita "enviado" (null/SENT), doble "entregado", doble
en azul "leído", aspa + motivo en español al fallar. Solo en WhatsApp; en los demás canales Meta no
reporta nada y se conserva lo de siempre.

Dos cosas que había que arreglar para que la palomita se moviera de verdad:
- `/api/inbox/since` filtraba por `sentAt > since`, y confirmar una entrega **no mueve `sentAt`**
  (la tabla no tiene `updatedAt`): el mensaje no se reenviaba nunca. Ahora reenvía los de los
  últimos 30 min que ya tienen estado.
- El merge del polling solo **anexaba ids nuevos**, así que descartaba la versión actualizada. Ahora
  parchea por id, comparando por **contenido** — quedarse con el objeto del JSON sin más marcaría
  "cambió" en cada poll y re-renderizaría el hilo cada 5 s.

**Traducción de códigos** (es/en): 131047, 190, 131026, 132000/132001, 131042. El mapa de motivos
salió a `src/lib/whatsapp/reason-i18n.ts` porque ahora lo usan dos pantallas; estaba duplicado y un
motivo nuevo se traducía en una y salía crudo en la otra.

> 132000 y 132001 comparten motivo a propósito: 132001 es "no existe o no está aprobada" y 132000 es
> "el número de variables no coincide". Para quien lo lee la acción es la misma —revisar nombre,
> idioma y variables contra lo aprobado— y separarlos obligaría a distinguir dos mensajes casi
> idénticos. Por eso el texto es más amplio que "plantilla inexistente o no aprobada".

### Fase 3 — Plantillas aprobadas (M-09, el P0)

- `sendWhatsAppTemplate` nuevo; `sendWhatsAppMessage` conserva su firma. Lo común (descifrado del
  token, timeout, reintento único, conversión del error) se concentró en `postToGraph`.
- **`src/lib/whatsapp/send-mode.ts`** (puro, 16 tests) es el punto único de decisión: ventana abierta
  → texto libre (gratis, como hoy); cerrada → plantilla del tipo; sin plantilla utilizable → **no se
  envía** y se registra el motivo. Hay un test que recorre todas las combinaciones para comprobar que
  **jamás** se devuelve texto libre con la ventana cerrada.
- Dentro de ventana no se gasta plantilla aunque esté configurada: Meta se la cobra a la clínica y el
  texto libre entrega igual.
- La ventana se mide contra el Inbox con el **mismo emparejamiento laxo** que usan los envíos
  (exacto y, si no, por los últimos 10 dígitos). Con un criterio más estricto un hilo que sí existe
  pasaría por inexistente y exigiríamos plantilla donde hoy basta el texto libre.
- Con plantilla, en el Inbox se guarda **lo que de verdad recibió el paciente** (el texto de la
  plantilla con sus datos), no el texto libre que se habría mandado dentro de ventana.
- **Pantalla nueva** `/dashboard/whatsapp/plantillas`: por cada tipo, el texto EXACTO a dar de alta
  en Meta (copiable), qué es cada `{{n}}`, los campos de nombre e idioma, el enlace al billing hub y
  el aviso de que **Meta le cobra a la clínica**, no a DaleControl. `waBillingOk` se enciende cuando
  una plantilla sale bien y se apaga ante un 131042.
- Tipos cubiertos: recordatorio de cita, confirmación de cita y reagendado — los tres con las mismas
  cuatro variables (paciente, clínica, fecha, hora), que es más difícil de equivocar que tres
  formatos distintos. Parámetros conectados en la cola, `/api/public/book`,
  `/api/paciente/appointments` y `appointment-change/notify`.

### Fase 4 — M-25 y M-22

- **M-25**: `PATCH /api/clinic` devolvía la fila entera de `Clinic` — token de WhatsApp, llave viva
  de Facturapi, tokens de Google, API key de Daily, hash del password del modo En Vivo. Ahora lleva
  `select` explícito (no un strip a posteriori, para que una columna secreta futura no salga por
  defecto). Verificado que ningún consumidor lee el cuerpo: los seis sitios solo miran `res.ok`.
- **M-22**: ya estaba resuelto en las tres rutas principales (agenda vía
  `PATCH /api/appointments/[id]`, portal y resolución de solicitudes) desde P1-12. **Faltaba la del
  bot**: `lib/agenda/bot-booking-service.ts` movía `startsAt` sin limpiar recordatorios, así que
  reagendar por WhatsApp sí mandaba la hora vieja. Cerrado.

### Pendientes

1. **Nadie ha enviado todavía una plantilla real.** Falta el ciclo completo en producción: dar de
   alta las tres plantillas en Meta con una clínica de verdad, esperar su aprobación, registrarlas en
   la pantalla nueva y comprobar que un recordatorio le llega a un paciente que **nunca** ha escrito.
   Hasta que eso ocurra, el P0 está arreglado en código pero no demostrado en campo.
2. **Los avisos `system` a la propia clínica siguen sin plantilla.** Los que van al número de la
   clínica (nueva solicitud de cita, saldo de IA, pagos) no tienen tipo de plantilla definido: fuera
   de ventana ahora se bloquean con motivo en vez de morir en Meta, pero **siguen sin llegar**. Es el
   mismo agujero que ya estaba anotado en la sección de la mini-web; ahora al menos se ve el porqué.
3. **Un mensaje que falla con el hilo abierto tarda hasta 30 min en teñirse de rojo si nadie lo
   recarga.** `InboxMessage` no tiene `updatedAt`, así que el polling reenvía por ventana de tiempo.
   Al abrir el hilo el estado siempre es el correcto.
4. **Dos motivos de bloqueo salen en español aunque el panel esté en inglés**: el de "faltan datos" y
   el de "este tipo no admite plantilla" no tienen clave i18n y caen al texto crudo. Son legibles,
   pero si alguna clínica usa el panel en inglés conviene darles clave.
5. **`recentStatusFailed` cambió de "No salió" a "No llegó"** (y en inglés a "Did not arrive"): ahora
   la fila cubre los dos casos —nunca salió, o salió y Meta rechazó la entrega—, y "no salió" era
   falso para el segundo.

---

## M-22: reagendar cancela y reprograma los recordatorios

**Fecha:** 2026-08-11 · **Rama:** `main`

### Punto de partida (lo que ya existía y lo que no)

La mitad del problema estaba resuelta desde P1-12: `PATCH /api/appointments/[id]`, la resolución
de solicitudes y el cambio de cita del portal llamaban a `clearAutoRemindersForAppointment`. Un
grep de `whatsAppReminder` dentro de `src/app/api/appointments/*` **no encuentra nada** porque la
llamada va a través de ese helper, que vive en `lib/appointment-change/slots.ts`.

Pero el arreglo viejo tenía tres defectos de fondo:

1. **Borraba también los enviados.** Y las filas SENT son contra las que el webhook empareja el
   "CONFIRMAR"/"CANCELAR" del paciente (`status: SENT, repliedAt: null`). Al reagendar se borraban,
   así que si el paciente contestaba al recordatorio que ya había recibido, su respuesta no casaba
   con nada y se perdía. Además destruía el historial de entrega que acabamos de hacer útil
   (deliveryStatus, `payload.wamid`).
2. **No reprogramaba: delegaba en el barrido.** Funciona, pero el hueco entre el reagendado y el
   siguiente tick quedaba sin ningún recordatorio encolado.
3. **Iba fuera de la transacción**, best-effort. Si fallaba, la cita quedaba movida con el
   recordatorio viejo vivo — exactamente el bug que decía arreglar.

Y faltaba un cuarto punto de reagendado entero: el del bot.

### Los cuatro puntos que mueven `startsAt`

| Dónde | Qué es | Estado antes |
|---|---|---|
| `PATCH /api/appointments/[id]` | agenda: arrastrar-y-soltar + editar | borraba, fuera de tx |
| `POST /api/appointment-change-requests/[id]/resolve` | la clínica aprueba el cambio | borraba, fuera de tx |
| `POST /api/paciente/appointments/[id]/change-request` | portal, auto-aprobado | borraba, fuera de tx |
| `lib/agenda/bot-booking-service.ts` | el bot de WhatsApp reagenda | **no hacía nada** |

No hay server actions que toquen `startsAt` (verificado sobre `src/app/actions/`).

**Solo dispara `startsAt`, no `endsAt`**, y es deliberado: el recordatorio se programa N minutos
antes del *inicio* y su texto anuncia la fecha y la hora de inicio. Alargar o acortar una cita sin
moverla no cambia ni cuándo sale el aviso ni lo que dice, así que reprogramar ahí sería trabajo
—y filas canceladas— para nada.

### Lo que hace ahora

`src/lib/reminders/reschedule.ts` (**puro, 18 tests**) decide el plan: qué cancelar, qué conservar
y qué encolar. `reschedule.server.ts` lo aplica **dentro de la transacción que mueve la cita**.

- Se cancelan (no se borran) los que aún no han salido, incluido el legacy **`ACTIVE`** — la columna
  es TEXT y las filas de mayo usan ese valor; filtrar solo por `PENDING` habría dejado vivas justo
  las más viejas.
- **Los SENT no se tocan**: son historial y son el ancla de la respuesta del paciente.
- Se encolan los momentos que la clínica tenga activos, con el cuerpo **rendeado con la fecha y la
  hora nuevas** (que es el punto: el mensaje viaja congelado dentro de la fila).
- Un momento que **ya pasó no se recrea**: mover una cita a dentro de 3 h no debe disparar un
  "te recordamos tu cita de mañana".
- Se respetan las **preferencias del paciente** (anticipación y canal) con las mismas reglas que el
  barrido, incluida la salvaguarda de no dejarlo sin ningún canal. Sin esto habríamos regresado:
  el borrar-y-que-el-barrido-reencole sí las aplicaba.

### Cancelar la cita cancela sus recordatorios

Antes solo lo cubría el re-check del worker al enviar (no mandaba el aviso, pero la fila seguía en
"En cola" en el panel). Ahora se cancelan en la misma transacción en los seis puntos: `DELETE
/api/appointments/[id]`, `PATCH .../status` (CANCELLED y NO_SHOW), `batch-validate` al rechazar,
la resolución de solicitudes, el portal del paciente y el webhook cuando el paciente responde
CANCELAR.

### Una carrera que cerré sobre la marcha

El `updateMany` de cancelación filtraba solo por `id`. El worker hace claim-then-send —marca SENT
**antes** de enviar—, así que podía reclamar una fila entre mi lectura y mi escritura y yo la habría
marcado "cancelada" con el mensaje ya en camino: la misma clase de mentira que este arreglo
persigue, solo que del otro lado. Las dos escrituras llevan ahora `status: { in: PENDING | ACTIVE }`.

### Código retirado

`clearAutoRemindersForAppointment` se eliminó de `lib/appointment-change/slots.ts` al quedarse sin
usos. Dejar viva una función que borra filas SENT era una trampa para el siguiente que pasara por
ahí; el comentario de cabecera del módulo explica dónde está su reemplazo.

### Pendientes

1. **Sin probar contra la base real.** Los 18 tests cubren la decisión, no la escritura: falta mover
   una cita en producción y confirmar en el panel que el viejo queda "Cancelado" con su motivo y el
   nuevo "En cola" con la hora correcta.
2. **Las filas canceladas siguen ocupando la llave del dedup** (cita+momento+canal). Es
   intencionado —evita que el barrido encole un duplicado junto al que acabamos de crear— pero
   significa que el historial de una cita muy reagendada acumula filas CANCELLED. No molesta al
   panel (muestra las 20 últimas), pero conviene saberlo.
3. **Los recordatorios clínicos por especialidad** (ENDO_/PERIO_/ORTHO_/IMPLANT_) no entran aquí:
   solo se reprograma el tipo `APPT_AUTO`. Los de especialidad cuelgan de tratamientos, no del
   horario de la cita.

---

## Cada clínica recibe sus plantillas sin tocar Meta

**Qué estaba roto.** `ff06dad6` enseñó al envío a usar plantillas fuera de la ventana de 24 h, y
`64471ad9` a decir la verdad sobre la entrega. Faltaba lo de en medio: **nadie creaba las
plantillas**. `message_templates` no aparecía en todo el repo, la pantalla se limitaba a dictarle a
la clínica un texto para que lo diera de alta a mano en el administrador de Meta, y ninguna lo hizo.
Resultado: `waTemplates` vacío en todas, y todo mensaje a un paciente que llevara más de 24 h sin
escribir se bloqueaba con "falta configurar la plantilla". El P0 estaba resuelto a medias.

Las plantillas son **por WABA**: no se comparten entre cuentas. Pero DaleControl ya tiene el token
de cada clínica (lo guarda `connect` y `embedded/exchange`), y con ese token se pueden crear
plantillas **dentro de su cuenta**. Eso es lo que hace esta entrega.

### Un catálogo, seis plantillas

`src/lib/whatsapp/templates-catalog.ts` es la fuente única de la redacción. Cinco de **utilidad**
(recordatorio, confirmación, reagendado, receta y mensaje de la clínica) y una de **marketing**
(invitación a reseña), todas en `es_MX`. `WA_TEMPLATE_SPECS` pasó a derivarse de ahí, así que la
pantalla, el guardado manual y el envío leen exactamente el mismo texto.

El catálogo se valida a sí mismo contra las reglas de Meta —nombre en `[a-z0-9_]`, el cuerpo ni
empieza ni termina en variable, sin dos variables seguidas, numeración sin saltos— **antes** de
gastar una llamada, y un test recorre las seis para que nadie las rompa al cambiar una redacción.

### Las tres plantillas viejas ganaron una variable

El texto nuevo de recordatorio, confirmación y reagendado dice "**con {{5}}**" (el doctor). Como
Meta sustituye por **posición**, eso obliga a que los cinco callers manden cinco datos: cola de
recordatorios, `appointment-change/notify`, `/api/public/book` y `/api/paciente/appointments`. Sin
ese ajuste, cada envío fuera de ventana se habría bloqueado con "la plantilla espera 5 datos y se
prepararon 4". Es el único punto donde hubo que tocar el envío de `ff06dad6`.

Además, tres tipos que antes no tenían plantilla ahora la tienen y **ya mandan sus datos**: receta
(`prescriptions/[id]/send`), mensaje manual (`/api/whatsapp/send`) y reseña (`lib/reviews/invite`).
A los dos últimos les faltaba `waTemplates` en el `select` de la clínica: sin ese campo la plantilla
existía pero el envío la daba por no configurada.

### `waTemplates` ahora guarda el estado

Cada entrada lleva `status` (PENDING | APPROVED | REJECTED), el `reason` de Meta, su `metaId` y
`updatedAt`. **Una entrada sin `status` cuenta como aprobada**: son las que una clínica pudo escribir
a mano en la pantalla anterior, y tratarlas como "en revisión" apagaría envíos que hoy funcionan.

`decideSendMode` bloquea PENDING y REJECTED con motivo legible en vez de gastar el intento en un
132001 que nadie sabe leer. El motivo nuevo viaja hasta el panel traducido (`templatePending`).

### Cómo se disparan

1. **Al conectar**, en las dos rutas (`connect` y `embedded/exchange`), sin `await`: son cinco
   llamadas a Meta y la conexión no puede demorarse ni fallar por esto. En `connect` solo se intenta
   si la clínica aportó el WABA id.
2. **Botón "Crear mis plantillas"** en `/dashboard/whatsapp/plantillas` → `POST
   /api/whatsapp/templates/provision`. Es el camino para las clínicas ya conectadas —incluida la de
   Rafael— y el reintento cuando Meta rechaza una.
3. **Idempotente**: no vuelve a pedir lo que ya está aprobado, en revisión o registrado a mano, y si
   Meta responde que el nombre ya existe eso **no es un error** — recupera esa plantilla y registra
   su estado real.

Si el token no tiene permiso de gestión de plantillas o falta el WABA id, no revienta: corta,
devuelve el motivo en español y la pantalla lo enseña fijo (no en un toast que se va).

### Saber cuándo las aprueban

- **Webhook**: `message_template_status_update` en el webhook que ya existe. Ese aviso **no trae**
  `phone_number_id`; el `entry[].id` es el WABA id, así que la clínica se resuelve por
  `waBusinessAccountId`.
- **Cron de respaldo**: `/api/cron/whatsapp-templates` (diario, 11:00 UTC, `Bearer CRON_SECRET`)
  pregunta el estado real de las que lleven más de 24 h en revisión. Sin él, un webhook perdido
  dejaría los recordatorios apagados para siempre sin que nadie se enterara.

### Lo que ve la clínica

Una fila por tipo con su estado en español —**Lista**, **En revisión por Meta**, **Rechazada** con
el motivo, o **No creada**— y el texto que recibe el paciente. Arriba, si `waBillingOk` es false, el
aviso de que **sin método de pago en su cuenta de WhatsApp no saldrá ningún recordatorio**, con el
enlace al billing hub. La de marketing va en su propia tarjeta, apagada, explicando que cuesta más y
que el paciente puede bloquear ese tipo sin perder los importantes. Escribir nombres a mano quedó
plegado en "Opciones avanzadas".

De paso, dos trampas del guardado manual: ahora conserva el `status` de las filas que no se tocaron
(antes un guardado habría dejado en "aprobada" una plantilla en revisión) y una fila sin nombre ya
no es un error de validación, sino "sin plantilla".

### Pendientes

1. **Nadie ha creado una plantilla real todavía.** Todo el camino de red está sin ejercitar contra
   Meta: hace falta pulsar el botón en una clínica conectada y ver si Meta acepta los seis cuerpos
   tal cual o rechaza alguno por categoría.
2. **El campo del webhook hay que suscribirlo en el panel de la app de Meta.**
   `POST /{waba}/subscribed_apps` suscribe la app al WABA pero no elige campos: hay que marcar
   `message_template_status_update` en Webhooks → WhatsApp Business Account. Mientras no esté, el
   cron es el único que entera del APPROVED (hasta 24 h de retraso).
3. **La clínica conectada a mano sin WABA id no puede recibirlas.** La pantalla se lo dice y le pide
   reconectar con el botón de Meta; no hay forma de adivinar el WABA desde el `phone_number_id`.
4. **El alta en segundo plano al conectar puede perderse** si la función serverless se congela al
   responder. Es aceptable porque el botón y el cron son la red, pero significa que la conexión no
   garantiza las plantillas.
5. **`prescription` no lleva el enlace de la receta.** Meta no admite URLs variables en el cuerpo sin
   darlas de alta como botón: fuera de ventana el paciente recibe el aviso y el enlace viaja en la
   conversación.

## [Hotfix-Fuga-Secretos] · Las mini-webs publicaban las credenciales de la clínica — 2026-08-14

Verificado en producción antes de tocar nada: descargando el HTML de
`https://www.dalecontrol.com/rafael-clinica` aparecían, sin contraseña y con "ver código fuente",
`waAccessToken` (6 860 caracteres), `googleCalendarToken`, `googleRefreshToken` y `liveModePassword`
**con valor real**; `facturApiLiveKey`, `twilioAuthToken` y `dailyApiKey` salían también, en null,
porque esa clínica todavía no los tiene configurados — en cuanto los configure, se publican solos.

### El archivo que filtraba

**`src/app/[slug]/clinic-landing-server.tsx`** — uno solo, pero es el que sirve TODAS las mini-webs.
`prisma.clinic.findUnique()` iba con `include` y sin `select`, así que traía las ~130 columnas de
`Clinic`. Esa fila se pasa como prop `clinic={c}` a componentes **cliente** (las siete plantillas más
`ClinicLandingClient`), y Next serializa los props de un componente cliente **dentro del HTML**. El
`stripClinicSecrets` de `src/lib/clinic-secrets.ts` ya existía y ya lo usaban `/api/clinic-landing`,
`/api/settings`, `/dashboard/landing`, `/dashboard/settings` y `/admin/clinics/[id]`: aquí se olvidó.

Dos rutas comparten ese componente y las dos filtraban:

- `/[slug]` — la mini-web pública, además **cacheada por ISR** (`revalidate = 300`), así que el
  token viajaba en HTML servido desde el edge.
- `/landing-preview/[slug]?preview=<plantilla>` — **no está en el matcher del middleware**
  (`/dashboard`, `/admin`, `/api`, `/proveedores`), o sea que es pública para cualquiera y permite
  pedir la misma clínica en cualquiera de las ocho plantillas. Confirmado: filtraba en las tres que
  probé (classic, futurista, healthtech).

### Cómo se cerró

`select` **explícito** en vez de `stripClinicSecrets`, que era la opción preferida del encargo y es
la que aguanta el futuro: `stripClinicSecrets` quita una lista de siete nombres, así que una columna
secreta nueva en `Clinic` se filtraría sola hasta que alguien se acordara de añadirla a la lista. Con
`select`, una columna nueva simplemente no se pide.

La lista enumerada es exactamente el type `LandingClinic` (`_shared/types.ts`) más los tres campos
que solo usa el propio server component: `category` (elige los highlights), `landingActive` y
`landingTemplate`. Se derivó leyendo qué toca cada plantilla, no a ojo: `clinic.*`, `c.*` y
`(clinic as any).*` en todo `src/app/[slug]`. De paso `schedules` también lleva su `select`
(`dayOfWeek`/`enabled`/`openTime`/`closeTime`) — no tenía secretos, pero ya no viajan `id` ni
`clinicId`. `users` ya venía con `select` propio y estaba limpio.

Antes de commitear se comprobó que las columnas de landing v2 (`landingSections`, `landingPhotos`,
`landingUrgentText`, `landingMsiPlazos`) **existen en la base de producción** — aparecían en el
payload filtrado —, así que pedirlas por nombre no revienta con un P2022 donde el `include` no lo
hacía.

### El resto del repo: auditado, y no había más

Se revisaron las **252 llamadas a `prisma.clinic.*`** de `src/` con un script que balancea llaves y
marca las que no llevan `select` de primer nivel (71). Ninguna otra filtra:

- **Superficies públicas, todas con `select` limpio ya**: el directorio `/descubre` y
  `/descubre/clinica/[slug]`, `src/lib/directory/query.ts` (5 consultas), `/reservar/[slug]`,
  `/api/public/availability`, `/api/public/clinicas`, `/live/[slug]` y `/live/[slug]/3d`.
- **`/api/public/booking-request`** sí pide `waAccessToken`, pero para **mandar** el WhatsApp
  server-side; sus respuestas son `{success, status, message, id}`. Igual `/live/[slug]`, que pide
  `liveModePassword` y solo lo usa para `Boolean(...)` — al cliente le pasa `hasPassword`.
- **Rutas autenticadas que devuelven la fila entera** (`/api/settings` GET y PATCH,
  `/api/clinic-landing` GET y PUT): ya envuelven en `stripClinicSecrets`. `/api/clinic` PUT ya usaba
  `select` explícito. `/api/clinic/me` devuelve el `select` acotado de `loadClinicSession`.
- **Props a componentes cliente**: `/dashboard/landing`, `/dashboard/settings` y
  `/admin/clinics/[id]` pasan por `stripClinicSecrets`; `/dashboard` manda `{ name }`;
  `/admin/payments/[id]/cfdi` y `/dashboard/laboratorios/[labId]` mandan objetos acotados.
  `/admin` y `/admin/churn` cargan la fila completa pero **solo la leen en el server** — el `Section`
  de churn es una función local, no un `"use client"`, así que nada de eso se serializa.
- Las 9 llamadas de `src/app/actions/**` y las 2 consultas de `User` de `/api/public` llevan `select`.

### Verificación

`npx next build` completo, **EXIT 0**, sin `Type error` ni `Failed to compile` (los `prisma:error` de
`DATABASE_URL` son el ruido normal de construir sin `.env`, y son los mismos de antes del cambio).

La comprobación de "ver código fuente" **no se pudo hacer en local**: no hay `.env` en la máquina, así
que el dev server no tiene base y la mini-web no llega a pintar una clínica. Se hizo contra
**producción**, que además es donde está la clínica con WhatsApp conectado: se guardó el HTML crudo de
`/rafael-clinica`, `?preview=futurista` y `?preview=healthtech` **antes** del push (los tres con las
seis cadenas presentes) para volver a descargarlos tras el deploy y comparar, tanto las cadenas como
el texto visible — servicios, precios, doctores, horario de los siete días, teléfono, WhatsApp y
correo.

### Pendiente

`/landing-preview/[slug]` sigue siendo **público**. Ya no filtra credenciales y va con
`robots: noindex`, y lo que enseña es el sitio público de la clínica, así que no es una fuga; pero
deja que cualquiera vea la mini-web de cualquier slug en las ocho plantillas, incluso con
`landingActive` apagado (donde cae a la pantalla de "disponible pronto"). Si se quiere cerrar, es
meterlo al matcher del middleware o pedir sesión de esa clínica.

---

## [Fix-Inbox-Paciente-Plantillas]

Dos bugs reportados desde producción. Los dos venían del mismo sitio: código que
se escribió suponiendo un estado del mundo que en producción casi nunca se da.

### Bug 1 — "Abrir chat" llevaba a un Inbox vacío

El enlace hilo↔paciente (`inbox_threads."patientId"`) se intentaba **una sola
vez**, al crear el hilo desde el webhook de Meta. Si el paciente se dio de alta
DESPUÉS de que empezara la conversación —el caso normal: el paciente escribe
para pedir cita y recepción lo registra luego—, o si su teléfono se capturó o se
corrigió más tarde, el hilo se quedaba con `patientId` nulo **para siempre**:
nada volvía a mirarlo. Todo lo que filtraba por `patientId` salía vacío aunque la
conversación estuviera ahí, y el hilo se mostraba con el nombre de perfil de
WhatsApp ("ra rara") en vez del nombre del paciente.

La lógica de emparejamiento por teléfono (`findPatientByWhatsAppPhone`) estaba
bien; lo que faltaba era volver a usarla.

Se arregló en las tres capas, no en una:

1. **Buscar sin depender del enlace.** `src/lib/inbox/patient-threads.ts` es la
   pieza nueva: dado un `patientId` resuelve su teléfono y localiza también los
   hilos que le corresponden por número. `GET /api/inbox/threads` y
   `/api/inbox/since` ya no filtran por `patientId` a secas.
2. **Auto-reparación.** `linkOrphanThreadsToPatient` escribe el enlace que
   faltaba, y así el sistema se cura con el uso. Sólo cuando el match es
   **inequívoco** (un único paciente de la clínica con ese número); con dos o más
   no toca nada y lo registra. El `updateMany` filtra por `patientId: null`, así
   que es idempotente y no se pisa consigo mismo.
3. **Enlazar al crear/editar paciente.** `POST /api/patients` y el `PUT`/`PATCH`
   de `[id]` llaman al mismo helper (best-effort, en su propio try/catch). Es el
   origen del problema. El `PATCH` sólo lo hace si el body traía `phone`, para no
   pagar dos consultas por cada click en la estrellita de VIP.

Y la experiencia:

- Al llegar con `?patientId=`, el Inbox **abre** la conversación, no sólo la
  filtra. Una vez por `patientId`: si el usuario se mueve a otro hilo, mandan sus
  manos.
- Banner "Solo las conversaciones de X" con salida a "Ver todas".
- Sin conversación, un vacío que **explica**: "Sin conversaciones con este
  paciente", y si además no tiene teléfono lo dice, porque entonces esperar un
  WhatsApp es tiempo perdido.
- La tarjeta **"WhatsApp recientes" de la ficha era 100% estática**: no hacía
  ningún fetch, siempre pintaba "Sin mensajes recientes". Eso no lo decía el
  reporte y era la mitad del síntoma. Ahora tira de
  `GET /api/inbox/patient-recent`, con el mismo criterio por teléfono.

### Bug 2 — Las plantillas del Inbox ni se podían usar ni eran plantillas

Dos capas, las dos verificadas:

- `disabled={windowClosed}` en los chips. **Al revés**: fuera de la ventana de
  24 h una plantilla aprobada es lo único que Meta entrega, y era justo cuando el
  código las apagaba.
- Aunque se habilitaran, `insertTemplate` sólo pegaba **texto** en el recuadro.
  Nunca se había enviado una plantilla aprobada desde el Inbox — concuerda con el
  hallazgo de la auditoría de WhatsApp ("nada usa plantillas aprobadas").

Ahora hay dos cosas distintas y se llaman distinto:

- **Atajos de texto** (los tres de siempre): dentro de la ventana, gratis, se
  pegan en el recuadro. Sin cambios.
- **Plantillas aprobadas**: fuera de la ventana, habilitadas, y envían de verdad
  por `sendWhatsAppTemplate` a través de `sendWhatsAppLogged` — que ya decide
  texto/plantilla, marca `waBillingOk` ante el 131042 y deja el mensaje en el
  hilo. Cero infraestructura nueva.

`GET/POST /api/inbox/threads/[id]/templates` ofrece los cinco tipos del catálogo
que el Inbox sabe **rellenar** con lo que sabe del paciente (`manual_api`,
`reminder`, `booking`, `payment_notice`, `review`); los demás cuelgan de un
documento y se mandan desde su pantalla. Cada opción viene con su estado real en
Meta y, si no se puede usar, el motivo en español: chip apagado **con
explicación**, nunca un chip muerto. Sin ninguna aprobada, un texto que dice qué
falta y un enlace a Plantillas. Los params se **recalculan en el servidor**: si
llegaran del body, cualquiera dictaría el texto que Meta entrega firmado por la
clínica. Pulsar un chip no envía: enseña el texto EXACTO que va a recibir el
paciente y el envío es un segundo clic — cada plantilla se la cobra Meta a la
clínica.

### Lo que encontró la revisión adversarial (y se corrigió antes de subir)

Diez agentes: seis implementando en paralelo, cuatro revisando por dimensiones
distintas. Lo que sacaron y ya está arreglado:

- **Import roto** (`templateUiState` vive en `templates-catalog`, no en
  `template-config`). Habría tumbado el build.
- **`phone: { contains: last10 }` no casaba con los teléfonos guardados con
  espacios o guiones** ("55 1234 5678"), que es como los teclea recepción. La
  auto-reparación quedaba muerta justo para el formato más común y, peor, la
  guarda de ambigüedad se invertía: de dos hermanos con el mismo celular, si uno
  lo tenía con espacios y el otro sin ellos, el LIKE sólo veía a uno → "match
  inequívoco" → enlace al que no tocaba, y ya irreversible. Ahora la
  normalización va DENTRO de la consulta (`$queryRaw` con `regexp_replace`),
  idéntica al script SQL, con vuelta al criterio viejo si el raw falla.
- **Fuga de PHI por el número de la propia clínica.** Los avisos internos
  (solicitud de cita, saldo de IA, cobros) salen al teléfono de la clínica y
  hablan de OTROS pacientes. Si ese número está en la ficha de alguien, el match
  era "inequívoco" y le habríamos metido datos de terceros en su expediente.
  Excluido en el código y en el SQL.
- **El saldo pendiente viajaba a cualquiera con `inbox.view`**, saltándose el
  `billing.view` que lo protege en el resto del producto (el aviso de saldo lleva
  el importe dentro del cuerpo de la plantilla). Sin ese permiso la opción ya no
  se ofrece — ni se consulta el saldo.
- **GET que escribían a nombre de un READONLY.** La auto-reparación sólo se
  persiste si la sesión tiene `inbox.send`; la tarjeta de la ficha va en modo
  lectura. Encontrar la conversación no necesitaba escribirla.
- **Diagnóstico invertido**: `waBillingOk` es `@default(false)` y sólo pasa a
  true cuando un envío de plantilla sale bien — o sea, hoy, en todas. Se
  evaluaba antes que "no hay plantillas", así que la clínica sin plantillas leía
  "revisa tu tarjeta en Meta" y se iba a la pantalla equivocada… de la que no
  podía salir. Reordenado, con test del camino inverso.
- **La tarjeta pintaba mensajes del portal y de correo** como si fueran WhatsApp
  (esos hilos nacen con `patientId`). Filtrada por canal.
- **El envío iba al teléfono de la FICHA y no al del HILO**: si la ficha se
  corrigió después, la plantilla salía a otro número y el registro caía en otro
  hilo — el toast decía "enviado" y el mensaje no aparecía nunca en la
  conversación. Manda el número del hilo.
- **El SQL refrescaba `updatedAt`**, que en esta tabla no es sólo rastro: el
  header del Inbox lo usa como `resolvedAt` para "resueltos hoy". Reparar hilos
  viejos ARCHIVED habría reportado como resueltas hoy conversaciones cerradas
  hace meses, sin vuelta atrás. Ya no se toca.
- Número compartido por dos pacientes: los hilos huérfanos entran en la lista del
  Inbox (ahí el hilo lleva su propio nombre) pero **no** en la tarjeta de la
  ficha, donde cada entrante se atribuye por nombre a ESE paciente.

### Pendientes

1. **Correr `sql/inbox-link-orphan-threads.sql`** (una clínica por corrida).
   Repara de golpe el histórico; sin él, los hilos viejos se van curando de uno
   en uno conforme se abren las fichas. Los bloques (1) y (2) enseñan qué va a
   pasar y qué se queda fuera antes de escribir nada.
2. **Sigue sin mandarse una plantilla real desde el Inbox.** Todo el camino de
   red está sin ejercitar contra Meta. Hace falta una clínica con plantillas
   APROBADAS y método de pago en su cuenta de Meta: sin tarjeta, Meta responde
   131042 y el mensaje —ahora sí— lo explica en español.
3. La importación masiva de pacientes (`/api/patients/import`) NO enlaza hilos a
   propósito (N × 2 consultas). Lo cubren la auto-reparación y el script.

## [Iniciar-Conversacion] · La clínica ya puede escribir PRIMERO — 2026-08-14

BUILD EXIT 0 (`npx next build`, 362 páginas). Tests existentes en verde:
`test:inbox-templates` (25), `test:wa-send-mode` (21), `test:inbox` (19),
`test:wa-catalog` (15). Sin SQL. Sin dependencias nuevas. Sin envs nuevas.

### EL HUECO

El Inbox sólo sabía RESPONDER. No había NINGUNA forma de empezar una
conversación con un paciente:

- `+ Componer` (sidebar y FAB) llamaba a `composeSoon()`: un toast de
  "próximamente".
- "Abrir chat" de la ficha llevaba al Inbox filtrado, y sin conversación
  enseñaba "Sin conversaciones con este paciente" — un callejón sin salida.

Caso real: paciente registrada, con teléfono, a la que hay que mandarle
indicaciones post-tratamiento. No se podía.

### LA REGLA QUE MANDA (no es nuestra, es de Meta)

A quien nunca ha escrito —o cuya ventana de 24 h ya cerró— WhatsApp SOLO le
entrega una **plantilla aprobada**; el texto libre lo rechaza con 131047. Por
eso el flujo es paciente → plantilla aprobada → ver el texto exacto → enviar, y
en el modal no hay recuadro de texto libre. Cada plantilla se la cobra Meta a la
clínica.

### QUÉ SE CONSTRUYÓ

**`src/lib/inbox/template-offer.ts` (nuevo)** — la pieza compartida. Salió tal
cual de `api/inbox/threads/[id]/templates/route.ts`, que la tenía atada a un
hilo existente: qué plantillas del catálogo se pueden mandar HOY, con qué
valores de `{{1}}…{{n}}` (próxima cita, saldo, teléfono de la clínica) y el
motivo en español de las que no. Copiarla habría dejado dos fuentes que se
separan en el primer cambio de redacción — lo que se previsualiza y lo que sale
dejarían de ser lo mismo. La ruta del hilo pasó de 687 a ~300 líneas y ahora la
consume; el punto de partida es un PACIENTE, que es el denominador común.

**`GET/POST /api/inbox/compose` (nuevo)**
- `GET ?patientId=` → si se le puede escribir, con qué plantillas, si la ventana
  de 24 h está abierta y si YA existe conversación (para abrirla en vez de
  crearla).
- `POST {patientId, kind}` → envía. Los params se RECALCULAN en el servidor,
  nunca llegan del body: son el texto que Meta entrega firmado por la clínica.

**`StartConversationModal`** (`src/components/dashboard/inbox/`) — el MISMO
componente en los dos puntos de entrada, para que "escribirle primero a alguien"
signifique lo mismo desde la ficha y desde el Inbox. Con paciente fijo
(`lockPatient`) desde la ficha; con buscador (`/api/patients/search`, ya con
visibilidad por paciente) desde `+ Componer`.

**Puntos de entrada**
- Ficha → tarjeta "WhatsApp recientes": botón sólo con teléfono, con acceso al
  Inbox, SIN mensajes todavía y con `inbox.send`. Tras enviar, lleva a
  `/dashboard/inbox?patientId=` (que ya sabe abrir el hilo más reciente).
- Inbox → `+ Componer`, el FAB, y el vacío de "Sin conversaciones con este
  paciente", que era justo donde se acababa el camino.

### DECISIONES QUE IMPORTAN

- **El hilo nace ligado al paciente.** `sendWhatsAppLogged` acepta ahora
  `patientId` explícito, que GANA sobre el emparejamiento por teléfono. Ese
  emparejamiento devuelve "el primero" cuando dos hermanos comparten el celular
  de la mamá: a ciegas podía ligar el hilo al que no era. Con el id no hay nada
  que adivinar — y por eso el hilo aparece en el Inbox con su nombre y no con el
  de perfil de WhatsApp.
- **El mensaje queda atribuido a quien lo mandó.** `sendWhatsAppLogged` acepta
  `sentById`; lo pasan las DOS rutas de plantillas. Una plantilla que manda una
  persona no es un automatismo, y pintarla como tal escondía quién habló con el
  paciente. El `externalId` sigue siendo `sys:<kind>:<wamid>` porque ahí viaja el
  wamid con el que el webhook casa la entrega. Consecuencia arreglada de paso:
  `patient-recent` calculaba `isSystem` sólo por ese prefijo, así que habría
  pintado como automático un mensaje con autor — ahora exige además `sentById`
  null.
- **Reutiliza el hilo que exista.** No hay lógica nueva: `upsertWhatsAppThread`
  con `matchByLast10` es la misma que agrupa todos los envíos del producto.
- **El hilo se resuelve DESPUÉS de enviar.** Crearlo antes dejaría una
  conversación vacía en el Inbox cada vez que Meta rechazara el mensaje.
- **Doble clic.** Tres capas, porque cada plantilla es dinero: `sendingRef` en el
  cliente (evita hasta la petición), `rateLimit` y un `acquireLock` de 20 s por
  clínica+paciente+plantilla que sólo se suelta si el envío FALLA, para poder
  reintentar en el acto.
- **Ventana abierta.** Si el paciente escribió hace menos de 24 h el mensaje sale
  como texto y no cuesta: se dice, y se dice TAMBIÉN cuando no hay plantillas
  aprobadas — ese aviso habla de Meta y mandaría a la clínica a arreglar algo que
  ahora mismo no le hace falta.
- **Multi-tenant y permisos.** `clinicId` siempre de `getAuthContext`; el
  paciente pasa por `assertPatientVisible` y por `deletedAt: null` (a un paciente
  cancelado por ARCO no se le escribe). El gate es `inbox.send`, el mismo con el
  que el Inbox deja responder — también en el GET, que no es una lectura sino la
  antesala de un envío que se cobra. `payment_notice` sigue fuera sin
  `billing.view`: su cuerpo lleva el importe.
- **"No existe" y "no lo puedes ver" comparten respuesta**, y en español: el
  motivo estándar del helper (`patient_not_found`) se leería crudo en pantalla.

### LO QUE SE PROBÓ Y LO QUE NO

Build completo y suites existentes en verde. **NADIE ha mandado todavía una
plantilla real por este camino**: como en el resto del módulo de WhatsApp, la
red contra Meta sigue sin ejercitarse.

### PENDIENTES

1. **QA en prod** con una clínica con plantillas APROBADAS y método de pago en
   Meta. Sin tarjeta, Meta responde 131042 y el panel lo explica en español,
   pero eso también está sin ver en real.
2. **El catálogo no tiene plantilla de "indicaciones"**: las cinco que ofrece el
   composer son cita (genérica, recordatorio, confirmación), saldo y reseña. Para
   el caso post-tratamiento sirve la genérica `dc_mensaje_clinica` —que necesita
   una cita registrada, y un paciente post-tratamiento la tiene— y en cuanto el
   paciente responde se abre la ventana y ya se le escribe a mano. Si se quiere
   una plantilla propia de indicaciones hay que darla de alta en la WABA de cada
   clínica (`WA_TEMPLATE_CATALOG` + provisión), que es otra tarea.
3. Un paciente sin cita ni saldo sólo tendría `review` (marketing, casi nunca
   dada de alta): el modal lo explica, pero es el límite real de hoy.

---

## [Fix-Confirmacion-Cita] · Un dedazo dejaba la cita sin confirmar, y el chat abría por arriba — 2026-08-14

Dos fallos reproducidos en producción, sin relación entre sí más que el módulo.

### BUG 1 — "Confirmarr" quemaba el recordatorio para siempre

El paciente recibía "Responde CONFIRMAR…", escribía **"Confirmarr"** (dos erres),
y después "Confirmar", "CONFIRMAR" y "SI". La cita nunca se confirmaba y él nunca
recibía el "te esperamos".

**Causa confirmada** (`src/app/api/whatsapp/webhook/route.ts`): las tres ramas del
bloque de recordatorios escribían `repliedAt=NOW()`, también la del `else` —la de
"no entendí nada"—. Como `pendingReminders` filtra por `repliedAt: null`, el
primer mensaje CONSUMÍA el recordatorio y los tres intentos correctos que venían
detrás ya no encontraban nada que confirmar. Y encima el `else` no respondía:
el paciente se quedaba creyendo que había confirmado.

**Qué se cambió**

1. **`repliedAt` pasa a significar "esta respuesta CERRÓ el recordatorio"**, no
   "llegó algo". Solo lo cierra una respuesta accionable (confirmar/cancelar) o
   una respuesta a un mensaje que no pedía nada sobre la agenda (una encuesta).
   Un texto que no se entiende guarda `patientReply` —el staff lo ve en el
   panel— pero deja `repliedAt` en null: el recordatorio sigue vivo y el
   siguiente intento, ya bien escrito, confirma la cita.
   Se eligió esto y no un campo nuevo porque **no hay SQL en esta tarea** y
   porque el significado que hacía falta ya cabía en la columna: lo que estaba
   mal era escribirla siempre, no la columna.
2. **Deja de estar callado.** Cuando no se entiende, sale
   `🤔 No te entendí. Responde *CONFIRMAR* … o *CANCELAR* …` — las mismas dos
   palabras que le pide el propio recordatorio (`lib/reminders/config.ts`).
   **Una sola vez por recordatorio**: el dedupe mira si ese texto exacto ya salió
   en el hilo desde `reminder.sentAt` (mismo patrón que el aviso del tope diario
   del bot). Si ya se le pidió y sigue sin decir confirmar ni cancelar, no es un
   dedazo sino otra conversación: el mensaje **pasa al bot / al staff** en vez de
   repetirle la frase. El recordatorio sigue abierto, así que un CONFIRMAR
   posterior confirma igual.
3. **Tolerancia a erratas, solo en confirmar** (`lib/whatsapp/bot/booking-parse.ts`).
   Damerau-Levenshtein contra la RAÍZ `confirm`, midiendo contra el mejor prefijo
   del token: la raíz reconoce sola todas las flexiones (`confirmar`, `confirmo`,
   `confirmado`, `confirmación`) a distancia 0 y los dedazos a 1 (`cofirmar`,
   `confimar`, `comfirmar`, `cnofirmar`, `confrimar`, `confirmarr`). Sin librería
   nueva, ~25 líneas.
   Umbral 1 y tokens de 6+ letras **a propósito**: a distancia 2 empiezan a
   colarse palabras reales (`confiar` está a 2) y por debajo de 6 letras hay
   medio diccionario a un paso de "sí"/"ok".
   **Cancelar NO se tocó.** Confirmar de más cuesta un ✅ sobrante; cancelar de
   más libera el sillón y le dice al paciente que su cita ya no existe. Un
   "canselar" mal escrito cae en el "no te entendí" y el paciente lo reescribe:
   eso se recupera, una cita borrada no. Y el orden CANCELAR-primero se mantiene,
   que es lo que hace que **"no puedo confirmar" NO confirme**.
4. **El paciente equivocado.** `pendingReminders` buscaba por
   `patientId: patient.id`, y `findPatientByWhatsAppPhone` devuelve UNO solo.
   Con teléfonos compartidos (hermanos con el celular de la mamá; se han visto 6
   pacientes con el mismo número) elegía al que no tenía la cita y no pasaba
   nada. Ahora se leen **todos** los pacientes de la clínica con ese teléfono
   (`findPatientsByWhatsAppPhone`, que ya existía) y el recordatorio se busca
   sobre el conjunto. `patient` sigue siendo el primero para atribuir el hilo y
   el turno del bot: eso no cambia.
   Y si la ambigüedad es REAL —dos citas por confirmar de personas distintas con
   el mismo número— **no se adivina**: se le dice al paciente que el equipo le
   escribe, el mensaje se queda en el Inbox (el hilo ya queda UNREAD) y **ningún
   recordatorio se toca**. Ese aviso también sale una sola vez; después la
   conversación sigue su curso normal para no dejar a la familia sin bot durante
   días.

**Efecto colateral que también se arregla**: contestar la encuesta post-cita
("todo excelente") registraba la respuesta sobre el recordatorio de la cita VIVA
y lo cerraba. Ahora una respuesta no accionable se registra sobre lo ÚLTIMO que
recibió el paciente, que es a lo que contesta.

### BUG 2 — el chat abría por arriba

Causa reportada (`inbox-client.tsx:738`): el efecto dependía de
`[activeThread?.messages.length, liveEvents.length]`, así que cambiar a una
conversación con el MISMO número de mensajes no lo disparaba.

**Y hay una segunda causa, más de fondo, encontrada verificando en Chrome**: el
efecto usaba `scrollIntoView({ behavior: "smooth" })`, y el desplazamiento suave
**se puede apagar** (ajuste "Smooth Scrolling" de Chrome). Con él apagado
—medido en esta máquina— `scrollTo({behavior:"smooth"})`, `scroll-behavior: smooth`
y `scrollIntoView({behavior:"smooth"})` no mueven **ni un píxel**. Por eso el chat
no bajaba nunca, ni cuando el efecto sí corría.

**Qué se cambió**

- **Abrir y recibir son dos cosas distintas.** Abrir va por `useLayoutEffect`
  con llave el ID del hilo (no el número de mensajes) y baja con **asignación
  directa de `scrollTop`**: salto instantáneo, antes de pintar, siempre efectivo.
- **Mensaje nuevo estando dentro**: desplazamiento suave, con **red de seguridad**
  a 400 ms que remata el salto a mano si la animación no existe. El remate es
  incondicional, no "si falta más de la holgura": una burbuja nueva deja el hilo
  ~44 px corto —dentro de la holgura— y el último mensaje se quedaba a medias.
- **Si el usuario subió a leer historial, no se le mueve nada**: aparece un aviso
  flotante "Nuevos mensajes" que baja al pulsarlo. Se apaga solo al volver al
  fondo. Lo que escribe uno mismo sí se sigue (`followOwnSendRef`), y un cambio
  de palomita no cuenta como mensaje nuevo (el polling reenvía los recientes a
  propósito cuando Meta confirma la entrega).
- `.messages` queda envuelto en `.messagesWrap` (`position: relative`) solo para
  anclar el aviso; el contenedor con scroll y su CSS no cambian.

### LO QUE SE PROBÓ

- `npx next build` completo, **EXIT 0**.
- `npm run test:wa-reminder-pick` — 62 casos (24 nuevos), incluidos los exactos
  del reporte: `Confirmarr`, `Confirmar`, `CONFIRMAR`, `SI`, `sí`, `1`, `2`,
  `CANCELAR`, `no puedo confirmar`, `mejor no`. Con las suites vecinas
  (`inbox-send`, `booking`, `reschedule`): **113 en verde**.
- Bug 2 verificado **en Chrome** contra una réplica exacta del layout y de la
  lógica: abrir → último mensaje visible; mensaje nuevo estando abajo → sigue;
  leyendo arriba → no arrastra y sale el aviso; pulsar el aviso → baja; cambiar a
  un hilo con el mismo nº de mensajes → salta igual.

**NADIE ha mandado todavía un WhatsApp real desde el producto**, así que el
camino contra Meta de los dos avisos nuevos sigue sin ejercitarse.

### PENDIENTES

1. **QA en prod del ciclo completo**: mandar un recordatorio real, contestar una
   burrada (llega la aclaración, la cita NO se confirma), contestar CONFIRMAR
   (pasa a CONFIRMED en la agenda y llega el ✅).
2. **El caso del teléfono compartido no tiene forma de resolverse desde el
   Inbox**: hoy el staff tiene que ir a la agenda y confirmar la cita a mano. Si
   se repite, merece un botón "confirmar la cita de …" en el propio hilo.
3. Sin SQL y sin dependencias nuevas, como pedía el encargo.

## Las pantallas de auth de afiliados se veían de otra app — 2026-08-15

`/afiliados/login`, `/afiliados/registro` y `/afiliados/vincular` salían con el degradado morado y
el robot 3D chico, mientras que `/login` de clínicas se ve casi negro y con la escena a pantalla
completa. No era CSS suelto: `AuthShell` tiene dos variantes y las tres páginas caían en la de por
defecto (`brand`) por no pasar `visualVariant`.

Lo que no era obvio es que la variante no solo cambia el fondo. **`dark` es la única que le pone
`flex:1 + display:flex` al wrapper del panel visual**, y sin eso `LoginVisual` se queda en su
`minHeight: 520px` en vez de llenar el panel: de ahí el robot pequeño. Una sola prop arregla las dos
cosas a la vez.

El arreglo es `visualVariant="dark"` en las tres páginas — el mismo valor que ya pasaba `/login`.
No se tocó `auth-shell.tsx`, ni `/login` o `/signup` de clínicas (ese usa `SignupVisual`, al que sí
le corresponde `brand`), ni la lógica de los formularios.

**El split de `/afiliados/registro` se queda en 60/40.** Medido en el navegador contra `/login`: el
tamaño del robot lo manda la **altura** del canvas, idéntica en ambas (1031 px), no el ancho del
panel (1280 px vs 1555 px). El panel más ancho solo le da más aire alrededor, y bajarlo a 50/50
habría apretado la tarjeta del alta, que es la más larga de las tres.

### Verificado

Los tres fondos y la escena 3D comparados lado a lado contra `/login`; a 375 px ninguna desborda
(`scrollWidth == clientWidth`) y el panel visual se oculta como estaba previsto; los enlaces entre
alta e inicio de sesión siguen en su sitio. `npm run build` verde.

**Sin ejercitar:** el envío real de los formularios no se probó — en local no hay `DATABASE_URL` ni
credenciales de Supabase. El cambio no toca esa lógica, pero queda dicho.

### De paso

`/afiliados/pendiente` no usa `AuthShell` (es una tarjeta suelta), así que no entró. Sí quedan con
la variante `brand` y `LoginVisual` — o sea, con el mismo síntoma — `/proveedores/login`,
`/proveedores/registro`, `/laboratorios/login`, `/laboratorios/registro`, `/forgot-password` y
`/reset-password`. Se dejaron fuera por estar fuera del encargo, no por estar bien.

---

## El WhatsApp de la clínica es obligatorio en el registro — `06e45879`

Hasta ahora el alta no pedía teléfono en ningún paso: una clínica que se registraba y no pagaba
quedaba sin **ninguna** forma de contacto. `clinics.phone` ya existía y los dos endpoints ya lo
escribían — nadie lo llenaba. **No hubo SQL ni cambio de schema.**

### Archivos tocados

| Archivo | Qué cambió |
| --- | --- |
| `src/lib/phone-mx.ts` *(nuevo)* | `mxTenDigits()` + `MX_PHONE_ERROR`. Regla ÚNICA de 10 dígitos que comparten navegador y servidor |
| `src/components/public/auth/signup/step-1-account.tsx` | Campo "WhatsApp de la clínica" debajo del correo, con su texto de ayuda |
| `src/components/public/auth/signup/step-2-clinic.tsx` | El MISMO campo, condicionado a `showPhone`, debajo del nombre de la clínica |
| `src/components/public/auth/signup/signup-form.tsx` | `phone` en el estado, en `basePayload` (lo mandan las DOS ramas) y `showPhone={skippedAccountStep}` |
| `src/app/api/auth/register/route.ts` | `phone` de opcional a **requerido**; se guarda `52` + 10 dígitos |
| `src/app/api/auth/register-oauth/route.ts` | Lo mismo |

### La trampa: quien entra con Google no ve el paso 1

`signup-form.tsx` arranca en el paso 2 cuando `isOAuthFlow`. Un campo puesto solo en el paso 1
habría dejado exactamente igual de incomunicados a los registros por Google. Por eso el campo
aparece también en el paso 2, gobernado por `skippedAccountStep = initialStep !== 1` — que es un
poco más ancho que `isOAuthFlow` a propósito: cubre además los enlaces directos con `?step=2`.

El gate que de verdad manda es el del endpoint: el cliente miente y `?step=3` se salta los dos
pasos. Por eso `phone` pasa a requerido en los DOS endpoints y un alta sin teléfono responde 400
con un mensaje legible (antes un campo inválido caía al 500 con el volcado JSON de `ZodError`).

Normalización: `+52`, `+521`, espacios, guiones y paréntesis se **limpian**, no se rechazan. Se
guarda `52` + 10 dígitos, la misma forma que produce `normalizeMxWhatsAppPhone` en `@/lib/whatsapp`,
o sea que el número del alta sirve tal cual para escribirle por WhatsApp.

### Verificado

`npm run build` completo y verde (leído entero, sin pipes). Terminó a las 12:25:51 con los seis
archivos ya en su versión final (12:20–12:22), así que el build cubre exactamente lo que se commiteó.

**Camino 1 — registro con correo** (componentes reales en el navegador): el campo sale con
`type=tel`, `inputMode=numeric`, `autoComplete=tel` y su ayuda. Con nombre, correo y contraseña
llenos y el teléfono vacío, "Continuar" sigue **bloqueado**; con 9 dígitos también, y al salir del
campo aparece *"Escribe tu WhatsApp a 10 dígitos"*. Pasan y se limpian `55 1234 5678`,
`+52 55 1234 5678`, `52 55 1234 5678`, `5215512345678` y `(55) 1234-5678`; una ristra de 15 dígitos
queda bloqueada. En el paso 2 el campo **no** se duplica.

**Camino 2 — entrando con Google** (`?source=oauth`): arranca en el paso 2 y ahí está el mismo campo
con la misma ayuda, debajo del nombre de la clínica, y "Continuar" bloqueado mientras esté vacío.

**Los dos endpoints, contra el servidor de verdad:** `/api/auth/register` sin `phone` → 400
*"Escribe tu WhatsApp a 10 dígitos"*; con 9 dígitos → 400. `/api/auth/register-oauth` sin `phone` →
400 igual; con `+52 (55) 1234-5678` **pasa** el gate del teléfono (muere después, en el env que falta).

### Sin ejercitar

- **No se completó un alta de punta a punta**: en local no hay `DATABASE_URL` ni credenciales de
  Supabase, así que ninguna clínica llegó a escribirse. Lo que sí se comprobó es que el teléfono
  llega al POST: en el chunk compilado que ejecuta el navegador, `basePayload` lleva
  `phone: form.phone`, la rama OAuth manda `JSON.stringify(basePayload)` y la de correo lo esparce.
- **Los `Select` de Radix del paso 2** (especialidad, estado) no se dejaron manejar por automatización
  — ni clics sintéticos, ni `PointerEvent`, ni teclado por CDP abren la lista. Por eso el submit final
  se verificó por el lado del endpoint y del bundle, no clicando "Crear cuenta". El widget no se tocó
  en este cambio.
- Los registros ya existentes **no** se tocaron: sin migración y sin backfill, tal como se pidió.

### Ojo al commitear

El árbol tenía trabajo sin commitear de **otra sesión en paralelo** (kit de marketing de afiliados:
`marketing-kit.tsx`, `panel-ui.tsx`, `herramientas/page.tsx`, `src/lib/og/`, `src/lib/pdf/`, más
`scripts/tmp-*` y `public/tmp-check/`). Se commitearon **solo los seis archivos de este encargo**,
no `git add -A`, que se habría llevado por delante trabajo ajeno a medio hacer.

## El kit del afiliado ya tiene material que se ve — 2026-08-16

`/afiliados/herramientas` repartía dos SVG y texto. Ahora reparte **cuatro imágenes para
redes y tres PDF de imprenta**, cada pieza con el logo, el nombre del afiliado y **su** QR.

### Las piezas y de dónde sale cada dato

| Pieza | Medida | Se genera en |
|---|---|---|
| Post cuadrado | 1080 × 1080 | `ImageResponse` (satori) |
| Historia | 1080 × 1920 | `ImageResponse` |
| Portada de Facebook | 1640 × 624 | `ImageResponse` |
| Banner horizontal | 1200 × 630 | `ImageResponse` |
| Tarjetas de presentación | Carta · 10 de 90 × 50 mm | `@react-pdf` |
| Volante | Carta, 1 plana | `@react-pdf` |
| Díptico de expo | Carta horizontal, 2 caras | `@react-pdf` |

Sin librerías nuevas: `next/og`, `@react-pdf/renderer` y `qrcode` ya estaban.

**Los datos.** El nombre sale de `Affiliate.name` (de la SESIÓN) pasado por
`affiliateShortName()` → "Martín R.". El QR sale de `resolveAffiliateQrTarget()`:
`baseReferralUrl(referralCode)` = `/r/<code>`, o el `publicCode` de un link de campaña
**suyo**. Los textos de venta viven en `marketing-assets.ts` (imágenes) y en
`affiliate-marketing-print.tsx` (impresos): estáticos, revisados uno por uno contra el
producto de hoy. **Ni un precio en el papel** — cambian y el papel no.

### La reja, que es lo único que importa aquí

`affiliateId` NUNCA viaja por la URL. De la URL solo llegan el formato, el mensaje y —
opcional — el **id de un link**, y ese id entra en la consulta junto al afiliado de la
sesión:

```ts
where: { id: linkId, affiliateId: ctx.affiliateId }
```

Con el id de un link ajeno la consulta no devuelve nada y el QR **cae al link base de
quien pide**, nunca al del dueño. Las dos rutas comparten esa función a propósito: puesta
en una y olvidada en la otra es exactamente el fallo que se quería evitar.

### Runtime: nodejs, no edge

`/og/blog` corre en el Edge porque su título viaja por query. Aquí hay que leer la sesión
con Prisma, que no corre en el Edge → `runtime = "nodejs"`.

**Ojo con el dev en Windows.** El build *node* de `@vercel/og` arma mal la ruta de su
fuente por defecto (`path.join` sobre un `file://` URL) y truena con `ERR_INVALID_URL` al
importarse. Es un fallo del paquete **en win32**: en Linux `path.posix.join` normaliza la
misma expresión a una URL válida, así que en Vercel funciona. Verificado en local pasando
el MISMO arte por una ruta temporal en edge.

### Verificado

1. **Medidas exactas** — leídas de la cabecera IHDR de los cuatro PNG: 1080×1080,
   1080×1920, 1640×624, 1200×630.
2. **El QR se lee** — decodificado de la imagen COMPUESTA (no del PNG original): se
   localiza la baldosa blanca por componentes conexos, se muestrea el centro de cada
   módulo y se compara contra la matriz de `qrcode`. **841/841 módulos en los cuatro
   formatos**, a 5.0–8.1 px por módulo.
3. **Los tres PDF** abiertos en Chrome: 1, 1 y 2 páginas, nada fuera de márgenes, el
   isotipo se dibuja con `Svg`/`Path` y las marcas de corte caen en el papel.
4. **Sin nombre** (`name` vacío o en blancos) las siete piezas se generan igual, sin la
   línea "Recomendado por". 10 pruebas en `npm run test:kit-marketing`.
5. `npm run build` completo, exit 0, con las dos rutas como dinámicas.

### Dos cosas que se arreglaron por el camino

**Satori no tolera una clave de estilo puesta a `undefined`.** `width: undefined` no es lo
mismo que no pasar `width`: intenta leerla como cadena y truena con *"Cannot read
properties of undefined (reading 'trim')"*. El post y la historia devolvían 500 mientras
los dos horizontales salían bien.

**La historia entra hacia el centro** (`padTop` 200 / `padBottom` 250): Instagram le encima
su cabecera y la barra de "enviar mensaje", y con el sangrado normal el QR — lo único que
importa de la pieza — quedaba debajo del teclado.

### Lo que NO se hizo

Sin SQL y sin schema, como pedía el encargo. **Nadie ha descargado todavía una pieza real
desde una sesión de afiliado**: en local no hay `DATABASE_URL`, así que la ruta autenticada
completa (`getAffiliateContext` → QR de una campaña propia) no se ha ejercitado. La reja se
leyó en el código y la parte que se puede probar sin BD —el arte, las medidas, los PDF y el
QR— sí se probó. Queda pendiente bajar una imagen y un PDF desde el panel en producción.

═══════════════════════════════════════════════════════════════════════════
## KIT-VISUAL-TEMAS-ESTILOS — 10 temas × 3 estilos × 4 formatos ✅ (2026-08-16)
═══════════════════════════════════════════════════════════════════════════
COMMIT: 9f184a24 (main) · BUILD EXIT 0 (✓ Compiled successfully, 362 páginas) · 20 tests verdes
en `npm run test:kit-marketing`. Sin SQL, sin schema, sin dependencias nuevas.

El kit repartía **4 mensajes en un solo tratamiento oscuro**. Ahora son **10 temas en 3
estilos** → 30 mensajes distintos, × 4 formatos = **120 imágenes**, más 3 piezas de papel
en los 3 estilos (y el volante y el díptico llevan además el tema elegido).

### La matriz de temas × estilos

Los 10 temas existen en los 3 estilos y en los 4 formatos (post 1080×1080, historia
1080×1920, portada 1640×624, banner 1200×630). Ninguna combinación rota.

| # | Tema (`id`) | Titular | Nota de plan |
|---|---|---|---|
| 1 | `agenda` | Toda tu clínica en una sola pantalla | — |
| 2 | `recordatorios` | El recordatorio de la cita llega por WhatsApp | — |
| 3 | `bot` | Un bot contesta el WhatsApp de tu clínica | — |
| 4 | `web` | Tu página web viene incluida | — |
| 5 | `tomografias` | Abre tus tomografías desde el navegador | — |
| 6 | `cfdi` | Timbra tus facturas desde el sistema | — |
| 7 | `odontograma` | El odontograma de cada paciente, al día | — |
| 8 | `portal` | Tus pacientes consultan lo suyo sin llamar | — |
| 9 | `sucursales` | Tus sedes, administradas desde una cuenta | **Plan Clínica · hasta 3 sedes** |
| 10 | `ia` | Un asistente con IA dentro de tu sistema | **Disponible desde el plan Profesional** |

Se retiró `mexico` ("en español y en pesos"): el encargo enumeraba la lista de temas y ese
ángulo sobrevive en el TAGLINE y el pie de las piezas de papel.

### Las notas de plan salen de `plan-shared`, no de la mano

`PLAN_NOTES` en `marketing-assets.ts` se **construye** desde `FALLBACK_PLAN_CONFIG`:

- **Sucursales** — `CLINIC.maxClinics` es **3**, así que la nota dice "hasta 3 sedes". Si
  mañana el plan incluyera 5, la nota lo diría sola; si pasara a `null` (sin tope), cae a
  "Solo en el plan Clínica" en vez de prometer un número equivocado. **Nunca** "sucursales
  ilimitadas".
- **IA** — `BASIC.aiTokensDefault` es **0** y `BASIC.features["ai-assistant"]` es `false`.
  La nota manda al plan Profesional (200k/mes). Un test lo cruza contra el config: si el
  Básico llegara a traer tokens, truena.
- **Usuarios ilimitados** — no se menciona en ningún tema ni en ninguna lista del papel, y
  un test barre TODO el texto del catálogo buscando "IA / sucursal / sede / ilimitad /
  usuarios": si aparece sin nota de plan, falla.

La nota se pinta **junto al titular**, no en el pie: quien recorta la imagen para una
historia se lleva la promesa y su condición en el mismo golpe de vista.

### Los tres estilos son tres paletas, no una inversión

`SOCIAL_PALETTES` (redes) y `PRINT_PALETTES` (papel) — 20+ tokens cada una.

- **Oscuro** — `#0b0a14 → #121035`, eyebrow `#a78bfa`, isotipo en baldosa morada con trazo
  blanco, QR `#0f172a` sobre baldosa blanca.
- **Claro** — `#ffffff → #f1f5f9`. El morado de marca `#7c3aed` da **5.0:1** sobre blanco:
  pasa para texto grande pero no para cuerpo, así que el eyebrow y el link bajan a
  `#6d28d9` y los apoyos van en pizarra `#475569` (7.5:1), no en morado claro. El QR se
  pinta en **negro puro** y su baldosa lleva borde `#e2e8f0` para no perderse contra el
  fondo. El wordmark reproduce `dalecontrol-logo-light.svg` — "Dale" morado + "Control"
  tinta.
- **Color** — `#371a7e → #5b21b6`, acentos lavanda, isotipo sobre **baldosa blanca con
  trazo morado**, que es como está dibujado en `public/brand/icon-color.svg`.

El QR nunca se invierte (blanco sobre oscuro): media cámara rechaza un QR invertido. Lo que
cambia es el tono de los módulos y la baldosa que va detrás. La ruta lee el color de la
**misma** paleta que dibuja la pieza, así no pueden quedar desalineados.

### La interfaz: dos pasos, sin 120 tarjetas

En "Imágenes para redes": **(1)** tema en un `select` de 10 opciones —con diez ángulos,
una fila de chips es un muro de tres renglones en el celular y el selector nativo se maneja
con el pulgar— con un eco en texto del eyebrow, el titular, los dos apoyos y la nota de
plan; **(2)** estilo en 3 chips `dcafp-btn` de 44 px; **(3)** los cuatro formatos de ESA
combinación con vista previa y descarga.

Todo `useState`: cambiar tema o estilo no navega, no recarga y no mueve el scroll. Se quitó
el `key` del `img` de vista previa — con `key` el elemento se remonta y la caja parpadea en
vacío en cada clic; sin él solo cambia el `src` y el navegador deja la imagen anterior hasta
que llega la nueva. Las cajas siguen con altura fija (168 px), así que no hay salto de
layout. Cero componentes nuevos: `SectionEyebrow` de `panel-ui` + clases `dcafp`.

### Los imprimibles

Las 3 piezas en los 3 estilos. El **volante** y el **díptico** llevan además el tema
elegido (eyebrow + titular + entrada + nota de plan en la portada); la **tarjeta** no —en
90 × 50 mm no cabe un titular de campaña con su nota, y sin la nota sería justo la pieza
que miente—, así que solo cambia de estilo. El papel tiene su **propio** selector de estilo,
con **claro marcado como recomendado** y elegido por defecto: lo que luce en un feed oscuro
se come el tóner de una láser. El QR va siempre sobre baldosa blanca (`QrChip`), porque en
oscuro y en color el fondo de la hoja no sirve de blanco.

Las listas genéricas del papel (`FEATURES`, `INCLUDES`) solo mencionan funciones que vienen
en **todos** los planes. Lo que tiene tope entra únicamente como tema elegido, y entonces
viaja con su nota pegada.

### Claims: qué se dice y qué no

- **Tomografías** — "abre y revisa", nunca "diagnostica" ni "detecta patologías". El visor
  lleva su `DiagnosticDisclaimer` justamente porque no es de grado diagnóstico. Un test
  específico lo verifica sobre ese tema.
- **CFDI** — "timbra tus facturas desde el sistema". Sin SAT, sin "validez", sin
  "autorizado": el timbrado real depende de `FACTURAPI_ENV` y en "test" no llega al SAT.
- **IA** — "un apoyo para redactar y resumir; la decisión clínica sigue siendo tuya".
- **Bot** — redactado para ser cierto también con 0 tokens de IA: la FAQ por reglas y la
  agenda funcionan en cualquier plan; el `canSpend` solo gobierna la respuesta libre, y
  cuando no hay cupo el motor deriva a una persona ("lo que se sale del guion se lo pasa a
  una persona"), que es lo que dice la pieza.
- Sin NOM-024, sin prueba gratis/trial, sin garantías de resultado, sin precios, sin
  especialidades que no existen.

### Verificación

1. **Los 63 PDF** (pieza × estilo × tema) renderizados con `renderToBuffer` y contadas las
   páginas: tarjetas 1, volante **1**, díptico 2. El volante sigue cabiendo en UNA plana
   con el titular más largo Y la nota de plan puesta — se bajaron `sectionTitle` (26→22) y
   `feature` (14→12) para comprarle el aire que ocupan el eyebrow y la pastilla.
2. **Las imágenes** revisadas en los tres estilos y en los cuatro formatos por una ruta
   **edge temporal** montada para eso y borrada después: `@vercel/og` no arranca con
   runtime `nodejs` en Windows ("Invalid URL"), así que el script suelto no sirve. QR
   legible en los tres, nota de plan legible en los tres, el estilo claro terminado (no
   invertido).
3. **La interfaz** vista a 391 px: select y chips a 44 px, la rejilla de formatos colapsa a
   una columna (`minmax(min(100%, 250px), 1fr)`).
4. **20 tests** — la matriz completa, las notas cruzadas contra `FALLBACK_PLAN_CONFIG`, la
   reja de claims prohibidos y los buscadores rechazando basura de la URL. Se comprobó que
   la reja **falla** si se quita la nota de sucursales (2 tests en rojo), no que solo pase.
5. `npm run build` completo, sin pipe, **exit 0**, con las dos rutas dinámicas.

### Compatibilidad de las URLs

`/imagen` ahora **exige** `estilo` (400 si falta): es la ruta que pinta el panel y el panel
siempre lo manda. `/imprimible` **cae a un valor bueno** si `estilo` o `tema` faltan o
vienen inventados (claro + primer tema) en vez de devolver 400: son parámetros de
presentación, no de identidad, y un enlace guardado de la versión anterior tiene que seguir
bajando su PDF. El nombre del archivo ya incluye estilo (y tema donde aplica), para que
bajar el volante en tres estilos no deje tres copias con el mismo nombre.

### Lo que NO se hizo

Sin SQL, sin schema, sin librerías nuevas, sin tocar el motor de comisiones, la landing
pública ni `globals.css`. El código del afiliado sigue saliendo **solo de la sesión**
(`resolveAffiliateQrTarget` con el `affiliateId` del contexto en el WHERE); de la URL solo
viajan formato, tema, estilo y cuál de SUS links va en el QR.

**Sigue sin descargarse una pieza real desde una sesión de afiliado**: en local no hay
`DATABASE_URL`, así que la ruta autenticada completa no se ejercitó — el arte se verificó
por la ruta temporal sin sesión. Queda pendiente bajar una imagen y un PDF desde el panel
en producción.

---

## KIT-VISUAL-TODO-EN-UNO — una pieza que enseña el sistema entero ✅ (2026-08-16)

**Rama:** `main` · **Alcance:** ola CHICA, sin SQL · **Build:** `npm run build` completo, sin
pipe, **exit 0** · **Tests:** `npm run test:kit-marketing` → **25 pasan**

### El problema

Los diez temas del kit hablan de UNA función cada uno. Con eso no se promociona en frío: un
post que solo dice "agenda y expediente" vende una función, no el producto. El afiliado que
quiere presentar DaleControl a alguien que no lo conoce no tenía ninguna pieza que lo contara
completo.

### Lo que ahora existe

Un tema **"Todo en uno"** (`id: "todo"`) que es el **primero** de `SOCIAL_VARIANTS` y el único
con `recommended: true` — el panel lo abre por defecto, lo marca en el selector
("(recomendado)") y le pone la pastilla "Recomendado para empezar" en la vista previa. **Los
diez temas sueltos siguen intactos**: sirven para publicar variado sin repetir la misma pieza,
y un test cuenta que sigan siendo diez.

Es la excepción de FORMA, no de fondo: donde un tema suelto pone titular + dos apoyos, este
pone una **rejilla de funciones con ícono**. Por eso `lines` pasó a opcional y nació
`features: VariantFeature[]`; un test exige que cada tema traiga **una cosa o la otra, nunca
las dos ni ninguna** (con las dos, media pieza se quedaría sin pintar en silencio).

### Cuántas funciones lleva cada formato, y por qué

La regla es la del encargo: **antes que achicar la tipografía, se quitan funciones**. El orden
del catálogo es orden de fuerza y cada formato se queda con las primeras N — lo que se recorta
es siempre la cola (`featuresForFormat`, `COMBO_LAYOUT`).

| Formato | Funciones | Rejilla | Cuerpo | Por qué |
|---|---|---|---|---|
| Post cuadrado 1080×1080 | **6** | 2 col × 3 filas | 29 px | Con diez, el cuerpo bajaba a ~18 px = 6 px reales en un celular. Seis se leen. |
| Historia 1080×1920 | **10** | 1 col × 10 | 33 px | El único formato con aire de verdad; las diez caben en un renglón cada una. |
| Portada de Facebook 1640×624 | **4** | 4 col × 1 fila | 18 px | Banda muy baja y el celular recorta los lados: se compone dentro de la caja segura de 1080 y solo entra una fila. |
| Banner 1200×630 | **6** | 3 col × 2 filas | 19 px | El QR se come un tercio del ancho; en las dos filas que quedan entran seis. |

`count % cols === 0` está probado: una `count` que no sea múltiplo de `cols` deja la última
fila coja, y la rejilla se arma A MANO (ni satori ni @react-pdf tienen CSS grid). Las
horizontales apilan el ícono ARRIBA del texto (`stack`) porque con 167 px de celda, un ícono a
la izquierda deja el texto en 120.

### Las notas de plan, sin saturar

Diez pastillas no caben. Las dos funciones con tope (`capped: true`) llevan **asterisco**
—puesto por `featureLabel`, no a mano, para que las tres superficies no discrepen— y la pieza
cierra con una nota al pie **solo si en ESA pieza salió alguna función con tope**
(`needsPlanFootnote` sobre la lista ya recortada). Como IA y sucursales son las dos últimas,
hoy la nota aparece en la historia y en las dos piezas de papel; la portada y el banner no
arrastran una nota que no les toca.

Dos notas, según el sitio:

- `PLAN_FOOTNOTE` (imágenes): *"\* Algunas funciones según el plan contratado."*
- `PLAN_FOOTNOTE_PRINT` (papel, que se lee de cerca y se guarda): *"\* Asistente con IA: desde
  el plan Profesional. Varias sucursales: plan Clínica, hasta 3 sedes."* — el número de sedes
  sale de `maxClinics` de `FALLBACK_PLAN_CONFIG`, igual que la pastilla del tema suelto. Si
  mañana el plan Clínica trae 5 sedes, la nota lo dice sola.

En el panel se enseña la nota LARGA aunque en la imagen quepa la corta: el afiliado tiene
derecho a saber qué está prometiendo antes de publicarlo. Y cada tarjeta de formato dice
"Muestra 6 de las 10 funciones", para que nadie crea que el post se le comió cuatro.

### Papel

El volante y el díptico cambian su lista genérica de venta por la del tema (las diez, con
ícono y nota al pie): es donde más sentido tiene —un volante SÍ debe contar el producto
entero— y evita que la pieza diga dos veces lo mismo con distintas palabras. El titular del
volante baja a 22 pt **solo en este tema**: a 26 pt @react-pdf lo silabeaba ("en un sis-tema"),
que en papel se lee como una errata. El QR del panel interior del díptico cede 14 pt (110 →
96) para que tres renglones más no empujen una tercera cara.

### Íconos

`FEATURE_ICONS` vive en el catálogo, no en cada superficie: los mismos trazos los pintan
**satori** (`<svg><path>`), **@react-pdf** (`<Svg><Path>`) y el **navegador** en la vista
previa del panel. Copiados en tres sitios, el ícono de la imagen y el del volante se irían
separando solos. Sin arcos (`A`) ni relleno —solo M/L/H/V/C/Z—, que es lo que los tres
renderizan igual sin normalizar nada; hay un test que lo vigila.

### Verificación

1. **Las 12 imágenes** del tema nuevo (4 formatos × 3 estilos) generadas y **miradas una por
   una** por una ruta **edge temporal** montada para eso y borrada después (`@vercel/og` no
   arranca con runtime `nodejs` en Windows). El post cuadrado se lee a tamaño de celular; la
   historia entra con sus diez y su nota al pie; la portada y el banner no desbordan la caja
   segura. Regresión: los temas sueltos siguen saliendo con sus dos apoyos y su pastilla.
2. **Los 99 PDF** (3 piezas × 3 estilos × 11 temas) renderizados con `renderToBuffer` y
   contadas las páginas: tarjetas 1, volante **1**, díptico **2**. Ninguno se desbordó.
   Volante y díptico del tema nuevo revisados a ojo en el visor.
3. **El panel** montado en una página temporal sin sesión: selector, pastilla de recomendado,
   la rejilla de diez con íconos, la nota larga y el "Muestra N de las 10" en cada formato.
4. **25 tests**. La reja se probó **al revés**: quitándole `capped` a la función de IA,
   *"nadie promete IA, sedes o usuarios sin decir en qué plan vienen"* e *"IA y sucursales
   NUNCA salen sin asterisco"* se ponen **en rojo**. Restaurado, verde.

### Lo que NO se hizo

Sin SQL, sin schema, sin librerías nuevas. No se tocó `globals.css`, ni el motor de
comisiones, ni la landing. Los claims no cambian: las tomografías se **abren y revisan**
(nunca "diagnostica" ni "detecta"), sin NOM-024 certificado, sin "prueba gratis", sin
garantías y sin precios escritos a mano.

**Sigue sin descargarse una pieza real desde una sesión de afiliado**: en local no hay
`DATABASE_URL`, así que la ruta autenticada completa no se ejercitó — el arte se verificó por
rutas temporales sin sesión. Queda pendiente bajar una imagen y un PDF desde el panel en
producción y comprobar que el QR lleve al link del afiliado correcto.

## PAGINA-SOCIO — cada afiliado personaliza su /socio/<slug>, con revisión previa ✅ (2026-08-16)

Un socio ya puede ponerle **su foto**, **una presentación suya** y **decidir qué secciones se
ven y en qué orden** a su página pública. Nada de eso llega a internet hasta que Rafael lo
aprueba: la página vive en dalecontrol.com y lo que diga se lee como dicho por DaleControl.

No edita el hero, ni los colores, ni la tipografía. La estética no se toca.

### La decisión que sostiene todo: dos juegos de columnas

`affiliates` gana diez columnas. Tres son **lo publicado** (`photoUrl`, `bio`,
`sectionsConfig`) y tres son **el borrador** (`photoUrlPending`, `bioPending`,
`sectionsConfigPending`); las otras cuatro son el estado de la moderación.

La página pública lee **solo las publicadas**, y las del borrador ni siquiera salen de la base
en la consulta que la sirve (`getApprovedAffiliate` las omite del select). La consecuencia es
la que importa: mientras algo está en revisión —o si se rechaza— el visitante sigue viendo lo
último aprobado. Un socio no puede tumbar su propia página dejando un borrador a medias, y un
texto sin revisar no llega a nadie ni por un descuido de render.

**`hasDraft()` mira `sectionsConfigPending`, no "algún pendiente no es null".** Parece un
detalle y es el que evita un bug feo: un socio que BORRA su foto y su texto deja los dos
campos pendientes en null, y con la otra regla eso se leería como "no ha editado nada" — la
pantalla le devolvería su contenido publicado y le desharía el borrado delante de los ojos.
Por eso **toda** escritura de borrador guarda los tres campos a la vez: el borrador es una
foto fija del estado propuesto, nunca un diff. De paso, aprobar es copiar tres columnas y el
"antes y después" del admin no tiene que adivinar qué significa un null.

### Las secciones

Once entradas en el catálogo (`page-config.ts`), y el orden de ese array **es** el orden por
defecto de la página: un socio que no toque nada tiene exactamente lo de siempre. Seis son
movibles; cinco son fijas **porque llevan un botón de registro con su código**, y la pantalla
le escribe el motivo en cada una en vez de dejarle un interruptor gris sin explicación.

`normalizeSections()` es el punto que garantiza que nada se rompa: null, un jsonb con basura,
una sección retirada del catálogo o una añadida después de que ese socio guardó su orden —
todo cae en una lista completa y renumerada. Lo que falte entra **encendido** y al final, así
que una sección nueva del producto aparece sola en las páginas ya configuradas. Lo llaman los
tres lados (pública, panel y admin) para que un mismo jsonb no pinte tres páginas distintas.

### La foto

Se sube por el patrón ya resuelto en `account-managers/[id]/photo` (jpeg/png/webp, 5 MB,
`validateMagicNumber` — el content-type del navegador es falseable), al bucket `clinic-public`
bajo `affiliates/<id>/`. Lo que se guarda **no es lo que llegó**: sharp la recorta a un
cuadrado **centrado** y la baja a 512px webp. Centrado y no "atención": el recorte tiene que
ser predecible porque la vista previa enseña ese mismo encuadre, y un recorte inteligente que
elija otra región dejaría mentir a la vista previa. De paso el reencode tira los EXIF, que en
un retrato de teléfono suelen traer dónde se tomó, y evita que una foto de 5 MB de cámara
arruine el LCP de la landing de un socio que no tiene por qué saber de compresión.

### El texto es TEXTO PLANO

Se guarda literal y se pinta con `{bio}` dentro de un `<p>`: React escapa, así que
`<b>hola</b>` se lee `<b>hola</b>`. Ni HTML ni markdown — es contenido de un tercero en
nuestro dominio. `sanitizeBio` solo quita lo invisible (controles) y limita los párrafos
vacíos en cadena; el tope de 600 se cuenta por **caracteres visibles**, no por unidades
UTF-16, para que un emoji no gaste dos del cupo y el contador de la pantalla no discrepe del
servidor justo al enviar.

### La vista previa no puede mentir

El bloque de presentación de la vista previa **es** `<PartnerIntro />`, el mismo componente
que pinta `/socio/<slug>`. No es una imitación. Su CSS lleva colores literales (los de
`sales.css`) en vez de heredar variables, precisamente porque se pinta en dos sitios con
paletas distintas: dentro de `.mfh` en la pública y dentro de `.dcafp` en el panel. Si tomara
los colores del entorno se vería de un color en cada sitio y la vista previa dejaría de servir
para lo único que sirve.

### Moderación

`/admin/paginas-socio` (**hermana** de `/admin/affiliates`, no hija: `isActive()` empareja por
segmento y anidarla encendería los dos items del menú a la vez — el mismo problema que ya se
arregló entre `/admin/soporte` y `/admin/soporte-afiliados`). Badge de alerta con las
pendientes: sin él un socio puede quedarse días esperando sin que nadie se entere.

Antes y después lado a lado, aprobar o rechazar **con motivo obligatorio** (el socio lo lee y
es lo único que le dice qué corregir), y retirar una ya publicada. Al retirar, lo publicado
**vuelve a su borrador** en vez de tirarse: ve el motivo, conserva su trabajo y puede corregir
y reenviar, mientras su página ya volvió a la de fábrica.

Las tres transiciones usan `updateMany` con el estado esperado en el WHERE, así que dos
pestañas del admin no pueden aprobar y rechazar lo mismo: la segunda toca 0 filas, responde
409 y la pantalla se recarga sola. El correo va **después** y nunca revierte: la decisión ya
está escrita cuando se intenta enviar, y tirar la respuesta porque Resend no contestó dejaría
al admin dándole otra vez a "Aprobar" sobre algo ya aprobado.

### Dos cosas que se arreglaron de paso

1. **`Prisma.DbNull`, no `undefined`.** La primera versión de `approvePage` limpiaba el
   borrador con `sectionsConfigPending: undefined`; en un campo Json eso significa "no toques
   esta columna". El borrador habría sobrevivido a su propia aprobación y el panel le habría
   dicho al socio "tienes cambios sin enviar" el segundo después de aprobárselos.
2. **El pie de `/socio/<slug>` era blanco sobre blanco.** Los colores estaban en
   `rgba(255,255,255,…)`, heredados de una versión oscura de la plantilla; `.mfh` es blanco.
   La línea invisible era justamente **"Recomendado por \<socio\>"**, el crédito del afiliado.
   Y el enlace caía siempre al respaldo `#a78bfa` porque `--mfh-brand` no existe en
   `sales.css` (el token es `--b`). Ahora `--b2` → **7.1:1** medido en el navegador.

### Verificación

- **`npm run build` completo, exit 0**, leído entero (sin pipes: enmascaran el exit code).
  Los tres warnings de Tailwind son preexistentes. `npx tsc --noEmit` limpio.
- **18 tests** (`npm run test:afiliados-pagina`) sobre los tres estados y sus trampas: sin
  personalizar la página queda idéntica; en revisión el público **no ve nada** de lo
  pendiente; aprobada publica lo aprobado con el borrador limpio. Más el caso de borrar foto y
  texto, el jsonb corrupto, el recorte por code points y "un estado desconocido cae en draft"
  (ante la duda, no publicar).
- **Los cuatro estados del panel mirados uno por uno** en una página temporal sin sesión ni
  BD, borrada después: sin personalizar, en revisión (21 controles bloqueados, comprobado en
  el DOM), aprobada y rechazada con su motivo.
- **`<PartnerIntro />` dentro de `.mfh`** por otra ruta temporal: centrado (contenedor 1200px,
  tarjeta 820px a 190px de cada lado, medido en el DOM), con foto, sin foto, y **sin pintar
  nada** cuando no hay ni foto ni texto. Contraste del pie medido ahí mismo.

### Lo que NO se hizo / queda pendiente

- **Nadie ha subido todavía una foto real ni ha aprobado una página de verdad.** En local no
  hay `DATABASE_URL`, así que las rutas autenticadas completas (subida a Supabase Storage,
  aprobación, correo) no se ejercitaron de punta a punta. Queda: subir una foto desde una
  sesión de afiliado real, enviarla, aprobarla desde `/admin/paginas-socio` y comprobar que
  llegue el correo y que `/socio/<slug>` la pinte.
- **Los correos salen por el stub** mientras no haya `RESEND_API_KEY`: hoy se registran en
  consola, no se envían.
- **Se añadió "Retirar el envío"** (`DELETE /api/afiliados/pagina/revision`), que no estaba
  pedido. La cola la atiende una sola persona y sin eso un socio que detecta su propia errata
  treinta segundos después de enviar se queda bloqueado —sin poder editar ni reenviar— hasta
  que alguien revise. Solo funciona mientras siga en `pending`.
- No se tocó el hero, ni la atribución (los CTA siguen apuntando a
  `/signup?ref=<referralCode>` con su campaña), ni el tracking de clics, ni `globals.css`.

═══════════════════════════════════════════════════════════════════════════
## [Preview-Vivo-Miniweb] — la vista previa se mueve MIENTRAS se escribe ✅ (2026-08-16)
═══════════════════════════════════════════════════════════════════════════

En `/dashboard/landing` la clínica escribía a ciegas: cambiaba un texto, un color o apagaba una
sección y el panel derecho seguía enseñando lo publicado hasta pulsar Guardar. Ahora el iframe
refleja lo que hay escrito, **sin recargarse**, ~350 ms después de la última tecla.

### El camino: postMessage + contexto, NO recargar el iframe

Recargar la página entera por tecla era inaceptable (parpadeo, scroll perdido, una petición por
pulsación), así que el editor **manda** los cambios y el iframe se repinta solo.

La pieza nueva es `src/app/[slug]/_shared/live-preview.tsx`:

- `LivePreviewBridge` — vive DENTRO del iframe. Escucha `message`, guarda el parche en estado y
  lo publica por contexto de React. Al montar avisa `{kind:"ready"}` al padre: el editor no
  tiene forma de saber cuándo terminó de cargar el iframe, así que el saludo lo pone al día
  con lo que ya haya escrito (esto es lo que hace que cambiar de plantilla no pierda el borrador).
- `useLiveClinic(clinic)` — una línea al principio de cada una de las **8 plantillas**. Sin
  proveedor —o sea, en la página pública— devuelve **la misma referencia** que llegó del
  servidor: cero coste y cero cambio de comportamiento.

Se descartó la alternativa obvia —un componente cliente que reciba el id de plantilla y elija
él mismo cuál pintar— porque metería las ocho plantillas en el mismo grafo de cliente y la
página PÚBLICA se descargaría el JS de las ocho. Con el contexto, `clinic-landing-server` sigue
eligiendo en el servidor y cada plantilla conserva su chunk. `/[slug]` quedó en **261 kB**
First Load JS, igual que antes.

El puente **solo se monta en `/landing-preview/[slug]`** (`ClinicLandingServer` recibe `live`).
La página pública no escucha mensajes de nadie: comprobado en el navegador mandándole un parche
a una réplica de `/[slug]` — no se inmuta.

### Lo que viaja: una allowlist cerrada, no el objeto `clinic`

Después del commit `0424d5ab` esto no admitía atajos. Viajan **exactamente los 19 campos que el
formulario edita**, y la lista es la misma en las dos puntas porque sale del mismo módulo
(`LIVE_PREVIEW_FIELDS`). No es solo una lista de nombres: cada campo lleva su **validador de
forma** (`esTexto`, `esNumero`, `esLista`, `esUrls`, `esMapa`), y un valor con la forma
equivocada se descarta **campo a campo**, sin tirar el mensaje entero. El iframe además exige
que el `slug` del mensaje sea el suyo (multi-tenant) y que el origen coincida.

Verificado a mano contra el iframe: un parche con `waAccessToken` no deja rastro en el DOM, uno
con `landingGallery: "no-soy-un-array"` se ignora sin romper nada, y uno firmado con el slug de
otra clínica no se aplica.

### Que nunca se quede en blanco

Tres redes, de fuera hacia dentro:

1. El validador de arriba: la mayoría de la basura no llega a React.
2. Un **error boundary** dentro del puente. Si la plantilla revienta con un parche, se vuelve a
   **lo publicado** —que es justo lo que pinta la página pública y por tanto no puede fallar, así
   que el bucle termina siempre— y el siguiente parche se intenta igual: borrar el carácter que
   rompió la cosa recupera la vista previa sola. Probado con un componente que revienta a
   propósito: parche bueno → se ve; parche que revienta → vuelve a lo publicado (**no** a blanco);
   parche bueno otra vez → se recupera.
3. Recargar el iframe sigue existiendo al guardar y al cambiar de plantilla. Lo que se ve tras
   guardar sale del servidor, no de un parche.

### El aviso de borrador, campo por campo

Mientras haya algo sin guardar sale un chip ámbar **"Sin guardar"** junto a "Vista previa", el
marco del iframe se pone ámbar y el pie cambia a *"Esto es un borrador: se ve aquí, pero tu sitio
público sigue como estaba."*

Se comparaba con una foto entera del formulario y **estaba mal**: esta pantalla tiene un botón
"Guardar" por bloque, así que guardar el eslogan apagaba el aviso aunque las secciones siguieran
tocadas — la clínica se iba creyendo publicado algo que seguía en el navegador. Ahora se guarda
la firma de **cada campo** y `save()` solo marca como publicados los que iban en ESE guardado.
Comprobado en el navegador: tocar secciones → aviso; guardar solo el eslogan → **el aviso sigue**;
guardar secciones → se apaga.

Esto es solo visual: no toca la base, no hay autoguardado y recargar sin guardar descarta todo
(comprobado). No se puso `beforeunload`: el requisito era justamente que recargar descarte, y un
diálogo nativo del navegador no estaba pedido.

### De paso, dos arreglos en el editor por manifiesto

- **El borrador de secciones sobrevive al cambio de pestaña.** `sections` ahora entra como
  `draftSections ?? savedSections`. Antes, ir a "General" y volver a "Diseño" perdía lo tocado en
  silencio; ahora además el formulario y la vista previa no pueden descuadrarse.
- **`ManifestEditor` ya no borra las secciones que su manifiesto no declara** (las que solo
  existen para colgar un texto, o las de una plantilla anterior). Se caían al montar y el
  siguiente "Guardar secciones" las borraba de la base sin avisar.

### Verificación

`npx next build` **EXIT 0** completo, leído entero (los tres warnings de Tailwind y el de
`file-type` son preexistentes). `npx tsc --noEmit` limpio.

En Chrome, sobre `next dev` y dos pages temporales sin BD (el editor REAL con una clínica mock +
una réplica de `/landing-preview/<slug>`), **borradas antes de commitear**:

- Escribir en un campo → **612 ms** del clic al repintado, con la pestaña en primer plano. El
  reparto: **3 ms** es el repintado de la plantilla; lo demás es el retardo de 350 ms.
- **Sin recargar y sin perder el scroll**: se marcó `contentWindow` y la marca sobrevive; el
  `scrollY` sigue donde estaba.
- **El retardo agrupa**: 7 teclas a 90 ms → **1** mensaje; 3 teclas a 500 ms → **3**. Escribir un
  párrafo no dispara cincuenta mensajes.
- Apagar/encender una sección, el color (toda la plantilla cambia), y los servicios (que viven en
  estado propio del editor, no en `clinic`) — todo en vivo.
- Cambiar de plantilla **sí recarga** el iframe (`?preview=sonrisa`) y el borrador se vuelve a
  aplicar solo, por el saludo `ready`.
- Guardar: el chip desaparece, el iframe se recarga, el pie vuelve a *"Lo que ves aquí es tu sitio
  público, tal cual"*.
- Recargar sin guardar: todo descartado, la vista previa vuelve a lo publicado.
- **Consola limpia**: ni un error de CSP ni de postMessage ni de hidratación. Se confirmó que
  `next dev` sí sirve la CSP real (`frame-src 'self'`, `frame-ancestors 'self'`) — el iframe es
  del mismo origen y no le afecta.

Medir esto con la pestaña **oculta** engaña: Chrome estrangula `setTimeout` a 1 s (se midió
`setTimeout(50)` tardando 590 ms), y el retardo de 350 ms parecía 2 s. Los números de arriba son
con la pestaña en primer plano.

### Lo que NO se hizo

- **Reordenar secciones sigue sin verse, ni aquí ni en el sitio publicado.** El nuevo orden llega
  al iframe (se comprobó: el parche viaja con `equipo#0 servicios#1 …`), pero **ninguna de las 8
  plantillas lee `orden`** — `grep -rn "orden" src/app/[slug]/` fuera de `landing-data.ts` no
  devuelve nada. El orden de las secciones está fijo en el JSX de cada plantilla. La vista previa
  es fiel: enseña exactamente lo que enseñaría guardar. Hacer que el orden mande de verdad es
  reestructurar el JSX de las 4 plantillas que usan `sectionMap`, y es otra tarea.
- Solo 4 de las 8 plantillas (consultorio, equipo, especialistas, sonrisa) leen `sectionMap`; en
  las otras 4 encender o apagar una sección no cambia nada. Preexistente.
- No se verificó de punta a punta con base de datos: en local no hay `DATABASE_URL`. Falta ver en
  prod que tras guardar la vista previa y el sitio público coincidan (el `revalidatePath` de
  `/landing-preview/[slug]` ya estaba).
- Sin dependencias nuevas, sin SQL, sin tocar `globals.css` ni la CSP.

---

## [Miniweb-Ola1] — el sitio público deja de estar abierto ✅ (2026-08-17)

Rama `fix/miniweb-ola1`, commit `29608790`. Cierra lo que la ola de la vista previa dejó apuntado
como "otra tarea": las 4 plantillas que no leen el manifiesto y el `orden` que nadie respeta.

### Lo que se cerró

**1. El PATCH de `/api/clinic-landing` no preguntaba NADA de permisos.** Entre el `if (!ctx) → 401`
y el `prisma.clinic.update` no había ni una línea: cualquier usuario con sesión —incluido uno de
SOLO LECTURA— podía reescribir la página pública y **despublicarla** (`landingActive` estaba en la
lista de campos guardables). `landing.edit` existía en `lib/auth/permissions.ts` y no lo leía nadie:
un permiso muerto. Ahora lo exigen el PATCH y `POST /api/landing-upload`; el GET pide `landing.view`.

**2. `/dashboard/landing` se pinta en solo lectura** para quien no tiene `landing.edit`: aviso
arriba explicando qué falta y quién lo da, y todo lo editable dentro de un `<fieldset disabled>`
—inputs, botones, interruptores y los `input[type=file]` escondidos, 24 controles, comprobado con
`:disabled` en el navegador—. Fuera quedan las pestañas y "Ver página / Copiar link": mirar no es
editar. El 403 del servidor sigue siendo la barrera de verdad; esto es para que no lo descubra
después de redactar media página.

**3. La pestaña "Diseño" ya no miente.** El manifiesto declara `leeManifiesto` y el editor lo lee de
ahí (`plantillaLeeManifiesto` / `plantillasQueLeenManifiesto`): no hay ninguna lista de nombres
escrita en la pantalla. En `classic` —la de por defecto— , `futurista`, `healthtech` y `calido` se
explica por qué no hay interruptores y se ofrecen por su nombre las cuatro que sí. En `equipo` los
interruptores siguen ahí y funcionan.

**4. Reordenar secciones: fuera.** Las flechas guardaban `orden` y ninguna plantilla lo lee. Se
quitan hasta que el orden mande al pintar. `orden` se sigue guardando (ya está en la base).

**5. Subir la foto de un doctor.** `team-client` manda `field="avatar"` y el endpoint dejó de
reconocerlo en `2a98c3d1`, cuando el manifiesto trajo su lista de destinos: **400 desde entonces**.
El desajuste era del SERVIDOR (el cliente manda lo mismo de siempre, ver `git show 2a98c3d1`), así
que se arregló ahí; mandar el cliente a la ranura `doctor` del manifiesto habría metido los avatares
del equipo en una ranura que significa otra cosa.

**6. Las fotos de celular.** Nace `lib/image-client.ts`: 2000 px de lado máximo, webp q0.82, antes de
que salga la request, en los dos sitios que suben imagen de la mini-web. El tope del servidor baja
de 50 MB (imposible: el runtime corta en ~4.5 MB) a 4 MB, con mensaje que se entiende.

**7. Fugas y validación.** El PATCH ya no devuelve la fila de la clínica (la lista NEGRA de 7 campos
dejaba pasar `rfcEmisor`, `stripeCustomerId`, `twilioAccountSid`): contesta `{ok, updatedAt,
fields}` y el `update` pide `select: {slug, updatedAt}`. Nace `lib/landing-fields.ts`: lista LITERAL
con validador por campo y tope de 64 KB en los JSON. `beforeunload` en el editor (no había ni uno en
todo el repo). Los datos de contacto viajan a la vista previa en vivo.

### Lo que salió distinto de como venía descrito

- **La pestaña "General" NO tenía teléfono, correo, dirección ni nombre.** El encargo daba por hecho
  que existían y que solo faltaba meterlos en `CAMPOS_VIVOS`. No existían en ningún lado del editor:
  se editaban únicamente en Configuración (`/api/settings`), lejos de la vista previa. Se **crearon**
  los cuatro campos en General, se metieron en la lista del PATCH con su validador y en
  `CAMPOS_VIVOS`. Así la allowlist sigue siendo cerrada y honesta: ahora el formulario sí los edita.
  Se guardan por `/api/clinic-landing` (gateado por `landing.edit`), NO por `/api/settings`.
- **El fallo de la subida era del servidor, no del cliente** (el encargo apostaba por el cliente).
  Lo confirma `git show 2a98c3d1`: antes de ese commit el endpoint aceptaba cualquier `field`.
- **`orden` no se lee en NINGUNA de las 8 plantillas**, ni siquiera en las 4 que sí leen el
  manifiesto. Por eso se quitó la reordenación entera en vez de solo esconderla en 4.
- **Las 4 plantillas viejas ignoran el manifiesto ENTERO**, no solo las secciones: tampoco leen
  `landingPhotos` (usan `landingCoverUrl`), ni `landingUrgentText`, ni `landingMsiPlazos`. O sea que
  subir una "Portada" desde Diseño en `classic` tampoco hacía nada. Se cierra con la misma bandera, y
  en General se avisa en línea para urgencias y meses sin intereses.
- **`landingHours` era columna muerta**: estaba en la lista de campos guardables del PATCH y no la
  escribe ni la lee nadie en todo el repo (los horarios salen de la relación `schedules`). Se sacó
  de la lista. La columna sigue en el schema.
- **El GET de `/api/clinic-landing` no lo llama nadie** del repo y devolvía la clínica casi entera a
  cualquiera con sesión. Se dejó (para no romper a un cliente que no veamos) pero con `landing.view`
  y `select` explícito.

### El gate de permisos, ¿deja fuera a alguien?

Defaults de `landing.edit` (`ROLE_DEFAULT_PERMISSIONS`): SUPER_ADMIN ✅ · ADMIN ✅ · DOCTOR ❌ ·
RECEPTIONIST ❌ · READONLY ❌.

- **Nadie que hoy use la pantalla pierde nada que deba conservar.** DOCTOR y RECEPTIONIST **tampoco
  tienen `landing.view`**, así que hoy ni siquiera pueden abrir `/dashboard/landing`
  (`requirePermissionOrRedirect` los echa). Lo que perdían por la puerta de atrás era llamar al API
  a mano — que es justo el agujero.
- **READONLY sí cambia**: conserva `landing.view` (todas las keys `*.view` entran en su default), así
  que sigue viendo su sitio, pero ya no puede tocarlo. Ese era el caso más grave del encargo.
- **⚠️ El único caso no obvio:** `permissionsOverride` **REEMPLAZA** los defaults, no se mezcla con
  ellos. Un ADMIN con permisos personalizados armados antes de que `landing.edit` sirviera para algo
  —nadie lo marcaba, porque no hacía nada— se queda **sin poder editar la web**. Rafael ya revisó
  quién tiene overrides; si aparece alguien así, se arregla marcándole la casilla en Equipo →
  Permisos (Configuración → "Editar landing"). No se tocó `ROLE_DEFAULT_PERMISSIONS`: subir
  `landing.edit` a RECEPTIONIST o DOCTOR sería ampliar quién publica el sitio, y eso es decisión de
  producto, no de esta ola.
- **La subida se gatea por destino**, no en bloque: `avatar` pide admin (igual que el `PATCH
  /api/team/[id]` que persiste la foto) y el resto pide `landing.edit`. Si se hubiera gateado todo
  con `landing.edit`, un admin sin ese permiso habría dejado de poder subir avatares aunque el
  endpoint que los guarda sí se lo permitiera.

### Verificación

- **`npx next build` completo, EXIT 0**, 364 páginas. Sin errores de tipos.
- **43 comprobaciones** de `validarCamposLanding` y del manifiesto con `tsx`, todas verdes. **Una
  encontró un fallo real antes de salir**: `v.every(esUrlWeb)` le pasa el ÍNDICE como segundo
  argumento, que en `esUrlWeb(v, max)` es el tope de longitud → la primera URL se comparaba contra 0
  y **ninguna galería se habría podido guardar**. Corregido a `v.every(x => item(x))`.
- **En el navegador** (`next dev` + página temporal fuera del middleware, ya borrada — en local no
  hay `DATABASE_URL`):
  - `classic` → explicación en Diseño, sin interruptores. `equipo` → interruptores presentes, sin
    flechas.
  - Solo lectura: aviso visible, `fieldset.disabled=true`, **0 de 24** controles activos, escribir en
    un input no cambia su valor, los `input[type=file]` bloqueados. Pestañas y "Copiar link" siguen
    vivos.
  - Escribir un teléfono en General → el parche que sale al iframe lleva `phone` con el valor nuevo
    (+ `name`, `email`, `address`), **23 claves y ni un secreto**, y se enciende el chip "Sin
    guardar".
  - `beforeunload` armado: el evento sale cancelado con cambios pendientes.
  - Foto de 4032×3024 → sube como **webp de 250 KB** (−85 %), por debajo del corte del runtime. Un
    png de 800×600 y 17 KB → **se manda byte por byte igual**, sin recomprimir.

### Lo que NO se pudo verificar en local (falta prod o una BD)

- Que el dueño publique de verdad y que el sitio público se regenere (necesita `DATABASE_URL`).
- Que un usuario sin `landing.edit` reciba el 403 real del endpoint (necesita sesión).
- Que la foto del doctor se vea en el equipo y en las plantillas que muestran doctores.
- Que el código fuente del sitio público no traiga datos sensibles: **revisado por código**, no
  ejecutado. `clinic-landing-server.tsx` usa `select` explícito (sin `include`) y el parche de la
  vista previa se comprobó en el navegador: 23 claves, ninguna sensible.

### Lo que queda abierto (no era de esta ola)

- **`/api/settings` sigue sin gate de permisos** y su lista incluye credenciales de Twilio y datos
  fiscales. Intacto a propósito: es otra ola, y es más grave que lo que se cerró aquí.
- **`/dashboard/landing/page.tsx` sigue pasando la fila casi completa de la clínica** al componente
  cliente (`stripClinicSecrets` es la misma lista NEGRA de 7 campos), así que `rfcEmisor`,
  `stripeCustomerId` y `twilioAccountSid` siguen viajando en el payload RSC de esa pantalla. Se
  cerró la puerta del PATCH, no esta. Arreglarlo pide enumerar todos los campos que lee el cliente
  (unas 1000 líneas) y merece su propio cambio.
- Que el `orden` de las secciones mande de verdad: hay que reestructurar el JSX de las 4 plantillas
  que leen `sectionMap`.
- Que `classic`, `futurista`, `healthtech` y `calido` aprendan a leer el manifiesto. El día que lo
  hagan, basta con poner `leeManifiesto: true` y el editor aparece solo.

---

## [Editor-Visual-Etapa1] — El motor, probado sobre "equipo"

Rama `feat/editor-visual-miniweb`, worktree limpio desde `origin/main` (90848a21).
Construido encima de la Ola 1: el gate `landing.edit`, `template-manifest.ts`,
`image-client.ts` y `landing-fields.ts` ya estaban y no se tocaron.

### Qué se puede hacer ahora que antes no

Con la plantilla **equipo** activa aparece en `/dashboard/landing` una tarjeta
"Editar haciendo clic encima" que lleva a `/dashboard/landing/editor`. Ahí está el
sitio de la clínica a tamaño real: se hace clic sobre un texto y se edita en su
sitio, se suelta una foto sobre su hueco y se ve al instante, se cambia el color de
acento y todo se mueve en vivo. Nada se publica hasta pulsar "Publicar cambios".

### La arquitectura, en corto

- **El lienzo** es el iframe de siempre a `/landing-preview/<slug>?preview=<tpl>&edit=1`,
  **con su propio scroll** y escalado solo por ancho (`escala = min(1, ancho/1280)`).
  No se estira al alto del contenido ni se dibuja un solo overlay en el padre: la
  geometría de `heatmap-stage.tsx` habría reventado los hero de 100vh, las barras
  sticky y los botones fixed de las ocho plantillas.
- **Las afordancias viven DENTRO del iframe** (`_shared/edit-runtime.tsx`). Mismo
  origen, documento nuestro: cero rects, cero sincronía de scroll, y el archivo que
  se suelta aterriza donde vive el `File`.
- **Texto**: al hacer clic, el nodo **se sustituye en flujo por un `<textarea>`** con
  los estilos calculados copiados inline. Nada de `contentEditable`. Campo **no
  controlado**: mientras se escribe no sale ni un mensaje. `Esc` cancela; `Enter`
  (una línea) o salir del campo confirma → **un** `postMessage`.
- **`<Txt>` y `<Foto>`** (`_shared/edit-context.tsx`) son passthrough EXACTO sin
  proveedor y no importan nada del runtime de edición. El runtime lo trae
  `LivePreviewBridge` con `import()` dinámico y solo bajo `?edit=1`.
- **Direccionamiento cerrado**: el iframe manda una cadena (`sec:servicios:titulo`,
  `servicio:2:price`) y `@/lib/landing-address` la traduce contra un juego CERRADO
  de formas a UNA columna ya permitida. El tipo `ColumnaDeTexto` es la intersección
  de `CampoEditable` (el PATCH) con `LivePreviewField` (la vista previa): si una
  columna faltara en cualquiera de las dos listas, no compila.
- **Guardar manda una LISTA LITERAL** de las columnas tocadas. Jamás un diff del
  objeto `clinic` — ese patrón causó `0424d5ab`.
- **Sin autosave**: el PATCH publica y revalida tres rutas.
- **409 real**: el editor manda el `updatedAt` con el que cargó y el PATCH usa
  `updateMany` con ese `updatedAt` en el `where` (atómico; `update` solo acepta
  claves únicas). Si la fila se movió, 409 con los valores actuales de los campos
  que se intentaban guardar — nunca la fila.
- **`?edit=1` exige sesión de ESA clínica y `landing.edit`**, comprobado en el
  servidor de `/landing-preview` (esa ruta no pasa por el middleware). Solo
  entonces se pinta una landing con `landingActive:false`, que hasta hoy cortaba
  antes del switch de plantillas y dejaba un rectángulo negro.

### El primer test de landing del repo

`npm run test:landing` — 12 pruebas.

1. **Manifiesto ↔ instrumentación**: por cada plantilla marcada `instrumentada`,
   existe un nodo por cada texto y una ranura por cada foto que declara.
2. **HTML byte-idéntico sin proveedor**: las **ocho** plantillas se pintan con una
   clínica fixture y se comparan **byte a byte** contra `html-publicado/*.html`,
   generados ANTES de tocar nada. Se usa `renderToString` (el de Next, marcas de
   hidratación incluidas), no `renderToStaticMarkup`.
   El golden de las ocho se guarda ya, así que las etapas 2-5 arrancan con su
   línea base tomada del código pre-instrumentación.
3. La prueba se **refutó**: metiendo un `data-refutacion="1"` en `<Txt>`, falla y
   dice el byte exacto (26773 de 40425). Sin eso no valdría nada.

`npm run test:landing-address` — 12 pruebas más sobre la frontera: qué formas se
rechazan (`clinica:constructor`, `sec:inventada:titulo`, `foto:../../etc/passwd`,
índices fuera de rango), dónde aterriza cada dirección, que vaciar guarda `null` y
nunca el texto por defecto, y que una FAQ vieja `{question, answer}` se migra sin
perder el campo que no se tocó.

### Verificado

- **`npx next build` COMPLETO, EXIT 0.** Leído entero, sin pipes.
- **First Load JS de `/[slug]`: 261 kB → 263 kB (+2 kB).** La línea base la medí
  compilando `origin/main` en un worktree aparte, no la di por buena.
  La primera compilación dio **267 kB**: importar `@/lib/landing-address` desde la
  plantilla arrastraba el manifiesto de las ocho (17 KB) al navegador de los
  pacientes. De ahí sale `landing-address-parts.ts`, que no importa nada y solo
  tiene seis funciones de una línea y tipos.
- **En el navegador** (con dos rutas temporales, ya borradas, porque no hay
  `DATABASE_URL` en local): clic en el titular → `<textarea>` con el MISMO tamaño,
  fuente y saltos de línea, sin que el layout se mueva; escribir + salir → el
  mensaje llega, se traduce a su columna y el parche vuelve pintado; `Esc` cancela;
  vaciar un título → vuelve el texto por defecto de la plantilla; vaciar una
  pregunta obligatoria → aviso y no se borra; soltar un PNG sobre `tecnologia1` →
  vista previa inmediata; "Quitar" → el hueco punteado vuelve; el acento cambia en
  vivo; y hacer clic en cualquiera de los 6 botones de "Agendar" **no** abre el
  modal de reserva (el lienzo se edita, no se usa).
- **Consola: cero errores de CSP, cero de postMessage, cero de hidratación.** Lo
  único que sale son los scripts de Vercel Analytics que no cargan sin red.

### Un fallo real que encontró la verificación

El `<textarea>` llevaba `font: "inherit"` DESPUÉS de los estilos copiados: la
taquigrafía pisa `fontSize`, `fontWeight` y `lineHeight`, así que un titular de
58 px se escribía en 16. Se quitó y se añadió `maxWidth` a lo que se copia, para
que un titular con `max-width:16ch` no se estire al empezar a escribir.

### Decisiones que conviene saber

- **`equipo` fue la barata, no la importante.** Se eligió porque ya leía el
  manifiesto. En producción hay **10 clínicas con `classic` y 1 con `equipo`**: hasta
  la Etapa 2 esto lo puede usar una sola clínica.
- **Secciones que solo dependen de tener foto** (`casos`, `tecnologia1`,
  `tecnologia2`) se pintan en el lienzo aunque estén vacías, con un hueco punteado.
  Si no, no habría dónde soltar la primera foto. En la página pública siguen
  ocultándose exactamente igual — lo garantiza el test byte-idéntico.
- **Textos interpolados NO instrumentados**, marcados con `campo={null}`: la
  duración de un servicio (`{s.durationMin} min`) y las reseñas de Google (son de
  Google, no hay dónde guardarlas). Las comillas de un testimonio sí se editan, con
  `prefijo`/`sufijo`, porque el valor guardado sigue siendo el texto pelado.
- **Nada se borra de Storage** al cambiar o quitar una foto.
- **Los fondos no se editan** y se dice con todas sus letras en la barra del editor.
- Al manifiesto de `equipo` se le añadieron dos textos que la plantilla pintaba
  desde siempre y nadie había declarado: `equipo.subtitulo` y `galeria.titulo`.

### Lo que NO se pudo verificar en local

- La pantalla `/dashboard/landing/editor` de verdad (barra, escalado real,
  Guardar/Descartar/Deshacer, el 409 entre dos pestañas): todo eso exige sesión y
  `DATABASE_URL`. Lo probado en el navegador fue el lienzo y el bus completos, con
  el mismo runtime y el mismo módulo de direcciones, con una clínica de mentira.
- Que el PATCH con `esperadoUpdatedAt` devuelva 409 contra Postgres.

### Lo que queda abierto

- Etapas 2-5: `classic` (10 de 11 clínicas), las otras 3 modernas, la columna
  `landingCopy` para el copy escrito dentro de las plantillas, y las 3 viejas.
- La primera foto de una ranura de una sección que NO es photo-gated (la galería,
  el avatar de un doctor) sigue subiéndose desde el formulario.
- `/dashboard/landing/page.tsx` sigue mandando la fila casi completa al cliente
  (viene de antes; el editor nuevo sí usa `select` explícito).
