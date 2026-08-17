// ============================================================
// ComandaFlow — App do Atendente
// ============================================================

const estado = {
  perfil: null,
  comandaAtual: null,        // { id, numero_sequencial, tipo, numero_mesa, nome_cliente }
  cardapio: [],               // [{ categoria, itens: [{...item, ingredientes: [...]}] }]
  categoriaAtivaIndex: 0,
  carrinho: [],                // [{ item, quantidade, precoUnitario, observacao, sabores: [{id, nome, foiAcrescimo, precoAcrescimo}] }]
  itemEmEdicao: null,          // item sendo montado no modal agora
  selecaoSabores: [],          // ordem de seleção de sabores no modal (pro cálculo de cota)
  ingredientesRemovidos: [],   // ids removidos de um item 'fixo' no modal
};

// ------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------
async function iniciar() {
  estado.perfil = await verificarAutenticacao();
  if (!estado.perfil) return;

  document.getElementById('nome-usuario').textContent = estado.perfil.nome;

  await carregarCardapio();
  await carregarComandasAbertas();
}

// ------------------------------------------------------------
// Cardápio
// ------------------------------------------------------------
async function carregarCardapio() {
  const { data: categorias, error } = await supabaseClient
    .from('categorias_cardapio')
    .select(`
      id, nome, ordem_exibicao,
      itens_cardapio (
        id, nome, descricao, preco_base, tipo_montagem, qtd_sabores_inclusos, destaque, disponivel, ordem_exibicao,
        item_ingredientes ( id, papel, preco_acrescimo, ingredientes ( id, nome ) )
      )
    `)
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('ordem_exibicao');

  if (error) {
    mostrarToast('Erro ao carregar cardápio.', 'erro');
    console.error(error);
    return;
  }

  estado.cardapio = categorias
    .map(cat => ({
      ...cat,
      itens_cardapio: (cat.itens_cardapio || [])
        .filter(i => i.disponivel)
        .sort((a, b) => a.ordem_exibicao - b.ordem_exibicao),
    }))
    .filter(cat => cat.itens_cardapio.length > 0)
    .sort((a, b) => a.ordem_exibicao - b.ordem_exibicao);

  renderCategorias();
}

function renderCategorias() {
  const nav = document.getElementById('nav-categorias');
  nav.innerHTML = estado.cardapio.map((cat, i) => `
    <button class="chip ${i === estado.categoriaAtivaIndex ? 'on' : ''}" onclick="selecionarCategoria(${i})">
      ${cat.nome}
    </button>
  `).join('');
  renderItens();
}

function selecionarCategoria(index) {
  estado.categoriaAtivaIndex = index;
  renderCategorias();
}

function renderItens() {
  const categoria = estado.cardapio[estado.categoriaAtivaIndex];
  const grid = document.getElementById('grid-itens');
  if (!categoria) { grid.innerHTML = ''; return; }

  grid.innerHTML = categoria.itens_cardapio.map(item => `
    <button class="item-card" onclick="abrirModalItem('${item.id}')">
      ${item.destaque ? '<span class="badge-destaque">Mais pedido</span>' : ''}
      <div class="item-nome">${item.nome}</div>
      ${item.descricao ? `<div class="item-descricao">${item.descricao}</div>` : ''}
      <div class="item-preco">R$ ${item.preco_base.toFixed(2).replace('.', ',')}</div>
    </button>
  `).join('');
}

function encontrarItem(itemId) {
  for (const cat of estado.cardapio) {
    const item = cat.itens_cardapio.find(i => i.id === itemId);
    if (item) return item;
  }
  return null;
}

// ------------------------------------------------------------
// Comandas
// ------------------------------------------------------------
async function carregarComandasAbertas() {
  const { data, error } = await supabaseClient
    .from('comandas')
    .select('id, numero_sequencial, tipo, numero_mesa, nome_cliente')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .eq('status', 'aberta')
    .order('aberta_em', { ascending: false });

  if (error) { console.error(error); return; }

  const lista = document.getElementById('lista-comandas-abertas');
  if (!data || data.length === 0) {
    lista.innerHTML = '<div class="aviso-vazio">Nenhuma comanda aberta ainda.</div>';
    return;
  }

  lista.innerHTML = data.map(c => `
    <button class="comanda-card" onclick="selecionarComanda('${c.id}')">
      <span class="badge">${c.tipo === 'mesa' ? 'Mesa ' + c.numero_mesa : (c.nome_cliente || 'Balcão')}</span>
      <span class="numero">#${c.numero_sequencial}</span>
    </button>
  `).join('');
}

