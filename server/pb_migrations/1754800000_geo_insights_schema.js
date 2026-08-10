/// <reference path="../pb_data/types.d.ts" />

// Schema for saved and shared dashboards.
//
// Two collections, mirroring how publishing already works as static files:
//   datasets  immutable payloads keyed by content hash, stored once and reused
//   projects  small config records that change every time a card moves
//
// Viewers never log in, so the read path is governed by a project's visibility
// and an unguessable shareId. Writing always requires being the owner.

migrate(
  (app) => {
    // A fresh install may or may not ship a `users` collection depending on
    // version, so find it or create it rather than assuming.
    let users;
    try {
      users = app.findCollectionByNameOrId('users');
    } catch (err) {
      users = new Collection({
        name: 'users',
        type: 'auth',
        fields: [{ name: 'name', type: 'text', max: 120 }],
      });
      app.save(users);
      users = app.findCollectionByNameOrId('users');
    }

    const datasets = new Collection({
      name: 'datasets',
      type: 'base',
      // No enumeration: a dataset is fetched by id, which comes from a project
      // config you already have access to.
      listRule: null,
      viewRule: '',
      createRule: "@request.auth.id != ''",
      updateRule: 'owner = @request.auth.id',
      deleteRule: 'owner = @request.auth.id',
      fields: [
        { name: 'hash', type: 'text', required: true, max: 128 },
        { name: 'name', type: 'text', required: true, max: 200 },
        { name: 'rowCount', type: 'number' },
        { name: 'geometryType', type: 'text', max: 20 },
        // Field list, bbox and coordinate columns — everything the UI needs to
        // build its controls without reading the payload.
        { name: 'meta', type: 'json', maxSize: 5000000 },
        { name: 'payload', type: 'file', maxSelect: 1, maxSize: 157286400 },
        { name: 'owner', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      ],
      indexes: [
        // Content addressing only pays off if the same bytes can't be stored twice.
        'CREATE UNIQUE INDEX idx_datasets_hash ON datasets (hash)',
      ],
    });
    app.save(datasets);

    const projects = new Collection({
      name: 'projects',
      type: 'base',
      // Owners list their own; anyone holding an unlisted link may view.
      listRule: 'owner = @request.auth.id',
      viewRule: "visibility = 'unlisted' || owner = @request.auth.id",
      createRule: "@request.auth.id != ''",
      updateRule: 'owner = @request.auth.id',
      deleteRule: 'owner = @request.auth.id',
      fields: [
        { name: 'title', type: 'text', max: 200 },
        { name: 'shareId', type: 'text', required: true, max: 64 },
        {
          name: 'visibility',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['private', 'unlisted'],
        },
        // cards + layout + dataset metadata: a few KB, rewritten on every edit.
        { name: 'config', type: 'json', maxSize: 10000000 },
        {
          name: 'datasets',
          type: 'relation',
          collectionId: datasets.id,
          maxSelect: 50,
          cascadeDelete: false,
        },
        { name: 'owner', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_projects_shareId ON projects (shareId)',
        'CREATE INDEX idx_projects_owner ON projects (owner)',
      ],
    });
    app.save(projects);
  },
  (app) => {
    for (const name of ['projects', 'datasets']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (err) {
        // already gone
      }
    }
  }
);
