/*
 * ANT vocabulary help content.
 *
 * Source note:
 * - Source artefact: /Users/jamesking/CascadeProjects/ANT Vocabulary.html
 * - Source extraction: bundled "data" array from the HTML template, 54 terms.
 * - Verdict: CHANGE.
 * - vNext simplification: keep the human vocabulary, but update terms to match
 *   current product rules from the terminal delivery thread. In particular,
 *   helper pairings are status/feed attachments and do not author room messages.
 */

export type AntVocabularyGroup =
  | 'people'
  | 'rooms'
  | 'agents'
  | 'platforms'
  | 'identity'
  | 'sessions'
  | 'workflow'
  | 'focus'
  | 'review'
  | 'integrations';

export type AntVocabularyEntry = {
  id: string;
  term: string;
  group: AntVocabularyGroup;
  plain: string;
  aliases?: string[];
  examples?: string[];
  seeAlso?: string[];
  status?: 'current' | 'being-refined';
};

export const ANT_VOCABULARY_SOURCE =
  'Adapted from ANT Vocabulary.html and updated against current ANT delivery decisions.';

export const ANT_VOCABULARY_GROUPS: Array<{
  id: AntVocabularyGroup;
  label: string;
  summary: string;
}> = [
  { id: 'people', label: 'People', summary: 'Humans, ownership, and room participation.' },
  { id: 'rooms', label: 'Rooms', summary: 'Shared spaces, linked spaces, and room posture.' },
  { id: 'agents', label: 'Agents', summary: 'ANTs, helpers, fleets, colonies, and terminal metadata.' },
  { id: 'platforms', label: 'Platforms', summary: 'The server, native apps, terminal views, and CLI.' },
  { id: 'identity', label: 'Identity', summary: 'Handles, room aliases, invites, and pairing codes.' },
  { id: 'sessions', label: 'Sessions', summary: 'Runs, archives, memory, retained streams, and folders.' },
  { id: 'workflow', label: 'Workflow', summary: 'Tasks, plans, votes, quick commands, and trackers.' },
  { id: 'focus', label: 'Focus', summary: 'Low-interruption work, open asks, responders, and reactions.' },
  { id: 'review', label: 'Review', summary: 'Artefacts, interviews, verification, and approval loops.' },
  { id: 'integrations', label: 'Integrations', summary: 'APIs and tool protocols that connect ANT to other systems.' }
];

