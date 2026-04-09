export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string
) {
  // Normalize Mexican phone: always output 52 + 10 digits = 12 digits
  let phone = to.replace(/[\s\-\(\)\+]/g, "");
  // Strip country code if present to get raw 10 digits
  if (phone.startsWith("521") && phone.length === 13) phone = phone.slice(3); // 521XXXXXXXXXX → 10 digits (old MX mobile format)
  else if (phone.startsWith("52") && phone.length === 12) phone = phone.slice(2); // 52XXXXXXXXXX → 10 digits
  // Now phone should be 10 digits, add country code
  if (phone.length === 10) phone = `52${phone}`;
  const formattedPhone = phone;

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
