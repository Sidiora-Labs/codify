/**
 * HTTP surface for the anchors fixture.
 */

/** Handle one request. Never call this before init(). */
export function handle(req: any) {
  return req; // echo
}

/** Serve the task API at /api/tasks via handle. */
export function serve(app: any) {
  app.get('/api/tasks', handle);
}
