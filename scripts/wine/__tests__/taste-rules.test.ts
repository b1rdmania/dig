import { describe, expect, it } from "vitest";
import { parseFrenchTaste, parseItalianTaste, parseSpanishTaste, parseTasteClauses } from "../taste-rules";

// Every clause below is copied from a loaded document (wine.appellation_documents), page furniture included.

describe("French: Informations sur la qualité et les caractéristiques du produit", () => {
  it("splits Sancerre by colour, with the general sentence first", () => {
    const t = `
2°- Informations sur la qualité et les caractéristiques du produit

Les vins sont tranquilles, secs, avec une rondeur en bouche et une finale fraîche et bien équilibrée.
Ils peuvent être appréciés dans leur jeunesse mais certains millésimes possèdent un bon potentiel de
garde.

Les vins blancs à la robe souvent or pâle, déclinent une palette aromatique pouvant aller de notes fruitées
rappelant les agrumes ou les fruits exotiques aux notes florales rappelant les fleurs blanches.

Les vins rosés s’ouvrent sur des arômes délicats et fruités. Leur robe se décline du rose pâle au saumon
soutenu.

Les vins rouges arborent une robe d’intensité variable et dévoilent des arômes complexes avec
généralement une note dominante de fruits rouges. Leur structure s’appuie sur des tanins souples et
élégants. Ce sont des vins équilibrés, alliant puissance et finesse.

3°- Interactions causales

La conjonction, du climat océanique dégradé, de la situation à l’abri des vents du sud-ouest
`;
    const out = parseFrenchTaste(t);
    expect(out.map((c) => [c.style, c.colour])).toEqual([
      [null, null],
      ["vins blancs", "white"],
      ["vins rosés", "rose"],
      ["vins rouges", "red"],
    ]);
    expect(out[3].clause_text).toMatch(/^Les vins rouges arborent une robe d’intensité variable/);
    expect(out[3].clause_text).toMatch(/alliant puissance et finesse\.$/);
    expect(out[0].sweetness).toBeNull(); // "tranquilles, secs" is not a "vins secs" statement of the wine type
  });

  it("keeps Chablis grand cru as one clause for the whole appellation and reads white and dry", () => {
    const t = `
5000 hectolitres en 2010.

2°- Informations sur la qualité et les caractéristiques des produits

Le « Chablis grand cru » est un vin blanc sec, vif et fruité, caractérisé par une minéralité notable,
équilibrée par un caractère charnu. Ferme dans sa jeunesse, il gagne en complexité aromatique et en
finesse en vieillissant, l'acidité et la minéralité lui conférant un caractère de fraîcheur. Sa déclinaison en
sept « climats » exprime une palette de nuances. C’est un vin de garde, atteignant sa plénitude vers 10
ans.

3°- Interactions causales
`;
    const out = parseFrenchTaste(t);
    expect(out).toHaveLength(1);
    expect(out[0].style).toBeNull();
    expect(out[0].colour).toBe("white");
    expect(out[0].sweetness).toBe("dry");
    expect(out[0].clause_text).toMatch(/^Le « Chablis grand cru » est un vin blanc sec/);
  });

  it("splits Vouvray under its centred headings and drops the page furniture", () => {
    const t = `
2°- Informations sur la qualité et les caractéristiques des produits

                                            Vins tranquilles
Les vins tranquilles secs présentent généralement dans leur jeunesse, des arômes fruités et
floraux, qui peuvent, en vieillissant, faire place à des notes d'évolution, telles le miel ou le tilleul.

                                   Vins mousseux de qualité
Les vins mousseux, à la mousse fine et légère, se caractérisent souvent par des notes de fruits ou
d'agrumes, et par une nuance briochée qui s’affirme avec le temps.

                                           Vins pétillants
Les vins pétillants se distinguent par leur plus faible teneur en gaz carbonique et leur bulles plus
discrètes, moins présentes en bouche. Ces vins, aimables, présentent en général un caractère plus
vineux que les vins mousseux.

                                                                                                              9
Modification du cahier des charges de l’AOP « Vouvray » adoptée par le Comité National des Appellations
d’Origine relatives aux vins et aux boissons alcoolisées, et des boissons spiritueuses en séance du 18 juin 2026.

3°- Interactions causales
`;
    const out = parseFrenchTaste(t);
    expect(out.map((c) => c.style)).toEqual(["Vins tranquilles", "Vins mousseux de qualité", "Vins pétillants"]);
    expect(out[1].colour).toBe("sparkling");
    expect(out.every((c) => !/Modification du cahier|séance du/.test(c.clause_text))).toBe(true);
  });

  it("takes the minimum natural alcohol from the document when it states one figure", () => {
    const t = `
Les vins présentent un titre alcoométrique volumique naturel minimum de 11,5 %.

2°- Informations sur les caractéristiques du produit

Les vins rouges sont des vins de garde, charpentés, aux tanins fermes et aux arômes de fruits noirs.

3°- Interactions causales
`;
    const out = parseFrenchTaste(t);
    expect(out).toHaveLength(1);
    expect(out[0].min_alcohol).toBe(11.5);
    expect(out[0].colour).toBe("red");
  });

  it("returns nothing for a 2010 grand cru cahier whose Lien à l'origine is empty (La Tâche)", () => {
    const t = `
                                              X.-Lien à l’origine

                                          XI.-Mesures transitoires

                                 XII.-Règles de présentation et étiquetage
`;
    expect(parseFrenchTaste(t)).toEqual([]);
  });
});

