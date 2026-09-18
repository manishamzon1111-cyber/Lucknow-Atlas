import * as cheerio from "cheerio";
import { PRIORITY } from "./config.js";
import { clean, parseDMY, toISO } from "./utils.js";

const UA = { "User-Agent": "LucknowAtlas/1.0 (+https://lucknow-atlas.vercel.app)" };

const FEED = "https://lucknow.nic.in/whats-new/whats-new/feed/";

const TABLE_PAGES = [
  "https://lucknow.nic.in/past-notices/announcements/",
  "https://lucknow.nic.in/past-notices/notices/"
];

async function fetchFeed() {
  const res = await fetch(FEED, { headers: UA });
  if (!res.ok) throw new Error(`Lucknow NIC feed HTTP ${res.status}`);
  const $ = cheerio.load(await res.text(), { xmlMode: true });
  const out = [];
  $("item").each((_, el) => {
    const title = clean($(el).find("title").first().text());
    const link = clean($(el).find("link").first().text());
    const publishedAt = toISO($(el).find("pubDate").first().text());
    if (!title || title.length < 8 || !link || !publishedAt) return;
    out.push({
      title,
      description: "",
      source: "Lucknow District Administration",
      sourceUrl: link,
      sourcePriority: PRIORITY.LUCKNOW_NIC,
      publishedAt,
      eventStart: null,
      eventEnd: null
    });
  });
  return out;
}

async function fetchTable(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Lucknow NIC HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
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
  const results = await Promise.allSettled([
    fetchFeed(),
    ...TABLE_PAGES.map(fetchTable)
  ]);
  const items = results.flatMap(r => (r.status === "fulfilled" ? r.value : []));
  if (!items.length) {
    const errs = results.filter(r => r.status === "rejected").map(r => r.reason?.message);
    throw new Error("Lucknow NIC returned no dated candidates " + errs.join(" | "));
  }
  return items;
}
