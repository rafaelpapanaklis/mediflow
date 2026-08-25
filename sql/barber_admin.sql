-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — bitácora de acciones MANUALES del panel de admin.
--
-- Qué guarda: cada vez que alguien de DaleControl suspende, reactiva o
-- mueve el plan de una barbería DESDE /admin/barberias, con la nota
-- obligatoria de por qué, quién lo hizo y el antes/después. Es lo que hace
-- auditable una palanca que se mueve a mano.
--
-- POR QUÉ VIVE AQUÍ Y NO EN prisma/schema.prisma
--   El contrato de la terminal [Barber Admin DC] prohíbe tocar
--   prisma/schema.prisma (archivo COMPARTIDO con el dental, que está vivo
--   en producción). El módulo la lee y la escribe con SQL parametrizado
--   ($queryRaw / $executeRaw) en src/lib/barber/admin.ts.
--
-- ⚠️ CONSECUENCIA A TENER PRESENTE: al no estar en el schema, un
--    `prisma db push` la BORRA (mismo caso que barber_payment_settings).
--    Si algún día se decide meterla al schema, el modelo equivalente es:
--      model BarberAdminAction { ... @@map("barber_admin_actions") }
--
-- MIENTRAS ESTE ARCHIVO NO SE APLIQUE: las acciones manuales SIGUEN
-- funcionando (la nota se sigue exigiendo y el detalle se emite al log del
-- servidor), pero la ficha muestra un aviso de que no quedan registradas.
--
-- Idempotente: se puede correr las veces que haga falta.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS barber_admin_actions (
  id             text        PRIMARY KEY,
  barbershop_id  text        NOT NULL REFERENCES barber_shops(id) ON DELETE CASCADE,
  -- SUSPEND | REACTIVATE | PLAN_CHANGE
  action         text        NOT NULL,
  -- Obligatoria: el server rechaza la acción sin ella (mín. 8 caracteres).
  note           text        NOT NULL,
  before_value   text,
  after_value    text,
  -- admin_users.id, SIN FK a propósito: la bitácora no se acopla al panel
  -- y borrar un admin no la rompe (mismo criterio que audit_logs.actorAdminId).
  actor_admin_id text,
  actor_email    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- La ficha de una barbería pide sus últimas acciones en orden inverso.
CREATE INDEX IF NOT EXISTS barber_admin_actions_shop_idx
  ON barber_admin_actions (barbershop_id, created_at DESC);

-- Barrido global por fecha (si algún día se lista la bitácora completa).
CREATE INDEX IF NOT EXISTS barber_admin_actions_created_idx
  ON barber_admin_actions (created_at DESC);

COMMENT ON TABLE barber_admin_actions IS
  'Acciones manuales de DaleControl sobre una barbería (suspender, reactivar, cambiar plan) con nota obligatoria. La escribe src/lib/barber/admin.ts.';
