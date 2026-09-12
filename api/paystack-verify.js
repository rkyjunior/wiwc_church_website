const admin = require("firebase-admin");

// Reuse the same service-account key you set for the reset function.
if (!admin.apps.length) {
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  admin.initializeApp({ credential: admin.credential.cert(svc) });
}

/**
 * POST /api/paystack-verify   Body: { "reference": "<paystack ref>" }
 *
 * Verifies a Paystack transaction server-side (using the SECRET key, which
 * never touches the browser) and records a successful gift into the `giving`
 * collection. Uses the reference as the document ID, so a repeated call for the
 * same payment updates the same record instead of creating a duplicate.
 */
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const reference = (body.reference || "").toString().trim();
    if (!reference) { res.status(400).json({ error: "No reference supplied." }); return; }

    const secret = process.env.PAYSTACK_SECRET_KEY || "";
    if (!secret) { res.status(500).json({ error: "Server is missing PAYSTACK_SECRET_KEY." }); return; }

    const r = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
      headers: { Authorization: "Bearer " + secret }
    });
    const j = await r.json();

    if (!(j && j.status && j.data && j.data.status === "success")) {
      res.status(400).json({ error: "Payment was not successful." });
      return;
    }

    const d = j.data;
    const amount = (d.amount || 0) / 100;
    const meta = d.metadata || {};
    const category = meta.category || "Offering";
    const name = meta.giver_name || meta.name || "";

    await admin.firestore().collection("giving").doc(reference).set({
      date: (d.paid_at ? new Date(d.paid_at) : new Date()).toISOString().slice(0, 10),
      category: category,
      amount: amount,
      method: "Mobile Money (online)",
      memberId: "",
      memberName: name,
      email: (d.customer && d.customer.email) || "",
      notes: "Online gift via Paystack",
      source: "website",
      reference: reference,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({ ok: true, amount: amount, category: category });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || "Verification failed." });
  }
};
