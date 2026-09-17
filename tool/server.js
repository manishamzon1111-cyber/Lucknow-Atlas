import express from "express";
import sharp from "sharp";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA = path.join(ROOT, "sites.json");
const IMG = path.join(ROOT, "img");
const BACKUPS = path.join(HERE, "backups");
const CONFIG = path.join(HERE, "config.json");
const TXN = path.join(HERE, ".txn.json");
const OWNER = "manishamzon1111-cyber";
const REPO = "Lucknow-Atlas";
const PORT = Number(process.env.ATLAS_TOOL_PORT || 4173);
const USER_AGENT = "LucknowAtlasAdmin/1.0 (local research tool)";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(HERE, "public")));

const clean = (value) => String(value ?? "").trim();
const escRx = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const slugify = (value) =>
  clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
const shortSlug = (value) =>
  slugify(value)
    .split("-")
    .map((part) => part.slice(0, 4))
    .join("")
    .slice(0, 14) || "place";
const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const normalizeEntity = (value) =>
  clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(avadh|oudh)\b/g, "awadh")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const entityTokens = (value) =>
  normalizeEntity(value)
    .split(/\s+/)
    .filter(
      (token) =>
        token &&
        !["lucknow", "uttar", "pradesh", "india", "of", "the", "and"].includes(
          token,
        ),
    );
const acronym = (value) =>
  entityTokens(value)
    .map((token) => token[0])
    .join("");
function entityMatches(query, candidate) {
  const wanted = entityTokens(query);
  const available = new Set(entityTokens(candidate));
  const candidateAcronym = acronym(candidate);
  if (!wanted.length) return false;
  return wanted.every(
    (token) =>
      available.has(token) ||
      (token.length >= 2 &&
        token.length <= 5 &&
        candidateAcronym.startsWith(token)),
  );
}
const distanceMetres = (a, b) => {
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(Number(b.lat) - Number(a.lat));
  const dLng = rad(Number(b.lng) - Number(a.lng));
  const lat1 = rad(Number(a.lat));
  const lat2 = rad(Number(b.lat));
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

function coordinateConsensus(candidates, radius = 250) {
  const valid = candidates.filter(
    (item) =>
      Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)),
  );
  let best = [];
  for (const anchor of valid) {
    const group = valid.filter(
      (item) => distanceMetres(anchor, item) <= radius,
    );
    const providers = new Set(group.map((item) => item.provider));
    if (providers.size > new Set(best.map((item) => item.provider)).size)
      best = group;
  }
  const providers = [...new Set(best.map((item) => item.provider))];
  const preferred =
    best.find((item) => item.provider.startsWith("Google Maps")) ||
    best.find((item) => item.provider === "OpenStreetMap") ||
    best[0] ||
    valid[0];
  return {
    verified: providers.length >= 2,
    providers,
    selected: preferred || null,
    candidates: valid.map((item) => ({
      ...item,
      agrees: preferred ? distanceMetres(preferred, item) <= radius : false,
      distance: preferred ? Math.round(distanceMetres(preferred, item)) : null,
    })),
  };
}

async function fetchOk(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "*/*",
        ...(options.headers || {}),
      },
      redirect: "follow",
    });
    if (!response.ok)
      throw new Error(`${response.status} from ${new URL(url).hostname}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, options) {
  return (await fetchOk(url, options)).json();
}

async function readConfig() {
  const stored = await fs.readFile(CONFIG, "utf8").then(JSON.parse, () => ({}));
  return {
    serperKey: clean(process.env.SERPER_KEY || stored.serperKey),
  };
}

async function writeConfig(input) {
  const current = await readConfig();
  const next = {
    serperKey: clean(input.serperKey) || current.serperKey,
  };
  if (input.clearSerper) next.serperKey = "";
  const temp = `${CONFIG}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await fs.rename(temp, CONFIG);
  return next;
}