describe("Italian: Caratteristiche al consumo", () => {
  it("reads every Etna tipologia from its heading, with alcohol and sweetness", () => {
    const t = `
                                       Caratteristiche al consumo

 1.I vini di cui all'art.1 devono rispondere, all'atto dell’immissione al consumo, alle seguenti
 caratteristiche:

 «Etna» bianco
 colore: giallo paglierino, talvolta con leggeri riflessi dorati;
 odore: delicato, caratteristico;
 sapore: secco, fresco, armonico;
 titolo alcolometrico volumico totale minimo: 11,50% vol;
 acidità totale minima: 5,5 g/l;
 estratto non riduttore minimo: 18,0 g/l.

 “Etna” bianco superiore
                                                      4
colore: giallo paglierino molto scarico con riflessi verdolini;
odore: delicato, caratteristico;
sapore: secco, fresco, armonico, morbido;
titolo alcolometrico volumico totale minimo: 12,00 % vol;
acidità totale minima: 5,5 g/l
estratto non riduttore minimo: 18,0 g/l.

“Etna” rosso riserva
colore: rosso rubino con riflessi granato con l'invecchiamento;
odore: intenso, caratteristico;
sapore: secco, caldo, robusto, pieno, armonico;
titolo alcolometrico volumico totale minimo: 13,00% vol;
acidità totale minima: 4,5 g/l;
estratto non riduttore minimo: 20,0 g/l.

“Etna” spumante bianco
spuma: fine e persistente;
colore: giallo paglierino più o meno intenso;
odore: intenso e caratteristico, talvolta con note agrumate accompagnate da un delicato sentore di
lievito;
sapore: pieno, armonico, di buona persistenza; da brut a extradry;
titolo alcolometrico volumico totale minimo: 11,00% vol.;
acidità totale minima: 5,0 g/l;
estratto non riduttore minimo: 15,0 g/l.

                                             Articolo 7
`;
    const out = parseItalianTaste(t);
    expect(out.map((c) => [c.style, c.colour, c.min_alcohol, c.sweetness])).toEqual([
      ["Etna bianco", "white", 11.5, "dry"],
      ["Etna bianco superiore", "white", 12, "dry"],
      ["Etna rosso riserva", "red", 13, "dry"],
      ["Etna spumante bianco", "sparkling", 11, "brut to extra dry"],
    ]);
    // A wrapped line is joined; the page number is not in the clause.
    expect(out[3].clause_text).toMatch(/sentore di lievito;/);
    expect(out[1].clause_text).not.toMatch(/^\s*4\s*$/m);
  });

  it("reads the tipologia from the sentence that introduces the block (Barolo, Barolo riserva)", () => {
    const t = `
1. Il vino a denominazione di origine controllata e garantita «Barolo», all’atto dell’immissione al
consumo, deve rispondere alle seguenti caratteristiche:
    colore: rosso granato;
    odore: intenso e caratteristico;
    sapore: asciutto, pieno, armonico;
    titolo alcolometrico volumico totale minimo: 13,00% vol; con «menzione geografica aggiuntiva»
    e «vigna»: 13,00% vol;
    acidità totale minima: 4,5 g/l;
    estratto non riduttore minimo: 22,0 g/l.

2. Il vino a denominazione di origine controllata e garantita «Barolo» tipologia «riserva», all’atto
dell’immissione al consumo, deve rispondere alle seguenti caratteristiche:
    colore: rosso granato;
    odore: intenso e caratteristico;
    sapore: asciutto, pieno, armonico;
    titolo alcolometrico volumico totale minimo: 13,00% vol; con «menzione geografica aggiuntiva»
    e «vigna»: 13,00% vol;
    acidità totale minima: 4,5 g/l;
    estratto non riduttore minimo: 22,0 g/l.

3. E' in facoltà del Ministero delle politiche agricole alimentari e forestali di intesa con il Consorzio
`;
    const out = parseItalianTaste(t);
    expect(out.map((c) => c.style)).toEqual(["Barolo", "Barolo riserva"]);
    expect(out.map((c) => c.style_key)).toEqual(["barolo", "barolo riserva"]);
    expect(out[0].colour).toBe("red");
    expect(out[0].min_alcohol).toBe(13);
    expect(out[0].sweetness).toBe("dry");
  });

  it("reads a range of sweetness and a bulleted block (Prosecco, Chianti Classico Riserva)", () => {
    const t = `
«Prosecco» spumante:
colore: giallo paglierino più o meno intenso, brillante, con spuma persistente;
odore: fine, caratteristico, tipico delle uve di provenienza;
sapore: da brut nature a demi-sec, fresco e caratteristico;
titolo alcolometrico volumico totale minimo: 11,00% vol;
acidità totale minima: 4,5 g/l
estratto non riduttore minimo: 14,0 g/l.

2.      Il vino a denominazione di origine controllata e garantita “Chianti Classico” Riserva,
all’atto dell’immissione al consumo, deve rispondere alle seguenti caratteristiche;

- colore: rosso rubino intenso, tendente al granato con l’invecchiamento;
- odore: intenso fruttato e persistente;
- sapore: secco, equilibrato di buona tannicità;
- titolo alcolometrico volumico totale minimo: 12,50% vol;
- acidità totale minima: 4,5 g/l;
- estratto non riduttore minimo: 25,0 g/l.
`;
    const out = parseItalianTaste(t);
    expect(out.map((c) => [c.style, c.sweetness, c.min_alcohol])).toEqual([
      ["Prosecco spumante", "brut nature to demi-sec", 11],
      ["Chianti Classico Riserva", "dry", 12.5],
    ]);
  });

  it("treats a symbol-font bullet as a bullet (Recioto di Gambellara)", () => {
    const t = `
«Recioto di Gambellara» Classico:
      colore: da paglierino a giallo dorato più o meno intenso con eventuali sfumature ambrate;
      odore: intenso, profumo di frutta matura con eventuali sfumature di vaniglia;
      sapore: caratteristico, armonico, tipico, amabile o dolce, con leggero retrogusto amarognolo;
      titolo alcolometrico volumico totale minimo: 14,00% vol di cui almeno 11,30% in alcool effettivo;
`;
    const out = parseTasteClauses(t, "it");
    expect(out).toHaveLength(1);
    expect(out[0].style).toBe("Recioto di Gambellara Classico");
    expect(out[0].colour).toBe("sweet");
    expect(out[0].min_alcohol).toBe(14);
  });
});

