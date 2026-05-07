// Verifica que los 3 mensajes WhatsApp se hayan sembrado para Gabriela.
// Uso: $env:DATABASE_URL = "..."; npx tsx scripts/verify-whatsapp-seed.mts

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const threads = await db.inboxThread.findMany({
    where: {
      channel: "WHATSAPP",
      patient: { patientNumber: "ORT-DEMO-GABY" },
    },
    include: { messages: { orderBy: { sentAt: "asc" } } },
  });
  console.log("Threads encontrados:", threads.length);
  for (const t of threads) {
    console.log(`\nThread ${t.id} · lastMessageAt=${t.lastMessageAt.toISOString()}`);
    console.log(`  status=${t.status} channel=${t.channel} subject="${t.subject}"`);
    for (const m of t.messages) {
      console.log(
        `  - [${m.direction}] ${m.sentAt.toISOString()} :: ${m.body.slice(0, 80)}`,
      );
    }
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
