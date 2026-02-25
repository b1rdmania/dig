/**
 * Discogs XML dump profiler.
 *
 * Streams a gzipped XML dump, builds a full JS tree per entity,
 * and collects field presence rates, cardinality, nesting depth,
 * edge-case samples, and sizing estimates.
 *
 * Usage:
 *   npx tsx scripts/profile/profiler.ts artists ./discogs_20260201_artists.xml.gz
 *   npx tsx scripts/profile/profiler.ts labels  ./discogs_20260201_labels.xml.gz
 *   npx tsx scripts/profile/profiler.ts masters ./discogs_20260201_masters.xml.gz
 *   npx tsx scripts/profile/profiler.ts releases ./discogs_20260201_releases.xml.gz [--limit 50000]
 */

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { SaxesParser } from "saxes";

// ── Types ──────────────────────────────────────────────────────────────────

type EntityType = "artists" | "labels" | "masters" | "releases";

interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}

interface FieldStats {
  count: number;
  /** How many entities have this path present at least once */
  presence: number;
  /** Min/max occurrences per entity (for repeated elements) */
  minOccurrences: number;
  maxOccurrences: number;
  /** How many have non-empty text */
  nonEmptyText: number;
  /** How many have attributes */
  withAttributes: number;
  /** How many have children */
  withChildren: number;
  /** Sample values (keep first 5 unique, truncated to 200 chars) */
  sampleValues: string[];
  /** Unique attribute keys seen */
  attributeKeys: Set<string>;
}

interface ProfileResult {
  entityType: EntityType;
  totalEntities: number;
  dumpFile: string;
  durationSeconds: number;
  fields: Record<string, {
    presence: number;
    presenceRate: string;
    minOccurrences: number;
    maxOccurrences: number;
    nonEmptyTextRate: string;
    withChildrenRate: string;
    attributeKeys: string[];
    sampleValues: string[];
  }>;
  /** Top-level attribute stats (e.g. id on <release>) */
  topLevelAttributes: Record<string, number>;
  /** Estimated average entity JSON size in bytes */
  avgEntitySizeBytes: number;
  /** Total estimated raw payload size */
  estimatedTotalPayloadMB: number;
  /** Edge case samples */
  edgeCases: Record<string, unknown[]>;
}

// ── Root element mapping ───────────────────────────────────────────────────

const ROOT_ELEMENT: Record<EntityType, string> = {
  artists: "artist",
  labels: "label",
  masters: "master",
  releases: "release",
};

// ── Full-tree SAX builder ──────────────────────────────────────────────────

function buildTreeFromStream(
  type: EntityType,
  stream: NodeJS.ReadableStream,
  onEntity: (tree: XmlNode) => void,
  limit?: number
): Promise<number> {
  const rootElement = ROOT_ELEMENT[type];
  const parser = new SaxesParser();

  let insideEntity = false;
  let nodeStack: XmlNode[] = [];
  let entityCount = 0;
  let stopped = false;

  return new Promise((resolve, reject) => {
    parser.on("opentag", (node) => {
      if (stopped) return;

      const xmlNode: XmlNode = {
        name: node.name,
        attributes: Object.fromEntries(
          Object.entries(node.attributes).map(([k, v]) => [k, String(v)])
        ),
        children: [],
        text: "",
      };

      if (!insideEntity) {
        if (node.name === rootElement) {
          insideEntity = true;
          nodeStack = [xmlNode];
        }
        return;
      }

      // Add as child of current parent
      if (nodeStack.length > 0) {
        nodeStack[nodeStack.length - 1].children.push(xmlNode);
      }
      nodeStack.push(xmlNode);
    });

    parser.on("text", (text) => {
      if (stopped || !insideEntity || nodeStack.length === 0) return;
      nodeStack[nodeStack.length - 1].text += text;
    });

    parser.on("closetag", (tag) => {
      if (stopped || !insideEntity) return;

      if (tag.name === rootElement && nodeStack.length === 1) {
        insideEntity = false;
        entityCount++;

        onEntity(nodeStack[0]);
        nodeStack = [];

        if (entityCount % 100_000 === 0) {
          const mem = process.memoryUsage();
          console.error(
            `[profile] ${entityCount.toLocaleString()} ${type} | RSS ${(mem.rss / 1024 / 1024).toFixed(0)}MB`
          );
        }

        if (limit && entityCount >= limit) {
          stopped = true;
          stream.destroy?.();
          resolve(entityCount);
        }
        return;
      }

      nodeStack.pop();
    });

    (stream as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
      if (stopped) return;
      try {
        parser.write(chunk.toString("utf8"));
      } catch (err) {
        reject(err);
      }
    });

    (stream as NodeJS.ReadableStream).on("end", () => {
      if (!stopped) {
        try { parser.close(); } catch {}
      }
      resolve(entityCount);
    });

    (stream as NodeJS.ReadableStream).on("error", (err) => {
      if (!stopped) reject(err);
    });
  });
}

