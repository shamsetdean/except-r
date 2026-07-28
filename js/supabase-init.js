// Client Supabase partagé par toute l'app — import ESM direct depuis un CDN,
// cohérent avec ta philosophie "zéro dépendance de build" sur tes autres
// projets Anthropotech Lab.
//
// ⚠️ À CONFIGURER : remplace les deux constantes ci-dessous par les valeurs
// de TON projet Supabase (celui créé pour cette app — ne réutilise pas le
// projet L'Atelier). La clé "anon" est publique par design (protégée par les
// policies RLS côté base), elle peut être commitée sans risque.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://rgvypdxggefpiwdfzzpy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_MZRcOl6EaSa1H_5e2qBdvw_5tn1OMMe";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
