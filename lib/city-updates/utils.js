import crypto from "node:crypto";

import {
  CATEGORY_TERMS,
  HARD_BLOCK,
  LUCKNOW_TERMS,
  PRIORITY,
  TTL_DAYS,
  VENUES
} from "./config.js";

export function clean(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function norm(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsAny(text, terms) {
  const n = norm(text);

  return terms.some(term =>
    n.includes(norm(term))
  );
}

export function isLucknowRelevant(item) {
  return containsAny(
    `${item.title || ""} ${item.description || ""}`,
    LUCKNOW_TERMS
  );
}

export function isBlocked(item) {
  return containsAny(
    `${item.title || ""} ${item.description || ""}`,
    HARD_BLOCK
  );
}

export function classify(item) {
  const text =
    `${item.title || ""} ${item.description || ""}`;

  for (
    const [type, terms]
    of Object.entries(CATEGORY_TERMS)
  ) {
    if (containsAny(text, terms)) {
      return type;
    }
  }

  return item.type || null;
}

export function toISO(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function addDays(iso, days) {
  const date = new Date(iso);

  date.setUTCDate(
    date.getUTCDate() + days
  );

  return date.toISOString();
}

export function parseDMY(text) {
  const match = clean(text).match(
    /\b([0-3]?\d)[\/.-]([01]?\d)[\/.-](20\d{2})\b/
  );

  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString();
}

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
};

export function parseWrittenDate(text) {
  const match = clean(text).match(
    /\b([0-3]?\d)\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+(20\d{2})\b/i
  );

  if (!match) return null;

  return new Date(
    Date.UTC(
      Number(match[3]),
      MONTHS[match[2].toLowerCase()],
      Number(match[1])
    )
  ).toISOString();
}

export function parseExplicitDate(text) {
  return (
    parseDMY(text) ||
    parseWrittenDate(text)
  );
}

export function parseEventDatesFromTitle(text) {
  const dates = [];

  const dmy = [
    ...clean(text).matchAll(
      /\b([0-3]?\d)[\/.-]([01]?\d)[\/.-](20\d{2})\b/g
    )
  ];

  for (const result of dmy) {
    const parsed =
      parseDMY(result[0]);

    if (parsed) dates.push(parsed);
  }

  const written = [
    ...clean(text).matchAll(
      /\b([0-3]?\d)\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+(20\d{2})\b/gi
    )
  ];

  for (const result of written) {
    const parsed =
      parseWrittenDate(result[0]);

    if (parsed) dates.push(parsed);
  }

  const unique =
    [...new Set(dates)].sort();

  return {
    eventStart:
      unique[0] || null,

    eventEnd:
      unique.length > 1
        ? unique[unique.length - 1]
        : null
  };
}

export function normalizeItem(raw) {
  return {
    id:
      crypto
        .createHash("sha1")
        .update(
          `${clean(raw.title)}|${clean(raw.sourceUrl)}`
        )
        .digest("hex")
        .slice(0, 20),

    title:
      clean(raw.title),

    description:
      clean(raw.description || ""),

    type:
      raw.type || null,

    source:
      clean(raw.source || "Source"),

    sourceUrl:
      clean(raw.sourceUrl || ""),

    sourcePriority:
      Number.isFinite(raw.sourcePriority)
        ? raw.sourcePriority
        : PRIORITY.NEWS,

    publishedAt:
      toISO(raw.publishedAt),

    eventStart:
      toISO(raw.eventStart),

    eventEnd:
      toISO(raw.eventEnd),

    isOngoing:
      Boolean(raw.isOngoing),

    fetchedAt:
      new Date().toISOString()
  };
}

export function expiryDate(item) {
  if (item.eventEnd) {
    return addDays(
      item.eventEnd,
      1
    );
  }

  if (item.eventStart) {
    return addDays(
      item.eventStart,
      item.isOngoing ? 30 : 1
    );
  }

  if (item.publishedAt) {
    return addDays(
      item.publishedAt,
      TTL_DAYS[item.type] ?? 7
    );
  }

  return null;
}

export function isExpired(
  item,
  now = new Date()
) {
  const expiry =
    expiryDate(item);

  if (!expiry) {
    return true;
  }

  return (
    now.getTime() >
    new Date(expiry).getTime()
  );
}

function venueKey(item) {
  const text =
    norm(
      `${item.title || ""} ${item.description || ""}`
    );

  for (
    const [alias, canonical]
    of Object.entries(VENUES)
  ) {
    if (
      text.includes(norm(alias))
    ) {
      return canonical;
    }
  }

  return "none";
}

function topicWords(title) {
  const stop = new Set([
    "lucknow",
    "news",
    "today",
    "latest",
    "the",
    "this",
    "that",
    "from",
    "with",
    "into",
    "will",
    "for",
    "and",
    "are",
    "was",
    "were",
    "has",
    "have",
    "had",
    "event",
    "programme",
    "program",
    "says",
    "hosts",
    "held"
  ]);

  return norm(title)
    .split(" ")
    .filter(word => word.length >= 4)
    .filter(word => !stop.has(word))
    .slice(0, 10);
}

function dateBucket(item) {
  const value =
    item.eventStart ||
    item.publishedAt;

  if (!value) {
    return "unknown";
  }

  const date =
    new Date(value);

  const year =
    date.getUTCFullYear();

  const start =
    Date.UTC(year, 0, 1);

  const days =
    Math.floor(
      (
        date.getTime() -
        start
      ) / 86400000
    );

  return (
    `${year}-w${Math.floor(days / 7)}`
  );
}

function wordOverlap(a, b) {
  const A =
    new Set(topicWords(a.title));

  const B =
    new Set(topicWords(b.title));

  if (!A.size || !B.size) {
    return 0;
  }

  let matching = 0;

  for (const word of A) {
    if (B.has(word)) {
      matching++;
    }
  }

  return (
    matching /
    Math.min(A.size, B.size)
  );
}

function sameEvent(a, b) {
  const venueA =
    venueKey(a);

  const venueB =
    venueKey(b);

  const sameVenue =
    venueA !== "none" &&
    venueA === venueB;

  const sameWeek =
    dateBucket(a) ===
    dateBucket(b);

  const overlap =
    wordOverlap(a, b);

  if (
    sameVenue &&
    sameWeek
  ) {
    return true;
  }

  if (
    sameWeek &&
    overlap >= 0.65
  ) {
    return true;
  }

  if (
    sameVenue &&
    overlap >= 0.45
  ) {
    return true;
  }

  return false;
}

export function dedupe(items) {
  const output = [];

  for (const item of items) {
    const index =
      output.findIndex(existing =>
        sameEvent(
          existing,
          item
        )
      );

    if (index === -1) {
      output.push(item);
      continue;
    }

    const existing =
      output[index];

    if (
      item.sourcePriority <
      existing.sourcePriority
    ) {
      output[index] = {
        ...item,

        description:
          item.description ||
          existing.description,

        eventStart:
          item.eventStart ||
          existing.eventStart,

        eventEnd:
          item.eventEnd ||
          existing.eventEnd
      };
    }
  }

  return output;
}

export function processItems(rawItems) {
  let items =
    rawItems
      .map(normalizeItem)
      .filter(item =>
        item.title &&
        item.sourceUrl
      );

  items =
    items.filter(
      item =>
        !isBlocked(item)
    );

  items =
    items.filter(
      item =>
        isLucknowRelevant(item)
    );

  items =
    items
      .map(item => ({
        ...item,
        type:
          classify(item)
      }))
      .filter(item =>
        item.type
      );

  items =
    items.filter(
      item =>
        !isExpired(item)
    );

  items.sort((a, b) => {
    if (
      a.sourcePriority !==
      b.sourcePriority
    ) {
      return (
        a.sourcePriority -
        b.sourcePriority
      );
    }

    return (
      Date.parse(
        b.eventStart ||
        b.publishedAt ||
        0
      ) -
      Date.parse(
        a.eventStart ||
        a.publishedAt ||
        0
      )
    );
  });

  items =
    dedupe(items);

  items.sort((a, b) => {
    const dateDifference =
      Date.parse(
        b.eventStart ||
        b.publishedAt ||
        0
      ) -
      Date.parse(
        a.eventStart ||
        a.publishedAt ||
        0
      );

    if (dateDifference) {
      return dateDifference;
    }

    return (
      a.sourcePriority -
      b.sourcePriority
    );
  });

  const counts = {};
  const final = [];

  for (const item of items) {
    counts[item.type] ||= 0;

    if (
      counts[item.type] >= 2
    ) {
      continue;
    }

    counts[item.type]++;

    final.push(item);

    if (final.length >= 6) {
      break;
    }
  }

  return final;
}
