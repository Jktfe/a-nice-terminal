/**
 * firehoseMiningDryRun — the `/mine-firehose --dry-run` backbone (2026-06-10).
 * See docs/superpowers/specs/2026-06-10-firehose-mining-design.md ("Trigger &
 * cost control").
 *
 * Runs the cheap, LLM-free half of the mining pass — the high-signal SELECTOR
 * (firehoseSelector.selectHighSignalSessions) plus RECONSTRUCTION sizing
 * (sessionReconstruct.reconstructSession, used only for its byte count) — and
 * summarises:
 *   - candidates:        how many high-signal, not-yet-mined sessions would mine.
 *   - totalBytesEstimate: the summed reconstructed transcript byte size (the
 *                         rough extraction-context cost), honouring maxBytes.
 *   - bySignal:          a per-signal tally (a session counts once under EACH of
 *                         its qualifying signals) for the cost/scope breakdown.
 *
 * Pure read: it never writes the firehose, never advances the watermark, and
 * never calls an extraction agent. This is what makes `--dry-run` safe to run
 * before committing to a real (LLM-costed) mining run.
 */

import {
  selectHighSignalSessions,
  type SignalKind
} from './firehoseSelector';
import { reconstructSession } from './sessionReconstruct';

export type FirehoseMiningDryRunSummary = {
  candidates: number;
  totalBytesEstimate: number;
  bySignal: Record<string, number>;
};

/**
 * Summarise what a real mining run would touch, without any writes or LLM
 * extraction. Threshold/window opts are forwarded to the selector; maxBytes
 * caps each reconstructed transcript so the byte estimate matches the size cap
 * a real run would impose.
 */
export function firehoseMiningDryRun(opts?: {
  minEvents?: number;
  minSpanMs?: number;
  gapMs?: number;
  maxBytes?: number;
}): FirehoseMiningDryRunSummary {
  const candidates = selectHighSignalSessions({
    minEvents: opts?.minEvents,
    minSpanMs: opts?.minSpanMs,
    gapMs: opts?.gapMs
  });

  const bySignal: Record<string, number> = {};
  let totalBytesEstimate = 0;

  for (const candidate of candidates) {
    // Size-only reconstruction — the bytes are the cost estimate, the transcript
    // string itself is discarded (no extraction here).
    const { bytes } = reconstructSession(candidate.window, { maxBytes: opts?.maxBytes });
    totalBytesEstimate += bytes;

    for (const signal of candidate.signals as SignalKind[]) {
      bySignal[signal] = (bySignal[signal] ?? 0) + 1;
    }
  }

  return {
    candidates: candidates.length,
    totalBytesEstimate,
    bySignal
  };
}
