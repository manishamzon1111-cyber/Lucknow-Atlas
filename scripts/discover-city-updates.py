from __future__ import annotations

import hashlib
import html
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus, urljoin

import feedparser
import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = ROOT / "seen_urls.json"

OUT = ROOT / ".city-updates"
OUT.mkdir(exist_ok=True)

CANDIDATES_FILE = OUT / "candidates.json"
REVIEW_FILE = OUT / "review.md"
NEXT_STATE_FILE = OUT / "seen-next.json"
RESULT_FILE = OUT / "result.env"

USER_AGENT = "LucknowAtlas/1.0"
TIMEOUT = 25
MAX_CANDIDATES = 15
MAX_AGE_DAYS = 45


DIRECT_SOURCES = [
    {
        "name": "Lucknow District Administration",
        "url": "https://lucknow.nic.in/past-notices/notices/",
        "kind": "district",
    },
    {
        "name": "Bhatkhande Sanskriti Vishwavidyalaya — Notices",
        "url": "https://www.bhatkhandeuniversity.ac.in/en/feature/notices-announcements",
        "kind": "bhatkhande",
    },
    {
        "name": "Bhatkhande Sanskriti Vishwavidyalaya — Press releases",
        "url": "https://www.bhatkhandeuniversity.ac.in/en/pressrelease",
        "kind": "bhatkhande",
    },
]


RSS_QUERIES = [
    '"Lucknow" "heritage walk"',
    '"Lucknow" exhibition',
    '"Lucknow" cultural festival',
    '"Lucknow" mahotsav',
    '"Lucknow" museum exhibition',
    '"State Museum Lucknow" exhibition',
    '"Bhatkhande" Lucknow festival',
    '"Sanatkada" Lucknow',
    '"UP Tourism" Lucknow event',
    '"Lucknow" ("traffic diversion" OR "route diverted")',
    '("Rumi Darwaza" OR "Bara Imambara" OR "Chota Imambara" OR "British Residency") (closed OR closure OR restoration)',
]


GEO_TERMS = [
    "lucknow",
    "bara imambara",
    "bada imambara",
    "chota imambara",
    "chhota imambara",
    "rumi darwaza",
    "british residency",
    "lucknow residency",
    "kaiserbagh",
    "qaiserbagh",
    "chowk",
    "hazratganj",
    "aminabad",
    "gomti",
]


STRONG_TERMS = [
    "heritage walk",
    "exhibition",
    "cultural festival",
    "heritage festival",
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
    "timing change",
    "cultural programme",
    "cultural program",
    "theatre festival",
    "samaroh",
]


BHATKHANDE_TERMS = [
    "festival",
    "mahotsav",
    "samaroh",
    "exhibition",
    "heritage",
    "cultural programme",
    "cultural program",
    "public performance",
    "concert",
]


DISTRICT_TERMS = [
    "heritage",
    "festival",
    "mahotsav",
    "monument",
    "closure",
    "closed",
    "diversion",
    "traffic",
    "tourism",
    "cultural",
    "museum",
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
    "political rally",
    "party worker",
    "bjp",
    "congress",
    "samajwadi",
    "bahujan",

    "vacancy",
    "recruitment",
    "advertisement",
    "engagement of",
    "appointment",
    "interview",
    "admission",
    "academic session",
    "exam",
    "examination",
    "result",
    "hostel",
    "semester",
    "syllabus",
    "guest accompanist",
    "tender",
    "quotation",

    "sports competition",
    "sports meet",
    "tournament",
    "athletics",

    "rojgar",
    "employment fair",
    "job fair",

    "property",
    "real estate",
    "stock market",
    "saplings",
    "plantation",
    "mango variety",

    "ayodhya",
    "faizabad",
    "bhopal",
    "kanpur",
    "dehradun",
    "sambhajinagar",
    "azamgarh",
]


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


def clean(value):
    value = html.unescape(str(value or ""))
    return re.sub(r"\s+", " ", value).strip()