async function writeTxn(data) {
  const temp = `${TXN}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, {
    flag: "wx",
  });
  await fs.rename(temp, TXN);
}

async function recoverTransaction() {
  const txn = await fs.readFile(TXN, "utf8").then(JSON.parse, () => null);
  if (!txn) return;
  const sites = await fs.readFile(DATA, "utf8").then(JSON.parse, () => []);
  const committed = sites.some((site) => site.id === txn.id);
  if (!committed) {
    if (txn.finalDir)
      await fs.rm(txn.finalDir, { recursive: true, force: true });
    if (txn.sourceFile) await fs.rm(txn.sourceFile, { force: true });
  }
  for (const target of [txn.stage, txn.tempData])
    if (target) await fs.rm(target, { recursive: true, force: true });
  await fs.rm(TXN, { force: true });
  console.log(
    `Recovered interrupted add for ${txn.id}: ${committed ? "commit retained" : "staged files rolled back"}`,
  );
}

function parseIssue(issue) {
  const field = (label) =>
    issue.body
      ?.match(new RegExp(`\\*\\*${escRx(label)}:\\*\\*\\s*(.+)`, "i"))?.[1]
      ?.trim() || "";
  const reason =
    issue.body
      ?.match(/## Why it should be included\s+([\s\S]*?)(?:\s+##|$)/i)?.[1]
      ?.trim() || "";
  return {
    number: issue.number,
    title: issue.title,
    name: field("Name") || issue.title.replace(/^Place suggestion:\s*/i, ""),
    category: field("Category"),
    location: field("Location / Maps link"),
    reason,
    url: issue.html_url,
  };
}

async function githubIssues() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/issues?state=open&labels=suggestion&per_page=100`;
  const issues = await getJson(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  return issues.filter((item) => !item.pull_request).map(parseIssue);
}

async function wikiResearch(query) {
  const searchUrl = new URL("https://en.wikipedia.org/w/api.php");
  searchUrl.search = new URLSearchParams({
    action: "opensearch",
    search: query,
    namespace: "0",
    limit: "8",
    format: "json",
    origin: "*",
  });
  const search = await getJson(searchUrl);
  const titles = search?.[1] || [];
  if (!titles.length) return [];
  const detailUrl = new URL("https://en.wikipedia.org/w/api.php");
  detailUrl.search = new URLSearchParams({
    action: "query",
    titles: titles.join("|"),
    prop: "extracts|pageimages|coordinates|info",
    exintro: "1",
    explaintext: "1",
    piprop: "original|thumbnail",
    pithumbsize: "1200",
    inprop: "url",
    redirects: "1",
    format: "json",
    origin: "*",
  });
  const data = await getJson(detailUrl);
  const order = new Map(
    titles.map((title, index) => [title.toLowerCase(), index]),
  );
  return Object.values(data.query?.pages || {})
    .filter((page) => entityMatches(query, page.title))
    .sort(
      (a, b) =>
        (order.get(a.title.toLowerCase()) ?? 99) -
        (order.get(b.title.toLowerCase()) ?? 99),
    );
}

async function geoResearch(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: `${query}, Lucknow, Uttar Pradesh, India`,
    format: "jsonv2",
    addressdetails: "1",
    extratags: "1",
    namedetails: "1",
    limit: "5",
    countrycodes: "in",
  });
  return getJson(url, { headers: { Accept: "application/json" } });
}

function decodeHtml(value = "") {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function serperRequest(endpoint, query, key) {
  const data = await getJson(`https://google.serper.dev/${endpoint}`, {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      q: `${query} Lucknow`,
      gl: "in",
      hl: "en",
      num: 30,
    }),
  });
  if (data.message) throw new Error(data.message);
  return data;
}

async function serperSearch(query, key, images = false) {
  const data = await serperRequest(images ? "images" : "search", query, key);
  if (images)
    return (data.images || []).slice(0, 30).map((item) => ({
      url: item.imageUrl,
      pageUrl: item.link,
      source: item.source || "Google Images via Serper",
      title: item.title || query,
      width: item.imageWidth,
      height: item.imageHeight,
      provider: "Serper",
    }));
  return (data.organic || [])
    .filter((item) =>
      entityMatches(query, `${item.title || ""} ${item.snippet || ""}`),
    )
    .slice(0, 20)
    .map((item) => ({
      url: item.link,
      title: item.title,
      snippet: item.snippet,
      provider: "Serper",
    }));
}

