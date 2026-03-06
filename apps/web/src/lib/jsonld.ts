/**
 * JSON-LD structured data serializers for Schema.org entities.
 * All functions return plain objects — serialize with JsonLd component.
 */

import { BASE_URL } from "./seo";

const DISCOGS_BASE = "https://www.discogs.com";

export function breadcrumbJsonLd(crumbs: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

export function musicGroupJsonLd(artist: {
  discogs_id: number;
  name: string;
  urls: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: artist.name,
    url: `${BASE_URL}/artist/${artist.discogs_id}`,
    sameAs: [
      `${DISCOGS_BASE}/artist/${artist.discogs_id}`,
      ...artist.urls.slice(0, 5),
    ],
  };
}

export function musicAlbumJsonLd(master: {
  discogs_id: number;
  title: string;
  year: number | null;
  artists: Array<{ discogs_id: number; name: string }>;
  genres: string[];
}) {
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MusicAlbum",
    name: master.title,
    url: `${BASE_URL}/release/${master.discogs_id}`,
    sameAs: `${DISCOGS_BASE}/master/${master.discogs_id}`,
    byArtist: master.artists.slice(0, 3).map((a) => ({
      "@type": "MusicGroup",
      name: a.name,
      url: `${BASE_URL}/artist/${a.discogs_id}`,
    })),
  };
  if (master.year) obj.datePublished = String(master.year);
  if (master.genres.length) obj.genre = master.genres;
  return obj;
}

export function versionJsonLd(release: {
  discogs_id: number;
  title: string;
  release_year: number | null;
  artists: Array<{ discogs_id: number; name: string }>;
  genres: string[];
  country: string | null;
  master_discogs_id: number | null;
}) {
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MusicAlbum",
    name: release.title,
    url: `${BASE_URL}/version/${release.discogs_id}`,
    sameAs: `${DISCOGS_BASE}/release/${release.discogs_id}`,
    byArtist: release.artists.slice(0, 3).map((a) => ({
      "@type": "MusicGroup",
      name: a.name,
      url: `${BASE_URL}/artist/${a.discogs_id}`,
    })),
  };
  if (release.release_year) obj.datePublished = String(release.release_year);
  if (release.genres.length) obj.genre = release.genres;
  if (release.country) obj.locationCreated = release.country;
  if (release.master_discogs_id) {
    obj.inAlbum = {
      "@type": "MusicAlbum",
      url: `${BASE_URL}/release/${release.master_discogs_id}`,
    };
  }
  return obj;
}

export function labelJsonLd(label: {
  discogs_id: number;
  name: string;
  urls: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: label.name,
    url: `${BASE_URL}/label/${label.discogs_id}`,
    sameAs: [
      `${DISCOGS_BASE}/label/${label.discogs_id}`,
      ...label.urls.slice(0, 3),
    ],
  };
}
