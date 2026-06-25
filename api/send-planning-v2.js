// api/send-planning-v2.js
// Vercele serverless function — envoi via Brevo (ex-Sendinblue)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, name, weekLabel, days } = req.body;
  if (!to || !name || !weekLabel || !days) {
    return res.status(400).json({ error: "Paramètres manquants" });
  }

  // Build HTML email
  const rowsHtml = days.map(d => {
    const isOff = !d.hours || d.hours === 0;
    return `
      <tr style="border-bottom:1px solid #1E3048;">
        <td style="padding:10px 16px;color:#6B8299;font-weight:600;width:110px;">${d.day}</td>
        <td style="padding:10px 16px;color:#6B8299;font-size:12px;">${d.date}</td>
        <td style="padding:10px 16px;">
          ${isOff
            ? `<span style="color:#3A5570;font-style:italic;">Repos / Absent</span>`
            : `<span style="color:#00C896;font-weight:600;">${d.blocks}</span>`
          }
        </td>
        <td style="padding:10px 16px;text-align:right;color:${isOff ? '#3A5570' : '#00C896'};font-weight:700;">
          ${isOff ? '—' : `${d.hours}h`}
        </td>
      </tr>`;
  }).join("");

  const totalHours = days.reduce((a, d) => a + (d.hours || 0), 0);

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Votre planning</title></head>
<body style="margin:0;padding:0;background:#0F1923;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:28px;">
      <h1 style="color:#E8EDF2;font-size:22px;font-weight:800;margin:0 0 4px;">PharmaPlanning</h1>
      <p style="color:#6B8299;font-size:14px;margin:0;">Votre planning personnel</p>
    </div>
    <div style="background:#162232;border:1px solid #1E3048;border-radius:12px;padding:20px 24px;margin-bottom:16px;">
      <p style="color:#E8EDF2;font-size:15px;margin:0 0 4px;">Bonjour <strong>${name}</strong>,</p>
      <p style="color:#6B8299;font-size:13px;margin:0;">Voici votre planning pour la semaine du <strong style="color:#00C896;">${weekLabel}</strong>.</p>
    </div>
    <div style="background:#162232;border:1px solid #1E3048;border-radius:12px;overflow:hidden;margin-bottom:16px;">
      <div style="padding:14px 16px;border-bottom:1px solid #1E3048;display:flex;justify-content:space-between;">
        <span style="color:#E8EDF2;font-weight:700;font-size:14px;">📅 Détail de la semaine</span>
        <span style="color:#00C896;font-weight:700;font-size:14px;">Total : ${totalHours}h</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
    </div>
    <div style="text-align:center;padding:16px;">
      <p style="color:#3A5570;font-size:12px;margin:0;">
        Ce planning a été généré automatiquement par PharmaPlanning.<br>
        Pour toute modification, contactez le manager.
      </p>
    </div>
  </div>
</body>
</html>`;

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "PharmaPlanning", email: "wackenthaler.p@gmail.com" },
        to: [{ email: to, name }],
        subject: `Votre planning — ${weekLabel}`,
        htmlContent: html,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Brevo error:", err);
      return res.status(500).json({ error: `Brevo error: ${err}` });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("Send error:", err);
    return res.status(500).json({ error: err.message });
  }
}
