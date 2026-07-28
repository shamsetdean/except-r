// Construit le HTML du compte rendu à partir de exceptor_jobs.result (JSON
// complet renvoyé par Gladia). Reste tolérant aux champs manquants ou en
// statut Alpha (chapterization, named_entity_recognition).

const PROMPT_ORDER = [
  "ordre_du_jour",
  "resume_executif",
  "decisions",
  "actions",
  "questions_ouvertes",
  "consensus_desaccords",
];

const SECTION_TITLES = {
  resume_executif: "Résumé exécutif",
  ordre_du_jour: "Ordre du jour",
  decisions: "Décisions",
  actions: "Actions à suivre",
  questions_ouvertes: "Questions restées sans réponse",
  consensus_desaccords: "Points de consensus et de désaccord",
};

export function renderCompteRendu(job) {
  const result = job.result?.result ?? {};
  const audioToLlm = result.audio_to_llm?.results ?? [];
  const promptResponses = {};
  PROMPT_ORDER.forEach((key, i) => {
    promptResponses[key] = audioToLlm[i]?.results?.response ?? null;
  });

  const date = new Date(job.created_at).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const participantsList = (job.participants ?? []).map((p) => p.name).join(", ");

  let html = `
    <div class="compte-rendu">
      <div class="compte-rendu__badge">Brouillon généré automatiquement par IA — à valider avant diffusion officielle</div>
      <h1>${escapeHtml(job.meeting_title)}</h1>
      <p class="compte-rendu__meta">${escapeHtml(date)}${participantsList ? ` — ${escapeHtml(participantsList)}` : ""}</p>
  `;

  html += `<section><h2>${SECTION_TITLES.resume_executif}</h2>${
    promptResponses.resume_executif
      ? simpleMarkdownToHtml(promptResponses.resume_executif)
      : emptyNotice()
  }</section>`;

  html += `<section><h2>${SECTION_TITLES.ordre_du_jour}</h2>${
    job.agenda_provided
      ? simpleMarkdownToHtml(job.agenda_provided)
      : promptResponses.ordre_du_jour
        ? simpleMarkdownToHtml(promptResponses.ordre_du_jour)
        : emptyNotice()
  }</section>`;

  html += `<section><h2>${SECTION_TITLES.decisions}</h2>${
    promptResponses.decisions ? simpleMarkdownToHtml(promptResponses.decisions) : emptyNotice()
  }</section>`;

  html += `<section><h2>${SECTION_TITLES.actions}</h2>${
    promptResponses.actions ? simpleMarkdownToHtml(promptResponses.actions) : emptyNotice()
  }</section>`;

  html += `<section><h2>${SECTION_TITLES.questions_ouvertes}</h2>${
    promptResponses.questions_ouvertes ? simpleMarkdownToHtml(promptResponses.questions_ouvertes) : emptyNotice()
  }</section>`;

  html += `<section><h2>${SECTION_TITLES.consensus_desaccords}</h2>${
    promptResponses.consensus_desaccords ? simpleMarkdownToHtml(promptResponses.consensus_desaccords) : emptyNotice()
  }</section>`;

  // Transcript par intervenant (toujours disponible si la transcription a réussi)
  const utterances = result.transcription?.utterances ?? [];
  if (utterances.length) {
    html += `<section><h2>Transcript</h2><div class="transcript">`;
    utterances.forEach((u) => {
      html += `<p><span class="transcript__speaker">Intervenant ${u.speaker}</span> ${escapeHtml(u.text)}</p>`;
    });
    html += `</div></section>`;
  }

  html += `
      <p class="compte-rendu__footer">
        Document généré automatiquement par IA le ${escapeHtml(new Date().toLocaleDateString("fr-FR"))}
        via exceptōr. Les intitulés "Intervenant 0", "Intervenant 1"... correspondent aux voix
        distinguées automatiquement ; ils ne sont pas encore associés aux noms réels des participants.
      </p>
    </div>
  `;

  return html;
}

function emptyNotice() {
  return `<p class="compte-rendu__empty">Non disponible pour cette séance.</p>`;
}

/** Convertisseur minimal markdown → HTML : listes à puces, listes numérotées,
 * tableaux, paragraphes. Pas une librairie complète, juste ce dont les
 * réponses audio_to_llm ont besoin. Échappe le texte pour éviter toute
 * injection HTML. */
function simpleMarkdownToHtml(md) {
  const lines = md.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return emptyNotice();

  // Tableau markdown : ligne d'en-tête + ligne de séparateurs "---"
  if (lines[0].startsWith("|") && lines[1]?.includes("---")) {
    const headerCells = lines[0].split("|").map((c) => c.trim()).filter(Boolean);
    const rows = lines.slice(2).map((line) =>
      line.split("|").map((c) => c.trim()).filter((_, i, arr) => !(i === 0 && arr[0] === "") && !(i === arr.length - 1 && arr[arr.length - 1] === "")),
    );
    let table = "<table><thead><tr>";
    headerCells.forEach((c) => (table += `<th>${escapeHtml(c)}</th>`));
    table += "</tr></thead><tbody>";
    rows.forEach((row) => {
      table += "<tr>";
      row.forEach((c) => (table += `<td>${escapeHtml(c)}</td>`));
      table += "</tr>";
    });
    table += "</tbody></table>";
    return table;
  }

  // Liste (numérotée ou à puces)
  const isList = lines.every((l) => /^(\d+\.|-)\s/.test(l));
  if (isList) {
    const ordered = /^\d+\./.test(lines[0]);
    const tag = ordered ? "ol" : "ul";
    let list = `<${tag}>`;
    lines.forEach((l) => {
      const content = l.replace(/^(\d+\.|-)\s/, "");
      list += `<li>${escapeHtml(content)}</li>`;
    });
    list += `</${tag}>`;
    return list;
  }

  // Paragraphes simples
  return lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/** Temps écoulé depuis le lancement, affiché tant que le statut n'est pas "done"/"error". */
export function tempsEcoule(createdAtIso) {
  const elapsedMs = Date.now() - new Date(createdAtIso).getTime();
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 1) return "en cours depuis moins d'1 min";
  if (minutes === 1) return "en cours depuis 1 min";
  if (minutes < 60) return `en cours depuis ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `en cours depuis ${hours} h ${minutes % 60} min`;
}
