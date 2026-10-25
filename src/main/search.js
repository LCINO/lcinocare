'use strict';

// LcinoCare — global search.
// One flat index over every module's data; the UI groups results by type.
// The index is rebuilt from the latest scan + app inventory; feature
// shortcuts are always present even before the first scan.

const features = [
  { view: 'dashboard', title: 'Dashboard', keywords: 'health score cpu memory ram disk battery storage overview status monitor' },
  { view: 'clean', title: 'Smart Clean', keywords: 'clean junk cache leftover installer bloat trash empty cleaner safe delete' },
  { view: 'duplicates', title: 'Duplicates', keywords: 'duplicate same copy clone photo video file double' },
  { view: 'files', title: 'Large Files', keywords: 'large big huge file video movie size mb gb finder' },
  { view: 'apps', title: 'Applications', keywords: 'app application uninstall remove leftover residual program software' },
  { view: 'speed', title: 'Speed & Memory', keywords: 'speed memory booster slow process cpu quit heavy monitor' },
  { view: 'protected', title: 'Protected Items', keywords: 'protected never delete safe system keychain macos locked' },
  { view: 'history', title: 'History', keywords: 'history log cleaned deleted record' }
];

let index = [];

function buildFrom(scanData, appsList) {
  index = [];
  for (const f of features) {
    index.push({ type: 'feature', title: f.title, subtitle: 'Go to view', keywords: f.keywords, view: f.view });
  }
  if (scanData) {
    for (const group of scanData.groups || []) {
      for (const item of group.items) {
        index.push({
          type: 'cleaner',
          title: item.label,
          subtitle: item.path,
          keywords: `${item.label} ${item.safety} ${group.label} ${item.whatItIs || ''}`,
          sizeBytes: item.sizeBytes,
          path: item.path,
          payload: item
        });
      }
    }
    for (const nm of scanData.nodeModules || []) {
      index.push({
        type: 'file',
        title: `node_modules — ${nm.path.replace(/^.*\/([^/]+)\/node_modules$/, '$1')}`,
        subtitle: nm.path,
        keywords: 'node_modules npm dependencies project javascript',
        sizeBytes: nm.sizeBytes,
        path: nm.path
      });
    }
    for (const f of scanData.largeFiles || []) {
      index.push({
        type: 'file',
        title: f.path.split('/').pop(),
        subtitle: f.path,
        keywords: `large file ${f.kind} ${f.path.split('.').pop()}`,
        sizeBytes: f.sizeBytes,
        path: f.path
      });
    }
  }
  for (const app of appsList || []) {
    index.push({
      type: 'app',
      title: app.name,
      subtitle: `${app.location} — inspect for uninstall`,
      keywords: `app ${app.name} uninstall remove`,
      path: app.path
    });
  }
}

function query(q, limitPerType = 6) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return {};
  const scored = [];
  for (const entry of index) {
    const title = entry.title.toLowerCase();
    const kw = entry.keywords.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (title.startsWith(t)) score += 3;
      else if (title.includes(t)) score += 2;
      else if (kw.includes(t)) score += 1;
      else { score = 0; break; }
    }
    if (score > 0) scored.push({ score, entry });
  }
  scored.sort((a, b) => b.score - a.score);
  const grouped = {};
  for (const { entry } of scored) {
    grouped[entry.type] = grouped[entry.type] || [];
    if (grouped[entry.type].length < limitPerType) grouped[entry.type].push(entry);
  }
  return grouped;
}

module.exports = { buildFrom, query };
