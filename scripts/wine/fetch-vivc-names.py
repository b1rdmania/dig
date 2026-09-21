#!/usr/bin/env python3
"""Pull every VIVC cultivar name (prime names and synonyms) into one CSV.

The VIVC cultivar-name search is server-rendered HTML. A "%" wildcard returns
all names (81,037 on 2026-09-21). This script pages through it at 500 rows a
page, keeps the raw HTML for provenance, and writes:

  data/wine/raw/grapes-catalogues/vivc/vivc-cultivar-names.csv
    cultivar_name, prime_name, vivc_number, species, colour, country

One request at a time, 2 s pause. Resumable: a page already on disk is not
fetched again.

  python3 scripts/wine/fetch-vivc-names.py
"""
import csv
import hashlib
import html
import json
import re
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "data" / "wine" / "raw" / "grapes-catalogues" / "vivc"
PAGES = ROOT / "raw-html-names"
OUT = ROOT / "vivc-cultivar-names.csv"
URL = ("https://www.vivc.de/index.php?r=cultivarname%2Findex"
       "&CultivarnameSearch%5Bcultivarnames%5D=cultivarn&CultivarnameSearch%5Btext%5D=%25"
       "&per-page=500&page={page}")
ROW = re.compile(r"<tr[^>]*data-key[^>]*>(.*?)</tr>", re.S)
CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TOTAL = re.compile(r"of <b>([\d,]+)</b> items")


def fetch(page: int) -> str:
    path = PAGES / f"names-page{page}.html"
    if path.exists() and path.stat().st_size > 50_000:
        return path.read_text(encoding="utf8", errors="ignore")
    # curl, not urllib: the macOS framework python3 ships without a CA bundle.
    cmd = ["curl", "-sS", "-L", "-m", "180", "-A", "Mozilla/5.0 (wine-bore corpus pull)", URL.format(page=page)]
    for attempt in range(4):
        try:
            body = subprocess.run(cmd, capture_output=True, check=True).stdout.decode("utf8", errors="ignore")
            if ROW.search(body):
                path.write_text(body, encoding="utf8")
                time.sleep(2)
                return body
        except Exception as e:  # noqa: BLE001 - retry any transport error
            print(f"page {page} attempt {attempt + 1}: {e}", file=sys.stderr)
        time.sleep(10 * (attempt + 1))
    raise SystemExit(f"page {page} failed four times")


def cells(row: str) -> list[str]:
    return [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in CELL.findall(row)]


def main() -> None:
    PAGES.mkdir(parents=True, exist_ok=True)
    first = fetch(1)
    m = TOTAL.search(first)
    if not m:
        raise SystemExit("no total on page 1")
    total = int(m.group(1).replace(",", ""))
    pages = (total + 499) // 500
    rows: list[list[str]] = []
    for p in range(1, pages + 1):
        body = first if p == 1 else fetch(p)
        for r in ROW.findall(body):
            c = cells(r)
            if len(c) >= 6:
                rows.append(c[:6])
        if p % 10 == 0:
            print(f"page {p}/{pages} rows={len(rows)}", flush=True)
    with OUT.open("w", newline="", encoding="utf8") as f:
        w = csv.writer(f)
        w.writerow(["cultivar_name", "prime_name", "vivc_number", "species", "colour", "country"])
        w.writerows(rows)
    sha = hashlib.sha256(OUT.read_bytes()).hexdigest()
    (ROOT / "manifest-names.json").write_text(json.dumps({
        "source": "VIVC cultivar-name search (prime names and synonyms)",
        "url": URL.format(page=1),
        "fetched": date.today().isoformat(),
        "total_reported": total,
        "rows_written": len(rows),
        "file": OUT.name,
        "sha256": sha,
        "citation": "Roeckel et al. (2026): Vitis International Variety Catalogue - www.vivc.de",
    }, indent=1))
    print(f"total={total} rows={len(rows)} sha256={sha}")


if __name__ == "__main__":
    main()
