import * as cheerio from "cheerio";

import {
  PRIORITY
} from "./config.js";

import {
  clean
} from "./utils.js";

const SOURCES = [
  {
    name: "Hindustan Times",
    listing: "https://www.hindustantimes.com/cities/lucknow-news",
    host: "www.hindustantimes.com",
    match: /\/cities\/lucknow-news\//
  },
  {
    name: "Times of India",
    listing: "https://timesofindia.indiatimes.com/city/lucknow",
    host: "timesofindia.indiatimes.com",
    match: /\/city\/lucknow\//
  },
  {
    name: "Amar Ujala",
    listing: "https://www.amarujala.com/lucknow",
    host: "www.amarujala.com",
    match: /\/lucknow\//
  }
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 Chrome/152 Safari/537.36";

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Publisher HTTP ${response.status}: ${url}`
    );
  }

  return {
    html: await response.text(),
    url: response.url || url
  };
}

function absolute(value, base) {
  if (!value) return null;

  try {
    const u = new URL(value, base);

    return ["http:", "https:"].includes(u.protocol)
      ? u.href
      : null;
  } catch {
    return null;
  }
}

function jsonLdObjects(value, output = []) {
  if (!value) return output;

  if (Array.isArray(value)) {
    for (const child of value) {
      jsonLdObjects(child, output);
    }
    return output;
  }

  if (typeof value !== "object") {
    return output;
  }

  output.push(value);

  for (const child of Object.values(value)) {
    jsonLdObjects(child, output);
  }

  return output;
}

function readJsonLd($) {
  const objects = [];

  $('script[type="application/ld+json"]').each(
    (_, element) => {
      try {
        const parsed =
          JSON.parse($(element).text());

        jsonLdObjects(parsed, objects);
      } catch {}
    }
  );

  return objects;
}

function firstJsonValue(objects, names) {
  for (const object of objects) {
    for (const name of names) {
      const value = object?.[name];

      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }

      if (Array.isArray(value) && value.length) {
        const first = value[0];

        if (typeof first === "string") {
          return first;
        }

        if (first?.url) {
          return first.url;
        }
      }

      if (value?.url) {
        return value.url;
      }
    }
  }

  return null;
}

async function listingLinks(source) {
  const { html } =
    await fetchHtml(source.listing);

  const $ = cheerio.load(html);
  const links = new Set();

  $("a[href]").each((_, element) => {
    const href =
      $(element).attr("href");

    const url =
      absolute(href, source.listing);

    if (!url) return;

    try {
      const parsed = new URL(url);

      if (
        parsed.hostname.replace(/^www\./, "") !==
        source.host.replace(/^www\./, "")
      ) {
        return;
      }

      if (!source.match.test(parsed.pathname)) {
        return;
      }

      if (
        parsed.href.replace(/\/$/, "") ===
        source.listing.replace(/\/$/, "")
      ) {
        return;
      }

      links.add(parsed.href);
    } catch {}
  });

  return [...links].slice(0, 10);
}

async function articleItem(source, url) {
  try {
    const { html, url: finalUrl } =
      await fetchHtml(url);

    const $ = cheerio.load(html);
    const objects = readJsonLd($);

    const title = clean(
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      firstJsonValue(objects, [
        "headline",
        "name"
      ]) ||
      $("h1").first().text()
    );

    if (!title || title.length < 12) {
      return null;
    }

    const description = clean(
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      firstJsonValue(objects, [
        "description"
      ]) ||
      ""
    );

    const rawImage =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('meta[property="twitter:image"]').attr("content") ||
      firstJsonValue(objects, [
        "image",
        "thumbnailUrl"
      ]);

    const imageUrl =
      absolute(rawImage, finalUrl);

    const publishedAt =
      $('meta[property="article:published_time"]').attr("content") ||
      $('meta[name="article:published_time"]').attr("content") ||
      firstJsonValue(objects, [
        "datePublished",
        "dateCreated"
      ]);

    if (!publishedAt) {
      return null;
    }

    const date =
      new Date(publishedAt);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    if (
      date.getTime() <
      Date.now() - 14 * 24 * 60 * 60 * 1000
    ) {
      return null;
    }

    const relevanceText =
      `${title} ${description}`.toLowerCase();

    const lucknowRelevant =
      /\blucknow\b|hazratganj|aminabad|chowk|kaiserbagh|qaiserbagh|husainabad|hussainabad|bara imambara|bada imambara|chota imambara|chhota imambara|rumi darwaza|british residency|state museum|bhatkhande|sanatkada|gomti|janeshwar mishra park|alambagh|chinhat|kukrail/i
        .test(relevanceText);

    if (!lucknowRelevant) {
      return null;
    }

    return {
      title,
      description,
      type: null,
      source: source.name,
      sourceUrl: finalUrl,
      imageUrl,
      sourcePriority: PRIORITY.NEWS,
      publishedAt: date.toISOString(),
      eventStart: null,
      eventEnd: null
    };

  } catch {
    return null;
  }
}

async function readSource(source) {
  try {
    const links =
      await listingLinks(source);

    const results =
      await Promise.allSettled(
        links.map(url =>
          articleItem(source, url)
        )
      );

    return results
      .filter(result =>
        result.status === "fulfilled" &&
        result.value
      )
      .map(result =>
        result.value
      );

  } catch {
    return [];
  }
}

export async function fetchPublisherNews() {
  const results =
    await Promise.allSettled(
      SOURCES.map(readSource)
    );

  return results.flatMap(result =>
    result.status === "fulfilled"
      ? result.value
      : []
  );
}
