/**
 * A project's key is the first letter of its name plus two random characters, unique within the
 * org, e.g. `WK7` for "Website". With a task's number it forms a readable task key, `WK7-42`.
 */
// No I, L, O, U, 0 or 1: they are the characters people misread or mistype when reading a key out.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
// Three characters can spell something unfortunate; these are regenerated instead.
const BLOCKED = new Set(['ASS', 'CUM', 'FAG', 'FCK', 'JEW', 'KKK', 'NAZ', 'SEX', 'TIT', 'WTF']);
const ATTEMPTS = 10;

const randomCharacter = (): string =>
  ALPHABET[crypto.getRandomValues(new Uint8Array(1))[0]! % ALPHABET.length]!;

/** First letter of the name, or `P` when it does not start with one (digits, emoji, other scripts). */
function firstLetter(name: string): string {
  const letter = name.trim().charAt(0).toUpperCase();
  return letter >= 'A' && letter <= 'Z' ? letter : 'P';
}

/**
 * Picks a key that is not in `taken`. Widens to four characters in the unlikely case that an org
 * has used up the three-character keys starting with this letter.
 */
export function generateProjectKey(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((key) => key.toUpperCase()));
  const letter = firstLetter(name);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const key = `${letter}${randomCharacter()}${randomCharacter()}`;
    if (!used.has(key) && !BLOCKED.has(key)) return key;
  }
  let key = `${letter}${randomCharacter()}${randomCharacter()}${randomCharacter()}`;
  while (used.has(key))
    key = `${letter}${randomCharacter()}${randomCharacter()}${randomCharacter()}`;
  return key;
}

/** Splits `WK7-42` into its parts. Case-insensitive; returns null when it is not a task key. */
export function parseTaskKey(value: string): { projectKey: string; number: number } | null {
  const match = value
    .trim()
    .toUpperCase()
    .match(/^([A-Z][A-Z0-9]{1,5})-(\d{1,9})$/);
  const number = Number(match?.[2]);
  if (!match?.[1] || !Number.isInteger(number) || number < 1) return null;
  return { projectKey: match[1], number };
}