describe("Spanish: Características organolépticas", () => {
  it("reads Rioja's Vista / Olfato / Boca blocks under capital headings, and does not read 'frutos secos' as dry", () => {
    const t = `
b. CARACTERÍSTICAS ORGANOLÉPTICAS

   La calificación organoléptica se referirá, principalmente, a la tipicidad, color,
limpidez, olor, sabor y calidad del vino, teniendo en cuenta el momento del proceso
productivo en que se encuentra la muestra.

VINO BLANCO JOVEN
  Vista: Amarillo pajizo con ribetes verde limón, limpio y brillante.
  Olfato: Aromas frutales, florales o vegetales típicos de la variedad.
  Boca: Acidez presente con sensación de frescor.

VINO TINTO CRIANZA
  Vista: Rojo granate, cereza.
  Olfato: Armonía entre aromas frutales o florales y aromas tostados de madera
  de roble.

                                                                                4
  Boca: Buen cuerpo con taninos suaves y sabrosos.

VINO TINTO GRAN RESERVA
  Vista: Rojo rubí con tonos teja.
  Olfato: Gran complejidad e intensidad aromática con notas especiadas (tabaco,
  torrefactos, frutos secos, clavo, nuez, cedro).
  Boca: Suaves, finos, elegantes y persistentes.


VINO ESPUMOSO DE CALIDAD
   Vino con desprendimiento continuo de dióxido de carbono expresado
visualmente en la formación de finas burbujas en el momento de su servicio para el
consumo.

   Su olor tendrá los atributos positivos de frescura y fruta, con la complejidad
debida a la permanencia durante la fase de rima con los restos de levadura.


3.   PRÁCTICAS ESPECÍFICAS PARA ELABORACIÓN Y RESTRICCIONES
IMPUESTAS.

a. PRÁCTICAS DE CULTIVO.
`;
    const out = parseSpanishTaste(t);
    expect(out.map((c) => [c.style, c.colour])).toEqual([
      ["VINO BLANCO JOVEN", "white"],
      ["VINO TINTO CRIANZA", "red"],
      ["VINO TINTO GRAN RESERVA", "red"],
      ["VINO ESPUMOSO DE CALIDAD", "sparkling"],
    ]);
    expect(out[1].clause_text).toBe("Vista: Rojo granate, cereza.\nOlfato: Armonía entre aromas frutales o florales y aromas tostados de madera de roble.\nBoca: Buen cuerpo con taninos suaves y sabrosos.");
    expect(out[2].sweetness).toBeNull();
    expect(out[3].clause_text).toMatch(/^Vino con desprendimiento continuo/);
    expect(out[3].clause_text).not.toMatch(/PRÁCTICAS/);
  });

  it("reads Priorat's enumerated Aspecto Visual / Olfativo / Gustativo blocks", () => {
    const t = `
     2.3.         Características Organolépticas:

2.3.1.       Vinos

a)          Vino blanco:
     Aspecto Visual: El aspecto visual ha de ser un vino limpio, límpido y brillante
     Aspecto Olfativo: Correcta intensidad y calidad olfativa con aromas francos, afrutados, florales o
     lácticos.
     Aspecto Gustativo: En la fase gustativa ha de ser equilibrado, suave y fresco.

b)        Vino tinto:
     Aspecto Visual: El aspecto visual ha de ser un vino limpio, límpido y brillante.
     Aspecto Olfativo: Aromas primarios afrutados y/o florales y/o minerales.
     Aspecto Gustativo: Entrada y evolución en boca equilibrada, con estructura y frescor.

     2.3.2.   Vinos de licor

 a)        Vino rancio dulce:
     Aspecto Visual: Los vinos rancios dulces han de tener un aspecto visual limpio y límpido.
     Aspecto Olfativo: Aromas terciarios, propios del envejecimiento.
     Aspecto Gustativo: Acidez equilibrada y untuoso.

2.4.   PRÁCTICAS ENOLÓGICAS ESPECÍFICAS
`;
    const out = parseSpanishTaste(t);
    expect(out.map((c) => [c.style, c.colour, c.sweetness])).toEqual([
      ["Vino blanco", "white", null],
      ["Vino tinto", "red", null],
      ["Vino rancio dulce", "fortified", "sweet"],
    ]);
    expect(out[0].clause_text).toMatch(/florales o lácticos\.\nAspecto Gustativo/);
    expect(out[1].clause_text).not.toMatch(/Vinos de licor/);
  });

  it("reads Rías Baixas' two-column Fase / Descripción tables in reading order", () => {
    const t = `
2.2       Características organolépticas:

Rías Baixas Albariño

          Fase                                      Descripción
      Fase visual   Color amarillo pajizo con tonos dorados o verdosos. Limpio y brillante
                    Intensidad media-alta. Vino de gran complejidad aromática, dominando los
      Fase olfativa aromas primarios de las series cítrica, floral y frutal, donde destaca el
                    aroma a manzana.
      Fase          Equilibrio en boca, con ligera acidez. Buena estructura, con untuosidad
      gustativa     media y persistencia. Posgusto floral y frutal.

Rías Baixas tinto

          Fase                                      Descripción
      Fase visual   Color rojo picota con tonos violáceos. Capa media. Limpio y brillante.
                    Vinos con intensidad media. Dominio de aromas primarios a frutos rojos
      Fase olfativa
                    (fresa, mora, etc) y aromas vegetales.
      Fase          Ligera estructura en boca, moderadamente tánica. Persistencia media con
      gustativa     recuerdos afrutados.

2.3       Prácticas enológicas específicas
`;
    const out = parseSpanishTaste(t);
    expect(out.map((c) => [c.style, c.colour])).toEqual([
      ["Rías Baixas Albariño", "white"],
      ["Rías Baixas tinto", "red"],
    ]);
    expect(out[0].clause_text).toMatch(/^Fase visual: Color amarillo pajizo/);
    expect(out[0].clause_text).toMatch(/Fase gustativa: Equilibrio en boca, con ligera acidez/);
    expect(out[0].clause_text).toMatch(/Posgusto floral y frutal\.$/);
    expect(out[1].clause_text).toMatch(/Capa media/);
  });

  it("reads Ribera del Duero's numbered Fase headings with the text on the next line, and does not end at '1. VINOS TINTOS'", () => {
    const t = `
   b)      Características organolépticas.

Los vinos en todas las categorías deberán ser francos, entendiendo como franco un vino sin
defectos aromáticos notorios y con ausencia de aromas ajenos a la correcta elaboración.

1. VINOS TINTOS

      1.1 VINOS TINTOS JÓVENES

             1.1.1 Fase Visual

             Limpios, con intensidad de color al menos media y tonalidades que oscilan entre
             el rojo violáceo y el rojo púrpura.

             1.1.2 Fase Olfativa

             Presencia de aromas de frutas rojas y/o negras frescas en intensidad media.

             1.1.3 Fase Gustativa

             Equilibrados y frescos como consecuencia de la componente ácida y con
             cuerpo medio o bajo. Persistencia al menos baja.

      1.2 VINOS TINTOS JÓVENES CON EDAD SUPERIOR A LOS DOS AÑOS

             1.2.1 Fase Visual

             Limpios, con tonalidades que oscilan entre el rojo violáceo y el rojo granate.

             1.2.2 Fase Olfativa

             Presencia de aromas de frutas rojas y/o negras en intensidad media.

             1.2.3 Fase Gustativa

             Equilibrados y frescos.

c)      Prácticas enológicas específicas
`;
    const out = parseSpanishTaste(t);
    expect(out.map((c) => c.style)).toEqual(["VINOS TINTOS JÓVENES", "VINOS TINTOS JÓVENES CON EDAD SUPERIOR A LOS DOS AÑOS"]);
    expect(out[0].colour).toBe("red");
    expect(out[0].clause_text).toMatch(/Fase Visual Limpios, con intensidad de color/);
    expect(out[0].clause_text).toMatch(/Persistencia al menos baja\.$/);
  });

  it("falls back to prose split by 'Los vinos tintos ...' when a pliego has no Vista / Olfato / Boca lines", () => {
    const t = `
2.2. Características organolépticas

Los vinos blancos son limpios y brillantes, de color amarillo pajizo, con aromas frutales y florales
de intensidad media y una boca fresca y equilibrada.

Los vinos tintos presentan color rojo cereza con ribetes violáceos, aromas de fruta roja y negra
madura, y una boca con taninos maduros y buena persistencia.

3. PRÁCTICAS ENOLÓGICAS ESPECÍFICAS
`;
    const out = parseSpanishTaste(t);
    expect(out.map((c) => [c.style, c.colour])).toEqual([
      ["vinos blancos", "white"],
      ["vinos tintos", "red"],
    ]);
  });
});
