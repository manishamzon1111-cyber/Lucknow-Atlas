import * as cheerio from "cheerio";
import { PRIORITY } from "./config.js";
import { clean, parseDMY } from "./utils.js";

const SOURCES = [
  "https://lucknow.nic.in/whats-new/whats-new/",
  "https://lucknow.nic.in/past-notices/announcements/",
  "https://lucknow.nic.in/past-notices/notices/"
];

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "LucknowAtlas/1.0 (+https://lucknow-atlas.vercel.app)" }
  });
  if (!response.ok) throw new Error(`Lucknow NIC HTTP ${response.status}`);

  const $ = cheerio.load(await response.text());
  const out = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;

    const title = clean(cells.eq(0).text());
    const publishedAt = parseDMY(cells.eq(2).text());
    const href =
      $(row).find("a.pdf-download-link").first().attr("href") ||
      $(row).find("a[href]").first().attr("href");

    if (!title || title.length < 8 || !publishedAt || !href) return;

    let sourceUrl;
    try { sourceUrl = new URL(href, url).href; } catch { return; }

    out.push({
      title,
      description: "",
      source: "Lucknow District Administration",
      sourceUrl,
      sourcePriority: PRIORITY.LUCKNOW_NIC,
      publishedAt,
      eventStart: null,
      eventEnd: null
    });
  });

  return out;
}

export async function fetchLucknowNic() {
  const results = await Promise.allSettled(SOURCES.map(fetchPage));
  const items = results.flatMap(r => (r.status === "fulfilled" ? r.value : []));
  if (!items.length) throw new Error("Lucknow NIC returned no dated candidates");
  return items;
}