// ── Analysis engine ────────────────────────────────────────────────────────

class ProfileCollector {
  private fieldStats = new Map<string, FieldStats>();
  private topLevelAttrs = new Map<string, number>();
  private totalSize = 0;
  private entityCount = 0;

  // Edge case collectors
  private edgeCases: Record<string, unknown[]> = {};
  private edgeCaseLimit = 3;

  addEntity(tree: XmlNode) {
    this.entityCount++;

    // Top-level attributes
    for (const key of Object.keys(tree.attributes)) {
      this.topLevelAttrs.set(key, (this.topLevelAttrs.get(key) ?? 0) + 1);
    }

    // Estimate JSON size
    this.totalSize += JSON.stringify(this.treeToJson(tree)).length;

    // Track which paths are seen in this entity (for per-entity presence dedup)
    const seenPaths = new Set<string>();

    // Collect field stats from direct children
    const childCounts = new Map<string, number>();
    for (const child of tree.children) {
      const name = child.name;
      childCounts.set(name, (childCounts.get(name) ?? 0) + 1);
      this.recordField(name, child);

      // Also record nested paths (one level deeper), counting per entity
      for (const grandchild of child.children) {
        const nestedPath = `${name}/${grandchild.name}`;
        seenPaths.add(nestedPath);
        const nestedCount = childCounts.get(nestedPath) ?? 0;
        childCounts.set(nestedPath, nestedCount + 1);
        this.recordField(nestedPath, grandchild);
      }
    }

    // Update presence and min/max occurrences for direct children
    for (const [name, stats] of this.fieldStats) {
      if (!name.includes("/")) {
        const count = childCounts.get(name) ?? 0;
        if (count > 0) {
          stats.presence++;
          stats.minOccurrences = Math.min(stats.minOccurrences, count);
          stats.maxOccurrences = Math.max(stats.maxOccurrences, count);
        }
      }
    }

    // Update presence and min/max occurrences for nested paths (once per entity)
    for (const nestedPath of seenPaths) {
      const stats = this.fieldStats.get(nestedPath);
      if (stats) {
        stats.presence++;
        const count = childCounts.get(nestedPath) ?? 0;
        if (count > 0) {
          stats.minOccurrences = Math.min(stats.minOccurrences, count);
          stats.maxOccurrences = Math.max(stats.maxOccurrences, count);
        }
      }
    }
  }

  private recordField(path: string, node: XmlNode) {
    let stats = this.fieldStats.get(path);
    if (!stats) {
      stats = {
        count: 0,
        presence: 0,
        minOccurrences: Infinity,
        maxOccurrences: 0,
        nonEmptyText: 0,
        withAttributes: 0,
        withChildren: 0,
        sampleValues: [],
        attributeKeys: new Set(),
      };
      this.fieldStats.set(path, stats);
    }

    stats.count++;
    if (node.text.trim()) stats.nonEmptyText++;
    if (Object.keys(node.attributes).length > 0) {
      stats.withAttributes++;
      for (const k of Object.keys(node.attributes)) stats.attributeKeys.add(k);
    }
    if (node.children.length > 0) stats.withChildren++;

    // Sample values
    if (stats.sampleValues.length < 5) {
      const val = node.text.trim().slice(0, 200);
      if (val && !stats.sampleValues.includes(val)) {
        stats.sampleValues.push(val);
      }
    }
  }

  private treeToJson(node: XmlNode): unknown {
    const hasAttrs = Object.keys(node.attributes).length > 0;

    if (node.children.length === 0) {
      // Leaf node: if it has attributes, return object with attrs + text
      if (hasAttrs) {
        const leaf: Record<string, unknown> = { "@attr": node.attributes };
        const text = node.text.trim();
        if (text) leaf["#text"] = text;
        return leaf;
      }
      return node.text.trim() || null;
    }

    const obj: Record<string, unknown> = {};
    if (hasAttrs) {
      obj["@attr"] = node.attributes;
    }
    for (const child of node.children) {
      const existing = obj[child.name];
      const val = this.treeToJson(child);
      if (existing !== undefined) {
        if (Array.isArray(existing)) {
          existing.push(val);
        } else {
          obj[child.name] = [existing, val];
        }
      } else {
        obj[child.name] = val;
      }
    }
    return obj;
  }

