// ============================================================
// ComandaFlow — Painel do Caixa
// ============================================================

const estado = {
  perfil: null,
  estabelecimento: null,
  comandas: [],
  comandaEmFechamento: null,   // { comanda, itens, subtotal }
  taxaServicoPercentual: 0,
  taxaEntregaValor: 0,
  pagamentos: [],               // [{ forma, valor }]
};

// ------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------
async function iniciar() {
  estado.perfil = await verificarAutenticacao();
  if (!estado.perfil) return;

  injetarNavegacao(estado.perfil, 'caixa');

  const { data: estab } = await supabaseClient
    .from('estabelecimentos')
    .select('id, nome, taxa_servico_padrao')
    .eq('id', estado.perfil.estabelecimento_id)
    .single();
  estado.estabelecimento = estab;

  await carregarComandas();
  escutarMudancas();
  setInterval(carregarComandas, 5000); // rede de segurança, igual no atendente
}

// ------------------------------------------------------------
// Lista de comandas abertas
// ------------------------------------------------------------
async function carregarComandas() {
  // Se tiver um fechamento em andamento na tela, não atualiza por baixo do usuário
  if (estado.comandaEmFechamento) return;

  const { data, error } = await supabaseClient
    .from('comandas_com_total')
    .select('*')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .eq('status', 'aberta')
    .order('aberta_em', { ascending: false });

  if (error) { console.error(error); return; }

  estado.comandas = data || [];
  renderComandas();
}

function escutarMudancas() {
  supabaseClient
    .channel('caixa_mudancas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comandas' }, () => carregarComandas())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedido_itens' }, () => carregarComandas())
    .subscribe();
}

function rotuloComanda(c) {
  if (c.tipo === 'mesa') {
    return c.identificador_pessoa ? `Mesa ${c.numero_mesa} · ${c.identificador_pessoa}` : `Mesa ${c.numero_mesa}`;
  }
  if (c.tipo === 'entrega') return `Entrega · ${c.nome_cliente || ''}`;
  return c.nome_cliente || 'Balcão';
}

function tempoAberta(dataIso) {
  const minutos = Math.floor((Date.now() - new Date(dataIso).getTime()) / 60000);
  if (minutos < 1) return 'agora mesmo';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `há ${horas}h${minutos % 60 > 0 ? (minutos % 60) + 'min' : ''}`;
}

function renderComandas() {
  const grid = document.getElementById('grid-comandas');
  const contador = document.getElementById('contador-comandas');
  contador.textContent = `${estado.comandas.length} aberta${estado.comandas.length !== 1 ? 's' : ''}`;

  if (estado.comandas.length === 0) {
    grid.innerHTML = '<div class="aviso-vazio">Nenhuma comanda aberta no momento.</div>';
    return;
  }

  grid.innerHTML = estado.comandas.map(c => `
    <button class="ticket-card" onclick="abrirFechamento('${c.id}')">
      <div class="ticket-row1">
        <span class="badge">${rotuloComanda(c)}</span>
        <span class="dot"></span>
      </div>
      <div class="ticket-numero">Comanda #${c.numero_sequencial}</div>
      <div class="ticket-tempo">${tempoAberta(c.aberta_em)}</div>
      <div class="ticket-divisor"></div>
      <div class="ticket-total-row">
        <span class="label">parcial</span>
        <span class="valor">R$ ${Number(c.total_parcial).toFixed(2).replace('.', ',')}</span>
      </div>
    </button>
  `).join('');
}

// ------------------------------------------------------------
// Tela de fechamento
// ------------------------------------------------------------
async function abrirFechamento(comandaId) {
  const comanda = estado.comandas.find(c => c.id === comandaId);
  if (!comanda) return;

  const { data: itens, error } = await supabaseClient
    .from('pedido_itens')
    .select(`
      id, quantidade, observacao, preco_unitario_calculado,
      itens_cardapio ( nome ),
      pedido_item_ingredientes ( ingredientes ( nome ) )
    `)
    .eq('comanda_id', comandaId)
    .neq('status', 'cancelado');

  if (error) { mostrarToast('Erro ao carregar itens.', 'erro'); return; }

  estado.comandaEmFechamento = { comanda, itens: itens || [] };
  estado.taxaServicoPercentual = Number(estado.estabelecimento?.taxa_servico_padrao || 0);
  estado.taxaEntregaValor = Number(comanda.taxa_entrega || 0);
  estado.pagamentos = [];

  renderFechamento();
  document.getElementById('tela-comandas').style.display = 'none';
  document.getElementById('tela-fechamento').style.display = 'flex';
}

