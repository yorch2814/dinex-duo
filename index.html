/* DINEX Firebase Service — Authentication + session */
(function () {
  'use strict';

  const listeners = new Set();
  let settled = false;
  let currentSession = null;

  function errorMessage(error) {
    const code = error && error.code ? error.code : '';
    const messages = {
      'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
      'auth/wrong-password': 'La contraseña no es correcta.',
      'auth/user-not-found': 'No existe una cuenta con ese correo.',
      'auth/invalid-email': 'Escribe un correo válido.',
      'auth/too-many-requests': 'Hubo demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
      'auth/network-request-failed': 'No hay conexión con Firebase. Revisa internet e inténtalo nuevamente.',
      'auth/user-disabled': 'Esta cuenta fue deshabilitada en Firebase.',
      'auth/missing-password': 'Escribe la contraseña.',
      'auth/unauthorized-domain': 'Este dominio aún no está autorizado en Firebase Authentication.'
    };
    return messages[code] || (error && error.message) || 'No se pudo completar la operación.';
  }

  function notify() {
    listeners.forEach((listener) => {
      try { listener(currentSession); } catch (error) { console.error(error); }
    });
  }

  try {
    if (!window.firebase || !window.DINEX_FIREBASE_CONFIG) {
      throw new Error('No se cargó el SDK o la configuración de Firebase.');
    }

    if (!firebase.apps.length) firebase.initializeApp(window.DINEX_FIREBASE_CONFIG);
    const auth = firebase.auth();
    const database = firebase.database();

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.warn);

    auth.onAuthStateChanged(async (user) => {
      if (user) {
        const allowed = window.DINEX_AUTHORIZED_USERS[user.uid];
        if (!allowed) {
          await auth.signOut();
          currentSession = null;
          settled = true;
          notify();
          return;
        }
        currentSession = {
          user,
          profile: { ...allowed, uid: user.uid, email: user.email || allowed.email }
        };
      } else {
        currentSession = null;
      }
      settled = true;
      notify();
    }, (error) => {
      console.error('Error de autenticación:', error);
      currentSession = null;
      settled = true;
      notify();
    });

    window.DinexFirebase = {
      auth,
      database,
      get session() { return currentSession; },
      get isSettled() { return settled; },
      onAuthChange(listener) {
        listeners.add(listener);
        if (settled) queueMicrotask(() => listener(currentSession));
        return () => listeners.delete(listener);
      },
      async signIn(email, password) {
        try {
          const credential = await auth.signInWithEmailAndPassword(String(email || '').trim(), String(password || ''));
          const allowed = window.DINEX_AUTHORIZED_USERS[credential.user.uid];
          if (!allowed) {
            await auth.signOut();
            throw Object.assign(new Error('Esta cuenta no está autorizada para entrar a DINEX.'), { code: 'dinex/not-authorized' });
          }
          return credential.user;
        } catch (error) {
          if (error.code === 'dinex/not-authorized') throw error;
          throw Object.assign(new Error(errorMessage(error)), { code: error.code });
        }
      },
      async signOut() { await auth.signOut(); },
      async sendPasswordReset(email) {
        const clean = String(email || '').trim();
        if (!clean) throw new Error('Escribe primero el correo de la cuenta.');
        try { await auth.sendPasswordResetEmail(clean); }
        catch (error) { throw new Error(errorMessage(error)); }
      },
      errorMessage
    };
  } catch (error) {
    console.error(error);
    settled = true;
    window.DinexFirebase = {
      session: null,
      isSettled: true,
      onAuthChange(listener) { queueMicrotask(() => listener(null)); return () => {}; },
      async signIn() { throw new Error(error.message); },
      async signOut() {},
      async sendPasswordReset() { throw new Error(error.message); },
      errorMessage: () => error.message,
      initializationError: error.message
    };
  }
})();
