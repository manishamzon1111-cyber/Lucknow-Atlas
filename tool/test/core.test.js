import test from "node:test";
import assert from "node:assert/strict";
import {
  coordinateConsensus,
  distanceMetres,
  entityMatches,
  parseIssue,
  shortSlug,
  slugify,
  validateDraft,
} from "../server.js";

test("rejects fuzzy results for a different entity", () => {
  assert.equal(entityMatches("Avadh Club", "Awana"), false);
  assert.equal(
    entityMatches("Avadh Club", "Avadh Club - Jankipuram, Lucknow"),
    true,
  );
  assert.equal(entityMatches("Avadh Club", "Awadh Club wedding lawn"), true);
  assert.equal(
    entityMatches("IIM Lucknow", "Indian Institute of Management Lucknow"),
    true,
  );
});

test("parses the repository suggestion format", () => {
  const issue = parseIssue({
    number: 3,
    title: "Place suggestion: IIM Lucknow",
    html_url: "https://example.test/3",
    body: "**Name:** IIM Lucknow\n**Category:** Other\n**Location / Maps link:** IIM Lucknow\n\n## Why it should be included\n\nOne of the top B schools in the country\n\n## Source / photo",
  });
  assert.equal(issue.name, "IIM Lucknow");
  assert.equal(issue.category, "Other");
  assert.match(issue.reason, /top B schools/);
});

test("creates safe short folder and data slugs", () => {
  assert.equal(
    slugify("La Martinière College, Lucknow"),
    "la-martiniere-college-lucknow",
  );
  assert.match(shortSlug("la-martiniere-college-lucknow"), /^[a-z0-9]+$/);
});

test("rejects duplicate names and implausible coordinates", () => {
  const valid = {
    id: "new-place",
    name: "New Place",
    category: "Other",
    summary: "Verified summary.",
    mapsQuery: "New Place, Lucknow",
    coordSource: "https://example.test",
    lat: 26.8,
    lng: 80.9,
  };
  assert.doesNotThrow(() => validateDraft(valid, []));
  assert.throws(
    () =>
      validateDraft({ ...valid, name: "Known" }, [
        { id: "known", name: "Known" },
      ]),
    /already exists/,
  );
  assert.throws(() => validateDraft({ ...valid, lat: 20 }), /Latitude/);
});

test("requires two independent coordinate providers within 250 metres", () => {
  const matching = coordinateConsensus([
    { provider: "Wikipedia", lat: 26.831, lng: 80.954 },
    { provider: "Google Maps via Serper", lat: 26.8309569, lng: 80.9539356 },
    { provider: "OpenStreetMap", lat: 26.85, lng: 80.95 },
  ]);
  assert.equal(matching.verified, true);
  assert.deepEqual(
    new Set(matching.providers),
    new Set(["Wikipedia", "Google Maps via Serper"]),
  );
  assert.ok(
    distanceMetres(matching.candidates[0], matching.candidates[1]) < 10,
  );
  assert.ok(matching.candidates[2].agrees === false);

  const singleSource = coordinateConsensus([
    { provider: "Wikipedia", lat: 26.831, lng: 80.954 },
    { provider: "Wikipedia", lat: 26.83101, lng: 80.95401 },
  ]);
  assert.equal(singleSource.verified, false);
});
