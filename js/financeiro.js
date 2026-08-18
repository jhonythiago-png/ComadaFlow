// ============================================================
// ComandaFlow — Painel Financeiro (Master)
// ============================================================

const estado = {
  perfil: null,
  periodoAtivo: 'hoje',
  dataInicio: null,
  dataFim: null,
  despesas: [],
};

const NOMES_CATEGORIA = {
  fornecedor: 'Fornecedor', aluguel: 'Aluguel', funcionario: 'Funcionário',
  insumo: 'Insumo', energia: 'Energia', agua: 'Água', internet: 'Internet',
  manutencao: 'Manutenção', outro: 'Outro',
};
const NOMES_PAGAMENTO = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix' };

// ------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------
async function iniciar() {
  estado.perfil = await verificarAutenticacao();
  if (!estado.perfil) return;

  if (estado.perfil.nivel_acesso !== 'master') {
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

  document.getElementById('nome-usuario').textContent = estado.perfil.nome;
  selecionarPeriodo('hoje');
  await carregarDespesas();
}

// ------------------------------------------------------------
// Período
// ------------------------------------------------------------
function selecionarPeriodo(preset) {
  estado.periodoAtivo = preset;
  const hoje = new Date();
  const fim = formatarDataISO(hoje);
  let inicio;

  if (preset === 'hoje') {
    inicio = fim;
  } else if (preset === 'semana') {
    const d = new Date(hoje);
    d.setDate(d.getDate() - 6);
    inicio = formatarDataISO(d);
  } else if (preset === 'mes') {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    inicio = formatarDataISO(d);
  } else {
    return; // 'personalizado' é tratado por atualizarPeriodoPersonalizado()
  }

  estado.dataInicio = inicio;
  estado.dataFim = fim;

  document.querySelectorAll('.periodo-chip').forEach(el => el.classList.remove('on'));
  document.getElementById(`chip-${preset}`)?.classList.add('on');
  document.getElementById('periodo-personalizado').style.display = 'none';

  carregarRelatorios();
}

function mostrarPeriodoPersonalizado() {
  document.querySelectorAll('.periodo-chip').forEach(el => el.classList.remove('on'));
  document.getElementById('chip-personalizado').classList.add('on');
  document.getElementById('periodo-personalizado').style.display = 'flex';
}

function atualizarPeriodoPersonalizado() {
  const inicio = document.getElementById('input-data-inicio').value;
  const fim = document.getElementById('input-data-fim').value;
  if (!inicio || !fim) return;
  estado.dataInicio = inicio;
  estado.dataFim = fim;
  carregarRelatorios();
}

function formatarDataISO(data) {
  return data.toISOString().slice(0, 10);
}

function formatarDataBR(dataISO) {
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

// ------------------------------------------------------------
// Relatórios
// ------------------------------------------------------------
async function carregarRelatorios() {
  await Promise.all([
    carregarResumoReceitaDespesa(),
    carregarPagamentosPorForma(),
    carregarProdutosMaisVendidos(),
  ]);
}

async function carregarResumoReceitaDespesa() {
  const { data: receitaDias } = await supabaseClient
    .from('receita_diaria')
    .select('receita_total, qtd_comandas')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .gte('data', estado.dataInicio)
    .lte('data', estado.dataFim);

  const receitaTotal = (receitaDias || []).reduce((s, r) => s + Number(r.receita_total), 0);
  const qtdComandas = (receitaDias || []).reduce((s, r) => s + Number(r.qtd_comandas), 0);

  const { data: despesasPagas } = await supabaseClient
    .from('despesas')
    .select('valor')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .eq('status', 'pago')
    .gte('data_pagamento', estado.dataInicio)
    .lte('data_pagamento', estado.dataFim);

  const despesasTotal = (despesasPagas || []).reduce((s, d) => s + Number(d.valor), 0);
  const saldo = receitaTotal - despesasTotal;

  document.getElementById('card-receita').textContent = formatarMoeda(receitaTotal);
  document.getElementById('card-despesas').textContent = formatarMoeda(despesasTotal);
  document.getElementById('card-saldo').textContent = formatarMoeda(saldo);
  document.getElementById('card-saldo').className = 'card-valor ' + (saldo >= 0 ? 'positivo' : 'negativo');
  document.getElementById('card-comandas').textContent = qtdComandas;
}

async function carregarPagamentosPorForma() {
  const { data } = await supabaseClient
    .from('pagamentos_por_dia')
    .select('forma_pagamento, valor_total')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .gte('data', estado.dataInicio)
    .lte('data', estado.dataFim);

  const totais = {};
  for (const linha of data || []) {
    totais[linha.forma_pagamento] = (totais[linha.forma_pagamento] || 0) + Number(linha.valor_total);
  }

  const container = document.getElementById('lista-pagamentos-forma');
  const formas = Object.keys(totais);

  if (formas.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhum pagamento no período.</div>';
    return;
  }

  const somaTotal = formas.reduce((s, f) => s + totais[f], 0);

  container.innerHTML = formas
    .sort((a, b) => totais[b] - totais[a])
    .map(forma => {
      const valor = totais[forma];
      const pct = somaTotal > 0 ? Math.round((valor / somaTotal) * 100) : 0;
      return `
        <div class="forma-linha">
          <div class="forma-topo">
            <span>${NOMES_PAGAMENTO[forma] || forma}</span>
            <span>${formatarMoeda(valor)}</span>
          </div>
          <div class="forma-barra-fundo"><div class="forma-barra" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('');
}

async function carregarProdutosMaisVendidos() {
  const { data } = await supabaseClient
    .from('produtos_mais_vendidos')
    .select('item_nome, quantidade_total, receita_total')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .gte('data', estado.dataInicio)
    .lte('data', estado.dataFim);

  const totais = {};
  for (const linha of data || []) {
    if (!totais[linha.item_nome]) totais[linha.item_nome] = { quantidade: 0, receita: 0 };
    totais[linha.item_nome].quantidade += Number(linha.quantidade_total);
    totais[linha.item_nome].receita += Number(linha.receita_total);
  }

  const ranking = Object.entries(totais)
    .sort((a, b) => b[1].quantidade - a[1].quantidade)
    .slice(0, 10);

  const container = document.getElementById('lista-produtos-vendidos');

  if (ranking.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhuma venda no período.</div>';
    return;
  }

  container.innerHTML = ranking.map(([nome, dados], i) => `
    <div class="produto-linha">
      <span class="produto-posicao">${i + 1}º</span>
      <span class="produto-nome">${nome}</span>
      <span class="produto-qtd">${dados.quantidade}x</span>
      <span class="produto-receita">${formatarMoeda(dados.receita)}</span>
    </div>
  `).join('');
}

function formatarMoeda(valor) {
  return `R$ ${Number(valor).toFixed(2).replace('.', ',')}`;
}

// ------------------------------------------------------------
// Despesas
// ------------------------------------------------------------
async function carregarDespesas() {
  const { data, error } = await supabaseClient
    .from('despesas')
    .select('*')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('data_vencimento', { ascending: false });

  if (error) { console.error(error); return; }

  estado.despesas = data || [];
  renderDespesas();
}

function renderDespesas() {
  const container = document.getElementById('lista-despesas');

  if (estado.despesas.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhuma despesa cadastrada.</div>';
    return;
  }

  container.innerHTML = estado.despesas.map(d => `
    <div class="despesa-linha">
      <div>
        <div class="despesa-descricao">${d.descricao}</div>
        <div class="despesa-detalhe">${NOMES_CATEGORIA[d.categoria]} · vence ${formatarDataBR(d.data_vencimento)}</div>
      </div>
      <div class="despesa-direita">
        <span class="despesa-valor">${formatarMoeda(d.valor)}</span>
        <span class="despesa-status ${d.status}">${d.status === 'pago' ? 'Pago' : 'Pendente'}</span>
        ${d.status === 'pendente' ? `<button class="btn-marcar-pago" onclick="marcarComoPago('${d.id}')">Marcar como pago</button>` : ''}
      </div>
    </div>
  `).join('');
}

async function marcarComoPago(despesaId) {
  const { error } = await supabaseClient
    .from('despesas')
    .update({ status: 'pago', data_pagamento: formatarDataISO(new Date()) })
    .eq('id', despesaId);

  if (error) { mostrarToast('Erro ao marcar como pago.', 'erro'); return; }

  mostrarToast('Despesa marcada como paga!');
  await carregarDespesas();
  carregarRelatorios();
}

function abrirModalDespesa() {
  document.getElementById('modal-despesa-overlay').style.display = 'flex';
  document.getElementById('input-despesa-descricao').value = '';
  document.getElementById('input-despesa-valor').value = '';
  document.getElementById('input-despesa-vencimento').value = formatarDataISO(new Date());
  document.getElementById('input-despesa-categoria').value = 'outro';
  document.getElementById('input-despesa-ja-pago').checked = false;
}

function fecharModalDespesa() {
  document.getElementById('modal-despesa-overlay').style.display = 'none';
}

async function salvarDespesa() {
  const descricao = document.getElementById('input-despesa-descricao').value.trim();
  const categoria = document.getElementById('input-despesa-categoria').value;
  const valorTexto = document.getElementById('input-despesa-valor').value;
  const vencimento = document.getElementById('input-despesa-vencimento').value;
  const jaPago = document.getElementById('input-despesa-ja-pago').checked;

  const valor = parseFloat(valorTexto.replace(',', '.'));

  if (!descricao || !valor || valor <= 0 || !vencimento) {
    mostrarToast('Preenche descrição, valor e vencimento.', 'erro');
    return;
  }

  const { error } = await supabaseClient.from('despesas').insert({
    estabelecimento_id: estado.perfil.estabelecimento_id,
    descricao,
    categoria,
    valor,
    data_vencimento: vencimento,
    status: jaPago ? 'pago' : 'pendente',
    data_pagamento: jaPago ? formatarDataISO(new Date()) : null,
    criado_por: estado.perfil.id,
  });

  if (error) {
    mostrarToast('Erro ao salvar despesa.', 'erro');
    console.error(error);
    return;
  }

  mostrarToast('Despesa cadastrada!');
  fecharModalDespesa();
  await carregarDespesas();
  carregarRelatorios();
}

iniciar();
