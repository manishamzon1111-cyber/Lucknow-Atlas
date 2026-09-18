import {
  PRIORITY,
  LUCKNOW_TERMS,
  CATEGORY_TERMS,
  HARD_BLOCK
} from "./config.js";

import {
  clean,
  containsAny
} from "./utils.js";

const QUERIES = [
  {
    q:
      '"Lucknow" "heritage walk"',
    type:
      "heritage_walk"
  },

  {
    q:
      '"State Museum Lucknow" exhibition',
    type:
      "museum_notice"
  },

  {
    q:
      '"Lucknow" museum exhibition',
    type:
      "exhibition"
  },

  {
    q:
      '"Sanatkada" Lucknow',
    type:
      "festival"
  },

  {
    q:
      '"INTACH" Lucknow heritage',
    type:
      "monument_closure"
  },

  {
    q:
      '"UP Tourism" Lucknow heritage',
    type:
      "heritage_walk"
  },

  {
    q:
      '"Lucknow" "traffic diversion" (Chowk OR Hazratganj OR Husainabad OR Imambara)',
    type:
      "traffic_diversion"
  },

  {
    q:
      '"Rumi Darwaza" Lucknow (closure OR restoration OR conservation)',
    type:
      "monument_closure"
  },

  {
    q:
      '"Bara Imambara" Lucknow (closure OR restoration OR timing)',
    type:
      "monument_closure"
  },

  {
    q:
      '"Chota Imambara" Lucknow (closure OR restoration OR timing)',
    type:
      "monument_closure"
  },

  {
    q:
      '"British Residency" Lucknow (closure OR restoration OR timing)',
    type:
      "monument_closure"
  },

  {
    q:
      '"Lucknow" cultural festival',
    type:
      "festival"
  },

  {
    q:
      '"Lucknow" exhibition',
    type:
      "exhibition"
  },

  {
    q:
      '"Lucknow Mahotsav"',
    type:
      "festival"
  },

  {
    q:
      '"UP Sangeet Natak Akademi" Lucknow',
    type:
      "festival"
  },

  {
    q:
      '"Lucknow" mushaira',
    type:
      "festival"
  },

  {
    q:
      '"Lucknow" monument "new timings"',
    type:
      "timing_change"
  }
];

function decode(value = "") {
  return String(value)
    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/g,
      "$1"
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(
      /&#39;|&apos;/g,
      "'"
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function field(xml, name) {
  const match =
    xml.match(
      new RegExp(
        `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,
        "i"
      )
    );

  return match
    ? decode(match[1])
    : "";
}

function parseRSS(xml) {
  return [
    ...xml.matchAll(
      /<item>([\s\S]*?)<\/item>/gi
    )
  ].map(match => {
    const body =
      match[1];

    return {
      title:
        field(
          body,
          "title"
        ),

      url:
        field(
          body,
          "link"
        ),

      publishedAt:
        field(
          body,
          "pubDate"
        ),

      source:
        field(
          body,
          "source"
        )
    };
  });
}

async function runQuery(query) {
  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(
      `${query.q} when:14d`
    ) +
    "&hl=en-IN&gl=IN&ceid=IN:en";

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
      `Google News HTTP ${response.status}`
    );
  }

  const xml =
    await response.text();

  return parseRSS(xml)
    .slice(0, 8)
    .map(item => {
      const title =
        clean(
          item.title
        ).replace(
          /\s+-\s+[^-]+$/,
          ""
        );

      return {
        title,

        source:
          clean(
            item.source
          ) ||
          "News source",

        sourceUrl:
          item.url,

        sourcePriority:
          PRIORITY.NEWS,

        publishedAt:
          item.publishedAt,

        eventStart:
          null,

        eventEnd:
          null,

        type:
          query.type
      };
    })
    .filter(item => {
      /*
       * Google News query matching is fuzzy.
       * Never trust the query itself as proof of category.
       * The actual headline must contain:
       *   1. a Lucknow/location term
       *   2. a real term for the requested category
       *   3. no hard-block junk
       */
      const locationMatch =
        containsAny(
          item.title,
          LUCKNOW_TERMS
        );

      const categoryMatch =
        containsAny(
          item.title,
          CATEGORY_TERMS[query.type] || []
        );

      const blocked =
        containsAny(
          item.title,
          HARD_BLOCK
        );

      return (
        locationMatch &&
        categoryMatch &&
        !blocked
      );
    });
}

export async function fetchNewsFallback() {
  const results =
    await Promise.allSettled(
      QUERIES.map(
        runQuery
      )
    );

  return results.flatMap(
    result =>
      result.status ===
      "fulfilled"
        ? result.value
        : []
  );
}
