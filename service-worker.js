// Service Worker — coquille applicative uniquement.
// Aucune donnée de séance (audio, transcription, compte rendu) n'est mise en
// cache ici : ces données transitent exclusivement via Supabase/Gladia en
// réseau, jamais stockées dans le cache du navigateur, pour rester cohérent
// avec les exigences de sécurité (minimisation, pas de copie locale non
// maîtrisée de données personnelles).

const CACHE_VERSION = "exceptor-shell-v1";

const APP_SHELL_FILES = [
  "./",
  "index.html",
  "offline.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/gladia-upload.js",
  "js/supabase-init.js",
  "js/compte-rendu.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-48.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Jamais de cache pour les appels vers Supabase ou Gladia : ce sont des
  // données dynamiques et potentiellement sensibles (audio, transcription).
  const isApiCall =
    url.hostname.endsWith(".supabase.co") ||
    url.hostname.endsWith("gladia.io");

  if (isApiCall) {
    // Réseau uniquement, pas d'interception ni de fallback offline pour les API.
    return;
  }

  // Navigation (chargement de page) : réseau prioritaire, fallback cache
  // puis fallback offline.html si totalement hors-ligne.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          caches.match(event.request).then((cached) => cached) ||
          caches.match("offline.html"),
      ),
    );
    return;
  }

  // Ressources statiques de la coquille (CSS/JS) : cache d'abord, réseau en secours.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => caches.match("offline.html"));
    }),
  );
});
