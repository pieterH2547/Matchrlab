-- Opruimen: API-keys die per vergissing in een niet-geheim veld (bv. modelnaam) belandden,
-- en keys die in opgeslagen foutmeldingen van runs staan.
DELETE FROM "settings"
WHERE "secret" = 0
  AND ("value" ~ '^(sk-|fc-|tvly-|jina_|BSA)' OR length("value") > 64);
--> statement-breakpoint
UPDATE "runs"
SET "state" = regexp_replace("state"::text, '(sk-[A-Za-z0-9_-]{20,}|fc-[A-Za-z0-9]{16,}|tvly-[A-Za-z0-9_-]{16,})', '[key verborgen]', 'g')::jsonb
WHERE "state"::text ~ '(sk-[A-Za-z0-9_-]{20,}|fc-[A-Za-z0-9]{16,}|tvly-[A-Za-z0-9_-]{16,})';
