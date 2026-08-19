// ============================================================
// ComandaFlow — Painel Admin (dono da plataforma)
// ============================================================

const estado = {
  superAdmin: null,
  estabelecimentos: [],
};

async function iniciar() {
  const superAdminSalvo = sessionStorage.getItem('comandaflow_super_admin');
  const { data: sessao } = await supabaseClient.auth.getSession();

  if (!sessao?.session) {
    window.location.href = 'index.html';
    return;
  }

  // Sempre confere de novo no banco (não confia só no cache) — mesma lógica
  // de segurança usada nas outras telas
  const { data: superAdmin, error } = await supabaseClient
    .from('super_admins')
    .select('id, nome, username')
    .eq('auth_user_id', sessao.session.user.id)
    .maybeSingle();

  if (error || !superAdmin) {
    // Não é super admin — manda pro login normal
    window.location.href = 'index.html';
    return;
  }

  estado.superAdmin = superAdmin;
  document.getElementById('nome-admin').textContent = superAdmin.nome;

  await carregarEstabelecimentos();
}

async function sairAdmin() {
  await supabaseClient.auth.signOut();
  sessionStorage.removeItem('comandaflow_super_admin');
  window.location.href = 'index.html';
}

// ------------------------------------------------------------
// Modal de confirmação genérico — substitui o confirm() nativo,
// que não é confiável em apps salvos na tela inicial do iPhone
// ------------------------------------------------------------
let acaoConfirmacaoPendente = null;

function mostrarConfirmacaoGenerica(mensagem, aoConfirmar) {
  document.getElementById('confirmacao-generica-texto').textContent = mensagem;
  acaoConfirmacaoPendente = aoConfirmar;
  document.getElementById('modal-confirmacao-generica-overlay').style.display = 'flex';
}

function fecharModalConfirmacaoGenerica() {
  document.getElementById('modal-confirmacao-generica-overlay').style.display = 'none';
  acaoConfirmacaoPendente = null;
}

async function executarConfirmacaoGenerica() {
  const acao = acaoConfirmacaoPendente;
  fecharModalConfirmacaoGenerica();
  if (acao) await acao();
}

// ------------------------------------------------------------
// Lista de estabelecimentos
// ------------------------------------------------------------
async function carregarEstabelecimentos() {
  const { data, error } = await supabaseClient.rpc('fn_listar_estabelecimentos_admin');

  if (error) {
    mostrarToast('Erro ao carregar estabelecimentos.', 'erro');
    console.error(error);
    return;
  }

  estado.estabelecimentos = data || [];
  renderEstabelecimentos();
}

