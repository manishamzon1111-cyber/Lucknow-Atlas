from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus, urljoin

import feedparser
import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = ROOT / "seen_urls.json"
OUT_DIR = ROOT / ".city-updates"

OUT_DIR.mkdir(exist_ok=True)

CANDIDATES_FILE = OUT_DIR / "candidates.json"
REVIEW_FILE = OUT_DIR / "review.md"
NEXT_STATE_FILE = OUT_DIR / "seen-next.json"
RESULT_FILE = OUT_DIR / "result.env"

USER_AGENT = (
    "LucknowAtlas/1.0 "
    "(public heritage map; update discovery)"
)

TIMEOUT = 25
MAX_CANDIDATES = 25


# ------------------------------------------------------------
# SOURCES
# ------------------------------------------------------------

DIRECT_SOURCES = [
    {
        "name": "Lucknow District Administration",
        "url": "https://lucknow.nic.in/past-notices/notices/",
        "kind": "official",
    },
    {
        "name": "Bhatkhande Sanskriti Vishwavidyalaya — Notices",
        "url": "https://www.bhatkhandeuniversity.ac.in/en/feature/notices-announcements",
        "kind": "official",
    },
    {
        "name": "Bhatkhande Sanskriti Vishwavidyalaya — Press releases",
        "url": "https://www.bhatkhandeuniversity.ac.in/en/pressrelease",
        "kind": "official",
    },
]

RSS_QUERIES = [
    '"Lucknow" "heritage walk"',
    '"Lucknow" (exhibition OR festival OR mahotsav)',
    '"Lucknow" ("traffic diversion" OR "route diverted")',
    '("Rumi Darwaza" OR "Bara Imambara" OR "Chota Imambara" OR "British Residency") (closed OR closure OR restoration)',
    '"State Museum Lucknow" exhibition',
]


ALLOW_TERMS = [
    "heritage",
    "heritage walk",
    "walk",
    "exhibition",
    "exhibit",
    "festival",
    "mahotsav",
    "museum",
    "monument",
    "closed",
    "closure",
    "restoration",
    "renovation",
    "conservation",
    "restricted access",
    "traffic diversion",
    "route diverted",
    "diversion",
    "timing",
    "cultural",
    "culture",
    "tourism",
    "performance",
    "music",
    "dance",
    "theatre",
    "program",
    "programme",
    "samaroh",
]

BLOCK_TERMS = [
    "murder",
    "crime",
    "fir",
    "arrest",
    "robbery",
    "assault",
    "rape",
    "election",
    "candidate",
    "bjp",
    "congress",
    "samajwadi",
    "bahujan",
    "political rally",
    "party worker",
    "vacancy",
    "recruitment",
    "admission",
    "exam",
    "result",
    "hostel",
    "tender",
    "quotation",
    "property",
    "real estate",
    "stock market",
]


# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------

def clean(value: object) -> str:
    text = html.unescape(str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def normalize(value: str) -> str:
    value = clean(value).lower()
    value = re.sub(r"[^a-z0-9\u0900-\u097f]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def fingerprint(title: str, source: str, url: str) -> str:
    raw = " | ".join([
        normalize(title),
        normalize(source),
        clean(url),
    ])

    return hashlib.sha256(
        raw.encode("utf-8")
    ).hexdigest()[:24]


def relevant(text: str) -> tuple[bool, list[str]]:
    normalized = normalize(text)

    blocked = [
        term
        for term in BLOCK_TERMS
        if normalize(term) in normalized
    ]

    if blocked:
        return False, []

    matched = [
        term
        for term in ALLOW_TERMS
        if normalize(term) in normalized
    ]

    return bool(matched), matched[:6]


def safe_date(value: object) -> str:
    value = clean(value)

    if not value:
        return ""

    return value[:120]


def load_seen() -> set[str]:
    try:
        data = json.loads(
            STATE_FILE.read_text(encoding="utf-8")
        )
    except FileNotFoundError:
        return set()

    except Exception as exc:
        raise RuntimeError(
            f"Could not parse seen_urls.json: {exc}"
        )

    if not isinstance(data, dict):
        raise RuntimeError(
            "seen_urls.json must contain an object"
        )

    seen = data.get("seen", [])

    if not isinstance(seen, list):
        raise RuntimeError(
            "seen_urls.json 'seen' must be an array"
        )

    return {
        str(item)
        for item in seen
        if item
    }


def get(url: str) -> requests.Response:
    response = requests.get(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": (
                "text/html,application/xhtml+xml,"
                "application/xml;q=0.9,*/*;q=0.8"
            ),
        },
        timeout=TIMEOUT,
        allow_redirects=True,
    )

    response.raise_for_status()
    return response


