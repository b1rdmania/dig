import { describe, expect, it } from "vitest";
import { cahierFor, isGarbled, slugNamedBy, slugify, splitCahiers } from "../inao-cahiers";

const body = (name: string, n = 80) =>
  `CHAPITRE Ier\nI. - Nom de l'appellation\nSeuls peuvent prétendre à l'appellation d'origine contrôlée « ${name} » les vins répondant aux dispositions ci-après.\n` +
  "Les vins sont issus exclusivement de vignes situées dans l'aire parcellaire de production.\n".repeat(n);

const cahier = (upper: string, name: string) =>
  `      Cahier des charges de l’appellation d’origine contrôlée « ${upper} »\nhomologué par le décret n° 2011-1374 du 25 octobre 2011\n\n${body(name)}`;

describe("splitCahiers", () => {
  it("splits a Bulletin Officiel bundle into one section per cahier", () => {
    const bundle = cahier("FITOU", "Fitou") + cahier("GEVREY-CHAMBERTIN", "Gevrey-Chambertin") + cahier("ROMANÉE-CONTI", "Romanée-Conti");
    expect(splitCahiers(bundle).map((s) => s.slugs[0])).toEqual(["fitou", "gevrey-chambertin", "romanee-conti"]);
  });

  it("drops table-of-contents entries and merges a repeated header", () => {
    const toc = "Cahier des charges de l’appellation d’origine contrôlée « FITOU »\n ..... 3\nCahier des charges de l’appellation d’origine contrôlée « POMMARD »\n ..... 40\n";
    const repeated = "Cahier des charges de l’appellation d’origine contrôlée « POMMARD »\nhomologué par le décret\n   CAHIER DES CHARGES DE L’APPELLATION D’ORIGINE CONTRÔLÉE\n « POMMARD »\n" + body("Pommard");
    const out = splitCahiers(toc + cahier("FITOU", "Fitou") + repeated);
    expect(out.map((s) => s.slugs[0])).toEqual(["fitou", "pommard"]);
  });

  it("reads a name on the line below the phrase, with two legal spellings", () => {
    const t = "   Cahier des charges de l’appellation d’origine contrôlée\n   « CROZES-HERMITAGE » ou « CROZES-ERMITAGE »\nhomologué\n" + body("Crozes-Hermitage");
    expect(splitCahiers(t)[0].slugs).toEqual(["crozes-hermitage", "crozes-ermitage"]);
  });

  it("sees a header that opens a page (pdftotext form feed)", () => {
    const t = cahier("CÔTES DE MILLAU", "Côtes de Millau") + "   13\n\f   " + cahier("Côte de Beaune", "Côte de Beaune").trimStart();
    expect(splitCahiers(t).map((s) => s.slugs[0])).toEqual(["cotes-de-millau", "cote-de-beaune"]);
  });

  it("reads IGP headers with inconsistent accents", () => {
    const t = "  CAHIER DES CHARGES DE L’INDICATION GEOGRAPHIQUE PROTEGÉE\n      « AGENAIS »\n" + body("Agenais");
    expect(splitCahiers(t)[0].slugs).toEqual(["agenais"]);
  });
});

describe("cahierFor", () => {
  it("refuses a PDF that holds a different cahier (julienas.pdf is Régnié)", () => {
    const v = cahierFor("julienas", cahier("RÉGNIÉ", "Régnié"));
    expect(v).toMatchObject({ ok: false, reason: "wrong_cahier" });
  });

  it("refuses a bundle that does not hold the slug (chateauneuf-du-pape.pdf)", () => {
    const v = cahierFor("chateauneuf-du-pape", cahier("CASSIS", "Cassis") + cahier("GIGONDAS", "Gigondas"));
    expect(v).toMatchObject({ ok: false, reason: "bundle_without_slug", found: ["cassis", "gigondas"] });
  });

  it("cuts the right section out of a bundle", () => {
    const v = cahierFor("gevrey-chambertin", cahier("FITOU", "Fitou") + cahier("GEVREY-CHAMBERTIN", "Gevrey-Chambertin"));
    expect(v.ok && v.how).toBe("section");
    expect(v.ok && v.text.includes("Fitou")).toBe(false);
  });

  it("keeps a single cahier whole", () => {
    expect(cahierFor("chablis", cahier("CHABLIS", "Chablis"))).toMatchObject({ ok: true, how: "whole" });
  });

  it("files the shared Alsace grand cru cahier under a lieu-dit it names", () => {
    const t = "   CAHIER DES CHARGES\n DES CINQUANTE ET UNE\n APPELLATIONS D’ORIGINE CONTROLEES\n « ALSACE GRAND CRU »\n" + body("Alsace grand cru") + "Lieu-dit Rangen : communes de Thann et Vieux-Thann.\n";
    expect(cahierFor("alsace-grand-cru-rangen", t)).toMatchObject({ ok: true, how: "shared" });
    expect(cahierFor("alsace-grand-cru-hengst", t)).toMatchObject({ ok: false });
  });

  it("refuses symbol soup from a font-encoded PDF", () => {
    const soup = "!  \" # $%&' )*+,-&. , / 0 1 2 3 # 4 5 64 ".repeat(200);
    expect(isGarbled(soup)).toBe(true);
    expect(cahierFor("maury", soup)).toMatchObject({ ok: false, reason: "garbled" });
  });
});

describe("slugNamedBy", () => {
  it("accepts every legal spelling and composite slugs", () => {
    expect(slugNamedBy("crozes-hermitage-ou-crozes-ermitage", ["crozes-hermitage", "crozes-ermitage"])).toBe(true);
    expect(slugNamedBy("cotes-de-bourg-bourg-et-bourgeais", ["bourg", "cotes-de-bourg", "bourgeais"])).toBe(true);
    expect(slugNamedBy("la-liviniere", ["minervois-la-liviniere"])).toBe(true);
  });
  it("does not let a parent name stand in for a child", () => {
    expect(slugNamedBy("cotes-du-rhone-villages", ["cotes-du-rhone"])).toBe(false);
    expect(slugNamedBy("chablis-grand-cru", ["chablis"])).toBe(false);
  });
  it("slugify matches the loader's slugs", () => {
    expect(slugify("Côte Rôtie")).toBe("cote-rotie");
    expect(slugify("L'Étoile")).toBe("letoile");
  });
});
