# 🚀 START HERE — Instrucciones para Claude Code

> **IMPORTANTE:** Este es el archivo maestro que controla la implementación del Marketplace de Módulos de MediFlow.

---

## Cómo trabajar este proyecto

Eres Claude Code y vas a implementar un sistema completo de marketplace de módulos para MediFlow (un SaaS médico mexicano). El trabajo está dividido en **6 sprints** que debes ejecutar **EN ORDEN**, uno a la vez.

### Tu protocolo de trabajo

1. **Lee SIEMPRE primero `PROGRESS.md`** para saber en qué sprint estás.
2. Si `PROGRESS.md` indica que el sprint N está listo para empezar, abre `sprints/SPRINT_N.md` y léelo completo.
3. Lee también `BRIEF.md` (contexto técnico general) y `mediflow_marketplace.jsx` (prototipo visual de referencia) si aún no los has leído en esta sesión.
4. **Ejecuta el sprint completo** siguiendo todas sus tareas.
5. Al terminar el sprint, **actualiza `PROGRESS.md`** marcando ese sprint como `✅ DONE` y dejando notas de qué hiciste y qué falta verificar.
6. **DETÉNTE** y pídele a Rafael (el dev) que valide antes de continuar al siguiente sprint.
7. Cuando Rafael te diga "continúa", lee `PROGRESS.md` de nuevo y procede al siguiente sprint.

### Reglas obligatorias

- ✅ **Ejecutar UN sprint a la vez.** No combines sprints. Si terminas el 1, detente; no empieces el 2 automáticamente.
- ✅ **Leer `BRIEF.md` siempre que dudes** del modelo de datos, reglas de negocio o stack.
- ✅ **Mantener `PROGRESS.md` actualizado** después de cada cambio importante. Es la única fuente de verdad de qué se hizo.
- ✅ **Preguntar a Rafael** si hay decisiones técnicas no cubiertas en el brief (ej. nombres de archivos existentes, convenciones del proyecto).
- ❌ **NO inventar** estructuras de datos, columnas o endpoints que no estén en el brief.
- ❌ **NO modificar archivos del trial existente** sin confirmar con Rafael — MediFlow ya está en producción interna.
- ❌ **NO ejecutar migraciones destructivas** sin avisar primero.

### Stack del proyecto (resumen)

- **Frontend:** Next.js 14 App Router + TypeScript + Tailwind + lucide-react
- **Backend:** Next.js API Routes + Server Actions + Prisma 5.22
- **DB:** Supabase PostgreSQL (RLS deny-all, PgBouncer en :6543)
- **Auth:** Supabase Auth (cookie httpOnly, 30 días)
- **Pagos:** Stripe + PayPal + SPEI manual
- **CFDI:** FacturAPI
- **Notificaciones:** Twilio (WhatsApp/SMS) + Postmark (email)
- **Crons:** Vercel Cron

Más detalles en `BRIEF.md` sección 0.

---

## Estado actual del proyecto

Ver `PROGRESS.md` para conocer qué sprint sigue.

---

## Estructura de los archivos

```
.
├── START_HERE.md                ← este archivo (léelo primero siempre)
├── PROGRESS.md                  ← estado actual del proyecto (mantenlo actualizado)
├── BRIEF.md                     ← contexto técnico completo (consulta cuando tengas dudas)
├── mediflow_marketplace.jsx     ← prototipo visual de referencia
├── prompts/
│   └── PROMPT_INICIAL.md        ← el único prompt que Rafael te manda al iniciar
└── sprints/
    ├── SPRINT_1_FOUNDATION.md       ← BD, schema, seeds, access control
    ├── SPRINT_2_MARKETPLACE_UI.md   ← componentes y página del marketplace
    ├── SPRINT_3_CHECKOUT_PAYMENTS.md ← carrito, Stripe, PayPal, SPEI, CFDI
    ├── SPRINT_4_TRIAL_LOCKDOWN.md   ← banners, expiry, bloqueos
    ├── SPRINT_5_CRONS_NOTIFICATIONS.md ← Vercel crons + Postmark + Twilio
    └── SPRINT_6_QA_POLISH.md        ← tests, auditoría, QA final
```

---

## Si te pierdes

Si en algún punto no sabes qué hacer:

1. Relee `PROGRESS.md` para saber dónde estabas.
2. Relee el sprint actual en `sprints/SPRINT_N.md`.
3. Consulta `BRIEF.md` para detalles técnicos.
4. Pregúntale a Rafael directamente — él prefiere preguntas explícitas a suposiciones.

---

**Vamos a empezar.** Lee `PROGRESS.md` ahora.
