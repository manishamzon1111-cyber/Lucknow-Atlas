export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, category, location, details, source, honeypot } = req.body || {};

  if (honeypot) {
    return res.status(200).json({ ok: true });
  }

  if (!name || !location) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const title = `Place suggestion: ${name}`;
  const body = [
    "## Suggested feature / location / place",
    "",
    `**Name:** ${name}`,
    `**Category:** ${category || "Not sure"}`,
    `**Location / Maps link:** ${location}`,
    "",
    "## Why it should be included",
    "",
    details || "Not provided",
    "",
    "## Source / photo",
    "",
    source || "Not provided",
    "",
    "---",
    "Submitted through the Lucknow Atlas suggestion form.",
  ].join("\n");

  try {
    const ghRes = await fetch(
      "https://api.github.com/repos/manishamzon1111-cyber/Lucknow-Atlas/issues",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body, labels: ["suggestion"] }),
      }
    );

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      console.error("GitHub API error:", errText);
      return res.status(502).json({ error: "Failed to create issue" });
    }

    const issue = await ghRes.json();
    return res.status(200).json({ ok: true, url: issue.html_url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
