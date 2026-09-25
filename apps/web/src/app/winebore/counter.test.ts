import { describe, it, expect } from "vitest";
import { onTheCounter, type Bottle } from "./counter";

/** Cases seen on the live counter, 2026-09-25. */

const b = (type: Bottle["type"], id: number, title: string): Bottle => ({ type, id, title, subtitle: null, find_url: null });
const titles = (bs: Bottle[]) => bs.map((x) => x.title);

describe("onTheCounter", () => {
  it("a shared surname needs the full name", () => {
    const ev = [
      b("producer", 1, "Bartolo Mascarello"),
      b("producer", 2, "Giuseppe Mascarello"),
      b("producer", 3, "Cantina Mascarello"),
    ];
    expect(titles(onTheCounter(ev, "The name I'd defend: Bartolo Mascarello."))).toEqual(["Bartolo Mascarello"]);
  });

  it("a surname of its own is enough", () => {
    const ev = [b("producer", 1, "Maison Pierre Overnoy")];
    expect(titles(onTheCounter(ev, "Overnoy, if you can find it."))).toEqual(["Maison Pierre Overnoy"]);
  });

  it("the family tail isn't the surname", () => {
    const ev = [b("producer", 1, "Giacomo Borgogno & Figli")];
    expect(titles(onTheCounter(ev, "Borgogno were making it before the others were born."))).toEqual(["Giacomo Borgogno & Figli"]);
  });

  it("an honorific alone, or a place he named anyway, names no one", () => {
    const ev = [b("producer", 1, "Chateau"), b("producer", 2, "Lucy Margaux"), b("appellation", 3, "Margaux")];
    expect(titles(onTheCounter(ev, "The chateau is the one first growth in Margaux."))).toEqual(["Margaux"]);
  });

  it("puts wines first and drops what wasn't named", () => {
    const ev = [b("producer", 1, "Roagna"), b("wine", 2, "Roagna, Barbaresco, Paje"), b("producer", 3, "Paitin")];
    expect(titles(onTheCounter(ev, "Roagna's Barbaresco Paje answers Barolo directly."))).toEqual(["Roagna, Barbaresco, Paje", "Roagna"]);
  });
});
