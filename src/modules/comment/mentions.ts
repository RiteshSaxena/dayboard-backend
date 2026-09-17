// Mentions are stored in comment bodies as `<@userId>` tokens (21-character user IDs), so renames
// and duplicate names never break them.
const MENTION_TOKEN = /<@([0-9A-Za-z_-]{21})>/g;

export const MAX_MENTIONS = 20;

/** Distinct mentioned user IDs, in the order they first appear. */
export function parseMentions(body: string): string[] {
  const userIds = new Set<string>();
  for (const match of body.matchAll(MENTION_TOKEN)) {
    if (match[1]) userIds.add(match[1]);
  }
  return [...userIds];
}

/** Replaces mention tokens with `@Name` for emails and other plain-text output. */
export function renderMentionsAsText(body: string, names: ReadonlyMap<string, string>): string {
  return body.replace(
    MENTION_TOKEN,
    (_token, userId: string) => `@${names.get(userId) ?? 'former member'}`,
  );
}