async function serperMaps(query, key) {
  const data = await serperRequest("maps", query, key);
  return (data.places || [])
    .filter((item) => entityMatches(query, item.title || ""))
    .slice(0, 8)
    .map((item) => ({
      name: item.title,
      address: item.address,
      lat: Number(item.latitude),
      lng: Number(item.longitude),
      type: item.type,
      source: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.title || query)}`,
      provider: "Google Maps via Serper",
    }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

async function officialSearch(query, config, images = false) {
  if (!config.serperKey)
    return {
      results: [],
      warnings: [
        "No web-search API key configured. Add a free Serper key in Settings.",
      ],
    };
  try {
    const results = await serperSearch(query, config.serperKey, images);
    return {
      results,
      warnings: results.length
        ? []
        : [`Serper returned no ${images ? "image" : "web"} results.`],
    };
  } catch (error) {
    return { results: [], warnings: [`Serper failed: ${error.message}`] };
  }
}

async function pageImage(result) {
  try {
    const html = await (
      await fetchOk(result.url, {
        timeout: 9000,
        headers: { Accept: "text/html" },
      })
    ).text();
    const raw =
      html.match(
        /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)/i,
      )?.[1] ||
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image(?::src)?)["']/i,
      )?.[1];
    if (!raw) return null;
    return {
      url: new URL(decodeHtml(raw), result.url).href,
      pageUrl: result.url,
      source: new URL(result.url).hostname.replace(/^www\./, ""),
      title: result.title,
    };
  } catch {
    return null;
  }
}

async function commonsImages(query) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${query} Lucknow filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1400",
    format: "json",
    origin: "*",
  });
  const data = await getJson(url);
  return Object.values(data.query?.pages || {}).map((page) => {
    const info = page.imageinfo?.[0] || {};
    return {
      url: info.thumburl || info.url,
      originalUrl: info.url,
      pageUrl: info.descriptionurl,
      source: "Wikimedia Commons",
      title: page.title.replace(/^File:/, ""),
      width: info.thumbwidth || info.width,
      height: info.thumbheight || info.height,
      license: info.extmetadata?.LicenseShortName?.value || "",
    };
  });
}

function categoryFor(name, extract, suggested) {
  if (suggested && !/^not sure|other$/i.test(suggested)) return suggested;
  const text = `${name} ${extract}`.toLowerCase();
  if (/temple|mosque|masjid|imambara|church|gurudwara|shrine|dargah/.test(text))
    return "Religious";
  if (
    /kothi|palace|fort|monument|historic|heritage|built|architecture|baroque|ruins?/.test(
      text,
    )
  )
    return "Heritage";
  if (/park|forest|garden|lake|river|zoo|sanctuary|reserve/.test(text))
    return "Parks & Outdoors";
  if (/museum|gallery|cultural|market|bazaar/.test(text)) return "Culture";
  if (/university|institute|college|school/.test(text)) return "Institution";
  return "Other";
}

function yearFrom(extract = "") {
  return (
    extract.match(
      /(?:founded|established|built|completed|opened|constructed|commissioned)[^.!?]{0,80}?\b(1[5-9]\d{2}|20\d{2})\b/i,
    )?.[1] || ""
  );
}

function uniqImages(images) {
  const seen = new Set();
  return images.filter((image) => {
    if (!image?.url) return false;
    const key = image.url.replace(/^https?:/, "").replace(/\?.*$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function research({ name, category = "", location = "" }) {
  name = clean(name);
  if (!name || name.length > 120) throw new Error("Enter a valid place name");
  const query = name;
  const config = await readConfig();
  const settled = await Promise.allSettled([
    wikiResearch(query),
    geoResearch(query),
    commonsImages(query),
    officialSearch(query, config, false),
    officialSearch(query, config, true),
    config.serperKey
      ? serperMaps(query, config.serperKey)
      : Promise.resolve([]),
  ]);
  const [wiki, geo, commons, webPack, imagePack, googleMaps] = settled.map(
    (item) => (item.status === "fulfilled" ? item.value : []),
  );
  const web = webPack?.results || [];
  const apiImages = imagePack?.results || [];
  const wikiTop = wiki[0] || {};
  const geoTop = geo[0] || {};
  const pageImages = (await Promise.all(web.slice(0, 8).map(pageImage))).filter(
    Boolean,
  );
  const images = uniqImages([
    ...(wikiTop.original?.source
      ? [
          {
            url: wikiTop.original.source,
            pageUrl: wikiTop.fullurl,
            source: "Wikipedia",
            title: wikiTop.title,
          },
        ]
      : []),
    ...pageImages,
    ...apiImages,
    ...commons,
  ]).slice(0, 50);
  const summarySource =
    clean(wikiTop.extract) || clean(web.find((item) => item.snippet)?.snippet);
  const summary = summarySource
    .split(/(?<=[.!?])\s+/)
    .slice(0, 3)
    .join(" ")
    .slice(0, 700);
  const categoryValue = categoryFor(name, summarySource, category);
  const mapTop = googleMaps[0] || {};
  const coordCandidates = [
    ...geo.slice(0, 5).map((item) => ({
      name: item.display_name,
      lat: Number(item.lat),
      lng: Number(item.lon),
      type: item.type,
      source:
        item.osm_type && item.osm_id
          ? `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`
          : "",
      provider: "OpenStreetMap",
    })),
    ...(wikiTop.coordinates?.[0]
      ? [
          {
            name: wikiTop.title,
            lat: Number(wikiTop.coordinates[0].lat),
            lng: Number(wikiTop.coordinates[0].lon),
            type: "article coordinate",
            source: wikiTop.fullurl,
            provider: "Wikipedia",
          },
        ]
      : []),
    ...googleMaps,
  ];
  const consensus = coordinateConsensus(coordCandidates);
  const selectedCoord = consensus.selected || {};
  const lat = Number(selectedCoord.lat);
  const lng = Number(selectedCoord.lng);
  return {
    draft: {
      id: slugify(wikiTop.title || name),
      name: wikiTop.title || name,
      category: categoryValue,
      period: categoryValue === "Heritage" ? "Historic Lucknow" : "",
      year: yearFrom(summarySource),
      lat: Number.isFinite(lat) ? lat : "",
      lng: Number.isFinite(lng) ? lng : "",
      wiki: wikiTop.title || "",
      summary,
      mapsQuery:
        geoTop.display_name ||
        mapTop.address ||
        `${name}, Lucknow, Uttar Pradesh, India`,
      coordVerified: consensus.verified ? "high" : "low",
      coordSource: selectedCoord.source || "",
    },
    geo: coordCandidates,
    coordinateConsensus: consensus,
    wiki: wiki.slice(0, 5).map((item) => ({
      title: item.title,
      extract: clean(item.extract).slice(0, 500),
      url: item.fullurl,
    })),
    web,
    images,
    providers: { serper: Boolean(config.serperKey) },
    warnings: [
      ...new Set([
        ...(webPack?.warnings || []),
        ...(imagePack?.warnings || []),
        ...settled.flatMap((item, index) => {
          const source = [
            "Wikipedia",
            "OpenStreetMap",
            "Commons",
            "web search",
            "image search",
            "Google Maps",
          ][index];
          if (item.status === "rejected")
            return [`${source} failed: ${item.reason.message}`];
          if (index < 3 && !item.value.length)
            return [`${source} returned no results.`];
          return [];
        }),
      ]),
    ],
  };
}

function validateDraft(draft, sites) {
  const required = [
    "id",
    "name",
    "category",
    "summary",
    "mapsQuery",
    "coordSource",
  ];
  for (const key of required)
    if (!clean(draft[key])) throw new Error(`Missing required field: ${key}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.id))
    throw new Error("ID must be a lowercase slug");
  if (
    !Number.isFinite(Number(draft.lat)) ||
    Number(draft.lat) < 26 ||
    Number(draft.lat) > 28
  )
    throw new Error("Latitude does not look like Lucknow");
  if (
    !Number.isFinite(Number(draft.lng)) ||
    Number(draft.lng) < 79 ||
    Number(draft.lng) > 82
  )
    throw new Error("Longitude does not look like Lucknow");
  if (sites.some((site) => site.id === draft.id))
    throw new Error(`Duplicate ID: ${draft.id}`);
  if (
    sites.some((site) => site.name.toLowerCase() === draft.name.toLowerCase())
  )
    throw new Error(`Place already exists: ${draft.name}`);
}

