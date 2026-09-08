/**
 * `request.json()` throws on an empty body ("Unexpected end of JSON input") rather than treating
 * it as "no fields sent" -- a real difference from every other endpoint in this API for the
 * roster-lifecycle actions, whose whole body is one optional `actorId` (there is no session to
 * take it from yet -- `lib/server/tenant-context.ts`'s pre-auth placeholder pattern). Reading the
 * body this way lets `PublishRoster` etc. be called with no body at all.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  return text.length === 0 ? {} : JSON.parse(text);
}
