import * as cheerio
  from "cheerio";

import {
  PRIORITY
} from "./config.js";

import {
  clean,
  parseDMY,
  parseEventDatesFromTitle
} from "./utils.js";

const URL =
  "https://www.bhatkhandeuniversity.ac.in/en/feature/notices-announcements";

export async function fetchBhatkhande() {
  const response =
    await fetch(
      URL,
      {
        headers: {
          "User-Agent":
            "LucknowAtlas/1.0 (+https://lucknow-atlas.vercel.app)"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Bhatkhande HTTP ${response.status}`
    );
  }

  const html =
    await response.text();

  const $ =
    cheerio.load(html);

  const items = [];

  $("table tr").each(
    (_, row) => {
      const cells =
        $(row).find("td");

      if (
        cells.length < 3
      ) {
        return;
      }

      const titleCell =
        cells.eq(1);

      const dateCell =
        cells.eq(2);

      const anchor =
        titleCell
          .find("a[href]")
          .first();

      const title =
        clean(
          anchor.text()
        );

      const href =
        anchor.attr("href");

      if (
        !title ||
        !href
      ) {
        return;
      }

      const publishedAt =
        parseDMY(
          dateCell.text()
        );

      /*
       * No reliable uploaded date =
       * don't pretend it's current.
       */
      if (!publishedAt) {
        return;
      }

      const {
        eventStart,
        eventEnd
      } =
        parseEventDatesFromTitle(
          title
        );

      items.push({
        title,

        source:
          "Bhatkhande Sanskriti Vishwavidyalaya",

        sourceUrl:
          new URL(
            href,
            URL
          ).href,

        sourcePriority:
          PRIORITY.BHATKHANDE,

        publishedAt,

        eventStart,

        eventEnd
      });
    }
  );

  if (!items.length) {
    throw new Error(
      "Bhatkhande parser returned zero rows"
    );
  }

  return items;
}
