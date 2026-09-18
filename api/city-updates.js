import {
  getSnapshot
} from "../lib/city-updates/store.js";

export default async function handler(
  req,
  res
) {
  try {
    const snapshot =
      await getSnapshot();

    const items =
      Array.isArray(
        snapshot?.items
      )
        ? snapshot.items
        : [];

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=21600"
    );

    return res
      .status(200)
      .json(items);

  } catch (error) {
    console.error(error);

    return res
      .status(200)
      .json([]);
  }
}