  addEdgeCase(key: string, sample: unknown) {
    if (!this.edgeCases[key]) this.edgeCases[key] = [];
    if (this.edgeCases[key].length < this.edgeCaseLimit) {
      this.edgeCases[key].push(sample);
    }
  }

  getResult(entityType: EntityType, dumpFile: string, durationSeconds: number): ProfileResult {
    const fields: ProfileResult["fields"] = {};
    const sortedFields = [...this.fieldStats.entries()].sort((a, b) => b[1].count - a[1].count);

    for (const [path, stats] of sortedFields) {
      fields[path] = {
        presence: stats.presence,
        presenceRate: this.entityCount > 0
          ? `${((stats.presence / this.entityCount) * 100).toFixed(2)}%`
          : "0%",
        minOccurrences: stats.minOccurrences === Infinity ? 0 : stats.minOccurrences,
        maxOccurrences: stats.maxOccurrences,
        nonEmptyTextRate: stats.count > 0
          ? `${((stats.nonEmptyText / stats.count) * 100).toFixed(2)}%`
          : "0%",
        withChildrenRate: stats.count > 0
          ? `${((stats.withChildren / stats.count) * 100).toFixed(2)}%`
          : "0%",
        attributeKeys: [...stats.attributeKeys],
        sampleValues: stats.sampleValues,
      };
    }

    const avgSize = this.entityCount > 0 ? this.totalSize / this.entityCount : 0;

    return {
      entityType,
      totalEntities: this.entityCount,
      dumpFile,
      durationSeconds,
      fields,
      topLevelAttributes: Object.fromEntries(this.topLevelAttrs),
      avgEntitySizeBytes: Math.round(avgSize),
      estimatedTotalPayloadMB: Math.round((avgSize * this.entityCount) / 1024 / 1024),
      edgeCases: this.edgeCases,
    };
  }
}

// ── Edge case detectors ────────────────────────────────────────────────────

function detectEdgeCases(type: EntityType, tree: XmlNode, collector: ProfileCollector) {
  const id = tree.attributes.id ?? "?";

  if (type === "artists") {
    // ANV: aliases with <anv> elements
    const aliases = tree.children.filter(c => c.name === "aliases");
    if (aliases.length > 0) {
      const aliasNames = aliases.flatMap(a => a.children.map(c => c.text.trim())).filter(Boolean);
      if (aliasNames.length > 5) {
        collector.addEdgeCase("artist_many_aliases", { id, aliasCount: aliasNames.length, sample: aliasNames.slice(0, 5) });
      }
    }
    // Name variations
    const nvs = tree.children.filter(c => c.name === "namevariations");
    if (nvs.length > 0) {
      const names = nvs.flatMap(n => n.children.map(c => c.text.trim())).filter(Boolean);
      if (names.length > 10) {
        collector.addEdgeCase("artist_many_namevariations", { id, count: names.length, sample: names.slice(0, 5) });
      }
    }
  }

  if (type === "releases") {
    // Track position edge cases
    const tracklist = tree.children.find(c => c.name === "tracklist");
    if (tracklist) {
      const positions = tracklist.children
        .filter(c => c.name === "track")
        .map(t => t.children.find(c => c.name === "position")?.text.trim() ?? "");

      // Vinyl sides, bonus tracks, weird formats
      const weirdPositions = positions.filter(p =>
        p && !/^\d+$/.test(p) && !/^[A-D]\d*$/.test(p)
      );
      if (weirdPositions.length > 0) {
        collector.addEdgeCase("release_weird_track_positions", { id, positions: weirdPositions.slice(0, 10) });
      }

      // Releases with many tracks
      if (positions.length > 50) {
        collector.addEdgeCase("release_many_tracks", { id, trackCount: positions.length });
      }
    }

    // Partial dates
    const released = tree.children.find(c => c.name === "released")?.text.trim();
    if (released && !/^\d{4}-\d{2}-\d{2}$/.test(released)) {
      collector.addEdgeCase("release_partial_date", { id, released });
    }

    // Images presence check
    const images = tree.children.find(c => c.name === "images");
    if (images && images.children.length > 0) {
      collector.addEdgeCase("release_has_images", { id, imageCount: images.children.length });
    }

    // Credits with free-text roles
    const extraartists = tree.children.find(c => c.name === "extraartists");
    if (extraartists) {
      for (const artist of extraartists.children.slice(0, 3)) {
        const role = artist.children.find(c => c.name === "role")?.text.trim();
        if (role && role.includes(",")) {
          collector.addEdgeCase("release_multi_role_credit", { id, role });
          break;
        }
      }
    }
  }

  if (type === "labels") {
    // Sublabel depth
    const sublabels = tree.children.filter(c => c.name === "sublabels");
    if (sublabels.length > 0) {
      const count = sublabels.reduce((acc, s) => acc + s.children.length, 0);
      if (count > 20) {
        collector.addEdgeCase("label_many_sublabels", { id, sublabelCount: count });
      }
    }
  }

  if (type === "masters") {
    // Masters without main_release
    const mainRelease = tree.children.find(c => c.name === "main_release");
    if (!mainRelease || !mainRelease.text.trim()) {
      collector.addEdgeCase("master_no_main_release", { id });
    }
  }
}

