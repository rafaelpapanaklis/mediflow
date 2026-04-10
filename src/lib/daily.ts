const DAILY_API = "https://api.daily.co/v1";

function getApiKey() {
  const key = process.env.DAILY_API_KEY;
  if (!key) throw new Error("DAILY_API_KEY not configured");
  return key;
}

export async function createRoom(appointmentId: string, expiresAt: Date): Promise<{ id: string; url: string }> {
  const roomName = appointmentId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
  const res = await fetch(`${DAILY_API}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getApiKey()}` },
    body: JSON.stringify({
      name: roomName,
      properties: {
        exp: Math.floor(expiresAt.getTime() / 1000),
        max_participants: 2,
        enable_chat: true,
        enable_screenshare: true,
        enable_recording: "cloud",
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("Daily.co createRoom error:", err);
    throw new Error("Error creating video room");
  }
  const room = await res.json();
  return { id: room.id, url: room.url };
}

export async function createMeetingToken(roomName: string, isOwner: boolean, userName: string): Promise<string> {
  const res = await fetch(`${DAILY_API}/meeting-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getApiKey()}` },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        is_owner: isOwner,
        user_name: userName,
        exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("Daily.co createMeetingToken error:", err);
    throw new Error("Error creating meeting token");
  }
  const data = await res.json();
  return data.token;
}

export async function deleteRoom(roomName: string): Promise<void> {
  const res = await fetch(`${DAILY_API}/rooms/${roomName}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });
  if (!res.ok) {
    console.error("Daily.co deleteRoom error:", res.status);
  }
}
