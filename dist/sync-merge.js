'use strict';

/*
 * Three-way merge for the shared CRM workspace.
 *
 * base   = the workspace exactly as this device last synced it
 * local  = this device's current workspace (with unsynced edits)
 * remote = the newer workspace another device saved to the cloud
 *
 * Collections (arrays of records with an `id`) merge record by record and plain
 * objects such as `settings` merge key by key. A change made on only one side
 * is applied. When both sides changed the same record differently, the cloud
 * version is kept and this device's version is returned in `conflicts`, so the
 * person can review it instead of either copy being lost silently.
 */
(function (root) {
  const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  // JSON with sorted object keys, so equal records compare equal regardless of key order.
  function stableStringify(value) {
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return `[${value.map(item => stableStringify(item === undefined ? null : item)).join(',')}]`;
    if (isPlainObject(value)) {
      return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
        .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }
  const same = (a, b) => stableStringify(a) === stableStringify(b);
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

  const isRecordList = value => Array.isArray(value) && value.every(item => isPlainObject(item) && typeof item.id === 'string' && item.id);

  function recordLabel(record, id) {
    if (!record) return id;
    return String(record.number || record.name || record.title || record.category || record.message || id).slice(0, 80);
  }

  function mergeRecordList(key, base, local, remote, conflicts) {
    const byId = list => new Map((list || []).map(item => [item.id, item]));
    const baseMap = byId(base), localMap = byId(local), remoteMap = byId(remote);
    const kept = new Map();
    for (const id of new Set([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()])) {
      const b = baseMap.get(id), l = localMap.get(id), r = remoteMap.get(id);
      let value;
      if (same(l, b)) value = r;                 // only the cloud changed (or nothing did)
      else if (same(r, b)) value = l;            // only this device changed
      else if (same(l, r)) value = l;            // both made the same change
      else {                                     // both changed it differently: keep cloud, ask
        value = r;
        conflicts.push({ collection: key, id, label: recordLabel(l || r || b, id), reason: !r ? 'deleted-in-cloud' : !l ? 'deleted-here' : 'edited-both', local: clone(l === undefined ? null : l) });
      }
      if (value !== undefined) kept.set(id, value);
    }
    // Cloud order first, then records only this device has, placed after their
    // previous neighbour in this device's list (new records are often unshifted).
    const result = (remote || []).filter(item => kept.has(item.id)).map(item => kept.get(item.id));
    const placed = new Set(result.map(item => item.id));
    (local || []).forEach((item, index) => {
      if (placed.has(item.id) || !kept.has(item.id)) return;
      let insertAt = 0;
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        const position = result.findIndex(entry => entry.id === local[previous].id);
        if (position >= 0) { insertAt = position + 1; break; }
      }
      result.splice(insertAt, 0, kept.get(item.id));
      placed.add(item.id);
    });
    return result.map(clone);
  }

  function mergeValue(key, base, local, remote, conflicts) {
    if (same(local, base)) return clone(remote);
    if (same(remote, base)) return clone(local);
    if (same(local, remote)) return clone(local);
    if ((isRecordList(local) || isRecordList(remote)) && [base, local, remote].every(value => value === undefined || isRecordList(value))) {
      return mergeRecordList(key, base, local, remote, conflicts);
    }
    if (isPlainObject(local) && isPlainObject(remote)) {
      const merged = {};
      const baseObject = isPlainObject(base) ? base : {};
      for (const field of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(baseObject)])) {
        const b = baseObject[field], l = local[field], r = remote[field];
        let value;
        if (same(l, b)) value = r;
        else if (same(r, b)) value = l;
        else if (same(l, r)) value = l;
        else {
          value = r;
          conflicts.push({ collection: key, id: field, label: `${key}: ${field}`, reason: 'edited-both', local: clone(l === undefined ? null : l), field: true });
        }
        if (value !== undefined) merged[field] = clone(value);
      }
      return merged;
    }
    conflicts.push({ collection: key, id: key, label: key, reason: 'edited-both', local: clone(local === undefined ? null : local), whole: true });
    return clone(remote);
  }

  function mergeWorkspace(base, local, remote) {
    const conflicts = [];
    const state = {};
    const baseState = isPlainObject(base) ? base : {};
    for (const key of new Set([...Object.keys(remote || {}), ...Object.keys(local || {}), ...Object.keys(baseState)])) {
      const value = mergeValue(key, baseState[key], (local || {})[key], (remote || {})[key], conflicts);
      if (value !== undefined) state[key] = value;
    }
    // Two devices can create documents with the same number while apart. Keep the
    // cloud document and send this device's one to review (it is renumbered on restore).
    if (Array.isArray(state.documents)) {
      const remoteIds = new Set(((remote || {}).documents || []).map(doc => doc.id));
      const seen = new Map();
      for (const doc of state.documents) if (remoteIds.has(doc.id) && doc.number) seen.set(doc.number, doc.id);
      state.documents = state.documents.filter(doc => {
        const owner = seen.get(doc.number);
        if (!doc.number || !owner || owner === doc.id) { if (doc.number && !owner) seen.set(doc.number, doc.id); return true; }
        conflicts.push({ collection: 'documents', id: doc.id, label: recordLabel(doc, doc.id), reason: 'number-taken', local: clone(doc) });
        return false;
      });
    }
    return { state, conflicts };
  }

  const api = { mergeWorkspace, stableStringify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.crmSyncMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