// ── Markdown report generator ──────────────────────────────────────────────

function generateMarkdown(result: ProfileResult): string {
  const lines: string[] = [];
  lines.push(`# ${result.entityType} Profile Report`);
  lines.push("");
  lines.push(`- **Dump file**: \`${result.dumpFile}\``);
  lines.push(`- **Total entities**: ${result.totalEntities.toLocaleString()}`);
  lines.push(`- **Duration**: ${result.durationSeconds.toFixed(1)}s`);
  lines.push(`- **Avg entity JSON size**: ${result.avgEntitySizeBytes.toLocaleString()} bytes`);
  lines.push(`- **Estimated total payload**: ${result.estimatedTotalPayloadMB.toLocaleString()} MB`);
  lines.push("");

  lines.push("## Top-level Attributes");
  lines.push("");
  lines.push("| Attribute | Count |");
  lines.push("|-----------|-------|");
  for (const [attr, count] of Object.entries(result.topLevelAttributes)) {
    lines.push(`| ${attr} | ${count.toLocaleString()} |`);
  }
  lines.push("");

  lines.push("## Field Presence");
  lines.push("");
  lines.push("| Field | Presence | Rate | Min/Max Occ | Has Children | Attr Keys | Sample |");
  lines.push("|-------|----------|------|-------------|--------------|-----------|--------|");

  for (const [field, stats] of Object.entries(result.fields)) {
    const sample = stats.sampleValues[0]?.slice(0, 60) ?? "";
    lines.push(
      `| \`${field}\` | ${stats.presence.toLocaleString()} | ${stats.presenceRate} | ${stats.minOccurrences}–${stats.maxOccurrences} | ${stats.withChildrenRate} | ${stats.attributeKeys.join(", ") || "—"} | ${sample} |`
    );
  }
  lines.push("");

  if (Object.keys(result.edgeCases).length > 0) {
    lines.push("## Edge Cases");
    lines.push("");
    for (const [key, samples] of Object.entries(result.edgeCases)) {
      lines.push(`### ${key}`);
      lines.push("```json");
      lines.push(JSON.stringify(samples, null, 2));
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const [, , entityType, filePath, ...rest] = process.argv;

  if (!entityType || !filePath) {
    console.error("Usage: npx tsx scripts/profile/profiler.ts <artists|labels|masters|releases> <file.xml.gz> [--limit N]");
    process.exit(1);
  }

  const type = entityType as EntityType;
  if (!ROOT_ELEMENT[type]) {
    console.error(`Unknown entity type: ${entityType}`);
    process.exit(1);
  }

  let limit: number | undefined;
  const limitIdx = rest.indexOf("--limit");
  if (limitIdx !== -1 && rest[limitIdx + 1]) {
    limit = parseInt(rest[limitIdx + 1], 10);
    console.error(`[profile] Limiting to ${limit.toLocaleString()} entities`);
  }

  console.error(`[profile] Profiling ${type} from ${filePath}...`);
  const startTime = Date.now();

  const stream = createReadStream(filePath).pipe(createGunzip());
  const collector = new ProfileCollector();

  const totalEntities = await buildTreeFromStream(type, stream, (tree) => {
    collector.addEntity(tree);
    detectEdgeCases(type, tree, collector);
  }, limit);

  const duration = (Date.now() - startTime) / 1000;
  console.error(`[profile] Done: ${totalEntities.toLocaleString()} ${type} in ${duration.toFixed(1)}s`);

  const result = collector.getResult(type, path.basename(filePath), duration);

  // Write JSON + Markdown outputs
  // Resolve relative to the dump file's directory (avoids URL-encoding issues with spaces in paths)
  const outDir = path.resolve(path.dirname(filePath), "data", "profiles");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outDir, { recursive: true });

  const baseName = `${type}_profile${limit ? `_${limit}` : ""}`;
  await writeFile(path.join(outDir, `${baseName}.json`), JSON.stringify(result, null, 2));
  await writeFile(path.join(outDir, `${baseName}.md`), generateMarkdown(result));

  console.error(`[profile] Output: data/profiles/${baseName}.json + .md`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
