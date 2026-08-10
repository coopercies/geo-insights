/// <reference path="../pb_data/types.d.ts" />

// datasets.listRule was null (superusers only) to stop anyone enumerating
// someone's layers. But saving looks a layer up by content hash before
// uploading it, and that lookup is a list operation — so saving failed with
// "Only superusers can perform this action".
//
// Scope the rule to the owner instead. Owners can find their own layers (which
// is what makes dedupe work); nobody else can list any. Viewers are unaffected:
// they reach datasets through a project's expand, which is governed by the
// view rule, not the list rule.

migrate(
  (app) => {
    const datasets = app.findCollectionByNameOrId('datasets');
    datasets.listRule = 'owner = @request.auth.id';
    app.save(datasets);
  },
  (app) => {
    const datasets = app.findCollectionByNameOrId('datasets');
    datasets.listRule = null;
    app.save(datasets);
  }
);