async function selecionarComanda(comandaId) {
  const { data, error } = await supabaseClient
    .from('comandas')
    .select('id, numero_sequencial, tipo, numero_mesa, nome_cliente')
    .eq('id', comandaId)
    .single();

  if (error || !data) { mostrarToast('Erro ao abrir comanda.', 'erro'); return; }

  estado.comandaAtual = data;
  estado.carrinho = [];
  mostrarTelaCardapio();
}

async function abrirNovaComandaMesa() {
  const numeroMesa = document.getElementById('input-numero-mesa').value.trim();
  if (!numeroMesa) { mostrarToast('Digite o número da mesa.', 'erro'); return; }
  await criarComanda({ tipo: 'mesa', numero_mesa: numeroMesa });
}

async function abrirNovaComandaAvulsa() {
  const nomeCliente = document.getElementById('input-nome-cliente').value.trim();
  await criarComanda({ tipo: 'avulsa', nome_cliente: nomeCliente || null });
}

async function criarComanda(dados) {
  const { data: numero, error: erroNumero } = await supabaseClient
    .rpc('fn_proximo_numero_comanda', { p_estabelecimento_id: estado.perfil.estabelecimento_id });

  if (erroNumero) { mostrarToast('Erro ao gerar número da comanda.', 'erro'); return; }

  const { data: comanda, error } = await supabaseClient
    .from('comandas')
    .insert({
      estabelecimento_id: estado.perfil.estabelecimento_id,
      numero_sequencial: numero,
      aberta_por: estado.perfil.id,
      ...dados,
    })
    .select()
    .single();

  if (error) { mostrarToast('Erro ao abrir comanda.', 'erro'); console.error(error); return; }

  estado.comandaAtual = comanda;
  estado.carrinho = [];
  mostrarTelaCardapio();
}

function mostrarTelaCardapio() {
  document.getElementById('tela-selecao-comanda').style.display = 'none';
  document.getElementById('tela-cardapio').style.display = 'flex';

  const c = estado.comandaAtual;
  document.getElementById('titulo-comanda').textContent =
    c.tipo === 'mesa' ? `Mesa ${c.numero_mesa}` : (c.nome_cliente || 'Comanda avulsa');
  document.getElementById('codigo-comanda').textContent = `COMANDA #${c.numero_sequencial}`;

  renderCarrinho();
}

function voltarParaComandas() {
  document.getElementById('tela-cardapio').style.display = 'none';
  document.getElementById('tela-selecao-comanda').style.display = 'flex';
  estado.comandaAtual = null;
  carregarComandasAbertas();
}

// ------------------------------------------------------------
// Modal de composição do item
// ------------------------------------------------------------
function abrirModalItem(itemId) {
  const item = encontrarItem(itemId);
  if (!item) return;

  estado.itemEmEdicao = item;
  estado.selecaoSabores = [];
  estado.ingredientesRemovidos = [];

  document.getElementById('modal-item-nome').textContent = item.nome;
  document.getElementById('modal-item-preco-base').textContent = `R$ ${item.preco_base.toFixed(2).replace('.', ',')}`;

  renderCorpoModal();
  document.getElementById('modal-overlay').style.display = 'flex';
}

function fecharModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  estado.itemEmEdicao = null;
}

