═══════════════════════════════════════════════════════════════════════════
## ONBOARDING-EMAILS — Correos "plan activado" (1er pago) + "plan renovado" (Resend) ✅ (2026-06-29) · rama feat/billing-emails (NO main)
═══════════════════════════════════════════════════════════════════════════
COMMIT: dd014101 · BUILD EXIT 0 (✓ Compiled successfully, sin warnings en archivos tocados).
NO mergeado a main: pendiente aplicar SQL + QA con pago de prueba (que llegue el correo A).

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
