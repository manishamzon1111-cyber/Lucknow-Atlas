const QUERIES = [
  '"Lucknow" "heritage walk"',
  '"Lucknow" exhibition',
  '"Lucknow" "book festival"',
  '"Lucknow" cultural festival',
  '"Lucknow" museum exhibition',
  '"Lucknow" monument closure',
  '"Lucknow" traffic diversion',
  '"Rumi Darwaza" Lucknow',
  '"Bara Imambara" Lucknow',
  '"British Residency" Lucknow',
  '"State Museum Lucknow"',
  '"Sanatkada" Lucknow'
];

const ALLOW = [
  "heritage walk",
  "exhibition",
  "festival",
  "mahotsav",
  "museum",
  "monument",
  "closure",
  "closed",
  "restoration",
  "conservation",
  "traffic diversion",
  "route diversion",
  "cultural",
  "book festival",
  "sanatkada"
];

const BLOCK = [
  "special train",
  "special trains",
  "railway",
  "recruitment",
  "vacancy",
  "job fair",
  "rojgar",
  "election",
  "murder",
  "arrest",
  "crime",
  "brunch",
  "staycation",
  "restaurant",
  "hotel offer",
  "raksha bandhan",
  "rakhi",
  "sports meet",
  "tournament"
];

const GEO = [
  "lucknow",
  "gomti",
  "rumi darwaza",
  "bara imambara",
  "bada imambara",
  "chota imambara",
  "chhota imambara",
  "british residency",
  "lucknow residency",
  "state museum"
];

function decodeXML(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function field(xml, name) {
  const m = xml.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i")
  );
  return m ? decodeXML(m[1]) : "";
}

function cleanTitle(title) {
  return title.replace(/\s+-\s+[^-]+$/, "").trim();
}

function typeFor(title) {
  const t = title.toLowerCase();

  if (t.includes("heritage walk")) return "heritage_walk";
  if (t.includes("exhibition")) return "exhibition";

  if (
    t.includes("closed") ||
    t.includes("closure") ||
    t.includes("diversion")
  ) return "closure";

  if (
    t.includes("festival") ||
    t.includes("mahotsav")
  ) return "festival";

  return "notice";
}

function topicKey(title) {
  const t = title.toLowerCase();

  const known = [
    ["gomti book festival", "gomti-book-festival"],
    ["sanatkada", "sanatkada"],
    ["rumi darwaza", "rumi-darwaza"],
    ["bara imambara", "bara-imambara"],
    ["bada imambara", "bara-imambara"],
    ["chota imambara", "chota-imambara"],
    ["chhota imambara", "chota-imambara"],
    ["british residency", "british-residency"],
    ["lucknow residency", "british-residency"],
    ["state museum", "state-museum"]
  ];

  for (const [needle, key] of known) {
    if (t.includes(needle)) return key;
  }

  return t
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => ![
      "lucknow","news","the","a","an","in","at","on","for",
      "of","to","and","with","from","says"
    ].includes(w))
    .slice(0, 7)
    .join("-");
}

function relevant(title) {
  const t = title.toLowerCase();

  if (!GEO.some(x => t.includes(x))) return false;
  if (!ALLOW.some(x => t.includes(x))) return false;
  if (BLOCK.some(x => t.includes(x))) return false;

  return true;
}

function parseRSS(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map(m => {
      const body = m[1];

      return {
        title: field(body, "title"),
        url: field(body, "link"),
        published: field(body, "pubDate"),
        source: field(body, "source")
      };
    });
}

async function fetchQuery(query) {
  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query + " when:7d") +
    "&hl=en-IN&gl=IN&ceid=IN:en";

  const r = await fetch(url, {
    headers: {
      "User-Agent": "LucknowAtlas/1.0"
    }
  });

  if (!r.ok) {
    throw new Error(`Google News ${r.status}`);
  }

  return parseRSS(await r.text());
}

export default async function handler(req, res) {
  try {
    const settled = await Promise.allSettled(
      QUERIES.map(fetchQuery)
    );

    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;

    let articles = [];

    for (const result of settled) {
      if (result.status === "fulfilled") {
        articles.push(...result.value);
      }
    }

    articles = articles.filter(article => {
      const date = Date.parse(article.published);

      return (
        Number.isFinite(date) &&
        now - date <= maxAge &&
        relevant(article.title)
      );
    });

    articles.sort(
      (a, b) =>
        Date.parse(b.published) -
        Date.parse(a.published)
    );

    const seen = new Set();
    const output = [];

    for (const article of articles) {
      const title = cleanTitle(article.title);
      const key = topicKey(title);

      if (!key || seen.has(key)) continue;
      seen.add(key);

      const published = new Date(article.published);
      const expires = new Date(
        published.getTime() + 72 * 60 * 60 * 1000
      );

      output.push({
        id: `auto-${key}`,
        type: typeFor(title),
        title,
        description: "",
        siteId: "",
        startDate: published.toISOString(),
        endDate: expires.toISOString(),
        publishedAt: published.toISOString(),
        auto: true,
        source: {
          name: article.source || "News source",
          url: article.url
        }
      });

      if (output.length >= 6) break;
    }

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=21600, stale-while-revalidate=43200"
    );

    res.status(200).json(output);

  } catch (error) {
    console.error(error);
    res.status(200).json([]);
  }
}
