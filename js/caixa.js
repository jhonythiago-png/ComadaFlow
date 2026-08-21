// ============================================================
// Evvo Food — Painel do Caixa
// ============================================================

const estado = {
  perfil: null,
  estabelecimento: null,
  comandas: [],
  comandaEmFechamento: null,   // { comanda, itens, subtotal }
  taxaServicoPercentual: 0,
  taxaEntregaValor: 0,
  pagamentos: [],               // [{ forma, valor }]
  historico: [],
  periodoHistorico: 'hoje',
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

// ------------------------------------------------------------
// Histórico de comandas fechadas + reimpressão
// ------------------------------------------------------------
function abrirHistorico() {
  document.getElementById('tela-comandas').style.display = 'none';
  document.getElementById('tela-historico').style.display = 'flex';
  selecionarPeriodoHistorico(estado.periodoHistorico);
}

function fecharHistorico() {
  document.getElementById('tela-historico').style.display = 'none';
  document.getElementById('tela-comandas').style.display = 'flex';
}

function selecionarPeriodoHistorico(periodo) {
  estado.periodoHistorico = periodo;
  document.querySelectorAll('.historico-periodo .periodo-chip').forEach(el => el.classList.remove('on'));
  document.getElementById(`chip-historico-${periodo}`).classList.add('on');
  carregarHistorico();
}

async function carregarHistorico() {
  const grid = document.getElementById('grid-historico');
  grid.innerHTML = '<div class="aviso-vazio">Carregando...</div>';

  const hoje = new Date();
  const fim = hoje.toISOString();
  let inicioData;
  if (estado.periodoHistorico === 'hoje') {
    inicioData = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  } else {
    inicioData = new Date(hoje);
    inicioData.setDate(inicioData.getDate() - 6);
    inicioData.setHours(0, 0, 0, 0);
  }

  const { data, error } = await supabaseClient
    .from('fechamentos')
    .select(`
      id, valor_total, fechado_em,
      comandas!inner ( id, numero_sequencial, tipo, numero_mesa, nome_cliente, identificador_pessoa, estabelecimento_id, status )
    `)
    .eq('comandas.estabelecimento_id', estado.perfil.estabelecimento_id)
    .eq('comandas.status', 'fechada')
    .gte('fechado_em', inicioData.toISOString())
    .lte('fechado_em', fim)
    .order('fechado_em', { ascending: false })
    .limit(50);

  if (error) { console.error(error); grid.innerHTML = '<div class="aviso-vazio">Erro ao carregar histórico.</div>'; return; }

  estado.historico = data || [];
  renderHistorico();
}

function renderHistorico() {
  const grid = document.getElementById('grid-historico');
  document.getElementById('contador-historico').textContent =
    `${estado.historico.length} fechada${estado.historico.length !== 1 ? 's' : ''}`;

  if (estado.historico.length === 0) {
    grid.innerHTML = '<div class="aviso-vazio">Nenhuma comanda fechada nesse período.</div>';
    return;
  }

  grid.innerHTML = estado.historico.map(f => {
    const horario = new Date(f.fechado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="historico-linha">
        <div class="historico-info">
          <div class="badge">${rotuloComanda(f.comandas)}</div>
          <div class="detalhe">#${f.comandas.numero_sequencial} · ${horario}</div>
        </div>
        <div class="historico-direita">
          <span class="historico-valor">R$ ${Number(f.valor_total).toFixed(2).replace('.', ',')}</span>
          <button class="btn-ver-historico" onclick="verDetalhesHistorico('${f.id}')">👁️ Ver</button>
          <button class="btn-reimprimir" onclick="solicitarReimpressao('${f.id}')">🖨️ Reimprimir</button>
        </div>
      </div>
    `;
  }).join('');
}

// ------------------------------------------------------------
// Ver detalhes de uma comanda fechada (só consulta, não imprime nada)
// ------------------------------------------------------------
async function verDetalhesHistorico(fechamentoId) {
  const fechamento = estado.historico.find(f => f.id === fechamentoId);
  if (!fechamento) return;

  document.getElementById('modal-ver-historico-overlay').style.display = 'flex';
  document.getElementById('ver-historico-titulo').textContent = rotuloComanda(fechamento.comandas);
  document.getElementById('ver-historico-numero').textContent = `Comanda #${fechamento.comandas.numero_sequencial}`;
  document.getElementById('ver-historico-conteudo').innerHTML = '<div class="aviso-vazio-pequeno">Carregando...</div>';

  const [{ data: itens }, { data: pagamentos }] = await Promise.all([
    supabaseClient
      .from('pedido_itens')
      .select(`
        quantidade, preco_unitario_calculado, observacao,
        itens_cardapio ( nome ),
        pedido_item_ingredientes ( foi_acrescimo, ingredientes ( nome ) )
      `)
      .eq('comanda_id', fechamento.comandas.id)
      .neq('status', 'cancelado'),
    supabaseClient
      .from('pagamentos')
      .select('forma_pagamento, valor')
      .eq('fechamento_id', fechamentoId),
  ]);

  const nomesFormaPagamento = { dinheiro: 'Dinheiro', debito: 'Cartão Débito', credito: 'Cartão Crédito', pix: 'Pix' };

  const htmlItens = (itens || []).map(item => {
    const sabores = item.pedido_item_ingredientes.filter(s => !s.foi_acrescimo).map(s => escapeHtml(s.ingredientes.nome)).join(', ');
    const acrescimos = item.pedido_item_ingredientes.filter(s => s.foi_acrescimo).map(s => escapeHtml(s.ingredientes.nome)).join(', ');
    return `
      <div class="ver-historico-item">
        <div class="ver-historico-item-topo">
          <span>${item.quantidade}× ${escapeHtml(item.itens_cardapio.nome)}</span>
          <span>R$ ${(item.preco_unitario_calculado * item.quantidade).toFixed(2).replace('.', ',')}</span>
        </div>
        ${sabores ? `<div class="ver-historico-item-detalhe">${sabores}</div>` : ''}
        ${acrescimos ? `<div class="ver-historico-item-detalhe">+ ACRÉSCIMO: ${acrescimos}</div>` : ''}
        ${item.observacao ? `<div class="ver-historico-item-detalhe">OBS: ${escapeHtml(item.observacao)}</div>` : ''}
      </div>
    `;
  }).join('');

  const htmlPagamentos = (pagamentos || []).map(p => `
    <div class="ver-historico-pagamento">
      <span>${nomesFormaPagamento[p.forma_pagamento] || p.forma_pagamento}</span>
      <span>R$ ${Number(p.valor).toFixed(2).replace('.', ',')}</span>
    </div>
  `).join('');

  document.getElementById('ver-historico-conteudo').innerHTML = `
    <div class="ver-historico-secao-label">Itens</div>
    ${htmlItens || '<div class="aviso-vazio-pequeno">Nenhum item.</div>'}
    <div class="ver-historico-secao-label">Pagamento</div>
    ${htmlPagamentos || '<div class="aviso-vazio-pequeno">Nenhum pagamento registrado.</div>'}
    <div class="ver-historico-total">
      <span>TOTAL</span>
      <span>R$ ${Number(fechamento.valor_total).toFixed(2).replace('.', ',')}</span>
    </div>
  `;
}

function fecharVerHistorico() {
  document.getElementById('modal-ver-historico-overlay').style.display = 'none';
}

async function solicitarReimpressao(fechamentoId) {
  const fechamento = estado.historico.find(f => f.id === fechamentoId);
  if (!fechamento) return;

  const { error } = await supabaseClient.from('solicitacoes_impressao').insert({
    comanda_id: fechamento.comandas.id,
    fechamento_id: fechamentoId,
    tipo: 'reimpressao_fechamento',
    criado_por: estado.perfil.id,
  });

  if (error) {
    mostrarToast('Erro ao pedir reimpressão.', 'erro');
    console.error(error);
    return;
  }

  mostrarToast('Reimpressão enviada! 🖨️');
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
    return c.identificador_pessoa ? `Mesa ${c.numero_mesa} · ${escapeHtml(c.identificador_pessoa)}` : `Mesa ${c.numero_mesa}`;
  }
  if (c.tipo === 'entrega') return `Entrega · ${escapeHtml(c.nome_cliente) || ''}`;
  return escapeHtml(c.nome_cliente) || 'Balcão';
}

function tempoAberta(dataIso) {
  const minutos = Math.floor((Date.now() - new Date(dataIso).getTime()) / 60000);
  if (minutos < 1) return 'agora mesmo';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `há ${horas}h${minutos % 60 > 0 ? (minutos % 60) + 'min' : ''}`;
}

const ROTULO_ESTAGIO_ENTREGA = {
  preparando: { texto: '🟡 Preparando', classe: 'preparando' },
  saiu_entrega: { texto: '🔵 Saiu pra entrega', classe: 'saiu' },
  entregue: { texto: '🟢 Entregue', classe: 'entregue' },
};

function renderComandas() {
  const grid = document.getElementById('grid-comandas');
  const contador = document.getElementById('contador-comandas');
  contador.textContent = `${estado.comandas.length} aberta${estado.comandas.length !== 1 ? 's' : ''}`;

  if (estado.comandas.length === 0) {
    grid.innerHTML = '<div class="aviso-vazio">Nenhuma comanda aberta no momento.</div>';
    return;
  }

  grid.innerHTML = estado.comandas.map(c => {
    const ehEntrega = c.tipo === 'entrega';
    const estagio = ehEntrega ? ROTULO_ESTAGIO_ENTREGA[c.status_entrega || 'preparando'] : null;

    // Se já saiu pra entrega, clicar no card não reabre o fechamento inteiro —
    // só pede confirmação rápida de "voltou e entregou"
    const acaoClick = (ehEntrega && c.status_entrega === 'saiu_entrega')
      ? `confirmarEntregaRealizada('${c.id}')`
      : `abrirFechamento('${c.id}')`;

    return `
    <button class="ticket-card" onclick="${acaoClick}">
      <div class="ticket-row1">
        <span class="badge">${rotuloComanda(c)}</span>
        <span class="dot"></span>
      </div>
      <div class="ticket-numero">Comanda #${c.numero_sequencial}</div>
      <div class="ticket-tempo">${tempoAberta(c.aberta_em)}</div>
      ${estagio ? `<div class="estagio-entrega ${estagio.classe}">${estagio.texto}</div>` : ''}
      <div class="ticket-divisor"></div>
      <div class="ticket-total-row">
        <span class="label">parcial</span>
        <span class="valor">R$ ${Number(c.total_parcial).toFixed(2).replace('.', ',')}</span>
      </div>
    </button>
  `;
  }).join('');
}

async function confirmarEntregaRealizada(comandaId) {
  mostrarConfirmacaoGenerica(
    'O motoboy voltou e a entrega foi realizada? Isso vai fechar a conta de verdade.',
    async () => {
      const { error } = await supabaseClient
        .from('comandas')
        .update({ status_entrega: 'entregue', status: 'fechada', fechada_em: new Date().toISOString() })
        .eq('id', comandaId);

      if (error) { mostrarToast('Erro ao confirmar entrega.', 'erro'); return; }

      mostrarToast('Entrega confirmada e conta fechada!');
      await carregarComandas();
    }
  );
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
// Tela de fechamento
// ------------------------------------------------------------
async function abrirFechamento(comandaId) {
  const comanda = estado.comandas.find(c => c.id === comandaId);
  if (!comanda) return;

  const { data: itens, error } = await supabaseClient
    .from('pedido_itens')
    .select(`
      id, item_cardapio_id, quantidade, observacao, preco_unitario_calculado, status,
      itens_cardapio ( nome ),
      pedido_item_ingredientes ( ingrediente_id, foi_acrescimo, preco_acrescimo_aplicado, ingredientes ( nome ) )
    `)
    .eq('comanda_id', comandaId)
    .neq('status', 'cancelado');

  if (error) { mostrarToast('Erro ao carregar itens.', 'erro'); return; }

  // Busca outras comandas abertas na MESMA mesa (outras pessoas na mesa 04, por ex.)
  // — usado pra permitir "transferir item" quando o atendente anotou na pessoa errada
  let comandasIrmas = [];
  if (comanda.tipo === 'mesa' && comanda.numero_mesa) {
    const { data: irmas } = await supabaseClient
      .from('comandas')
      .select('id, numero_sequencial, identificador_pessoa')
      .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
      .eq('tipo', 'mesa')
      .eq('numero_mesa', comanda.numero_mesa)
      .eq('status', 'aberta')
      .neq('id', comandaId);
    comandasIrmas = irmas || [];
  }

  estado.comandaEmFechamento = { comanda, itens: itens || [], comandasIrmas };
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
  const { comanda, itens, comandasIrmas } = estado.comandaEmFechamento;
  const { subtotal, taxaValor, total } = calcularValores();

  document.getElementById('fechamento-titulo').textContent = rotuloComanda(comanda);
  document.getElementById('fechamento-codigo').textContent = `COMANDA #${comanda.numero_sequencial}`;

  const temIrmas = comandasIrmas && comandasIrmas.length > 0;

  document.getElementById('fechamento-itens').innerHTML = itens.map(item => {
    const sabores = item.pedido_item_ingredientes.map(s => escapeHtml(s.ingredientes.nome)).join(', ');
    return `
      <div class="fechamento-item-linha">
        <div>
          <div class="item-nome">${item.quantidade}× ${escapeHtml(item.itens_cardapio.nome)}</div>
          ${sabores ? `<div class="item-detalhe">${sabores}</div>` : ''}
          ${item.observacao ? `<div class="item-detalhe">${escapeHtml(item.observacao)}</div>` : ''}
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="item-valor">R$ ${(item.preco_unitario_calculado * item.quantidade).toFixed(2).replace('.', ',')}</span>
          ${temIrmas ? `<button class="btn-transferir" onclick="abrirTransferencia('${item.id}')" title="Transferir pra outra pessoa da mesa">⇄</button>` : ''}
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

  // Se for comanda de entrega ainda não despachada, o botão final não "fecha"
  // de vez — só define a forma de pagamento e avança pra "saiu pra entrega"
  const ehSaidaEntrega = comanda.tipo === 'entrega' && comanda.status_entrega !== 'entregue';
  document.getElementById('btn-fechar-conta').textContent = ehSaidaEntrega
    ? 'Confirmar saída pra entrega'
    : 'Fechar conta';

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

  mostrarConfirmacaoGenerica(
    `Remover "${item.quantidade}× ${item.itens_cardapio.nome}" da conta? Isso não vai ser cobrado.`,
    async () => {
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
  );
}

// ------------------------------------------------------------
// Transferir item pra outra pessoa da MESMA mesa
// (corrige quando o atendente anotou na comanda errada)
// ------------------------------------------------------------
let itemParaTransferirId = null;

function abrirTransferencia(itemId) {
  itemParaTransferirId = itemId;
  const item = estado.comandaEmFechamento.itens.find(i => i.id === itemId);
  const { comandasIrmas } = estado.comandaEmFechamento;

  document.getElementById('transferencia-item-nome').textContent =
    `${item.quantidade}× ${item.itens_cardapio.nome}`;

  // Se for só 1 unidade, nem mostra o seletor de quantidade (não tem o que escolher)
  const seletorQtd = document.getElementById('transferencia-qtd-container');
  if (item.quantidade > 1) {
    seletorQtd.style.display = 'block';
    document.getElementById('input-transferencia-qtd').max = item.quantidade;
    document.getElementById('input-transferencia-qtd').value = item.quantidade;
  } else {
    seletorQtd.style.display = 'none';
  }

  document.getElementById('lista-comandas-irmas').innerHTML = comandasIrmas.map(c => `
    <button class="btn-ghost btn-comanda-irma" onclick="confirmarTransferencia('${c.id}')">
      ${c.identificador_pessoa ? escapeHtml(c.identificador_pessoa) : ('Comanda #' + c.numero_sequencial)}
    </button>
  `).join('');

  document.getElementById('modal-transferencia-overlay').style.display = 'flex';
}

function fecharModalTransferencia() {
  document.getElementById('modal-transferencia-overlay').style.display = 'none';
  itemParaTransferirId = null;
}

async function confirmarTransferencia(comandaDestinoId) {
  const item = estado.comandaEmFechamento.itens.find(i => i.id === itemParaTransferirId);
  if (!item) return;

  const inputQtd = document.getElementById('input-transferencia-qtd');
  const qtdTransferir = item.quantidade > 1 ? (parseInt(inputQtd.value) || 1) : item.quantidade;

  if (qtdTransferir < 1 || qtdTransferir > item.quantidade) {
    mostrarToast('Quantidade inválida.', 'erro');
    return;
  }

  try {
    if (qtdTransferir === item.quantidade) {
      // Transfere a linha inteira — só muda de qual comanda ela pertence
      const { error } = await supabaseClient
        .from('pedido_itens')
        .update({ comanda_id: comandaDestinoId })
        .eq('id', item.id);
      if (error) throw error;

    } else {
      // Transferência PARCIAL: diminui a quantidade na linha original
      // e cria uma linha nova na comanda de destino com a quantidade transferida
      const { error: erroReduzir } = await supabaseClient
        .from('pedido_itens')
        .update({ quantidade: item.quantidade - qtdTransferir })
        .eq('id', item.id);
      if (erroReduzir) throw erroReduzir;

      const { data: novaLinha, error: erroNovaLinha } = await supabaseClient
        .from('pedido_itens')
        .insert({
          comanda_id: comandaDestinoId,
          item_cardapio_id: item.item_cardapio_id,
          quantidade: qtdTransferir,
          preco_unitario_calculado: item.preco_unitario_calculado,
          observacao: item.observacao,
          status: item.status,
          criado_por: estado.perfil.id,
        })
        .select()
        .single();
      if (erroNovaLinha) throw erroNovaLinha;

      // Copia os sabores/acréscimos da linha original pra linha nova
      if (item.pedido_item_ingredientes.length > 0) {
        const copiaSabores = item.pedido_item_ingredientes.map(s => ({
          pedido_item_id: novaLinha.id,
          ingrediente_id: s.ingrediente_id,
          foi_acrescimo: s.foi_acrescimo,
          preco_acrescimo_aplicado: s.preco_acrescimo_aplicado,
        }));
        await supabaseClient.from('pedido_item_ingredientes').insert(copiaSabores);
      }
    }

    // Atualiza a tela: remove a linha (se foi tudo) ou ajusta a quantidade (se foi parcial)
    if (qtdTransferir === item.quantidade) {
      estado.comandaEmFechamento.itens = estado.comandaEmFechamento.itens.filter(i => i.id !== item.id);
    } else {
      item.quantidade -= qtdTransferir;
    }
    renderFechamento();
    fecharModalTransferencia();
    mostrarToast('Item transferido!');

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro ao transferir item.', 'erro');
  }
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
    lista.innerHTML = estado.pagamentos.map((p, i) => {
      const mostrarTroco = p.forma === 'dinheiro';
      return `
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
      ${mostrarTroco ? `
        <div class="troco-linha">
          <label>Cliente vai pagar com quanto?</label>
          <input type="text" inputmode="decimal" placeholder="Ex: 50,00"
                 value="${p.valorRecebido ? p.valorRecebido.toString().replace('.', ',') : ''}"
                 oninput="atualizarValorRecebido(${i}, this.value)">
          <span class="troco-resultado" id="troco-resultado-${i}"></span>
        </div>
      ` : ''}
      `;
    }).join('');

    // Preenche o resultado do troco de cada linha SEM precisar redesenhar
    // (redesenhar destruía o campo e fechava o teclado do celular a cada tecla)
    estado.pagamentos.forEach((p, i) => atualizarTextoTroco(i));
  }

  renderResumoPagamento();
}

function atualizarTextoTroco(index) {
  const p = estado.pagamentos[index];
  const el = document.getElementById(`troco-resultado-${index}`);
  if (!el) return;
  if (p.forma === 'dinheiro' && p.valorRecebido) {
    const troco = round2(p.valorRecebido - p.valor);
    el.textContent = `Troco: R$ ${troco.toFixed(2).replace('.', ',')}`;
  } else {
    el.textContent = '';
  }
}

function atualizarValorRecebido(index, valor) {
  estado.pagamentos[index].valorRecebido = paraNumero(valor);
  atualizarTextoTroco(index);
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
  const ehSaidaEntrega = comanda.tipo === 'entrega' && comanda.status_entrega !== 'entregue';

  const btn = document.getElementById('btn-fechar-conta');
  btn.disabled = true;
  btn.textContent = ehSaidaEntrega ? 'Confirmando saída...' : 'Fechando...';

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
      valor_recebido: p.forma === 'dinheiro' && p.valorRecebido ? p.valorRecebido : null,
    }));

    const { error: erroPagamentos } = await supabaseClient.from('pagamentos').insert(linhasPagamento);
    if (erroPagamentos) throw erroPagamentos;

    if (ehSaidaEntrega) {
      // Não fecha de vez — só avança pro estágio "saiu pra entrega".
      // A comanda continua "aberta" até o motoboy voltar e confirmar.
      const { error: erroComanda } = await supabaseClient
        .from('comandas')
        .update({ status_entrega: 'saiu_entrega' })
        .eq('id', comanda.id);
      if (erroComanda) throw erroComanda;

      mostrarToast('Saiu pra entrega! Cupom com a forma de pagamento vai ser impresso. 🛵');
    } else {
      const { error: erroComanda } = await supabaseClient
        .from('comandas')
        .update({ status: 'fechada', fechada_em: new Date().toISOString() })
        .eq('id', comanda.id);
      if (erroComanda) throw erroComanda;

      mostrarToast('Conta fechada com sucesso! 🎉');
    }

    fecharTelaFechamento();

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro ao processar. Tente de novo.', 'erro');
    btn.disabled = false;
    btn.textContent = ehSaidaEntrega ? 'Confirmar saída pra entrega' : 'Fechar conta';
  }
}

iniciar();