def norm(value):
    value = clean(value).lower()
    value = re.sub(r"[^a-z0-9\u0900-\u097f]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def contains(text, terms):
    n = norm(text)
    return [term for term in terms if norm(term) in n]


def blocked(text):
    return bool(contains(text, BLOCK_TERMS))


def has_geo(text):
    return bool(contains(text, GEO_TERMS))


def fingerprint(title, source, url):
    raw = f"{norm(title)}|{norm(source)}|{clean(url)}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def load_seen():
    if not STATE_FILE.exists():
        return set()

    data = json.loads(STATE_FILE.read_text())

    if not isinstance(data, dict):
        raise RuntimeError("seen_urls.json must be an object")

    seen = data.get("seen", [])

    if not isinstance(seen, list):
        raise RuntimeError("seen_urls.json seen must be an array")

    return {str(x) for x in seen if x}


def get(url):
    r = requests.get(
        url,
        timeout=TIMEOUT,
        allow_redirects=True,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xml,*/*"
        }
    )
    r.raise_for_status()
    return r


def rss_date(value):
    try:
        dt = parsedate_to_datetime(clean(value))
        if not dt:
            return None

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def fresh_rss(value):
    dt = rss_date(value)

    if not dt:
        return False

    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    return dt >= cutoff


def make_candidate(
    title,
    url,
    source,
    published="",
    via="",
    matched=None
):
    title = clean(title)
    url = clean(url)
    source = clean(source)

    if len(title) < 8:
        return None

    if not url.startswith(("http://", "https://")):
        return None

    return {
        "id": fingerprint(title, source, url),
        "title": title,
        "url": url,
        "source": source,
        "published": clean(published)[:120],
        "matched": matched or [],
        "via": via,
    }


def extract_direct(source):
    r = get(source["url"])
    soup = BeautifulSoup(r.text, "html.parser")

    nodes = list(soup.select(
        "tr, article, .views-row, .news-item, "
        ".notice-item, .press-release, .item-list li"
    ))

    if not nodes:
        nodes = list(soup.select("a[href]"))

    output = []
    local_ids = set()

    allowed = (
        BHATKHANDE_TERMS
        if source["kind"] == "bhatkhande"
        else DISTRICT_TERMS
    )

    for node in nodes:
        text = clean(node.get_text(" ", strip=True))

        if len(text) < 8:
            continue

        if blocked(text):
            continue

        matched = contains(text, allowed)

        if not matched:
            continue

        link = node.select_one("a[href]")

        if link:
            href = clean(link.get("href"))
            title = clean(link.get_text(" ", strip=True))
        elif getattr(node, "name", "") == "a":
            href = clean(node.get("href"))
            title = clean(node.get_text(" ", strip=True))
        else:
            href = ""
            title = ""

        if not title:
            title = text[:220]

        if blocked(title):
            continue

        title_matches = contains(title, allowed)

        if not title_matches:
            continue

        url = urljoin(source["url"], href) if href else source["url"]

        date_match = DATE_RE.search(text)
        published = date_match.group(1) if date_match else ""

        item = make_candidate(
            title=title,
            url=url,
            source=source["name"],
            published=published,
            via="Official source",
            matched=title_matches[:5],
        )

        if not item:
            continue

        if item["id"] in local_ids:
            continue

        local_ids.add(item["id"])
        output.append(item)

        if len(output) >= 15:
            break

    return output


def google_news_url(query):
    return (
        "https://news.google.com/rss/search?"
        f"q={quote_plus(query)}"
        "&hl=en-IN&gl=IN&ceid=IN:en"
    )


def extract_rss(query):
    r = get(google_news_url(query))
    feed = feedparser.parse(r.content)

    if getattr(feed, "bozo", False) and not getattr(feed, "entries", []):
        raise RuntimeError(f"RSS parse failed: {query}")

    output = []

    for entry in feed.entries[:40]:
        title = clean(getattr(entry, "title", ""))
        url = clean(getattr(entry, "link", ""))
        published = clean(getattr(entry, "published", ""))

        if not fresh_rss(published):
            continue

        if blocked(title):
            continue

        if not has_geo(title):
            continue

        matched = contains(title, STRONG_TERMS)

        if not matched:
            continue

        source_name = ""

        source_obj = getattr(entry, "source", None)

        if source_obj:
            try:
                source_name = clean(source_obj.get("title", ""))
            except Exception:
                pass

        if not source_name:
            parts = title.rsplit(" - ", 1)

            if len(parts) == 2:
                source_name = clean(parts[-1])

        item = make_candidate(
            title=title,
            url=url,
            source=source_name or "Google News",
            published=published,
            via="Google News RSS",
            matched=matched[:5],
        )

        if item:
            output.append(item)

    return output


def title_key(title):
    title = re.sub(r"\s+-\s+[^-]+$", "", title)
    return norm(title)


def topic_key(title):
    t = norm(title)

    topic_patterns = [
        ("gomti book festival", "gomti-book-festival"),
        ("sanatkada", "sanatkada"),
        ("awadh mahotsav", "awadh-mahotsav"),
        ("mango festival", "mango-festival"),
        ("state museum", "state-museum"),
        ("heritage walk", "heritage-walk"),
        ("rumi darwaza", "rumi-darwaza"),
        ("bara imambara", "bara-imambara"),
        ("bada imambara", "bara-imambara"),
        ("chota imambara", "chota-imambara"),
        ("chhota imambara", "chota-imambara"),
        ("british residency", "british-residency"),
        ("lucknow residency", "british-residency"),
        ("bhatkhande", "bhatkhande"),
    ]

    for needle, key in topic_patterns:
        if needle in t:
            return key

    words = [
        w for w in t.split()
        if w not in {
            "lucknow", "news", "today", "latest",
            "the", "a", "an", "in", "at", "for",
            "to", "of", "and", "on", "with"
        }
    ]

    return " ".join(words[:8])


def main():
    seen = load_seen()

    collected = []
    failures = []

    for source in DIRECT_SOURCES:
        try:
            rows = extract_direct(source)
            collected.extend(rows)

            print(
                f"{source['name']}: "
                f"{len(rows)} candidate(s)"
            )

        except Exception as exc:
            msg = f"{source['name']}: {type(exc).__name__}: {exc}"
            failures.append(msg)
            print(f"WARNING: {msg}", file=sys.stderr)

    for query in RSS_QUERIES:
        try:
            rows = extract_rss(query)
            collected.extend(rows)

            print(
                f"RSS {query}: "
                f"{len(rows)} candidate(s)"
            )

        except Exception as exc:
            msg = f"Google News RSS [{query}]: {type(exc).__name__}: {exc}"
            failures.append(msg)
            print(f"WARNING: {msg}", file=sys.stderr)

    collected.sort(
        key=lambda item: (
            0 if item["via"] == "Official source" else 1,
            item["title"].lower()
        )
    )

    deduped = {}

    for item in collected:
        key = topic_key(item["title"])

        if key and key not in deduped:
            deduped[key] = item

    new_items = [
        item
        for item in deduped.values()
        if item["id"] not in seen
    ][:MAX_CANDIDATES]

    CANDIDATES_FILE.write_text(
        json.dumps(new_items, indent=2, ensure_ascii=False) + "\n"
    )

    next_seen = set(seen)

    for item in new_items:
        next_seen.add(item["id"])

    if len(next_seen) > 3000:
        next_seen = set(sorted(next_seen)[-3000:])

    NEXT_STATE_FILE.write_text(
        json.dumps(
            {"seen": sorted(next_seen)},
            indent=2,
            ensure_ascii=False
        ) + "\n"
    )

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    lines = [
        "# City updates review",
        "",
        f"Run: {today}",
        "",
    ]

    if new_items:
        lines += ["## New candidates", ""]

        for item in new_items:
            lines.append(f"- [ ] **{item['title']}**")
            lines.append(f"  - Source: {item['source']}")

            if item["published"]:
                lines.append(f"  - Date: {item['published']}")

            lines.append(f"  - Found via: {item['via']}")

            if item["matched"]:
                lines.append(
                    "  - Matched: " + ", ".join(item["matched"])
                )

            lines.append(f"  - {item['url']}")
            lines.append("")
    else:
        lines += ["No new candidates.", ""]

    if failures:
        lines += ["## Fetch problems", ""]

        for failure in failures:
            lines.append(f"- `{failure}`")

        lines.append("")

    REVIEW_FILE.write_text("\n".join(lines).rstrip() + "\n")

    create_issue = bool(new_items) or bool(failures)

    RESULT_FILE.write_text(
        "\n".join([
            f"create_issue={'1' if create_issue else '0'}",
            f"candidate_count={len(new_items)}",
            f"failure_count={len(failures)}",
        ]) + "\n"
    )

    print()
    print(f"New candidates: {len(new_items)}")
    print(f"Fetch problems: {len(failures)}")


if __name__ == "__main__":
    main()