function fecharTelaFechamento() {
  estado.comandaEmFechamento = null;
  document.getElementById('tela-fechamento').style.display = 'none';
  document.getElementById('tela-comandas').style.display = 'flex';
  carregarComandas();
}

function calcularValores() {
  const { itens } = estado.comandaEmFechamento;
  const subtotal = round2(itens.reduce((soma, item) => soma + item.preco_unitario_calculado * item.quantidade, 0));
  const taxaValor = round2(subtotal * estado.taxaServicoPercentual / 100);
  const total = round2(subtotal + taxaValor + estado.taxaEntregaValor);
  return { subtotal, taxaValor, total };
}

function round2(n) { return Math.round(n * 100) / 100; }

function renderFechamento() {
  const { comanda, itens } = estado.comandaEmFechamento;
  const { subtotal, taxaValor, total } = calcularValores();

  document.getElementById('fechamento-titulo').textContent = rotuloComanda(comanda);
  document.getElementById('fechamento-codigo').textContent = `COMANDA #${comanda.numero_sequencial}`;

  document.getElementById('fechamento-itens').innerHTML = itens.map(item => {
    const sabores = item.pedido_item_ingredientes.map(s => s.ingredientes.nome).join(', ');
    return `
      <div class="fechamento-item-linha">
        <div>
          <div class="item-nome">${item.quantidade}× ${item.itens_cardapio.nome}</div>
          ${sabores ? `<div class="item-detalhe">${sabores}</div>` : ''}
          ${item.observacao ? `<div class="item-detalhe">${item.observacao}</div>` : ''}
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="item-valor">R$ ${(item.preco_unitario_calculado * item.quantidade).toFixed(2).replace('.', ',')}</span>
          <button class="btn-remover" onclick="removerItemFechamento('${item.id}')" title="Remover item (não cobrar)">✕</button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('input-taxa-servico').value = estado.taxaServicoPercentual.toString().replace('.', ',');
  document.getElementById('input-taxa-entrega').value = estado.taxaEntregaValor.toString().replace('.', ',');

  document.getElementById('valor-subtotal').textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
  document.getElementById('valor-taxa-servico').textContent = `R$ ${taxaValor.toFixed(2).replace('.', ',')}`;
  document.getElementById('valor-total').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;

  renderPagamentos();
}

/** Converte texto digitado (aceita vírgula ou ponto) pra número */
function paraNumero(texto) {
  if (typeof texto !== 'string') return Number(texto) || 0;
  return parseFloat(texto.replace(',', '.')) || 0;
}

/**
 * Remove um item da conta (não cobra) — pra quando o atendente
 * lançou algo errado por engano e o cliente não consumiu aquilo.
 * Marca como cancelado no banco e recalcula tudo na hora.
 */
async function removerItemFechamento(itemId) {
  const item = estado.comandaEmFechamento.itens.find(i => i.id === itemId);
  if (!item) return;

  const confirmar = confirm(`Remover "${item.quantidade}× ${item.itens_cardapio.nome}" da conta? Isso não vai ser cobrado.`);
  if (!confirmar) return;

  const { error } = await supabaseClient
    .from('pedido_itens')
    .update({ status: 'cancelado' })
    .eq('id', itemId);

  if (error) {
    mostrarToast('Erro ao remover item.', 'erro');
    return;
  }

  estado.comandaEmFechamento.itens = estado.comandaEmFechamento.itens.filter(i => i.id !== itemId);
  renderFechamento();
  mostrarToast('Item removido da conta.');
}

function atualizarTaxaServico(valor) {
  estado.taxaServicoPercentual = paraNumero(valor);
  atualizarResumoValores();
}

function atualizarTaxaEntrega(valor) {
  estado.taxaEntregaValor = paraNumero(valor);
  atualizarResumoValores();
}

/** Recalcula só os valores exibidos (subtotal/taxa/total) — não mexe
 * nos campos de input, pra não atrapalhar quem está digitando */
function atualizarResumoValores() {
  const { subtotal, taxaValor, total } = calcularValores();
  document.getElementById('valor-subtotal').textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
  document.getElementById('valor-taxa-servico').textContent = `R$ ${taxaValor.toFixed(2).replace('.', ',')}`;
  document.getElementById('valor-total').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
  renderResumoPagamento();
}

// ------------------------------------------------------------
// Split de pagamento
// ------------------------------------------------------------
function adicionarPagamento() {
  const { total } = calcularValores();
  const totalJaAlocado = estado.pagamentos.reduce((s, p) => s + p.valor, 0);
  const restante = round2(total - totalJaAlocado);

  estado.pagamentos.push({ forma: 'dinheiro', valor: restante > 0 ? restante : 0 });
  renderPagamentos();
}

function removerPagamento(index) {
  estado.pagamentos.splice(index, 1);
  renderPagamentos();
}

function atualizarFormaPagamento(index, forma) {
  estado.pagamentos[index].forma = forma;
}

function atualizarValorPagamento(index, valor) {
  estado.pagamentos[index].valor = paraNumero(valor);
  renderResumoPagamento();
}

function renderPagamentos() {
  const lista = document.getElementById('lista-pagamentos');

  if (estado.pagamentos.length === 0) {
    lista.innerHTML = '<div class="aviso-vazio-pequeno">Nenhuma forma de pagamento adicionada</div>';
  } else {
    lista.innerHTML = estado.pagamentos.map((p, i) => `
      <div class="pagamento-linha">
        <select onchange="atualizarFormaPagamento(${i}, this.value)">
          <option value="dinheiro" ${p.forma === 'dinheiro' ? 'selected' : ''}>Dinheiro</option>
          <option value="debito" ${p.forma === 'debito' ? 'selected' : ''}>Cartão Débito</option>
          <option value="credito" ${p.forma === 'credito' ? 'selected' : ''}>Cartão Crédito</option>
          <option value="pix" ${p.forma === 'pix' ? 'selected' : ''}>Pix</option>
        </select>
        <input type="text" inputmode="decimal" value="${p.valor.toString().replace('.', ',')}" oninput="atualizarValorPagamento(${i}, this.value)">
        <button class="btn-remover" onclick="removerPagamento(${i})">✕</button>
      </div>
    `).join('');
  }

  renderResumoPagamento();
}

function renderResumoPagamento() {
  const { total } = calcularValores();
  const totalPago = round2(estado.pagamentos.reduce((s, p) => s + (p.valor || 0), 0));
  const diferenca = round2(total - totalPago);

  document.getElementById('resumo-total-pago').textContent = `R$ ${totalPago.toFixed(2).replace('.', ',')}`;

  const elDiferenca = document.getElementById('resumo-diferenca');
  elDiferenca.textContent = `R$ ${diferenca.toFixed(2).replace('.', ',')}`;
  elDiferenca.className = diferenca === 0 ? 'ok' : (diferenca > 0 ? 'faltando' : 'sobrando');

  document.getElementById('btn-fechar-conta').disabled = diferenca !== 0 || estado.pagamentos.length === 0;
}

// ------------------------------------------------------------
// Confirmar fechamento
// ------------------------------------------------------------
async function confirmarFechamento() {
  const { comanda } = estado.comandaEmFechamento;
  const { subtotal, taxaValor, total } = calcularValores();

  const btn = document.getElementById('btn-fechar-conta');
  btn.disabled = true;
  btn.textContent = 'Fechando...';

  try {
    const { data: fechamento, error: erroFechamento } = await supabaseClient
      .from('fechamentos')
      .insert({
        comanda_id: comanda.id,
        subtotal_itens: subtotal,
        taxa_servico_percentual: estado.taxaServicoPercentual,
        taxa_servico_valor: taxaValor,
        taxa_entrega_valor: estado.taxaEntregaValor,
        valor_total: total,
        fechado_por: estado.perfil.id,
      })
      .select()
      .single();

    if (erroFechamento) throw erroFechamento;

    const linhasPagamento = estado.pagamentos.map(p => ({
      fechamento_id: fechamento.id,
      forma_pagamento: p.forma,
      valor: p.valor,
    }));

    const { error: erroPagamentos } = await supabaseClient.from('pagamentos').insert(linhasPagamento);
    if (erroPagamentos) throw erroPagamentos;

    const { error: erroComanda } = await supabaseClient
      .from('comandas')
      .update({ status: 'fechada', fechada_em: new Date().toISOString() })
      .eq('id', comanda.id);
    if (erroComanda) throw erroComanda;

    mostrarToast('Conta fechada com sucesso! 🎉');
    fecharTelaFechamento();

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro ao fechar conta. Tente de novo.', 'erro');
    btn.disabled = false;
    btn.textContent = 'Fechar conta';
  }
}

iniciar();
