export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string
) {
  const phone = to.replace(/[\s\-\(\)]/g, "");
  const formattedPhone = phone.startsWith("+") ? phone.slice(1) : phone.startsWith("52") ? phone : `52${phone}`;

  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: formattedPhone,
      type: "text",
      text: { body: message },
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message ?? "Error al enviar mensaje");
  }
  return await res.json();
}
