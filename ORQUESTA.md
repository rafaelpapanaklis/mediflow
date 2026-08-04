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
