/**
 * verificationTaxonomyStore — versioned tag definitions + lifecycle audit
 * for the verification-v2 substrate (JWPK 17-question ratification at the
 * apps coordination thread on 2026-05-28).
 *
 * **Key invariants**:
 *
 * 1. **Versioned definitions**: every edit publishes a new version row;
 *    older versions are RETAINED so historical verifications resolve
 *    against their original tag definition. Hard-delete is forbidden.
 *
 * 2. **Lifecycle states**: `proposed → active → deprecated → superseded
 *    → withdrawn`. Lifecycle transitions are audited via
 *    `tag_lifecycle_events`.
 *
 * 3. **Provenance + scope**:
 *    - `provenance='system'` + `scope_id='global'` — ANT defaults under
 *      `ant.<category>.<name>` namespace
 *    - `provenance='org'` + `scope_id='<orgId>'` — org extensions under
 *      `org.<orgId>.<dotted-name>`. Cannot override `ant.*` defaults.
 *
 * 4. **Audit-of-flagger is VITAL**: every lifecycle event (and every
 *    per-application classification override / flag-ignorable event)
 *    captures actor_handle + actor_kind + reason. Append-only.
 *
 * 5. **Relational tag families**: tags like `source.supports-claim`
 *    that take a target argument (e.g. `source.supports-claim.<claimID>`)
 *    carry `is_relational=1` + `family_root='source.supports-claim'`.
 *    Tag applications use the parameterised id; the taxonomy stores the
 *    root family once.
 *
 * 6. **Multi-protocol resolver**: each tag's `protocol_resolver_json`
 *    encodes either a single protocol class or a conditional resolver
 *    (e.g. `claim.factual` is `deterministic` if a primary source
 *    exists, else `heuristic`).
 *
 * Slice 1 of the V2-server reframe. Downstream slices add `source_sets`,
 * `tag_applications`, `verification_observations`, `verification_lenses`,
 * `lens_tag_rows`, `tagging_anchors`.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type TagLifecycleState =
  | 'proposed'
  | 'active'
  | 'deprecated'
  | 'superseded'
  | 'withdrawn';

export type TagProvenance = 'system' | 'org' | 'user';

export type TagActorKind = 'human' | 'agent' | 'system';

export type TagLifecycleEventKind =
  | 'create'
  | 'edit'
  | 'deprecate'
  | 'restore'
  | 'supersede'
  | 'classification_override'
  | 'flag_ignorable';

/**
 * The four protocol classes a tag can be verified under. `consensus-required`
 * was added per JWPK ratification — multiple independent verifiers must
 * converge for high-stakes claims.
 */
export type VerificationProtocolClass =
  | 'deterministic'
  | 'heuristic'
  | 'judgement-required'
  | 'consensus-required';

/**
 * Protocol resolver = either a single class for all instances of the tag,
 * OR a conditional resolver picking class based on context fields.
 *
 * `kind: 'static'` → always use `protocol`.
 * `kind: 'conditional'` → walk `rules` in order, picking first matching
 * `when` predicate; fall through to `default`.
 */
export type ProtocolResolver =
  | { kind: 'static'; protocol: VerificationProtocolClass }
  | {
      kind: 'conditional';
      rules: Array<{ when: string; protocol: VerificationProtocolClass }>;
      default: VerificationProtocolClass;
    };

export type TagDefinition = {
  id: string;
  version: number;
  name: string;
  description: string;
  category: string;
  provenance: TagProvenance;
  scopeId: string;
  protocolResolver: ProtocolResolver;
  lifecycleState: TagLifecycleState;
  supersededById: string | null;
  isHumanEditable: boolean;
  isRelational: boolean;
  familyRoot: string | null;
  createdBy: string;
  createdAtMs: number;
};

export type TagLifecycleEvent = {
  id: string;
  tagId: string;
  tagVersion: number | null;
  eventKind: TagLifecycleEventKind;
  actorHandle: string;
  actorKind: TagActorKind;
  reason: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  referencesEventId: string | null;
  createdAtMs: number;
};

type TaxonomyRow = {
  id: string;
  version: number;
  name: string;
  description: string;
  category: string;
  provenance: string;
  scope_id: string;
  protocol_resolver_json: string;
  lifecycle_state: string;
  superseded_by_id: string | null;
  is_human_editable: number;
  is_relational: number;
  family_root: string | null;
  created_by: string;
  created_at_ms: number;
};

