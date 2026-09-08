/**
 * Parses HTML-comment-delimited blocks out of Markdown.
 *
 * This exists as its own module because it is the load-bearing part of the repository's
 * data boundary: it is how scripts/check-no-real-names.mjs learns which surnames must
 * never appear outside private/. If this parser silently returns an empty list, the
 * check passes everything and thirteen real people's names can reach a public repo.
 * That makes it worth testing directly rather than leaving it inline.
 *
 * Format contract (see private/doctor-codes.md):
 *
 *     <!-- SURNAMES:BEGIN -->
 *     One entry per line
 *     No blank lines, no Markdown
 *     <!-- SURNAMES:END -->
 */

/**
 * @param {string} markdown  Full document text.
 * @param {string} name      Block name, e.g. 'SURNAMES' or 'ALLOW'.
 * @returns {string[]}       Trimmed entries, in order. Empty if the block is absent.
 */
export function extractBlock(markdown, name) {
  if (typeof markdown !== 'string' || typeof name !== 'string' || name.length === 0) return [];

  const pattern = new RegExp(
    '<!--\\s*' +
      escapeRegExp(name) +
      ':BEGIN\\s*-->([\\s\\S]*?)<!--\\s*' +
      escapeRegExp(name) +
      ':END\\s*-->',
  );
  const match = pattern.exec(markdown);
  const body = match?.[1];
  if (body === undefined) return [];

  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('<!--'));
}

/** @param {string} value */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