function renderCorpoModal() {
  const item = estado.itemEmEdicao;
  const corpo = document.getElementById('modal-corpo');

  if (item.tipo_montagem === 'fixo') {
    const padrao = item.item_ingredientes.filter(ii => ii.papel === 'padrao');
    corpo.innerHTML = `
      <div class="modal-secao-label">Ingredientes (toque para remover)</div>
      <div class="ing-list">
        ${padrao.map(ii => `
          <button class="chip ${estado.ingredientesRemovidos.includes(ii.ingredientes.id) ? 'off' : 'on'}"
                  onclick="alternarRemocao('${ii.ingredientes.id}')">
            ${ii.ingredientes.nome}
          </button>
        `).join('')}
      </div>
      <div class="modal-secao-label">Observação adicional</div>
      <textarea id="modal-observacao-extra" rows="2" placeholder="Ex: cortar ao meio"></textarea>
    `;
  } else if (item.tipo_montagem === 'monte_sabores') {
    const opcoes = item.item_ingredientes.filter(ii => ii.papel === 'opcao');
    corpo.innerHTML = `
      <div class="modal-secao-label">Escolha ${item.qtd_sabores_inclusos} sabores (os próximos entram como acréscimo)</div>
      <div class="ing-list" id="lista-sabores-modal">
        ${opcoes.map(ii => renderChipSabor(ii)).join('')}
      </div>
    `;
  } else if (item.tipo_montagem === 'escolha_um') {
    const opcoes = item.item_ingredientes.filter(ii => ii.papel === 'opcao');
    corpo.innerHTML = `
      <div class="modal-secao-label">Escolha 1 sabor</div>
      <div class="ing-list" id="lista-sabores-modal">
        ${opcoes.map(ii => renderChipSabor(ii, true)).join('')}
      </div>
    `;
  } else {
    corpo.innerHTML = `<div class="modal-secao-label">Sem personalização — só ajuste a quantidade.</div>`;
  }

  atualizarTotalModal();
}

function renderChipSabor(itemIngrediente, unico = false) {
  const id = itemIngrediente.ingredientes.id;
  const selecionado = estado.selecaoSabores.includes(id);
  const item = estado.itemEmEdicao;
  const posicao = estado.selecaoSabores.indexOf(id);
  const foiAcrescimo = selecionado && !unico && posicao >= item.qtd_sabores_inclusos;

  let classe = 'chip';
  let sufixo = '';
  if (selecionado && foiAcrescimo) {
    classe += ' extra';
    sufixo = ` +R$${itemIngrediente.preco_acrescimo.toFixed(2).replace('.', ',')}`;
  } else if (selecionado) {
    classe += ' on';
  }

  return `<button class="${classe}" onclick="alternarSabor('${id}', ${unico})">${itemIngrediente.ingredientes.nome}${sufixo}</button>`;
}

function alternarRemocao(ingredienteId) {
  const idx = estado.ingredientesRemovidos.indexOf(ingredienteId);
  if (idx >= 0) estado.ingredientesRemovidos.splice(idx, 1);
  else estado.ingredientesRemovidos.push(ingredienteId);
  renderCorpoModal();
}

function alternarSabor(ingredienteId, unico) {
  if (unico) {
    estado.selecaoSabores = [ingredienteId];
  } else {
    const idx = estado.selecaoSabores.indexOf(ingredienteId);
    if (idx >= 0) estado.selecaoSabores.splice(idx, 1);
    else estado.selecaoSabores.push(ingredienteId);
  }
  renderCorpoModal();
}

function atualizarTotalModal() {
  const item = estado.itemEmEdicao;
  let total = item.preco_base;

  if (item.tipo_montagem === 'monte_sabores') {
    estado.selecaoSabores.forEach((id, pos) => {
      if (pos >= item.qtd_sabores_inclusos) {
        const ii = item.item_ingredientes.find(x => x.ingredientes.id === id);
        if (ii) total += ii.preco_acrescimo;
      }
    });
  }

  document.getElementById('modal-total').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
}

function confirmarAdicaoAoCarrinho() {
  const item = estado.itemEmEdicao;
  let precoUnitario = item.preco_base;
  let observacao = null;
  let sabores = [];

  if (item.tipo_montagem === 'fixo') {
    const nomesRemovidos = item.item_ingredientes
      .filter(ii => estado.ingredientesRemovidos.includes(ii.ingredientes.id))
      .map(ii => ii.ingredientes.nome);
    const obsExtra = document.getElementById('modal-observacao-extra')?.value.trim();
    const partes = [];
    if (nomesRemovidos.length) partes.push('Sem ' + nomesRemovidos.join(', '));
    if (obsExtra) partes.push(obsExtra);
    observacao = partes.length ? partes.join(' — ') : null;

  } else if (item.tipo_montagem === 'monte_sabores') {
    if (estado.selecaoSabores.length === 0) {
      mostrarToast('Escolha pelo menos 1 sabor.', 'erro');
      return;
    }
    sabores = estado.selecaoSabores.map((id, pos) => {
      const ii = item.item_ingredientes.find(x => x.ingredientes.id === id);
      const foiAcrescimo = pos >= item.qtd_sabores_inclusos;
      if (foiAcrescimo) precoUnitario += ii.preco_acrescimo;
      return { id, nome: ii.ingredientes.nome, foiAcrescimo, precoAcrescimo: foiAcrescimo ? ii.preco_acrescimo : 0 };
    });

  } else if (item.tipo_montagem === 'escolha_um') {
    if (estado.selecaoSabores.length === 0) {
      mostrarToast('Escolha 1 sabor.', 'erro');
      return;
    }
    const id = estado.selecaoSabores[0];
    const ii = item.item_ingredientes.find(x => x.ingredientes.id === id);
    sabores = [{ id, nome: ii.ingredientes.nome, foiAcrescimo: false, precoAcrescimo: 0 }];
  }

  adicionarAoCarrinho({ item, precoUnitario, observacao, sabores });
  fecharModal();
}

