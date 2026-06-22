// util.js — tiny shared helpers.

export const pretty = (s) =>
  String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const TIME_LABELS = { short: 'Short', medium: 'Medium', long: 'Long', 'very-long': 'Very long' };

// Main-screen time-budget chips → hltb buckets (design doc §7.4).
export const TIME_CHIPS = [
  { label: '⚡ 30 min', buckets: ['short'] },
  { label: '🕐 An hour', buckets: ['medium'] },
  { label: '🌙 All-nighter', buckets: ['long', 'very-long'] },
];

export const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
};
