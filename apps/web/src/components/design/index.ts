/**
 * Shared design system components.
 *
 * Pages compose these — pages should not override styling at the call
 * site. If you need a new variant, extend the component itself.
 *
 * See docs/design-system.md for the canonical reference.
 */

export { Page, type PageAccent } from "./Page";
export { Sticker, type StickerTone } from "./Sticker";
export { Stamp } from "./Stamp";
export { Rule } from "./Rule";
export { MetaRow } from "./MetaRow";
export { Wordmark } from "./Wordmark";
export { LabelWordmark, hasCuratedWordmark } from "./LabelWordmark";
export { CatalogSpine, type SpineRow } from "./CatalogSpine";
export { RosterColumn, type RosterRow } from "./RosterColumn";
export { LinerNotes } from "./LinerNotes";
export { MonoTable } from "./MonoTable";
export { TerminalListing, type TerminalRow } from "./TerminalListing";
export { TopMatchCard } from "./TopMatchCard";
export { TypeTabs } from "./TypeTabs";
export { GenreBar } from "./GenreBar";
export { SublabelTree } from "./SublabelTree";
export { Labelmates } from "./Labelmates";
