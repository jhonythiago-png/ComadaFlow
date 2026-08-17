// ============================================================
// ComandaFlow — Conexão com Supabase
// ⚠️ TROQUE os valores abaixo pelos do seu projeto:
//    Painel Supabase → Project Settings → API
// ============================================================

const SUPABASE_URL = 'https://thrbfqdpnacixtumctsk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRocmJmcWRwbmFjaXh0dW1jdHNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3NjQzMTUsImV4cCI6MjEwMjM0MDMxNX0.yzpXcMySbf2n2RbCQ69_zJqj91BQkF0PMzc9RU06J9U';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
