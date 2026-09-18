import {
  Redis
} from "@upstash/redis";

const SNAPSHOT =
  "lucknow-atlas:city-updates:snapshot";

const SOURCE_PREFIX =
  "lucknow-atlas:city-updates:source:";

function getRedis() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL;

  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN;

  if (
    !url ||
    !token
  ) {
    throw new Error(
      "Upstash Redis environment variables missing"
    );
  }

  return new Redis({
    url,
    token
  });
}

export async function getSnapshot() {
  return (
    getRedis()
      .get(SNAPSHOT)
  );
}

export async function setSnapshot(snapshot) {
  return (
    getRedis()
      .set(
        SNAPSHOT,
        snapshot
      )
  );
}

export async function getSourceCache(name) {
  return (
    getRedis()
      .get(
        `${SOURCE_PREFIX}${name}`
      )
  );
}

export async function setSourceCache(
  name,
  items
) {
  return (
    getRedis()
      .set(
        `${SOURCE_PREFIX}${name}`,
        {
          savedAt:
            new Date()
              .toISOString(),

          items
        }
      )
  );
}