function renderEstabelecimentos() {
  const container = document.getElementById('lista-estabelecimentos');
  document.getElementById('contador-estabelecimentos').textContent =
    `${estado.estabelecimentos.length} cliente${estado.estabelecimentos.length !== 1 ? 's' : ''}`;

  if (estado.estabelecimentos.length === 0) {
    container.innerHTML = '<div class="aviso-vazio">Nenhum cliente cadastrado ainda.</div>';
    return;
  }

  container.innerHTML = estado.estabelecimentos.map(e => {
    const data = new Date(e.criado_em).toLocaleDateString('pt-BR');
    return `
      <div class="cliente-linha">
        <div>
          <div class="cliente-nome">${e.nome} ${!e.ativo ? '<span class="badge-inativo">INATIVO</span>' : ''}</div>
          <div class="cliente-detalhe">slug: ${e.slug} · ${e.qtd_perfis} usuário${e.qtd_perfis !== 1 ? 's' : ''} · desde ${data}</div>
        </div>
        <div class="cliente-acoes">
          <button class="btn-toggle-cliente" onclick="alternarStatusEstabelecimento('${e.id}', ${!e.ativo})">
            ${e.ativo ? 'Desativar' : 'Ativar'}
          </button>
          <button class="btn-excluir-cliente" onclick="confirmarExcluirEstabelecimento('${e.id}', '${e.nome.replace(/'/g, "\\'")}')">
            Excluir
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function alternarStatusEstabelecimento(id, novoStatus) {
  const { error } = await supabaseClient.from('estabelecimentos').update({ ativo: novoStatus }).eq('id', id);
  if (error) { mostrarToast('Erro ao atualizar status.', 'erro'); console.error(error); return; }
  mostrarToast(novoStatus ? 'Cliente reativado.' : 'Cliente desativado.');
  await carregarEstabelecimentos();
}

function confirmarExcluirEstabelecimento(id, nome) {
  mostrarConfirmacaoGenerica(
    `Excluir "${nome}" de vez? Isso apaga TUDO desse cliente (cardápio, comandas, financeiro, logins) — não tem como desfazer.`,
    async () => {
      try {
        const { data: sessao } = await supabaseClient.auth.getSession();

        const resposta = await fetch(`${SUPABASE_URL}/functions/v1/excluir-estabelecimento`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sessao.session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ estabelecimento_id: id }),
        });

        const resultado = await resposta.json();

        if (!resposta.ok) {
          mostrarToast(resultado.erro || 'Erro ao excluir.', 'erro');
          return;
        }

        mostrarToast('Cliente excluído.');
        await carregarEstabelecimentos();

      } catch (erro) {
        console.error(erro);
        mostrarToast('Erro de conexão.', 'erro');
      }
    }
  );
}

// ------------------------------------------------------------
// Novo cliente/estabelecimento
// ------------------------------------------------------------
function abrirModalNovoCliente() {
  document.getElementById('input-cliente-nome').value = '';
  document.getElementById('input-cliente-slug').value = '';
  document.getElementById('input-master-nome').value = '';
  document.getElementById('input-master-username').value = '';
  document.getElementById('input-master-senha').value = '';
  document.getElementById('input-master-senha-confirmar').value = '';
  document.getElementById('modal-cliente-overlay').style.display = 'flex';
}

function fecharModalNovoCliente() {
  document.getElementById('modal-cliente-overlay').style.display = 'none';
}

// Sugere o slug automaticamente a partir do nome (só letras minúsculas e hífen)
function sugerirSlug() {
  const nome = document.getElementById('input-cliente-nome').value;
  const slug = nome
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acento
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  document.getElementById('input-cliente-slug').value = slug;
}

function alternarMostrarSenha(idCampo, botao) {
  const campo = document.getElementById(idCampo);
  const mostrando = campo.type === 'text';
  campo.type = mostrando ? 'password' : 'text';
  botao.textContent = mostrando ? '👁' : '🙈';
}

async function salvarNovoCliente() {
  const nomeEstabelecimento = formatarTitulo(document.getElementById('input-cliente-nome').value.trim());
  const slug = document.getElementById('input-cliente-slug').value.trim().toLowerCase();
  const masterNome = formatarTitulo(document.getElementById('input-master-nome').value.trim());
  const masterUsername = document.getElementById('input-master-username').value.trim().toLowerCase();
  const masterSenha = document.getElementById('input-master-senha').value;
  const masterSenhaConfirmar = document.getElementById('input-master-senha-confirmar').value;

  if (!nomeEstabelecimento || !slug || !masterNome || !masterUsername || !masterSenha) {
    mostrarToast('Preenche todos os campos.', 'erro');
    return;
  }
  if (masterSenha.length < 6) {
    mostrarToast('Senha precisa ter pelo menos 6 caracteres.', 'erro');
    return;
  }
  if (masterSenha !== masterSenhaConfirmar) {
    mostrarToast('As senhas não são iguais. Confere de novo.', 'erro');
    return;
  }

  const btn = document.getElementById('btn-salvar-cliente');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  try {
    const { data: sessao } = await supabaseClient.auth.getSession();

    const resposta = await fetch(`${SUPABASE_URL}/functions/v1/criar-estabelecimento`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessao.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nome_estabelecimento: nomeEstabelecimento,
        slug,
        master_nome: masterNome,
        master_username: masterUsername,
        master_senha: masterSenha,
      }),
    });

    const resultado = await resposta.json();

    if (!resposta.ok) {
      mostrarToast(resultado.erro || 'Erro ao criar cliente.', 'erro');
      return;
    }

    mostrarToast(`Cliente "${nomeEstabelecimento}" criado! Master: ${masterUsername}`);
    fecharModalNovoCliente();
    await carregarEstabelecimentos();

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro de conexão.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar cliente';
  }
}

iniciar();
