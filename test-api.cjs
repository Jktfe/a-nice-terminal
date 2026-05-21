const Database = require('better-sqlite3');
const db = new Database('/Users/jamesking/.ant/fresh-ant.db');
const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
try {
  const r1 = db.prepare("SELECT t.id, rm.handle, t.agent_status, t.agent_status_source, t.agent_status_at_ms FROM terminals t JOIN room_memberships rm ON rm.terminal_id = t.id WHERE t.agent_status IS NOT NULL").all();
  console.log('status ok:', r1.length);
  const r2 = db.prepare("SELECT author_handle, COUNT(*) as cnt FROM chat_messages WHERE strftime('%s', posted_at) > ? GROUP BY author_handle").all(Math.floor(sinceMs / 1000));
  console.log('messages ok:', r2.length);
  const r3 = db.prepare("SELECT assigned_to, status, COUNT(*) as cnt FROM tasks WHERE assigned_to IS NOT NULL GROUP BY assigned_to, status").all();
  console.log('tasks ok:', r3.length);
  const r4 = db.prepare("SELECT created_by, COUNT(*) as cnt FROM plans WHERE created_by IS NOT NULL AND deleted_at_ms IS NULL GROUP BY created_by").all();
  console.log('plans ok:', r4.length);
  const r5 = db.prepare("SELECT opened_by_handle, status, COUNT(*) as cnt FROM asks GROUP BY opened_by_handle, status").all();
  console.log('asks ok:', r5.length);
  const r6 = db.prepare("SELECT answered_by_handle, COUNT(*) as cnt FROM asks WHERE answered_by_handle IS NOT NULL GROUP BY answered_by_handle").all();
  console.log('askAnswered ok:', r6.length);
  const r7 = db.prepare("SELECT terminal_id, COUNT(*) as cnt FROM terminal_run_events WHERE ts_ms > ? GROUP BY terminal_id").all(sinceMs);
  console.log('runEvents ok:', r7.length);
  console.log('ALL PASS');
} catch (e) {
  console.error('FAIL:', e.message);
}
