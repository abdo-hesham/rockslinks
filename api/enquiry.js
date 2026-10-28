/* Quote form -> sales inbox, through Resend (resend.com).

   Vercel runs this as a serverless function at /api/enquiry. Settings, in
   the Vercel project (Settings -> Environment Variables):

     RESEND_API_KEY   the Resend API key (required)
     ENQUIRY_FROM     the sender, on a domain verified in Resend, e.g.
                      "Rockslink website <website@rockslink.com>"
     ENQUIRY_TO       where enquiries go (default sales@rockslink.com)

   Without RESEND_API_KEY it answers 503 "not_configured", and the page
   falls back to its backup form service (data-fallback on the form). */

const TO = process.env.ENQUIRY_TO || "sales@rockslink.com";
const FROM = process.env.ENQUIRY_FROM || "Rockslink website <website@rockslink.com>";

// the form's fields, with the longest value each may have
const FIELDS = {
  name: 120, company: 160, phone: 40, email: 200,
  service: 60, origin: 120, destination: 120, cargo: 3000,
};
const REQUIRED = ["name", "phone", "service", "cargo"];
const LABELS = {
  name: "Name", company: "Company", phone: "Phone", email: "Email",
  service: "Service", origin: "From", destination: "To", cargo: "Cargo details",
};

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const oneLine = (s) => s.replace(/[\r\n]+/g, " ");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ ok: false, error: "not_configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "bad_request" });
  }
  // honeypot: people never see this field, bots fill it
  if (body.website) return res.status(200).json({ ok: true });

  const d = {};
  for (const [key, max] of Object.entries(FIELDS)) {
    d[key] = typeof body[key] === "string" ? body[key].trim().slice(0, max) : "";
  }
  const missing = REQUIRED.filter((k) => !d[k]);
  if (missing.length) return res.status(400).json({ ok: false, error: "missing_fields", fields: missing });
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
    return res.status(400).json({ ok: false, error: "bad_email" });
  }

  const rows = Object.keys(FIELDS).filter((k) => d[k]);
  const text = ["New shipment enquiry from rockslink.com", "", ...rows.map((k) => `${LABELS[k]}: ${d[k]}`)].join("\n");
  const html =
    `<h2 style="font:600 18px sans-serif;color:#152333">New shipment enquiry</h2>` +
    `<table cellpadding="8" style="border-collapse:collapse;font:14px sans-serif;color:#152333">` +
    rows.map((k) => `<tr><th align="left" style="border-bottom:1px solid #e3e7eb;vertical-align:top">${LABELS[k]}</th>` +
      `<td style="border-bottom:1px solid #e3e7eb;white-space:pre-wrap">${esc(d[k])}</td></tr>`).join("") +
    `</table>`;

  const mail = {
    from: FROM,
    to: [TO],
    subject: oneLine(`Shipment enquiry: ${d.service} from ${d.name}${d.company ? ` (${d.company})` : ""}`),
    text,
    html,
  };
  if (d.email) mail.reply_to = d.email;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(mail),
    });
    if (!r.ok) {
      console.error("Resend refused the enquiry:", r.status, await r.text());
      return res.status(502).json({ ok: false, error: "send_failed" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Resend could not be reached:", err);
    return res.status(502).json({ ok: false, error: "send_failed" });
  }
};
