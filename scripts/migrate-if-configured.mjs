// Draait de Drizzle-migraties tijdens de Vercel-build, maar enkel als DATABASE_URL gezet is.
// Zo hoeft niemand lokaal met de database-URL te werken; de build zet de tabellen zelf klaar.
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL niet gezet — migraties overgeslagen.");
  process.exit(0);
}
console.log("[migrate] DATABASE_URL gevonden — migraties uitvoeren…");
execSync("npx drizzle-kit migrate", { stdio: "inherit" });
console.log("[migrate] klaar.");
