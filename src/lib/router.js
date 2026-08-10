// Two routes, so no router dependency is warranted:
//   /            the editor
//   /v/:shareId  a published dashboard, read-only
//
// nginx falls back to index.html for unknown paths, so /v/... reaches the app.

const SHARE_PATH = /^\/v\/([A-Za-z0-9_-]{4,64})\/?$/;

export function parseRoute(pathname = window.location.pathname) {
  const match = pathname.match(SHARE_PATH);
  if (match) return { name: 'view', shareId: match[1] };
  return { name: 'edit' };
}

export const shareUrl = (shareId) => `${window.location.origin}/v/${shareId}`;