type LifecycleEventRow = {
  id: string;
  tag_id: string;
  tag_version: number | null;
  event_kind: string;
  actor_handle: string;
  actor_kind: string;
  reason: string | null;
  before_json: string | null;
  after_json: string | null;
  references_event_id: string | null;
  created_at_ms: number;
};

function parseProtocolResolver(raw: string): ProtocolResolver {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.kind === 'static') {
      return { kind: 'static', protocol: parsed.protocol };
    }
    if (parsed && typeof parsed === 'object' && parsed.kind === 'conditional') {
      return {
        kind: 'conditional',
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        default: parsed.default ?? 'judgement-required'
      };
    }
  } catch {
    /* fall through */
  }
  // Safe default — caller-side never trusts a malformed resolver.
  return { kind: 'static', protocol: 'judgement-required' };
}

function rowToDefinition(row: TaxonomyRow): TagDefinition {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    category: row.category,
    provenance: row.provenance as TagProvenance,
    scopeId: row.scope_id,
    protocolResolver: parseProtocolResolver(row.protocol_resolver_json),
    lifecycleState: row.lifecycle_state as TagLifecycleState,
    supersededById: row.superseded_by_id,
    isHumanEditable: row.is_human_editable === 1,
    isRelational: row.is_relational === 1,
    familyRoot: row.family_root,
    createdBy: row.created_by,
    createdAtMs: row.created_at_ms
  };
}

function rowToEvent(row: LifecycleEventRow): TagLifecycleEvent {
  return {
    id: row.id,
    tagId: row.tag_id,
    tagVersion: row.tag_version,
    eventKind: row.event_kind as TagLifecycleEventKind,
    actorHandle: row.actor_handle,
    actorKind: row.actor_kind as TagActorKind,
    reason: row.reason,
    beforeJson: row.before_json,
    afterJson: row.after_json,
    referencesEventId: row.references_event_id,
    createdAtMs: row.created_at_ms
  };
}

export type CreateTagInput = Omit<TagDefinition, 'version' | 'createdAtMs' | 'lifecycleState' | 'supersededById'> & {
  /**
   * Optional initial lifecycle state. Defaults to 'active' for system tags
   * (seeded baseline) and 'proposed' for org/user extensions (require
   * approval to activate).
   */
  initialLifecycleState?: TagLifecycleState;
  /** Initial event reason (e.g. why this tag was added). */
  createReason?: string;
  actorKind?: TagActorKind;
};

/**
 * Create a new tag at version 1 with an accompanying `create` lifecycle
 * event. The tag's actor_handle from the input is recorded on both the
 * definition row and the audit event.
 *
 * Throws if the tag id already has a version 1 row (use `editTag` to
 * publish a new version instead).
 */
export function createTag(input: CreateTagInput): TagDefinition {
  const db = getIdentityDb();
  const now = Date.now();
  const lifecycleState =
    input.initialLifecycleState ??
    (input.provenance === 'system' ? 'active' : 'proposed');
  const existing = db
    .prepare('SELECT 1 FROM verification_taxonomy WHERE id = ? LIMIT 1')
    .get(input.id);
  if (existing) {
    throw new Error(
      `Tag ${input.id} already exists. Use editTag to publish a new version.`
    );
  }
  const def: TagDefinition = {
    ...input,
    version: 1,
    lifecycleState,
    supersededById: null,
    createdAtMs: now
  };
  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO verification_taxonomy
        (id, version, name, description, category, provenance, scope_id,
         protocol_resolver_json, lifecycle_state, superseded_by_id,
         is_human_editable, is_relational, family_root, created_by,
         created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      def.id,
      def.version,
      def.name,
      def.description,
      def.category,
      def.provenance,
      def.scopeId,
      JSON.stringify(def.protocolResolver),
      def.lifecycleState,
      def.supersededById,
      def.isHumanEditable ? 1 : 0,
      def.isRelational ? 1 : 0,
      def.familyRoot,
      def.createdBy,
      def.createdAtMs
    );
    recordLifecycleEvent({
      tagId: def.id,
      tagVersion: def.version,
      eventKind: 'create',
      actorHandle: def.createdBy,
      actorKind: input.actorKind ?? (def.provenance === 'system' ? 'system' : 'human'),
      reason: input.createReason ?? null,
      beforeJson: null,
      afterJson: JSON.stringify(def)
    });
  });
  txn();
  return def;
}

