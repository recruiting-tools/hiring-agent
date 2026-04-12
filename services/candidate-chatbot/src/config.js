export const DEFAULT_VALIDATOR_CONFIG = {
  minConfidence: 0.55,
  maxMessageLength: 4000
};

export const DEFAULT_MODERATION_AUTO_SEND_DELAY_HOURS = 2;

export function getModerationAutoSendDelayHours() {
  const raw = process.env.MODERATION_AUTO_SEND_DELAY_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MODERATION_AUTO_SEND_DELAY_HOURS;
  }
  return parsed;
}

export function getModerationAutoSendDelayMs() {
  return getModerationAutoSendDelayHours() * 60 * 60 * 1000;
}
