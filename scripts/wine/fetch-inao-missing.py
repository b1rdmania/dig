#!/usr/bin/env python3
"""Retry the INAO cahier PDFs that failed on the first pull.

`data/wine/raw/inao/cdc/index.csv` marks 30 rows `download_failed_000`. Each
URL used the www.inao.gouv.fr host, which now answers 404. The same path on
extranet.inao.gouv.fr serves the PDF. This script retries those rows on the
extranet host and saves `cdc/<slug>.pdf`. Several slugs share one PDF (the
Echezeaux file holds eight Vosne grands crus); load-appellation-documents.ts
splits it.

Pass 2 covers slugs whose PDF is absent or holds another cahier (INAO's page
for La Tache links the Echezeaux file; chateauneuf-du-pape.pdf is a bundle
without Chateauneuf). INAO names its opposition-procedure drafts
`PNOCDC<Name>.pdf`, so the script tries that name and keeps the file only when
the text names the appellation. A replaced PDF moves to cdc/_superseded/.

Then run extract-inao-text.ts.

  python3 scripts/wine/fetch-inao-missing.py
"""
import csv
import subprocess
import time
from pathlib import Path

CDC = Path(__file__).resolve().parents[2] / "data" / "wine" / "raw" / "inao" / "cdc"
rows = list(csv.DictReader((CDC / "index.csv").open(encoding="utf8")))
got, failed = [], []
for r in rows:
    if r["status"] != "download_failed_000" or not r["pdf_url"].strip():
        continue
    out = CDC / f"{r['slug']}.pdf"
    if out.exists() and out.stat().st_size > 10_000:
        continue
    url = r["pdf_url"].replace("https://www.inao.gouv.fr/", "https://extranet.inao.gouv.fr/").replace(" ", "")
    # curl, not urllib: the macOS framework python3 ships without a CA bundle.
    subprocess.run(["curl", "-sS", "-L", "-m", "120", "-A", "Mozilla/5.0 (wine-bore corpus pull)", "-o", str(out), url], check=False)
    ok = out.exists() and out.read_bytes()[:4] == b"%PDF"
    if ok:
        got.append(r["slug"])
    else:
        out.unlink(missing_ok=True)
        failed.append(r["slug"])
    time.sleep(1)
print(f"pass 1 (extranet host): fetched={len(got)} failed={len(failed)}")
print("fetched:", ", ".join(got))
print("failed:", ", ".join(failed))


# ---- pass 2: guess the PNO file name ----------------------------------------
import re
import unicodedata

TXT = CDC.parent / "cdc-text"
OLD = CDC / "_superseded"


def slugify(name: str) -> str:
    n = unicodedata.normalize("NFKD", name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r"[’'`´]", "", n).lower()
    return re.sub(r"[^a-z0-9]+", "-", n).strip("-")


def names_own_cahier(text: str, slug: str) -> bool:
    """A header line, not a passing mention, must name the slug."""
    for m in re.finditer(r"cahier\s+des\s+charges[^«]{0,120}«\s*([^»]+?)\s*»", text, re.I):
        if slugify(re.sub(r"\s+", " ", m.group(1))) in slug.split("-ou-") + [slug]:
            return len(text) - m.start() > 3000
    return False


def camel(name: str) -> str:
    n = unicodedata.normalize("NFKD", name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    return "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", n) if w)


guessed, still = [], []
for r in rows:
    if r["type"] not in ("AOP", "AOC"):
        continue
    slug = r["slug"]
    txt = TXT / f"{slug}.txt"
    if txt.exists() and names_own_cahier(txt.read_text(encoding="utf8", errors="ignore"), slug):
        continue
    first = r["appellation"].split(" ou ")[0]
    tmp = CDC / f".{slug}.tmp.pdf"
    hit = False
    for stem in dict.fromkeys([camel(first), camel(first).replace("Saint", "St"), camel(first.replace("-", " ").title())]):
        url = f"https://extranet.inao.gouv.fr/fichier/PNOCDC{stem}.pdf"
        subprocess.run(["curl", "-sS", "-L", "-m", "120", "-A", "Mozilla/5.0 (wine-bore corpus pull)", "-o", str(tmp), url], check=False)
        time.sleep(1)
        if not tmp.exists() or tmp.read_bytes()[:4] != b"%PDF":
            continue
        text = subprocess.run(["pdftotext", "-layout", str(tmp), "-"], capture_output=True).stdout.decode("utf8", errors="ignore")
        if names_own_cahier(text, slug):
            OLD.mkdir(exist_ok=True)
            pdf = CDC / f"{slug}.pdf"
            if pdf.exists():
                pdf.rename(OLD / pdf.name)
            if txt.exists():
                txt.rename(OLD / txt.name)
            tmp.rename(pdf)
            guessed.append(f"{slug} <- PNOCDC{stem}.pdf")
            hit = True
            break
    tmp.unlink(missing_ok=True)
    if not hit:
        still.append(slug)
print(f"pass 2 (PNOCDC name): fetched={len(guessed)} still_missing={len(still)}")
for g in guessed:
    print("  ", g)
print("still missing:", ", ".join(still))
