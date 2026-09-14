# Pack gaps - what the corpus cannot carry

Growers and names I wanted on a shelf and did not put there. Nothing below was
substituted with a worse row; the shelf is short instead. Every claim here was
run as a `wine.producers.name_norm` regex against the loaded corpus, not assumed.
First cut, 14 Sep 2026.

## 1. Not in LWIN at all (verified: zero producer rows)

| Shelf | Wanted | Searched `name_norm ~` |
|---|---|---|
| sherry | Callejuela | `callejuela` |
| sherry | Cota 45 / Primitivo Collantes | `cota 45`, `collantes` |
| etna | Vino di Anna | `vino di anna` |
| mosel-kabinett | Weingut Stein (Ulrich Stein) | `weingut stein` |
| mosel-kabinett | Melsheimer | `melsheimer` |
| alsace | Patrick Meyer (Domaine Julien Meyer is a different row) | `patrick meyer` |
| austrian-gruner | Weingut Hofer | `weingut hofer` |
| loire-chenin | Julien Pineau | `julien pineau` |
| swartland | Sadie's Skerpioen and Mev. Kirsten single-vineyard labels | `skerpioen` |
| jura | Fanfan Ganevat (the négoce label) | `fanfan` |

## 2. In LWIN but too thin to put on a core run

A row with one or two wines is a name, not a producer the Bore can talk about.

| Shelf | Row | Wines |
|---|---|---|
| mosel-kabinett | `Schloss Lieser` (68717) | 1 - the real estate is Thomas Haag's and LWIN has no fuller row |
| sherry | `Ramiro Ibanez` (68785) | 1 |
| loire-chenin | `Richard Leroy` (50884) | 2 |
| loire-chenin | `Domaine du Bel Air` (57244) | 1 |
| etna | `Scirto` (66781) | 1 |
| piedmont-beyond-barolo | `Trinchero` (40351) | 2 |
| rioja-traditionalists | `CVNE (Contino)` (37016) | 0 - Contino has no standalone house row, only this empty alias |
| swartland | `Bryan MacRobert Wines` (68588), `Collectible Vintage (Ian Naude)` (67849) | 1 each |
| champagne-growers | `Frederic Savart` (68530) | 2 - `Savart` (43126, 21 wines) is the usable row; `Marie-Courtin` is split 39626 (11) / 44847 (1) |

## 3. In LWIN, good rows, left off for the ten-producer cap

Not missing - queued. Candidates for the next cut if Andy wants a longer counter:
`Domaine des Cavarodes` (48813, 20), `Les Bottes Rouges` (56723, 15),
`Peggy et Jean-Pascal Buronfosse` (48804, 17) for Jura;
`Jean-Claude Lapalu` (37605, 11), `Karim Vionnet` (52849, 5),
`Domaine Chignard` (40937, 4) for Beaujolais;
`Thibaud Boudignon` (45061, 9) for Loire Chenin;
`Martin Mullen` (52661, 30), `Julian Haart` (42467, 51) for Mosel;
`Tenuta di Fessina` (38464, 3), `Eduardo Torres Acosta` (50134, 6) for Etna;
`Castello di Verduno` (38746, 13), `Cascina Tavijn` (66130, 7) for Piedmont;
`Bodega Bilbainas` (38920, 13) for Rioja;
`Maestro Sierra` (41723, 9), `Bodegas Cesar Florido` (55650, 4) for Sherry;
`Martin & Anna Arndorfer` (39576, 5), `Jurtschitsch` (44370, 41) for Austria;
`Naude` (44298, 12) for Swartland;
`Gerard Schueller et Fils` (46182, 12), `Hugel` (34468, 59) for Alsace;
`Georges Laval` (41887, 13), `Cedric Bouchard` (37524, 23),
`Emmanuel Brochet` (43236, 13) for Champagne.

## 4. Appellations the register does not hold at the level I wanted

- **Mosel**: eAmbrosia protects `Mosel` (2317), `Nahe` (2319), `Rheingau` (2322)
  and nothing below. There is no Bernkastel, Wehlen, Graach, Saar or Ruwer PDO
  row, so the shelf's appellation list is three regional names and the village
  detail sits in the producer and wine notes. The only Saar/Ruwer rows are
  *Landwein* PGIs (2347, 2348), which are the wrong thing entirely.
- **Rioja**: one `Rioja` PDO (2145). Rioja Alta / Alavesa / Oriental are not
  register rows, so "traditionalist" cannot be expressed as a place here.
- **Swartland**: no EU register row. The four members (7101, 7447, 7522, 7071)
  are synthetic `source='lwin'` WO rows from `resolve-appellations.ts` with
  `gi_type='WO'`. No cahier behind them and no permitted-variety list - the Bore
  must not quote rules on this shelf.
- **Etna**: the contrade (Santo Spirito, Rampante, Barbabecchi, Calderara
  Sottana) are not appellations anywhere in the corpus. They appear inside
  `wine.wines.display_name` only.
- **Jura**: Arbois Pupillin is a sub-denomination with no separate register row;
  it exists only as an LWIN `sub_region`. `Crémant du Jura` and `Vin de paille`
  same, and the shelf caps at four appellations anyway.

## 5. Grapes with no usable row

- **Sylvaner** for Alsace: no plain Sylvaner row. Nearest is `Sylvaner Verde`
  (5389), which is Grüner Silvaner under another spelling and would read as a
  different grape. The Alsace shelf runs Riesling / Pinot gris / Gewürztraminer.
- **Ploussard**, the Jura's own name for Poulsard: not a `grape_names` alias.
  Poulsard (5482) carries the shelf; Bornard's labels say Ploussard and the Bore
  will not join the two.
- **Palomino Fino**: only `Palomino` (6418). Fine for the shelf, wrong if anyone
  asks about the Jerez clone distinction.
- **Garnacha**: the plain name resolves to `Garnacha Tinta` (6036) and `Grenache`
  (6208) is a separate row with fewer appellation links. Rioja uses 6036, so a
  question phrased "Grenache" may land on the other row.
- **Ruché**: two rows, `Ruché` (6273, 36 appellation links) and `Ruche'` (5403,
  0). Cascina Tavijn is not on the shelf so neither is used, but the duplicate is
  live and will bite whoever adds a Monferrato shelf.

## 6. Wines

- **Huet Clos du Bourg**: LWIN splits it. `Clos Bourg Sec` (1789180) is the dry
  bottling and is on the shelf; `Clos du Bourg Moelleux` (3005691),
  `Clos Bourg Demi Sec` (1218750) and three experimental cuvées are separate
  LWINs under the same producer. There is no single "Clos du Bourg" row.
- **Overnoy/Houillon**: filed as `Maison Pierre Overnoy` (49252). Houillon
  appears on none of those rows; the Houillon producer rows are
  `Bruyere Renaud & Houillon Adeline` (54076) and `Corentin Houillon` (58052),
  who are different people. `Domaine Overnoy` (54115) is Guillaume Overnoy in
  Côtes du Jura - a separate house, not a duplicate, so it was not merged.
- **Egon Müller Scharzhofberger Kabinett**: nineteen Live LWINs, most of them
  auction lots (`Nr2`, `Nr17`, `Auktion`). The shelf uses the plain row
  (1089886); a question about a specific cask number resolves elsewhere.
- **Clos de la Roilette**: producer row is `Coudert` (43175). `Domaine Coudert`
  (37603) is the same family on a thinner row, and LWIN spells the wine
  `Clos de la Roilette` (1906329) and `Clos Roilette` (1684573, Combined) on
  different LWINs.
