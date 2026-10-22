/**
 * Maakt test/fixtures/cv-procesoperator.pdf: een realistisch, fictief cv.
 * Draai met: npx tsx scripts/make-fixture-cv.ts
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

const out = path.join(process.cwd(), "test", "fixtures", "cv-procesoperator.pdf");
fs.mkdirSync(path.dirname(out), { recursive: true });

const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });
doc.pipe(fs.createWriteStream(out));

const h = (t: string) => doc.moveDown(0.8).font("Helvetica-Bold").fontSize(12).text(t).moveDown(0.3).font("Helvetica").fontSize(10.5);
const p = (t: string) => doc.text(t, { lineGap: 2 });
const li = (t: string) => doc.text(`•  ${t}`, { indent: 10, lineGap: 2 });

doc.font("Helvetica-Bold").fontSize(20).text("Dieter Van Hoof");
doc.font("Helvetica").fontSize(10.5).text("Procesoperator");
doc.moveDown(0.3);
p("Battelsesteenweg 142, 2800 Mechelen  ·  0478 12 34 56  ·  dieter.vanhoof@example.be");
p("Geboren 14 maart 1991  ·  Rijbewijs B, eigen wagen  ·  Nederlands (moedertaal), Engels (goed), Frans (basis)");

h("Profiel");
p(
  "Procesoperator met 9 jaar ervaring in continuprocessen in de chemie en de voedingsindustrie. Vertrouwd met DCS-sturing, batchproductie en GMP. Werkt graag in een 2-ploegenstelsel of dagregime; nachtwerk liever niet meer. Zoekt een vaste job in een productiebedrijf in de regio Mechelen, Antwerpen-Zuid of Willebroek.",
);

h("Werkervaring");
doc.font("Helvetica-Bold").text("Procesoperator  ·  Chemco Belgium nv, Willebroek  ·  2019 – heden");
li("Bediening van een continue polymerisatie-installatie via DCS (Siemens PCS 7).");
li("Opstart, stilstand en productwissels volgens SOP's; registratie in SAP PM.");
li("Eerste-lijnsonderhoud, staalname en in-procescontroles (viscositeit, pH, densiteit).");
li("Peter van drie nieuwe operatoren; mee-auteur van werkinstructies.");
doc.moveDown(0.4);
doc.font("Helvetica-Bold").text("Productieoperator  ·  Puratos, Groot-Bijgaarden  ·  2015 – 2019");
li("Batchbereiding van bakkerijgrondstoffen in een GMP/HACCP-omgeving.");
li("Bediening van mengers, pasteurs en verpakkingslijnen; CIP-reiniging.");
li("Lid van het 5S-team; stilstandsanalyse en kleine verbeterprojecten.");
doc.moveDown(0.4);
doc.font("Helvetica-Bold").text("Operator verpakking (interim)  ·  Duvel Moortgat, Puurs  ·  2014 – 2015");
li("Bottellijn en palletiseren, 3-ploegenstelsel.");

h("Opleiding");
p("Bachelor Chemie, afstudeerrichting Procestechnologie  ·  Thomas More, Geel  ·  2010 – 2013");
p("Secundair: Industriële wetenschappen (TSO)  ·  TSM Mechelen  ·  2009");

h("Attesten en opleidingen");
li("VCA Basisveiligheid (geldig tot 2027)");
li("Heftruckattest (reach- en frontheftruck)");
li("Opleiding ATEX en werken met gevaarlijke stoffen");
li("Basiskennis Lean / 5S");

h("Vaardigheden");
p("DCS/PLC-bediening (Siemens PCS 7, basis Allen-Bradley), SAP PM, batchproductie, GMP, HACCP, CIP, in-procescontroles, SOP's, ploegoverdracht, Microsoft Office.");

h("Overige");
p("Vrijwilliger bij de jeugdwerking van KV Mechelen. Beschikbaar na een opzegtermijn van 6 weken.");

doc.end();
console.log(`Fixture geschreven naar ${out}`);
