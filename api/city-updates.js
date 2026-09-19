import { getSnapshot } from "../lib/city-updates/store.js";
import { refreshCityUpdates } from "../lib/city-updates/refresh.js";
import { expiryDate, addDays } from "../lib/city-updates/utils.js";

const STALE_MS = 5 * 60 * 60 * 1000; // refresh if snapshot older than 5 hours

const TYPE_MAP = {
  heritage_walk: "heritage_walk",
  exhibition: "exhibition",
  festival: "festival",
  monument_closure: "closure",
  traffic_diversion: "notice",
  timing_change: "notice",
  museum_notice: "notice",
  notice: "notice"
};

function toFrontend(item) {
  const startDate = item.eventStart || item.publishedAt || item.fetchedAt;
  const endDate = item.eventEnd || expiryDate(item) ||
    (startDate ? addDays(startDate, 7) : null);
  if (!item.title || !item.sourceUrl || !startDate || !endDate) return null;
  return {
    id: item.id,
    type: TYPE_MAP[item.type] || "notice",
    title: item.title,
    description: item.description || "",
    imageUrl: item.imageUrl || null,
    siteId: "",
    startDate,
    endDate,
    source: { name: item.source || "Source", url: item.sourceUrl },
    auto: true,
    publishedAt: item.publishedAt || null
  };
}

let inflight = null;

async function currentSnapshot() {
  let snap = null;
  try { snap = await getSnapshot(); } catch (e) { console.error(e); }

  const age = snap?.generatedAt
    ? Date.now() - Date.parse(snap.generatedAt)
    : Infinity;

  const missingEventThumbs =
    Array.isArray(snap?.items) &&
    snap.items.some(item =>
      item?.source === "HappeningNext" &&
      !item?.imageUrl
    );

  const oldPipeline =
    Number(snap?.version || 0) < 2;

  if (age > STALE_MS || missingEventThumbs || oldPipeline) {
    try {
      inflight ||= refreshCityUpdates().finally(() => { inflight = null; });
      snap = await inflight;
    } catch (e) {
      console.error("stale refresh failed", e);
    }
  }
  return snap;
}

export default async function handler(req, res) {
  try {
    const snapshot = await currentSnapshot();
    const items = Array.isArray(snapshot?.items)
      ? snapshot.items.map(toFrontend).filter(Boolean)
      : [];
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-City-Updates-Version", "2");
    if (snapshot?.generatedAt) {
      res.setHeader("X-City-Updates-Generated-At", snapshot.generatedAt);
    }
    return res.status(200).json(items);
  } catch (error) {
    console.error(error);
    return res.status(200).json([]);
  }
}
