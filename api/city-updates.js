const NEWS_QUERIES = [
  '"Lucknow" "heritage walk"',
  '"Lucknow" exhibition museum',
  '"Lucknow" cultural festival',
  '"Lucknow" book festival',
  '"Lucknow" monument closure',
  '"Lucknow" monument restoration',
  '"Lucknow" traffic diversion',
  '"Lucknow" visitor timing monument',
  '"State Museum Lucknow"',
  '"Bhatkhande" Lucknow event',
  '"Sanatkada" Lucknow',
  '"Tornos" Lucknow heritage',
  '"UP Tourism" Lucknow event',
  '"INTACH" Lucknow heritage',
  '"Rumi Darwaza" Lucknow',
  '"Bara Imambara" Lucknow',
  '"Chota Imambara" Lucknow',
  '"British Residency" Lucknow'
];

const DIRECT_SOURCES = [
  {
    name: "Lucknow District Administration",
    url: "https://lucknow.nic.in/past-notices/notices/",
    mode: "district"
  },
  {
    name: "Bhatkhande Sanskriti Vishwavidyalaya",
    url: "https://www.bhatkhandeuniversity.ac.in/en/feature/notices-announcements",
    mode: "bhatkhande"
  },
  {
    name: "Bhatkhande Sanskriti Vishwavidyalaya",
    url: "https://www.bhatkhandeuniversity.ac.in/en/pressrelease",
    mode: "bhatkhande"
  }
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
  "renovation",
  "conservation",
  "restricted access",
  "traffic diversion",
  "route diversion",
  "route diverted",
  "timing change",
  "cultural programme",
  "cultural program",
  "concert",
  "theatre",
  "samaroh",
  "book fair",
  "book festival",
  "heritage"
];

const BLOCK = [
  "special train",
  "special trains",
  "railway",
  "recruitment",
  "vacancy",
  "job fair",
  "rojgar",
  "appointment",
  "admission",
  "counselling",
  "examination",
  "exam",
  "result",
  "hostel",
  "semester",
  "tender",
  "quotation",
  "election",
  "political",
  "murder",
  "crime",
  "arrest",
  "robbery",
  "brunch",
  "staycation",
  "restaurant offer",
  "hotel offer",
  "raksha bandhan",
  "rakhi",
  "sports meet",
  "sports competition",
  "tournament"
];

const GEO = [
  "lucknow",
  "gomti",
  "hazratganj",
  "aminabad",
  "chowk",
  "kaiserbagh",
  "qaiserbagh",
  "rumi darwaza",
  "bara imambara",
  "bada imambara",
  "chota imambara",
  "chhota imambara",
  "british residency",
  "lucknow residency",
  "state museum",
  "bhatkhande",
  "sanatkada"
];

function decode(s=""){
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(s=""){
  return decode(String(s))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text, arr){
  const t = norm(text);
  return arr.some(x => t.includes(norm(x)));
}

function relevant(title){
  return (
    containsAny(title, GEO) &&
    containsAny(title, ALLOW) &&
    !containsAny(title, BLOCK)
  );
}

function typeFor(title){
  const t = norm(title);

  if(t.includes("heritage walk")) return "heritage_walk";
  if(t.includes("exhibition")) return "exhibition";

  if(
    t.includes("closure") ||
    t.includes("closed") ||
    t.includes("diversion") ||
    t.includes("restricted access") ||
    t.includes("timing change")
  ) return "closure";

  if(
    t.includes("festival") ||
    t.includes("mahotsav") ||
    t.includes("samaroh")
  ) return "festival";

  return "notice";
}

function topicKey(title){
  const t = norm(title);

  const known = [
    ["gomti book festival", "gomti-book-festival"],
    ["sanatkada", "sanatkada"],
    ["state museum", "state-museum"],
    ["rumi darwaza", "rumi-darwaza"],
    ["bara imambara", "bara-imambara"],
    ["bada imambara", "bara-imambara"],
    ["chota imambara", "chota-imambara"],
    ["chhota imambara", "chota-imambara"],
    ["british residency", "british-residency"],
    ["lucknow residency", "british-residency"],
    ["bhatkhande", "bhatkhande"]
  ];

  for(const [needle,key] of known){
    if(t.includes(needle)) return key;
  }

  return t
    .split(" ")
    .filter(Boolean)
    .filter(w => ![
      "lucknow","news","today","latest","the","a","an",
      "in","at","on","for","to","of","and","with",
      "from","says","event"
    ].includes(w))
    .slice(0,7)
    .join("-");
}

function cleanTitle(title){
  return decode(title).replace(/\s+-\s+[^-]+$/, "").trim();
}

function xmlField(xml, name){
  const m = xml.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i")
  );
  return m ? decode(m[1]) : "";
}

