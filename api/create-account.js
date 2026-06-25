// api/create-account.js
// Crée un compte Supabase Auth pour un salarié (nécessite SUPABASE_SERVICE_KEY)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, firstName, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis" });

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const SB_URL = process.env.SUPABASE_URL || "https://fqbitotkkmuglicyusoa.supabase.co";

  if (!SERVICE_KEY) return res.status(500).json({ error: "SUPABASE_SERVICE_KEY non configurée" });

  try {
    const response = await fetch(`${SB_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // auto-confirm email
        user_metadata: { firstName },
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      // If user already exists, return success anyway
      if (err.message?.includes("already")) {
        return res.status(200).json({ success: true, existing: true });
      }
      return res.status(400).json({ error: err.message || "Erreur création compte" });
    }

    const data = await response.json();
    return res.status(200).json({ success: true, userId: data.id });

  } catch (err) {
    console.error("Create account error:", err);
    return res.status(500).json({ error: err.message });
  }
}
