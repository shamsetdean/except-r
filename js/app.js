import { supabase } from "./supabase-init.js";
import { lancerTraitementSeance, listerSeances, ecouterSeances, sonderAvancementSeances } from "./gladia-upload.js";

// ---------------------------------------------------------------------------
// Service Worker
// ---------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      console.error("Échec de l'enregistrement du service worker :", err);
    });
  });
}

// ---------------------------------------------------------------------------
// Indicateur de connexion réseau
// ---------------------------------------------------------------------------
const connectionStatus = document.getElementById("connection-status");
function updateConnectionStatus() {
  connectionStatus.textContent = navigator.onLine ? "en ligne" : "hors-ligne";
}
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
updateConnectionStatus();

// ---------------------------------------------------------------------------
// Éléments DOM
// ---------------------------------------------------------------------------
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");
const authForm = document.getElementById("auth-form");
const authBanner = document.getElementById("auth-banner");
const appBanner = document.getElementById("app-banner");
const logoutButton = document.getElementById("logout-button");

const meetingTitleInput = document.getElementById("meeting-title");
const participantsInput = document.getElementById("participants-input");
const participantsTagInput = document.getElementById("participants-tag-input");
const agendaInput = document.getElementById("agenda-input");
const dropzone = document.getElementById("dropzone");
const dropzoneFilename = document.getElementById("dropzone-filename");
const fileInput = document.getElementById("file-input");
const submitButton = document.getElementById("submit-button");
const recordButton = document.getElementById("record-button");
const recordTimer = document.getElementById("record-timer");
const seanceListEl = document.getElementById("seance-list");

let selectedAudio = null; // { blob, extension, label }
let participants = [];
let unsubscribeSeances = null;
let pollInterval = null;

const POLL_INTERVAL_MS = 15000; // 15s

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    await sonderAvancementSeances();
    refreshSeanceList();
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Authentification (lien magique par e-mail)
// ---------------------------------------------------------------------------
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("auth-email").value.trim();
  if (!email) return;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });

  authBanner.innerHTML = error
    ? banner("error", `Échec de l'envoi : ${error.message}`)
    : banner("info", "Lien de connexion envoyé — vérifie ta boîte mail.");
});

logoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
  showAuthScreen();
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showAppScreen();
  } else {
    showAuthScreen();
  }
});

function showAuthScreen() {
  authScreen.hidden = false;
  appScreen.hidden = true;
  if (unsubscribeSeances) unsubscribeSeances();
  stopPolling();
}

function showAppScreen() {
  authScreen.hidden = true;
  appScreen.hidden = false;
  refreshSeanceList();
  if (unsubscribeSeances) unsubscribeSeances();
  unsubscribeSeances = ecouterSeances(refreshSeanceList);
  startPolling();
}

// Vérifie la session au chargement
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) showAppScreen();
  else showAuthScreen();
});

// ---------------------------------------------------------------------------
// Participants (tag input)
// ---------------------------------------------------------------------------
participantsInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && participantsInput.value.trim()) {
    e.preventDefault();
    addParticipant(participantsInput.value.trim());
    participantsInput.value = "";
  }
});

function addParticipant(name) {
  if (participants.includes(name)) return;
  participants.push(name);
  renderParticipants();
}

function removeParticipant(name) {
  participants = participants.filter((p) => p !== name);
  renderParticipants();
}

function renderParticipants() {
  participantsTagInput
    .querySelectorAll(".tag")
    .forEach((el) => el.remove());

  participants.forEach((name) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.innerHTML = `${escapeHtml(name)} <button type="button" aria-label="Retirer ${escapeHtml(name)}">&times;</button>`;
    tag.querySelector("button").addEventListener("click", () => removeParticipant(name));
    participantsTagInput.insertBefore(tag, participantsInput);
  });
}

// ---------------------------------------------------------------------------
// Sélection de fichier (drag & drop + clic)
// ---------------------------------------------------------------------------
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) setSelectedFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) setSelectedFile(file);
});

function setSelectedFile(file) {
  selectedAudio = { blob: file, extension: file.name.split(".").pop(), label: file.name };
  dropzoneFilename.textContent = file.name;
  stopRecordingIfActive();
  updateSubmitState();
}

