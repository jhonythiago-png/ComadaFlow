// ============================================================
// ComandaFlow — Autenticação
// ============================================================

const CHAVE_PERFIL = 'comandaflow_perfil';

/**
 * Confere se existe uma sessão válida do Supabase e, se sim,
 * garante que o perfil (nome, nível de acesso, estabelecimento)
 * esteja disponível em sessionStorage.
 * Se não houver sessão, redireciona pro login.
 */
async function verificarAutenticacao() {
  const perfilSalvo = sessionStorage.getItem(CHAVE_PERFIL);
  if (perfilSalvo) return JSON.parse(perfilSalvo);

  const { data: sessao } = await supabaseClient.auth.getSession();
  if (!sessao?.session) {
    window.location.href = 'index.html';
    return null;
  }

  const { data: perfil, error } = await supabaseClient
    .from('perfis')
    .select('id, nome, username, nivel_acesso, estabelecimento_id')
    .eq('auth_user_id', sessao.session.user.id)
    .single();

  if (error || !perfil) {
    window.location.href = 'index.html';
    return null;
  }

  sessionStorage.setItem(CHAVE_PERFIL, JSON.stringify(perfil));
  return perfil;
}

function obterPerfilAtual() {
  const perfilSalvo = sessionStorage.getItem(CHAVE_PERFIL);
  return perfilSalvo ? JSON.parse(perfilSalvo) : null;
}

async function fazerLogout() {
  await supabaseClient.auth.signOut();
  sessionStorage.removeItem(CHAVE_PERFIL);
  window.location.href = 'index.html';
}

function mostrarToast(mensagem, tipo = 'ok') {
  const toastAntigo = document.querySelector('.toast');
  if (toastAntigo) toastAntigo.remove();

  const toast = document.createElement('div');
  toast.className = 'toast' + (tipo === 'erro' ? ' erro' : '');
  toast.textContent = mensagem;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}
