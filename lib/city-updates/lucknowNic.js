import * as cheerio
  from "cheerio";

import {
  PRIORITY
} from "./config.js";

import {
  clean,
  parseExplicitDate
} from "./utils.js";

const SOURCES = [
  "https://lucknow.nic.in/whats-new/whats-new/",
  "https://lucknow.nic.in/past-notices/announcements/",
  "https://lucknow.nic.in/past-notices/notices/"
];

async function fetchPage(url) {
  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "LucknowAtlas/1.0 (+https://lucknow-atlas.vercel.app)"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Lucknow NIC HTTP ${response.status}`
    );
  }

  const html =
    await response.text();

  const $ =
    cheerio.load(html);

  const candidates = [];

  $("article, li, tr, .views-row, .notice-item")
    .each(
      (_, node) => {
        const anchor =
          $(node)
            .find("a[href]")
            .first();

        if (!anchor.length) {
          return;
        }

        const title =
          clean(
            anchor.text()
          );

        if (
          !title ||
          title.length < 8
        ) {
          return;
        }

        const text =
          clean(
            $(node).text()
          );

        if (
          !text ||
          text.length > 1500
        ) {
          return;
        }

        const date =
          parseExplicitDate(
            text
          );

        /*
         * No real date =
         * don't publish it.
         */
        if (!date) {
          return;
        }

        const href =
          anchor.attr("href");

        if (!href) {
          return;
        }

        candidates.push({
          title,

          description: "",

          source:
            "Lucknow District Administration",

          sourceUrl:
            new URL(
              href,
              url
            ).href,

          sourcePriority:
            PRIORITY.LUCKNOW_NIC,

          publishedAt:
            date,

          eventStart:
            null,

          eventEnd:
            null
        });
      }
    );

  return candidates;
}

export async function fetchLucknowNic() {
  const results =
    await Promise.allSettled(
      SOURCES.map(fetchPage)
    );

  const items =
    results.flatMap(
      result =>
        result.status ===
        "fulfilled"
          ? result.value
          : []
    );

  if (!items.length) {
    throw new Error(
      "Lucknow NIC returned no dated candidates"
    );
  }

  return items;
}
