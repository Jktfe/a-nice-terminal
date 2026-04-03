/**
 * V2 Feature Flags — all configurable via environment variables.
 * All features default to ON. Set to "false" to disable.
 */

function isEnabled(envVar: string, defaultValue = true): boolean {
  const val = process.env[envVar];
  if (val === undefined || val === "") return defaultValue;
  return val !== "false" && val !== "0" && val !== "no";
}

export const features = {
  /** Push notifications via ntfy.sh */
  notifications: () => isEnabled("ANT_ENABLE_NOTIFICATIONS"),

  /** Probe localhost for AI models on startup */
  autoDiscover: () => isEnabled("ANT_ENABLE_AUTO_DISCOVER"),

  /** Pre-exec dangerous command warnings */
  dangerChecks: () => isEnabled("ANT_ENABLE_DANGER_CHECKS"),

  /** Auto error pattern extraction in the knowledge system */
  knowledge: () => isEnabled("ANT_ENABLE_KNOWLEDGE"),

  /** Auto preference learning from command patterns */
  preferenceLearning: () => isEnabled("ANT_ENABLE_PREFERENCE_LEARNING"),

  /** Automatic archive retention with LLM parsing before deletion */
  archiveRetention: () => isEnabled("ANT_ENABLE_ARCHIVE_RETENTION"),

  /** Beeper Desktop integration (unified messaging) */
  beeper: () => isEnabled("ANT_ENABLE_BEEPER", false), // default OFF — requires Beeper Desktop
};
