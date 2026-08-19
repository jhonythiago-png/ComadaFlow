// ============================================================
// ComandaFlow — Gerenciar Cardápio (Master)
// ============================================================

const estado = {
  perfil: null,
  categorias: [],
  itens: [],
  itemEmEdicaoId: null, // null = criando novo
};

const NOMES_TIPO = {
  fixo: 'Fixo (ingredientes prontos)',
  monte_sabores: 'Monte-sabores (escolhe N)',
  escolha_um: 'Escolha 1 sabor',
  venda_direta: 'Venda direta (sem sabor)',
};

async function iniciar() {
  estado.perfil = await verificarAutenticacao();
  if (!estado.perfil) return;

  if (estado.perfil.nivel_acesso !== 'master') {
    document.body.className = '';
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

  injetarNavegacao(estado.perfil, 'cardapio');
  await carregarCategorias();
  await carregarItens();
}

// ------------------------------------------------------------
// Categorias
// ------------------------------------------------------------
async function carregarCategorias() {
  const { data, error } = await supabaseClient
    .from('categorias_cardapio')
    .select('id, nome, ordem_exibicao')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('ordem_exibicao');

  if (error) { console.error(error); return; }

  estado.categorias = data || [];
  renderCategorias();
  preencherSelectCategorias();
}

function renderCategorias() {
  const container = document.getElementById('lista-categorias');

  if (estado.categorias.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhuma categoria ainda.</div>';
    return;
  }

  container.innerHTML = estado.categorias.map(c => `
    <div class="categoria-linha">
      <input type="text" value="${c.nome}" onchange="renomearCategoria('${c.id}', this.value)">
      <input type="number" class="categoria-ordem" value="${c.ordem_exibicao}" onchange="reordenarCategoria('${c.id}', this.value)" title="Ordem de exibição">
    </div>
  `).join('');
}

function preencherSelectCategorias() {
  const select = document.getElementById('input-item-categoria');
  if (!select) return;
  select.innerHTML = estado.categorias.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
}

async function renomearCategoria(id, novoNome) {
  if (!novoNome.trim()) return;
  const { error } = await supabaseClient.from('categorias_cardapio').update({ nome: novoNome.trim() }).eq('id', id);
  if (error) { mostrarToast('Erro ao renomear categoria.', 'erro'); return; }
  mostrarToast('Categoria atualizada.');
  await carregarCategorias();
  await carregarItens();
}

async function reordenarCategoria(id, novaOrdem) {
  const { error } = await supabaseClient.from('categorias_cardapio').update({ ordem_exibicao: parseInt(novaOrdem) || 0 }).eq('id', id);
  if (error) { mostrarToast('Erro ao reordenar.', 'erro'); return; }
  await carregarCategorias();
  await carregarItens();
}

async function criarNovaCategoria() {
  const nome = document.getElementById('input-nova-categoria').value.trim();
  if (!nome) { mostrarToast('Digite o nome da categoria.', 'erro'); return; }

  const proximaOrdem = estado.categorias.length > 0
    ? Math.max(...estado.categorias.map(c => c.ordem_exibicao)) + 1
    : 1;

  const { error } = await supabaseClient.from('categorias_cardapio').insert({
    estabelecimento_id: estado.perfil.estabelecimento_id,
    nome,
    ordem_exibicao: proximaOrdem,
  });

  if (error) { mostrarToast('Erro ao criar categoria.', 'erro'); return; }

  document.getElementById('input-nova-categoria').value = '';
  mostrarToast('Categoria criada!');
  await carregarCategorias();
}

// ------------------------------------------------------------
// Itens do cardápio
// ------------------------------------------------------------
async function carregarItens() {
  const { data, error } = await supabaseClient
    .from('itens_cardapio')
    .select('id, nome, descricao, preco_base, tipo_montagem, qtd_sabores_inclusos, destaque, disponivel, ordem_exibicao, categoria_id, categorias_cardapio(nome, ordem_exibicao)')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('ordem_exibicao');

  if (error) { console.error(error); return; }

  estado.itens = data || [];
  renderItens();
}

function renderItens() {
  const container = document.getElementById('lista-itens');

  if (estado.itens.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhum item cadastrado ainda.</div>';
    return;
  }

  // Agrupa por categoria, na ordem de exibição da categoria
  const porCategoria = {};
  for (const item of estado.itens) {
    const catNome = item.categorias_cardapio?.nome || '(sem categoria)';
    const catOrdem = item.categorias_cardapio?.ordem_exibicao ?? 999;
    if (!porCategoria[catNome]) porCategoria[catNome] = { ordem: catOrdem, itens: [] };
    porCategoria[catNome].itens.push(item);
  }

  const categoriasOrdenadas = Object.entries(porCategoria).sort((a, b) => a[1].ordem - b[1].ordem);

  container.innerHTML = categoriasOrdenadas.map(([catNome, dados]) => `
    <div class="grupo-categoria">
      <div class="grupo-categoria-titulo">${catNome}</div>
      ${dados.itens.map(item => `
        <div class="item-linha ${!item.disponivel ? 'indisponivel' : ''}">
          <div class="item-linha-clicavel" onclick="abrirModalItem('${item.id}')">
            <div class="item-linha-nome">
              ${item.nome}
              ${item.destaque ? '<span class="badge-destaque-mini">destaque</span>' : ''}
            </div>
            <div class="item-linha-detalhe">${NOMES_TIPO[item.tipo_montagem]} · R$ ${Number(item.preco_base).toFixed(2).replace('.', ',')}</div>
          </div>
          <label class="switch-disponivel" title="Disponível">
            <input type="checkbox" ${item.disponivel ? 'checked' : ''} onchange="alternarDisponibilidade('${item.id}', this.checked)">
            <span class="switch-slider"></span>
          </label>
        </div>
      `).join('')}
    </div>
  `).join('');
}

async function alternarDisponibilidade(itemId, novoValor) {
  const { error } = await supabaseClient.from('itens_cardapio').update({ disponivel: novoValor }).eq('id', itemId);
  if (error) { mostrarToast('Erro ao atualizar disponibilidade.', 'erro'); return; }
  mostrarToast(novoValor ? 'Item disponível.' : 'Item marcado como indisponível.');
  await carregarItens();
}

// ------------------------------------------------------------
// Modal de item (criar/editar)
// ------------------------------------------------------------
function abrirModalItem(itemId) {
  estado.itemEmEdicaoId = itemId || null;
  const item = itemId ? estado.itens.find(i => i.id === itemId) : null;

  document.getElementById('modal-item-titulo').textContent = item ? 'Editar item' : 'Novo item';
  document.getElementById('input-item-nome').value = item?.nome || '';
  document.getElementById('input-item-descricao').value = item?.descricao || '';
  document.getElementById('input-item-preco').value = item ? String(item.preco_base).replace('.', ',') : '';
  document.getElementById('input-item-categoria').value = item?.categoria_id || (estado.categorias[0]?.id || '');
  document.getElementById('input-item-tipo').value = item?.tipo_montagem || 'fixo';
  document.getElementById('input-item-qtd-sabores').value = item?.qtd_sabores_inclusos || '';
  document.getElementById('input-item-destaque').checked = item?.destaque || false;
  document.getElementById('input-item-disponivel').checked = item ? item.disponivel : true;

  atualizarVisibilidadeQtdSabores();
  document.getElementById('btn-excluir-item').style.display = item ? 'block' : 'none';
  document.getElementById('modal-item-overlay').style.display = 'flex';
}

function fecharModalItem() {
  document.getElementById('modal-item-overlay').style.display = 'none';
}

function atualizarVisibilidadeQtdSabores() {
  const tipo = document.getElementById('input-item-tipo').value;
  const precisa = tipo === 'monte_sabores' || tipo === 'escolha_um';
  document.getElementById('campo-qtd-sabores').style.display = precisa ? 'block' : 'none';
  if (tipo === 'escolha_um') document.getElementById('input-item-qtd-sabores').value = 1;
}

async function salvarItem() {
  const nome = document.getElementById('input-item-nome').value.trim();
  const descricao = document.getElementById('input-item-descricao').value.trim();
  const precoTexto = document.getElementById('input-item-preco').value;
  const categoriaId = document.getElementById('input-item-categoria').value;
  const tipoMontagem = document.getElementById('input-item-tipo').value;
  const qtdSaboresTexto = document.getElementById('input-item-qtd-sabores').value;
  const destaque = document.getElementById('input-item-destaque').checked;
  const disponivel = document.getElementById('input-item-disponivel').checked;

  const preco = parseFloat(precoTexto.replace(',', '.'));

  if (!nome || !preco || preco <= 0 || !categoriaId) {
    mostrarToast('Preenche nome, preço e categoria.', 'erro');
    return;
  }

  const precisaQtdSabores = tipoMontagem === 'monte_sabores' || tipoMontagem === 'escolha_um';
  const qtdSabores = precisaQtdSabores ? (parseInt(qtdSaboresTexto) || 1) : null;

  const dadosItem = {
    estabelecimento_id: estado.perfil.estabelecimento_id,
    categoria_id: categoriaId,
    nome,
    descricao: descricao || null,
    preco_base: preco,
    tipo_montagem: tipoMontagem,
    qtd_sabores_inclusos: qtdSabores,
    destaque,
    disponivel,
  };

  let erro;
  if (estado.itemEmEdicaoId) {
    ({ error: erro } = await supabaseClient.from('itens_cardapio').update(dadosItem).eq('id', estado.itemEmEdicaoId));
  } else {
    const proximaOrdem = estado.itens.filter(i => i.categoria_id === categoriaId).length + 1;
    ({ error: erro } = await supabaseClient.from('itens_cardapio').insert({ ...dadosItem, ordem_exibicao: proximaOrdem }));
  }

  if (erro) {
    mostrarToast('Erro ao salvar item.', 'erro');
    console.error(erro);
    return;
  }

  mostrarToast('Item salvo!');
  fecharModalItem();
  await carregarItens();
}

async function excluirItem() {
  if (!estado.itemEmEdicaoId) return;
  const confirmar = confirm('Excluir esse item de vez? Isso não afeta pedidos já feitos no passado, só remove ele do cardápio pra novos pedidos.');
  if (!confirmar) return;

  const { error } = await supabaseClient.from('itens_cardapio').delete().eq('id', estado.itemEmEdicaoId);
  if (error) {
    mostrarToast('Erro ao excluir. Se já foi usado em algum pedido, desative em vez de excluir.', 'erro');
    return;
  }

  mostrarToast('Item excluído.');
  fecharModalItem();
  await carregarItens();
}

iniciar();
