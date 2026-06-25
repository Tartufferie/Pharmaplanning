// api/send-planning-v2.js — Brevo, multi-semaines, pauses incluses

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, name, weeksData } = req.body;
  if (!to || !name || !weeksData?.length) {
    return res.status(400).json({ error: "Paramètres manquants" });
  }

  // Build one section per week
  const weeksSections = weeksData.map(week => {
    const totalH = week.totalH;
    const rows = week.days.map(d => {
      if (d.isOff) {
        return `
          <tr style="border-bottom:1px solid #1E3048;">
            <td style="padding:9px 14px;color:#6B8299;font-weight:600;font-size:13px;width:100px;">${d.day}</td>
            <td style="padding:9px 14px;color:#3A5570;font-size:12px;">${d.date}</td>
            <td colspan="2" style="padding:9px 14px;color:#3A5570;font-style:italic;font-size:13px;">Repos / Absent</td>
          </tr>`;
      }
      // Work blocks
      const workStr = d.blocks
        .filter(b => b.type === "work")
        .map(b => `${b.from} → ${b.to}`)
        .join(" &nbsp;|&nbsp; ") || "—";
      // Pause blocks
      const pauseStr = d.pauseBlocks?.length
        ? d.pauseBlocks.map(p => `${p.from} → ${p.to}`).join(", ")
        : null;

      return `
        <tr style="border-bottom:1px solid #1E3048;">
          <td style="padding:9px 14px;color:#6B8299;font-weight:600;font-size:13px;width:100px;">${d.day}</td>
          <td style="padding:9px 14px;color:#6B8299;font-size:12px;">${d.date}</td>
          <td style="padding:9px 14px;">
            <div style="color:#00C896;font-weight:600;font-size:13px;">${workStr}</div>
            ${pauseStr ? `<div style="color:#F59E0B;font-size:11px;margin-top:3px;">☕ Pause : ${pauseStr}</div>` : ""}
          </td>
          <td style="padding:9px 14px;text-align:right;">
            <span style="color:#00C896;font-weight:700;font-size:13px;">${d.workH}h</span>
            ${d.pauseH > 0 ? `<br><span style="color:#F59E0B;font-size:11px;">${d.pauseH}h pause</span>` : ""}
          </td>
        </tr>`;
    }).join("");

    return `
      <div style="background:#162232;border:1px solid #1E3048;border-radius:12px;overflow:hidden;margin-bottom:16px;">
        <div style="padding:12px 16px;border-bottom:1px solid #1E3048;display:flex;justify-content:space-between;align-items:center;background:#1a2a3a;">
          <span style="color:#E8EDF2;font-weight:700;font-size:14px;">📅 ${week.weekLabel}</span>
          <span style="color:#00C896;font-weight:700;font-size:14px;">Total : ${totalH}h</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      </div>`;
  }).join("");

  const totalAllWeeks = weeksData.reduce((a, w) => a + w.totalH, 0);

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0F1923;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:28px 16px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#E8EDF2;font-size:22px;font-weight:800;margin:0 0 4px;">PharmaPlanning</h1>
      <p style="color:#6B8299;font-size:14px;margin:0;">Votre planning personnel</p>
    </div>

    <!-- Greeting -->
    <div style="background:#162232;border:1px solid #1E3048;border-radius:12px;padding:18px 22px;margin-bottom:20px;">
      <p style="color:#E8EDF2;font-size:15px;margin:0 0 6px;">Bonjour <strong>${name}</strong>,</p>
      <p style="color:#6B8299;font-size:13px;margin:0;">
        Voici votre planning sur <strong style="color:#00C896;">${weeksData.length} semaine${weeksData.length > 1 ? "s" : ""}</strong>.
        Total : <strong style="color:#00C896;">${totalAllWeeks}h</strong>
      </p>
    </div>

    <!-- Weeks -->
    ${weeksSections}

    <!-- Legend -->
    <div style="background:#162232;border:1px solid #1E3048;border-radius:10px;padding:12px 16px;margin-bottom:16px;">
      <div style="display:flex;gap:20px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="width:10px;height:10px;border-radius:50%;background:#00C896;"></div>
          <span style="color:#6B8299;font-size:12px;">Heures travaillées</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="color:#F59E0B;font-size:13px;">☕</span>
          <span style="color:#6B8299;font-size:12px;">Pause déjeuner</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:12px;">
      <p style="color:#3A5570;font-size:12px;margin:0;">
        Ce planning a été généré automatiquement par PharmaPlanning.<br>
        Pour toute modification, contactez le manager.
      </p>
    </div>
  </div>
</body>
</html>`;

  const subject = weeksData.length === 1
    ? `Votre planning — ${weeksData[0].weekLabel}`
    : `Votre planning — ${weeksData.length} semaines`;

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
        subject,
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