export type EditTagInput = {
  id: string;
  name?: string;
  description?: string;
  protocolResolver?: ProtocolResolver;
  isHumanEditable?: boolean;
  actorHandle: string;
  actorKind?: TagActorKind;
  reason?: string;
};

/**
 * Publish a new version of an existing tag. Older version rows are
 * RETAINED — historical verifications keep resolving against their
 * original definition. Throws if the tag does not exist or is in a
 * non-editable lifecycle state (withdrawn).
 */
export function editTag(input: EditTagInput): TagDefinition {
  const db = getIdentityDb();
  const latest = getLatestTagVersion(input.id);
  if (!latest) throw new Error(`Tag ${input.id} not found.`);
  if (latest.lifecycleState === 'withdrawn') {
    throw new Error(`Tag ${input.id} is withdrawn and cannot be edited.`);
  }
  const newDef: TagDefinition = {
    ...latest,
    version: latest.version + 1,
    name: input.name ?? latest.name,
    description: input.description ?? latest.description,
    protocolResolver: input.protocolResolver ?? latest.protocolResolver,
    isHumanEditable:
      input.isHumanEditable === undefined ? latest.isHumanEditable : input.isHumanEditable,
    lifecycleState: 'active',
    createdAtMs: Date.now(),
    createdBy: input.actorHandle
  };
  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO verification_taxonomy
        (id, version, name, description, category, provenance, scope_id,
         protocol_resolver_json, lifecycle_state, superseded_by_id,
         is_human_editable, is_relational, family_root, created_by,
         created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newDef.id,
      newDef.version,
      newDef.name,
      newDef.description,
      newDef.category,
      newDef.provenance,
      newDef.scopeId,
      JSON.stringify(newDef.protocolResolver),
      newDef.lifecycleState,
      newDef.supersededById,
      newDef.isHumanEditable ? 1 : 0,
      newDef.isRelational ? 1 : 0,
      newDef.familyRoot,
      newDef.createdBy,
      newDef.createdAtMs
    );
    recordLifecycleEvent({
      tagId: input.id,
      tagVersion: newDef.version,
      eventKind: 'edit',
      actorHandle: input.actorHandle,
      actorKind: input.actorKind ?? 'human',
      reason: input.reason ?? null,
      beforeJson: JSON.stringify(latest),
      afterJson: JSON.stringify(newDef)
    });
  });
  txn();
  return newDef;
}

/**
 * Soft-deprecate a tag. All versions remain queryable; new applications
 * are warned/blocked at the caller layer based on the deprecated state.
 */