def candidate(
    *,
    title: str,
    url: str,
    source: str,
    published: str = "",
    snippet: str = "",
    via: str,
) -> dict | None:

    title = clean(title)
    url = clean(url)
    source = clean(source)
    snippet = clean(snippet)

    if len(title) < 8:
        return None

    if not url.startswith(("http://", "https://")):
        return None

    combined = f"{title} {snippet}"

    ok, matched = relevant(combined)

    if not ok:
        return None

    item_id = fingerprint(
        title,
        source,
        url,
    )

    return {
        "id": item_id,
        "title": title,
        "url": url,
        "source": source,
        "published": safe_date(published),
        "matched": matched,
        "via": via,
    }


# ------------------------------------------------------------
# DIRECT OFFICIAL HTML
# ------------------------------------------------------------

DATE_RE = re.compile(
    r"\b("
    r"\d{1,2}[./-]\d{1,2}[./-]\d{2,4}"
    r"|"
    r"\d{1,2}\s+"
    r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
    r"[a-z]*\s+\d{4}"
    r")\b",
    re.I,
)


def extract_direct(source: dict) -> list[dict]:
    response = get(source["url"])

    soup = BeautifulSoup(
        response.text,
        "html.parser",
    )

    output: list[dict] = []
    local_seen: set[str] = set()

    # First preference: table rows.
    containers = list(soup.select("tr"))

    # Also support common CMS/list layouts.
    containers.extend(
        soup.select(
            "article, "
            ".views-row, "
            ".news-item, "
            ".notice-item, "
            ".press-release, "
            ".item-list li"
        )
    )

    # Last-resort fallback: useful anchors.
    if not containers:
        containers = list(soup.select("a[href]"))

    for container in containers:
        text = clean(
            container.get_text(
                " ",
                strip=True,
            )
        )

        if len(text) < 8:
            continue

        ok, _ = relevant(text)

        if not ok:
            continue

        link = container.select_one("a[href]")

        if link:
            href = clean(link.get("href"))
            title = clean(link.get_text(" ", strip=True))
        elif getattr(container, "name", "") == "a":
            href = clean(container.get("href"))
            title = clean(container.get_text(" ", strip=True))
        else:
            href = ""
            title = ""

        if not title:
            # Keep title compact rather than using an entire row.
            title = text[:220]

        url = (
            urljoin(source["url"], href)
            if href
            else source["url"]
        )

        match = DATE_RE.search(text)
        published = match.group(1) if match else ""

        item = candidate(
            title=title,
            url=url,
            source=source["name"],
            published=published,
            snippet=text,
            via="direct",
        )

        if not item:
            continue

        if item["id"] in local_seen:
            continue

        local_seen.add(item["id"])
        output.append(item)

        if len(output) >= 20:
            break

    return output


# ------------------------------------------------------------
# GOOGLE NEWS RSS
# ------------------------------------------------------------

def google_news_url(query: str) -> str:
    return (
        "https://news.google.com/rss/search?"
        f"q={quote_plus(query)}"
        "&hl=en-IN"
        "&gl=IN"
        "&ceid=IN:en"
    )


def extract_rss(query: str) -> list[dict]:
    url = google_news_url(query)

    response = get(url)

    feed = feedparser.loads(
        response.content
    )

    if getattr(feed, "bozo", False):
        # Some feeds set bozo for harmless encoding issues.
        # Only fail if there are no usable entries.
        if not getattr(feed, "entries", []):
            raise RuntimeError(
                f"RSS parse failed for query: {query}"
            )

    output: list[dict] = []

    for entry in feed.entries[:30]:
        title = clean(
            getattr(entry, "title", "")
        )

        link = clean(
            getattr(entry, "link", "")
        )

        summary = clean(
            getattr(entry, "summary", "")
        )

        published = clean(
            getattr(entry, "published", "")
        )

        source_name = ""

        source_obj = getattr(
            entry,
            "source",
            None,
        )

        if source_obj:
            try:
                source_name = clean(
                    source_obj.get(
                        "title",
                        ""
                    )
                )
            except Exception:
                source_name = ""

        if not source_name:
            # Google News titles often end with " - Publisher".
            parts = title.rsplit(" - ", 1)

            if len(parts) == 2:
                source_name = clean(parts[1])

        source_name = (
            source_name
            or "Google News"
        )

        item = candidate(
            title=title,
            url=link,
            source=source_name,
            published=published,
            snippet=summary,
            via="Google News RSS",
        )

        if item:
            output.append(item)

    return output


