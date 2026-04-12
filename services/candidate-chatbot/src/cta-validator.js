const SOFT_CTA_PATTERNS = [
  /\?/,
  /если/i,
  /готов/i,
  /интересно/i,
  /хотите/i,
  /можем/i,
  /удобно/i,
  /подходит/i,
  /могу/i,
  /прислать/i,
  /@[\w_]+/ // personal contact handle (Telegram etc.) — giving a direct contact is an invitation, not a coercive command
];

const HARD_IMPERATIVE_PATTERNS = [
  /следующий шаг/i,
  /отправлю/i,
  /отправляем/i,
  /пришлю/i,
  /напишите/i,
  /запишитесь/i
];

export function hasSoftCta(text) {
  const value = String(text ?? "").trim();
  if (!value) return false;
  return SOFT_CTA_PATTERNS.some((pattern) => pattern.test(value));
}

export function hasHardImperativeWithoutSoftener(text) {
  const value = String(text ?? "").trim();
  if (!value) return false;
  return HARD_IMPERATIVE_PATTERNS.some((pattern) => pattern.test(value)) && !hasSoftCta(value);
}

export function validateSoftCta(text) {
  return {
    ok: hasSoftCta(text) && !hasHardImperativeWithoutSoftener(text),
    hasSoftCta: hasSoftCta(text),
    hasHardImperativeWithoutSoftener: hasHardImperativeWithoutSoftener(text)
  };
}