function parseRSS(xml){
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => {
    const body = m[1];
    return {
      title: xmlField(body, "title"),
      url: xmlField(body, "link"),
      published: xmlField(body, "pubDate"),
      source: xmlField(body, "source")
    };
  });
}

async function fetchText(url){
  const r = await fetch(url, {
    headers: {
      "User-Agent": "LucknowAtlas/1.0",
      "Accept": "text/html,application/xml,*/*"
    }
  });

  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

async function newsQuery(query){
  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query + " when:14d") +
    "&hl=en-IN&gl=IN&ceid=IN:en";

  return parseRSS(await fetchText(url));
}

function directCandidates(html, source){
  const out = [];
  const currentYear = new Date().getFullYear();

  const anchors = [...html.matchAll(
    /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  )];

  for(const m of anchors){
    const href = m[1];
    const title = decode(m[2]);

    if(title.length < 8) continue;

    // Never turn an obviously old official notice into a "current" update.
    const years = [...title.matchAll(/\b(20\d{2})\b/g)]
      .map(x => Number(x[1]));

    if(years.length && Math.max(...years) < currentYear) continue;
    if(!containsAny(title, ALLOW)) continue;
    if(containsAny(title, BLOCK)) continue;

    if(source.mode === "district" && !containsAny(title, [
      "event","heritage","festival","museum","monument",
      "closure","traffic","tourism","cultural"
    ])) continue;

    if(source.mode === "bhatkhande" && !containsAny(title, [
      "event","festival","concert","cultural","exhibition",
      "performance","workshop","seminar","samaroh"
    ])) continue;

    let url;

    try{
      url = new URL(href, source.url).href;
    }catch{
      continue;
    }

    out.push({
      title,
      url,
      published: "",
      source: source.name,
      direct: true
    });
  }

  return out.slice(0,20);
}

async function directSource(source){
  return directCandidates(await fetchText(source.url), source);
}

function buildUpdate(article){
  const title = cleanTitle(article.title);
  const pub = Date.parse(article.published);

  const start = Number.isFinite(pub)
    ? new Date(pub)
    : new Date();

  const end = new Date(
    start.getTime() + 72 * 60 * 60 * 1000
  );

  return {
    id: `auto-${topicKey(title)}`,
    type: typeFor(title),
    title,
    description: "",
    siteId: "",
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    auto: true,
    source: {
      name: article.source || "Source",
      url: article.url
    }
  };
}

export default async function handler(req, res){
  try{
    const jobs = [
      ...DIRECT_SOURCES.map(source => directSource(source)),
      ...NEWS_QUERIES.map(query => newsQuery(query))
    ];

    const settled = await Promise.allSettled(jobs);

    let rows = [];

    for(const result of settled){
      if(result.status === "fulfilled"){
        rows.push(...result.value);
      }
    }

    const now = Date.now();
    const maxAge = 14 * 24 * 60 * 60 * 1000;

    rows = rows.filter(item => {
      if(!relevant(item.title)) return false;

      if(item.direct) return true;

      const d = Date.parse(item.published);

      return (
        Number.isFinite(d) &&
        now - d <= maxAge
      );
    });

    rows.sort((a,b) => {
      if(a.direct !== b.direct){
        return a.direct ? -1 : 1;
      }

      return (
        (Date.parse(b.published) || 0) -
        (Date.parse(a.published) || 0)
      );
    });

    const seenTopics = new Set();
    const output = [];
    const typeCounts = {};

    for(const row of rows){
      const key = topicKey(row.title);

      if(!key || seenTopics.has(key)) continue;

      const type = typeFor(row.title);

      if((typeCounts[type] || 0) >= 2) continue;

      seenTopics.add(key);
      typeCounts[type] = (typeCounts[type] || 0) + 1;

      const update = buildUpdate(row);

      // API must never return already-expired generated updates.
      if(Date.parse(update.endDate) <= Date.now()) continue;

      output.push(update);

      if(output.length >= 6) break;
    }

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=21600, stale-while-revalidate=43200"
    );

    res.status(200).json(output);

  }catch(error){
    console.error(error);
    res.status(200).json([]);
  }
}
