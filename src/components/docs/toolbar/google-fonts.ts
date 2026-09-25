// The Google Fonts families the Fonts dialog lists (More fonts, SPEC.md §29),
// most popular first: one line per family — name, category (s sans serif,
// r serif, d display, h handwriting, m monospace), weights in hundreds with
// "i" when it has italics, the scripts it covers (a bit per SCRIPTS entry,
// base 36), its trending rank, and the day Google added it. Loaded only when
// the dialog opens.

export const SCRIPTS = [
  "arabic",
  "bengali",
  "chinese-hongkong",
  "chinese-simplified",
  "chinese-traditional",
  "cyrillic",
  "cyrillic-ext",
  "devanagari",
  "greek",
  "greek-ext",
  "gujarati",
  "gurmukhi",
  "hebrew",
  "japanese",
  "kannada",
  "khmer",
  "korean",
  "latin",
  "latin-ext",
  "malayalam",
  "myanmar",
  "oriya",
  "sinhala",
  "tamil",
  "telugu",
  "thai",
  "tibetan",
  "vietnamese",
] as const;

export type Script = (typeof SCRIPTS)[number];
export type FontCategory = "sans-serif" | "serif" | "display" | "handwriting" | "monospace";

export type GoogleFont = {
  name: string;
  category: FontCategory;
  weights: number[];
  italic: boolean;
  scripts: number;
  /** 0 is the most popular. */
  popularity: number;
  trending: number;
  /** YYYYMMDD. */
  added: number;
};

const CATEGORY: Record<string, FontCategory> = {
  s: "sans-serif",
  r: "serif",
  d: "display",
  h: "handwriting",
  m: "monospace",
};

let parsed: GoogleFont[] | null = null;

export function googleFonts(): GoogleFont[] {
  if (parsed) return parsed;
  parsed = DATA.trim()
    .split("\n")
    .map((line, popularity) => {
      const [name, cat, weights, scripts, trending, added] = line.split("|");
      return {
        name,
        category: CATEGORY[cat] ?? "sans-serif",
        weights: [...weights.replace("i", "")].map((d) => Number(d) * 100),
        italic: weights.endsWith("i"),
        scripts: parseInt(scripts, 36),
        popularity,
        trending: Number(trending),
        added: Number(added),
      };
    });
  return parsed;
}

