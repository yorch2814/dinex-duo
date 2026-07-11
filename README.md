# DINEX Dúo V3.2 — Firebase Sync

Versión sincronizada para Jorge y Kianna.

## Antes de publicar

1. En Firebase Authentication, habilita **Correo electrónico/contraseña**.
2. Verifica que existan las cuentas de Jorge y Kianna.
3. En Realtime Database, pega las reglas incluidas en `REGLAS_FIREBASE.txt`.
4. En Authentication → Configuración → Dominios autorizados, agrega `yorch2814.github.io`.
5. Sube todos los archivos de esta carpeta a la raíz del repositorio GitHub Pages.

## Archivos principales

- `index.html`: interfaz y pantalla de inicio de sesión.
- `firebase-config.js`: proyecto y usuarios autorizados.
- `firebase-service.js`: Authentication.
- `storage.js`: sincronización por elementos con Realtime Database y copia local.
- `app.js`: lógica financiera DINEX.
- `sw.js`: PWA y caché.

## Migración

Si la nube está vacía y el dispositivo conserva datos de DINEX V3.2, la primera sesión los subirá automáticamente. Si prefieres comenzar desde cero, borra los datos locales antes de publicar o usa “Borrar todos los datos” después de iniciar sesión.

## Seguridad

No incluyas contraseñas en ningún archivo. La configuración web de Firebase es pública; el acceso se protege con Authentication y las reglas de Realtime Database.