async function downloadImage(candidate, destination) {
  const response = await fetchOk(candidate.url, {
    timeout: 25000,
    headers: { Accept: "image/*" },
  });
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error("Image is larger than 20 MB");
  const input = Buffer.from(await response.arrayBuffer());
  if (input.length > MAX_IMAGE_BYTES)
    throw new Error("Image is larger than 20 MB");
  const image = sharp(input, { failOn: "error" });
  const meta = await image.metadata();
  if (!meta.width || !meta.height || meta.width < 700 || meta.height < 450)
    throw new Error(`Image too small (${meta.width || 0}×${meta.height || 0})`);
  await image
    .rotate()
    .resize({
      width: 2000,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(destination);
  return { width: meta.width, height: meta.height, bytes: input.length };
}

async function closeIssue(number, message) {
  if (!number || !process.env.GITHUB_TOKEN)
    return { closed: false, reason: "GITHUB_TOKEN is not set" };
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/issues/${number}`;
  await fetchOk(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });
  await fetchOk(`${url}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body: message }),
  });
  return { closed: true };
}

async function addPlace({
  draft,
  images = [],
  coverIndex = 0,
  issueNumber = null,
  coordinateEvidence = [],
  coordinateConfirmed = false,
}) {
  const sites = JSON.parse(await fs.readFile(DATA, "utf8"));
  validateDraft(draft, sites);
  const consensus = coordinateConsensus(
    Array.isArray(coordinateEvidence) ? coordinateEvidence : [],
  );
  if (!consensus.verified)
    throw new Error(
      "Coordinates need agreement from at least two independent sources within 250 metres",
    );
  if (!coordinateConfirmed)
    throw new Error("Confirm the coordinate marker on the map before adding");
  if (
    distanceMetres({ lat: draft.lat, lng: draft.lng }, consensus.selected) > 100
  )
    throw new Error(
      "Edited coordinates no longer match the verified source consensus",
    );
  if (!Array.isArray(images) || images.length === 0 || images.length > 8)
    throw new Error("Select between 1 and 8 photos");
  const folderBase = shortSlug(draft.id);
  let folder = folderBase;
  for (
    let i = 2;
    await fs.stat(path.join(IMG, folder)).then(
      () => true,
      () => false,
    );
    i++
  )
    folder = `${folderBase}${i}`;
  const stage = path.join(HERE, `.stage-${crypto.randomUUID()}`);
  const finalDir = path.join(IMG, folder);
  let sourceFile = "";
  let tempData = "";
  let committed = false;
  await fs.mkdir(stage, { recursive: true });
  const saved = [];
  try {
    for (let i = 0; i < images.length; i++) {
      const filename = `${i + 1}.jpg`;
      const info = await downloadImage(images[i], path.join(stage, filename));
      saved.push({
        path: `img/${folder}/${filename}`,
        source: images[i].pageUrl || images[i].url,
        imageUrl: images[i].url,
        ...info,
      });
    }
    const hashes = new Set();
    for (const file of await fs.readdir(stage)) {
      const hash = crypto
        .createHash("sha256")
        .update(await fs.readFile(path.join(stage, file)))
        .digest("hex");
      if (hashes.has(hash))
        throw new Error("Two selected photos are identical");
      hashes.add(hash);
    }
    const existingHashes = new Set();
    for (const site of sites)
      for (const relative of site.images || []) {
        const absolute = path.join(ROOT, relative);
        const hash = await fs.readFile(absolute).then(
          (data) => crypto.createHash("sha256").update(data).digest("hex"),
          () => "",
        );
        if (hash) existingHashes.add(hash);
      }
    for (const hash of hashes)
      if (existingHashes.has(hash))
        throw new Error("A selected photo already exists in the Atlas");
    await fs.mkdir(BACKUPS, { recursive: true });
    const stamp = nowStamp();
    await fs.copyFile(DATA, path.join(BACKUPS, `sites-${stamp}.json`));
    const entry = {
      id: clean(draft.id),
      name: clean(draft.name),
      category: clean(draft.category),
      period: clean(draft.period),
      year: clean(draft.year),
      lat: Number(draft.lat),
      lng: Number(draft.lng),
      wiki: clean(draft.wiki),
      summary: clean(draft.summary),
      images: saved.map((item) => item.path),
      cover:
        saved[Math.max(0, Math.min(Number(coverIndex) || 0, saved.length - 1))]
          .path,
      mapsQuery: clean(draft.mapsQuery),
      coordVerified: clean(draft.coordVerified) || "medium",
      coordSource: clean(draft.coordSource),
    };
    const next = [...sites, entry];
    tempData = `${DATA}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tempData, `${JSON.stringify(next, null, 2)}\n`, {
      flag: "wx",
    });
    JSON.parse(await fs.readFile(tempData, "utf8"));
    sourceFile = path.join(BACKUPS, `sources-${draft.id}-${stamp}.json`);
    await writeTxn({
      id: draft.id,
      stage,
      finalDir,
      tempData,
      sourceFile,
      state: "prepared",
    });
    await fs.rename(stage, finalDir);
    await writeTxn({
      id: draft.id,
      stage,
      finalDir,
      tempData,
      sourceFile,
      state: "images_moved",
    });
    await fs.writeFile(
      sourceFile,
      `${JSON.stringify({ place: draft.name, addedAt: new Date().toISOString(), issueNumber, coordinates: consensus, images: saved }, null, 2)}\n`,
      { flag: "wx" },
    );
    await writeTxn({
      id: draft.id,
      stage,
      finalDir,
      tempData,
      sourceFile,
      state: "sources_written",
    });
    await fs.rename(tempData, DATA);
    committed = true;
    await fs.rm(TXN, { force: true });
    const issue = await closeIssue(
      issueNumber,
      `Added **${draft.name}** to Lucknow Atlas after manual review.`,
    ).catch((error) => ({ closed: false, reason: error.message }));
    return {
      ok: true,
      entry,
      backup: path.relative(ROOT, path.join(BACKUPS, `sites-${stamp}.json`)),
      sources: path.relative(ROOT, sourceFile),
      issue,
    };
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    if (!committed) {
      await fs.rm(finalDir, { recursive: true, force: true });
      if (tempData) await fs.rm(tempData, { force: true });
      if (sourceFile) await fs.rm(sourceFile, { force: true });
      await fs.rm(TXN, { force: true });
    }
    throw error;
  }
}

app.get("/api/issues", async (_req, res) => {
  try {
    res.json({ issues: await githubIssues() });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post("/api/research", async (req, res) => {
  try {
    res.json(await research(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/add", async (req, res) => {
  try {
    res.json(await addPlace(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/status", async (_req, res) => {
  try {
    const sites = JSON.parse(await fs.readFile(DATA, "utf8"));
    const config = await readConfig();
    res.json({
      ok: true,
      places: sites.length,
      root: ROOT,
      providers: { serper: Boolean(config.serperKey) },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/settings", async (req, res) => {
  try {
    const config = await writeConfig(req.body || {});
    res.json({
      ok: true,
      providers: { serper: Boolean(config.serperKey) },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await recoverTransaction();
  app.listen(PORT, "127.0.0.1", () =>
    console.log(`Lucknow Atlas review tool: http://localhost:${PORT}`),
  );
}

export {
  app,
  parseIssue,
  slugify,
  validateDraft,
  shortSlug,
  recoverTransaction,
  coordinateConsensus,
  distanceMetres,
  entityMatches,
};
