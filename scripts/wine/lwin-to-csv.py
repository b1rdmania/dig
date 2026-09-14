#!/usr/bin/env python3
"""One-off: LWINdatabase.xlsx -> lwin.csv (same columns, UTF-8, dates ISO).
The loaders are TypeScript; xlsx parsing is the only step done in Python.
Usage: python3 scripts/wine/lwin-to-csv.py"""
import csv, datetime, openpyxl, os, sys, warnings
warnings.filterwarnings("ignore")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "wine", "raw", "lwin")
wb = openpyxl.load_workbook(os.path.join(ROOT, "LWINdatabase.xlsx"), read_only=True)
ws = wb[wb.sheetnames[0]]
n = 0
with open(os.path.join(ROOT, "lwin.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    for row in ws.iter_rows(values_only=True):
        out = []
        for v in row:
            if isinstance(v, float) and v.is_integer(): v = int(v)
            if isinstance(v, datetime.datetime): v = v.isoformat()
            out.append("" if v is None else v)
        w.writerow(out); n += 1
print("rows", n - 1)
