(() => {
  'use strict';

  const APP_VERSION = '3.1.0';
  const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const VIEW_META = {
    dashboard: ['Resumen financiero', 'Todo lo importante de Kianna y Jorge en un solo lugar.'],
    movements: ['Movimientos', 'Consulta, filtra, corrige o elimina cualquier registro.'],
    add: ['Registrar movimiento', 'Ingresos, gastos y transferencias con reglas inteligentes.'],
    savings: ['Ahorro y metas', 'Protege el ahorro y avanza hacia objetivos concretos.'],
    weekly: ['Cierre semanal', 'Analiza la semana y decide qué hacer con el sobrante.'],
    reports: ['Reportes', 'Convierte los movimientos en información útil.'],
    settings: ['Configuración', 'Porcentajes, seguridad local, respaldo y preferencias.']
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const round2 = (number) => Math.round((Number(number) + Number.EPSILON) * 100) / 100;
  const clamp = (number, min, max) => Math.min(max, Math.max(min, number));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const todayString = () => new Date().toISOString().slice(0, 10);
  const parseDate = (value) => new Date(`${value}T12:00:00`);
  const isoDate = (date) => new Date(date).toISOString().slice(0, 10);
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

  const defaultState = () => ({
    version: APP_VERSION,
    settings: {
      theme: 'system',
      currency: 'USD',
      profiles: {
        kianna: {
          name: 'Kianna',
          payCycle: 'weekly',
          closingDay: 0,
          emergencyFund: 0,
          categories: [
            { id: 'savings', name: 'Ahorro', percent: 60, color: '#0b5cff', protected: true },
            { id: 'expenses', name: 'Gastos', percent: 20, color: '#ef4444', protected: false },
            { id: 'weekly_consumption', name: 'Consumo semanal', percent: 20, color: '#7c3aed', protected: false }
          ]
        },
        jorge: {
          name: 'Jorge',
          payCycle: 'daily',
          closingDay: 0,
          emergencyFund: 0,
          categories: [
            { id: 'gasoline', name: 'Gasolina', percent: 20, color: '#f59e0b', protected: false },
            { id: 'weekly_expenses', name: 'Gastos semanales', percent: 50, color: '#ef4444', protected: false },
            { id: 'savings', name: 'Ahorro', percent: 30, color: '#0b5cff', protected: true }
          ]
        }
      }
    },
    transactions: [],
    goals: [],
    closures: [],
    audit: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  let state = defaultState();
  let currentView = 'dashboard';
  let modalResolver = null;

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    const result = {
      ...base,
      ...raw,
      settings: {
        ...base.settings,
        ...(raw.settings || {}),
        profiles: {
          kianna: { ...base.settings.profiles.kianna, ...(raw.settings?.profiles?.kianna || {}) },
          jorge: { ...base.settings.profiles.jorge, ...(raw.settings?.profiles?.jorge || {}) }
        }
      },
      transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
      goals: Array.isArray(raw.goals) ? raw.goals : [],
      closures: Array.isArray(raw.closures) ? raw.closures : [],
      audit: Array.isArray(raw.audit) ? raw.audit : []
    };
    result.settings.profiles.kianna.categories = Array.isArray(raw.settings?.profiles?.kianna?.categories)
      ? raw.settings.profiles.kianna.categories : base.settings.profiles.kianna.categories;
    result.settings.profiles.jorge.categories = Array.isArray(raw.settings?.profiles?.jorge?.categories)
      ? raw.settings.profiles.jorge.categories : base.settings.profiles.jorge.categories;
    return result;
  }

  async function persist() {
    state.updatedAt = new Date().toISOString();
    const ok = await window.DinexStorage.save(state);
    if (!ok) toast('No se pudo guardar', 'El navegador rechazó el almacenamiento local.', 'danger');
  }

  function audit(action, detail) {
    state.audit.unshift({ id: uid(), action, detail, at: new Date().toISOString() });
    state.audit = state.audit.slice(0, 500);
  }

  function profile(person) {
    return state.settings.profiles[person];
  }

  function categories(person) {
    return profile(person).categories;
  }

  function category(person, categoryId) {
    return categories(person).find((item) => item.id === categoryId);
  }

  function savingsCategory(person) {
    return categories(person).find((item) => item.protected || item.id === 'savings');
  }

  function formatMoney(value, options = {}) {
    const amount = Number(value) || 0;
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: state.settings.currency || 'USD',
      minimumFractionDigits: 2, maximumFractionDigits: 2,
      signDisplay: options.sign ? 'always' : 'auto'
    }).format(amount);
  }

  function formatDate(value, withTime = false) {
    if (!value) return 'Sin fecha';
    const date = value.length === 10 ? parseDate(value) : new Date(value);
    return new Intl.DateTimeFormat('es-PA', withTime
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  }

  function allocateAmount(person, amount) {
    const list = categories(person);
    const cents = Math.round(Number(amount) * 100);
    let used = 0;
    const allocations = {};
    list.forEach((item, index) => {
      const value = index === list.length - 1 ? cents - used : Math.round(cents * (Number(item.percent) / 100));
      allocations[item.id] = value / 100;
      used += value;
    });
    return allocations;
  }

  function getBalances(person, transactionList = state.transactions) {
    const balances = Object.fromEntries(categories(person).map((item) => [item.id, 0]));
    transactionList.filter((tx) => tx.person === person).forEach((tx) => {
      if (tx.type === 'income') {
        Object.entries(tx.allocations || {}).forEach(([categoryId, amount]) => {
          balances[categoryId] = round2((balances[categoryId] || 0) + Number(amount || 0));
        });
      } else if (tx.type === 'expense') {
        balances[tx.categoryId] = round2((balances[tx.categoryId] || 0) - Number(tx.amount || 0));
      } else if (tx.type === 'transfer') {
        balances[tx.fromCategoryId] = round2((balances[tx.fromCategoryId] || 0) - Number(tx.amount || 0));
        balances[tx.toCategoryId] = round2((balances[tx.toCategoryId] || 0) + Number(tx.amount || 0));
      } else if (tx.type === 'goal_contribution') {
        balances[tx.fromCategoryId] = round2((balances[tx.fromCategoryId] || 0) - Number(tx.amount || 0));
      } else if (tx.type === 'goal_withdrawal') {
        balances[tx.toCategoryId] = round2((balances[tx.toCategoryId] || 0) + Number(tx.amount || 0));
      } else if (tx.type === 'emergency_contribution') {
        balances[tx.fromCategoryId] = round2((balances[tx.fromCategoryId] || 0) - Number(tx.amount || 0));
      } else if (tx.type === 'emergency_withdrawal') {
        balances[tx.toCategoryId] = round2((balances[tx.toCategoryId] || 0) + Number(tx.amount || 0));
      }
    });
    return balances;
  }

  function getGoalAmount(goalId, transactionList = state.transactions) {
    return round2(transactionList.reduce((sum, tx) => {
      if (tx.goalId !== goalId) return sum;
      if (tx.type === 'goal_contribution') return sum + Number(tx.amount || 0);
      if (tx.type === 'goal_withdrawal') return sum - Number(tx.amount || 0);
      return sum;
    }, 0));
  }

  function getAllGoalsTotal(transactionList = state.transactions) {
    return round2(state.goals.reduce((sum, goal) => sum + getGoalAmount(goal.id, transactionList), 0));
  }

  function getEmergencyBalance(person, transactionList = state.transactions) {
    return round2(transactionList.reduce((sum, tx) => {
      if (tx.person !== person) return sum;
      if (tx.type === 'emergency_contribution') return sum + Number(tx.amount || 0);
      if (tx.type === 'emergency_withdrawal') return sum - Number(tx.amount || 0);
      return sum;
    }, 0));
  }

  function getAllEmergencyTotal(transactionList = state.transactions) {
    return round2(['kianna', 'jorge'].reduce((sum, person) => sum + getEmergencyBalance(person, transactionList), 0));
  }

  function totalByType(type, person = 'all', transactionList = state.transactions) {
    return round2(transactionList.reduce((sum, tx) => {
      if (tx.type !== type || (person !== 'all' && tx.person !== person)) return sum;
      return sum + Number(tx.amount || 0);
    }, 0));
  }

  function totalDebt(person = 'all') {
    const people = person === 'all' ? ['kianna', 'jorge'] : [person];
    return round2(people.reduce((sum, current) => sum + Object.values(getBalances(current)).reduce((sub, value) => sub + (value < 0 ? Math.abs(value) : 0), 0), 0));
  }

  function totalCurrentMoney() {
    const categoryMoney = ['kianna', 'jorge'].reduce((sum, person) => sum + Object.values(getBalances(person)).reduce((a, b) => a + b, 0), 0);
    return round2(categoryMoney + getAllGoalsTotal() + getAllEmergencyTotal());
  }

  function currentSavings(person) {
    const savings = savingsCategory(person);
    return savings ? Number(getBalances(person)[savings.id] || 0) : 0;
  }

  function transactionLabel(tx) {
    const labels = {
      income: 'Ingreso', expense: 'Gasto', transfer: 'Transferencia',
      goal_contribution: 'Aporte a meta', goal_withdrawal: 'Retiro de meta',
      emergency_contribution: 'Aporte a emergencia', emergency_withdrawal: 'Retiro de emergencia'
    };
    return labels[tx.type] || tx.type;
  }

  function transactionDescription(tx) {
    if (tx.description) return tx.description;
    if (tx.type === 'income') return 'Ingreso registrado';
    if (tx.type === 'expense') return category(tx.person, tx.categoryId)?.name || 'Gasto';
    if (tx.type === 'transfer') return `${category(tx.person, tx.fromCategoryId)?.name || 'Categoría'} → ${category(tx.person, tx.toCategoryId)?.name || 'Categoría'}`;
    if (tx.type === 'emergency_contribution') return tx.description || 'Aporte al fondo de emergencia';
    if (tx.type === 'emergency_withdrawal') return tx.description || 'Retiro del fondo de emergencia';
    const goal = state.goals.find((item) => item.id === tx.goalId);
    return goal?.name || 'Meta de ahorro';
  }

  function categoryText(tx) {
    if (tx.type === 'income') return 'Distribución automática';
    if (tx.type === 'expense') return category(tx.person, tx.categoryId)?.name || 'Categoría eliminada';
    if (tx.type === 'transfer') return `${category(tx.person, tx.fromCategoryId)?.name || '?'} → ${category(tx.person, tx.toCategoryId)?.name || '?'}`;
    if (tx.type === 'goal_contribution') return `Hacia: ${state.goals.find((goal) => goal.id === tx.goalId)?.name || 'Meta'}`;
    if (tx.type === 'goal_withdrawal') return `Desde: ${state.goals.find((goal) => goal.id === tx.goalId)?.name || 'Meta'}`;
    if (tx.type === 'emergency_contribution') return `${category(tx.person, tx.fromCategoryId)?.name || 'Ahorro'} → Fondo de emergencia`;
    if (tx.type === 'emergency_withdrawal') return `Fondo de emergencia → ${category(tx.person, tx.toCategoryId)?.name || 'Categoría'}`;
    return '—';
  }

  function addTransaction(transaction, auditText) {
    state.transactions.unshift({ id: uid(), createdAt: new Date().toISOString(), ...transaction });
    audit('transaction_created', auditText || `${transactionLabel(transaction)} de ${formatMoney(transaction.amount)}`);
  }

  function getDateRange(days) {
    if (days === 'all') return { from: null, to: null };
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    const from = new Date();
    from.setDate(from.getDate() - Number(days) + 1);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }

  function filterByRange(list, range, person = 'all') {
    const { from, to } = getDateRange(range);
    return list.filter((item) => {
      const date = parseDate(item.date || item.createdAt.slice(0, 10));
      return (person === 'all' || item.person === person) && (!from || date >= from) && (!to || date <= to);
    });
  }

  function currentCycle(person, referenceValue = todayString()) {
    const closeDay = Number(profile(person).closingDay ?? 0);
    const reference = parseDate(referenceValue);
    const end = new Date(reference);
    const daysAhead = (closeDay - reference.getDay() + 7) % 7;
    end.setDate(end.getDate() + daysAhead);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return { start: isoDate(start), end: isoDate(end) };
  }

  function transactionsInPeriod(person, start, end) {
    return state.transactions.filter((tx) => tx.person === person && tx.date >= start && tx.date <= end);
  }

  function periodSummary(person, start, end) {
    const list = transactionsInPeriod(person, start, end);
    const incomes = totalByType('income', person, list);
    const expenses = totalByType('expense', person, list);
    const transfers = totalByType('transfer', person, list);
    const savings = round2(list.filter((tx) => tx.type === 'income').reduce((sum, tx) => {
      const savings = savingsCategory(person);
      return sum + Number(tx.allocations?.[savings?.id] || 0);
    }, 0));
    return { list, incomes, expenses, transfers, savings, net: round2(incomes - expenses) };
  }

  function metricCard(label, value, sub, icon, accent = '#0b5cff', negative = false) {
    return `<article class="metric-card ${negative ? 'negative' : ''}" style="--accent:${accent}">
      <div class="metric-top"><span class="label">${escapeHtml(label)}</span><div class="metric-icon">${icon}</div></div>
      <strong class="value">${value}</strong><div class="sub">${escapeHtml(sub)}</div>
    </article>`;
  }

  function renderDashboard() {
    const total = totalCurrentMoney();
    const incomes = totalByType('income');
    const expenses = totalByType('expense');
    const savings = round2(currentSavings('kianna') + currentSavings('jorge') + getAllGoalsTotal() + getAllEmergencyTotal());
    const debt = totalDebt();
    $('#dashboardMetrics').innerHTML = [
      metricCard('Patrimonio registrado', formatMoney(total), debt ? `Incluye ${formatMoney(debt)} en saldos negativos` : 'Sin deuda registrada', '◆', '#0b5cff', total < 0),
      metricCard('Ingresos acumulados', formatMoney(incomes), `${state.transactions.filter((tx) => tx.type === 'income').length} ingresos registrados`, '＋', '#0f9d68'),
      metricCard('Gastos acumulados', formatMoney(expenses), `${state.transactions.filter((tx) => tx.type === 'expense').length} gastos registrados`, '−', '#e53935'),
      metricCard('Ahorro protegido', formatMoney(savings), `${state.goals.length} metas + ${formatMoney(getAllEmergencyTotal())} en emergencia`, '◎', '#7c3aed', savings < 0)
    ].join('');

    $('#profileCards').innerHTML = ['kianna', 'jorge'].map((person) => {
      const p = profile(person);
      const balances = getBalances(person);
      const totalProfile = round2(Object.values(balances).reduce((a, b) => a + b, 0));
      return `<article class="profile-card ${person}">
        <div class="profile-head">
          <div class="profile-name"><div class="profile-avatar">${p.name.slice(0, 1)}</div><div><h3>${p.name}</h3><span>${p.payCycle === 'weekly' ? 'Pago semanal' : 'Pago diario'}</span></div></div>
          <span class="profile-badge">${p.payCycle === 'weekly' ? 'SEMANA' : 'DÍA'}</span>
        </div>
        <div class="profile-total"><small>Saldo disponible en categorías</small><strong>${formatMoney(totalProfile)}</strong></div>
        <div class="profile-mini-grid">${p.categories.map((cat) => `<div class="profile-mini"><span>${escapeHtml(cat.name)} · ${cat.percent}%</span><strong>${formatMoney(balances[cat.id] || 0)}</strong></div>`).join('')}</div>
      </article>`;
    }).join('');

    renderCategoryBalances();
    renderSpendingChart();
    renderRecentMovements();
    renderAlerts();
  }

  function renderCategoryBalances() {
    const person = $('#categoryProfileSelect').value || 'kianna';
    const balances = getBalances(person);
    const max = Math.max(1, ...Object.values(balances).map((value) => Math.abs(value)));
    $('#categoryBalances').innerHTML = categories(person).map((cat) => {
      const value = Number(balances[cat.id] || 0);
      const width = value < 0 ? 100 : clamp((value / max) * 100, 2, 100);
      return `<div class="category-item" style="--cat:${cat.color}">
        <div class="category-row"><div class="category-name"><i class="category-dot"></i><div><strong>${escapeHtml(cat.name)}</strong><span>${cat.percent}% de cada ingreso</span></div></div><span class="category-value ${value < 0 ? 'negative' : ''}">${formatMoney(value)}</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${width}%;${value < 0 ? 'background:var(--danger)' : ''}"></div></div>
      </div>`;
    }).join('');
  }

  function spendingByCategory(transactionList, person = 'all') {
    const map = new Map();
    transactionList.filter((tx) => tx.type === 'expense' && (person === 'all' || tx.person === person)).forEach((tx) => {
      const cat = category(tx.person, tx.categoryId);
      const key = `${tx.person}:${tx.categoryId}`;
      if (!map.has(key)) map.set(key, { label: `${cat?.name || 'Categoría'} · ${profile(tx.person).name}`, value: 0, color: cat?.color || '#94a3b8' });
      map.get(key).value += Number(tx.amount || 0);
    });
    return [...map.values()].sort((a, b) => b.value - a.value);
  }

  function prepareCanvas(canvas, height = 300) {
    if (!canvas) return null;
    const width = Math.max(280, canvas.parentElement?.clientWidth || 520);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawDonut(canvas, data, centerTitle = 'Total') {
    const prepared = prepareCanvas(canvas, 260);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);
    const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
    if (!total) {
      ctx.fillStyle = cssVar('--muted');
      ctx.font = '600 13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Aún no hay datos para este gráfico', width / 2, height / 2);
      return;
    }
    const cx = width / 2;
    const cy = height / 2 - 4;
    const radius = Math.min(width, height) * .31;
    const lineWidth = radius * .38;
    let start = -Math.PI / 2;
    data.forEach((item) => {
      const angle = (item.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.strokeStyle = item.color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'butt';
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.stroke();
      start += angle;
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = cssVar('--muted');
    ctx.font = '700 11px system-ui';
    ctx.fillText(centerTitle, cx, cy - 7);
    ctx.fillStyle = cssVar('--text');
    ctx.font = '900 20px system-ui';
    ctx.fillText(formatMoney(total), cx, cy + 18);
  }

  function renderLegend(element, data) {
    element.innerHTML = data.map((item) => `<span class="legend-item" style="--legend:${item.color}"><i></i>${escapeHtml(item.label)} · ${formatMoney(item.value)}</span>`).join('');
  }

  function renderSpendingChart() {
    const data = spendingByCategory(filterByRange(state.transactions, 30));
    drawDonut($('#spendingChart'), data, 'Gastado');
    renderLegend($('#spendingLegend'), data.slice(0, 6));
  }

  function renderRecentMovements() {
    const list = state.transactions.slice().sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`)).slice(0, 6);
    $('#recentMovements').innerHTML = list.length ? list.map((tx) => activityHtml(tx)).join('') : `<div class="empty-state"><div class="empty-icon">↕</div><h3>Sin movimientos</h3><p>Registra el primer ingreso o gasto para comenzar.</p></div>`;
  }

  function activityHtml(tx) {
    const positiveTypes = ['income', 'goal_withdrawal', 'emergency_withdrawal'];
    const negativeTypes = ['expense', 'goal_contribution', 'emergency_contribution'];
    const positive = positiveTypes.includes(tx.type);
    const negative = negativeTypes.includes(tx.type);
    const sign = negative ? '-' : positive ? '+' : '';
    const icon = tx.type === 'income' ? '＋' : tx.type === 'expense' ? '−' : tx.type.startsWith('emergency_') ? '◆' : '↔';
    return `<div class="activity-item">
      <div class="activity-icon ${tx.type}">${icon}</div>
      <div class="activity-main"><strong>${escapeHtml(transactionDescription(tx))}</strong><span>${profile(tx.person).name} · ${formatDate(tx.date)} · ${transactionLabel(tx)}</span></div>
      <span class="activity-amount ${positive ? 'positive' : negative ? 'negative' : ''}">${sign}${formatMoney(tx.amount)}</span>
    </div>`;
  }

  function buildAlerts() {
    const alerts = [];
    ['kianna', 'jorge'].forEach((person) => {
      const balances = getBalances(person);
      categories(person).forEach((cat) => {
        const value = Number(balances[cat.id] || 0);
        if (value < 0) alerts.push({ type: 'danger', symbol: '!', title: `${profile(person).name}: ${cat.name} está en negativo`, text: `Faltan ${formatMoney(Math.abs(value))} para volver a cero.` });
      });
      const reserveTarget = Number(profile(person).emergencyFund || 0);
      const reserveBalance = getEmergencyBalance(person);
      if (reserveTarget > 0 && reserveBalance < reserveTarget) alerts.push({ type: 'warning', symbol: '⚠', title: `${profile(person).name}: fondo de emergencia incompleto`, text: `Hay ${formatMoney(reserveBalance)} de una meta protegida de ${formatMoney(reserveTarget)}. Faltan ${formatMoney(Math.max(0, reserveTarget - reserveBalance))}.` });
      if (reserveTarget > 0 && reserveBalance >= reserveTarget) alerts.push({ type: 'success', symbol: '✓', title: `${profile(person).name}: fondo de emergencia completo`, text: `La reserva protegida alcanzó ${formatMoney(reserveBalance)}.` });
    });
    state.goals.forEach((goal) => {
      const current = getGoalAmount(goal.id);
      if (goal.target > 0 && current >= goal.target) alerts.push({ type: 'success', symbol: '✓', title: `Meta completada: ${goal.name}`, text: `Alcanzaron ${formatMoney(current)} de ${formatMoney(goal.target)}.` });
    });
    if (!alerts.length) alerts.push({ type: 'success', symbol: '✓', title: 'Todo se ve en orden', text: state.transactions.length ? 'No hay saldos negativos ni alertas críticas.' : 'Empieza registrando un ingreso o gasto.' });
    return alerts.slice(0, 6);
  }

  function renderAlerts() {
    $('#alertsList').innerHTML = buildAlerts().map((alert) => `<div class="alert-item ${alert.type}"><div class="alert-symbol">${alert.symbol}</div><div><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.text)}</span></div></div>`).join('');
  }

  function filteredMovements() {
    const search = $('#movementSearch').value.trim().toLowerCase();
    const person = $('#movementPersonFilter').value;
    const type = $('#movementTypeFilter').value;
    const from = $('#movementDateFrom').value;
    const to = $('#movementDateTo').value;
    return state.transactions.slice().filter((tx) => {
      const haystack = `${transactionDescription(tx)} ${categoryText(tx)} ${tx.method || ''} ${tx.merchant || ''} ${tx.note || ''}`.toLowerCase();
      return (!search || haystack.includes(search)) && (person === 'all' || tx.person === person) && (type === 'all' || tx.type === type) && (!from || tx.date >= from) && (!to || tx.date <= to);
    }).sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  }

  function renderMovements() {
    const list = filteredMovements();
    $('#movementsTableBody').innerHTML = list.map((tx) => {
      const amountClass = ['expense', 'goal_contribution', 'emergency_contribution'].includes(tx.type) ? 'negative' : ['income', 'goal_withdrawal', 'emergency_withdrawal'].includes(tx.type) ? 'positive' : '';
      const sign = amountClass === 'negative' ? '-' : amountClass === 'positive' ? '+' : '';
      return `<tr>
        <td>${formatDate(tx.date)}</td>
        <td><span class="table-person"><i style="background:${tx.person === 'kianna' ? '#7c3aed' : '#0b5cff'}"></i>${profile(tx.person).name}</span></td>
        <td><strong>${escapeHtml(transactionDescription(tx))}</strong><div class="movement-subline"><span class="type-pill ${tx.type}">${transactionLabel(tx)}</span>${tx.merchant || tx.note ? `<span>${escapeHtml(tx.merchant || tx.note)}</span>` : ''}</div></td>
        <td>${escapeHtml(categoryText(tx))}</td>
        <td>${escapeHtml(tx.method || '—')}</td>
        <td><strong class="activity-amount ${amountClass}">${sign}${formatMoney(tx.amount)}</strong></td>
        <td><div class="table-actions"><button class="mini-btn" data-action="edit-tx" data-id="${tx.id}" title="Editar">✎</button><button class="mini-btn" data-action="delete-tx" data-id="${tx.id}" title="Eliminar">⌫</button></div></td>
      </tr>`;
    }).join('');
    $('#movementsMobileList').innerHTML = list.map((tx) => {
      const negative = ['expense', 'goal_contribution', 'emergency_contribution'].includes(tx.type);
      const positive = ['income', 'goal_withdrawal', 'emergency_withdrawal'].includes(tx.type);
      return `<div class="mobile-movement-card">
        <div class="mobile-movement-top"><div><h4>${escapeHtml(transactionDescription(tx))}</h4><p>${profile(tx.person).name} · ${formatDate(tx.date)} · ${escapeHtml(categoryText(tx))}</p></div><span class="type-pill ${tx.type}">${transactionLabel(tx)}</span></div>
        <div class="mobile-movement-bottom"><strong class="activity-amount ${negative ? 'negative' : positive ? 'positive' : ''}">${negative ? '-' : positive ? '+' : ''}${formatMoney(tx.amount)}</strong><div class="table-actions"><button class="mini-btn" data-action="edit-tx" data-id="${tx.id}">✎</button><button class="mini-btn" data-action="delete-tx" data-id="${tx.id}">⌫</button></div></div>
      </div>`;
    }).join('');
    $('#movementEmpty').classList.toggle('hidden', list.length > 0);
  }

  function populateCategorySelect(select, person, selected = '') {
    select.innerHTML = categories(person).map((cat) => `<option value="${cat.id}" ${selected === cat.id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`).join('');
  }

  function updateAllCategorySelects() {
    populateCategorySelect($('#expenseCategory'), $('#expensePerson').value);
    populateCategorySelect($('#transferFrom'), $('#transferPerson').value);
    populateCategorySelect($('#transferTo'), $('#transferPerson').value, categories($('#transferPerson').value)[1]?.id);
    updateExpenseHint();
    updateTransferHint();
  }

  function updateIncomePreview() {
    const person = $('#incomePerson').value;
    const amount = Number($('#incomeAmount').value || 0);
    const allocation = allocateAmount(person, amount);
    $('#incomeAllocationPreview').innerHTML = categories(person).map((cat) => `<div class="allocation-box"><span>${escapeHtml(cat.name)}</span><strong>${formatMoney(allocation[cat.id] || 0)}</strong><small>${cat.percent}%</small></div>`).join('');
  }

  function updateExpenseHint() {
    const person = $('#expensePerson').value;
    const categoryId = $('#expenseCategory').value;
    const cat = category(person, categoryId);
    const balance = getBalances(person)[categoryId] || 0;
    $('#expenseBalanceHint').innerHTML = `Saldo actual en <strong>${escapeHtml(cat?.name || 'categoría')}</strong>: <strong style="color:${balance < 0 ? 'var(--danger)' : 'var(--text)'}">${formatMoney(balance)}</strong>. Los gastos sin saldo están permitidos, pero quedarán marcados en negativo.`;
  }

  function updateTransferHint() {
    const person = $('#transferPerson').value;
    const fromId = $('#transferFrom').value;
    const balance = getBalances(person)[fromId] || 0;
    $('#transferBalanceHint').innerHTML = `Disponible en la categoría de origen: <strong style="color:${balance < 0 ? 'var(--danger)' : 'var(--text)'}">${formatMoney(balance)}</strong>. Una transferencia no cuenta como ingreso ni gasto.`;
  }

  function switchAddForm(form) {
    $$('.action-tab').forEach((button) => button.classList.toggle('active', button.dataset.form === form));
    $$('.form-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `form-${form}-panel`));
  }

  function openModal(html) {
    $('#modalContent').innerHTML = html;
    $('#modalBackdrop').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(result = null) {
    $('#modalBackdrop').classList.add('hidden');
    document.body.style.overflow = '';
    if (modalResolver) {
      const resolve = modalResolver;
      modalResolver = null;
      resolve(result);
    }
  }

  function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false, warning = false }) {
    return new Promise((resolve) => {
      modalResolver = resolve;
      const tone = danger ? 'danger' : warning ? 'warning' : 'primary';
      const symbol = danger ? '!' : warning ? '⚠' : '✓';
      openModal(`<div class="confirm-hero ${tone}"><span>${symbol}</span><div><div class="modal-kicker">CONFIRMACIÓN</div><h2 id="modalTitle">${escapeHtml(title)}</h2></div></div><p>${escapeHtml(message)}</p>${warning ? `<div class="modal-warning">Verifica el monto, la persona y la categoría antes de continuar.</div>` : ''}${danger ? `<div class="modal-danger">Esta acción modifica dinero protegido o información importante.</div>` : ''}<div class="modal-actions"><button class="btn ghost" data-modal-result="false">${escapeHtml(cancelText)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-modal-result="true">${escapeHtml(confirmText)}</button></div>`);
    });
  }

  function choiceDialog({ title, message, choices }) {
    return new Promise((resolve) => {
      modalResolver = resolve;
      openModal(`<h2 id="modalTitle">${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><div class="choice-grid">${choices.map((choice) => `<button class="choice-btn" data-modal-choice="${choice.value}"><strong>${escapeHtml(choice.title)}</strong><span>${escapeHtml(choice.text)}</span></button>`).join('')}</div><div class="modal-actions"><button class="btn ghost" data-modal-result="null">Cancelar</button></div>`);
    });
  }

  function toast(title, message, type = 'success') {
    const element = document.createElement('div');
    element.className = `toast ${type}`;
    element.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    $('#toastRegion').appendChild(element);
    setTimeout(() => element.remove(), 4200);
  }

  async function confirmSavingsUse(person, amount, balanceAfter) {
    return await confirmDialog({
      title: '¿Usar dinero del ahorro libre?',
      message: `${profile(person).name} utilizará ${formatMoney(amount)} del ahorro disponible. Después quedarán ${formatMoney(balanceAfter)} en la categoría Ahorro. El fondo de emergencia separado no se modificará.`,
      confirmText: 'Sí, usar ahorro', warning: true
    });
  }

  async function selectCoverageSource(person, targetCategoryId, difference) {
    const balances = getBalances(person);
    const options = categories(person).filter((cat) => cat.id !== targetCategoryId && Number(balances[cat.id] || 0) >= difference);
    if (!options.length) {
      toast('No hay una categoría suficiente', `Ninguna otra categoría tiene ${formatMoney(difference)} disponibles.`, 'danger');
      return null;
    }
    return new Promise((resolve) => {
      modalResolver = resolve;
      openModal(`<h2 id="modalTitle">Cubrir la diferencia</h2><p>Selecciona de dónde tomar ${formatMoney(difference)}.</p><div class="smart-form"><label>Categoría de origen<select id="coverageSource">${options.map((cat) => `<option value="${cat.id}">${escapeHtml(cat.name)} · ${formatMoney(balances[cat.id])}</option>`).join('')}</select></label></div><div class="modal-actions"><button class="btn ghost" data-modal-result="null">Cancelar</button><button class="btn primary" id="confirmCoverageBtn">Cubrir diferencia</button></div>`);
      $('#confirmCoverageBtn').addEventListener('click', () => closeModal($('#coverageSource').value));
    });
  }

  async function handleIncomeSubmit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const person = data.get('person');
    const amount = round2(data.get('amount'));
    if (!(amount > 0)) return toast('Monto inválido', 'Escribe un ingreso mayor que cero.', 'danger');
    const allocations = allocateAmount(person, amount);
    addTransaction({ type: 'income', person, amount, allocations, date: data.get('date'), description: data.get('description') || `Ingreso de ${profile(person).name}` }, `${profile(person).name} registró un ingreso de ${formatMoney(amount)}`);
    await persist();
    event.currentTarget.reset();
    $('#incomeDate').value = todayString();
    $('#incomePerson').value = person;
    updateIncomePreview();
    renderAll();
    toast('Ingreso registrado', `Se distribuyeron ${formatMoney(amount)} automáticamente.`);
  }

  async function handleExpenseSubmit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const person = data.get('person');
    const categoryId = data.get('category');
    const amount = round2(data.get('amount'));
    if (!(amount > 0)) return toast('Monto inválido', 'Escribe un gasto mayor que cero.', 'danger');
    const balances = getBalances(person);
    const current = Number(balances[categoryId] || 0);
    const savings = savingsCategory(person);
    if (categoryId === savings.id) {
      const ok = await confirmSavingsUse(person, amount, round2(current - amount));
      if (!ok) return;
    }

    if (amount > current) {
      const difference = round2(amount - current);
      const choice = await choiceDialog({
        title: 'Saldo insuficiente',
        message: `Faltan ${formatMoney(difference)} en ${category(person, categoryId)?.name || 'esta categoría'}. ¿Qué deseas hacer?`,
        choices: [
          { value: 'negative', title: 'Registrar y dejar saldo negativo', text: 'El gasto se guardará y la categoría mostrará la deuda.' },
          { value: 'cover', title: 'Cubrir desde otra categoría', text: 'DINEX moverá la diferencia antes de registrar el gasto.' }
        ]
      });
      if (!choice) return;
      if (choice === 'cover') {
        const sourceId = await selectCoverageSource(person, categoryId, difference);
        if (!sourceId) return;
        const sourceBalance = Number(getBalances(person)[sourceId] || 0);
        if (sourceId === savings.id) {
          const ok = await confirmSavingsUse(person, difference, round2(sourceBalance - difference));
          if (!ok) return;
        }
        addTransaction({ type: 'transfer', person, amount: difference, fromCategoryId: sourceId, toCategoryId: categoryId, date: data.get('date'), description: `Cobertura automática para ${data.get('description')}` }, `Se cubrieron ${formatMoney(difference)} antes de un gasto`);
      }
    }

    addTransaction({
      type: 'expense', person, categoryId, amount, date: data.get('date'),
      description: data.get('description'), method: data.get('method'), merchant: data.get('merchant'), note: data.get('note')
    }, `${profile(person).name} registró un gasto de ${formatMoney(amount)}`);
    await persist();
    event.currentTarget.reset();
    $('#expenseDate').value = todayString();
    $('#expensePerson').value = person;
    updateAllCategorySelects();
    renderAll();
    toast('Gasto registrado', `${formatMoney(amount)} descontados de ${category(person, categoryId)?.name || 'la categoría'}.`);
  }

  async function handleTransferSubmit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const person = data.get('person');
    const fromCategoryId = data.get('fromCategory');
    const toCategoryId = data.get('toCategory');
    const amount = round2(data.get('amount'));
    if (fromCategoryId === toCategoryId) return toast('Categorías iguales', 'Elige una categoría de destino diferente.', 'danger');
    if (!(amount > 0)) return toast('Monto inválido', 'Escribe un monto mayor que cero.', 'danger');
    const current = Number(getBalances(person)[fromCategoryId] || 0);
    const savings = savingsCategory(person);
    if (fromCategoryId === savings.id) {
      const ok = await confirmSavingsUse(person, amount, round2(current - amount));
      if (!ok) return;
    }
    if (amount > current) {
      const ok = await confirmDialog({ title: 'La categoría quedará negativa', message: `La transferencia supera el saldo disponible por ${formatMoney(amount - current)}.`, confirmText: 'Transferir de todos modos', warning: true });
      if (!ok) return;
    }
    addTransaction({ type: 'transfer', person, amount, fromCategoryId, toCategoryId, date: data.get('date'), description: data.get('description') }, `${profile(person).name} transfirió ${formatMoney(amount)}`);
    await persist();
    event.currentTarget.reset();
    $('#transferDate').value = todayString();
    $('#transferPerson').value = person;
    updateAllCategorySelects();
    renderAll();
    toast('Transferencia completada', `${formatMoney(amount)} movidos entre categorías.`);
  }

  async function editTransaction(id) {
    const tx = state.transactions.find((item) => item.id === id);
    if (!tx) return;
    const categoryOptions = categories(tx.person).map((cat) => `<option value="${cat.id}" ${tx.categoryId === cat.id || tx.fromCategoryId === cat.id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`).join('');
    const toOptions = categories(tx.person).map((cat) => `<option value="${cat.id}" ${tx.toCategoryId === cat.id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`).join('');
    let extra = '';
    if (tx.type === 'expense') extra = `<label>Categoría<select name="categoryId">${categoryOptions}</select></label><label>Método<select name="method">${['Efectivo','Yappy','Tarjeta','Transferencia','Otro'].map((method) => `<option ${tx.method === method ? 'selected' : ''}>${method}</option>`).join('')}</select></label>`;
    if (tx.type === 'transfer') extra = `<label>Desde<select name="fromCategoryId">${categoryOptions}</select></label><label>Hacia<select name="toCategoryId">${toOptions}</select></label>`;
    if (tx.type === 'emergency_contribution') extra = `<div class="form-note">Este aporte sale de la categoría ${escapeHtml(savingsCategory(tx.person)?.name || 'Ahorro')} y entra al fondo protegido.</div>`;
    if (tx.type === 'emergency_withdrawal') extra = `<label>Enviar a<select name="toCategoryId">${toOptions}</select></label><div class="modal-danger">Editar este movimiento cambia el saldo disponible del fondo de emergencia.</div>`;
    openModal(`<h2 id="modalTitle">Editar ${transactionLabel(tx).toLowerCase()}</h2><p>Los saldos se recalcularán automáticamente.</p><form id="editTxForm" class="smart-form"><input type="hidden" name="id" value="${tx.id}"><label>Monto<div class="money-input"><span>$</span><input name="amount" type="number" min="0.01" step="0.01" value="${tx.amount}" required></div></label><label>Fecha<input name="date" type="date" value="${tx.date}" required></label><label>Descripción<input name="description" value="${escapeHtml(tx.description || '')}" maxlength="80"></label>${extra}<div class="modal-actions"><button type="button" class="btn ghost" data-modal-result="null">Cancelar</button><button type="submit" class="btn primary">Guardar cambios</button></div></form>`);
    $('#editTxForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const newAmount = round2(data.get('amount'));
      if (!(newAmount > 0)) return;
      const updated = { ...tx, amount: newAmount, date: data.get('date'), description: data.get('description') };
      if (tx.type === 'income') updated.allocations = allocateAmount(tx.person, newAmount);
      if (tx.type === 'expense') {
        updated.categoryId = data.get('categoryId');
        updated.method = data.get('method');
        if (updated.categoryId === savingsCategory(tx.person).id) {
          const balancesWithout = getBalances(tx.person, state.transactions.filter((item) => item.id !== tx.id));
          const ok = await confirmSavingsUse(tx.person, newAmount, round2((balancesWithout[updated.categoryId] || 0) - newAmount));
          if (!ok) return;
        }
      }
      if (tx.type === 'transfer') {
        updated.fromCategoryId = data.get('fromCategoryId');
        updated.toCategoryId = data.get('toCategoryId');
        if (updated.fromCategoryId === updated.toCategoryId) return toast('Categorías iguales', 'El origen y destino deben ser distintos.', 'danger');
        if (updated.fromCategoryId === savingsCategory(tx.person).id) {
          const balancesWithout = getBalances(tx.person, state.transactions.filter((item) => item.id !== tx.id));
          const ok = await confirmSavingsUse(tx.person, newAmount, round2((balancesWithout[updated.fromCategoryId] || 0) - newAmount));
          if (!ok) return;
        }
      }
      if (tx.type === 'goal_contribution' && tx.fromCategoryId === savingsCategory(tx.person).id) {
        const balancesWithout = getBalances(tx.person, state.transactions.filter((item) => item.id !== tx.id));
        const ok = await confirmSavingsUse(tx.person, newAmount, round2((balancesWithout[tx.fromCategoryId] || 0) - newAmount));
        if (!ok) return;
      }
      if (tx.type === 'goal_withdrawal') {
        const availableWithoutThisWithdrawal = getGoalAmount(tx.goalId, state.transactions.filter((item) => item.id !== tx.id));
        if (newAmount > availableWithoutThisWithdrawal) return toast('Monto demasiado alto', `La meta solo tiene ${formatMoney(availableWithoutThisWithdrawal)} disponibles para este retiro.`, 'danger');
      }
      if (tx.type === 'emergency_contribution') {
        const transactionsWithout = state.transactions.filter((item) => item.id !== tx.id);
        const balancesWithout = getBalances(tx.person, transactionsWithout);
        const savingsId = savingsCategory(tx.person).id;
        const available = Number(balancesWithout[savingsId] || 0);
        const emergencyWithout = getEmergencyBalance(tx.person, transactionsWithout);
        const minimumRequired = Math.max(0, round2(-emergencyWithout));
        if (newAmount < minimumRequired) return toast('Aporte mínimo requerido', `Debes mantener al menos ${formatMoney(minimumRequired)} porque existen retiros posteriores de este fondo.`, 'danger');
        if (newAmount > available) return toast('Ahorro insuficiente', `Sin este movimiento solo hay ${formatMoney(available)} disponibles para aportar.`, 'danger');
        updated.fromCategoryId = savingsId;
      }
      if (tx.type === 'emergency_withdrawal') {
        const availableWithout = getEmergencyBalance(tx.person, state.transactions.filter((item) => item.id !== tx.id));
        if (newAmount > availableWithout) return toast('Monto demasiado alto', `El fondo dispone de ${formatMoney(availableWithout)} para este retiro.`, 'danger');
        updated.toCategoryId = data.get('toCategoryId');
        const ok = await confirmDialog({ title: 'Confirmar cambio del retiro', message: `El fondo de emergencia quedará en ${formatMoney(availableWithout - newAmount)}.`, confirmText: 'Guardar retiro', danger: true });
        if (!ok) return;
      }
      state.transactions = state.transactions.map((item) => item.id === tx.id ? updated : item);
      audit('transaction_edited', `Se editó ${transactionLabel(tx).toLowerCase()} por ${formatMoney(newAmount)}`);
      await persist();
      closeModal();
      renderAll();
      toast('Movimiento actualizado', 'Los saldos fueron recalculados.');
    });
  }

  async function deleteTransaction(id) {
    const tx = state.transactions.find((item) => item.id === id);
    if (!tx) return;
    if (tx.type === 'emergency_contribution') {
      const balanceWithout = getEmergencyBalance(tx.person, state.transactions.filter((item) => item.id !== tx.id));
      if (balanceWithout < 0) return toast('No se puede eliminar este aporte', `Existen retiros posteriores. Antes debes corregirlos o conservar al menos ${formatMoney(Math.abs(balanceWithout))} en aportes.`, 'danger');
    }
    const ok = await confirmDialog({ title: 'Eliminar movimiento', message: `Se eliminará “${transactionDescription(tx)}” por ${formatMoney(tx.amount)} y se recalcularán los saldos.`, confirmText: 'Eliminar', danger: true });
    if (!ok) return;
    state.transactions = state.transactions.filter((item) => item.id !== id);
    audit('transaction_deleted', `Se eliminó ${transactionDescription(tx)}`);
    await persist();
    renderAll();
    toast('Movimiento eliminado', 'Los saldos fueron recalculados.', 'danger');
  }

  function renderSavings() {
    const kiannaSavings = currentSavings('kianna');
    const jorgeSavings = currentSavings('jorge');
    const emergencyTotal = getAllEmergencyTotal();
    const goalsTotal = getAllGoalsTotal();
    const goalTarget = state.goals.reduce((sum, goal) => sum + Number(goal.target || 0), 0);
    $('#savingsOverview').innerHTML = [
      metricCard('Ahorro libre de Kianna', formatMoney(kiannaSavings), `Emergencia separada: ${formatMoney(getEmergencyBalance('kianna'))}`, 'K', '#7c3aed', kiannaSavings < 0),
      metricCard('Ahorro libre de Jorge', formatMoney(jorgeSavings), `Emergencia separada: ${formatMoney(getEmergencyBalance('jorge'))}`, 'J', '#0b5cff', jorgeSavings < 0),
      metricCard('Fondos de emergencia', formatMoney(emergencyTotal), 'Dinero protegido y separado', '◆', '#e53935'),
      metricCard('Dinero en metas', formatMoney(goalsTotal), goalTarget ? `${Math.round((goalsTotal / goalTarget) * 100)}% del objetivo total` : 'Crea la primera meta', '◎', '#0f9d68')
    ].join('');

    $('#emergencyFunds').innerHTML = ['kianna', 'jorge'].map((person) => {
      const freeSavings = currentSavings(person);
      const target = Number(profile(person).emergencyFund || 0);
      const balance = getEmergencyBalance(person);
      const remaining = Math.max(0, round2(target - balance));
      const pct = target > 0 ? clamp((Math.max(balance, 0) / target) * 100, 0, 100) : 0;
      const status = target <= 0 ? 'Sin meta configurada' : balance >= target ? 'Fondo completo' : `${formatMoney(remaining)} para completar`;
      const statusClass = target > 0 && balance >= target ? 'complete' : balance > 0 ? 'progress' : 'empty';
      return `<article class="reserve-card ${statusClass}" style="--reserve-accent:${person === 'kianna' ? '#7c3aed' : '#0b5cff'}">
        <div class="reserve-card-head">
          <div class="reserve-identity"><div class="reserve-shield">◆</div><div><h4>${profile(person).name}</h4><small>${status}</small></div></div>
          <button class="mini-btn" data-emergency-action="configure" data-person="${person}" title="Configurar meta">⚙</button>
        </div>
        <div class="reserve-main-value"><span>Fondo actual</span><strong>${formatMoney(balance)}</strong></div>
        <div class="reserve-target-row"><span>Meta protegida</span><strong>${formatMoney(target)}</strong></div>
        <div class="progress-track reserve-progress"><div class="progress-fill" style="--cat:var(--reserve-accent);width:${pct}%"></div></div>
        <div class="reserve-details"><span><b>${Math.round(pct)}%</b> completado</span><span>Ahorro libre: <b>${formatMoney(freeSavings)}</b></span></div>
        <div class="reserve-actions">
          <button class="btn primary" data-emergency-action="contribute" data-person="${person}">＋ Aportar</button>
          <button class="btn ghost" data-emergency-action="withdraw" data-person="${person}" ${balance <= 0 ? 'disabled' : ''}>Retirar</button>
        </div>
      </article>`;
    }).join('');

    const goals = state.goals.slice().sort((a, b) => (a.priority || 3) - (b.priority || 3));
    $('#goalsGrid').innerHTML = goals.map((goal) => {
      const current = getGoalAmount(goal.id);
      const pct = goal.target > 0 ? clamp((current / goal.target) * 100, 0, 100) : 0;
      const owner = goal.person === 'shared' ? 'Compartida' : profile(goal.person).name;
      return `<article class="goal-card">
        <div class="goal-top"><div class="goal-icon">${goal.icon || '◎'}</div><div class="table-actions"><button class="mini-btn" data-goal-action="edit" data-id="${goal.id}">✎</button><button class="mini-btn" data-goal-action="delete" data-id="${goal.id}">⌫</button></div></div>
        <h3>${escapeHtml(goal.name)}</h3><div class="goal-meta">${owner} · Prioridad ${goal.priority || 3}${goal.deadline ? ` · ${formatDate(goal.deadline)}` : ''}</div>
        <div class="goal-amount"><strong>${formatMoney(current)}</strong><span>de ${formatMoney(goal.target)}</span></div>
        <div class="progress-track"><div class="progress-fill" style="--cat:${goal.color || '#0b5cff'};width:${pct}%"></div></div>
        <div class="goal-actions"><button class="btn primary" data-goal-action="contribute" data-id="${goal.id}">Aportar</button><button class="btn ghost" data-goal-action="withdraw" data-id="${goal.id}">Retirar</button></div>
      </article>`;
    }).join('');
    $('#goalsEmpty').classList.toggle('hidden', goals.length > 0);
    drawGoalsChart();
  }

  function configureEmergencyFund(person) {
    const currentTarget = Number(profile(person).emergencyFund || 0);
    const currentBalance = getEmergencyBalance(person);
    openModal(`<div class="modal-kicker">FONDO DE EMERGENCIA</div><h2 id="modalTitle">Configurar reserva de ${profile(person).name}</h2><p>La meta indica cuánto deseas mantener protegido. El dinero real se mueve con el botón “Aportar”.</p><form id="emergencyConfigForm" class="smart-form">
      <div class="modal-summary-grid"><div><span>Fondo actual</span><strong>${formatMoney(currentBalance)}</strong></div><div><span>Meta actual</span><strong>${formatMoney(currentTarget)}</strong></div></div>
      <label>Meta protegida<div class="money-input"><span>$</span><input name="target" type="number" min="0" step="0.01" value="${currentTarget}" required></div></label>
      <div class="form-note">Puedes cambiar esta meta cuando quieras. Cambiarla no mueve dinero automáticamente.</div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-modal-result="null">Cancelar</button><button type="submit" class="btn primary">Guardar meta</button></div>
    </form>`);
    $('#emergencyConfigForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const target = round2(new FormData(event.currentTarget).get('target'));
      if (target < 0) return toast('Meta inválida', 'La meta no puede ser negativa.', 'danger');
      profile(person).emergencyFund = target;
      audit('emergency_target_updated', `${profile(person).name} configuró su fondo de emergencia en ${formatMoney(target)}`);
      await persist();
      closeModal();
      renderAll();
      toast('Meta de emergencia actualizada', target > 0 ? `La nueva meta protegida es ${formatMoney(target)}.` : 'La meta quedó desactivada. El saldo existente se conserva.');
    });
  }

  function emergencyContributionModal(person) {
    const savings = savingsCategory(person);
    const available = currentSavings(person);
    const currentBalance = getEmergencyBalance(person);
    const target = Number(profile(person).emergencyFund || 0);
    openModal(`<div class="modal-kicker">APORTE PROTEGIDO</div><h2 id="modalTitle">Aportar al fondo de ${profile(person).name}</h2><p>Este dinero saldrá de la categoría Ahorro y quedará separado dentro de la reserva de emergencia.</p><form id="emergencyContributionForm" class="smart-form">
      <div class="modal-summary-grid"><div><span>Ahorro disponible</span><strong>${formatMoney(available)}</strong></div><div><span>Fondo actual</span><strong>${formatMoney(currentBalance)}</strong></div></div>
      ${target > 0 ? `<div class="goal-callout">Meta protegida: <strong>${formatMoney(target)}</strong> · Faltan <strong>${formatMoney(Math.max(0, target - currentBalance))}</strong></div>` : `<div class="modal-warning">Todavía no configuraste una meta. Puedes aportar de todos modos y definirla después.</div>`}
      <label>Monto a proteger<div class="money-input"><span>$</span><input name="amount" type="number" min="0.01" max="${Math.max(0, available)}" step="0.01" placeholder="0.00" required></div></label>
      <div class="field-grid two"><label>Fecha<input name="date" type="date" value="${todayString()}" required></label><label>Nota<input name="description" maxlength="80" placeholder="Ej. Reserva del mes"></label></div>
      <div class="form-note">No se crea dinero nuevo: solo se mueve desde ${escapeHtml(savings?.name || 'Ahorro')} hacia el fondo protegido.</div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-modal-result="null">Cancelar</button><button type="submit" class="btn primary" ${available <= 0 ? 'disabled' : ''}>Proteger dinero</button></div>
    </form>`);
    $('#emergencyContributionForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const amount = round2(data.get('amount'));
      const latestAvailable = currentSavings(person);
      if (!(amount > 0)) return toast('Monto inválido', 'Escribe un monto mayor que cero.', 'danger');
      if (amount > latestAvailable) return toast('Ahorro insuficiente', `Solo hay ${formatMoney(latestAvailable)} disponibles en ahorro.`, 'danger');
      addTransaction({ type: 'emergency_contribution', person, amount, fromCategoryId: savings.id, date: data.get('date'), description: data.get('description') || 'Aporte al fondo de emergencia' }, `${profile(person).name} protegió ${formatMoney(amount)} en su fondo de emergencia`);
      await persist();
      closeModal();
      renderAll();
      toast('Dinero protegido', `${formatMoney(amount)} pasaron al fondo de emergencia de ${profile(person).name}.`);
    });
  }

  function emergencyWithdrawalModal(person) {
    const available = getEmergencyBalance(person);
    if (available <= 0) return toast('Fondo vacío', 'No hay dinero disponible para retirar.', 'danger');
    const target = Number(profile(person).emergencyFund || 0);
    const options = categories(person).map((cat) => `<option value="${cat.id}" ${cat.id === savingsCategory(person).id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`).join('');
    openModal(`<div class="modal-kicker danger-text">RETIRO EXCEPCIONAL</div><h2 id="modalTitle">Retirar del fondo de ${profile(person).name}</h2><p>El retiro devolverá dinero a una categoría. Quedará registrado con el motivo y la fecha.</p><form id="emergencyWithdrawalForm" class="smart-form">
      <div class="modal-summary-grid danger-summary"><div><span>Fondo disponible</span><strong>${formatMoney(available)}</strong></div><div><span>Meta protegida</span><strong>${formatMoney(target)}</strong></div></div>
      <label>Monto a retirar<div class="money-input"><span>$</span><input name="amount" type="number" min="0.01" max="${available}" step="0.01" placeholder="0.00" required></div></label>
      <label>Enviar el dinero a<select name="toCategoryId">${options}</select></label>
      <div class="field-grid two"><label>Fecha<input name="date" type="date" value="${todayString()}" required></label><label>Motivo<input name="description" maxlength="100" placeholder="Ej. Reparación urgente" required></label></div>
      <div class="modal-danger">Usa esta reserva únicamente para una necesidad importante. DINEX pedirá una confirmación final.</div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-modal-result="null">Cancelar</button><button type="submit" class="btn danger">Continuar con retiro</button></div>
    </form>`);
    $('#emergencyWithdrawalForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const amount = round2(data.get('amount'));
      const latestAvailable = getEmergencyBalance(person);
      if (!(amount > 0)) return toast('Monto inválido', 'Escribe un monto mayor que cero.', 'danger');
      if (amount > latestAvailable) return toast('Monto demasiado alto', `El fondo solo tiene ${formatMoney(latestAvailable)}.`, 'danger');
      const after = round2(latestAvailable - amount);
      closeModal();
      const confirmed = await confirmDialog({
        title: 'Confirmar retiro de emergencia',
        message: `${profile(person).name} retirará ${formatMoney(amount)}. El fondo quedará en ${formatMoney(after)} y el dinero irá a ${category(person, data.get('toCategoryId'))?.name || 'la categoría seleccionada'}.`,
        confirmText: 'Sí, retirar del fondo', danger: true
      });
      if (!confirmed) return;
      addTransaction({ type: 'emergency_withdrawal', person, amount, toCategoryId: data.get('toCategoryId'), date: data.get('date'), description: data.get('description') || 'Retiro del fondo de emergencia' }, `${profile(person).name} retiró ${formatMoney(amount)} de su fondo de emergencia`);
      await persist();
      renderAll();
      toast('Retiro de emergencia registrado', `${formatMoney(amount)} fueron enviados a ${category(person, data.get('toCategoryId'))?.name || 'la categoría seleccionada'}.`, 'danger');
    });
  }

  function handleEmergencyAction(action, person) {
    if (!profile(person)) return;
    if (action === 'configure') configureEmergencyFund(person);
    if (action === 'contribute') emergencyContributionModal(person);
    if (action === 'withdraw') emergencyWithdrawalModal(person);
  }

  function drawGoalsChart() {
    const canvas = $('#goalsChart');
    const data = state.goals.map((goal) => ({ label: goal.name, value: getGoalAmount(goal.id), target: Number(goal.target || 0), color: goal.color || '#0b5cff' }));
    const prepared = prepareCanvas(canvas, 220);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);
    if (!data.length) {
      ctx.fillStyle = cssVar('--muted'); ctx.font = '600 13px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Crea una meta para ver su progreso', width / 2, height / 2); return;
    }
    const max = Math.max(...data.map((item) => Math.max(item.target, item.value)), 1);
    const left = 35, right = 15, top = 20, bottom = 34;
    const plotW = width - left - right, plotH = height - top - bottom;
    const slot = plotW / data.length;
    data.forEach((item, index) => {
      const x = left + slot * index + slot * .2;
      const barW = slot * .6;
      const h = (item.value / max) * plotH;
      ctx.fillStyle = cssVar('--surface-2'); ctx.fillRect(x, top, barW, plotH);
      ctx.fillStyle = item.color; ctx.fillRect(x, top + plotH - h, barW, h);
      ctx.fillStyle = cssVar('--muted'); ctx.font = '600 10px system-ui'; ctx.textAlign = 'center';
      const label = item.label.length > 12 ? `${item.label.slice(0, 11)}…` : item.label;
      ctx.fillText(label, x + barW / 2, height - 12);
    });
  }

  function goalModal(goal = null) {
    const isEdit = Boolean(goal);
    openModal(`<h2 id="modalTitle">${isEdit ? 'Editar meta' : 'Crear meta de ahorro'}</h2><p>Define un objetivo claro y DINEX medirá el progreso.</p><form id="goalForm" class="smart-form">
      <label>Nombre<input name="name" value="${escapeHtml(goal?.name || '')}" placeholder="Ej.: Computadora" maxlength="60" required></label>
      <label>Responsable<select name="person"><option value="shared" ${goal?.person === 'shared' ? 'selected' : ''}>Compartida</option><option value="kianna" ${goal?.person === 'kianna' ? 'selected' : ''}>Kianna</option><option value="jorge" ${goal?.person === 'jorge' ? 'selected' : ''}>Jorge</option></select></label>
      <label>Monto objetivo<div class="money-input"><span>$</span><input name="target" type="number" min="0.01" step="0.01" value="${goal?.target || ''}" required></div></label>
      <label>Fecha deseada<input name="deadline" type="date" value="${goal?.deadline || ''}"></label>
      <label>Prioridad<select name="priority"><option value="1" ${goal?.priority == 1 ? 'selected' : ''}>1 · Alta</option><option value="2" ${goal?.priority == 2 ? 'selected' : ''}>2 · Media alta</option><option value="3" ${!goal || goal?.priority == 3 ? 'selected' : ''}>3 · Normal</option><option value="4" ${goal?.priority == 4 ? 'selected' : ''}>4 · Baja</option></select></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-modal-result="null">Cancelar</button><button class="btn primary" type="submit">${isEdit ? 'Guardar cambios' : 'Crear meta'}</button></div>
    </form>`);
    $('#goalForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const record = {
        id: goal?.id || uid(), name: data.get('name'), person: data.get('person'), target: round2(data.get('target')),
        deadline: data.get('deadline'), priority: Number(data.get('priority')), icon: goal?.icon || '◎', color: goal?.color || '#0b5cff', createdAt: goal?.createdAt || new Date().toISOString()
      };
      if (isEdit) state.goals = state.goals.map((item) => item.id === goal.id ? record : item);
      else state.goals.push(record);
      audit(isEdit ? 'goal_edited' : 'goal_created', `${isEdit ? 'Se editó' : 'Se creó'} la meta ${record.name}`);
      await persist(); closeModal(); renderAll(); toast(isEdit ? 'Meta actualizada' : 'Meta creada', `${record.name} ya aparece en tu panel.`);
    });
  }

  async function goalAction(action, id) {
    const goal = state.goals.find((item) => item.id === id);
    if (!goal) return;
    if (action === 'edit') return goalModal(goal);
    if (action === 'delete') {
      const current = getGoalAmount(id);
      if (current !== 0) return toast('La meta todavía tiene dinero', 'Retira o redistribuye el saldo antes de eliminarla.', 'danger');
      const ok = await confirmDialog({ title: 'Eliminar meta', message: `Se eliminará “${goal.name}”.`, confirmText: 'Eliminar', danger: true });
      if (!ok) return;
      state.goals = state.goals.filter((item) => item.id !== id); audit('goal_deleted', `Se eliminó la meta ${goal.name}`); await persist(); renderAll(); return toast('Meta eliminada', 'La meta fue eliminada.', 'danger');
    }
    if (action === 'contribute') return openGoalContribution(goal);
    if (action === 'withdraw') return openGoalWithdrawal(goal);
  }

  function openGoalContribution(goal) {
    const allowedPeople = goal.person === 'shared' ? ['kianna', 'jorge'] : [goal.person];
    openModal(`<h2 id="modalTitle">Aportar a ${escapeHtml(goal.name)}</h2><p>El dinero saldrá de una categoría y quedará asignado a la meta.</p><form id="goalContributionForm" class="smart-form">
      <label>Persona<select name="person" id="goalContributionPerson">${allowedPeople.map((person) => `<option value="${person}">${profile(person).name}</option>`).join('')}</select></label>
      <label>Tomar desde<select name="fromCategory" id="goalContributionCategory"></select></label>
      <label>Monto<div class="money-input"><span>$</span><input name="amount" type="number" min="0.01" step="0.01" required></div></label>
      <label>Fecha<input name="date" type="date" value="${todayString()}" required></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-modal-result="null">Cancelar</button><button class="btn primary" type="submit">Aportar</button></div>
    </form>`);
    const update = () => populateCategorySelect($('#goalContributionCategory'), $('#goalContributionPerson').value, savingsCategory($('#goalContributionPerson').value).id);
    update(); $('#goalContributionPerson').addEventListener('change', update);
    $('#goalContributionForm').addEventListener('submit', async (event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget); const person = data.get('person'); const fromCategoryId = data.get('fromCategory'); const amount = round2(data.get('amount'));
      const currentBalance = Number(getBalances(person)[fromCategoryId] || 0);
      if (fromCategoryId === savingsCategory(person).id) { const ok = await confirmSavingsUse(person, amount, round2(currentBalance - amount)); if (!ok) return; }
      if (amount > currentBalance) { const ok = await confirmDialog({ title: 'La categoría quedará negativa', message: `El aporte supera el saldo disponible por ${formatMoney(amount - currentBalance)}.`, confirmText: 'Aportar de todos modos', warning: true }); if (!ok) return; }
      addTransaction({ type: 'goal_contribution', person, goalId: goal.id, fromCategoryId, amount, date: data.get('date'), description: `Aporte a ${goal.name}` }, `${profile(person).name} aportó ${formatMoney(amount)} a ${goal.name}`);
      await persist(); closeModal(); renderAll(); toast('Aporte registrado', `${formatMoney(amount)} agregados a ${goal.name}.`);
    });
  }

  function openGoalWithdrawal(goal) {
    const available = getGoalAmount(goal.id);
    if (available <= 0) return toast('Meta sin saldo', 'Todavía no hay dinero disponible para retirar.', 'danger');
    openModal(`<h2 id="modalTitle">Retirar de ${escapeHtml(goal.name)}</h2><p>Disponible en la meta: ${formatMoney(available)}.</p><form id="goalWithdrawalForm" class="smart-form">
      <label>Entregar a<select name="person" id="goalWithdrawalPerson"><option value="kianna">Kianna</option><option value="jorge">Jorge</option></select></label>
      <label>Depositar en<select name="toCategory" id="goalWithdrawalCategory"></select></label>
      <label>Monto<div class="money-input"><span>$</span><input name="amount" type="number" min="0.01" max="${available}" step="0.01" required></div></label>
      <label>Fecha<input name="date" type="date" value="${todayString()}" required></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-modal-result="null">Cancelar</button><button class="btn danger" type="submit">Retirar</button></div>
    </form>`);
    const update = () => populateCategorySelect($('#goalWithdrawalCategory'), $('#goalWithdrawalPerson').value, savingsCategory($('#goalWithdrawalPerson').value).id);
    update(); $('#goalWithdrawalPerson').addEventListener('change', update);
    $('#goalWithdrawalForm').addEventListener('submit', async (event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget); const amount = round2(data.get('amount'));
      if (amount > getGoalAmount(goal.id)) return toast('Monto demasiado alto', 'No puedes retirar más de lo acumulado.', 'danger');
      const ok = await confirmDialog({ title: 'Retirar dinero de una meta', message: `Se retirarán ${formatMoney(amount)} de “${goal.name}”.`, confirmText: 'Retirar', warning: true }); if (!ok) return;
      addTransaction({ type: 'goal_withdrawal', person: data.get('person'), goalId: goal.id, toCategoryId: data.get('toCategory'), amount, date: data.get('date'), description: `Retiro de ${goal.name}` }, `Se retiraron ${formatMoney(amount)} de ${goal.name}`);
      await persist(); closeModal(); renderAll(); toast('Retiro registrado', `${formatMoney(amount)} regresaron a una categoría.`);
    });
  }

  function renderWeekly() {
    const person = $('#weeklyPerson').value || 'kianna';
    const cycle = currentCycle(person, $('#weeklyCloseDate').value || todayString());
    const summary = periodSummary(person, cycle.start, cycle.end);
    const balances = getBalances(person);
    $('#weeklyCurrentSummary').innerHTML = `<div class="week-summary"><div class="week-period">${formatDate(cycle.start)} — ${formatDate(cycle.end)}</div><div class="week-stat-grid"><div class="week-stat"><span>Ingresos</span><strong>${formatMoney(summary.incomes)}</strong></div><div class="week-stat"><span>Gastos</span><strong>${formatMoney(summary.expenses)}</strong></div><div class="week-stat"><span>Ahorro generado</span><strong>${formatMoney(summary.savings)}</strong></div><div class="week-stat"><span>Resultado del periodo</span><strong style="color:${summary.net < 0 ? 'var(--danger)' : 'var(--success)'}">${formatMoney(summary.net)}</strong></div></div>${categories(person).map((cat) => `<div class="category-row"><div class="category-name"><i class="category-dot" style="--cat:${cat.color}"></i><strong>${escapeHtml(cat.name)}</strong></div><span class="category-value ${balances[cat.id] < 0 ? 'negative' : ''}">${formatMoney(balances[cat.id])}</span></div>`).join('')}</div>`;
    renderManualLeftovers();
    $('#closuresList').innerHTML = state.closures.length ? state.closures.slice().sort((a, b) => b.closedAt.localeCompare(a.closedAt)).map((closure) => `<div class="closure-item"><div class="closure-main"><strong>${profile(closure.person).name} · ${formatDate(closure.start)} — ${formatDate(closure.end)}</strong><span>${closure.actionLabel}${closure.note ? ` · ${escapeHtml(closure.note)}` : ''}</span></div><div class="closure-stats"><div class="closure-stat"><span>Ingresos</span><strong>${formatMoney(closure.summary.incomes)}</strong></div><div class="closure-stat"><span>Gastos</span><strong>${formatMoney(closure.summary.expenses)}</strong></div><div class="closure-stat"><span>Ahorro</span><strong>${formatMoney(closure.summary.savings)}</strong></div></div></div>`).join('') : `<div class="empty-state"><div class="empty-icon">▣</div><h3>No hay cierres guardados</h3><p>El primer cierre aparecerá aquí con su resumen completo.</p></div>`;
  }

  function renderManualLeftovers() {
    const container = $('#manualLeftoverFields');
    const action = $('#leftoverAction').value;
    container.classList.toggle('hidden', action !== 'manual');
    if (action !== 'manual') return;
    const person = $('#weeklyPerson').value;
    const balances = getBalances(person);
    const savings = savingsCategory(person);
    container.innerHTML = categories(person).filter((cat) => cat.id !== savings.id && balances[cat.id] > 0).map((cat) => `<label>${escapeHtml(cat.name)} · disponible ${formatMoney(balances[cat.id])}<div class="money-input"><span>$</span><input name="manual_${cat.id}" type="number" min="0" max="${balances[cat.id]}" step="0.01" value="0"></div></label>`).join('') || '<span>No hay saldos positivos para transferir.</span>';
  }

  async function handleWeeklyClose(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const person = $('#weeklyPerson').value;
    const cycle = currentCycle(person, data.get('date'));
    if (state.closures.some((closure) => closure.person === person && closure.start === cycle.start && closure.end === cycle.end)) return toast('Semana ya cerrada', 'Ya existe un cierre para ese periodo.', 'danger');
    const summary = periodSummary(person, cycle.start, cycle.end);
    const action = data.get('leftoverAction');
    const actionLabels = { carry: 'Sobrante mantenido para la próxima semana', save_all: 'Sobrante transferido al ahorro', manual: 'Transferencia manual de sobrantes' };
    const ok = await confirmDialog({ title: 'Cerrar la semana', message: `Se guardará el resumen de ${profile(person).name} del ${formatDate(cycle.start)} al ${formatDate(cycle.end)}.`, confirmText: 'Cerrar semana', warning: true });
    if (!ok) return;
    const balances = getBalances(person);
    const savings = savingsCategory(person);
    if (action === 'save_all') {
      categories(person).filter((cat) => cat.id !== savings.id && balances[cat.id] > 0).forEach((cat) => addTransaction({ type: 'transfer', person, amount: round2(balances[cat.id]), fromCategoryId: cat.id, toCategoryId: savings.id, date: data.get('date'), description: `Sobrante del cierre semanal` }, `Sobrante de ${cat.name} enviado a ahorro`));
    } else if (action === 'manual') {
      categories(person).filter((cat) => cat.id !== savings.id).forEach((cat) => {
        const amount = round2(data.get(`manual_${cat.id}`) || 0);
        if (amount > 0) addTransaction({ type: 'transfer', person, amount: Math.min(amount, Math.max(0, balances[cat.id])), fromCategoryId: cat.id, toCategoryId: savings.id, date: data.get('date'), description: `Sobrante manual del cierre semanal` }, `Sobrante manual de ${cat.name} enviado a ahorro`);
      });
    }
    state.closures.push({ id: uid(), person, start: cycle.start, end: cycle.end, closedAt: new Date().toISOString(), action, actionLabel: actionLabels[action], note: data.get('note'), summary });
    audit('week_closed', `${profile(person).name} cerró la semana ${cycle.start} a ${cycle.end}`);
    await persist(); event.currentTarget.reset(); $('#weeklyCloseDate').value = todayString(); renderAll(); toast('Semana cerrada', 'El resumen quedó guardado en el historial.');
  }

  function renderReports() {
    const person = $('#reportPerson').value || 'all';
    const range = $('#reportRange').value || '30';
    const list = filterByRange(state.transactions, range, person);
    const income = totalByType('income', person, list);
    const expenses = totalByType('expense', person, list);
    const net = round2(income - expenses);
    const avgExpense = list.filter((tx) => tx.type === 'expense').length ? round2(expenses / list.filter((tx) => tx.type === 'expense').length) : 0;
    $('#reportMetrics').innerHTML = [
      metricCard('Ingresos del periodo', formatMoney(income), `${list.filter((tx) => tx.type === 'income').length} registros`, '＋', '#0f9d68'),
      metricCard('Gastos del periodo', formatMoney(expenses), `${list.filter((tx) => tx.type === 'expense').length} registros`, '−', '#e53935'),
      metricCard('Resultado', formatMoney(net), net >= 0 ? 'Ingresos menos gastos' : 'El periodo terminó en déficit', '◆', net >= 0 ? '#0b5cff' : '#e53935', net < 0),
      metricCard('Gasto promedio', formatMoney(avgExpense), 'Promedio por movimiento de gasto', '≈', '#7c3aed')
    ].join('');
    drawIncomeExpenseChart(list, person, range);
    const spending = spendingByCategory(list, person);
    drawDonut($('#reportCategoryChart'), spending, 'Gastado');
    renderLegend($('#reportCategoryLegend'), spending.slice(0, 8));
    renderInsights(list, person, income, expenses);
  }

  function drawIncomeExpenseChart(list, person, range) {
    const canvas = $('#incomeExpenseChart');
    const prepared = prepareCanvas(canvas, 300);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);
    const bucketCount = range === '7' ? 7 : 6;
    const days = range === 'all' ? 180 : Number(range);
    const bucketDays = Math.max(1, Math.ceil(days / bucketCount));
    const now = new Date();
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const end = new Date(now); end.setDate(now.getDate() - bucketDays * (bucketCount - index - 1));
      const start = new Date(end); start.setDate(end.getDate() - bucketDays + 1);
      return { start: isoDate(start), end: isoDate(end), income: 0, expense: 0, label: `${start.getDate()}/${start.getMonth() + 1}` };
    });
    list.forEach((tx) => {
      const bucket = buckets.find((item) => tx.date >= item.start && tx.date <= item.end);
      if (!bucket) return;
      if (tx.type === 'income') bucket.income += Number(tx.amount || 0);
      if (tx.type === 'expense') bucket.expense += Number(tx.amount || 0);
    });
    const max = Math.max(1, ...buckets.flatMap((item) => [item.income, item.expense]));
    const left = 38, right = 12, top = 20, bottom = 34, plotW = width - left - right, plotH = height - top - bottom;
    ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = top + plotH * i / 4; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke(); }
    const slot = plotW / buckets.length;
    buckets.forEach((bucket, index) => {
      const barW = Math.min(24, slot * .28); const baseX = left + index * slot + slot / 2;
      const incomeH = bucket.income / max * plotH; const expenseH = bucket.expense / max * plotH;
      ctx.fillStyle = '#0f9d68'; ctx.fillRect(baseX - barW - 2, top + plotH - incomeH, barW, incomeH);
      ctx.fillStyle = '#e53935'; ctx.fillRect(baseX + 2, top + plotH - expenseH, barW, expenseH);
      ctx.fillStyle = cssVar('--muted'); ctx.font = '600 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(bucket.label, baseX, height - 12);
    });
    ctx.fillStyle = '#0f9d68'; ctx.fillRect(left, 4, 9, 9); ctx.fillStyle = cssVar('--muted'); ctx.font = '700 10px system-ui'; ctx.textAlign = 'left'; ctx.fillText('Ingresos', left + 14, 12);
    ctx.fillStyle = '#e53935'; ctx.fillRect(left + 82, 4, 9, 9); ctx.fillStyle = cssVar('--muted'); ctx.fillText('Gastos', left + 96, 12);
  }

  function renderInsights(list, person, income, expenses) {
    const spending = spendingByCategory(list, person);
    const top = spending[0];
    const expenseCount = list.filter((tx) => tx.type === 'expense').length;
    const incomeCount = list.filter((tx) => tx.type === 'income').length;
    const savingsRate = income > 0 ? Math.max(0, ((income - expenses) / income) * 100) : 0;
    const methods = new Map();
    list.filter((tx) => tx.type === 'expense').forEach((tx) => methods.set(tx.method || 'Sin método', (methods.get(tx.method || 'Sin método') || 0) + Number(tx.amount || 0)));
    const topMethod = [...methods.entries()].sort((a, b) => b[1] - a[1])[0];
    const insights = [
      { icon: '◉', title: top ? 'Categoría con mayor gasto' : 'Sin gastos registrados', text: top ? `${top.label}: ${formatMoney(top.value)}.` : 'Todavía no hay datos suficientes.' },
      { icon: '≈', title: 'Frecuencia de movimientos', text: `${incomeCount} ingresos y ${expenseCount} gastos en el periodo.` },
      { icon: '◎', title: 'Margen del periodo', text: income > 0 ? `${savingsRate.toFixed(1)}% de los ingresos quedó después de los gastos.` : 'Registra ingresos para calcular el margen.' },
      { icon: '▣', title: 'Método más usado', text: topMethod ? `${topMethod[0]} concentra ${formatMoney(topMethod[1])} en gastos.` : 'No hay métodos de pago registrados.' },
      { icon: '!', title: 'Saldos negativos actuales', text: `${formatMoney(totalDebt(person))} pendientes por cubrir.` },
      { icon: '◆', title: 'Resultado del periodo', text: income - expenses >= 0 ? `Superávit de ${formatMoney(income - expenses)}.` : `Déficit de ${formatMoney(Math.abs(income - expenses))}.` }
    ];
    $('#insightsList').innerHTML = insights.map((item) => `<div class="insight-card"><span>${item.icon}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></div>`).join('');
  }

  function renderSettings() {
    renderProfileSettings('kianna', $('#kiannaSettingsForm'));
    renderProfileSettings('jorge', $('#jorgeSettingsForm'));
    $('#themeSelect').value = state.settings.theme;
    fillDaySelect($('#kiannaCloseDay'), profile('kianna').closingDay);
    fillDaySelect($('#jorgeCloseDay'), profile('jorge').closingDay);
  }

  function renderProfileSettings(person, form) {
    const p = profile(person);
    form.innerHTML = `${p.categories.map((cat) => `<div class="category-setting-row"><label>Nombre<input name="name_${cat.id}" value="${escapeHtml(cat.name)}" maxlength="30"></label><label>Porcentaje<div class="percentage-wrap"><input name="percent_${cat.id}" data-percent type="number" min="0" max="100" step="1" value="${cat.percent}"><span>%</span></div></label></div>`).join('')}<label>Meta del fondo de emergencia<div class="money-input"><span>$</span><input name="emergencyFund" type="number" min="0" step="0.01" value="${p.emergencyFund || 0}"></div><small class="field-help">Esta cifra es una meta; para mover dinero usa Ahorro y metas → Fondo de emergencia.</small></label><div class="settings-total"><span>Total de porcentajes</span><strong class="valid" data-total>100%</strong></div><button class="btn primary full" type="submit">Guardar configuración de ${p.name}</button>`;
  }

  function fillDaySelect(select, selected) {
    select.innerHTML = DAYS.map((day, index) => `<option value="${index}" ${Number(selected) === index ? 'selected' : ''}>${day}</option>`).join('');
  }

  async function saveProfileSettings(person, form) {
    const data = new FormData(form);
    const p = profile(person);
    const updated = p.categories.map((cat) => ({ ...cat, name: data.get(`name_${cat.id}`)?.trim() || cat.name, percent: Number(data.get(`percent_${cat.id}`) || 0) }));
    const total = updated.reduce((sum, cat) => sum + cat.percent, 0);
    if (total !== 100) return toast('Los porcentajes deben sumar 100%', `Actualmente suman ${total}%.`, 'danger');
    p.categories = updated;
    p.emergencyFund = round2(data.get('emergencyFund') || 0);
    audit('profile_settings_updated', `Se actualizó la configuración de ${p.name}`);
    await persist(); renderAll(); toast('Configuración guardada', `Los próximos ingresos de ${p.name} usarán los nuevos porcentajes.`);
  }

  function applyTheme(theme = state.settings.theme) {
    let resolved = theme;
    if (theme === 'system') resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', resolved === 'dark' ? '#0c1422' : '#0b5cff');
  }

  function navigate(view) {
    if (!VIEW_META[view]) return;
    currentView = view;
    $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
    $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    $('#pageTitle').textContent = VIEW_META[view][0];
    $('#pageSubtitle').textContent = VIEW_META[view][1];
    $('#sidebar').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderCurrentView();
  }

  function renderCurrentView() {
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'movements') renderMovements();
    if (currentView === 'savings') renderSavings();
    if (currentView === 'weekly') renderWeekly();
    if (currentView === 'reports') renderReports();
    if (currentView === 'settings') renderSettings();
  }

  function renderAll() {
    updateIncomePreview();
    updateAllCategorySelects();
    renderCurrentView();
  }

  function exportFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv() {
    const headers = ['Fecha', 'Persona', 'Tipo', 'Descripción', 'Categoría', 'Método', 'Monto'];
    const rows = state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date)).map((tx) => [tx.date, profile(tx.person).name, transactionLabel(tx), transactionDescription(tx), categoryText(tx), tx.method || '', tx.amount]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    exportFile(`DINEX_movimientos_${todayString()}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8');
    toast('CSV generado', 'El historial está listo para abrirse en Excel.');
  }

  function backupJson() {
    exportFile(`DINEX_respaldo_${todayString()}.json`, JSON.stringify(state, null, 2), 'application/json');
    toast('Respaldo descargado', 'Guárdalo en un lugar seguro.');
  }

  async function importBackup(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const ok = await confirmDialog({ title: 'Restaurar respaldo', message: 'Los datos actuales serán reemplazados por el contenido del archivo.', confirmText: 'Restaurar', danger: true });
      if (!ok) return;
      state = normalizeState(parsed); await persist(); renderAll(); toast('Respaldo restaurado', 'DINEX recuperó los datos correctamente.');
    } catch (error) {
      toast('Archivo inválido', 'No pudimos leer ese respaldo JSON.', 'danger');
    }
  }

  function summaryText() {
    const lines = ['DINEX · Resumen financiero', `Fecha: ${formatDate(todayString())}`, ''];
    ['kianna', 'jorge'].forEach((person) => {
      const balances = getBalances(person);
      lines.push(`${profile(person).name}:`);
      categories(person).forEach((cat) => lines.push(`- ${cat.name}: ${formatMoney(balances[cat.id] || 0)}`));
      lines.push(`- Fondo de emergencia: ${formatMoney(getEmergencyBalance(person))} / ${formatMoney(profile(person).emergencyFund || 0)}`);
      lines.push('');
    });
    lines.push(`Ahorro en metas: ${formatMoney(getAllGoalsTotal())}`);
    lines.push(`Deuda acumulada: ${formatMoney(totalDebt())}`);
    lines.push(`Saldo total registrado: ${formatMoney(totalCurrentMoney())}`);
    return lines.join('\n');
  }

  async function copySummary() {
    try { await navigator.clipboard.writeText(summaryText()); toast('Resumen copiado', 'Ya puedes pegarlo en WhatsApp.'); }
    catch { openModal(`<h2 id="modalTitle">Resumen para copiar</h2><textarea rows="14" readonly>${escapeHtml(summaryText())}</textarea><div class="modal-actions"><button class="btn primary" data-modal-result="null">Cerrar</button></div>`); }
  }

  async function loadDemoData() {
    if (state.transactions.length) {
      const ok = await confirmDialog({ title: 'Agregar datos de demostración', message: 'Se agregarán movimientos ficticios sin borrar tus datos actuales.', confirmText: 'Agregar ejemplo', warning: true });
      if (!ok) return;
    }
    const dates = Array.from({ length: 7 }, (_, index) => { const d = new Date(); d.setDate(d.getDate() - (6 - index)); return isoDate(d); });
    const demo = [
      { type: 'income', person: 'kianna', amount: 180, allocations: allocateAmount('kianna', 180), date: dates[0], description: 'Pago semanal' },
      { type: 'expense', person: 'kianna', categoryId: 'weekly_consumption', amount: 18.5, date: dates[1], description: 'Supermercado', method: 'Tarjeta', merchant: 'Supermercado' },
      { type: 'expense', person: 'kianna', categoryId: 'expenses', amount: 12, date: dates[2], description: 'Compra personal', method: 'Yappy' },
      { type: 'income', person: 'jorge', amount: 25, allocations: allocateAmount('jorge', 25), date: dates[0], description: 'Pago del día' },
      { type: 'income', person: 'jorge', amount: 30, allocations: allocateAmount('jorge', 30), date: dates[1], description: 'Pago del día' },
      { type: 'income', person: 'jorge', amount: 22, allocations: allocateAmount('jorge', 22), date: dates[2], description: 'Pago del día' },
      { type: 'expense', person: 'jorge', categoryId: 'gasoline', amount: 10, date: dates[3], description: 'Gasolina', method: 'Efectivo', merchant: 'Estación de servicio' },
      { type: 'expense', person: 'jorge', categoryId: 'weekly_expenses', amount: 14.75, date: dates[4], description: 'Almuerzo', method: 'Yappy' }
    ];
    demo.forEach((tx) => addTransaction(tx, 'Dato de demostración'));
    if (!state.goals.length) state.goals.push({ id: uid(), name: 'Fondo para computadora', person: 'shared', target: 1200, deadline: '', priority: 2, icon: '▣', color: '#0b5cff', createdAt: new Date().toISOString() });
    if (!profile('kianna').emergencyFund) profile('kianna').emergencyFund = 150;
    if (!profile('jorge').emergencyFund) profile('jorge').emergencyFund = 100;
    if (!state.transactions.some((tx) => tx.type === 'emergency_contribution')) {
      addTransaction({ type: 'emergency_contribution', person: 'kianna', amount: 40, fromCategoryId: savingsCategory('kianna').id, date: dates[5], description: 'Primera reserva de emergencia' }, 'Dato de demostración');
      addTransaction({ type: 'emergency_contribution', person: 'jorge', amount: 10, fromCategoryId: savingsCategory('jorge').id, date: dates[5], description: 'Primera reserva de emergencia' }, 'Dato de demostración');
    }
    await persist(); renderAll(); toast('Datos de ejemplo cargados', 'Ya puedes explorar gráficas, saldos, fondos de emergencia y movimientos.');
  }

  function attachEvents() {
    document.addEventListener('click', async (event) => {
      const viewButton = event.target.closest('[data-view]');
      if (viewButton) navigate(viewButton.dataset.view);
      const resultButton = event.target.closest('[data-modal-result]');
      if (resultButton) {
        const raw = resultButton.dataset.modalResult;
        closeModal(raw === 'true' ? true : raw === 'false' ? false : null);
      }
      const choiceButton = event.target.closest('[data-modal-choice]');
      if (choiceButton) closeModal(choiceButton.dataset.modalChoice);
      const actionButton = event.target.closest('[data-action]');
      if (actionButton?.dataset.action === 'edit-tx') editTransaction(actionButton.dataset.id);
      if (actionButton?.dataset.action === 'delete-tx') deleteTransaction(actionButton.dataset.id);
      const goalButton = event.target.closest('[data-goal-action]');
      if (goalButton) goalAction(goalButton.dataset.goalAction, goalButton.dataset.id);
      const emergencyButton = event.target.closest('[data-emergency-action]');
      if (emergencyButton && !emergencyButton.disabled) handleEmergencyAction(emergencyButton.dataset.emergencyAction, emergencyButton.dataset.person);
    });

    $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#modalCloseBtn').addEventListener('click', () => closeModal(null));
    $('#modalBackdrop').addEventListener('click', (event) => { if (event.target === $('#modalBackdrop')) closeModal(null); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('#modalBackdrop').classList.contains('hidden')) closeModal(null); });

    $$('.action-tab').forEach((button) => button.addEventListener('click', () => switchAddForm(button.dataset.form)));
    $('#incomePerson').addEventListener('change', updateIncomePreview);
    $('#incomeAmount').addEventListener('input', updateIncomePreview);
    $('#expensePerson').addEventListener('change', () => { populateCategorySelect($('#expenseCategory'), $('#expensePerson').value); updateExpenseHint(); });
    $('#expenseCategory').addEventListener('change', updateExpenseHint);
    $('#transferPerson').addEventListener('change', () => { populateCategorySelect($('#transferFrom'), $('#transferPerson').value); populateCategorySelect($('#transferTo'), $('#transferPerson').value, categories($('#transferPerson').value)[1]?.id); updateTransferHint(); });
    $('#transferFrom').addEventListener('change', updateTransferHint);
    $('#incomeForm').addEventListener('submit', handleIncomeSubmit);
    $('#expenseForm').addEventListener('submit', handleExpenseSubmit);
    $('#transferForm').addEventListener('submit', handleTransferSubmit);

    $('#categoryProfileSelect').addEventListener('change', renderCategoryBalances);
    ['movementSearch','movementPersonFilter','movementTypeFilter','movementDateFrom','movementDateTo'].forEach((id) => $(`#${id}`).addEventListener(id === 'movementSearch' ? 'input' : 'change', renderMovements));
    $('#clearMovementFilters').addEventListener('click', () => { $('#movementSearch').value = ''; $('#movementPersonFilter').value = 'all'; $('#movementTypeFilter').value = 'all'; $('#movementDateFrom').value = ''; $('#movementDateTo').value = ''; renderMovements(); });

    $('#newGoalBtn').addEventListener('click', () => goalModal());
    $('#newGoalEmptyBtn').addEventListener('click', () => goalModal());
    $('#weeklyPerson').addEventListener('change', renderWeekly);
    $('#weeklyCloseDate').addEventListener('change', renderWeekly);
    $('#leftoverAction').addEventListener('change', renderManualLeftovers);
    $('#weeklyCloseForm').addEventListener('submit', handleWeeklyClose);
    $('#reportPerson').addEventListener('change', renderReports);
    $('#reportRange').addEventListener('change', renderReports);

    $('#kiannaSettingsForm').addEventListener('submit', (event) => { event.preventDefault(); saveProfileSettings('kianna', event.currentTarget); });
    $('#jorgeSettingsForm').addEventListener('submit', (event) => { event.preventDefault(); saveProfileSettings('jorge', event.currentTarget); });
    document.addEventListener('input', (event) => {
      if (!event.target.matches('.settings-form [data-percent]')) return;
      const form = event.target.closest('.settings-form');
      const total = $$('[data-percent]', form).reduce((sum, input) => sum + Number(input.value || 0), 0);
      const element = $('[data-total]', form); element.textContent = `${total}%`; element.className = total === 100 ? 'valid' : 'invalid';
    });

    $('#themeBtn').addEventListener('click', async () => { state.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); $('#themeSelect').value = state.settings.theme; await persist(); renderAll(); });
    $('#themeSelect').addEventListener('change', async (event) => { state.settings.theme = event.target.value; applyTheme(); await persist(); renderAll(); });
    $('#kiannaCloseDay').addEventListener('change', async (event) => { profile('kianna').closingDay = Number(event.target.value); await persist(); renderWeekly(); });
    $('#jorgeCloseDay').addEventListener('change', async (event) => { profile('jorge').closingDay = Number(event.target.value); await persist(); renderWeekly(); });

    $('#exportCsvBtn').addEventListener('click', exportCsv);
    $('#printReportBtn').addEventListener('click', () => window.print());
    $('#exportBackupBtn').addEventListener('click', backupJson);
    $('#importBackupInput').addEventListener('change', (event) => { const file = event.target.files[0]; if (file) importBackup(file); event.target.value = ''; });
    $('#copySummaryBtn').addEventListener('click', copySummary);
    $('#demoDataBtn').addEventListener('click', loadDemoData);
    $('#resetDataBtn').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Borrar todos los datos', message: 'Se eliminarán movimientos, metas, cierres y configuraciones locales. Descarga un respaldo antes si deseas conservarlos.', confirmText: 'Borrar todo', danger: true });
      if (!ok) return;
      await window.DinexStorage.clear(); state = defaultState(); await persist(); applyTheme(); renderAll(); toast('Datos eliminados', 'DINEX volvió a su estado inicial.', 'danger');
    });

    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (currentView === 'dashboard') renderDashboard(); if (currentView === 'savings') renderSavings(); if (currentView === 'reports') renderReports(); }, 180); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.settings.theme === 'system') { applyTheme(); renderAll(); } });
  }

  function updateConnection() {
    const online = navigator.onLine;
    $('#connectionPill').innerHTML = `<span class="status-dot ${online ? 'online' : 'local'}"></span> ${online ? 'En línea' : 'Sin conexión'}`;
    if (!online) toast('Modo sin conexión', 'Los cambios seguirán guardándose en este dispositivo.', 'danger');
  }

  function setDefaultDates() {
    ['incomeDate', 'expenseDate', 'transferDate', 'weeklyCloseDate'].forEach((id) => { $(`#${id}`).value = todayString(); });
  }

  async function init() {
    const loaded = await window.DinexStorage.load();
    state = normalizeState(loaded);
    applyTheme();
    setDefaultDates();
    attachEvents();
    updateAllCategorySelects();
    updateIncomePreview();
    updateConnection();
    renderAll();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker no disponible:', error));
    }
  }

  init();
})();
