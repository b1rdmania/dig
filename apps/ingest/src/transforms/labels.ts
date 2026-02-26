/**
 * Canonical transform: raw_entities (label) → catalog.labels + child tables
 */

import type { Kysely, Database } from "@dig/db";
import type { XmlNode } from "../parser.js";
import { children, childText, attr, parseInt_safe, chunkedInsert } from "./helpers.js";

export async function transformLabels(
  db: Kysely<Database>,
  batchId: string,
  rows: Array<{ discogs_id: number; raw_payload: XmlNode }>
): Promise<{ labels: number; urls: number }> {
  let labelCount = 0;
  let urlCount = 0;

  const labelRows = rows.map((row) => {
    const data = row.raw_payload;

    // parentLabel has id as attribute
    const parentLabels = children(data, "parentLabel");
    let parentId: number | null = null;
    if (parentLabels.length > 0) {
      parentId = parseInt_safe(attr(parentLabels[0], "id"));
    }

    return {
      discogs_id: row.discogs_id,
      name: childText(data, "name") || `[Unknown Label ${row.discogs_id}]`,
      profile: childText(data, "profile") || null,
      contact_info: childText(data, "contactinfo") || null,
      data_quality: childText(data, "data_quality") || "Needs Vote",
      parent_label_discogs_id: parentId,
      batch_id: batchId,
    };
  });

  if (labelRows.length > 0) {
    await db
      .insertInto("catalog.labels")
      .values(labelRows)
      .onConflict((oc) =>
        oc.columns(["batch_id", "discogs_id"]).doUpdateSet({
          name: (eb) => eb.ref("excluded.name"),
          profile: (eb) => eb.ref("excluded.profile"),
          contact_info: (eb) => eb.ref("excluded.contact_info"),
          data_quality: (eb) => eb.ref("excluded.data_quality"),
          parent_label_discogs_id: (eb) => eb.ref("excluded.parent_label_discogs_id"),
        })
      )
      .execute();
    labelCount = labelRows.length;
  }

  // URLs
  const urlRows: Array<{ label_discogs_id: number; url: string; batch_id: string }> = [];

  for (const row of rows) {
    const data = row.raw_payload;
    const urlsWrapper = children(data, "urls");
    if (urlsWrapper.length > 0) {
      for (const urlNode of children(urlsWrapper[0], "url")) {
        const url = urlNode["#text"] as string;
        if (url) urlRows.push({ label_discogs_id: row.discogs_id, url, batch_id: batchId });
      }
    }
  }

  if (urlRows.length > 0) {
    await chunkedInsert(db, "catalog.label_urls", urlRows,
      (oc: any) => oc.columns(["batch_id", "label_discogs_id", "url"]).doNothing());
    urlCount = urlRows.length;
  }

  return { labels: labelCount, urls: urlCount };
}