// ------------------------------------------------------------
// Carrinho
// ------------------------------------------------------------
function chaveLinha(linha) {
  const saboresOrdenados = linha.sabores.map(s => s.id).sort().join(',');
  return `${linha.item.id}|${linha.observacao || ''}|${saboresOrdenados}`;
}

function adicionarAoCarrinho(linha) {
  const chave = chaveLinha(linha);
  const existente = estado.carrinho.find(l => chaveLinha(l) === chave);
  if (existente) {
    existente.quantidade += 1;
  } else {
    estado.carrinho.push({ ...linha, quantidade: 1 });
  }
  renderCarrinho();
  mostrarToast(`${linha.item.nome} adicionado`);
}

function removerDoCarrinho(index) {
  estado.carrinho.splice(index, 1);
  renderCarrinho();
}

function renderCarrinho() {
  const lista = document.getElementById('carrinho-lista');
  const total = estado.carrinho.reduce((soma, l) => soma + l.precoUnitario * l.quantidade, 0);

  if (estado.carrinho.length === 0) {
    lista.innerHTML = '<div class="aviso-vazio">Carrinho vazio</div>';
  } else {
    lista.innerHTML = estado.carrinho.map((l, i) => `
      <div class="carrinho-linha">
        <div>
          <div class="carrinho-linha-nome">${l.quantidade}× ${l.item.nome}</div>
          ${l.sabores.length ? `<div class="carrinho-linha-obs">${l.sabores.map(s => s.nome).join(', ')}</div>` : ''}
          ${l.observacao ? `<div class="carrinho-linha-obs">${l.observacao}</div>` : ''}
        </div>
        <div class="carrinho-linha-direita">
          <span>R$ ${(l.precoUnitario * l.quantidade).toFixed(2).replace('.', ',')}</span>
          <button class="btn-remover" onclick="removerDoCarrinho(${i})">✕</button>
        </div>
      </div>
    `).join('');
  }

  document.getElementById('carrinho-total').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
  document.getElementById('btn-enviar-pedido').disabled = estado.carrinho.length === 0;
}

async function enviarPedido() {
  if (estado.carrinho.length === 0) return;
  const btn = document.getElementById('btn-enviar-pedido');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    for (const linha of estado.carrinho) {
      const { data: pedidoItem, error } = await supabaseClient
        .from('pedido_itens')
        .insert({
          comanda_id: estado.comandaAtual.id,
          item_cardapio_id: linha.item.id,
          quantidade: linha.quantidade,
          preco_unitario_calculado: linha.precoUnitario,
          observacao: linha.observacao,
          status: 'enviado',
          criado_por: estado.perfil.id,
        })
        .select()
        .single();

      if (error) throw error;

      if (linha.sabores.length > 0) {
        const linhasSabores = linha.sabores.map(s => ({
          pedido_item_id: pedidoItem.id,
          ingrediente_id: s.id,
          foi_acrescimo: s.foiAcrescimo,
          preco_acrescimo_aplicado: s.precoAcrescimo,
        }));
        const { error: erroSabores } = await supabaseClient
          .from('pedido_item_ingredientes')
          .insert(linhasSabores);
        if (erroSabores) throw erroSabores;
      }
    }

    mostrarToast('Pedido enviado pra cozinha! 🔥');
    estado.carrinho = [];
    renderCarrinho();

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro ao enviar pedido. Tente de novo.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = '↳ Enviar pedido pra cozinha';
  }
}

iniciar();
