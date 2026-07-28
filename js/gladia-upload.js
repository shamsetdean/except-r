// Reprise du prototype d'orchestration (voir secretaire-seance-prototype/),
// adapté en module ES pour être importé directement par app.js sans bundler.

import { supabase } from "./supabase-init.js";

/**
 * Lance le traitement complet d'une séance : upload du fichier audio dans
 * Storage, puis déclenchement du job Gladia via l'Edge Function gladia-init.
 *
 * @param {Blob|File} audioBlob
 * @param {Object} meta
 * @param {string} meta.meetingTitle
 * @param {string[]} [meta.participants]
 * @param {string} [meta.agendaProvided]
 * @param {string} [meta.fileExtension] - requis si audioBlob n'est pas un File nommé (ex: enregistrement micro)
 * @returns {Promise<{seanceJobId: string, gladiaJobId: string, status: string}>}
 */
export async function lancerTraitementSeance(audioBlob, meta) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("Utilisateur non authentifié");
  }

  const userId = session.user.id;
  const extension =
    meta.fileExtension ||
    (audioBlob.name ? audioBlob.name.split(".").pop() : "webm");
  const storagePath = `${userId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("exceptor-audio")
    .upload(storagePath, audioBlob, {
      contentType: audioBlob.type || "audio/webm",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Échec de l'upload : ${uploadError.message}`);
  }

  const { data, error: initError } = await supabase.functions.invoke(
    "gladia-init",
    {
      body: {
        storagePath,
        meetingTitle: meta.meetingTitle,
        participants: meta.participants ?? [],
        agendaProvided: meta.agendaProvided ?? null,
      },
    },
  );

  if (initError) {
    throw new Error(`Échec de l'initialisation du job : ${initError.message}`);
  }

  return data;
}

/** Récupère la liste des séances de l'utilisateur connecté, triées par date. */
export async function listerSeances() {
  const { data, error } = await supabase
    .from("exceptor_jobs")
    .select("id, meeting_title, status, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(`Impossible de récupérer les séances : ${error.message}`);
  return data;
}

/** S'abonne aux changements de statut en temps réel (insert + update). */
export function ecouterSeances(onChange) {
  const channel = supabase
    .channel("seance-jobs-listing")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "exceptor_jobs" },
      () => onChange(),
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