export function deprecateTag(input: {
  id: string;
  actorHandle: string;
  actorKind?: TagActorKind;
  reason?: string;
  replacementTagId?: string;
}): TagDefinition {
  const db = getIdentityDb();
  const latest = getLatestTagVersion(input.id);
  if (!latest) throw new Error(`Tag ${input.id} not found.`);
  if (latest.lifecycleState === 'deprecated' || latest.lifecycleState === 'withdrawn') {
    return latest;
  }
  const newState: TagLifecycleState = input.replacementTagId ? 'superseded' : 'deprecated';
  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE verification_taxonomy
         SET lifecycle_state = ?, superseded_by_id = ?
       WHERE id = ? AND version = ?`
    ).run(newState, input.replacementTagId ?? null, input.id, latest.version);
    recordLifecycleEvent({
      tagId: input.id,
      tagVersion: latest.version,
      eventKind: input.replacementTagId ? 'supersede' : 'deprecate',
      actorHandle: input.actorHandle,
      actorKind: input.actorKind ?? 'human',
      reason: input.reason ?? null,
      beforeJson: JSON.stringify({ lifecycleState: latest.lifecycleState }),
      afterJson: JSON.stringify({
        lifecycleState: newState,
        supersededById: input.replacementTagId ?? null
      })
    });
  });
  txn();
  return { ...latest, lifecycleState: newState, supersededById: input.replacementTagId ?? null };
}

export function getTagVersion(id: string, version: number): TagDefinition | null {
  const db = getIdentityDb();
  const row = db
    .prepare('SELECT * FROM verification_taxonomy WHERE id = ? AND version = ?')
    .get(id, version) as TaxonomyRow | undefined;
  return row ? rowToDefinition(row) : null;
}

export function getLatestTagVersion(id: string): TagDefinition | null {
  const db = getIdentityDb();
  const row = db
    .prepare(
      'SELECT * FROM verification_taxonomy WHERE id = ? ORDER BY version DESC LIMIT 1'
    )
    .get(id) as TaxonomyRow | undefined;
  return row ? rowToDefinition(row) : null;
}

export type ListTaxonomyOptions = {
  category?: string;
  provenance?: TagProvenance;
  scopeId?: string;
  lifecycleStates?: TagLifecycleState[];
  latestVersionOnly?: boolean;
};

/**
 * List tag definitions. `latestVersionOnly: true` (default) returns one
 * row per tag id (the highest-version row); `false` returns the full
 * version history.
 */
export function listTaxonomy(options: ListTaxonomyOptions = {}): TagDefinition[] {
  const db = getIdentityDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (options.category) {
    conditions.push('category = ?');
    params.push(options.category);
  }
  if (options.provenance) {
    conditions.push('provenance = ?');
    params.push(options.provenance);
  }
  if (options.scopeId) {
    conditions.push('scope_id = ?');
    params.push(options.scopeId);
  }
  if (options.lifecycleStates && options.lifecycleStates.length > 0) {
    const placeholders = options.lifecycleStates.map(() => '?').join(', ');
    conditions.push(`lifecycle_state IN (${placeholders})`);
    params.push(...options.lifecycleStates);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const latestOnly = options.latestVersionOnly !== false;
  const sql = latestOnly
    ? `SELECT * FROM verification_taxonomy t1
         ${whereClause}
         AND version = (SELECT MAX(version) FROM verification_taxonomy t2 WHERE t2.id = t1.id)`.replace(
        `${whereClause}\n         AND`,
        whereClause.length > 0 ? `${whereClause} AND` : 'WHERE'
      )
    : `SELECT * FROM verification_taxonomy ${whereClause} ORDER BY id, version`;
  const rows = db.prepare(sql).all(...params) as TaxonomyRow[];
  return rows.map(rowToDefinition);
}

export function recordLifecycleEvent(input: {
  tagId: string;
  tagVersion: number | null;
  eventKind: TagLifecycleEventKind;
  actorHandle: string;
  actorKind: TagActorKind;
  reason: string | null;
  beforeJson?: string | null;
  afterJson?: string | null;
  referencesEventId?: string | null;
}): TagLifecycleEvent {
  const db = getIdentityDb();
  const event: TagLifecycleEvent = {
    id: randomUUID(),
    tagId: input.tagId,
    tagVersion: input.tagVersion,
    eventKind: input.eventKind,
    actorHandle: input.actorHandle,
    actorKind: input.actorKind,
    reason: input.reason,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    referencesEventId: input.referencesEventId ?? null,
    createdAtMs: Date.now()
  };
  db.prepare(
    `INSERT INTO tag_lifecycle_events
      (id, tag_id, tag_version, event_kind, actor_handle, actor_kind,
       reason, before_json, after_json, references_event_id, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.tagId,
    event.tagVersion,
    event.eventKind,
    event.actorHandle,
    event.actorKind,
    event.reason,
    event.beforeJson,
    event.afterJson,
    event.referencesEventId,
    event.createdAtMs
  );
  return event;
}

export function listLifecycleEventsForTag(tagId: string): TagLifecycleEvent[] {
  const db = getIdentityDb();
  // Newest-first. Tie-break by rowid (insert order) so events created
  // within the same millisecond preserve their causal order (e.g. an
  // edit followed by a deprecate in the same SQLite transaction don't
  // come back arbitrarily ordered).
  const rows = db
    .prepare(
      'SELECT * FROM tag_lifecycle_events WHERE tag_id = ? ORDER BY created_at_ms DESC, rowid DESC'
    )
    .all(tagId) as LifecycleEventRow[];
  return rows.map(rowToEvent);
}

export function resetVerificationTaxonomyStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM tag_lifecycle_events').run();
  db.prepare('DELETE FROM verification_taxonomy').run();
}
