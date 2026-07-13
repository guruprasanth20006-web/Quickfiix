const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://xegruiwvfxodhveasjlr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_4vvzZpGit4aFZ2TarjqRXw_XJrNO2-A";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

module.exports = supabase;
