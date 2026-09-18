import {
  fetchBhatkhande
} from "./bhatkhande.js";

import {
  fetchLucknowNic
} from "./lucknowNic.js";

import {
  fetchHappeningNext
} from "./happeningNext.js";

import {
  fetchNewsFallback
} from "./news.js";

import {
  processItems
} from "./utils.js";

import {
  getSourceCache,
  setSourceCache,
  setSnapshot
} from "./store.js";

const SOURCES = [
  {
    name:
      "bhatkhande",

    fetcher:
      fetchBhatkhande,

    allowEmpty:
      false
  },

  {
    name:
      "lucknowNic",

    fetcher:
      fetchLucknowNic,

    allowEmpty:
      false
  },

  {
    name:
      "events",

    fetcher:
      fetchHappeningNext,

    allowEmpty:
      false
  },

  {
    name:
      "news",

    fetcher:
      fetchNewsFallback,

    allowEmpty:
      true
  }
];

async function fetchSource(source) {
  try {
    const items =
      await source.fetcher();

    if (
      !source.allowEmpty &&
      !items.length
    ) {
      throw new Error(
        `${source.name} returned zero items`
      );
    }

    await setSourceCache(
      source.name,
      items
    );

    return {
      name:
        source.name,

      ok:
        true,

      cached:
        false,

      count:
        items.length,

      items
    };

  } catch (error) {
    let cached = null;

    try {
      cached =
        await getSourceCache(
          source.name
        );
    } catch {}

    return {
      name:
        source.name,

      ok:
        false,

      cached:
        Boolean(
          cached?.items
        ),

      count:
        Array.isArray(
          cached?.items
        )
          ? cached.items.length
          : 0,

      error:
        String(
          error?.message ||
          error
        ),

      items:
        Array.isArray(
          cached?.items
        )
          ? cached.items
          : []
    };
  }
}

export async function refreshCityUpdates() {
  const sources =
    await Promise.all(
      SOURCES.map(
        fetchSource
      )
    );

  const raw =
    sources.flatMap(
      source =>
        source.items
    );

  const items =
    processItems(raw);

  const snapshot = {
    generatedAt:
      new Date()
        .toISOString(),

    items,

    sources:
      Object.fromEntries(
        sources.map(
          source => [
            source.name,
            {
              ok:
                source.ok,

              cached:
                source.cached,

              count:
                source.count,

              error:
                source.error ||
                null
            }
          ]
        )
      )
  };

  await setSnapshot(
    snapshot
  );

  return snapshot;
}
