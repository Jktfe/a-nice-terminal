# Mempalace KG Health Report — 2026-05-04

**Source:** `~/.mempalace/knowledge_graph.sqlite3` (read-only inspection)
**Mode:** read-only — no rows mutated.

---

## TL;DR (read this first)

The knowledge graph is **effectively empty**. The database file exists (36 KB on disk) but contains **1 triple and 2 entities total**, both written within the same minute on the same day (2026-05-04 20:18:40 UTC) by what appears to be a probe / smoke test (`claudeant probed_at 2026-05-04T20:30Z`).

Nothing in the data justifies sections 1-5 of the original brief — there is no top-30 predicate distribution, no orphan corpus, no stale facts, no high-velocity loops, and no invalidation candidates because there are no facts to invalidate. Section 6 (schema) is genuine and useful. The rest of this report documents the actual state and what to do next.

---

## 1. Triple count by predicate

| predicate  | count | oldest entry          | newest entry          |
|------------|-------|-----------------------|-----------------------|
| probed_at  | 1     | 2026-05-04 20:18:40   | 2026-05-04 20:18:40   |

That is the entire population. One triple, one predicate.

```
SELECT predicate, COUNT(*) AS n, MIN(extracted_at), MAX(extracted_at)
FROM triples GROUP BY predicate;
-- probed_at | 1 | 2026-05-04 20:18:40 | 2026-05-04 20:18:40
```

## 2. Orphan subjects

Nothing meaningful to sample. The KG has 2 entity rows (`claudeant`, `2026-05-04T20:30Z`) and one triple linking them. By the strict definition (entities mentioned in triples but never as a subject elsewhere), `2026-05-04T20:30Z` is technically an orphan because it only appears as the object of the single triple. That is a probe-shaped artefact, not a real orphan.

## 3. Stale facts

None. The single triple is hours old, not >90 days old. Stale-fact analysis is not applicable to a dataset that is younger than this audit window.

## 4. High-velocity predicates

None. `probed_at` has 1 entry total in the last 7 days (the lifetime of the database). The threshold (>100/7d) is not approached.

## 5. Recommended invalidations

Zero invalidations recommended. With a single probe triple, there is no cleanup to perform. The smoke-test row can stay or be cleared by the next probe; either is fine.

If anyone wants to clear it, the SQL would be:

```sql
DELETE FROM triples WHERE id = 't_claudeant_probed_at_2026-05-04t20:30z_6b8b8c0d';
DELETE FROM entities WHERE id IN ('claudeant','2026-05-04t20:30z');
-- read-only audit did NOT execute this.
```

## 6. Schema overview

Two tables, four indexes. Both tables use TEXT primary keys (slug-style ids) and `CURRENT_TIMESTAMP` defaults.

```sql
CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT DEFAULT 'unknown',
  properties  TEXT DEFAULT '{}',
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE triples (
  id            TEXT PRIMARY KEY,
  subject       TEXT NOT NULL,
  predicate     TEXT NOT NULL,
  object        TEXT NOT NULL,
  valid_from    TEXT,
  valid_to      TEXT,
  confidence    REAL DEFAULT 1.0,
  source_closet TEXT,
  source_file   TEXT,
  extracted_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subject) REFERENCES entities(id),
  FOREIGN KEY (object)  REFERENCES entities(id)
);

CREATE INDEX idx_triples_subject   ON triples(subject);
CREATE INDEX idx_triples_object    ON triples(object);
CREATE INDEX idx_triples_predicate ON triples(predicate);
CREATE INDEX idx_triples_valid     ON triples(valid_from, valid_to);
```

**Paragraph 1 (shape).** This is a classic subject/predicate/object triple store with named entities. Triples carry confidence (`REAL`, defaults to 1.0), provenance (`source_closet`, `source_file`), and bi-temporal validity (`valid_from`, `valid_to`) plus `extracted_at` for "when did we learn this fact". Indexes cover the three obvious access patterns: walk by subject, walk by object, walk by predicate, plus a temporal-window index on `(valid_from, valid_to)`. There is no full-text index on `name` or `properties`, so name-based searches will scan.

**Paragraph 2 (operational reality).** Right now the schema is the only artefact — there is essentially no graph data. The entities table holds a probe identity and a probed-at timestamp, both written by what looks like the `claudeant` smoke loop. This means either (a) ingestion has not been wired up to any real source closet, or (b) the auto-ingest pipeline stopped (consistent with the 2026-04-08 "auto-ingest stopped" note in MEMORY.md). Before any KG features are built on top of this, confirm whether `mempalace_kg_add` calls from agents are landing in this DB or in a different chroma palace; if mempalace is now a triple store on top of chroma, the missing bulk likely lives in the chroma layer, not here.

---

## Action items (read in the morning)

1. **Decide if this DB is intentional.** It might be a stub that was never the real KG. If chroma is the real palace and this SQLite is just for triples, it should still have *some* triples after weeks of activity — it does not.
2. **Re-check auto-ingest.** MEMORY.md notes auto-ingest stopped 2026-04-08. The empty DB is consistent with that. Restarting auto-ingest is the obvious next move; there is nothing to invalidate first.
3. **No rush on cleanup.** With one row, there are no stale facts, no runaway loops, and no bad data to dredge out.