# ------------------------------------------------------------
# MERGE / REPORT
# ------------------------------------------------------------

def main() -> int:
    seen = load_seen()

    collected: list[dict] = []
    failures: list[str] = []

    for source in DIRECT_SOURCES:
        try:
            rows = extract_direct(source)
            collected.extend(rows)

            print(
                f"{source['name']}: "
                f"{len(rows)} relevant item(s)"
            )

        except Exception as exc:
            message = (
                f"{source['name']}: "
                f"{type(exc).__name__}: {exc}"
            )

            failures.append(message)
            print(
                f"WARNING: {message}",
                file=sys.stderr,
            )

    for query in RSS_QUERIES:
        try:
            rows = extract_rss(query)
            collected.extend(rows)

            print(
                f"RSS {query}: "
                f"{len(rows)} relevant item(s)"
            )

        except Exception as exc:
            message = (
                f"Google News RSS [{query}]: "
                f"{type(exc).__name__}: {exc}"
            )

            failures.append(message)

            print(
                f"WARNING: {message}",
                file=sys.stderr,
            )

    # Prefer direct official results over RSS duplicates.
    collected.sort(
        key=lambda x: (
            0 if x["via"] == "direct" else 1,
            x["title"].lower(),
        )
    )

    unique: dict[str, dict] = {}

    for item in collected:
        title_key = normalize(
            re.sub(
                r"\s+-\s+[^-]+$",
                "",
                item["title"],
            )
        )

        if not title_key:
            continue

        if title_key not in unique:
            unique[title_key] = item

    new_items = [
        item
        for item in unique.values()
        if item["id"] not in seen
    ][:MAX_CANDIDATES]

    CANDIDATES_FILE.write_text(
        json.dumps(
            new_items,
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )

    next_seen = set(seen)

    for item in new_items:
        next_seen.add(item["id"])

    # Prevent unbounded growth while retaining ample history.
    next_seen_sorted = sorted(next_seen)

    if len(next_seen_sorted) > 3000:
        next_seen_sorted = next_seen_sorted[-3000:]

    NEXT_STATE_FILE.write_text(
        json.dumps(
            {
                "seen": next_seen_sorted
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )

    today = datetime.now(
        timezone.utc
    ).strftime("%Y-%m-%d")

    lines = [
        "# City updates review",
        "",
        f"Run: {today}",
        "",
    ]

    if new_items:
        lines.extend([
            "## New candidates",
            "",
        ])

        for item in new_items:
            lines.append(
                f"- [ ] **{item['title']}**"
            )

            lines.append(
                f"  - Source: {item['source']}"
            )

            if item["published"]:
                lines.append(
                    f"  - Date: {item['published']}"
                )

            lines.append(
                f"  - Found via: {item['via']}"
            )

            if item["matched"]:
                lines.append(
                    "  - Matched: "
                    + ", ".join(item["matched"])
                )

            lines.append(
                f"  - {item['url']}"
            )

            lines.append("")

    else:
        lines.extend([
            "No new candidates.",
            "",
        ])

    if failures:
        lines.extend([
            "## Fetch problems",
            "",
        ])

        for failure in failures:
            lines.append(
                f"- `{failure}`"
            )

        lines.append("")

    REVIEW_FILE.write_text(
        "\n".join(lines).rstrip()
        + "\n",
        encoding="utf-8",
    )

    create_issue = (
        bool(new_items)
        or bool(failures)
    )

    RESULT_FILE.write_text(
        "\n".join([
            f"create_issue={'1' if create_issue else '0'}",
            f"candidate_count={len(new_items)}",
            f"failure_count={len(failures)}",
        ]) + "\n",
        encoding="utf-8",
    )

    print()
    print(
        f"New candidates: {len(new_items)}"
    )

    print(
        f"Fetch problems: {len(failures)}"
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
