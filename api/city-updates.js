import { getSnapshot } from "../lib/city-updates/store.js";
import { expiryDate, addDays } from "../lib/city-updates/utils.js";

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
    siteId: "",
    startDate,
    endDate,
    source: { name: item.source || "Source", url: item.sourceUrl },
    auto: true,
    publishedAt: item.publishedAt || null
  };
}

export default async function handler(req, res) {
  try {
    const snapshot = await getSnapshot();
    const items = Array.isArray(snapshot?.items)
      ? snapshot.items.map(toFrontend).filter(Boolean)
      : [];
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=21600");
    return res.status(200).json(items);
  } catch (error) {
    console.error(error);
    return res.status(200).json([]);
  }
}
