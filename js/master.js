// ============================================================
// ComandaFlow — Painel Master: Funcionários + Configurações
// ============================================================

const estado = {
  perfil: null,
  estabelecimento: null,
  funcionarios: [],
};

async function iniciar() {
  estado.perfil = await verificarAutenticacao();
  if (!estado.perfil) return;

  if (estado.perfil.nivel_acesso !== 'master') {
    document.body.className = ''; // remove o layout de sidebar, senão a mensagem fica espremida
    document.body.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:center; height:100vh; text-align:center; padding:24px;">
        <div>
          <h2 style="font-family:'Bricolage Grotesque',sans-serif; margin-bottom:8px;">Acesso restrito</h2>
          <p style="color:#8A7C68; margin-bottom:16px;">Essa área é exclusiva do Master.</p>
          <a href="atendente.html" style="color:#E8A23A;">Voltar pro atendente</a>
        </div>
      </div>
    `;
    return;
  }

  injetarNavegacao(estado.perfil, 'master');

  await carregarEstabelecimento();
  await carregarFuncionarios();
}

// ------------------------------------------------------------
// Aba ativa
// ------------------------------------------------------------
function mostrarAba(aba) {
  document.querySelectorAll('.aba-conteudo').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.aba-botao').forEach(el => el.classList.remove('on'));
  document.getElementById(`aba-${aba}`).style.display = 'block';
  document.getElementById(`botao-aba-${aba}`).classList.add('on');
}

// ------------------------------------------------------------
// Funcionários
// ------------------------------------------------------------
async function carregarFuncionarios() {
  const { data, error } = await supabaseClient
    .from('perfis')
    .select('id, username, nome, nivel_acesso, ativo, criado_em')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('criado_em', { ascending: true });

  if (error) { console.error(error); return; }

  estado.funcionarios = data || [];
  renderFuncionarios();
}

function renderFuncionarios() {
  const container = document.getElementById('lista-funcionarios');

  container.innerHTML = estado.funcionarios.map(f => `
    <div class="funcionario-linha">
      <div>
        <div class="funcionario-nome">${f.nome} ${f.nivel_acesso === 'master' ? '<span class="badge-master">MASTER</span>' : ''}</div>
        <div class="funcionario-detalhe">usuário: ${f.username}</div>
      </div>
      <div class="funcionario-direita">
        <span class="funcionario-status ${f.ativo ? 'ativo' : 'inativo'}">${f.ativo ? 'Ativo' : 'Inativo'}</span>
        ${f.nivel_acesso !== 'master' ? `
          <button class="btn-toggle-status" onclick="alternarStatusFuncionario('${f.id}', ${!f.ativo})">
            ${f.ativo ? 'Desativar' : 'Ativar'}
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function alternarStatusFuncionario(perfilId, novoStatus) {
  const { error } = await supabaseClient
    .from('perfis')
    .update({ ativo: novoStatus })
    .eq('id', perfilId);

  if (error) { mostrarToast('Erro ao atualizar funcionário.', 'erro'); return; }

  mostrarToast(novoStatus ? 'Funcionário reativado.' : 'Funcionário desativado.');
  await carregarFuncionarios();
}

function abrirModalFuncionario() {
  document.getElementById('input-func-nome').value = '';
  document.getElementById('input-func-username').value = '';
  document.getElementById('input-func-senha').value = '';
  document.getElementById('modal-funcionario-overlay').style.display = 'flex';
}

function fecharModalFuncionario() {
  document.getElementById('modal-funcionario-overlay').style.display = 'none';
}

async function salvarNovoFuncionario() {
  const nome = formatarTitulo(document.getElementById('input-func-nome').value.trim());
  const username = document.getElementById('input-func-username').value.trim().toLowerCase();
  const senha = document.getElementById('input-func-senha').value;

  if (!nome || !username || !senha) {
    mostrarToast('Preenche nome, usuário e senha.', 'erro');
    return;
  }
  if (senha.length < 6) {
    mostrarToast('Senha precisa ter pelo menos 6 caracteres.', 'erro');
    return;
  }

  const btn = document.getElementById('btn-salvar-funcionario');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  try {
    const { data: sessao } = await supabaseClient.auth.getSession();

    const resposta = await fetch(`${SUPABASE_URL}/functions/v1/criar-funcionario`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessao.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nome, username, senha }),
    });

    const resultado = await resposta.json();

    if (!resposta.ok) {
      mostrarToast(resultado.erro || 'Erro ao criar funcionário.', 'erro');
      return;
    }

    mostrarToast(`Funcionário "${nome}" criado com sucesso!`);
    fecharModalFuncionario();
    await carregarFuncionarios();

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro de conexão ao criar funcionário.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar funcionário';
  }
}

// ------------------------------------------------------------
// Configurações do estabelecimento
// ------------------------------------------------------------
async function carregarEstabelecimento() {
  const { data, error } = await supabaseClient
    .from('estabelecimentos')
    .select('id, nome, modo_atendimento, permite_entrega, taxa_servico_padrao')
    .eq('id', estado.perfil.estabelecimento_id)
    .single();

  if (error) { console.error(error); return; }

  estado.estabelecimento = data;
  document.getElementById('config-nome-estabelecimento').textContent = data.nome;
  document.getElementById('input-modo-atendimento').value = data.modo_atendimento;
  document.getElementById('input-permite-entrega').checked = data.permite_entrega;
  document.getElementById('input-taxa-padrao').value = String(data.taxa_servico_padrao).replace('.', ',');
}

async function salvarConfiguracoes() {
  const modoAtendimento = document.getElementById('input-modo-atendimento').value;
  const permiteEntrega = document.getElementById('input-permite-entrega').checked;
  const taxaTexto = document.getElementById('input-taxa-padrao').value;
  const taxaPadrao = parseFloat(taxaTexto.replace(',', '.')) || 0;

  const { error } = await supabaseClient
    .from('estabelecimentos')
    .update({
      modo_atendimento: modoAtendimento,
      permite_entrega: permiteEntrega,
      taxa_servico_padrao: taxaPadrao,
    })
    .eq('id', estado.perfil.estabelecimento_id);

  if (error) {
    mostrarToast('Erro ao salvar configurações.', 'erro');
    return;
  }

  mostrarToast('Configurações salvas!');
  await carregarEstabelecimento();
}

iniciar();
