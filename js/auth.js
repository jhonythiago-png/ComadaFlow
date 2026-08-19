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
/**
 * Confere se existe uma sessão válida do Supabase e se o perfil ainda
 * está ATIVO (sempre confere de novo no banco, nunca confia só no cache —
 * assim, se o Master desativar alguém, o acesso é cortado na hora).
 */
async function verificarAutenticacao() {
  const { data: sessao } = await supabaseClient.auth.getSession();
  if (!sessao?.session) {
    const paginaAtual = window.location.pathname.split('/').pop();
    window.location.href = `index.html?redirect=${encodeURIComponent(paginaAtual)}`;
    return null;
  }

  const { data: perfil, error } = await supabaseClient
    .from('perfis')
    .select('id, nome, username, nivel_acesso, estabelecimento_id, ativo')
    .eq('auth_user_id', sessao.session.user.id)
    .single();

  if (error || !perfil) {
    window.location.href = 'index.html';
    return null;
  }

  if (!perfil.ativo) {
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem(CHAVE_PERFIL);
    window.location.href = 'index.html?motivo=desativado';
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

/**
 * Formata como "Nome Próprio": primeira letra de cada palavra maiúscula,
 * resto minúsculo, mas mantém conectores comuns em português em minúsculo
 * (exceto se forem a primeira palavra). Usado pra nome de pessoa, item do
 * cardápio, categoria, ingrediente, etc — evita "joao", "JOAO", "João" misturados.
 */
const CONECTORES_MINUSCULOS = ['de', 'da', 'do', 'das', 'dos', 'e'];

function formatarTitulo(texto) {
  if (!texto) return texto;
  const limpo = texto.trim().replace(/\s+/g, ' ');
  if (!limpo) return limpo;
  return limpo.split(' ').map((palavra, i) => {
    const minuscula = palavra.toLowerCase();
    if (i > 0 && CONECTORES_MINUSCULOS.includes(minuscula)) return minuscula;
    return minuscula.charAt(0).toUpperCase() + minuscula.slice(1);
  }).join(' ');
}

/**
 * Formata só a primeira letra em maiúscula, sem mexer no resto —
 * usado em campos de texto corrido (descrição, motivo), onde title-case
 * em cada palavra ficaria estranho.
 */
function formatarPrimeiraLetra(texto) {
  if (!texto) return texto;
  const limpo = texto.trim().replace(/\s+/g, ' ');
  if (!limpo) return limpo;
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/**
 * Monta o menu do sistema (logo + navegação + usuário/sair) — aparece
 * em toda tela, mostrando só o que aquele nível de acesso pode ver.
 * No notebook fica como sidebar fixa lateral; no celular vira barra no topo.
 */
function injetarNavegacao(perfil, paginaAtual) {
  const container = document.getElementById('sidebar');
  if (!container || !perfil) return;

  const paginas = [
    { id: 'atendente', label: 'Atendente', href: 'atendente.html', masterOnly: false },
    { id: 'caixa', label: 'Caixa', href: 'caixa.html', masterOnly: false },
    { id: 'financeiro', label: 'Financeiro', href: 'financeiro.html', masterOnly: true },
    { id: 'cardapio', label: 'Cardápio', href: 'cardapio.html', masterOnly: true },
    { id: 'master', label: 'Config', href: 'master.html', masterOnly: true },
  ];

  const visiveis = paginas.filter(p => !p.masterOnly || perfil.nivel_acesso === 'master');

  const linksHtml = visiveis.map(p => `
    <a href="${p.href}" class="sidebar-nav-link ${p.id === paginaAtual ? 'on' : ''}">${p.label}</a>
  `).join('');

  container.innerHTML = `
    <span class="sidebar-logo">ComandaFlow</span>
    <nav class="sidebar-nav">${linksHtml}</nav>
    <div class="sidebar-footer">
      <span>${perfil.nome}</span>
      <button onclick="fazerLogout()">saír</button>
    </div>
  `;
}
