# 🩺 MediFlow Marketplace — Paquete completo de implementación

> Paquete listo para entregar a Claude Code y construir el sistema de Marketplace de Módulos de MediFlow de principio a fin.

---

## 📦 Cómo usar este paquete

### Paso 1: Descomprime el ZIP en tu repo de MediFlow

Idealmente en una carpeta como `/docs/marketplace/` o en la raíz como `/.claude-code/marketplace/`.

### Paso 2: Abre Claude Code en tu repo

(`claude-code` en terminal o desde VS Code/JetBrains).

### Paso 3: Pega ESTE prompt

Abre `prompts/PROMPT_INICIAL.md` y copia el bloque marcado. O directamente, pega esto:

```
Hola Claude Code. Voy a implementar el sistema de Marketplace de Módulos
para MediFlow (mi SaaS médico en Next.js 14 + Prisma + Supabase).

Toda la información está en los archivos de este paquete. Tu protocolo
de trabajo es:

1. Lee START_HERE.md PRIMERO. Es tu manual de operación.
2. Lee PROGRESS.md para saber en qué sprint estamos.
3. Lee BRIEF.md para entender el contexto técnico completo.
4. Abre el archivo del sprint actual (sprints/SPRINT_N.md) y ejecútalo
   completo siguiendo todas las reglas de START_HERE.md.
5. Al terminar el sprint, actualiza PROGRESS.md con lo que hiciste y
   DETÉNTE para que yo valide.
6. Cuando yo te diga "continúa", retomarás desde PROGRESS.md.

Reglas importantes:
- UN sprint a la vez. No combines sprints.
- Si dudas de algo, consulta BRIEF.md antes de inventar.
- Si encuentras decisiones que requieren mi input, agrégalas a la
  sección "Decisiones pendientes para Rafael" de PROGRESS.md y
  pregúntame antes de continuar.
- NO modifiques archivos existentes de MediFlow sin avisarme primero.

Empieza ahora leyendo START_HERE.md y PROGRESS.md, luego procede con
el primer sprint pendiente.
```

### Paso 4: Para los siguientes sprints, solo manda este prompt corto

```
Continúa con el siguiente sprint según PROGRESS.md.
```

Eso es todo. Claude Code va a leer `PROGRESS.md`, ver qué está pendiente y arrancar con el siguiente sprint.

---

## 📋 Qué hay en este paquete

```
mediflow_marketplace_package/
│
├── README.md                          ← este archivo (léelo tú)
├── START_HERE.md                      ← manual de Claude Code
├── PROGRESS.md                        ← estado del proyecto (Claude Code lo actualiza)
├── BRIEF.md                           ← contexto técnico completo (~26 KB)
├── mediflow_marketplace.jsx           ← prototipo visual de referencia (~71 KB)
│
├── prompts/
│   └── PROMPT_INICIAL.md              ← el prompt que copias y pegas
│
└── sprints/
    ├── SPRINT_1_FOUNDATION.md         ← BD, schema, seeds, access control
    ├── SPRINT_2_MARKETPLACE_UI.md     ← componentes y página del marketplace
    ├── SPRINT_3_CHECKOUT_PAYMENTS.md  ← carrito, Stripe, PayPal, SPEI, CFDI
    ├── SPRINT_4_TRIAL_LOCKDOWN.md     ← banners, expiry, bloqueos
    ├── SPRINT_5_CRONS_NOTIFICATIONS.md ← Vercel crons + Postmark + Twilio
    └── SPRINT_6_QA_POLISH.md          ← tests, auditoría, QA final
```

---

## 🎯 ¿Qué se va a construir?

Un marketplace dentro de MediFlow donde las clínicas:

1. **Empiezan con 14 días de prueba** automáticos al registrarse, con acceso completo a TODOS los módulos sin tarjeta.
2. **Compran módulos individuales** (Ortodoncia, Cardiología, Pediatría, etc.) por suscripción mensual o anual.
3. **Reciben descuentos por volumen** (10% en 3+, 15% en 5+, 25% en 10+ módulos).
4. **Pagan con tarjeta, PayPal o SPEI** y reciben CFDI 4.0 automático.
5. **Si no compran nada** al expirar el trial, el panel se bloquea y se les muestra una pantalla con sus stats de uso + recomendaciones inteligentes.

---

## ⏱️ Tiempo estimado total

Aproximadamente **10–14 días de trabajo** en sprints de 1–4 días cada uno. Puedes hacer pausas entre sprints sin problema.

---

## ⚠️ Cosas importantes a saber antes de empezar

- ✅ **Claude Code va a hacer pausas naturales** entre sprints para que valides cada uno antes de continuar.
- ✅ **Si Claude Code se pierde o cierras la sesión**, simplemente abre nueva sesión y manda otra vez el prompt inicial. `PROGRESS.md` mantiene el contexto.
- ✅ **Sprint 3 (pagos) es el más delicado.** Pruébalo bien en sandbox antes de pasar a Sprint 4.
- ⚠️ **El prototipo JSX tiene un slider para simular días del trial** que es solo para preview. Claude Code sabe que eso NO se migra al código real.
- ⚠️ **Revisar que no haya conflictos** con código existente de MediFlow. Si Claude Code encuentra que algo ya existe (ej. integración Stripe previa), te va a preguntar antes de crear duplicados.

---

## 🆘 Si algo sale mal

Mándale a Claude Code:

```
Algo salió mal. Revisa PROGRESS.md y la bitácora de cambios.
Revierte lo que hiciste en el último sprint (Sprint N) y márcalo
como TODO de nuevo.
```

---

## 📝 Después de terminar todo

Cuando Sprint 6 esté ✅ DONE:

1. `PROGRESS.md` tendrá un resumen ejecutivo completo del proyecto
2. Tendrás documentación en `docs/marketplace.md` (que Claude Code crea en Sprint 6)
3. Estarás listo para activar el marketplace en producción

---

¡Buena suerte, Rafael! Si necesitas ajustes a los sprints o quieres iterar el diseño visual, vuelve al chat con Claude (yo) y lo ajustamos juntos antes de pasar el paquete actualizado a Claude Code.
