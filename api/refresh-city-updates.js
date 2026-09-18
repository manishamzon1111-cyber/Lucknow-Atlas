import {
  refreshCityUpdates
} from "../lib/city-updates/refresh.js";

export default async function handler(
  req,
  res
) {
  const secret =
    process.env.CRON_SECRET;

  if (secret) {
    const auth =
      req.headers.authorization ||
      "";

    if (
      auth !==
      `Bearer ${secret}`
    ) {
      return res
        .status(401)
        .json({
          error:
            "Unauthorized"
        });
    }
  }

  try {
    const result =
      await refreshCityUpdates();

    return res
      .status(200)
      .json({
        ok:
          true,

        count:
          result.items.length,

        generatedAt:
          result.generatedAt,

        sources:
          result.sources,

        updates:
          result.items
      });

  } catch (error) {
    console.error(error);

    return res
      .status(500)
      .json({
        ok:
          false,

        error:
          String(
            error?.message ||
            error
          )
      });
  }
}