const DATA = `
Roboto|s|123456789i|28574w|1317|20130108
Open Sans|s|345678i|285aao|1318|20110202
Google Sans|s|4567i|3b6pya|1342|20251209
Inter|s|123456789i|28574w|876|20200124
Montserrat|s|123456789i|2856jk|1329|20111213
Poppins|s|123456789i|8fi8|1268|20150603
Lato|s|13479i|8feo|1604|20101215
Noto Sans JP|s|123456789|285ctc|1287|20150129
Roboto Condensed|s|123456789i|28574w|1358|20120626
Arimo|s|4567i|285aao|1359|20260512
Roboto Mono|m|1234567i|2856qo|1290|20250512
Oswald|s|234567|2856jk|1356|20120229
Noto Sans|s|123456789i|28578g|1081|20130227
DM Sans|s|123456789i|8feo|677|20190611
Raleway|s|123456789i|2856jk|1113|20120907
Nunito|s|23456789i|2856jk|1567|20120812
Playfair Display|r|456789i|2856hs|1002|20111116
Nunito Sans|s|23456789i|2856jk|1242|20161207
Roboto Slab|r|123456789|28574w|1019|20130410
Rubik|s|3456789i|8in5|1199|20150722
Manrope|s|2345678|2856qo|717|20191002
Ubuntu|s|3457i|8g2o|939|20101215
Kanit|s|123456789i|2s4d8g|1644|20151207
Outfit|s|123456789|8feo|923|20210927
Archivo Black|s|4|8feo|1239|20120918
Merriweather|r|3456789i|2856jk|744|20110511
Work Sans|s|123456789i|2856gw|861|20150708
Lora|r|4567i|2856jk|885|20110706
Plus Jakarta Sans|s|2345678i|2856io|583|20220323
Quicksand|s|34567|2856gw|780|20111019
Figtree|s|3456789i|8feo|956|20220721
Bebas Neue|s|4|8feo|802|20191016
PT Sans|s|47i|8fhc|1304|20100921
Noto Sans KR|s|123456789|286l28|1771|20180205
Mulish|s|23456789i|2856jk|1286|20110525
Noto Sans TC|s|123456789|2856i8|1665|20181022
Archivo|s|123456789i|2856gw|480|20161203
JetBrains Mono|m|12345678i|2856qo|474|20201118
Source Sans 3|s|23456789i|28574w|1014|20210917
Barlow|s|123456789i|2856gw|1312|20171026
Bricolage Grotesque|s|2345678|2856gw|1089|20230614
Prompt|s|123456789i|2s4d8g|1780|20160615
IBM Plex Sans|s|1234567i|2856qo|958|20180311
Jost|s|123456789i|8ffk|1363|20200211
Inconsolata|m|23456789|2856gw|737|20100219
Saira|s|123456789i|2856gw|1920|20170731
Black Ops One|d|4|2856io|1944|20110727
Karla|s|2345678i|8feo|1675|20120314
Fira Sans|s|123456789i|28574w|1146|20140618
Space Grotesk|s|34567|2856gw|977|20201006
Noto Serif|r|123456789i|28574w|880|20130227
Share Tech|s|4|2t4w|1899|20121031
Smooch Sans|s|123456789|2856gw|1889|20211217
Libre Baskerville|r|4567i|8feo|759|20121130
Titillium Web|s|234679i|8feo|1351|20121001
Heebo|s|123456789|8ikg|1837|20160615
Cormorant Garamond|r|34567i|2856jk|1018|20160615
Google Sans Flex|s|123456789|2856gw|692|20251112
PT Serif|r|47i|8fhc|1190|20110209
Source Code Pro|m|23456789i|28574w|2210|20120920
Noto Color Emoji|s|4|0|1335|20210216
Noto Sans SC|s|123456789|2856i0|1275|20181022
Dancing Script|h|4567|2856gw|1591|20110518
Inter Tight|s|123456789i|28574w|213|20220722
Fjalla One|s|4|2856io|1699|20121027
Barlow Condensed|s|123456789i|2856gw|1095|20171026
Instrument Serif|r|4i|8feo|584|20230321
Public Sans|s|123456789i|2856gw|1067|20190607
Libre Franklin|s|123456789i|2856jk|1683|20160615
Anton|s|4|2856gw|1144|20110223
IBM Plex Mono|m|1234567i|2856jk|345|20180312
EB Garamond|r|45678i|28574w|874|20110323
Lobster Two|d|47i|2t4w|1731|20110621
Josefin Sans|s|1234567i|2856gw|1293|20101117
Noto Serif JP|r|23456789|285ctc|1670|20180822
Cairo|s|23456789|8fep|720|20160615
Fraunces|r|123456789i|2856gw|1858|20200723
Sora|s|12345678|8feo|1171|20200610
Bitter|r|123456789i|2856jk|764|20111219
Mukta|s|2345678|8fi8|1222|20170126
Schibsted Grotesk|s|456789i|8feo|1083|20230302
Changa One|d|4i|2t4w|2031|20111130
Assistant|s|2345678|8ikg|1685|20160331
Lexend|s|123456789|2856gw|2080|20210308
Roboto Flex|s|123456789|2856qo|1148|20220502
Urbanist|s|123456789i|8feo|1704|20210602
DM Serif Display|r|4i|8feo|1084|20190611
Alfa Slab One|d|4|2856gw|1244|20111219
Hind Siliguri|s|34567|8feq|1088|20160615
Geist|s|123456789i|2856jk|573|20241001
Cabin|s|4567i|2856gw|1803|20110323
Caveat|h|4567|8fhc|741|20150923
Dosis|s|2345678|2856gw|1775|20120320
Noto Sans Telugu|s|123456789|a80sg|1039|20201119
Rajdhani|s|34567|8fi8|1798|20140709
Ramabhadra|s|4|a2eio|997|20141210
Red Hat Display|s|3456789i|8feo|1300|20190409
Anek Telugu|s|12345678|a80sg|1003|20220215
Noto Sans Khmer|s|123456789|94ow|1654|20201119
Zeyada|h|4|8feo|62|20110608
M PLUS Rounded 1c|s|1345789|285gm8|1688|20180517
Exo 2|s|123456789i|2856jk|1733|20131204
Nanum Gothic|s|478|47pc|1762|20180205
Fredoka|s|34567|8ikg|828|20211215
Source Serif 4|r|23456789i|2856qo|902|20211116
Instrument Sans|s|4567i|8feo|893|20230508
Newsreader|r|2345678i|2856gw|176|20200701
Oxygen|s|347|8feo|1109|20120329
Merriweather Sans|s|345678i|2856io|482|20130306
Overpass|s|123456789i|2856jk|1070|20161202
Orbitron|s|456789|2t4w|1898|20101215
Lilita One|d|4|8feo|2185|20120111
Hind|s|34567|8fi8|1276|20140625
Crimson Text|r|467i|2856gw|1668|20110126
Pacifico|h|4|2856jk|1007|20110309
Cinzel|r|456789|8feo|1141|20121024
Barlow Semi Condensed|s|123456789i|2856gw|750|20171026
Slabo 27px|r|4|8feo|1681|20140530
Bungee|d|4|2856gw|1117|20160615
Tajawal|s|2345789|2t4x|1769|20180404
Lobster|d|4|2856jk|1867|20100517
PT Sans Narrow|s|47|8fhc|1730|20100921
Arvo|r|47i|2t4w|1126|20101117
Domine|r|4567|8feo|1212|20121130
Hanken Grotesk|s|123456789i|2856io|590|20221116
Geist Mono|m|123456789i|2856jk|594|20241002
Comfortaa|d|34567|2856qo|863|20110810
Noto Sans Arabic|s|123456789|8fep|1770|20201119
Chakra Petch|s|34567i|2s4d8g|566|20180910
Noto Sans Thai|s|123456789|k7m68|1071|20201119
Teko|s|34567|8fi8|1597|20140625
DM Mono|m|345i|8feo|542|20200415
Bodoni Moda|r|456789i|8feo|722|20201125
Space Mono|m|47i|2856gw|829|20160615
Abel|s|4|2t4w|1929|20110803
Asap|s|123456789i|2856gw|1883|20120125
Maven Pro|s|456789|2856gw|1711|20110525
M PLUS 1p|s|1345789|285gm8|2328|20170612
Shadows Into Light|h|4|8feo|1346|20110608
Questrial|s|4|2856gw|1079|20110810
Satisfy|h|4|2t4w|1147|20111012
Zilla Slab|r|34567i|8feo|1587|20170628
Almarai|s|3478|2t4x|1165|20190604
Play|s|47|2856qo|1325|20110504
Zen Kaku Gothic New|s|34579|8lr4|1393|20210831
Lexend Deca|s|123456789|2856gw|1131|20190801
Archivo Narrow|s|4567i|2856gw|1278|20120918
ABeeZee|s|4i|8feo|1651|20120930
Gravitas One|d|4|2t4w|2061|20110629
Onest|s|123456789|2856jk|1041|20230905
Albert Sans|s|123456789i|8feo|1783|20220608
Be Vietnam Pro|s|123456789i|2856gw|1925|20210613
Abril Fatface|d|4|8feo|2128|20110831
Marcellus|r|4|8feo|1103|20120509
Alumni Sans|s|123456789i|2856jk|1609|20210619
Spectral|r|2345678i|2856jk|962|20170612
Great Vibes|h|4|2856xs|1192|20120329
Syne|s|45678|8fls|1627|20200825
Cormorant|r|34567i|2856jk|1015|20160615
IBM Plex Serif|r|1234567i|2856jk|1415|20180311
Varela Round|s|4|2859mo|1618|20110713
Exo|s|123456789i|2856gw|1977|20120208
League Spartan|s|123456789|2856gw|2148|20211217
Saira Condensed|s|123456789|2856gw|259|20170731
Permanent Marker|h|4|2t4w|1163|20110106
Unbounded|s|23456789|2856jk|721|20221107
Geologica|s|123456789|2856qo|631|20230529
Sanchez|r|4i|8feo|484|20121031
Indie Flower|h|4|8feo|1034|20110309
Oleo Script|d|47|8feo|389|20120329
IBM Plex Sans Arabic|s|1234567|8fgh|1870|20210617
Noto Serif TC|r|23456789|2856i8|899|20181203
Rethink Sans|s|45678i|8feo|2247|20230905
Epilogue|s|123456789i|2856gw|1324|20200626
Titan One|d|4|8feo|386|20120111
Noto Sans Devanagari|s|123456789|8fi8|138|20201119
Baloo 2|d|45678|2856kg|604|20160120
Zen Maru Gothic|s|34579|8ly8|1188|20210831
Noto Serif SC|r|23456789|2856i0|1072|20181203
Noto Sans Tamil|s|123456789|5883k|1361|20201119
Atkinson Hyperlegible|s|47i|8feo|331|20210430
Frank Ruhl Libre|r|3456789|8ikg|1680|20160620
Fira Code|m|34567|8g2o|342|20190324
Sofia Sans|s|123456789i|8fog|2038|20210113
Encode Sans|s|123456789|2856gw|329|20170208
Kalam|h|347|8fi8|875|20141017
Roboto Serif|r|123456789i|2856jk|522|20220210
Nanum Myeongjo|r|478|47pc|1271|20180205
Sarabun|s|12345678i|2s4d8g|1221|20131028
Montserrat Alternates|s|123456789i|2856jk|1208|20121001
Crimson Pro|r|23456789i|2856gw|2106|20181204
Amiri|r|47i|8fep|1042|20120730
Catamaran|s|123456789|5883k|910|20150708
Noto Kufi Arabic|s|123456789|8fep|961|20201119
Luckiest Guy|d|4|8feo|973|20110106
Courier Prime|m|47i|8feo|2139|20191205
Fira Sans Condensed|s|123456789i|28574w|1004|20161207
Vollkorn|r|456789i|2856qo|1815|20100908
Delius|h|4|2t4w|628|20110727
Playfair|r|3456789i|2856jk|568|20230412
Andada Pro|r|45678i|2856gw|581|20210519
Press Start 2P|d|4|8fog|911|20120404
Alegreya Sans|s|1345789i|28574w|553|20131204
LINE Seed JP|s|1478|8m5c|679|20260121
Noto Serif KR|r|23456789|286l28|2042|20180822
Signika|s|34567|2856gw|1156|20111123
Literata|r|23456789i|28574w|1660|20181206
DM Serif Text|r|4i|8feo|881|20190611
Viga|s|4|8feo|1948|20111207
Aleo|r|123456789i|2856gw|2005|20181211
News Cycle|s|47|28574w|1347|20110427
Cardo|r|47i|8j5s|1743|20110907
Baskervville|r|4567i|8feo|955|20191004
Chivo|s|123456789i|2856gw|1254|20111207
Righteous|d|4|8feo|629|20111123
Bree Serif|r|4|8feo|1760|20111219
Tinos|r|47i|285aao|846|20260512
Antic Slab|r|4|2t4w|197|20120314
Yellowtail|h|4|8feo|951|20110720
Google Sans Code|m|345678i|2856gw|193|20250226
Yanone Kaffeesatz|s|234567|2856jk|1193|20100511
Red Hat Text|s|34567i|8feo|2133|20190409
Prata|r|4|27zk9s|1894|20110907
Libre Barcode 39|d|4|2t4w|1074|20170731
Shippori Mincho|r|45678|8lq8|842|20210104
Amatic SC|h|47|2859nk|1170|20111012
Alata|s|4|2856gw|990|20191108
Noto Naskh Arabic|r|4567|8fep|711|20201119
Acme|s|4|2t4w|1411|20111219
Hammersmith One|s|4|8feo|1198|20110629
League Gothic|s|4|2856gw|166|20211209
Russo One|s|4|8ffk|2243|20120404
Golos Text|s|456789|8fhc|249|20230105
Rowdies|d|347|2856gw|1593|20191010
Readex Pro|s|234567|2856gx|1259|20210916
Alegreya|r|456789i|28574w|1219|20111219
Old Standard TT|r|47i|2856jk|854|20100518
Faustina|r|345678i|2856gw|52|20170731
Special Elite|d|4|8feo|1267|20110420
Gothic A1|s|123456789|286lpc|1879|20180224
Tenor Sans|s|4|8ffk|1100|20110525
Noto Sans Display|s|123456789i|28574w|1859|20201119
Comic Neue|h|347i|2t4w|535|20200312
IBM Plex Sans Condensed|s|1234567i|2856io|2029|20180312
Cantarell|s|47i|8feo|1009|20100510
Sawarabi Mincho|r|4|8lq8|1327|20180517
Kumbh Sans|s|123456789|8feo|1996|20200722
Paytone One|s|4|2856gw|422|20110504
Sacramento|h|4|8feo|1164|20121101
Quattrocento|r|47|8feo|685|20120320
Bangers|d|4|2856gw|1836|20110209
Kaushan Script|h|4|8feo|1748|20120125
Libre Caslon Text|r|47i|8feo|2152|20130314
Hind Madurai|s|34567|5883k|1160|20160615
Patrick Hand|h|4|2856gw|1135|20110706
Advent Pro|s|123456789i|8fog|1035|20120229
Khand|s|34567|8fi8|2149|20140714
Courgette|h|4|8feo|1094|20120710
Changa|s|2345678|8fep|1976|20160615
Creepster|d|4|2t4w|1908|20111219
Allura|h|4|2856gw|1739|20120208
Noticia Text|r|47i|2856gw|1797|20120208
Nanum Gothic Coding|h|47|47pc|913|20180205
Patua One|d|4|2t4w|1779|20111219
VT323|m|4|2856gw|1611|20110302
Noto Sans Mono|s|123456789|28574w|1322|20201119
BIZ UDPGothic|s|47|8m5c|837|20220316
STIX Two Text|r|4567i|2856qo|975|20210415
Fugaz One|d|4|2t4w|858|20111219
Antonio|s|1234567|8feo|1017|20130305
Lexend Giga|s|123456789|2856gw|775|20190801
Audiowide|d|4|8feo|408|20120404
PT Sans Caption|s|47|8fhc|1871|20100921
Crete Round|r|4i|8feo|2201|20111219
Sawarabi Gothic|s|4|285ctc|1697|20180517
Noto Nastaliq Urdu|r|4567|8fep|2003|20201119
Share Tech Mono|m|4|2t4w|2265|20121031
Sen|s|45678|8feo|1823|20200117
Yantramanav|s|134579|8fi8|855|20150603
Gruppo|s|4|8feo|1022|20101220
Rubik Mono One|s|4|8ffk|1647|20140505
Sofia Sans Condensed|s|123456789i|8fog|1182|20221116
PT Mono|m|4|8fhc|2288|20120229
Francois One|s|4|2856gw|1677|20110504
Zen Old Mincho|r|45679|8ly8|1134|20210831
Alexandria|s|123456789|2856gx|1289|20221103
Commissioner|s|123456789|2856qo|1145|20200720
Didact Gothic|s|4|8g2o|994|20110504
Neuton|r|23478i|8feo|945|20110209
Passion One|d|479|8feo|1659|20111213
Chelsea Market|d|4|8feo|2232|20120104
Noto Sans Bengali|s|123456789|8feq|1216|20201119
Actor|s|4|2t4w|931|20110803
Quantico|s|47i|2t4w|409|20111219
Philosopher|s|47i|2856jk|1744|20110831
Ubuntu Condensed|s|4|8g2o|1013|20111005
Oxanium|d|2345678|8feo|2016|20200130
Gloria Hallelujah|h|4|8feo|716|20110727
Martel|r|2346789|8fi8|2090|20150420
Fira Mono|m|457|8g2o|82|20140618
Rokkitt|r|123456789i|2856gw|1265|20110727
Noto Sans HK|s|123456789|2856hw|686|20190312
Rock Salt|h|4|2t4w|1107|20110106
Josefin Slab|r|1234567i|2t4w|1353|20101117
Radio Canada|s|34567i|2856gw|748|20220425
Signika Negative|s|34567|2856gw|2069|20111123
Unna|r|47i|8feo|726|20110720
Encode Sans Condensed|s|123456789|2856gw|1696|20170208
Merienda|h|3456789|2856gw|415|20121031
Forum|d|4|8fhc|1283|20110706
Amaranth|s|47i|2t4w|840|20110504
Bai Jamjuree|s|234567i|2s4d8g|1777|20180910
Kosugi Maru|s|4|8lr4|1372|20160121
Architects Daughter|h|4|8feo|904|20110309
Noto Sans Hebrew|s|123456789|8j0g|1814|20201119
Pinyon Script|h|4|2856gw|701|20111012
Gilda Display|r|4|8feo|1959|20121031
Playball|d|4|2856gw|496|20111219
Playfair Display SC|r|479i|2856hs|1332|20121026
Vazirmatn|s|123456789|8fep|1664|20220316
Alex Brush|h|4|2856gw|1046|20111219
Tangerine|h|47|2t4w|1273|20100608
Homemade Apple|h|4|2t4w|815|20110106
Cookie|h|4|2t4w|1639|20111012
Gabarito|d|456789|8feo|799|20230912
Gelasio|r|4567i|2856gw|533|20191203
Quattrocento Sans|s|47i|8feo|1305|20120215
Andika|s|47i|2856jk|203|20110810
Biryani|s|2346789|8fi8|2307|20150422
Rammetto One|d|4|8feo|1225|20111102
Poiret One|d|4|8ffk|1386|20120229
M PLUS 1|s|123456789|285csg|1808|20210825
Asap Condensed|s|23456789i|2856gw|2226|20170731
Reenie Beanie|h|4|2t4w|318|20100510
Krub|s|234567i|2s4d8g|1924|20180910
Saira Extra Condensed|s|123456789|2856gw|145|20170731
Istok Web|s|47i|8fhc|1887|20110713
Concert One|d|4|8feo|1625|20111123
Lustria|r|4|2t4w|870|20120118
Staatliches|d|4|8feo|645|20181209
Berkshire Swash|h|4|8feo|1024|20120314
El Messiri|s|4567|8ffl|704|20160531
Abhaya Libre|r|45678|2qbr4|1121|20160830
Monoton|d|4|8feo|1203|20110824
Eczar|r|45678|8g3k|2169|20150603
Pathway Gothic One|s|4|8feo|1671|20130605
Dela Gothic One|d|4|285d0g|2108|20201213
Blinker|s|12346789|8feo|2377|20190623
Noto Sans Malayalam|s|123456789|jny8|269|20201119
Yeseva One|d|4|2856jk|1301|20110713
Cormorant Infant|r|34567i|2856jk|253|20160615
Italianno|h|4|2856gw|2231|20111219
Lalezar|s|4|2856gx|1727|20160615
Arsenal|s|47i|2856jk|545|20161206
Lusitana|r|47|2t4w|830|20120111
Chango|d|4|8feo|1583|20111213
Cinzel Decorative|d|479|8feo|2056|20121024
GFS Didot|r|4|27zksg|1630|20100921
Carlito|s|47i|28574w|63|20230419
Doppio One|s|4|8feo|2068|20120222
Goldman|d|47|2856gw|363|20200721
Nothing You Could Do|h|4|2t4w|2105|20110511
Hind Guntur|s|34567|a80sg|728|20160615
Volkhov|r|47i|2t4w|400|20110817
Slabo 13px|r|4|8feo|2115|20140530
Libre Bodoni|r|4567i|2856gw|1066|20220413
Eater|d|4|8feo|1368|20111219
Handlee|h|4|2t4w|406|20111213
Parisienne|h|4|8feo|1621|20120125
Ubuntu Mono|m|47i|8g2o|1927|20111005
Monda|s|4567|2856gw|177|20121130
Alegreya Sans SC|s|1345789i|28574w|655|20131204
Petrona|r|123456789i|2856gw|2097|20200714
Zen Kaku Gothic Antique|s|34579|8lr4|650|20210831
Host Grotesk|s|345678i|8feo|925|20241105
Besley|r|456789i|8feo|1044|20210105
Mrs Saint Delafield|h|4|8feo|239|20120111
Radio Canada Big|s|4567i|8feo|947|20240501
Unica One|d|4|2856gw|2135|20121026
Mitr|s|234567|2s4d8g|1861|20160615
Michroma|s|4|8feo|1367|20110330
Sorts Mill Goudy|r|4i|8feo|1700|20110907
Atkinson Hyperlegible Next|s|2345678i|8feo|142|20250106
Nanum Pen Script|h|4|47pc|916|20180205
Belleza|s|4|8feo|1640|20120329
Ubuntu Sans|s|12345678i|8g2o|1068|20240501
Noto Serif Display|r|123456789i|28574w|1757|20201119
Sriracha|h|4|2s4d8g|656|20150701
Vidaloka|r|4|2t4w|1750|20110817
Black Han Sans|s|4|47pc|2091|20180223
Sarala|s|47|8fi8|289|20150617
IBM Plex Sans Thai|s|1234567|k7m80|1962|20210618
Kaisei Decol|r|457|8lr4|666|20210521
Mona Sans|s|23456789i|2856gw|508|20241104
Syncopate|s|47|8feo|946|20110427
Caveat Brush|h|4|8feo|2197|20150923
Mada|s|23456789|8fep|1065|20170726
Jua|s|4|47pc|151|20180224
Potta One|d|4|285csg|506|20201214
Saira Semi Condensed|s|123456789|2856gw|712|20170731
Mr Dafoe|h|4|8feo|659|20111130
Cuprum|s|4567i|2856jk|1313|20120404
Hachi Maru Pop|h|4|8lr4|644|20201214
Damion|h|4|8feo|2355|20110427
Bad Script|h|4|2856jk|932|20111213
Jura|s|34567|28574w|2252|20110518
Bevan|r|4i|2856gw|1111|20110223
Cousine|m|47i|285aao|1854|20101118
Hind Vadodara|s|34567|8g74|1187|20160615
Afacad|s|4567i|2856io|1236|20231204
Anonymous Pro|m|47i|8fmo|2233|20101215
Noto Serif Bengali|r|123456789|8feq|1912|20201119
Cutive Mono|m|4|8feo|2356|20121026
Calistoga|d|4|2856gw|1364|20191104
Ropa Sans|s|4i|8feo|2237|20120125
Racing Sans One|d|4|8feo|785|20120813
Pragati Narrow|s|47|8fi8|879|20150422
Ms Madi|h|4|2856gw|1139|20220323
Arapey|r|4i|2t4w|1038|20111102
Taviraj|r|123456789i|2s4d8g|988|20160615
Fira Sans Extra Condensed|s|123456789i|28574w|1233|20161207
Amita|h|47|8fi8|1001|20150520
Balsamiq Sans|d|47i|8fhc|222|20200409
Alice|r|4|8fhc|1186|20110810
Mukta Malar|s|2345678|5883k|967|20170213
Georama|s|123456789i|2856gw|1938|20200701
Skranji|d|47|8feo|546|20120821
Averia Serif Libre|d|347i|2t4w|639|20120314
Reddit Sans|s|23456789i|2856gw|1257|20231010
Shippori Mincho B1|r|45678|8lq8|851|20210104
Varela|s|4|8feo|1150|20110629
Funnel Sans|s|345678i|8feo|534|20241105
Gochi Hand|h|4|2t4w|1862|20111005
Marck Script|h|4|8ffk|1738|20111012
REM|s|123456789i|2856gw|979|20230720
Sofia Sans Extra Condensed|s|123456789i|8fog|1968|20221116
Carter One|d|4|2t4w|1073|20110504
Yuji Mai|r|4|8lr4|681|20210926
Julius Sans One|s|4|8feo|718|20121005
Grandstander|d|123456789i|2856gw|515|20200723
Wix Madefor Display|s|45678|2856jk|963|20230205
Kameron|r|4567|8feo|444|20110608
Azeret Mono|m|123456789i|8feo|125|20210608
Ultra|r|4|8feo|1297|20110509
Anek Bangla|s|12345678|8feq|1997|20220208
IBM Plex Sans JP|s|1234567|8lr4|1189|20220911
Lemonada|d|34567|2856gx|378|20160615
La Belle Aurore|h|4|8feo|586|20110608
Noto Sans Symbols|s|123456789|8feo|2290|20201119
Secular One|s|4|8ikg|1096|20160331
Just Another Hand|h|4|8feo|215|20101220
Familjen Grotesk|s|4567i|2856gw|405|20220302
Dongle|s|347|286l1c|2086|20210614
Palanquin Dark|s|4567|8fi8|2023|20150128
Rozha One|r|4|8fi8|108|20140813
Pangolin|h|4|2856jk|901|20170111
Gudea|s|47i|8feo|1397|20120118
Angkor|d|4|3if4|2362|20110302
Six Caps|s|4|8feo|2147|20110216
Spline Sans|s|34567|8feo|465|20211122
Pirata One|d|4|8feo|1090|20121031
Pridi|r|234567|2s4d8g|702|20160615
Bentham|r|4|8feo|423|20101130
Sofia|h|4|2t4w|1847|20111219
Gantari|s|123456789i|8feo|1047|20220525
Economica|s|47i|8feo|1381|20120229
Gloock|r|4|8fgg|143|20230105
Cabin Condensed|s|4567|2856gw|1890|20111130
Special Gothic Expanded One|s|4|8feo|577|20250407
Palanquin|s|1234567|8fi8|2138|20150128
Wix Madefor Text|s|45678i|2856jk|536|20230110
Geo|s|4i|2t4w|1282|20101130
Martel Sans|s|2346789|8fi8|1152|20150304
Belanosima|s|467|8feo|1793|20230614
Fahkwang|s|234567i|2s4d8g|1133|20180910
Ruda|s|456789|2856hs|208|20120111
Reem Kufi|s|4567|2856gx|1151|20160531
Italiana|s|4|2t4w|1352|20120314
Niramit|s|234567i|2s4d8g|1878|20180910
Caprasimo|d|4|8feo|2281|20230614
Khula|s|34678|8fi8|1825|20150128
Shrikhand|d|4|8g74|1852|20160615
Covered By Your Grace|h|4|8feo|959|20101207
Squada One|d|4|2t4w|2134|20111215
Boogaloo|d|4|2t4w|1374|20111219
Mandali|s|4|a2eio|2151|20141210
Londrina Solid|d|1349|2t4w|2171|20120314
Cedarville Cursive|h|4|2t4w|1826|20110608
Adamina|r|4|2t4w|1557|20110907
Limelight|d|4|8feo|1613|20110525
Chewy|d|4|2t4w|1728|20110106
Kreon|r|34567|8feo|27|20110202
Funnel Display|d|345678|8feo|953|20241105
Suez One|r|4|8ikg|154|20160331
Itim|h|4|2s4d8g|654|20150701
Darker Grotesque|s|3456789|2856gw|580|20190619
Baloo Da 2|d|45678|2856gy|366|20160120
Knewave|d|4|8feo|164|20111123
Leckerli One|h|4|2t4w|1284|20110720
MuseoModerno|d|123456789i|2856gw|505|20200517
Bowlby One SC|d|4|8feo|769|20110706
Oooh Baby|h|4|2856gw|1572|20211126
Nixie One|d|4|2t4w|1292|20110621
Overpass Mono|m|34567|2856jk|442|20161202
Anuphan|s|1234567|2s4d8g|1114|20230222
Days One|s|4|2t5s|391|20110817
Stardos Stencil|d|47|2t4w|1741|20110706
Germania One|d|4|2t4w|1674|20120118
Aboreto|d|4|8feo|972|20220526
Big Shoulders|d|123456789|2856gw|390|20250205
IM Fell English|r|4i|2t4w|1123|20100517
Fragment Mono|m|4i|8fgg|618|20221023
Fustat|s|2345678|8fep|1140|20240604
Tilt Warp|d|4|2856gw|1652|20221201
M PLUS 2|s|123456789|285csg|489|20210825
Mali|h|234567i|2s4d8g|230|20180910
Murecho|s|123456789|8m00|450|20211027
Tektur|d|456789|2856qo|292|20230615
Afacad Flux|s|123456789|2856gw|67|20240923
Barriecito|d|4|2856gw|452|20190611
Mate|r|4i|8feo|1585|20111102
BIZ UDGothic|s|47|8m5c|742|20220316
Ovo|r|4|2t4w|1716|20110720
Qwitcher Grypen|h|47|2856gw|77|20211126
Proza Libre|s|45678i|8feo|1714|20160615
Charm|h|47|2s4d8g|1194|20181211
Libre Barcode 128|d|4|2t4w|626|20170731
Playpen Sans|h|12345678|2856qo|818|20230906
Rye|d|4|8feo|1299|20120821
Noto Sans Meetei Mayek|s|123456789|8feo|567|20201119
Marcellus SC|r|4|8feo|1175|20120509
BenchNine|s|347|8feo|1942|20120924
Anek Latin|s|12345678|2856gw|2127|20220215
Livvic|s|12345679i|2856gw|1029|20190621
Rufina|r|47|8feo|1725|20121031
Pixelify Sans|d|4567|8ffk|669|20230926
Basic|s|4|8feo|1217|20111215
Akshar|s|34567|8fi8|558|20220321
Coda|d|48|8feo|2111|20101207
Ma Shan Zheng|h|4|2t54|1880|20190317
Parkinsans|s|345678|8feo|2264|20241118
Pontano Sans|s|34567|8feo|735|20120314
Sintony|s|47|8feo|960|20130130
Cabin Sketch|d|47|2t4w|1809|20110316
Sansita|s|4789i|8feo|1632|20161204
Yrsa|r|34567i|2856gw|1953|20160615
Krona One|s|4|8feo|438|20120222
Noto Sans Gujarati|s|123456789|8g74|2041|20201119
Niconne|h|4|8feo|413|20111123
UnifrakturMaguntia|d|4|2t4w|1729|20101130
Lexend Exa|s|123456789|2856gw|675|20190801
Do Hyeon|s|4|47pc|295|20180224
Jersey 25|d|4|8feo|1237|20240410
Aldrich|s|4|2t4w|1673|20110817
Tomorrow|s|123456789i|8feo|1931|20191002
Noto Sans Sinhala|s|123456789|2qbr4|1799|20201119
Charis SIL|r|47i|2856jk|445|20220512
Shadows Into Light Two|h|4|8feo|1102|20120222
Corben|d|47|8feo|1234|20101220
Sofia Sans Semi Condensed|s|123456789i|8fog|862|20221116
Red Hat Mono|m|34567i|8feo|2274|20210610
Chonburi|d|4|2s4d8g|190|20150708
Neucha|h|4|2t5s|1575|20100921
Special Gothic|s|4567|8feo|20|20250407
Noto Sans Georgian|s|123456789|8fuo|161|20201119
Yatra One|d|4|8fi8|2100|20160615
Trirong|r|123456789i|2s4d8g|525|20160615
Spline Sans Mono|m|34567i|8feo|596|20220327
Libre Caslon Display|r|4|8feo|550|20171129
K2D|s|12345678i|2s4d8g|2027|20180910
Electrolize|s|4|2t4w|2271|20111207
ZCOOL KuaiLe|s|4|2t54|624|20181210
Kiwi Maru|r|345|8lr4|1602|20201214
Aclonica|s|4|8feo|1902|20110427
Fredericka the Great|d|4|8feo|1694|20111219
Radley|r|4i|8feo|2196|20111213
Judson|r|47i|2856gw|519|20110504
Caladea|r|47i|8feo|284|20200211
Tiro Bangla|r|4i|8feq|382|20220525
Hepta Slab|r|123456789|2856gw|600|20180919
Noto Sans Myanmar|s|123456789|uwhs|37|20201119
PT Serif Caption|r|4i|8fhc|1320|20110209
Comic Relief|d|47|8fmo|2381|20250417
Noto Emoji|s|34567|0|822|20220429
Share|s|47i|8feo|223|20120208
Armata|s|4|8feo|1633|20111219
Ibarra Real Nova|r|4567i|8feo|574|20191104
Inria Serif|r|347i|8feo|1763|20191205
Bowlby One|d|4|2t4w|1206|20110713
Karma|r|34567|8fi8|1913|20140625
DotGothic16|s|4|8lr4|617|20201215
Chivo Mono|m|123456789i|2856gw|426|20221102
Castoro|r|4i|8feo|1910|20201103
Special Gothic Condensed One|s|4|8feo|24|20250407
Cantata One|r|4|8feo|786|20120229
ZCOOL XiaoWei|s|4|2t54|1778|20181210
Young Serif|r|4|8feo|251|20230926
Reddit Sans Condensed|s|23456789|2856gw|106|20240221
Graduate|r|4|2t4w|490|20120314
IBM Plex Sans KR|s|1234567|9tz4|328|20210618
Oranienbaum|r|4|8fhc|1832|20120820
Petit Formal Script|h|4|8feo|591|20120907
Vina Sans|d|4|2856gw|2304|20230315
Kosugi|s|4|8lr4|2099|20160121
Cormorant SC|r|34567|2856jk|757|20160615
Herr Von Muellerhoff|h|4|8feo|2242|20111130
Silkscreen|d|47|8feo|754|20220622
Gowun Batang|r|47|286l1c|1849|20210610
Averia Libre|d|347i|2t4w|1201|20120314
Enriqueta|r|4567|8feo|673|20111213
Pattaya|s|4|2s4d9c|481|20160531
Candal|s|4|2t4w|1298|20110309
Athiti|s|234567|2s4d8g|1752|20160615
Metrophobic|s|4|2856gw|1897|20110511
Bona Nova SC|r|47i|2859wg|1915|20240625
Noto Sans Kannada|s|123456789|8s1s|2017|20201119
Alef|s|47|2wao|1316|20130521
Caudex|r|47i|285728|2045|20110518
Norican|h|4|8feo|1092|20120208
TikTok Sans|s|3456789|2856qo|2198|20250428
Podkova|r|45678|2856jk|2004|20110518
Rakkas|d|4|8fep|354|20160615
Lateef|r|2345678|8fep|936|20150303
Bellefair|r|4|8ikg|1863|20170628
Tiro Devanagari Hindi|r|4i|8fi8|965|20220525
Noto Sans Gurmukhi|s|123456789|8gzk|1888|20201119
Nova Square|d|4|8feo|1838|20110414
Style Script|h|4|2856gw|1737|20210514
Glegoo|r|47|8fi8|2202|20120125
Dawning of a New Day|h|4|2t4w|954|20110414
Brygada 1918|r|4567i|2856qo|801|20210127
Allerta Stencil|s|4|2t4w|751|20101130
Seaweed Script|d|4|8feo|1684|20120229
Vujahday Script|h|4|2856gw|170|20211118
Arbutus Slab|r|4|8feo|853|20120918
Telex|s|4|8feo|1172|20120118
Cormorant Upright|r|34567|2856gw|1981|20160615
BioRhyme|r|2345678|8feo|743|20160301
Rancho|h|4|2t4w|1020|20111012
Lexend Zetta|s|123456789|2856gw|661|20190801
Coming Soon|h|4|2t4w|1037|20110106
ADLaM Display|d|4|8feo|1382|20230814
Cal Sans|s|4|2856gw|623|20250318
B612 Mono|m|47i|2t4w|723|20181211
Laila|r|34567|8fi8|2044|20140827
Average Sans|s|4|8feo|991|20121026
Marvel|s|47i|2t4w|2116|20110803
Libre Barcode 39 Text|d|4|2t4w|761|20170731
Schoolbell|h|4|2t4w|1226|20110106
Kulim Park|s|23467i|8feo|45|20190925
Allison|h|4|2856gw|2066|20210702
Klee One|h|46|8m5c|1340|20210608
Mochiy Pop One|s|4|2zgg|1817|20210414
Nobile|s|457i|8ffk|2074|20100510
Rosario|s|34567i|2856gw|1026|20110907
Halant|r|34567|8fi8|909|20140827
Mouse Memoirs|s|4|8feo|869|20121102
Pathway Extreme|s|123456789i|2856gw|1807|20230419
Irish Grover|d|4|2t4w|1701|20110316
Grand Hotel|h|4|8feo|1960|20121130
AR One Sans|s|4567|2856gw|930|20230905
Shantell Sans|d|345678i|2856jk|299|20230116
Alatsi|s|4|2856io|1774|20191107
Annie Use Your Telescope|h|4|8feo|1846|20110414
BIZ UDPMincho|r|47|8m5c|1843|20220316
Hina Mincho|r|4|285ctc|2000|20210414
Koulen|d|4|3if4|1590|20110302
Gabriela|r|4|8fhc|2093|20130306
Major Mono Display|m|4|2856gw|468|20181211
Sniglet|d|48|8feo|1594|20101215
IM Fell English SC|r|4|2t4w|2142|20100517
Antic Didone|r|4|2t4w|2085|20120314
Over the Rainbow|h|4|8feo|725|20110427
MedievalSharp|d|4|8feo|1955|20110302
Zalando Sans|s|23456789i|2856gw|361|20250911
Kelly Slab|d|4|8ffk|886|20110727
Sigmar One|d|4|2856gw|588|20110504
Calligraffitti|h|4|2t4w|1734|20110106
Hahmlet|r|123456789|286l1c|771|20210513
Wallpoet|d|4|2t4w|2203|20110427
B612|s|47i|2t4w|397|20181211
RocknRoll One|s|4|8lq8|864|20201215
Alegreya SC|r|45789i|28574w|1806|20111219
Fjord One|r|4|2t4w|1751|20111102
Cormorant Unicase|r|34567|2856jk|439|20160615
Zalando Sans Expanded|s|23456789i|2856gw|346|20250911
Noto Serif Devanagari|r|123456789|8fi8|1323|20201119
Marmelad|s|4|2856jk|1319|20111207
Lexend Peta|s|123456789|2856gw|1159|20190801
Rampart One|d|4|8lr4|1830|20210608
Arizonia|h|4|2856gw|1357|20111219
Trocchi|r|4|8feo|1857|20120404
Allerta|s|4|2t4w|1232|20101130
IBM Plex Sans Hebrew|s|1234567|8im8|895|20210618
Inclusive Sans|s|34567i|2856gw|150|20230804
Yesteryear|h|4|8feo|2257|20111219
Sedgwick Ave Display|h|4|2856gw|1900|20170801
Markazi Text|r|4567|2856gx|1277|20180605
Inria Sans|s|347i|8feo|475|20191205
Noto Sans Math|s|4|0|204|20201119
Baloo Thambi 2|d|45678|2d4z5s|608|20160120
Macondo|d|4|2t4w|2378|20120118
Anybody|d|123456789i|2856gw|832|20220302
Kristi|h|4|2t4w|1354|20101220
DynaPuff|d|4567|8fgg|1330|20220518
Noto Sans Oriya|s|123456789|1hdkw|2095|20201119
Overlock|d|479i|8feo|1138|20111219
Noto Sans Armenian|s|123456789|8feo|194|20201119
Pompiere|d|4|2t4w|286|20110720
Amiko|s|467|8fi8|575|20160301
Bayon|s|4|3if4|1800|20110302
Martian Mono|m|12345678|8fhc|407|20221125
Monomaniac One|s|4|8lq8|985|20201208
Fondamento|h|4i|8feo|1033|20111116
Lekton|m|47i|8feo|1027|20101220
Yusei Magic|s|4|8lq8|1845|20201214
Mountains of Christmas|d|47|2t4w|1093|20101214
Zalando Sans SemiExpanded|s|23456789i|2856gw|297|20250911
Encode Sans Expanded|s|123456789|2856gw|2184|20170208
Oxygen Mono|m|4|8feo|1055|20120908
Tilt Neon|d|4|2856gw|321|20221201
Delicious Handrawn|h|4|8feo|267|20230105
Montagu Slab|r|1234567|2856gw|1892|20210920
Goudy Bookletter 1911|r|4|2t4w|1969|20110209
Flow Circular|d|4|2856jk|2006|20211021
Corinthia|h|47|2856gw|564|20210826
Metamorphous|d|4|8feo|898|20111207
Chiron GoRound TC|s|23456789|2856k0|873|20250620
Birthstone|h|4|2856gw|649|20210806
Anton SC|s|4|2856gw|762|20240625
Love Ya Like A Sister|d|4|8feo|1060|20110706
Nanum Brush Script|h|4|47pc|2292|20180205
Ledger|r|4|8ffk|131|20120222
Inknut Antiqua|r|3456789|8fi8|232|20150520
Voltaire|s|4|2856gw|1023|20110817
Monsieur La Doulaise|h|4|8feo|919|20111130
Kodchasan|s|234567i|2s4d8g|172|20180910
Nova Mono|m|4|8fls|827|20110323
Aref Ruqaa|r|47|8fep|540|20160620
Bubblegum Sans|d|4|8feo|1869|20111123
Meddon|h|4|8feo|698|20110202
Hedvig Letters Serif|r|4|8feo|2065|20231120
Zen Dots|d|4|8feo|432|20210311
Faster One|d|4|8feo|2083|20121026
Ruslan Display|d|4|8ffk|782|20110518
Waiting for the Sunrise|h|4|8feo|1676|20110414
Meow Script|h|4|2856gw|478|20211102
Grenze Gotisch|d|123456789|2856gw|2372|20200517
Akatab|s|456789|8feo|943|20230621
Cambay|s|47i|8fi8|368|20150128
Spinnaker|s|4|8feo|2240|20110928
David Libre|r|457|2859mo|814|20160615
Syne Mono|m|4|8feo|724|20200825
Recursive|s|3456789|2856io|1756|20190628
Libertinus Serif|r|467i|285aao|500|20250728
ZCOOL QingKe HuangYou|s|4|2t54|1791|20181210
Kantumruy Pro|s|1234567i|94ow|1839|20220512
Bellota Text|d|347i|2856hs|1052|20200116
KoHo|s|234567i|2s4d8g|325|20180910
STIX Two Math|r|4|0|1321|20210415
Scheherazade New|r|4567|8fep|1940|20210512
Hurricane|h|4|2856gw|1053|20211007
Croissant One|d|4|8feo|2010|20121112
McLaren|d|4|8feo|303|20120813
Rubik Doodle Shadow|d|4|8in4|856|20231213
Noto Serif Thai|r|123456789|k7m68|273|20201119
Red Rose|d|34567|2856gw|891|20200702
Anek Devanagari|s|12345678|8fi8|2300|20220208
Turret Road|d|234578|8feo|1637|20190903
Baloo Bhaijaan 2|d|45678|2856gx|1693|20211029
Quintessential|h|4|8feo|1801|20121102
Short Stack|h|4|2t4w|201|20110817
Gowun Dodum|s|4|286l1c|511|20210610
Scada|s|47i|8fhc|1764|20120730
Glory|s|12345678i|2856gw|2270|20210617
Mr De Haviland|h|4|8feo|153|20111130
Rouge Script|h|4|2t4w|1423|20120111
Manjari|s|147|jny8|1718|20181121
Beth Ellen|h|4|2t4w|2153|20190509
Noto Sans Thai Looped|s|123456789|k7m68|1124|20201119
Bungee Shade|d|4|2856gw|427|20160615
Maitree|r|234567|2s4d8g|1161|20160615
Poetsen One|d|4|8feo|625|20240501
IM Fell DW Pica|r|4i|2t4w|1010|20100517
Megrim|d|4|8feo|714|20110504
Noto Serif Georgian|r|123456789|8feo|2297|20201119
Sometype Mono|m|4567i|8feo|1108|20231017
Rochester|h|4|2t4w|2039|20110803
Fanwood Text|r|4i|8feo|1999|20110831
Average|r|4|8feo|2192|20120314
Copse|r|4|2t4w|1967|20101215
Bungee Spice|d|4|2856gw|699|20211207
Asar|r|4|8fi8|601|20150617
Bungee Inline|d|4|2856gw|1850|20160615
Qwigley|h|4|2856gw|1787|20111219
Fasthand|d|4|3if4|668|20120524
Spectral SC|r|2345678i|2856jk|2218|20171010
Farro|s|3457|8feo|1945|20190716
Magra|s|47|8feo|1904|20120111
Encode Sans Semi Condensed|s|123456789|2856gw|1086|20170208
Yuji Syuku|r|4|8lr4|1626|20210926
Sansita Swashed|d|3456789|2856gw|1957|20200831
Zen Kurenaido|s|4|8ly8|1698|20210831
Platypi|r|345678i|2856gw|1350|20240410
Agbalumo|d|4|2856io|1903|20231005
Mansalva|h|4|2856o0|1614|20190829
Boldonse|d|4|8feo|1085|20250313
Fuzzy Bubbles|h|47|2856gw|362|20211102
Hanuman|r|123456789|3if4|2137|20100921
Hi Melody|h|4|47pc|23|20180223
Baloo Tamma 2|d|45678|285j40|562|20160120
Happy Monkey|d|4|8feo|1790|20120314
Fauna One|r|4|8feo|2076|20130605
Abyssinica SIL|r|4|8feo|53|20160120
Reggae One|d|4|8lr4|168|20201215
Almendra|r|47i|8feo|2075|20111219
Carrois Gothic|s|4|2t4w|1262|20120930
Asul|r|47|2t4w|968|20111219
Ephesis|h|4|2856gw|2295|20210806
Libertinus Math|d|4|0|781|20250623
Baloo Bhai 2|d|45678|28579c|1986|20160120
Whisper|h|4|2856gw|834|20220323
Mallanna|s|4|a2eio|235|20141210
Rambla|s|47i|8feo|2102|20121031
Miriam Libre|s|4567|8ikg|1247|20160620
Mukta Mahee|s|2345678|8gzk|1603|20170519
Atma|d|34567|8feq|635|20160615
Slackey|d|4|2t4w|1661|20110106
Gluten|d|123456789|2856gw|212|20210902
Libre Barcode 39 Extended Text|d|4|2t4w|163|20170821
Amarante|d|4|8feo|942|20120710
Noto Sans Symbols 2|s|4|8feo|774|20201119
Original Surfer|d|4|8feo|19|20111207
Kaisei Opti|r|457|8lr4|1937|20210521
Gotu|s|4|2856kg|755|20200109
Kadwa|r|47|2t8g|1901|20150617
Piazzolla|r|123456789i|28574w|1909|20200827
Coustard|r|49|8feo|2294|20110810
Aguafina Script|h|4|8feo|2166|20111130
SUSE|s|123456789i|2856gw|653|20240813
Just Me Again Down Here|h|4|8feo|319|20101207
Give You Glory|h|4|8feo|1820|20110713
Arima|d|1234567|2dg8ao|1195|20220524
Noto Sans Ol Chiki|s|4567|8feo|2140|20201119
Mukta Vaani|s|2345678|8g74|233|20160615
Gaegu|h|347|47pc|614|20180228
Capriola|s|4|8feo|804|20120710
Sue Ellen Francisco|h|4|2t4w|1177|20110414
Vibur|h|4|2t4w|2022|20101215
Solway|r|34578|2t4w|813|20180806
Alike|r|4|8feo|1380|20110824
Ysabeau Office|s|123456789i|2856qo|865|20230621
Jaldi|s|47|8fi8|1204|20150422
Crafty Girls|h|4|2t4w|2325|20110106
Poly|r|4i|8feo|1310|20111102
Tienne|r|479|2t4w|689|20110727
Numans|s|4|2t4w|1851|20110817
Euphoria Script|h|4|8feo|1231|20120208
Rubik Dirt|d|4|8in4|1717|20220615
Lacquer|d|4|2t4w|2144|20190703
Puritan|s|47i|2t4w|2012|20101130
Noto Sans Lao|s|123456789|8feo|469|20201119
Gurajada|s|4|a2eio|1679|20150108
Kurale|r|4|8fkw|1331|20150514
Rasa|r|34567i|28579c|1844|20160615
Zen Antique|r|4|8ly8|2235|20210831
Freeman|d|4|2856gw|779|20240501
Della Respira|r|4|2t4w|1742|20120404
Teachers|s|45678i|8fsw|1984|20240501
Padauk|s|47|uwhs|2079|20161108
Buenard|r|4567|8feo|571|20111219
Battambang|d|13479|3if4|2034|20110302
Thasadith|s|47i|2s4d8g|1653|20180910
Zain|s|234789i|2t4x|1896|20240717
Cherry Bomb One|d|4|285csg|1708|20230523
Noto Sans Warang Citi|s|4|8feo|198|20201119
Contrail One|d|4|2t4w|1782|20111026
Fontdiner Swanky|d|4|2t4w|1724|20110106
Frijole|d|4|2t4w|2230|20111219
Vast Shadow|r|4|2t4w|1127|20111012
Quando|r|4|8feo|1848|20120710
Xanh Mono|m|4i|2856gw|2071|20200810
Modern Antiqua|d|4|8feo|2092|20110713
Shippori Antique|s|4|8lq8|183|20210414
Moon Dance|h|4|2856gw|1991|20211118
Poller One|d|4|2t4w|2187|20110928
Metal Mania|d|4|8feo|1119|20120711
Inder|s|4|8feo|627|20111219
Redressed|h|4|8feo|667|20110621
Walter Turncoat|h|4|2t4w|1827|20110106
Jockey One|s|4|8feo|2143|20111026
Balthazar|r|4|2t4w|283|20111213
Sedgwick Ave|h|4|2856gw|214|20170801
Viaoda Libre|d|4|2856jk|158|20191105
Averia Sans Libre|d|347i|2t4w|816|20120314
Jomhuria|d|4|8fep|2238|20160615
Square Peg|h|4|2856gw|1918|20220323
Montez|h|4|8feo|1707|20110817
Coiny|d|4|2d4z5s|2062|20160620
Vesper Libre|r|4579|8fi8|2123|20140714
Finger Paint|d|4|2t4w|927|20120930
Cherry Cream Soda|d|4|2t4w|1341|20110106
Codystar|d|34|8feo|2024|20120314
Modak|d|4|8fi8|1125|20150218
Expletus Sans|d|4567i|8feo|1130|20110504
Bona Nova|r|47i|2859wg|488|20210413
Encode Sans Semi Expanded|s|123456789|2856gw|263|20170208
Freehand|d|4|3if4|1115|20110302
Allan|d|47|8feo|2205|20101215
UnifrakturCook|d|7|2t4w|293|20101207
Rosarivo|r|4i|8feo|897|20120329
Cutive|r|4|8feo|1025|20120229
Sarina|d|4|8feo|2194|20111219
Orelega One|d|4|8fhc|662|20210311
League Script|h|4|2t4w|1155|20110309
Cairo Play|s|23456789|8fep|2327|20220805
New Rocker|d|4|8feo|315|20121130
Grape Nuts|h|4|2856gw|2213|20220217
MonteCarlo|h|4|2856gw|2009|20210514
Supermercado One|d|4|8feo|1209|20111102
Noto Sans Ethiopic|s|123456789|8feo|344|20160415
Anta|s|4|8feo|1645|20240214
Sulphur Point|s|347|8feo|1950|20190925
Prosto One|d|4|8ffk|1865|20120229
Rationale|s|4|2t4w|47|20110803
Brawler|r|47|2t4w|2155|20110518
Prociono|r|4|2t4w|1934|20110831
Zen Antique Soft|r|4|8ly8|2251|20210831
Borel|h|4|2856gw|149|20230704
Sour Gummy|s|123456789i|8feo|313|20241105
Stick No Bills|s|2345678|2qbr4|1584|20210629
Molengo|s|4|8feo|1050|20100419
Shojumaru|d|4|8feo|1343|20120125
Oregano|d|4i|8feo|587|20120813
Nata Sans|s|123456789|2856jk|1703|20250728
Rubik Glitch|d|4|8in4|461|20220217
Alkatra|d|4567|1hdoi|241|20230127
Bigshot One|d|4|2t4w|1745|20110504
Gamja Flower|h|4|47pc|948|20180223
Mohave|s|34567i|8feo|470|20200123
Charmonman|h|47|2s4d8g|1296|20180910
Arya|s|47|8fi8|1405|20150520
Doto|s|123456789|8feo|841|20241105
Protest Revolution|d|4|2856gw|2370|20240130
Carattere|h|4|2856gw|320|20210826
Fresca|s|4|8feo|2263|20111207
Unkempt|d|47|2t4w|2163|20111205
Bagel Fat One|d|4|9tz4|883|20230605
Kranky|d|4|2t4w|1893|20110106
Bakbak One|d|4|8fi8|1295|20210909
Tiny5|s|4|8fog|296|20240529
Noto Serif HK|r|23456789|2856hw|640|20220511
Kufam|s|456789i|2856gx|1686|20200714
Uncial Antiqua|d|4|8feo|2174|20111219
Licorice|h|4|2856gw|1185|20211118
Scope One|r|4|8feo|338|20160615
Wendy One|s|4|8feo|756|20121213
Oleo Script Swash Caps|d|47|8feo|2339|20121112
Bilbo Swash Caps|h|4|8feo|1638|20111213
Sunflower|s|357|47pc|796|20180227
Elsie|d|49|8feo|2374|20121213
Gayathri|s|147|e1og|281|20190610
Ruwudu|r|4567|8fep|9|20230807
Lily Script One|d|4|8feo|634|20130605
Patrick Hand SC|h|4|2856gw|2177|20130227
The Girl Next Door|h|4|8feo|2051|20110420
Antic|s|4|2t4w|1868|20110831
Aladin|d|4|8feo|1735|20111130
Nosifer|d|4|8feo|2120|20111219
Fuggles|h|4|2856gw|2033|20210429
WindSong|h|45|2856gw|1051|20210528
Train One|d|4|8lr4|356|20201215
Port Lligat Sans|s|4|2t4w|995|20120118
Kablammo|d|4|2856jk|531|20230606
Bitcount Single|d|123456789|8feo|64|20250109
Trade Winds|d|4|2t4w|1866|20111219
Tenali Ramakrishna|s|4|a2eio|1941|20141210
Darumadrop One|d|4|8lq8|1853|20201213
Protest Strike|d|4|2856gw|938|20240130
Luxurious Script|h|4|2856gw|175|20211102
Spicy Rice|d|4|8feo|557|20111213
Sarpanch|s|456789|8fi8|1980|20140903
Jersey 10|d|4|8feo|2340|20240410
Dynalight|d|4|8feo|1264|20111219
Duru Sans|s|4|8feo|252|20111219
Road Rage|d|4|2856gw|2043|20211021
Vollkorn SC|r|4679|2856jk|2310|20170908
Reddit Mono|m|23456789|2856gw|305|20240320
Kalnia|r|1234567|8feo|2180|20231205
Cambo|r|4|8feo|1658|20111219
Alan Sans|s|3456789|8fep|446|20250917
Salsa|d|4|2t4w|940|20111012
Sunshiney|h|4|2t4w|1759|20110106
Imprima|s|4|8feo|922|20120314
Mirza|r|4567|8fep|1099|20160615
Shanti|s|4|8feo|2084|20110511
Bubbler One|s|4|8feo|192|20120509
TASA Orbiter|s|45678|8feo|421|20250825
Anaheim|s|45678|2856gw|2067|20121031
Mako|s|4|8feo|2204|20110511
Kaisei Tokumin|r|4578|8lr4|311|20210521
Galindo|d|4|8feo|831|20120813
Edu TAS Beginner|h|4567|2t4w|887|20220609
Madimi One|s|4|8feo|2025|20240226
Holtwood One SC|r|4|8feo|1821|20110504
Alike Angular|r|4|8feo|1249|20110928
IM Fell Double Pica|r|4i|2t4w|2053|20100517
Phudu|d|3456789|2856io|139|20230130
Karantina|d|347|8ikg|789|20210311
Wire One|s|4|2t4w|1811|20110518
Federo|s|4|2t4w|1928|20110727
Comme|s|123456789|8feo|1128|20230328
Suranna|r|4|a2eio|2020|20150112
Artifika|r|4|2t4w|2036|20110601
Iceberg|d|4|2t4w|1761|20120125
Libertinus Sans|s|47i|28574w|34|20250728
Lovers Quarrel|h|4|2856gw|118|20120329
Edu SA Beginner|h|4567|2t4w|980|20220609
Bellota|d|347i|2856hs|982|20200116
Baloo Chettan 2|d|45678|28gf0g|2280|20160120
Moul|d|4|3if4|1617|20110302
Protest Riot|d|4|2856gw|307|20240130
Birthstone Bounce|h|45|2856gw|2262|20210902
IBM Plex Sans Thai Looped|s|1234567|k7m80|758|20210618
Anek Malayalam|s|12345678|jny8|1269|20220215
Meie Script|h|4|8feo|1784|20120821
Gulzar|r|4|8fep|28|20220513
Baumans|d|4|2t4w|2001|20111207
The Nautigal|h|47|2856gw|403|20211118
BhuTuka Expanded One|r|4|8gzk|2048|20220121
Gasoek One|s|4|9tz4|2168|20230517
Imbue|r|123456789|2856gw|2130|20201202
Bonheur Royale|h|4|2856gw|1636|20210806
Asta Sans|s|345678|47pc|1224|20250528
IM Fell Great Primer|r|4i|2t4w|1589|20100517
Eagle Lake|h|4|8feo|1294|20120711
Swanky and Moo Moo|h|4|8feo|1721|20110427
IM Fell French Canon|r|4i|2t4w|1949|20100517
Zhi Mang Xing|h|4|2t54|1884|20190317
Monofett|m|4|8feo|1905|20110504
Poltawski Nowy|r|4567i|2856gw|503|20230419
Galada|d|4|2t4y|889|20160620
Goblin One|d|4|2t4w|2113|20110629
Mochiy Pop P One|s|4|2zgg|1601|20210414
Sancreek|d|4|8feo|929|20111012
Nova Round|d|4|8feo|1595|20110323
Gupter|r|457|2t4w|160|20191113
Aoboshi One|r|4|8lq8|1288|20230523
Ranchers|d|4|8feo|298|20120907
Voces|s|4|8feo|2379|20120222
Momo Trust Display|s|4|2856gw|48|20251028
Maiden Orange|r|4|8feo|1205|20101220
Amethysta|r|4|2t4w|949|20120118
Englebert|s|4|8feo|93|20121102
Nova Flat|d|4|8feo|1132|20110323
Ysabeau SC|s|123456789|2856qo|1712|20230621
Clicker Script|h|4|8feo|1087|20121111
Mooli|s|4|8feo|159|20230912
NTR|s|4|a2eio|1137|20141210
Song Myung|r|4|47pc|1990|20180223
Manuale|r|345678i|2856gw|561|20170731
Noto Serif Khojki|r|4567|8feo|2388|20220829
Ribeye|d|4|8feo|502|20111123
Orienta|s|4|8feo|171|20120907
Loved by the King|h|4|8feo|2087|20110706
Anek Tamil|s|12345678|5883k|1173|20220208
Iceland|d|4|2t4w|766|20111123
Nokora|s|123456789|3if4|1608|20111109
Baloo Paaji 2|d|45678|28581s|2162|20160120
Sumana|r|47|8fi8|2126|20150429
Homenaje|s|4|2t4w|1983|20120118
Waterfall|h|4|2856gw|402|20211118
Crushed|d|4|8feo|1781|20110106
Julee|h|4|8feo|2173|20110907
Life Savers|d|478|8feo|2246|20120813
Gentium Book Plus|r|47i|28574w|978|20220518
Peralta|r|4|8feo|323|20120711
Smooch|h|4|2856gw|1776|20211102
Timmana|s|4|a2eio|288|20150112
M PLUS 1 Code|m|1234567|285csg|2002|20210921
Grenze|r|123456789i|2856gw|1054|20180918
Long Cang|h|4|2t54|1615|20190317
Kavoon|d|4|8feo|683|20130123
IBM Plex Sans Devanagari|s|1234567|8fk0|788|20210618
Montaga|r|4|2t4w|1663|20120118
Henny Penny|d|4|2t4w|670|20120222
Lavishly Yours|h|4|2856gw|658|20220311
Sail|d|4|8feo|1930|20111219
Nova Slim|d|4|8feo|1818|20110323
Sansation|s|347i|8fmo|2077|20250417
Dangrek|d|4|3if4|257|20110302
Stack Sans Text|s|234567|8feo|458|20251103
Gugi|d|4|47pc|234|20180223
Esteban|r|4|8feo|2146|20120111
Stick|s|4|8lr4|527|20201215
Kode Mono|m|4567|8feo|824|20240214
Lemon|d|4|8feo|2103|20111130
Convergence|s|4|8feo|2367|20111109
Moderustic|s|345678|8fog|749|20240806
Faculty Glyphic|s|4|8feo|1682|20241105
Bokor|d|4|3if4|2314|20110302
BIZ UDMincho|r|47|8m5c|578|20220316
Pliant|s|123456789i|8g2o|123|20260605
Playwrite US Trad|h|1234|0|136|20240529
Gorditas|d|47|2t4w|523|20120314
Mina|s|47|8feq|1873|20180228
Yomogi|h|4|285ctc|1258|20210414
Headland One|r|4|8feo|512|20120509
Imperial Script|h|4|2856gw|745|20211118
Rubik Bubbles|d|4|8in4|2212|20220217
Chicle|d|4|8feo|900|20111130
Rubik Spray Paint|d|4|8in4|2299|20221124
Baloo Tammudu 2|d|45678|2i4ruo|2072|20160120
Vampiro One|d|4|8feo|2373|20121126
Denk One|s|4|2856io|2008|20121213
Libre Barcode 128 Text|d|4|2t4w|1142|20170731
Hubot Sans|s|23456789i|2856gw|1210|20241104
Qahiri|s|4|2t4x|69|20210403
Bodoni Moda SC|r|456789i|8feo|2268|20240625
IM Fell DW Pica SC|r|4|2t4w|1921|20100517
Atomic Age|d|4|8feo|369|20111026
Varta|s|34567|2856gw|1000|20200611
Kavivanar|h|4|5883k|225|20160620
Asset|d|4|8fgg|2119|20110629
Belgrano|r|4|2t4w|1958|20111219
Atkinson Hyperlegible Mono|s|2345678i|8feo|383|20241119
Baskervville SC|r|4567|8feo|1570|20240625
Odibee Sans|d|4|2t4w|2277|20191108
Amiri Quran|r|4|2t4x|1077|20220810
Smythe|d|4|2t4w|1796|20110420
Badeen Display|d|4|8fep|812|20241209
Carme|s|4|2t4w|1280|20110727
Kdam Thmor Pro|s|4|94ow|2318|20220511
Overlock SC|d|4|8feo|921|20111219
Delius Swash Caps|h|4|2t4w|2121|20110803
Noto Sans Old North Arabian|s|4|8feo|7|20201119
Victor Mono|m|1234567i|2856qo|1628|20230620
Honk|d|4|2856gw|2394|20240123
Cactus Classical Serif|r|4|2856i8|129|20240514
Medula One|d|4|2t4w|1935|20111219
Noto Sans Syriac Western|s|123456789|8feo|2|20251028
Noto Sans Cypriot|s|4|8feo|5|20201119
Trispace|s|12345678|2856gw|44|20200925
Tiro Devanagari Sanskrit|r|4i|8fi8|1255|20220525
Momo Trust Sans|s|2345678|2856gw|209|20251028
Cascadia Code|s|234567i|2859wh|377|20250417
Gemunu Libre|s|2345678|2qbr4|1956|20170529
Jaro|s|4|2856gw|1678|20240314
Stalemate|h|4|8feo|416|20121103
Khmer|s|4|pa8|1882|20110302
Marhey|d|34567|8fep|376|20221006
Baloo Bhaina 2|d|45678|29e4n4|1933|20160120
Truculenta|s|123456789|2856gw|1819|20201216
Harmattan|s|4567|8fep|918|20200702
Anek Kannada|s|12345678|8s1s|373|20220215
Elms Sans|s|123456789i|2856gw|1939|20251103
Ysabeau|s|123456789i|2856qo|348|20230419
Kapakana|h|34|8lq8|103|20250520
Nova Oval|d|4|8feo|1946|20110323
Gafata|s|4|8feo|989|20121031
Sigmar|d|4|2856gw|981|20230223
Mozilla Headline|s|234567|8feo|2261|20250728
Noto Sans Bhaiksuki|s|4|8feo|2365|20201119
LXGW WenKai TC|h|347|28575c|606|20240523
Macondo Swash Caps|d|4|2t4w|1143|20120118
Stack Sans Headline|s|234567|8feo|1822|20251103
Emilys Candy|d|4|8feo|987|20120229
Ceviche One|d|4|8feo|2049|20111207
Jolly Lodger|d|4|8feo|1392|20120314
Chau Philomene One|s|4i|8feo|1755|20120404
Alkalami|r|4|8fep|111|20220609
Cagliostro|s|4|2t4w|347|20111130
Fenix|r|4|8feo|1136|20120924
IM Fell French Canon SC|r|4|2t4w|1881|20100517
IM Fell Double Pica SC|r|4|2t4w|2167|20100517
Cherry Swash|d|47|8feo|1971|20121024
Noto Serif Kannada|r|123456789|8s1s|2258|20201119
Jomolhari|r|4|1416o0|425|20190910
Liu Jian Mao Cao|h|4|2t54|727|20190317
Hedvig Letters Sans|s|4|8feo|330|20231120
Sree Krushnadevaraya|r|4|a2eio|487|20150112
Beau Rivage|h|4|2856gw|1911|20220216
Wittgenstein|r|456789i|8feo|256|20240604
Pavanam|s|4|5883k|821|20160615
Dorsa|s|4|2t4w|1031|20110831
Akronim|d|4|8feo|1989|20120923
Miniver|d|4|2t4w|1842|20111219
East Sea Dokdo|h|4|47pc|1634|20180312
Solitreo|h|4|8ikg|844|20221214
Miltonian|d|4|2t4w|2186|20110406
Kenia|d|4|2t4w|1919|20101215
Noto Music|s|4|8feo|1256|20201119
Freckle Face|d|4|8feo|2344|20121126
Ballet|h|4|2856gw|866|20200923
Montserrat Underline|s|123456789i|2856jk|1988|20241202
Risque|d|4|8feo|894|20121111
Genos|s|123456789i|2856gw|2360|20211007
Science Gothic|s|123456789|2856jk|2309|20251119
Raleway Dots|d|4|8feo|1753|20120907
Nova Cut|d|4|8feo|2241|20110323
Huninn|s|4|2856i8|2311|20250611
Unlock|d|4|8feo|134|20111130
IM Fell Great Primer SC|r|4|2t4w|2157|20100517
Agdasima|s|47|8feo|1922|20230402
Margarine|d|4|8feo|934|20121116
Dokdo|d|4|47pc|1612|20180223
Playwrite BE WAL Guides|h|4|0|3|20241209
Mea Culpa|h|4|2856gw|607|20211202
Mozilla Text|s|234567|8feo|2224|20250728
Anek Gujarati|s|12345678|8g74|1270|20220208
Noto Serif Malayalam|r|123456789|jny8|1812|20201119
Offside|d|4|8feo|57|20121026
Katibeh|d|4|8fep|1384|20160615
Playwrite CU Guides|h|4|0|4|20241209
Flamenco|d|34|2t4w|335|20111219
Delius Unicase|h|47|2t4w|2386|20111012
Strait|s|4|8feo|1629|20121026
Redacted|d|4|8feo|1076|20130918
Chocolate Classical Sans|s|4|2856i8|1179|20240514
Erica One|d|4|8feo|912|20120118
Habibi|r|4|8feo|2078|20111219
Akaya Kanadaka|d|4|8s1s|2190|20210114
Sevillana|d|4|8feo|2345|20120222
Stint Ultra Condensed|r|4|8feo|1336|20111207
Astloch|d|47|2t4w|1875|20110216
Londrina Outline|d|4|2t4w|2161|20120314
Miltonian Tattoo|d|4|2t4w|2132|20110406
Caesar Dressing|d|4|2t4w|2104|20111219
Lexend Mega|s|123456789|2856gw|2291|20190801
Tauri|s|4|8feo|1246|20130227
Notable|s|4|2t4w|396|20180802
Rum Raisin|s|4|8feo|191|20121102
Yuji Boku|r|4|8lr4|238|20210926
Joan|r|4|8feo|1746|20220428
National Park|s|2345678|2856gw|367|20250407
Cantora One|s|4|8feo|2249|20120730
Port Lligat Slab|r|4|2t4w|479|20120118
Ruthie|h|4|2856gw|2287|20111219
Shippori Antique B1|s|4|8lq8|211|20210414
Geom|s|3456789i|8fls|530|20251208
Mynerve|h|4|2856o0|2160|20230103
Girassol|d|4|8feo|414|20191205
Climate Crisis|d|4|8fhc|2396|20220930
Devonshire|h|4|8feo|1662|20111116
Sura|r|47|8fi8|647|20150617
Lexend Tera|s|123456789|2856gw|84|20190801
Suwannaphum|r|13479|3if4|2234|20110302
Nova Script|d|4|8feo|1961|20110323
Nerko One|h|4|8feo|2399|20201106
Akt|s|123456789|28574w|237|20260512
Spirax|d|4|2t4w|1191|20111123
Gentium Plus|r|47i|28574w|1687|20220513
Noto Serif Hebrew|r|123456789|8ikg|173|20201119
Vend Sans|s|34567i|8feo|1715|20250825
Ancizar Serif|r|3456789i|8fls|75|20250508
Stint Ultra Expanded|r|4|8feo|646|20120215
Barrio|d|4|8feo|941|20161202
Zilla Slab Highlight|r|47|8feo|1855|20170726
Playwrite VN|h|1234|0|26|20240402
Kaisei HarunoUmi|r|457|8lr4|697|20210521
Comforter|h|4|2856hs|2239|20210928
Griffy|d|4|8feo|147|20120906
BBH Bartle|s|4|2t4w|280|20251208
Handjet|d|123456789|2859wh|817|20200911
Engagement|h|4|8feo|663|20111207
Single Day|d|4|47pc|1722|20180222
Noto Serif Telugu|r|123456789|a80sg|1726|20201119
Romanesco|h|4|8feo|333|20120813
Mate SC|r|4|8feo|2037|20111102
Liter|s|4|8ffk|1995|20250108
Stylish|s|4|47pc|1765|20180227
Noto Serif Tamil|r|123456789i|5883k|2384|20201119
Story Script|s|4|2856gw|2298|20250825
Carrois Gothic SC|s|4|2t4w|1012|20120930
Keania One|d|4|8feo|132|20121031
Chilanka|h|4|jny8|1122|20160510
Cute Font|d|4|47pc|794|20180223
Zen Tokyo Zoo|d|4|8feo|1378|20210430
Rubik Scribble|d|4|8in4|2082|20231213
Akaya Telivigala|d|4|a80sg|1773|20160615
Nabla|d|4|2856io|2098|20220815
Noto Sans Samaritan|s|4|8feo|326|20201119
Edu NSW ACT Cursive|h|4567|8feo|526|20250528
Tillana|d|45678|8fi8|2225|20150603
Sekuya|d|4|8feo|2352|20251208
Passions Conflict|h|4|2856gw|2013|20211007
Tourney|d|123456789i|2856gw|1792|20210429
Bruno Ace SC|d|4|8feo|310|20121115
Junge|r|4|2t4w|274|20120118
Kotta One|r|4|8feo|2170|20120125
SN Pro|s|23456789i|2856jk|850|20260127
Noto Serif Lao|r|123456789|8feo|104|20201119
Shalimar|h|4|2856gw|492|20211014
Water Brush|h|4|2856gw|358|20220407
Mystery Quest|d|4|8feo|1620|20120229
New Amsterdam|s|4|8feo|2244|20240809
Geostar Fill|d|4|2t4w|372|20110810
Stoke|r|34|8feo|1097|20120803
Playwrite CU|h|1234|0|412|20240515
Srisakdi|d|47|2s4d8g|1964|20180910
Noto Sans Coptic|s|4|8feo|2383|20201119
Tac One|s|4|2856gw|1943|20240320
Jacques Francois|r|4|2t4w|2364|20120907
Island Moments|h|4|2856gw|1272|20211118
Rubik Wet Paint|d|4|8in4|244|20220217
Averia Gruesa Libre|d|4|8feo|1180|20120314
Sono|s|2345678|2856gw|1303|20220729
Fascinate Inline|d|4|8feo|971|20111207
Sonsie One|d|4|8feo|291|20120118
Manufacturing Consent|d|4|8feo|1690|20250623
Noto Sans Buhid|s|4|8feo|2112|20201119
Bitcount Grid Double|d|123456789|8feo|260|20250109
Braah One|s|4|28581s|2050|20230323
Fascinate|d|4|8feo|2272|20111207
Noto Sans Tagalog|s|4|8feo|1028|20201119
Dekko|h|4|8fi8|1691|20150128
Federant|d|4|2t4w|109|20111005
Lugrasimo|h|4|8feo|520|20230412
Noto Serif Ahom|r|4|8feo|195|20201119
Playwrite DE Grund|h|1234|0|1802|20240529
Poor Story|d|4|47pc|2343|20180223
Donegal One|r|4|8feo|91|20121213
Big Shoulders Stencil|d|123456789|2856gw|765|20250205
Stack Sans Notch|s|234567|8feo|97|20251103
Encode Sans SC|s|123456789|2856gw|877|20200624
Mogra|d|4|8g74|499|20160615
Bitcount Prop Single|d|123456789|8feo|248|20250109
Smokum|d|4|8feo|1328|20110803
Bruno Ace|d|4|8feo|2354|20121115
Linden Hill|r|4i|8feo|651|20111019
Bilbo|h|4|2856gw|772|20111207
Inika|r|47|8feo|1641|20120111
Content|d|47|pa8|1253|20110302
Paprika|d|4|8feo|729|20121026
Yeon Sung|d|4|47pc|983|20180223
BBH Hegarty|s|4|2t4w|31|20251208
Ramaraja|r|4|a2eio|517|20150108
Text Me One|s|4|8feo|845|20121031
Playwrite IN|h|1234|0|1355|20240529
Ysabeau Infant|s|123456789i|2856qo|1279|20230621
Milonga|d|4|8feo|708|20121130
Gwendolyn|h|47|2856gw|1692|20211102
Noto Sans Sora Sompeng|s|4567|8feo|976|20201119
Caramel|h|4|2856gw|1649|20210806
Autour One|d|4|8feo|359|20120515
Underdog|d|4|8ffk|1877|20120923
Arbutus|r|4|8feo|1972|20111207
Playwrite NO|h|1234|0|2229|20240515
Yaldevi|s|234567|2qbr4|1963|20210628
Playwrite AU NSW|h|1234|0|1906|20240515
Castoro Titling|d|4|8feo|1667|20230314
Playpen Sans Arabic|h|12345678|8fep|560|20250512
Comforter Brush|h|4|2856hs|1106|20210916
Princess Sofia|h|4|8feo|127|20120215
Seymour One|s|4|8ffk|1768|20121024
Anek Odia|s|12345678|1hdkw|1876|20220208
Butterfly Kids|h|4|8feo|99|20120215
Condiment|h|4|8feo|648|20120125
Bungee Hairline|d|4|2856gw|549|20160615
Monomakh|d|4|8fhc|1828|20250211
Rubik Moonrocks|d|4|8in4|1266|20220217
Twinkle Star|h|4|2856gw|33|20211126
Buda|d|3|2t4w|642|20101220
Noto Serif Khmer|r|123456789|94ow|115|20201119
Glass Antiqua|d|4|8feo|2209|20120222
Noto Serif Armenian|r|123456789|8feo|671|20201119
Winky Sans|s|3456789i|8feo|740|20250313
Noto Serif Tibetan|r|123456789|146sxs|2059|20201119
Jim Nightshade|h|4|8feo|1993|20120104
Festive|h|4|2856gw|622|20210423
Farsan|d|4|28579c|1069|20160620
Tiro Devanagari Marathi|r|4i|8fi8|1153|20220525
Noto Sans Tai Viet|s|4|8feo|2107|20201119
Playwrite IS|h|1234|0|437|20240515
Siemreap|s|4|pa8|1389|20110420
Simonetta|d|49i|8feo|2165|20120404
Butcherman|d|4|8feo|227|20111219
Bacasime Antique|r|4|8feo|790|20230621
Beiruti|s|23456789|2856gx|1646|20240625
Tiro Gurmukhi|r|4i|8gzk|691|20220525
Alumni Sans Pinstripe|s|4i|2856jk|1220|20220608
Noto Sans Mongolian|s|4|8feo|54|20201119
Praise|h|4|2856gw|1118|20211012
New Tegomin|r|4|8lq8|2011|20201213
Ancizar Sans|s|123456789i|8fls|113|20250508
Plaster|d|4|8feo|882|20111213
Trykker|r|4|8feo|1616|20111219
Noto Sans Thaana|s|123456789|8feo|2320|20201119
Texturina|r|123456789i|2856gw|993|20201023
Kite One|s|4|8feo|2089|20121026
Jacquard 12|d|4|8feo|2124|20240509
Estedad|s|123456789|2856gx|89|20260512
Noto Sans Canadian Aboriginal|s|123456789|8feo|2253|20201119
Luxurious Roman|d|4|2856gw|1840|20211118
Joti One|d|4|8feo|1315|20121031
Ruluko|s|4|8feo|974|20120111
Valley Sans|s|123456789i|8feo|2389|20260825
Alumni Sans Inline One|d|4i|2856gw|226|20220224
WDXL Lubrifont JP N|s|4|8lr4|872|20250611
Jacques Francois Shadow|d|4|2t4w|1157|20120907
Almendra SC|r|4|2t4w|404|20111219
Ravi Prakash|d|4|a2eio|695|20150112
Send Flowers|h|4|2856gw|696|20220311
Orbit|s|4|9tz4|285|20230605
Elsie Swash Caps|d|49|8feo|1923|20121213
Piedra|d|4|8feo|2217|20111130
Odor Mean Chey|r|4|3if4|2303|20110302
Fleur De Leah|h|4|2856gw|638|20210902
Koh Santepheap|r|13479|3if4|809|20210610
Ubuntu Sans Mono|m|4567i|8g2o|264|20240501
Marko One|r|4|2t4w|1736|20111213
Sofadi One|d|4|2t4w|1689|20120930
Oi|d|4|2d4zfl|1789|20210203
Aref Ruqaa Ink|r|47|8fep|394|20220226
Chiron Sung HK|r|23456789i|2856qs|17|20250611
Benne|r|4|8s1s|228|20160301
Jersey 20|d|4|8feo|2254|20240410
Noto Sans Linear A|s|4|8feo|1754|20201119
Trochut|d|47i|2t4w|141|20120118
Pochaevsk|d|4|2t7k|6|20241205
Jersey 15|d|4|8feo|155|20240410
Tilt Prism|d|4|2856gw|2141|20221201
SUSE Mono|s|12345678i|2856gw|240|20250917
Reem Kufi Fun|s|4567|2856gx|1669|20211101
Londrina Shadow|d|4|2t4w|739|20120314
Libre Barcode EAN13 Text|d|4|2t4w|2129|20201025
Hubballi|s|4|8s1s|229|20211216
Inspiration|h|4|2856gw|2306|20211126
Emblema One|d|4|8feo|2349|20120118
Bahiana|d|4|8feo|119|20161202
Libre Barcode 39 Extended|d|4|2t4w|40|20170821
Idiqlat|r|234|2t4w|10|20260212
Diplomata|d|4|8feo|1245|20120125
Konkhmer Sleokchher|d|4|94ow|185|20230426
Bungee Tint|d|4|2856gw|101|20240809
Epunda Sans|s|3456789i|8feo|206|20250825
Sahitya|r|47|2t8g|1705|20150617
Neonderthaw|h|4|2856gw|1116|20211118
Vibes|d|4|2t4x|501|20190423
Edu AU VIC WA NT Hand|h|4567|8feo|2030|20240710
Kedebideri|s|456789|2t4w|85|20250910
Kumar One|d|4|8g74|87|20160615
Meera Inimai|s|4|52lts|1747|20160531
Noto Sans Javanese|s|4567|8feo|1227|20201119
My Soul|h|4|2856gw|2357|20220323
LXGW WenKai Mono TC|m|347|28575c|486|20240523
Intel One Mono|m|34567i|2856gw|957|20250714
Nuosu SIL|s|4|8feo|1831|20220428
Chela One|d|4|8feo|2279|20121005
Rhodium Libre|r|4|8fi8|924|20150603
Ewert|d|4|8feo|576|20120208
Felipa|h|4|8feo|935|20120208
Playwrite AU SA|h|1234|0|491|20240515
Noto Serif Gujarati|r|123456789|8g74|2081|20201119
Reem Kufi Ink|s|4|2856gx|371|20211101
Lakki Reddy|h|4|a2eio|579|20150112
Sirin Stencil|d|4|2t4w|797|20120118
Edu VIC WA NT Beginner|h|4567|2t4w|2214|20220609
Fruktur|d|4i|2856io|986|20130116
Noto Sans Gothic|s|4|8feo|920|20201119
Syne Tactile|d|4|8feo|22|20200825
Iosevka Charon|m|3457i|28574w|98|20260310
Babylonica|h|4|2856gw|1740|20220223
Anek Gurmukhi|s|12345678|8gzk|2131|20220215
Noto Sans Lao Looped|s|123456789|8feo|431|20220905
Bungee Outline|d|4|2856gw|2014|20160615
Tulpen One|d|4|2t4w|2200|20110803
Gideon Roman|d|4|2856gw|205|20210826
Cossette Texte|s|47|8feo|107|20250825
Sixtyfour|m|4|8feo|1785|20240123
Londrina Sketch|d|4|2t4w|537|20120314
Playwrite VN Guides|h|4|0|276|20241209
Updock|h|4|2856gw|1979|20220323
Passero One|d|4|8feo|473|20110831
Chiron Hei HK|s|23456789i|28575c|1005|20250507
Foldit|d|123456789|2856gw|539|20221002
Amarna|s|1234567i|8feo|80|20251208
Noto Sans Mende Kikakui|s|4|8feo|2283|20201119
Galdeano|s|4|2t4w|1251|20111207
Cossette Titre|s|47|8feo|110|20250825
Noto Sans Nandinagari|s|4|8feo|16|20230508
Ranga|d|47|8fi8|952|20150128
Diplomata SC|d|4|8feo|1965|20120125
Dhurjati|s|4|a2eio|1362|20141210
Ojuju|s|2345678|2856gw|1064|20240226
Playwrite IE|h|1234|0|1732|20240529
Noto Sans Osmanya|s|4|8feo|2179|20201119
Playwrite US Modern|h|1234|0|135|20240529
Noto Serif Sinhala|r|123456789|2qbr4|1648|20201119
Chathura|s|13478|a2eio|1101|20160615
Edu NSW ACT Foundation|h|4567|2t4w|593|20220609
Almendra Display|d|4|8feo|2331|20121112
Miss Fajardose|h|4|8feo|1804|20111130
Metal|d|4|3if4|2393|20110302
Wellfleet|r|4|8feo|2109|20120111
Playwrite AU QLD|h|1234|0|146|20240515
Dai Banna SIL|r|34567i|8feo|2323|20230720
Purple Purse|d|4|8feo|2358|20121116
Dr Sugiyama|h|4|8feo|1982|20111130
Ribeye Marrow|d|4|8feo|435|20111123
Rubik Iso|d|4|8in4|174|20220615
Playwrite HR|h|1234|0|710|20240515
Arsenal SC|s|47i|2856jk|2207|20240625
Rubik Distressed|d|4|8in4|532|20220615
Tiro Telugu|r|4i|a80sg|306|20220525
Mr Bedfort|h|4|8feo|1056|20120111
Alumni Sans SC|s|123456789i|2856jk|2332|20250528
Micro 5|d|4|8feo|555|20240214
Tiro Kannada|r|4i|8s1s|674|20220525
Stalinist One|d|4|8ffk|2219|20120820
TASA Explorer|s|45678|8feo|693|20250825
Snippet|s|4|2t4w|857|20110720
Preahvihear|s|4|3if4|2371|20110302
Playwrite PL|h|1234|0|96|20240515
Momo Signature|s|4|2856gw|847|20251028
Noto Sans Cuneiform|s|4|8feo|12|20201119
Jacquarda Bastarda 9|d|4|8feo|633|20240124
Peddana|r|4|a2eio|1348|20141210
Gveret Levin|h|4|2wao|178|20260212
Bigelow Rules|d|4|8feo|2302|20121102
Noto Sans Anatolian Hieroglyphs|s|4|8feo|544|20201119
Labrada|r|123456789i|2856gw|792|20230118
Finlandica Text|s|123456789i|2856jk|43|20260512
Kirang Haerang|d|4|47pc|1978|20180224
Noto Rashi Hebrew|r|123456789|8iyo|1184|20201119
GFS Neohellenic|s|47i|27zksg|2064|20100921
Uchen|r|4|1416o0|2159|20191207
Miranda Sans|s|4567i|8feo|39|20260402
Gidole|s|4|2856ow|464|20250313
Flavors|d|4|8feo|1619|20111219
Noto Sans Tangsa|s|4567|8feo|784|20220911
Estonia|h|4|2856gw|731|20210826
Playwrite AT|h|1234i|0|94|20240515
Geist Pixel|d|4|8feo|337|20260629
Alumni Sans Collegiate One|s|4i|2856hs|1713|20220409
Bonbon|h|4|2t4w|2245|20111207
Iansui|h|4|8ff4|440|20250303
Alyamama|r|3456789|8flt|1914|20260218
BioRhyme Expanded|r|23478|8feo|738|20160615
Mrs Sheppards|h|4|8feo|1045|20111130
Grey Qo|h|4|2856gw|1403|20210902
Gidugu|s|4|a80sg|2114|20141210
Cause|h|123456789|8feo|454|20251208
Kolker Brush|h|4|2856gw|157|20211126
Noto Sans Glagolitic|s|4|8fgg|2330|20201119
Lunasima|s|47|285aao|2125|20230710
Noto Sans Sundanese|s|4567|8feo|140|20201119
Noto Sans Vithkuqi|s|4567|8feo|322|20221010
Shizuru|d|4|2zgg|1063|20201208
Playpen Sans Hebrew|h|12345678|8ikg|694|20250512
Molle|h|4i|8feo|1058|20120918
Sedan|r|4i|8feo|1767|20240410
WDXL Lubrifont SC|s|4|8ffs|2220|20250611
Big Shoulders Inline|d|123456789|2856gw|1702|20250205
Lancelot|d|4|8feo|2336|20111102
Noto Sans Adlam|s|4567|8feo|2058|20201119
Noto Sans Shavian|s|4|8feo|148|20201119
Love Light|h|4|2856gw|1749|20211202
Sedan SC|r|4|8feo|820|20240501
Noto Sans Saurashtra|s|4|8feo|18|20201119
Hanalei Fill|d|4|8feo|2316|20121126
Revalia|d|4|8feo|2278|20120314
Cherish|h|4|2856gw|324|20210813
Zen Loop|d|4i|8feo|117|20210310
Noto Sans NKo|s|4|8feo|700|20201119
Sixtyfour Convergence|m|4|8feo|1062|20240702
Jacquard 24|d|4|8feo|1624|20240410
Rubik Microbe|d|4|8in4|86|20220217
Playwrite GB S|h|1234i|0|2398|20240529
Grechen Fuemen|h|4|2856gw|2338|20210902
Cascadia Mono|s|234567i|2859wh|236|20250417
Rubik Gemstones|d|4|8in4|341|20221124
Langar|d|4|8gzk|220|20160615
Noto Sans Marchen|s|4|8feo|76|20201119
Noto Serif Ethiopic|r|123456789|8feo|2259|20201119
Matemasie|s|4|8feo|736|20240806
Flow Rounded|d|4|2856jk|992|20211021
Tsukimi Rounded|s|34567|8lq8|1075|20201214
Oldenburg|d|4|8feo|2342|20111219
Noto Sans Multani|s|4|8feo|186|20201119
Moulpali|s|4|3if4|518|20110302
Noto Serif Myanmar|r|123456789|mh34|2175|20201119
Noto Serif Dives Akuru|r|4|8feo|2301|20250205
Rubik Puddles|d|4|8in4|843|20220217
Diphylleia|r|4|9tz4|2321|20230605
Playwrite CA|h|1234|0|179|20240529
Rubik Burned|d|4|8in4|340|20220615
Noto Sans Takri|s|4|8feo|120|20201119
Noto Sans Pahawh Hmong|s|4|8feo|603|20201119
Noto Sans Sunuwar|s|4|8feo|156|20250626
Noto Sans Old Permic|s|4|8fgg|100|20201119
Aubrey|d|4|2t4w|1766|20110727
Rubik 80s Fade|d|4|8in4|690|20221124
Splash|h|4|2856gw|1874|20220518
Triodion|d|4|2t7k|1709|20241205
Sassy Frass|h|4|2856gw|705|20211012
Protest Guerrilla|d|4|2856gw|777|20240130
Playwrite DK Loopet|h|1234|0|1082|20240515
Menbere|s|1234567|2856gw|182|20250623
Danfo|r|4|2856gw|254|20240314
Slackside One|h|4|8lq8|2275|20201214
Geostar|d|4|2t4w|65|20110810
Narnoor|s|45678|8feo|128|20230302
Ga Maamli|d|4|2856gw|595|20240625
Playwrite RO|h|1234|0|137|20240515
Are You Serious|h|4|2856gw|2015|20210827
Noto Sans Cherokee|s|123456789|8feo|768|20201119
Playwrite AR|h|1234|0|49|20240515
Tapestry|h|4|2856gw|73|20220407
Kings|h|4|2856gw|56|20211021
Kumar One Outline|d|4|8g74|1885|20160615
Tiro Tamil|r|4i|5883k|2363|20220525
Libertinus Mono|m|4|8feo|589|20250623
Bitcount Grid Single|d|123456789|8feo|2156|20250109
Chenla|d|4|pa8|2359|20110302
Redacted Script|d|347|8feo|660|20130918
Rubik Vinyl|d|4|8in4|2154|20221124
Rubik Glitch Pop|d|4|8in4|1308|20240123
UoqMunThenKhung|r|4|2t68|1162|20250623
Rubik Marker Hatch|d|4|8in4|71|20220615
Explora|h|4|2856gw|767|20210810
Saira Stencil|d|123456789i|2856gw|30|20260402
Noto Sans Kaithi|s|4|8feo|51|20201119
Edu QLD Hand|h|4567|2856gw|13|20250528
Flow Block|d|4|2856jk|808|20211021
Blaka|d|4|8fep|2189|20220425
Lumanosimo|h|4|8feo|892|20230412
Black And White Picture|d|4|47pc|1710|20180227
Noto Serif Tangut|r|4|8feo|599|20201119
WDXL Lubrifont TC|s|4|8fg0|1215|20250520
Moo Lah Lah|d|4|2856gw|90|20211126
Workbench|m|4|2t4w|507|20240123
Rock 3D|d|4|2zgg|102|20201214
Noto Sans Hanunoo|s|4|8feo|282|20201119
Noto Sans Batak|s|4|8feo|2150|20201119
Rubik Beastly|d|4|8in4|1149|20210902
Noto Sans Balinese|s|4567|8feo|665|20201119
Edu AU VIC WA NT Dots|h|4567|8feo|1043|20240918
Noto Serif Yezidi|r|4567|8feo|70|20201119
Edu AU VIC WA NT Pre|h|4567|8feo|216|20241105
Snowburst One|d|4|8feo|1563|20121126
Tai Heritage Pro|r|47|2856gw|355|20220512
LXGW Marker Gothic|s|4|2856r4|859|20250611
Ponomar|d|4|2t7k|2369|20250226
Petemoss|h|4|2856gw|1635|20211007
Playwrite HU|h|1234|0|2035|20240515
Edu AU VIC WA NT Guides|h|4567|8feo|2410|20240918
Taprom|d|4|3if4|2208|20110302
Iosevka Charon Mono|m|3457i|28574w|867|20260310
Playwrite DK Uloopet|h|1234|0|1183|20240515
Playwrite FR Moderne|h|1234|0|181|20240515
Noto Sans Yi|s|4|8feo|243|20201119
BBH Bogle|s|4|2t4w|793|20251208
Noto Serif Oriya|r|4567|1hdkw|984|20220704
Noto Serif Balinese|r|4|8feo|826|20201119
Combo|d|4|8feo|1947|20120923
Playwrite BE VLG|h|1234|0|81|20240515
Annapurna SIL|r|47|8fi8|1036|20240214
Karla Tamil Inclined|s|47|4zsow|2326|20241028
Noto Serif Toto|r|4567|8feo|2094|20220904
Agu Display|d|4|2856gw|2178|20241209
Suravaram|r|4|a2eio|1886|20150112
Playwrite ES|h|1234|0|74|20240529
Tirra|s|456789|8feo|72|20250825
Noto Sans Cypro Minoan|s|4|8feo|2222|20230710
Asimovian|s|4|2856gw|1952|20250825
Playwrite NL|h|1234|0|563|20240515
Noto Sans Egyptian Hieroglyphs|s|4|8feo|381|20201119
Noto Sans Old Italic|s|4|8feo|839|20201119
Kalnia Glaze|d|1234567|8feo|2057|20240326
Libertinus Serif Display|d|4|28574w|1970|20250825
Caacupe One|d|4|8feo|2402|20260825
Ingrid Darling|h|4|2856gw|207|20220311
Noto Sans Old Turkic|s|4|8feo|217|20201119
M PLUS U|s|123456789|285csg|2413|20260512
Phetsarath|s|47|0|632|20241118
Rubik Broken Fax|d|4|8in4|732|20231213
Noto Sans Carian|s|4|8feo|1992|20201119
Coral Pixels|d|4|8feo|849|20250417
Parastoo|r|4567|2856gx|2215|20250521
Noto Sans Syriac|s|123456789|8feo|59|20201119
Noto Serif Vithkuqi|r|4567|8feo|2255|20221010
Lilex|m|1234567i|2856qo|1248|20251208
Noto Sans Vai|s|4|8feo|2322|20201119
Rubik Pixels|d|4|8in4|2390|20230331
Namdhinggo|r|45678|8feo|112|20240214
Noto Sans Runic|s|4|8feo|905|20201119
Alien Block|d|4|8feo|66|20260605
Noto Sans Tifinagh|s|4|8feo|309|20201119
Palette Mosaic|d|4|2zgg|2216|20210413
Noto Sans Indic Siyaq Numbers|s|4|8feo|58|20201119
Ruge Boogie|h|4|2856gw|2289|20111219
Playwrite NZ Basic|h|1234|0|2032|20260127
Montenegrin Gothic One|r|4|8feo|385|20260629
Bahianita|d|4|2856gw|2256|20190611
M PLUS Code Latin|s|1234567|2856gw|1864|20210921
Rubik Doodle Triangles|d|4|8in4|2347|20231213
Geomini|s|2345678|8feo|2181|20260708
Gajraj One|d|4|8fi8|2285|20230122
Finlandica Headline|s|123456789i|2856jk|32|20260512
Ole|h|4|2856gw|2361|20211202
Playpen Sans Deva|h|12345678|8fi8|602|20250512
Tagesschrift|d|4|8feo|2088|20250417
Bpmf Huninn|s|4|8ff4|2401|20260130
Moirai One|d|4|9tz4|795|20230605
Winky Rough|s|3456789i|8feo|1016|20250407
Linefont|d|123456789|0|1243|20230926
Scoutie Sans|s|2345678i|2856gw|2406|20260825
Asap Sharp|s|123456789i|2856gw|2408|20260825
Savate|s|23456789i|8feo|1788|20250604
Noto Serif Gurmukhi|r|123456789|8gzk|570|20201119
Hibur Mono|m|4|8feo|1719|20260708
Grandiflora One|r|4|9tz4|620|20230517
Epunda Slab|r|3456789i|8feo|2136|20250825
Noto Traditional Nushu|s|34567|8feo|2380|20201119
Playwrite ZA|h|1234|0|2199|20240529
Playwrite CA Guides|h|4|0|14|20241209
Playpen Sans Thai|h|12345678|k7m68|447|20250512
Chokokutai|d|4|285csg|798|20230523
Noto Sans Adlam Unjoined|s|4567|8feo|271|20201119
Playwrite MX Guides|h|4|0|2376|20241209
Playwrite DE SAS|h|1234|0|2183|20240529
Playwrite IT Moderna|h|1234|0|1176|20240529
Edu QLD Beginner|h|4567|2t4w|1129|20220621
Playwrite GB J|h|1234i|0|2046|20240529
Rubik Maps|d|4|8in4|1311|20231213
Noto Sans Old Hungarian|s|4|8feo|221|20201119
Jaini|d|4|8fi8|379|20240501
Noto Sans Grantha|s|4|8feo|294|20201119
Noto Sans Syriac Eastern|s|123456789|8feo|41|20230710
Puppies Play|h|4|2856gw|1428|20211012
Noto Sans Syloti Nagri|s|4|8feo|2337|20201119
Lisu Bosa|r|23456789i|8feo|471|20230720
Noto Serif Dogra|r|4|8feo|1975|20201119
Bitcount|d|123456789|8feo|443|20250109
Noto Sans Nag Mundari|s|4567|8feo|2397|20230508
Sankofa Display|s|4|2856gw|543|20240729
Sirivennela|s|4|a2eio|1049|20250825
Hind Mysuru|s|34567|8s1s|1048|20241202
Playwrite NG Modern|h|1234|0|50|20240529
Noto Sans Duployan|s|47|8feo|2118|20201119
Playwrite CZ|h|1234|0|619|20240515
Noto Sans Osage|s|4|8feo|1543|20201119
Edu SA Hand|h|4567|8feo|2250|20250528
Exile|d|4|8feo|2266|20250512
Bytesized|s|4|8feo|684|20250313
Hanalei|d|4|8feo|2385|20121126
Shafarik|d|4|8fhc|266|20250211
Noto Sans Miao|s|4|8feo|2073|20201119
Playwrite PT|h|1234|0|1197|20240515
Tuffy|s|47i|8g2o|734|20250417
Rubik Maze|d|4|8in4|2193|20220615
Noto Sans Mahajani|s|4|8feo|871|20201119
Noto Sans Avestan|s|4|8feo|1400|20201119
Noto Sans Medefaidrin|s|4567|8feo|672|20201119
Playwrite TZ|h|1234|0|999|20240529
Playwrite HR Lijeva|h|1234|0|637|20240515
Ponnala|d|4|a2eio|1966|20241118
Noto Sans Brahmi|s|4|8feo|1229|20201119
Playwrite AU TAS|h|1234|0|2267|20240515
Playwrite MX|h|1234|0|1080|20240529
Noto Sans Tai Le|s|4|8feo|126|20201119
Noto Sans Cham|s|123456789|8feo|200|20201119
Warnes|d|4|8feo|1154|20120907
Noto Serif NP Hmong|r|4567|2t4w|184|20201119
Playwrite BE WAL|h|1234|0|463|20240515
Allkin|d|4|0|719|20260218
Bpmf Zihi Kai Std|s|4|8ff4|457|20260130
Noto Sans Wancho|s|4|8feo|365|20201119
Rubik Lines|d|4|8in4|1856|20231213
Noto Sans Tamil Supplement|s|4|8feo|2414|20201119
Karla Tamil Upright|s|47|4zsow|485|20241028
Noto Serif Khitan Small Script|r|4|8feo|1916|20230710
Rubik Storm|d|4|8in4|2293|20221124
Jaini Purva|d|4|8fi8|2221|20240501
Blaka Ink|d|4|8fep|805|20220226
Yuyu Short|h|4|8feo|1218|20260629
Noto Sans Lydian|s|4|8feo|1196|20201119
Betania Patmos|h|4|8feo|2411|20260212
Noto Sans Khojki|s|4|8feo|124|20201119
Noto Sans Tai Tham|s|4567|8feo|60|20201119
Yuyu|h|4|8feo|2282|20260629
Noto Sans Elbasan|s|4|8feo|350|20201119
Datatype|m|123456789|8feo|472|20260310
Noto Sans Kharoshthi|s|4|8feo|353|20201119
Wavefont|d|123456789|0|937|20230615
Playwrite NZ|h|1234|0|1011|20240529
Playwrite DE LA|h|1234|0|2284|20240529
Noto Sans Newa|s|4|8feo|1829|20201119
Noto Serif Makasar|r|4|8feo|770|20230627
Noto Serif Ottoman Siyaq|r|4|8feo|1786|20230621
Blaka Hollow|d|4|8fep|2395|20220425
Noto Sans Bamum|s|4567|8feo|2070|20201119
Noto Sans Old Persian|s|4|8feo|2188|20201119
Noto Sans Nabataean|s|4|8feo|498|20201119
Noto Sans Lisu|s|4567|8feo|2164|20201119
Mingzat|s|4|8feo|1987|20220525
Playwrite GB J Guides|h|4i|0|38|20241209
Yuji Hentaigana Akari|h|4|8lq8|1252|20210610
Noto Sans Meroitic|s|4|8feo|242|20201119
Playwrite AU VIC|h|1234|0|401|20240515
Edu AU VIC WA NT Arrows|h|4567|8feo|706|20240811
Edu VIC WA NT Hand|h|4567|8feo|2206|20250528
Yarndings 20 Charted|d|4|2t4w|55|20240320
Playwrite SK|h|1234|0|1168|20240515
Noto Serif Todhri|r|4|8feo|2026|20250121
Noto Serif Hentaigana|r|23456789|8feo|680|20250127
Noto Sans Palmyrene|s|4|8feo|554|20201119
Playwrite ID|h|1234|0|548|20240529
BJCree|r|4567|2t4w|1235|20260326
Bitcount Grid Single Ink|d|123456789|8feo|1860|20250911
Jacquard 12 Charted|d|4|8feo|2335|20240410
Noto Sans Inscriptional Parthian|s|4|8feo|2236|20201119
Maname|r|4|2an2tc|2305|20240704
Libertinus Keyboard|d|4|8feo|1974|20250825
Noto Sans NKo Unjoined|s|4567|8feo|1178|20230926
Noto Serif Grantha|r|4|8feo|308|20201119
Noto Serif Old Uyghur|r|4|8feo|300|20230925
Padyakke Expanded One|r|4|8s1s|187|20221205
Bitcount Prop Double|d|123456789|8feo|521|20250109
Playwrite PL Guides|h|4|0|46|20241209
Kay Pho Du|r|4567|8feo|807|20231023
Noto Sans Inscriptional Pahlavi|s|4|8feo|609|20201119
Noto Sans Tagbanwa|s|4|8feo|224|20201119
Edu NSW ACT Hand Pre|h|4567|8feo|2296|20250528
Noto Sans Siddham|s|4|8feo|2405|20201119
Matangi|s|3456789|8fi8|2329|20250428
Bpmf Iansui|h|4|8ff4|703|20260130
Bitcount Prop Double Ink|d|123456789|8feo|2387|20250911
Playwrite CO Guides|h|4|0|1059|20241126
Noto Sans Deseret|s|4|8feo|2403|20201119
Noto Sans Buginese|s|4|8feo|265|20201119
Noto Sans Zanabazar Square|s|4|8feo|2248|20201119
Bitcount Grid Double Ink|d|123456789|8feo|1973|20250911
Strichpunkt Sans|s|456789|8feo|598|20260512
Bitcount Prop Single Ink|d|123456789|8feo|969|20250911
Noto Sans Mandaic|s|4|8feo|2375|20201119
Noto Sans Phoenician|s|4|8feo|275|20201119
Noto Znamenny Musical Notation|s|4|8feo|1794|20231210
Playwrite CO|h|1234|0|996|20231212
Bitcount Single Ink|d|123456789|8feo|2308|20250911
Noto Sans Kawi|s|4567|8feo|1414|20230627
Noto Sans Imperial Aramaic|s|4|8feo|2110|20201119
Noto Sans Rejang|s|4|8feo|451|20201119
Playwrite CL|h|1234|0|514|20240515
Noto Sans Mayan Numerals|s|4|8feo|643|20201119
Noto Sans Sogdian|s|4|8feo|231|20201119
Noto Sans SignWriting|s|4|8feo|811|20221030
Noto Sans Chakma|s|4|8feo|664|20201119
Noto Sans Ugaritic|s|4|8feo|245|20201119
Jacquard 24 Charted|d|4|8feo|613|20240314
Noto Sans Pau Cin Hau|s|4|8feo|682|20201119
Noto Sans Tirhuta|s|4|8feo|1104|20201119
Playwrite ES Deco|h|1234|0|202|20240529
Edu VIC WA NT Hand Pre|h|4567|8feo|676|20250528
Noto Sans Bassa Vah|s|4567|8feo|612|20201119
Noto Sans Hatran|s|4|8feo|709|20201119
Noto Sans Old South Arabian|s|4|8feo|1250|20201119
Noto Sans Mro|s|4|8feo|246|20201119
Noto Sans Sharada|s|4|8feo|559|20201119
Jersey 15 Charted|d|4|8feo|783|20240410
Playwrite US Trad Guides|h|4|0|1008|20241209
Bitcount Ink|d|123456789|8feo|1657|20250911
Playwrite PE|h|1234|0|747|20240515
Betania Patmos In|h|4|8feo|678|20260212
Noto Sans Caucasian Albanian|s|4|8feo|2407|20201119
Noto Sans Elymaic|s|4|8feo|2350|20201119
Micro 5 Charted|d|4|8feo|572|20240410
Noto Sans Hanifi Rohingya|s|4567|8feo|2158|20201119
Betania Patmos GDL|h|4|8feo|778|20260212
Playwrite NZ Guides|h|4|0|121|20241126
Betania Patmos In GDL|h|4|8feo|1263|20260212
Kanchenjunga|s|4567|2t4w|585|20250417
Noto Sans Gunjala Gondi|s|4567|8feo|384|20201119
Jersey 10 Charted|d|4|8feo|2101|20240410
Jersey 25 Charted|d|4|8feo|1006|20240501
Playwrite AU VIC Guides|h|4|0|630|20241209
Jersey 20 Charted|d|4|8feo|641|20240410
Noto Sans Linear B|s|4|8feo|1607|20201119
Noto Sans Lepcha|s|4|8feo|1816|20201119
Noto Sans Limbu|s|4|8feo|2021|20201119
Noto Sans Psalter Pahlavi|s|4|8feo|258|20201119
Noto Sans New Tai Lue|s|4567|8feo|399|20201119
Yuji Hentaigana Akebono|h|4|8lq8|270|20210610
Jacquarda Bastarda 9 Charted|d|4|8feo|360|20240410
Noto Sans Khudawadi|s|4|8feo|1622|20201119
Noto Sans Lycian|s|4|0|15|20201119
Noto Sans Ogham|s|4|8feo|713|20201119
Noto Sans Modi|s|4|8feo|352|20201119
Playwrite BR|h|1234|0|336|20240529
Playwrite DE VA|h|1234|0|189|20240529
Noto Sans Chorasmian|s|4|8feo|733|20230523
Noto Sans Soyombo|s|4|8feo|261|20201119
Playwrite IN Guides|h|4|0|334|20241209
Noto Sans Masaram Gondi|s|4|8feo|393|20201119
Noto Sans Old Sogdian|s|4|8feo|301|20201119
Playwrite DE Grund Guides|h|4|0|417|20241209
Noto Sans PhagsPa|s|4|8feo|1606|20201119
Playwrite PT Guides|h|4|0|551|20241209
Playwrite FR Trad|h|1234|0|279|20231211
Yarndings 12|d|4|2t4w|652|20240320
Noto Sans Nushu|s|4|8feo|476|20201119
Playwrite PE Guides|h|4|0|411|20241209
Playwrite BR Guides|h|4|0|2416|20241209
Playwrite NZ Basic Guides|h|4|0|730|20260127
Noto Sans Manichaean|s|4|8feo|1112|20201119
Yarndings 12 Charted|d|4|2t4w|597|20240320
Ramsina|r|4|2t4w|835|20260212
Noto Sans Kayah Li|s|4567|8feo|262|20201119
Playwrite IT Trad|h|1234|0|610|20240529
Playwrite GB S Guides|h|4i|0|833|20241209
Playwrite AR Guides|h|4|0|605|20241126
Playwrite TZ Guides|h|4|0|2055|20241209
Playwrite DK Uloopet Guides|h|4|0|2096|20241209
Yarndings 20|d|4|2t4w|2007|20240320
Playwrite DE LA Guides|h|4|0|2415|20241209
Playwrite IE Guides|h|4|0|339|20241209
Playwrite FR Moderne Guides|h|4|0|483|20241209
Playwrite DE VA Guides|h|4|0|547|20241209
Playwrite IT Moderna Guides|h|4|0|456|20241209
Playwrite AT Guides|h|4i|0|278|20241209
Playwrite ES Deco Guides|h|4|0|529|20241209
Playwrite IS Guides|h|4|0|418|20241209
Playwrite AU QLD Guides|h|4|0|314|20241209
Playwrite FR Trad Guides|h|4|0|495|20241209
Playwrite IT Trad Guides|h|4|0|494|20241209
Playwrite AU NSW Guides|h|4|0|277|20241209
Playwrite ZA Guides|h|4|0|420|20241209
Playwrite AU SA Guides|h|4|0|287|20241209
Playwrite DE SAS Guides|h|4|0|2412|20241209
Playwrite HR Lijeva Guides|h|4|0|343|20241209
Playwrite US Modern Guides|h|4|0|565|20241209
Playwrite CL Guides|h|4|0|510|20241209
Playwrite ID Guides|h|4|0|504|20241209
Playwrite NG Modern Guides|h|4|0|398|20241209
Playwrite CZ Guides|h|4|0|453|20241209
Playwrite HU Guides|h|4|0|1181|20241209
Playwrite DK Loopet Guides|h|4|0|538|20241209
Playwrite HR Guides|h|4|0|806|20241209
Playwrite ES Guides|h|4|0|868|20241209
Playwrite NL Guides|h|4|0|462|20241209
Playwrite BE VLG Guides|h|4|0|459|20241209
Playwrite AU TAS Guides|h|4|0|621|20241209
Playwrite SK Guides|h|4|0|497|20241209
Playwrite RO Guides|h|4|0|304|20241209
Playwrite NO Guides|h|4|0|436|20241209
`;
