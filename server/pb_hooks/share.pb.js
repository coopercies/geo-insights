/// <reference path="../pb_data/types.d.ts" />

// GET /api/share/{shareId} — resolve a published dashboard.
//
// Why this exists rather than a collection rule: finding a project by shareId
// is a *list* query, and opening list access to anonymous callers would let
// anyone page through every unlisted dashboard and harvest its share ids. The
// share id has to be presented, not discovered. This endpoint takes one id and
// returns only that dashboard, or 404.

routerAdd('GET', '/api/share/{shareId}', (e) => {
  const shareId = e.request.pathValue('shareId');
  if (!shareId || shareId.length < 4) {
    return e.json(404, { message: 'Not found.' });
  }

  let project;
  try {
    project = e.app.findFirstRecordByFilter(
      'projects',
      "shareId = {:shareId} && visibility = 'unlisted'",
      { shareId }
    );
  } catch (err) {
    // Unknown id and "published then revoked" are deliberately the same answer.
    return e.json(404, { message: 'This dashboard link no longer exists, or was never published.' });
  }

  const datasets = [];
  try {
    e.app.expandRecord(project, ['datasets'], null);
    const related = project.expandedAll('datasets') || [];
    for (const d of related) {
      datasets.push({
        hash: d.getString('hash'),
        name: d.getString('name'),
        // Addressed by collection name, not d.collectionId — that property is
        // undefined inside the hook VM and silently produced /api/files/undefined/.
        // Payloads are content-addressed and immutable, so a plain file URL is
        // safe to hand out and cache hard.
        url: `/api/files/datasets/${d.id}/${d.getString('payload')}`,
      });
    }
  } catch (err) {
    return e.json(500, { message: 'Could not resolve the dashboard layers.' });
  }

  return e.json(200, {
    title: project.getString('title'),
    publishedAt: project.getDateTime('updated').string(),
    config: project.get('config'),
    datasets,
  });
});
