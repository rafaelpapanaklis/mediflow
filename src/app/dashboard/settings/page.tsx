export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { SettingsClient } from "./settings-client";
export default async function SettingsPage() {
  const user = await getCurrentUser();
  return <SettingsClient user={user as any} clinic={user.clinic as any} />;
}