export const ANT_VOCABULARY_ENTRIES: AntVocabularyEntry[] = [
  {
    id: 'user',
    group: 'people',
    term: 'User',
    plain: 'A human member of ANT. A user can own desks, rooms, handles, helpers, terminals, and saved preferences.',
    examples: ['James is a user; @JWPK is his operator handle.']
  },
  {
    id: 'org',
    group: 'people',
    term: 'Org',
    plain: 'A workspace boundary for users, fleets, rooms, and shared policy. It decides who belongs together.'
  },
  {
    id: 'owner',
    group: 'people',
    term: 'Owner',
    plain: 'The human responsible for a desk, handle, room, terminal, invite, or helper pairing. Some things can have co-owners, but ownership must stay visible.'
  },
  {
    id: 'user-status',
    group: 'people',
    term: 'User status',
    plain: 'A visible availability signal such as active, away, focused, or needs response. It helps the room decide whether to interrupt.'
  },
  {
    id: 'participant',
    group: 'people',
    term: 'ParticipANT',
    plain: 'Anyone taking part in a room: a human, an ANT agent, a helper, or a remote participant.',
    aliases: ['participant']
  },
  {
    id: 'desk',
    group: 'rooms',
    term: 'Desk',
    plain: 'A named working surface owned by someone. A desk can be a terminal, remote ANT, helper, invite, or other work surface, and normally carries its own ANThandle.',
    examples: ['Away from Desk means the owner stepped away from that work surface.']
  },
  {
    id: 'chatroom',
    group: 'rooms',
    term: 'chatroom',
    plain: 'A shared room where people and ANTs coordinate through messages, tasks, artefacts, and live work.',
    aliases: ['room']
  },
  {
    id: 'linked-chat',
    group: 'rooms',
    term: 'linkedChat',
    plain: 'A chatroom linked to one desk or ANThandle. It keeps terminal-specific discussion close to the terminal instead of mixing it into every room list.',
    aliases: ['linked chat']
  },
  {
    id: 'linked-rooms',
    group: 'rooms',
    term: 'Linked Rooms',
    plain: 'Two or more rooms wired together so context, updates, or participants can move between them without pretending they are the same room.'
  },
  {
    id: 'room-mode',
    group: 'rooms',
    term: 'Room mode',
    plain: 'The routing posture of a room: brainstorm for open coordination, heads-down for lower interruption, or closed for locked-down read/write behavior.',
    seeAlso: ['Focus mode', 'Responder']
  },
  {
    id: 'ant-stage',
    group: 'rooms',
    term: 'ANT Stage',
    plain: 'The live presentation and review surface for artefacts such as decks. Stage is where work is shown, reviewed, and controlled in context.',
    examples: ['Stage means the real deck or artefact surface, not a static screenshot.']
  },
  {
    id: 'antchat',
    group: 'rooms',
    term: 'antchat',
    plain: 'The room/chat surface for speaking with humans and ANTs. It includes delivery, replies, inline replies, read state, and room membership.'
  },
  {
    id: 'remoteant',
    group: 'agents',
    term: 'remoteant',
    plain: 'An ANT running on another machine or server instead of the local device, still visible through the same room and terminal identity model.'
  },
  {
    id: 'anthelper',
    group: 'agents',
    term: 'antHelper',
    plain: 'A lightweight companion attachment that links a device or app into ANT. It can read the feed, receive routes, and post status when scoped; it does not author room messages as a handle.',
    aliases: ['ANT helper', 'helper attachment'],
    seeAlso: ['antHelper Pairing Code']
  },
  {
    id: 'ant-server',
    group: 'agents',
    term: 'ANT Server',
    plain: 'The OSS home server that stores rooms, terminals, handles, leases, archives, invites, and APIs. antOS is the premium native face on top of it.',
    aliases: ['home server', 'OSS server']
  },
  {
    id: 'fleet',
    group: 'agents',
    term: 'Fleet',
    plain: 'The whole population of ANTs and helper surfaces across users, machines, and remotes.'
  },
  {
    id: 'colony',
    group: 'agents',
    term: 'Colony',
    plain: 'The subset of the fleet that belongs to one user or workspace.'
  },
  {
    id: 'terminals',
    group: 'agents',
    term: 'Terminals',
    plain: 'The shell or CLI work surfaces ANTs operate in. ANT can show live terminals, archived terminals, unconnected tmux panes, and adopted local sessions.'
  },
  {
    id: 'terminal-persistence',
    group: 'agents',
    term: 'Terminal Persistence',
    plain: 'Keeping a terminal session alive across app restarts, disconnects, and view changes so work can resume without losing the running process.'
  },
  {
    id: 'account-type',
    group: 'agents',
    term: 'Account type',
    plain: 'The account or billing source attached to a terminal, such as a subscription, API key, local model, team account, or raw PTY.'
  },
  {
    id: 'family-type',
    group: 'agents',
    term: 'Family type',
    plain: 'The model family behind a terminal, such as Claude, Codex, Qwen, Ollama-cloud, Antigravity, or local models.'
  },
  {
    id: 'cli-type',
    group: 'agents',
    term: 'CLI type',
    plain: 'The actual command-line tool running in the terminal, such as Claude Code, Codex CLI, Qwen Code, Pi, Copilot CLI, Antigravity, or a local model CLI.'
  },
  {
    id: 'usage-daemon',
    group: 'agents',
    term: 'Usage daemon',
    plain: 'A local service that reports allowance, spend, token, and provider usage for terminal CLIs so ANT can show what is being consumed.',
    aliases: ['OpenUsage']
  },
  {
    id: 'allowance',
    group: 'agents',
    term: 'Allowance',
    plain: 'The remaining provider budget or quota for a CLI family or account. It should be visible before a terminal burns expensive context or usage.'
  },
  {
    id: 'antos',
    group: 'platforms',
    term: 'antOS',
    plain: 'The native premium ANT app. It is the polished face for the OSS ANT Server, and should leave the OSS server useful even without premium features.'
  },
  {
    id: 'ant-ios',
    group: 'platforms',
    term: 'antOS iOS app',
    plain: 'The iOS version of the native ANT app.',
    aliases: ['antiOS', 'iOS app']
  },
  {
    id: 'ant-android',
    group: 'platforms',
    term: 'antDroid',
    plain: 'The Android version of the native ANT app.',
    aliases: ['antdriod', 'Android app']
  },
  {
    id: 'ant-view',
    group: 'platforms',
    term: 'ANT View',
    plain: 'The readable terminal history view. It turns retained PTY streams into searchable blocks with timestamps, filters, classifications, and expansion controls.',
    seeAlso: ['Raw view', 'Chat view']
  },
  {
    id: 'raw-view',
    group: 'platforms',
    term: 'Raw view',
    plain: 'The direct terminal surface. It is closest to the live PTY and should stay faithful even when ANT View renders the same stream as cleaner blocks.'
  },
  {
    id: 'chat-view',
    group: 'platforms',
    term: 'Chat view',
    plain: 'The terminal-linked conversational surface. It comes after the terminal inventory and ANT View work because it depends on the same identity and stream truth.'
  },
  {
    id: 'ant-cli',
    group: 'platforms',
    term: 'ANT CLI',
    plain: 'The command-line interface for driving ANT from a shell: rooms, replies, terminals, invites, plans, tasks, and operational checks.'
  },
  {
    id: 'anthandle',
    group: 'identity',
    term: 'ANThandle',
    plain: 'The durable handle for a desk, terminal, agent, helper, or remote. It is the stable identity people recognize across ANT.',
    examples: ['@anterm is the ANThandle created when the local anTERM session was adopted.']
  },
  {
    id: 'room-handle',
    group: 'identity',
    term: 'roomHandle',
    plain: 'The alias or membership name an ANThandle uses inside one chatroom. A room keeps the mapping from roomHandle back to ANThandle.'
  },
  {
    id: 'remote-invite',
    group: 'identity',
    term: 'remote invite',
    plain: 'An invitation for someone or something remote to join a room or session. The terminals page should aggregate them so operators can see who is where.',
    examples: ['Owned remote invites can become helper pairings when the operator chooses that.']
  },
  {
    id: 'pairing-code',
    group: 'identity',
    term: 'antHelper Pairing Code',
    plain: 'A short, single-use code that pairs a helper or device to an owned handle. The granted scope is explicit and does not include authoring room messages.',
    aliases: ['pairing code']
  },
  {
    id: 'session',
    group: 'sessions',
    term: 'session',
    plain: 'One continuous run of work with an ANT, terminal, or room. Sessions have live state, history, and eventually archive behavior.'
  },
  {
    id: 'context-break',
    group: 'sessions',
    term: 'context break',
    plain: 'A deliberate boundary that says earlier context is stale or complete. It keeps an ANT focused on the current slice.'
  },
  {
    id: 'archived-terminal-ant-chat',
    group: 'sessions',
    term: 'Archived terminal ANT chat',
    plain: 'The retained ANT output and session record for a terminal that is no longer live. It can be searched, mined, and deleted through explicit choices.'
  },
  {
    id: 'ant-archive',
    group: 'sessions',
    term: 'ANT archive',
    plain: 'The mineable retained history of terminal output, room decisions, and session material. Deleting an archived terminal should ask whether to mine first.'
  },
  {
    id: 'mine',
    group: 'sessions',
    term: 'Mine',
    plain: 'To extract useful lessons, facts, or reusable context from retained session output before hiding or deleting the source record.',
    examples: ['Mine and delete means extract archive value first, then remove the archived terminal record.']
  },
  {
    id: 'ant-memories',
    group: 'sessions',
    term: 'ANT memories',
    plain: 'Durable knowledge an ANT can reuse across sessions, including preferences, decisions, and project context.'
  },
  {
    id: 'md-store',
    group: 'sessions',
    term: 'md store (ObsidiANT)',
    plain: 'The markdown knowledge store. It is an Obsidian-style vault that agents can read from and write to when memory work is explicit.'
  },
  {
    id: 'external-asset-folders',
    group: 'sessions',
    term: 'External asset folders',
    plain: 'Folders outside the main store that an ANT is allowed to reach, such as work projects, screenshots, assets, or docs.'
  },
  {
    id: 'adopt-into-ant',
    group: 'sessions',
    term: 'Adopt into ANT',
    plain: 'Register an existing local terminal or tmux pane as a first-class ANT terminal without killing the running session.',
    examples: ['anTERM was adopted into ANT as @anterm while preserving the live Claude session.']
  },
  {
    id: 'attach-tmux',
    group: 'sessions',
    term: 'Attach tmux',
    plain: 'Attach ANT to an existing tmux pane or session so it can be tracked, viewed, and optionally brought into the server inventory.'
  },
  {
    id: 'context-packet',
    group: 'sessions',
    term: 'Context packet',
    plain: 'A concise packet of current terminal, room, plan, and file context used to bring a CLI or helper up to speed.'
  },
  {
    id: 'ant-trigger',
    group: 'workflow',
    term: 'ANT Trigger',
    plain: 'An event or condition that starts an ANT action automatically.'
  },
  {
    id: 'ant-task',
    group: 'workflow',
    term: 'ANT Task',
    plain: 'A unit of work assigned to a participant, with ownership, status, evidence, and completion state.'
  },
  {
    id: 'ant-plan',
    group: 'workflow',
    term: 'ANT Plan',
    plain: 'A multi-step approach shared before or during execution so others can review order, dependencies, and responsibilities.'
  },
  {
    id: 'ant-vote',
    group: 'workflow',
    term: 'ANT Vote',
    plain: 'A room or cross-room decision primitive where eligible voters choose, explain, and close a decision.'
  },
  {
    id: 'ant-tracker',
    group: 'workflow',
    term: 'ANT Tracker',
    plain: 'A board or surface that tracks tasks, ownership, state, and progress across a room, plan, or fleet.'
  },
  {
    id: 'quick-commands',
    group: 'workflow',
    term: 'Quick Commands',
    plain: 'Saved commands for common actions, such as quick cd targets or terminal setup commands.'
  },
  {
    id: 'shortcuts',
    group: 'workflow',
    term: 'Shortcuts',
    plain: 'Keyboard or quick-access actions that move operators around ANT without hunting through UI.'
  },
  {
    id: 'focus-mode',
    group: 'focus',
    term: 'Focus mode',
    plain: 'A low-interruption mode that reduces incoming noise while preserving accountability and later catch-up.'
  },
  {
    id: 'open-ask',
    group: 'focus',
    term: 'Open Ask',
    plain: 'A visible question or decision that needs a human or participant to answer before work should continue.'
  },
  {
    id: 'responder',
    group: 'focus',
    term: 'Responder',
    plain: 'A room routing concept that governs who responds next, especially when a heads-down room should avoid everyone answering at once.'
  },
  {
    id: 'reactions',
    group: 'focus',
    term: 'Reactions',
    plain: 'Message responses such as acknowledgement, approval, disagreement, or request-for-attention signals.'
  },
  {
    id: 'artefacts',
    group: 'review',
    term: 'Artefacts',
    plain: 'The outputs an ANT produces: files, builds, decks, designs, docs, sheets, sites, screenshots, or other deliverables.'
  },
  {
    id: 'interviews',
    group: 'review',
    term: 'Interviews',
    plain: 'Structured question-and-answer sessions used when an ANT needs clarification before, during, or after work.'
  },
  {
    id: 'verification',
    group: 'review',
    term: 'Verification',
    plain: 'Checking that work really meets the requirement. A build, screenshot, API response, test, or live smoke can be evidence, depending on the claim.'
  },
  {
    id: 'ant-reviews',
    group: 'review',
    term: 'ANT Reviews',
    plain: 'Feedback and approval loops on artefacts, code, decisions, or plans. High-risk changes can require specialist review lanes.'
  },
  {
    id: 'ant-mcp',
    group: 'integrations',
    term: 'ANT MCP',
    plain: 'Model Context Protocol support that lets ANT expose or consume tools, resources, and workflows through MCP-compatible clients.'
  },
  {
    id: 'ant-api',
    group: 'integrations',
    term: 'ANT API',
    plain: 'The HTTP and programmatic surface for automating ANT, building apps on top of it, and connecting external systems.'
  }
];
