import logging
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from ..db import RAW_DIR

logger = logging.getLogger(__name__)


def fetch_url(url: str) -> dict:
    import requests
    from bs4 import BeautifulSoup

    resp = requests.get(url, timeout=30, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()

    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    if not title:
        h1 = soup.find("h1")
        if h1:
            title = h1.get_text(strip=True)

    article = soup.find("article") or soup.find("main") or soup.find("body")
    text = article.get_text(separator="\n", strip=True) if article else soup.get_text(separator="\n", strip=True)

    lines = [line.strip() for line in text.splitlines()]
    text = "\n".join(line for line in lines if line)

    return {"title": title, "text": text, "url": url, "html": resp.text}


def ingest_url(url: str) -> dict:
    parsed = urlparse(url)
    domain = parsed.netloc.replace("www.", "").replace(".", "-")
    path_slug = re.sub(r'[^a-z0-9]+', '-', parsed.path.lower()).strip('-')[:60]
    filename = f"{domain}_{path_slug}.html" if path_slug else f"{domain}.html"

    fetched = fetch_url(url)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    file_path = RAW_DIR / filename

    md_content = f"# {fetched['title']}\n\nSource: {url}\nFetched: {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}\n\n---\n\n{fetched['text']}"
    file_path.write_text(md_content, encoding="utf-8")

    actual_filename = filename.replace(".html", ".md")
    md_path = RAW_DIR / actual_filename
    if file_path != md_path:
        file_path.rename(md_path)

    return {"filename": actual_filename, "title": fetched["title"], "url": url, "chars": len(fetched["text"])}
