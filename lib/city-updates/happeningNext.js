import * as cheerio from "cheerio";

import {
  PRIORITY
} from "./config.js";

import {
  clean,
  containsAny
} from "./utils.js";

const LIST_PAGES = [
  "https://happeningnext.com/lucknow/art",
  "https://happeningnext.com/lucknow/concerts",
  "https://happeningnext.com/lucknow/music"
];

const ALLOW = [
  "heritage",
  "walk",
  "sufi",
  "mushaira",
  "ghazal",
  "shayari",
  "poetry",
  "kavi",
  "music",
  "concert",
  "art",
  "exhibition",
  "cultural",
  "theatre",
  "theater",
  "festival",
  "mahotsav",
  "dandiya",
  "garba",
  "open mic"
];

const BLOCK = [
  "comedy",
  "standup",
  "stand-up",
  "pottery date",
  "couple art",
  "dating",
  "fashion week",
  "job fair",
  "business expo"
];

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; LucknowAtlas/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `HappeningNext ${response.status}: ${url}`
    );
  }

  return response.text();
}

function findEvents(value, output = []) {
  if (!value) return output;

  if (Array.isArray(value)) {
    for (const item of value) {
      findEvents(item, output);
    }

    return output;
  }

  if (typeof value !== "object") {
    return output;
  }

  const type = value["@type"];

  if (
    type === "Event" ||
    (Array.isArray(type) && type.includes("Event"))
  ) {
    output.push(value);
  }

  for (const child of Object.values(value)) {
    findEvents(child, output);
  }

  return output;
}

function eventType(title) {
  const t = title.toLowerCase();

  if (t.includes("heritage walk")) {
    return "heritage_walk";
  }

  if (
    t.includes("exhibition") ||
    t.includes("art show")
  ) {
    return "exhibition";
  }

  return "festival";
}

async function extractEvent(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const structured = [];

  $('script[type="application/ld+json"]').each(
    (_, element) => {
      try {
        const parsed = JSON.parse(
          $(element).text()
        );

        findEvents(parsed, structured);
      } catch {}
    }
  );

  if (!structured.length) {
    return null;
  }

  const event = structured[0];

  const title =
    clean(event.name || "");

  if (!title) return null;

  if (!containsAny(title, ALLOW)) {
    return null;
  }

  if (containsAny(title, BLOCK)) {
    return null;
  }

  const start =
    event.startDate
      ? new Date(event.startDate)
      : null;

  if (
    !start ||
    Number.isNaN(start.getTime())
  ) {
    return null;
  }

  const now = Date.now();

  // Keep current/upcoming events only.
  if (
    start.getTime() <
    now - 24 * 60 * 60 * 1000
  ) {
    return null;
  }

  if (
    start.getTime() >
    now + 45 * 24 * 60 * 60 * 1000
  ) {
    return null;
  }

  let location = "";

  if (typeof event.location === "string") {
    location = clean(event.location);
  } else if (event.location) {
    location = clean(
      event.location.name ||
      event.location.address?.streetAddress ||
      ""
    );
  }

  return {
    title,

    description:
      location
        ? location
        : "",

    type:
      eventType(title),

    source:
      "HappeningNext",

    sourceUrl:
      url,

    sourcePriority:
      PRIORITY.EVENTS,

    publishedAt:
      null,

    eventStart:
      start.toISOString(),

    eventEnd:
      event.endDate
        ? new Date(event.endDate).toISOString()
        : null
  };
}

async function discoverLinks(page) {
  const html = await fetchHtml(page);
  const $ = cheerio.load(html);

  const urls = new Set();

  $("a[href]").each((_, element) => {
    const href =
      $(element).attr("href");

    if (!href) return;

    let url;

    try {
      url = new URL(
        href,
        page
      );
    } catch {
      return;
    }

    if (
      url.hostname === "happeningnext.com" &&
      url.pathname.includes("/event/")
    ) {
      urls.add(url.href);
    }
  });

  return [...urls];
}

export async function fetchHappeningNext() {
  const listings =
    await Promise.allSettled(
      LIST_PAGES.map(discoverLinks)
    );

  const links =
    [...new Set(
      listings.flatMap(result =>
        result.status === "fulfilled"
          ? result.value
          : []
      )
    )].slice(0, 30);

  if (!links.length) {
    throw new Error(
      "HappeningNext returned no event links"
    );
  }

  const results =
    await Promise.allSettled(
      links.map(extractEvent)
    );

  const items =
    results
      .filter(
        result =>
          result.status === "fulfilled" &&
          result.value
      )
      .map(
        result =>
          result.value
      );

  if (!items.length) {
    throw new Error(
      "HappeningNext returned no usable current events"
    );
  }

  return items;
}