// ---------------------------------------------------------------------------
// Enregistrement micro (MediaRecorder)
// ---------------------------------------------------------------------------
let mediaRecorder = null;
let recordedChunks = [];
let recordStartTime = null;
let recordTimerInterval = null;

recordButton.addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: "audio/webm" });
      selectedAudio = { blob, extension: "webm", label: "Enregistrement micro" };
      dropzoneFilename.textContent = selectedAudio.label;
      stream.getTracks().forEach((track) => track.stop());
      recordButton.classList.remove("recording");
      recordButton.setAttribute("aria-label", "Démarrer l'enregistrement");
      clearInterval(recordTimerInterval);
      updateSubmitState();
    };

    mediaRecorder.start();
    recordStartTime = Date.now();
    recordButton.classList.add("recording");
    recordButton.setAttribute("aria-label", "Arrêter l'enregistrement");
    recordTimerInterval = setInterval(updateRecordTimer, 1000);
  } catch (err) {
    appBanner.innerHTML = banner(
      "error",
      "Accès au micro refusé ou indisponible. Utilise l'upload de fichier à la place.",
    );
    console.error(err);
  }
});

function updateRecordTimer() {
  const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  recordTimer.textContent = `${minutes}:${seconds}`;
}

function stopRecordingIfActive() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
}

// ---------------------------------------------------------------------------
// Soumission
// ---------------------------------------------------------------------------
function updateSubmitState() {
  submitButton.disabled = !(meetingTitleInput.value.trim() && selectedAudio);
}
meetingTitleInput.addEventListener("input", updateSubmitState);

submitButton.addEventListener("click", async () => {
  if (!selectedAudio || !meetingTitleInput.value.trim()) return;

  submitButton.disabled = true;
  submitButton.textContent = "Envoi en cours…";
  appBanner.innerHTML = "";

  try {
    await lancerTraitementSeance(selectedAudio.blob, {
      meetingTitle: meetingTitleInput.value.trim(),
      participants,
      agendaProvided: agendaInput.value.trim() || null,
      fileExtension: selectedAudio.extension,
    });

    appBanner.innerHTML = banner(
      "info",
      "Séance envoyée — la transcription et l'analyse sont en cours. Le compte rendu apparaîtra ci-dessous une fois prêt.",
    );

    resetForm();
    refreshSeanceList();
  } catch (err) {
    appBanner.innerHTML = banner("error", err.message);
    console.error(err);
  } finally {
    submitButton.disabled = false;
    resetSubmitLabel();
  }
});

function resetForm() {
  meetingTitleInput.value = "";
  agendaInput.value = "";
  participants = [];
  renderParticipants();
  selectedAudio = null;
  dropzoneFilename.textContent = "";
  fileInput.value = "";
  recordTimer.textContent = "00:00";
  updateSubmitState();
}

function resetSubmitLabel() {
  submitButton.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 12h14"></path>
      <path d="M13 6l6 6-6 6"></path>
    </svg>
    Lancer la transcription`;
}

// ---------------------------------------------------------------------------
// Liste des séances
// ---------------------------------------------------------------------------
async function refreshSeanceList() {
  try {
    const seances = await listerSeances();
    renderSeanceList(seances);
  } catch (err) {
    console.error(err);
  }
}

function renderSeanceList(seances) {
  if (!seances.length) {
    seanceListEl.innerHTML = `<li class="empty-state">Aucune séance pour le moment.</li>`;
    return;
  }

  seanceListEl.innerHTML = seances
    .map((s) => {
      const date = new Date(s.created_at).toLocaleString("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      });
      return `
        <li class="seance-item">
          <div>
            <div class="seance-item__title">${escapeHtml(s.meeting_title)}</div>
            <div class="seance-item__date">${date}</div>
          </div>
          <span class="badge badge--${s.status}">${statusLabel(s.status)}</span>
        </li>`;
    })
    .join("");
}

function statusLabel(status) {
  return (
    {
      creating: "création…",
      processing: "en cours",
      done: "prêt",
      error: "échec",
    }[status] ?? status
  );
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function banner(type, message) {
  return `<div class="banner banner--${type}">${escapeHtml(message)}</div>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
