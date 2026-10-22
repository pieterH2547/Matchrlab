/**
 * End-to-end demo zonder UI: draait de pijplijn op het voorbeeld-cv en print
 * de resultaten. Vereist een .env.local met DATABASE_URL, ANTHROPIC_API_KEY en
 * BRAVE_SEARCH_API_KEY (Adzuna optioneel).
 *
 *   npx tsx scripts/demo-run.ts [pad-naar-cv] ["vrije tekst"]
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const { parseCv } = await import("@/lib/pipeline/cv");
  const { createRun, matchesForRun } = await import("@/lib/runs");
  const { advanceRun } = await import("@/lib/pipeline/orchestrator");
  const { db, schema } = await import("@/lib/db");
  const { eq } = await import("drizzle-orm");

  const cvPath = process.argv[2] ?? path.join("test", "fixtures", "cv-procesoperator.pdf");
  const freeText = process.argv[3] ?? "Zoekt een vaste job als procesoperator rond Mechelen, geen nachtwerk.";
  const bytes = fs.readFileSync(cvPath);
  const cv = await parseCv({ name: path.basename(cvPath), bytes });
  console.log(`Cv gelezen: ${cv.text.length} tekens`);

  const run = await createRun({ author: "demo", cvText: cv.text, freeText, attachment: { name: path.basename(cvPath), size: bytes.length } });
  console.log(`Run #${run.id} gestart (thread ${run.threadId})`);

  let status: string = run.status;
  while (status !== "done" && status !== "failed") {
    status = await advanceRun(run.id, (ev) => {
      if (ev.type === "steps") {
        const running = ev.steps.find((s) => s.status === "running");
        if (running) console.log(`  ${running.label}${running.detail ? ` · ${running.detail}` : ""}`);
      }
      if (ev.type === "error") console.error("  fout:", ev.message);
    });
  }
  const final = (await db().select().from(schema.runs).where(eq(schema.runs.id, run.id)))[0];
  console.log(`\nStatus: ${final.status} · geschatte kost € ${final.costEstimateEur.toFixed(3)}`);
  console.log(final.state.intro ?? "");
  const matches = await matchesForRun(run.id);
  for (const m of matches) {
    console.log(`${String(m.score).padStart(3)}  ${m.title} — ${m.company} (${m.location}) [${m.source}]\n     ${m.reason}\n     ${m.url}`);
  }
  const fromSites = matches.filter((m) => m.source === "company_site").length;
  console.log(`\n${matches.length} vacatures, waarvan ${fromSites} rechtstreeks van een bedrijfssite.`);
  if (matches.length < 10 || fromSites < 3) {
    console.log("Doel (>= 10 vacatures, >= 3 van bedrijfssites) NIET gehaald.");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
