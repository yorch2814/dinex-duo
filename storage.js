/*
  DINEX Cloud Storage Adapter
  ---------------------------
  Sincroniza por elementos para reducir conflictos: cada movimiento, meta,
  cierre y registro de auditoría se guarda por su ID en Realtime Database.
  También conserva una copia local para abrir la app cuando la conexión falla.
*/
(function () {
  'use strict';

  const LOCAL_KEY = 'dinex_duo_v3_state';
  const COLLECTIONS = ['transactions', 'goals', 'closures', 'audit'];
  const statusListeners = new Set();
  let remoteRef = null;
  let lastState = null;
  let remoteListener = null;
  let connectionListener = null;
  let status = {
    connected: navigator.onLine,
    syncing: false,
    lastSyncedAt: null,
    error: null
  };

  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  function emitStatus(patch = {}) {
    status = { ...status, ...patch };
    statusListeners.forEach((listener) => {
      try { listener({ ...status }); } catch (error) { console.error(error); }
    });
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn('No se pudo leer la copia local:', error);
      return null;
    }
  }

  function writeLocal(state) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); }
    catch (error) { console.warn('No se pudo actualizar la copia local:', error); }
  }

  function mapById(list) {
    const map = {};
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (item && item.id) map[item.id] = item;
    });
    return map;
  }

  function decode(raw) {
    if (!raw) return null;
    // Compatibilidad con un posible formato antiguo { state: ... }
    if (raw.state && typeof raw.state === 'object') return raw.state;
    const meta = raw.meta || {};
    return {
      version: meta.version || '3.2.1',
      settings: raw.settings || undefined,
      transactions: Object.values(raw.transactions || {}),
      goals: Object.values(raw.goals || {}),
      closures: Object.values(raw.closures || {}),
      audit: Object.values(raw.audit || {}),
      createdAt: meta.createdAt || new Date().toISOString(),
      updatedAt: meta.clientUpdatedAt || new Date().toISOString()
    };
  }

  function ensureRemote() {
    const service = window.DinexFirebase;
    if (!service || !service.database || !service.session) throw new Error('No hay una sesión válida de Firebase.');
    if (!remoteRef) remoteRef = service.database.ref('dinex');
    return remoteRef;
  }

  function buildUpdates(next, previous) {
    const updates = {};
    const actor = window.DinexFirebase.session?.profile || {};

    if (!previous || !same(next.settings, previous.settings)) updates.settings = next.settings || null;

    COLLECTIONS.forEach((collection) => {
      const oldMap = mapById(previous?.[collection]);
      const newMap = mapById(next?.[collection]);
      new Set([...Object.keys(oldMap), ...Object.keys(newMap)]).forEach((id) => {
        if (!(id in newMap)) updates[`${collection}/${id}`] = null;
        else if (!(id in oldMap) || !same(newMap[id], oldMap[id])) updates[`${collection}/${id}`] = newMap[id];
      });
    });

    updates['meta/version'] = next.version || '3.2.1';
    updates['meta/createdAt'] = next.createdAt || previous?.createdAt || new Date().toISOString();
    updates['meta/clientUpdatedAt'] = next.updatedAt || new Date().toISOString();
    updates['meta/serverUpdatedAt'] = firebase.database.ServerValue.TIMESTAMP;
    updates['meta/updatedByUid'] = actor.uid || '';
    updates['meta/updatedByName'] = actor.name || '';
    return updates;
  }

  function applyWrite(next, previous = lastState) {
    const ref = ensureRemote();
    const updates = buildUpdates(next, previous);
    const before = lastState;
    lastState = clone(next);
    writeLocal(next);
    emitStatus({ syncing: true, error: null });

    ref.update(updates).then(() => {
      emitStatus({ syncing: false, connected: true, lastSyncedAt: new Date().toISOString(), error: null });
    }).catch((error) => {
      console.error('No se pudo sincronizar DINEX:', error);
      lastState = before;
      emitStatus({ syncing: false, error: error.message || 'Error de sincronización' });
    });
    return true;
  }

  async function remoteSnapshotWithTimeout(timeoutMs = 6000) {
    const ref = ensureRemote();
    return Promise.race([
      ref.once('value'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), timeoutMs))
    ]);
  }

  const adapter = {
    mode: 'firebase',
    async load() {
      const local = readLocal();
      try {
        const snapshot = await remoteSnapshotWithTimeout();
        const remote = decode(snapshot.val());
        if (remote) {
          lastState = clone(remote);
          writeLocal(remote);
          return remote;
        }
        if (local) {
          lastState = null;
          applyWrite(local, null); // migración automática V3.1 → nube cuando la nube está vacía
          return local;
        }
        return null;
      } catch (error) {
        console.warn('Se usará la copia local temporalmente:', error.message);
        emitStatus({ connected: false, error: null });
        lastState = clone(local);
        return local;
      }
    },
    async save(state) {
      try { return applyWrite(state); }
      catch (error) {
        writeLocal(state);
        emitStatus({ syncing: false, connected: false, error: error.message });
        return true;
      }
    },
    async clear() {
      localStorage.removeItem(LOCAL_KEY);
      lastState = null;
      try {
        ensureRemote().remove().catch((error) => emitStatus({ error: error.message }));
        return true;
      } catch (error) {
        emitStatus({ error: error.message });
        return false;
      }
    },
    async exportRaw() { return localStorage.getItem(LOCAL_KEY); },
    subscribe(listener) {
      const ref = ensureRemote();
      if (remoteListener) ref.off('value', remoteListener);
      remoteListener = (snapshot) => {
        const remote = decode(snapshot.val());
        if (!remote) return;
        lastState = clone(remote);
        writeLocal(remote);
        listener(remote, snapshot.val()?.meta || {});
      };
      ref.on('value', remoteListener, (error) => emitStatus({ error: error.message, syncing: false }));
      return () => { if (remoteListener) ref.off('value', remoteListener); remoteListener = null; };
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      queueMicrotask(() => listener({ ...status }));
      return () => statusListeners.delete(listener);
    },
    watchConnection() {
      try {
        const db = window.DinexFirebase.database;
        const ref = db.ref('.info/connected');
        if (connectionListener) ref.off('value', connectionListener);
        connectionListener = (snapshot) => emitStatus({ connected: snapshot.val() === true, error: null });
        ref.on('value', connectionListener);
      } catch (error) { emitStatus({ connected: navigator.onLine, error: error.message }); }
    },
    getStatus() { return { ...status }; }
  };

  window.addEventListener('online', () => emitStatus({ connected: true, error: null }));
  window.addEventListener('offline', () => emitStatus({ connected: false }));
  window.DinexStorage = adapter;
})();
