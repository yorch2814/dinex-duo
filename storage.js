/*
  DINEX Storage Adapter
  ---------------------
  La app usa esta capa para leer y guardar datos. En la fase Firebase,
  se reemplazará internamente por un adaptador en la nube sin rehacer la UI.
*/
(function () {
  const STORAGE_KEY = 'dinex_duo_v3_state';

  const adapter = {
    mode: 'local',
    async load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        console.error('No se pudo leer DINEX:', error);
        return null;
      }
    },
    async save(state) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch (error) {
        console.error('No se pudo guardar DINEX:', error);
        return false;
      }
    },
    async clear() {
      localStorage.removeItem(STORAGE_KEY);
    },
    async exportRaw() {
      return localStorage.getItem(STORAGE_KEY);
    }
  };

  window.DinexStorage = adapter;
})();
