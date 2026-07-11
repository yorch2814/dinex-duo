REGLAS DE REALTIME DATABASE — DINEX

Pega exactamente este bloque en Firebase Console:
Realtime Database → Reglas → Publicar

{
  "rules": {
    ".read": "auth != null && (auth.uid === 'AfCrQB3gGPSKbfFanp5Pz3z2bvQ2' || auth.uid === 'EvngkxUMtZbuS5y5hSz9AcNzsLN2')",
    ".write": "auth != null && (auth.uid === 'AfCrQB3gGPSKbfFanp5Pz3z2bvQ2' || auth.uid === 'EvngkxUMtZbuS5y5hSz9AcNzsLN2')"
  }
}
