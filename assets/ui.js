/* 界面装配：登录、数据集管理、分析对话、结果渲染 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const L = window.APP_LIMITS;

  // 图标走 SVG symbol（定义见 index.html 顶部的 <defs>），避免在 JS 里堆字符串
  const ICON = (n) => '<svg aria-hidden="true"><use href="#i-' + n + '"/></svg>';

  const state = {
    user: null,
    email: '',
    model: null,
    modelList: [],        // 平台模型 + 自定义模型（渲染用）
    platformModels: [],   // 仅平台下发的模型（自动挑选快速模型时只在这里挑）
    datasets: [],
    current: null,       // { id, name, columns, rows }
    history: [],
    otp: null,           // { verificationId, isExistingUser, email }
    reset: null,
    modelError: '',
    busy: false,
  };

  /* ---------------- 启动 ---------------- */
  async function init() {
    Settings.apply();          // 主题 / 密度 / 字号必须在首屏渲染前落下去，否则会闪一下浅色
    bindSettings();
    restoreSidebar();
    bindAuth();
    bindApp();
    try {
      const s = await Cloud.session();
      if (s && s.user) await enterApp(s.user);
      else showAuth();
    } catch (e) {
      showAuth();
    }
  }

  function showAuth() {
    $('#auth-view').hidden = false;
    $('#app-view').hidden = true;
  }

  async function enterApp(user) {
    state.user = user;
    $('#auth-view').hidden = true;
    $('#app-view').hidden = false;
    let email = '已登录';
    try {
      const me = await Cloud.client().auth.getUser();
      if (me && me.data && (me.data.email || me.data.name)) email = me.data.email || me.data.name;
    } catch (e) { /* 拿不到邮箱就用占位文案 */ }
    state.email = email;
    const chip = $('#user-chip');
    chip.innerHTML = '<span class="nm"></span>' + ICON('logout');
    chip.querySelector('.nm').textContent = email;
    await loadModels();
    await loadDatasets();
  }

  function fitLayout() {
    const banners = $$('.banner').filter((b) => !b.hidden).length;
    $('.layout').style.height = `calc(100vh - 56px - ${banners * 44}px)`;
  }

  // 对话内容在 .chat-body 里滚动，滚到底必须作用在真正的滚动容器上
  function scrollThread() {
    const box = $('#chat-body');
    if (box) box.scrollTop = box.scrollHeight;
  }

  // 删除一次失败的对话轮次：把对应的用户问题与 agent 卡片一起移除
  function removeTurn(card) {
    const prev = card.previousElementSibling;
    if (prev && prev.classList.contains('bubble-user')) prev.remove();
    card.remove();
  }

  /* ---------------- 设置中心 ---------------- */
  let setGroup = 'appearance';

  function bindSettings() {
    $('#btn-settings').onclick = () => openSettings('appearance');
    $('#btn-side-settings').onclick = () => { closeSidebarDrawer(); openSettings('appearance'); };
    $('#btn-side-shortcuts').onclick = () => { closeSidebarDrawer(); openSettings('shortcuts'); };
    $('#settings-close').onclick = closeSettings;
    $('#drawer-scrim').onclick = closeSettings;

    $('#btn-reset-settings').onclick = () => {
      if (!confirm('把所有设置恢复为默认值？')) return;
      Settings.reset();
      renderSetContent();
      toast('已恢复默认设置', { type: 'ok' });
    };

    $('#btn-export-settings').onclick = () => {
      download('data-agent-设置备份.json', Settings.exportJSON(), 'application/json');
      toast('设置已导出', { type: 'ok' });
    };
    $('#btn-import-settings').onclick = () => $('#settings-file').click();
    $('#settings-file').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const n = Settings.importJSON(String(r.result));
          renderSetContent();
          toast(`已导入 ${n} 项设置`, { type: 'ok' });
        } catch (err) {
          toast('导入失败：' + Cloud.errText(err), { type: 'err', duration: 5000 });
        }
      };
      r.readAsText(f, 'UTF-8');
      e.target.value = '';
    };

    // 内容区事件委托：一行设置 = 一个控件，改完立刻写回 Settings
    const content = $('#set-content');
    content.addEventListener('change', (e) => {
      const el = e.target;
      const key = el.dataset && el.dataset.key;
      if (!key) return;
      Settings.set(key, el.type === 'checkbox' ? el.checked : coerce(key, el.value));
    });
    content.addEventListener('click', (e) => {
      const seg = e.target.closest('button[data-v]');
      if (seg) {
        const key = seg.parentNode.dataset.key;
        Settings.set(key, coerce(key, seg.dataset.v));
        renderSetContent();
        return;
      }
      const op = e.target.closest('[data-op]');
      if (op) runDataOp(op.dataset.op);
    });

    Settings.subscribe(applySettingsSideEffects);
  }

  // 有些设置落地后还要动到已渲染的内容，不能只靠 CSS 变量
  function applySettingsSideEffects(key) {
    const show = Settings.get('showKpi');
    $$('.kpi-row').forEach((el) => { el.hidden = !show; });
    if (key === 'theme' || key === '*') setTimeout(() => Charts.rerenderAll(), 30);
    if (key === 'model' || key === '*') {
      const pref = Settings.get('model');
      if (pref && state.modelList.some((m) => m.id === pref)) state.model = pref;
      syncModelChips();
    }
    if (key === 'customModels' || key === '*') {
      mergeModelList();
      renderCustomModels();
      renderModelList();
      syncModelChips();
    }
  }

  function coerce(key, v) {
    return typeof Settings.defaults[key] === 'number' ? Number(v) : v;
  }

  function openSettings(group) {
    setGroup = group || setGroup;
    $('#settings-drawer').hidden = false;
    renderSetNav();
    renderSetContent();
  }
  function closeSettings() { $('#settings-drawer').hidden = true; }

  function renderSetNav() {
    const box = $('#set-nav');
    box.innerHTML = Settings.groups.map((g) =>
      `<button type="button" data-g="${g.id}" class="${g.id === setGroup ? 'active' : ''}">${ICON(g.icon)}<span>${esc(g.name)}</span></button>`).join('');
    box.onclick = (e) => {
      const b = e.target.closest('button[data-g]');
      if (!b) return;
      setGroup = b.dataset.g;
      renderSetNav();
      renderSetContent();
    };
  }

  function renderSetContent() {
    const box = $('#set-content');
    const g = Settings.groups.find((x) => x.id === setGroup) || Settings.groups[0];
    if (g.id === 'data') box.innerHTML = dataGroupHtml();
    else if (g.id === 'shortcuts') box.innerHTML = shortcutsHtml();
    else if (g.id === 'about') box.innerHTML = aboutHtml();
    else box.innerHTML = settingsGroupHtml(g);
  }

  function settingsGroupHtml(g) {
    const rows = g.items.map((it) => {
      const hint = it.hint ? `<div class="hint">${esc(it.hint)}</div>` : '';
      return `<div class="set-row"><div><div class="lab">${esc(it.label)}</div>${hint}</div>`
        + `<div class="ctl">${controlHtml(it)}</div></div>`;
    }).join('');
    const desc = g.desc ? `<p class="set-group-desc">${esc(g.desc)}</p>` : '';
    return `<h4 class="set-group-title">${esc(g.name)}</h4>${desc}${rows}`;
  }

  function controlHtml(it) {
    const cur = Settings.get(it.key);
    if (it.type === 'toggle') {
      return `<label class="switch"><input type="checkbox" data-key="${esc(it.key)}"${cur ? ' checked' : ''}`
        + ` aria-label="${esc(it.label)}"><i></i></label>`;
    }
    if (it.type === 'seg') {
      return `<div class="seg" data-key="${esc(it.key)}">` + it.options.map((o) =>
        `<button type="button" data-v="${esc(String(o.v))}" class="${String(cur) === String(o.v) ? 'active' : ''}">${esc(o.t)}</button>`).join('') + '</div>';
    }
    if (it.type === 'model') {
      const opts = [{ v: '', t: '自动（优先快速模型）' }]
        .concat(state.modelList.map((m) => ({ v: m.id, t: m.name || m.id })));
      return selectHtml(it.key, opts, cur);
    }
    return selectHtml(it.key, it.options || [], cur);
  }

  function selectHtml(key, opts, cur) {
    return `<select data-key="${esc(key)}">` + opts.map((o) =>
      `<option value="${esc(String(o.v))}"${String(cur) === String(o.v) ? ' selected' : ''}>${esc(o.t)}</option>`).join('') + '</select>';
  }

  function dataGroupHtml() {
    const dss = state.datasets || [];
    const rows = dss.reduce((a, d) => a + (d.row_count || 0), 0);
    const name = state.current ? state.current.name : '（未选择）';
      const opCard = (icon, title, desc, op) => `<div class="op-card">
        <div class="op-ico">${ICON(icon)}</div>
        <div class="op-t"><div class="t">${esc(title)}</div><div class="d">${esc(desc)}</div></div>
        <button class="btn tiny" data-op="${op}">${ICON('download')}导出</button>
      </div>`;
      return `<h4 class="set-group-title">数据与存储</h4>
      <p class="set-group-desc">数据集与分析记录存在你的云端空间，设置了行级安全策略，只有你能读写。</p>
      <div class="stat-grid">
        <div class="stat-box"><div class="v">${fmtNum(dss.length, false)}</div><div class="k">云端数据集</div></div>
        <div class="stat-box"><div class="v">${fmtNum(rows, false)}</div><div class="k">数据总行数</div></div>
      </div>
      ${opCard('file', '导出当前数据集', `把「${name}」导出为 CSV`, 'csv')}
      ${opCard('file', '导出全部数据集', '含字段结构与全部数据行（JSON）', 'json-all')}
      ${opCard('file', '导出分析历史', '当前数据集的全部提问、分析计划与结论', 'history')}
      ${controlHtml({ key: 'confirmDelete', type: 'toggle' }) ? `<div class="set-row">
        <div><div class="lab">删除前二次确认</div><div class="hint">关闭后删除数据集不再弹确认框，误触会直接删除</div></div>
        <div class="ctl">${controlHtml({ key: 'confirmDelete', type: 'toggle' })}</div>
      </div>` : ''}
      <div class="danger-zone">
        <div class="dz-title">${ICON('alert')}危险操作</div>
        <div class="dz-desc">删除后不可恢复，请先导出备份。</div>
        <div class="dz-actions">
          <button class="btn danger tiny" data-op="clear-history">${ICON('trash')}清空分析历史</button>
          <button class="btn danger tiny" data-op="delete-all">${ICON('trash')}删除全部数据集</button>
        </div>
      </div>`;
  }

  function shortcutsHtml() {
    const items = [
      ['发送问题', ['Enter']],
      ['输入框内换行', ['Shift', 'Enter']],
      ['聚焦提问框', ['Ctrl / ⌘', 'K']],
      ['打开设置', ['Ctrl / ⌘', ',']],
      ['关闭弹窗 / 抽屉 / 菜单', ['Esc']],
      ['收起或展开侧栏', ['点击左上角图标']],
    ];
    return `<h4 class="set-group-title">快捷键</h4>
      <p class="set-group-desc">全局生效，输入框聚焦时 Enter 与 Shift+Enter 仍然优先。</p>
      <div class="kbd-list">` + items.map(([k, v]) =>
        `<div class="kbd-row"><span class="kk">${esc(k)}</span><span class="vv">`
        + v.map((x) => `<kbd>${esc(x)}</kbd>`).join('') + '</span></div>').join('') + '</div>';
  }

  function aboutHtml() {
    const kv = [
      ['版本', '2026.09.22'],
      ['支持格式', 'CSV / TSV / Excel / Stata .dta / JSON / 粘贴表格'],
      ['单数据集上限', fmtNum(L.maxRows, false) + ' 行'],
      ['云端存储', 'PostgreSQL（行级安全，仅本人可读写）'],
      ['图表', 'Apache ECharts 5.5'],
      ['统计格式解析', 'statfmt（ReadStat 纯 TS 移植）'],
    ];
    return `<h4 class="set-group-title">关于</h4>
      <div class="about-hero">
        <div class="brand-mark"><svg><use href="#i-logo"/></svg></div>
        <div class="txt"><h4>数据分析 Agent</h4><p>上传数据，用自然语言提问，自动出图出结论</p></div>
      </div>
      <div class="kv-list">` + kv.map(([k, v]) =>
        `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('') + `</div>
      <div class="note"><div class="note-h">${ICON('shield')}关于数字</div>所有统计结果都由浏览器内的分析引擎真实计算，
        大模型只负责把你的问题翻译成分析计划、以及基于算好的数字撰写结论，不参与任何计算。
        这样可以从根上避免模型编造数字。</div>
      <div class="note"><div class="note-h">${ICON('shield')}关于隐私</div>数据集与分析记录存在你自己的云端空间并开启了行级安全策略；
        界面偏好（主题、密度等）只存在本机浏览器，可随时导出备份或恢复默认。</div>`;
  }

  /* ---------------- 数据管理动作 ---------------- */
  async function runDataOp(op) {
    try {
      if (op === 'csv') {
        if (!state.current || !state.current.rows.length) return toast('请先选择一个数据集', { type: 'warn' });
        download(state.current.name + '.csv', toCSV(state.current), 'text/csv;charset=utf-8');
        toast('已导出 CSV', { type: 'ok' });
      } else if (op === 'json-all') {
        if (!state.datasets.length) return toast('还没有数据集', { type: 'warn' });
        toast('正在打包全部数据集…');
        const out = [];
        for (const d of state.datasets) {
          const rows = await loadRows(d.id, d.row_count || 0);
          out.push({ name: d.name, source: d.source, columns: d.columns || [], row_count: rows.length, rows });
        }
        download('全部数据集.json', JSON.stringify(out, null, 2), 'application/json');
        toast(`已导出 ${out.length} 个数据集`, { type: 'ok' });
      } else if (op === 'history') {
        if (!state.current) return toast('请先选择一个数据集', { type: 'warn' });
        const list = await Cloud.db.list('analyses', {
          select: 'question,kind,summary,created_at,model',
          eq: { dataset_id: state.current.id },
          order: { column: 'created_at', ascending: false },
          limit: 200,
        });
        download(state.current.name + '-分析历史.json', JSON.stringify(list, null, 2), 'application/json');
        toast(`已导出 ${list.length} 条分析记录`, { type: 'ok' });
      } else if (op === 'clear-history') {
        if (!state.current) return toast('请先选择一个数据集', { type: 'warn' });
        if (!confirm(`清空「${state.current.name}」的全部分析历史？此操作不可恢复。`)) return;
        await Cloud.db.remove('analyses', { dataset_id: state.current.id });
        await loadHistory(state.current.id);
        toast('分析历史已清空', { type: 'ok' });
      } else if (op === 'delete-all') {
        if (!state.datasets.length) return toast('还没有数据集', { type: 'warn' });
        if (!confirm(`删除全部 ${state.datasets.length} 个数据集及其数据行与分析记录？此操作不可恢复，建议先导出备份。`)) return;
        for (const d of state.datasets) {
          await Cloud.db.remove('dataset_rows', { dataset_id: d.id });
          await Cloud.db.remove('analyses', { dataset_id: d.id });
          await Cloud.db.remove('datasets', { id: d.id });
        }
        state.current = null;
        await loadDatasets();
        renderSetContent();
        toast('已删除全部数据集', { type: 'ok' });
      }
    } catch (e) {
      toast('操作失败：' + Cloud.errText(e), { type: 'err', duration: 5000 });
    }
  }

  // 导出 CSV：字段带逗号/引号/换行时加引号，前置 BOM 让 Excel 正确识别 UTF-8
  function toCSV(ds) {
    const cols = ds.columns || [];
    const cell = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.map((c) => cell(c.name)).join(',')];
    (ds.rows || []).forEach((r) => lines.push(cols.map((c) => cell(r[c.name])).join(',')));
    return '\ufeff' + lines.join('\r\n');
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------------- 账户菜单 ---------------- */
  function renderUserMenu() {
    const m = $('#user-menu');
    m.innerHTML = `<div class="dd-head"><div class="e">${ICON('user')}<span class="nm"></span></div><div class="s">已登录 · 数据仅本人可见</div></div>`
      + `<button class="mi" data-act="settings">${ICON('gear')}<span>偏好设置</span></button>`
      + `<button class="mi" data-act="data">${ICON('table')}<span>数据管理</span></button>`
      + `<div class="dd-sep"></div>`
      + `<button class="mi danger" data-act="logout">${ICON('logout')}<span>退出登录</span></button>`;
    m.querySelector('.e .nm').textContent = state.email || '已登录';
    m.querySelector('[data-act="settings"]').onclick = () => { closeUserMenu(); openSettings('appearance'); };
    m.querySelector('[data-act="data"]').onclick = () => { closeUserMenu(); openSettings('data'); };
    m.querySelector('[data-act="logout"]').onclick = async () => {
      await Cloud.client().auth.signOut();
      location.reload();
    };
  }

  function toggleUserMenu() {
    const m = $('#user-menu');
    const next = m.hidden;
    if (next) renderUserMenu();
    m.hidden = !next;
    $('#user-chip').setAttribute('aria-expanded', next ? 'true' : 'false');
  }
  function closeUserMenu() {
    $('#user-menu').hidden = true;
    $('#user-chip').setAttribute('aria-expanded', 'false');
  }

  /* ---------------- 侧栏折叠（记住用户偏好，窄屏变抽屉） ---------------- */
  const SIDE_KEY = 'da.sidebar.collapsed';
  function restoreSidebar() {
    if (window.innerWidth <= 900) return;
    let v = '0';
    try { v = localStorage.getItem(SIDE_KEY) || '0'; } catch (e) { /* 无痕模式下不可用 */ }
    document.body.classList.toggle('side-collapsed', v === '1');
  }
  function toggleSidebar() {
    if (window.innerWidth <= 900) {
      const open = document.body.classList.toggle('side-open');
      $('#side-scrim').hidden = !open;
      return;
    }
    const collapsed = document.body.classList.toggle('side-collapsed');
    try { localStorage.setItem(SIDE_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
    // 侧栏宽度是动画过渡的，等过渡结束再让图表按新宽度重排
    setTimeout(resizeCharts, 280);
  }
  function closeSidebarDrawer() {
    document.body.classList.remove('side-open');
    $('#side-scrim').hidden = true;
  }
  function resizeCharts() {
    $$('.chart-box').forEach((el) => {
      const c = window.echarts && echarts.getInstanceByDom(el);
      if (c) c.resize();
    });
  }

  function showModelError(msg) {
    $('#model-error').hidden = false;
    $('#model-error-text').textContent = msg;
    fitLayout();
  }
  function clearModelError() {
    $('#model-error').hidden = true;
    fitLayout();
  }

  /* ---------------- 登录注册 ---------------- */
  function authMsg(text, ok) {
    const el = $('#auth-msg');
    el.textContent = text || '';
    el.className = 'auth-msg' + (ok ? ' ok' : '');
  }

  function bindAuth() {
    $$('#auth-tabs .tab').forEach((t) => {
      t.onclick = () => {
        $$('#auth-tabs .tab').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        const name = t.dataset.tab;
        $$('.auth-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
        authMsg('');
      };
    });

    $('#open-forgot').onclick = () => {
      $$('#auth-tabs .tab').forEach((x) => x.classList.remove('active'));
      $$('.auth-pane').forEach((p) => p.classList.remove('active'));
      $('.auth-pane[data-pane="forgot"]').classList.add('active');
      authMsg('');
    };
    $('#back-to-login').onclick = () => {
      $$('.auth-pane').forEach((p) => p.classList.remove('active'));
      $('.auth-pane[data-pane="password"]').classList.add('active');
      $$('#auth-tabs .tab').forEach((x, i) => x.classList.toggle('active', i === 0));
      authMsg('');
    };

    $('#form-password').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      authMsg('登录中…', true);
      const { data, error } = await Cloud.client().auth.signInWithPassword({
        email: f.email.value.trim(),
        password: f.password.value,
      });
      if (error) return authMsg(Cloud.errText(error));
      await enterApp(data.user || data);
      f.reset();
    };

    $('#btn-send-otp').onclick = async () => {
      const email = $('#form-otp input[name="email"]').value.trim();
      if (!email) return authMsg('请先填写邮箱');
      authMsg('发送中…', true);
      const { data, error } = await Cloud.client().auth.signInWithOtp({ email });
      if (error) return authMsg(Cloud.errText(error));
      state.otp = data;
      authMsg('验证码已发送，请查收邮件', true);
    };

    $('#form-otp').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (!state.otp) return authMsg('请先点击「发送验证码」');
      authMsg('验证中…', true);
      const res = await state.otp.verify({ token: f.code.value.trim() });
      if (res.error) return authMsg(Cloud.errText(res.error));
      const s = await Cloud.session();
      if (!s) return authMsg('验证成功，请稍后重新登录');
      await enterApp(s.user);
      f.reset();
    };

    $('#btn-send-signup-otp').onclick = async () => {
      const email = $('#form-signup input[name="email"]').value.trim();
      if (!email) return authMsg('请先填写邮箱');
      authMsg('发送中…', true);
      const { data, error } = await Cloud.client().auth.sendOtp({ email });
      if (error) return authMsg(Cloud.errText(error));
      state.otp = data;
      authMsg(data.isExistingUser ? '该邮箱已注册，验证后可直接登录' : '验证码已发送，请查收邮件', true);
    };

    $('#form-signup').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const email = f.email.value.trim();
      const password = f.password.value;
      if (password.length < 8) return authMsg('密码至少 8 位');
      if (!state.otp) return authMsg('请先点击「发送验证码」');
      authMsg('创建中…', true);
      const res = await Cloud.client().auth.verifyOtp({
        verificationId: state.otp.verificationId,
        token: f.code.value.trim(),
        email,
        isExistingUser: state.otp.isExistingUser,
        password: state.otp.isExistingUser ? undefined : password,
      });
      if (res.error) return authMsg(Cloud.errText(res.error));
      let s = await Cloud.session();
      if (!s) {
        const r = await Cloud.client().auth.signInWithPassword({ email, password });
        if (!r.error) s = await Cloud.session();
      }
      if (!s) return authMsg('注册完成，请用密码登录');
      await enterApp(s.user);
      f.reset();
    };

    $('#btn-send-reset').onclick = async () => {
      const email = $('#form-forgot input[name="email"]').value.trim();
      if (!email) return authMsg('请先填写邮箱');
      authMsg('发送中…', true);
      const { data, error } = await Cloud.client().auth.resetPasswordForEmail(email);
      if (error) return authMsg(Cloud.errText(error));
      state.reset = data;
      authMsg('重置验证码已发送', true);
    };

    $('#form-forgot').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (!state.reset) return authMsg('请先点击「发送验证码」');
      authMsg('重置中…', true);
      const res = await state.reset.updateUser({ nonce: f.code.value.trim(), password: f.newPassword.value });
      if (res.error) return authMsg(Cloud.errText(res.error));
      const s = await Cloud.session();
      if (!s) return authMsg('密码已重置，请返回登录');
      await enterApp(s.user);
      f.reset();
    };
  }

  /* ---------------- 主界面事件 ---------------- */
  function bindApp() {
    $('#side-toggle').onclick = toggleSidebar;
    $('#side-scrim').onclick = closeSidebarDrawer;
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        switchView('chat');
        $('#question').focus();
        return;
      }
      if (mod && e.key === ',') { e.preventDefault(); openSettings(); return; }
      if (e.key !== 'Escape') return;
      if (!$('#model-dialog').hidden) closeModelDialog();
      else if (!$('#settings-drawer').hidden) closeSettings();
      else if (!$('#modal').hidden) closeModal();
      else if (!$('#user-menu').hidden) closeUserMenu();
      else if (document.body.classList.contains('side-open')) closeSidebarDrawer();
    });
    // 点击空白处收起账户菜单
    document.addEventListener('click', (e) => {
      if ($('#user-menu').hidden) return;
      if (!e.target.closest('.menu-wrap')) closeUserMenu();
    });

    $('#user-chip').onclick = toggleUserMenu;
    bindModelDialog();

    $('#composer-new').onclick = () => openModal();
    $('#composer-settings').onclick = () => openSettings();

    $('#btn-retry-models').onclick = async () => {
      $('#btn-retry-models').disabled = true;
      await loadModels();
      $('#btn-retry-models').disabled = false;
    };
    $('#btn-relogin').onclick = async () => {
      try { await Cloud.client().auth.signOut(); } catch (e) { /* 会话已失效时直接刷新 */ }
      location.reload();
    };

    $('#btn-new-dataset').onclick = () => openModal();
    $('#btn-empty-upload').onclick = () => openModal();
    $('#btn-empty-sample').onclick = async () => {
      await importTable('示例电商销售数据', Parse.sampleData(), 'sample');
    };
    $('#modal-close').onclick = closeModal;
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };

    $$('#src-tabs .tab').forEach((t) => {
      t.onclick = () => {
        $$('#src-tabs .tab').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        $$('.src-pane').forEach((p) => p.classList.toggle('active', p.dataset.src === t.dataset.src));
      };
    });

    const dz = $('#drop-zone');
    const fileInput = $('#file-input');
    // input 就在 drop-zone 里面，必须排除它自己触发的事件，否则会无限递归
    dz.onclick = (e) => { if (e.target !== fileInput) fileInput.click(); };
    $('#file-input').onchange = (e) => { if (e.target.files[0]) readFile(e.target.files[0]); };
    $('#sheet-select').onchange = (e) => { if (state.workbook) applySheet(e.target.value); };
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });

    $('#btn-import').onclick = async () => {
      const src = $('#src-tabs .tab.active').dataset.src;
      const hint = $('#import-hint');
      try {
        hint.style.color = '';
        if (src === 'file') {
          if (!state.parsed) return toast('请先选择数据文件');
          await importTable($('#ds-title').value.trim() || state.fileName, state.parsed, 'file');
        } else if (src === 'paste') {
          const text = $('#paste-area').value;
          if (!text.trim()) return toast('请粘贴数据内容');
          const parsed = Parse.fromText(text);
          await importTable($('#ds-title').value.trim() || '粘贴数据 ' + new Date().toLocaleString('zh-CN'), parsed, 'paste');
        } else {
          await importTable($('#ds-title').value.trim() || '示例电商销售数据', Parse.sampleData(), 'sample');
        }
      } catch (err) {
        console.error('[数据分析 Agent] 导入失败：', err);
        // 错误要留在弹窗里，不能只靠一闪而过的 toast，否则看起来就像"卡住了"
        hint.style.color = '#b42318';
        hint.textContent = '导入失败：' + Cloud.errText(err)
          + (Cloud.isAuthError(err) ? '（请关闭弹窗后点击右上角「退出」重新登录）' : '（可重试）');
        toast('导入失败：' + Cloud.errText(err), 6000);
      }
    };

    $$('#main-tabs .tab').forEach((t) => {
      t.onclick = () => {
        $$('#main-tabs .tab').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === t.dataset.view));
      };
    });

    $$('#quick-chips .chip').forEach((c) => { c.onclick = () => ask(c.dataset.q); });

    // 数据清洗入口（预览页）——结果同样走对话区，方便追问
    $('#btn-clean').onclick = () => {
      const q = $('#clean-q').value.trim();
      if (!q) return toast('请用一句话描述要做的清洗处理');
      $('#clean-q').value = '';
      switchView('chat');
      ask(q);
    };
    $('#clean-q').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-clean').click(); };
    $$('[data-clean]').forEach((c) => {
      c.onclick = () => { switchView('chat'); ask(c.dataset.clean); };
    });
    $('#btn-ask').onclick = () => ask($('#question').value.trim());
    $('#question').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($('#question').value.trim()); }
    };

    $('#btn-delete-dataset').onclick = deleteCurrent;

    window.addEventListener('resize', resizeCharts);
  }

  /* ---------------- 模型 ---------------- */
  // 默认优先挑"可关闭思考"的快速模型，避免每次分析都走一遍高开销推理。
  // 只在平台下发的模型里挑：自定义模型的开销未知，不能自动选中。
  function pickFastModel(list) {
    const src = (list || []).filter((m) => !m.custom);
    return src.find((m) => m.reasoning && m.reasoning.canDisableThinking === true)
      || src.find((m) => !m.onlyReasoning)
      || src[0]
      || null;
  }

  /* --------- 自定义模型 ---------
     平台目录里没有的模型（新上线、内部/微调模型、第三方网关上的模型）可以按 id 手动维护，
     存 localStorage，随设置备份一起导出。调用时直接把 id 传给云端网关，
     id 不合法会在分析时报出来，不会静默失败。
     列表支持增 / 改 / 删，每条记录是 { id, name, provider }。 */
  let editingCustomId = null;   // 非 null 时表单处于「编辑」模式

  function customModels() {
    const v = Settings.get('customModels');
    return Array.isArray(v) ? v.filter((m) => m && m.id) : [];
  }

  function saveCustomModels(list) {
    Settings.set('customModels', list);
  }

  function customFormEls() {
    return { id: $('#custom-id'), name: $('#custom-name'), provider: $('#custom-provider') };
  }

  function setCustomFormMode(edit) {
    const add = $('#custom-add');
    const cancel = $('#custom-cancel');
    if (add) add.textContent = edit ? '保存修改' : '添加';
    // 用 class 切换显隐，不要用 hidden 属性（作者样式会盖掉 UA 的 [hidden]）
    if (cancel) cancel.classList.toggle('hidden-btn', !edit);
  }

  function resetCustomForm() {
    editingCustomId = null;
    const f = customFormEls();
    if (f.id) f.id.value = '';
    if (f.name) f.name.value = '';
    if (f.provider) f.provider.value = '';
    setCustomFormMode(false);
    renderCustomModels();
  }

  function startEditCustom(id) {
    const m = customModels().find((x) => x.id === id);
    if (!m) return;
    editingCustomId = id;
    const f = customFormEls();
    if (f.id) f.id.value = m.id;
    if (f.name) f.name.value = m.name || '';
    if (f.provider) f.provider.value = m.provider || '';
    setCustomFormMode(true);
    renderCustomModels();   // 让被编辑的那一行高亮出来
    if (f.id) f.id.focus();
  }

  // 新增和编辑共用一套提交逻辑：以 editingCustomId 区分
  function submitCustomForm() {
    const f = customFormEls();
    const id = String((f.id && f.id.value) || '').trim();
    const name = String((f.name && f.name.value) || '').trim();
    const provider = String((f.provider && f.provider.value) || '').trim();
    if (!id) return toast('请填写模型 ID');
    const list = customModels();
    // 改 id 时不能撞到别的记录上
    if (list.some((m) => m.id === id && m.id !== editingCustomId)) {
      return toast('模型 ID 已存在：' + id);
    }
    const next = list.filter((m) => m.id !== (editingCustomId || id));
    next.push({ id, name: name || id, provider: provider || '' });
    // 改了 id 就把正在使用的模型跟过去，避免指向一个已经不存在的 id
    if (editingCustomId && editingCustomId !== id && state.model === editingCustomId) state.model = id;
    const wasEdit = !!editingCustomId;
    saveCustomModels(next);
    resetCustomForm();
    mergeModelList();
    renderCustomModels();
    renderModelList();
    syncModelChips();
    toast(wasEdit ? '已更新模型 ' + id : '已添加自定义模型 ' + id, { type: 'ok' });
  }

  function removeCustomModel(id) {
    saveCustomModels(customModels().filter((m) => m.id !== id));
    if (editingCustomId === id) resetCustomForm();
    // 正在用的就是这个模型时要退回一个仍然可用的模型，否则会带着失效 id 去请求
    if (state.model === id) {
      const fast = pickFastModel(state.platformModels);
      state.model = (fast && fast.id) || (state.platformModels[0] && state.platformModels[0].id) || null;
    }
    mergeModelList();
    renderCustomModels();
    renderModelList();
    syncModelChips();
  }

  // 平台模型在前、自定义在后，统一成渲染用的 modelList
  function mergeModelList() {
    const custom = customModels().map((m) => ({
      id: m.id, name: m.name || m.id, provider: m.provider || '', custom: true,
    }));
    state.modelList = (state.platformModels || []).concat(custom);
  }

  function modelName(id) {
    const m = (state.modelList || []).find((x) => x.id === id);
    return m ? (m.name || m.id) : (id || '未选择模型');
  }

  // 输入框内的 chip 显示当前生效的模型
  function syncModelChips() {
    const nm = state.model ? modelName(state.model) : '无可用模型';
    const c = $('.nm', $('#composer-model'));
    if (c) c.textContent = nm;
    if (!$('#model-dialog').hidden) {
      draftModel = state.model;
      renderModelList();
      renderDefaultModelSelect();
    }
  }

  async function loadModels() {
    try {
      const list = await Cloud.models();
      state.platformModels = list || [];
      mergeModelList();
      if (!list.length) {
        // 平台目录为空但用户自己加过模型时，仍然让自定义模型可用
        if (!state.modelList.length) {
          state.model = null;
          state.modelError = '模型目录返回为空，该应用可能尚未分配可用模型。';
          showModelError(state.modelError);
          syncModelChips();
          $('#model-list').innerHTML = '<p class="muted small">当前没有可用模型，请点击页面顶部的「重试」。</p>';
          return;
        }
        state.model = state.modelList[0].id;
        // 自定义模型走的是同一套网关，目录为空时提示仍然保留，避免用户以为是静默成功
        showModelError('平台模型目录返回为空，当前使用自定义模型（可能同样不可用）。');
        syncModelChips();
        return;
      }
      clearModelError();
      state.modelError = '';
      // 设置里指定了默认模型就用它（可能是自定义模型），否则回落到自动挑选的快速模型
      const pref = Settings.get('model');
      const fast = pickFastModel(state.modelList);
      if (pref && state.modelList.some((m) => m.id === pref)) state.model = pref;
      else if (state.model && state.modelList.some((m) => m.id === state.model)) state.model = state.model;
      else state.model = (fast && fast.id) || state.modelList[0].id;
      syncModelChips();
    } catch (e) {
      console.error('[数据分析 Agent] 模型列表加载失败：', e);
      state.platformModels = [];
      mergeModelList();
      state.model = state.modelList.length ? state.modelList[0].id : null;
      state.modelError = Cloud.errText(e);
      showModelError('模型列表加载失败：' + state.modelError
        + (state.modelList.length ? '（当前回退到自定义模型）' : ''));
      syncModelChips();
      if (!state.modelList.length) {
        $('#model-list').innerHTML = '<p class="muted small">模型列表加载失败，请点击页面顶部的「重试」。</p>';
      }
    }
  }

  /* --------- 模型选择对话框 --------- */
  let draftModel = null;   // 对话框里未确认的选择，点「确认」后才落到 state.model

  function bindModelDialog() {
    $('#composer-model').onclick = openModelDialog;
    $('#model-dialog-close').onclick = closeModelDialog;
    $('#model-dialog-cancel').onclick = closeModelDialog;
    $('#model-dialog').onclick = (e) => { if (e.target.id === 'model-dialog') closeModelDialog(); };
    $('#model-search').oninput = () => renderModelList();
    $('#model-dialog-confirm').onclick = () => {
      if (draftModel && draftModel !== state.model) {
        state.model = draftModel;
        toast('已切换到 ' + modelName(draftModel), { type: 'ok' });
      }
      syncModelChips();
      closeModelDialog();
    };
    // 对话框里的「模型设置」：把当前选择/指定模型写进偏好，下次打开自动生效
    $('#default-model-select').onchange = (e) => {
      Settings.set('model', e.target.value);
      toast(e.target.value ? '默认模型已更新' : '已恢复为自动选择', { type: 'ok' });
    };

    // 自定义模型：按 id 直接调用云端网关，列表可增 / 改 / 删
    $('#custom-add').onclick = submitCustomForm;
    $('#custom-cancel').onclick = resetCustomForm;
    ['#custom-id', '#custom-name', '#custom-provider'].forEach((sel) => {
      const el = $(sel);
      if (el) el.onkeydown = (e) => { if (e.key === 'Enter') submitCustomForm(); };
    });
    $('#custom-list').onclick = (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) { startEditCustom(edit.dataset.edit); return; }
      const del = e.target.closest('[data-del]');
      if (del) removeCustomModel(del.dataset.del);
    };
  }

  function openModelDialog() {
    draftModel = state.model;
    $('#model-search').value = '';
    renderModelList();
    renderDefaultModelSelect();
    renderCustomModels();
    $('#model-dialog').hidden = false;
    const sel = $('#model-search');
    if (sel) setTimeout(() => sel.focus(), 20);
  }

  function closeModelDialog() {
    $('#model-dialog').hidden = true;
  }

  function renderModelList() {
    const box = $('#model-list');
    if (!box) return;
    const q = String(($('#model-search') && $('#model-search').value) || '').trim().toLowerCase();
    const list = (state.modelList || []).filter((m) =>
      !q || String(m.name || '').toLowerCase().includes(q) || String(m.id || '').toLowerCase().includes(q));
    if (!list.length) {
      box.innerHTML = '<p class="muted small">' + (state.modelList.length ? '没有匹配的模型' : '暂无可用模型，可在下方添加自定义模型') + '</p>';
      return;
    }
    const fast = pickFastModel(state.modelList);
    box.innerHTML = list.map((m) => {
      const badges = [];
      if (m.custom) badges.push('<span class="model-badge custom">自定义</span>');
      if (m.provider) badges.push('<span class="model-badge provider">' + esc(m.provider) + '</span>');
      if (fast && m.id === fast.id) badges.push('<span class="model-badge recommended">推荐</span>');
      if (m.onlyReasoning) badges.push('<span class="model-badge">推理型</span>');
      else if (m.reasoning && m.reasoning.canDisableThinking) badges.push('<span class="model-badge">可关闭思考</span>');
      return '<button type="button" class="model-item' + (m.id === draftModel ? ' active' : '') + '" data-id="' + esc(m.id) + '">'
        + '<span class="check">' + ICON('check') + '</span>'
        + '<span class="body"><span class="name">' + esc(m.name || m.id) + '</span>'
        + '<span class="desc">' + esc(m.id) + '</span></span>'
        + '<span class="badges">' + badges.join('') + '</span></button>';
    }).join('');
    box.onclick = (e) => {
      const it = e.target.closest('.model-item');
      if (!it) return;
      draftModel = it.dataset.id;
      renderModelList();
    };
  }

  function renderCustomModels() {
    const box = $('#custom-list');
    const cnt = $('#custom-count');
    if (!box) return;
    const list = customModels();
    if (cnt) cnt.textContent = String(list.length);
    if (!list.length) {
      box.innerHTML = '<p class="muted small">还没有自定义模型</p>';
      return;
    }
    box.innerHTML = list.map((m) => {
      const pv = m.provider ? '<span class="pv">' + esc(m.provider) + '</span>' : '';
      const editing = m.id === editingCustomId ? ' editing' : '';
      return '<div class="custom-item' + editing + '">'
        + '<span class="body"><span class="name">' + esc(m.name || m.id) + pv + '</span>'
        + '<span class="desc">' + esc(m.id) + '</span></span>'
        + '<button type="button" class="btn ghost tiny" data-edit="' + esc(m.id) + '">编辑</button>'
        + '<button type="button" class="btn link tiny" data-del="' + esc(m.id) + '">删除</button></div>';
    }).join('');
  }

  function renderDefaultModelSelect() {
    const sel = $('#default-model-select');
    if (!sel) return;
    const cur = Settings.get('model') || '';
    sel.innerHTML = '<option value="">自动（优先快速模型）</option>'
      + (state.modelList || []).map((m) => '<option value="' + esc(m.id) + '">' + esc(m.name || m.id) + '</option>').join('');
    sel.value = cur;
  }

  /* ---------------- 数据集 ---------------- */
  async function loadDatasets() {
    const list = await Cloud.db.list('datasets', { select: 'id,name,columns,row_count,source,created_at', order: { column: 'created_at', ascending: false } });
    state.datasets = list;
    renderDatasetList();
    if (!list.length) {
      $('#empty-state').hidden = false;
      $('#workspace').hidden = true;
      return;
    }
    const keep = state.current && list.find((d) => d.id === state.current.id);
    await selectDataset(keep || list[0]);
  }

  function renderDatasetList() {
    const box = $('#dataset-list');
    box.innerHTML = '';
    if (!state.datasets.length) {
      box.innerHTML = '<p class="muted small">还没有数据集，点击「+ 新建」导入</p>';
      return;
    }
    state.datasets.forEach((d) => {
      const el = document.createElement('div');
      el.className = 'ds-item' + (state.current && state.current.id === d.id ? ' active' : '');
      el.innerHTML = `<span class="ds-ico">${ICON(srcIcon(d.source))}</span>`
        + `<div class="ds-body"><div class="t"></div>`
        + `<div class="s"><span></span><i class="dot"></i><span></span></div></div>`;
      el.querySelector('.t').textContent = d.name;
      const meta = el.querySelectorAll('.s span');
      meta[0].textContent = `${d.row_count} 行 · ${(d.columns || []).length} 字段`;
      meta[1].textContent = sourceLabel(d.source);
      el.title = d.name + (d.created_at ? '\n导入于 ' + new Date(d.created_at).toLocaleString('zh-CN') : '');
      el.onclick = () => { selectDataset(d); closeSidebarDrawer(); };
      box.appendChild(el);
    });
  }

  function srcIcon(s) {
    return { file: 'table', paste: 'clipboard', sample: 'sparkles', clean: 'broom' }[s] || 'table';
  }

  async function selectDataset(d) {
    $('#empty-state').hidden = true;
    $('#workspace').hidden = false;
    $('#ds-name').textContent = d.name;
    setDsMeta(['加载中…']);
    state.current = { id: d.id, name: d.name, columns: d.columns || [], rows: [] };
    renderDatasetList();
    $('#schema-cards').innerHTML = new Array(4).fill('<div class="skeleton" style="height:64px;width:172px;border-radius:12px"></div>').join('');

    const rows = await loadRows(d.id, d.row_count || 0);
    state.current.rows = rows;
    setDsMeta([`${rows.length} 行`, `${state.current.columns.length} 个字段`, `来源：${sourceLabel(d.source)}`]);
    renderSchema();
    renderPreview();
    $('#thread').innerHTML = '';
    await loadHistory(d.id);
  }

  function setDsMeta(items) {
    $('#ds-meta').innerHTML = (items || []).filter(Boolean).map((x) => `<span class="m">${esc(x)}</span>`).join('');
  }

  async function loadRows(id, expected) {
    const out = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const chunk = await Cloud.db.list('dataset_rows', {
        select: 'row_index,data',
        eq: { dataset_id: id },
        order: { column: 'row_index', ascending: true },
        range: [from, from + size - 1],
      });
      chunk.forEach((r) => out.push(r.data));
      if (chunk.length < size) break;
      if (expected && out.length >= expected) break;
      if (out.length >= L.maxRows) break;
    }
    return out;
  }

  function sourceLabel(s) {
    return { file: '文件上传', paste: '粘贴导入', sample: '示例数据', clean: '清洗结果' }[s] || '导入';
  }

  /* 文件解析状态条：ok=true 成功（绿）/ false 失败（红）/ 其它 进行中（灰） */
  function fileNote(text, ok) {
    const box = $('#file-note');
    if (!text) { box.innerHTML = ''; return; }
    if (ok === true) box.innerHTML = `<div class="file-ok">${ICON('check')}<span></span></div>`;
    else if (ok === false) box.innerHTML = `<div class="file-bad">${ICON('alert')}<span></span></div>`;
    else box.innerHTML = '<p class="muted small"></p>';
    const slot = box.querySelector('span:not([aria-hidden]), p');
    if (slot) slot.textContent = text;
  }

  function readFile(file) {
    state.currentFileName = file.name;
    const reader = new FileReader();
    reader.onerror = () => fileNote('读取文件失败', false);
    if (Parse.isExcel(file.name)) {
      reader.onload = () => {
        try {
          state.workbook = Parse.workbook(reader.result);
          const sel = $('#sheet-select');
          sel.innerHTML = '';
          state.workbook.sheets.forEach((n) => {
            const o = document.createElement('option');
            o.value = n; o.textContent = n;
            sel.appendChild(o);
          });
          $('#sheet-row').hidden = state.workbook.sheets.length < 2;
          applySheet(sel.value);
        } catch (e) {
          fileNote('解析失败：' + Cloud.errText(e), false);
          state.parsed = null;
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }
    if (Parse.isStata(file.name)) {
      reader.onload = async () => {
        try {
          $('#file-note').innerHTML = '<p class="muted small">正在解析 Stata 文件…</p>';
          const parsed = await Parse.fromStata(new Uint8Array(reader.result));
          state.parsed = parsed;
          state.fileName = String(state.currentFileName || 'stata').replace(/\.[^.]+$/, '');
          const labels = parsed.meta.appliedLabels.length;
          fileNote(`已解析：${parsed.rows.length} 行 × ${parsed.columns.length} 字段`
            + `（Stata ${parsed.meta.version || '未知版本'}）`
            + (labels ? ` · 已还原 ${labels} 个字段的取值标签` : ''), true);
          $('#ds-title').value = parsed.meta.fileLabel || state.fileName;
        } catch (e) {
          fileNote('解析失败：' + Cloud.errText(e), false);
          state.parsed = null;
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }
    reader.onload = () => {
      try {
        state.parsed = Parse.fromText(reader.result);
      state.fileName = file.name.replace(/\.[^.]+$/, '');
      fileNote(`已解析：${state.parsed.rows.length} 行 × ${state.parsed.columns.length} 字段`, true);
      $('#ds-title').value = state.fileName;
    } catch (e) {
      fileNote('解析失败：' + Cloud.errText(e), false);
    }
    };
    reader.readAsText(file, 'UTF-8');
  }

  function applySheet(name) {
    try {
      const parsed = state.workbook.use(name);
      state.parsed = parsed;
      const base = String(state.currentFileName || '表格').replace(/\.[^.]+$/, '');
      state.fileName = state.workbook.sheets.length > 1 ? base + ' · ' + name : base;
      fileNote(`已解析：${parsed.rows.length} 行 × ${parsed.columns.length} 字段（工作表：${name}）`, true);
      $('#ds-title').value = state.fileName;
    } catch (e) {
      fileNote('解析失败：' + Cloud.errText(e), false);
      state.parsed = null;
    }
  }

  function switchView(name) {
    $$('#main-tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.view === name));
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  }

  async function importTable(name, parsed, source, autoAnalyze = true) {
    if (!parsed.rows.length) throw new Error('没有解析出数据行');
    const rows = parsed.rows.slice(0, L.maxRows);
    const truncated = parsed.rows.length > L.maxRows;
    $('#btn-import').disabled = true;
    $('#import-hint').textContent = '正在写入云端…';
    try {
      const meta = parsed.columns.map((c) => ({
        name: c.name, type: c.type, unique: c.unique, sample: c.sample,
        labels: c.labels || null, desc: c.desc || null,
      }));
      const created = await Cloud.db.importDataset({
        name: name.slice(0, 60),
        source,
        columns: meta,
      }, rows);
      const ds = created[0];
      if (!ds || !ds.id) throw new Error('数据集创建失败：服务端未返回数据集 ID');
      closeModal();
      toast(truncated ? `已导入 ${rows.length} 行（超出上限，已截断）` : `已导入 ${rows.length} 行数据`);
      await loadDatasets();
      const fresh = state.datasets.find((d) => d.id === ds.id);
      if (fresh) {
        await selectDataset(fresh);
        if (autoAnalyze && Settings.get('autoAnalyze')) ask('给我一份这份数据的整体概览');
      }
    } finally {
      $('#btn-import').disabled = false;
      $('#import-hint').textContent = '';
      $('#import-hint').style.color = '';
    }
  }

  async function deleteCurrent() {
    if (!state.current) return;
    if (Settings.get('confirmDelete')
      && !confirm(`确定删除数据集「${state.current.name}」？该数据集的所有数据行与分析记录都会被删除，且无法恢复。`)) return;
    await Cloud.db.remove('dataset_rows', { dataset_id: state.current.id });
    await Cloud.db.remove('analyses', { dataset_id: state.current.id });
    await Cloud.db.remove('datasets', { id: state.current.id });
    state.current = null;
    toast('数据集已删除');
    await loadDatasets();
  }

  /* ---------------- 渲染 ---------------- */
  function renderSchema() {
    const box = $('#schema-cards');
    box.innerHTML = '';
    state.current.columns.forEach((c) => {
      const el = document.createElement('div');
      el.className = 'schema-card';
      const t = c.type === 'number' ? '数值' : c.type === 'date' ? '日期' : '文本';
      el.innerHTML = `<div class="n"><i class="ty" data-t="${esc(c.type)}"></i><span class="nm"></span></div>`
        + `<div class="t">${t} · ${c.unique} 个取值</div><div class="v"></div>`;
      el.querySelector('.nm').textContent = c.name;
      el.querySelector('.v').textContent = c.labels
        ? '取值标签：' + c.labels
        : (c.type === 'number' && c.min !== null
          ? `${c.min} ~ ${c.max}`
          : (c.sample || []).slice(0, 3).join('、'));
      if (c.labels || c.desc) el.title = (c.desc ? c.desc + '\n' : '') + (c.labels || '');
      box.appendChild(el);
    });
  }

  // 空值统一显示为「—」，避免 undefined / NaN / 空串裸露在表格里
  function cellHtml(v, isNum) {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) {
      return isNum ? '<td class="num nil">—</td>' : '<td class="nil">—</td>';
    }
    return isNum ? `<td class="num">${esc(String(v))}</td>` : `<td>${esc(String(v))}</td>`;
  }

  function renderPreview() {
    const cols = state.current.columns;
    const rows = state.current.rows.slice(0, L.previewRows);
    const t = $('#preview-table');
    t.innerHTML = '<thead><tr>' + cols.map((c) => `<th>${esc(c.name)}</th>`).join('') + '</tr></thead><tbody>'
      + rows.map((r) => '<tr>' + cols.map((c) => cellHtml(r[c.name], c.type === 'number')).join('') + '</tr>').join('')
      + '</tbody>';
  }

  /* ---------------- 分析对话 ---------------- */
  // Agent 会依次回调：理解问题 → 计算/执行 → 生成结论，这里映射成三步进度点
  const STAGES = ['理解问题', '执行计算', '生成结论'];
  function stageIndex(text) {
    if (/理解问题/.test(text)) return 0;
    if (/计算指标|执行数据处理/.test(text)) return 1;
    if (/生成结论|整理处理说明/.test(text)) return 2;
    return -1;
  }

  async function ask(question) {
    if (!question) return;
    if (state.busy) return toast('正在分析中，请稍候');
    if (!state.current || !state.current.rows.length) return toast('请先选择或导入数据集');
    // 模型目录可能只是当时没拉到，这里给一次自愈机会，仍失败则把真实原因显示出来
    if (!state.model) await loadModels();
    if (!state.model) {
      showModelError(state.modelError || '尚未获取到可用模型');
      return toast('还没有可用模型，原因已显示在页面顶部，可点「重试」');
    }

    $('#question').value = '';
    const thread = $('#thread');
    const q = document.createElement('div');
    q.className = 'bubble-user';
    q.textContent = question;
    thread.appendChild(q);

    const card = document.createElement('div');
    card.className = 'bubble-agent';
    card.dataset.question = question;
    card.innerHTML = '<div class="stage"><span class="spinner"></span>'
      + '<span class="stage-steps">' + STAGES.map((s, i) => `<i class="stage-dot" data-i="${i}"></i>`).join('') + '</span>'
      + '<span class="stage-text">准备中…</span></div>';
    thread.appendChild(card);
    scrollThread();

    state.busy = true;
    $('#btn-ask').disabled = true;
    const stageText = $('.stage-text', card);
    let acc = '';

    try {
      const out = await Agent.analyze({
        model: state.model,
        dataset: state.current,
        question,
        prefs: Settings.all(),
        onStage: (s) => {
          stageText.textContent = s;
          const idx = stageIndex(s);
          if (idx >= 0) {
            $$('.stage-dot', card).forEach((d) => d.classList.toggle('on', Number(d.dataset.i) <= idx));
          }
        },
        onResult: (plan, res, task) => {
          if (task === 'clean') renderClean(card, { plan, clean: res, report: '' }, question);
          else renderResult(card, { plan, result: res, report: '' }, question);
        },
        onDelta: (d) => {
          acc += d;
          const rep = $('.report', card);
          if (rep) { rep.innerHTML = miniMd(acc); rep.classList.add('cursor'); }
        },
        onRestart: () => {
          acc = '';
          const rep = $('.report', card);
          if (rep) rep.innerHTML = '';
        },
      });
      if (out.task === 'clean') {
        renderClean(card, out, question);
      } else {
        renderResult(card, out, question);
        saveAnalysis(question, out);
      }
    } catch (e) {
      const qText = esc(card.dataset.question || '');
      const errMsg = esc(Cloud.errText(e));
      card.innerHTML = `<div class="error-box">${ICON('alert')}<span class="err-txt">分析失败：${errMsg}</span>`
        + `<div class="error-actions">`
        + `<button type="button" class="btn ghost tiny retry-turn" data-q="${qText}">${ICON('refresh')}重新分析</button>`
        + `<button type="button" class="btn link tiny delete-turn">删除</button>`
        + `</div></div>`;
      $('.retry-turn', card).onclick = (ev) => {
        ev.stopPropagation();
        const q = ev.currentTarget.dataset.q;
        if (q) {
          removeTurn(card);
          ask(q);
        }
      };
      $('.delete-turn', card).onclick = (ev) => {
        ev.stopPropagation();
        removeTurn(card);
      };
    } finally {
      state.busy = false;
      $('#btn-ask').disabled = false;
      scrollThread();
    }
  }

  /* ---------- 关键指标卡片 ----------
     数字全部来自引擎算好的 result.stats，这里只做挑选和格式化，不参与任何计算 */
  const r1 = (n) => Number(n).toFixed(1).replace(/\.0$/, '');
  // abbrev=false 用于行数、周期数这类计数，不能缩写成「万 / 亿」
  function fmtNum(v, abbrev) {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    const abs = Math.abs(n);
    if (abbrev !== false) {
      if (abs >= 1e8) return r1(n / 1e8) + '亿';
      if (abs >= 1e4) return r1(n / 1e4) + '万';
    }
    if (Number.isInteger(n)) return n.toLocaleString('zh-CN');
    return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }
  function pct(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function kpisFor(r) {
    const s = r.stats || {};
    const out = [];
    const has = (v) => v !== undefined && v !== null && v !== '';
    if (r.kind === 'summary') {
      out.push({ k: '数据行数', v: fmtNum(s.totalRows, false), s: `共 ${fmtNum(s.fieldCount, false)} 个字段` });
      const m = (s.metrics || [])[0];
      if (m) {
        out.push({ k: `${m.field} · 求和`, v: fmtNum(m.sum) });
        out.push({ k: `${m.field} · 均值`, v: fmtNum(m.avg), s: `中位数 ${fmtNum(m.median)}` });
        out.push({ k: `${m.field} · 区间`, v: `${fmtNum(m.min)} ~ ${fmtNum(m.max)}` });
      }
      if (s.topCategory) out.push({ k: '主要分类维度', v: s.topCategory });
    } else if (r.kind === 'trend') {
      // 末周期可能还没走完，落在末点的极值要标注出来，避免被当成真的谷底
      const labels = r.labels || [];
      const lastLabel = labels[labels.length - 1];
      const mark = (p) => (s.lastPeriodIncomplete && lastLabel && p && p.key === lastLabel ? '（周期未结束）' : '');
      out.push({ k: '期末值', v: fmtNum(s.last), s: `起始 ${fmtNum(s.first)}` });
      if (has(s.growth)) out.push({ k: '总增长率', v: pct(s.growth), dir: Number(s.growth) >= 0 ? 'up' : 'down', s: `${fmtNum(s.periods, false)} 个周期` });
      if (s.peak) out.push({ k: '峰值', v: fmtNum(s.peak.value), s: s.peak.key + mark(s.peak) });
      if (s.trough) out.push({ k: '谷值', v: fmtNum(s.trough.value), s: s.trough.key + mark(s.trough) });
    } else if (r.kind === 'aggregate') {
      out.push({ k: '合计', v: fmtNum(s.total) });
      if (s.top) out.push({ k: `最高 · ${s.top.key}`, v: fmtNum(s.top.value), s: `占比 ${fmtNum(s.top.share)}%` });
      if (s.bottom) out.push({ k: `最低 · ${s.bottom.key}`, v: fmtNum(s.bottom.value) });
    } else if (r.kind === 'anomaly') {
      out.push({ k: '异常点数', v: fmtNum(s.anomalyCount, false), s: `检测 ${fmtNum(s.totalPoints, false)} 个点`, dir: s.anomalyCount > 0 ? 'up' : '' });
      out.push({ k: '基线均值', v: fmtNum(s.baselineMean) });
      if (s.normalRange) out.push({ k: '正常区间', v: `${fmtNum(s.normalRange[0])} ~ ${fmtNum(s.normalRange[1])}` });
    } else if (r.kind === 'compare') {
      // compare 有「周期对比」和「分组对比」两种模式，stats 字段不一样，必须分开取
      if (s.mode === 'period') {
        out.push({ k: '本期', v: fmtNum(s.current) });
        out.push({ k: '对比期', v: fmtNum(s.previous) });
      } else if (s.a && s.b) {
        out.push({ k: `较高 · ${s.a.key}`, v: fmtNum(s.a.value) });
        out.push({ k: `较低 · ${s.b.key}`, v: fmtNum(s.b.value) });
        out.push({ k: '差值', v: fmtNum(s.diff), dir: Number(s.diff) >= 0 ? 'up' : 'down' });
      }
      if (has(s.changeRate)) out.push({ k: '变化幅度', v: pct(s.changeRate), dir: Number(s.changeRate) >= 0 ? 'up' : 'down' });
    } else if (r.kind === 'correlation') {
      out.push({ k: '参与字段', v: fmtNum(s.fieldCount, false), s: '个数值字段' });
      const st = s.strongest;
      if (st && has(st.r)) out.push({ k: '最强相关', v: Number(st.r).toFixed(2), s: `${st.x} × ${st.y}` });
    }
    // 取不到值的一律不显示，避免出现一排「—」占位卡片
    return out.filter((x) => has(x.v) && x.v !== '—');
  }

  function kpiHtml(k) {
    return `<div class="kpi${k.dir ? ' ' + k.dir : ''}"><div class="k">${esc(k.k)}</div>`
      + `<div class="v">${esc(String(k.v))}</div>`
      + (k.s ? `<div class="s">${esc(k.s)}</div>` : '') + '</div>';
  }

  function renderResult(card, out, question) {
    const { plan, result, report } = out;
    const kindLabel = {
      summary: '整体概览', trend: '趋势分析', anomaly: '异常识别',
      compare: '指标对比', aggregate: '分组聚合', correlation: '相关性',
    }[result.kind] || '分析';

    const kpis = Settings.get('showKpi') ? kpisFor(result) : [];
    card.innerHTML = `
      <div class="result-head">
        <div class="result-title"></div>
        <span class="badge">${esc(kindLabel)}</span>
        <div class="result-tools">
          <button class="icon-btn" data-act="copy" title="复制结论">${ICON('copy')}</button>
          <button class="icon-btn" data-act="png" title="下载图表 PNG">${ICON('download')}</button>
          <button class="icon-btn" data-act="rerun" title="重新分析">${ICON('refresh')}</button>
        </div>
      </div>
      ${kpis.length ? '<div class="kpi-row">' + kpis.map(kpiHtml).join('') + '</div>' : ''}
      <div class="chart-box"></div>
      <div class="report"></div>
      <details class="details">
        <summary>查看数据表与计算明细</summary>
        <div class="table-wrap" style="margin-top:10px;max-height:320px"></div>
      </details>`;
    $('.result-title', card).textContent = result.title || question;
    const rep = $('.report', card);
    rep.innerHTML = report ? miniMd(report) : '<p class="muted">结论生成中…</p>';
    if (!report) rep.classList.add('cursor');

    const chart = Charts.render($('.chart-box', card), result);
    bindResultTools(card, question, chart);

    if (result.table) {
      const wrap = $('.table-wrap', card);
      const t = document.createElement('table');
      t.className = 'grid';
      t.innerHTML = '<thead><tr>' + result.table.headers.map((h) => `<th>${esc(String(h))}</th>`).join('') + '</tr></thead><tbody>'
        + result.table.rows.slice(0, 60).map((r) => '<tr>' + r.map((c) => cellHtml(c, typeof c === 'number')).join('') + '</tr>').join('')
        + '</tbody>';
      wrap.appendChild(t);
    }
  }

  function bindResultTools(card, question, chart) {
    const pngBtn = $('[data-act="png"]', card);
    if (!chart) pngBtn.hidden = true;
    else pngBtn.onclick = () => {
      try {
        const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
        const a = document.createElement('a');
        a.href = url;
        a.download = '分析图表-' + new Date().toISOString().slice(0, 10) + '.png';
        a.click();
        toast('图表已下载', { type: 'ok' });
      } catch (e) {
        toast('下载失败：' + Cloud.errText(e), { type: 'err' });
      }
    };

    $('[data-act="copy"]', card).onclick = async () => {
      const rep = $('.report', card);
      const text = rep ? rep.innerText.trim() : '';
      if (!text) return toast('结论还没生成完', { type: 'warn' });
      try {
        await navigator.clipboard.writeText(text);
        toast('结论已复制', { type: 'ok' });
      } catch (e) {
        toast('浏览器拒绝了剪贴板访问，请手动选中复制', { type: 'warn', duration: 4000 });
      }
    };

    $('[data-act="rerun"]', card).onclick = () => {
      if (state.busy) return toast('正在分析中，请稍候', { type: 'warn' });
      ask(question);
    };
  }

  /* ---------------- 清洗结果 ---------------- */
  function renderClean(card, out, question) {
    const { plan, clean, report } = out;
    card.innerHTML = `
      <div class="result-head">
        <div class="result-title"></div>
        <span class="badge">数据清洗</span>
      </div>
      <div class="clean-counts">
        <span class="cnt">清洗前 <b>${clean.before.rows}</b> 行 · <b>${clean.before.cols}</b> 字段</span>
        <span class="arrow">→</span>
        <span class="cnt">清洗后 <b>${clean.after.rows}</b> 行 · <b>${clean.after.cols}</b> 字段</span>
      </div>
      <div class="table-wrap clean-steps"></div>
      <div class="report"></div>
      <details class="details" open>
        <summary>查看清洗后的数据预览（前 20 行）</summary>
        <div class="table-wrap clean-preview" style="margin-top:10px;max-height:300px"></div>
      </details>
      <div class="clean-actions">
        <button class="btn primary apply-clean">应用并保存为新数据集</button>
        <button class="btn ghost discard-clean">不保存</button>
      </div>`;
    $('.result-title', card).textContent = plan.title || question;

    const rep = $('.report', card);
    rep.innerHTML = report ? miniMd(report) : '<p class="muted">整理处理说明…</p>';
    if (!report) rep.classList.add('cursor');

    // 步骤报告
    const steps = $('.clean-steps', card);
    const t1 = document.createElement('table');
    t1.className = 'grid';
    t1.innerHTML = '<thead><tr><th>#</th><th>操作</th><th>说明</th><th>影响</th></tr></thead><tbody>'
      + (clean.report.length
        ? clean.report.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.label)}</td><td>${esc(r.summary)}</td><td class="num">${r.affected}</td></tr>`).join('')
        : '<tr><td colspan="4" class="muted">没有可执行的操作</td></tr>')
      + '</tbody>';
    steps.appendChild(t1);

    // 结果预览
    const pv = $('.clean-preview', card);
    const cols = clean.columns.slice(0, 20);
    const t2 = document.createElement('table');
    t2.className = 'grid';
    t2.innerHTML = '<thead><tr>' + cols.map((c) => `<th>${esc(c.name)}</th>`).join('') + '</tr></thead><tbody>'
      + clean.rows.slice(0, 20).map((r) => '<tr>' + cols.map((c) => cellHtml(r[c.name], c.type === 'number')).join('') + '</tr>').join('')
      + '</tbody>';
    pv.appendChild(t2);

    const actions = $('.clean-actions', card);
    $('.apply-clean', card).onclick = async () => {
      actions.innerHTML = '<span class="muted small">正在保存到云端…</span>';
      try {
        await importTable((state.current.name || '数据集') + '（已清洗）',
          { headers: clean.columns.map((c) => c.name), rows: clean.rows, columns: clean.columns },
          'clean', false);
        actions.innerHTML = '<span class="muted small">已保存为新数据集，左侧列表可切换查看。</span>';
        toast('清洗结果已保存');
      } catch (e) {
        actions.innerHTML = `<span class="muted small">保存失败：${esc(Cloud.errText(e))}</span>`;
      }
    };
    $('.discard-clean', card).onclick = () => {
      actions.innerHTML = '<span class="muted small">未保存，原数据没有被修改。</span>';
    };
  }

  async function saveAnalysis(question, out) {
    try {
      const r = out.result;
      const slim = {
        kind: r.kind, title: r.title, chart: r.chart,
        labels: r.labels, series: r.series, table: r.table,
        stats: r.stats, notes: r.notes,
        baseline: r.baseline, anomalyPoints: r.anomalyPoints,
        anomalies: (r.anomalies || []).slice(0, 20),
        scatter: r.scatter, filters: r.filters, rowCount: r.rowCount,
      };
      await Cloud.db.insert('analyses', [{
        dataset_id: state.current.id,
        question,
        kind: r.kind,
        plan: out.plan,
        result: slim,
        summary: (out.report || '').slice(0, 4000),
        model: state.model,
      }]);
      await loadHistory(state.current.id);
    } catch (e) { /* 历史保存失败不影响主流程 */ }
  }

  async function loadHistory(datasetId) {
    try {
      const list = await Cloud.db.list('analyses', {
        select: 'id,question,kind,result,summary,created_at',
        eq: { dataset_id: datasetId },
        order: { column: 'created_at', ascending: false },
        limit: 30,
      });
      state.history = list;
      const box = $('#history-list');
      box.innerHTML = '';
      if (!list.length) {
        box.innerHTML = '<p class="muted small">还没有分析记录</p>';
        return;
      }
      list.forEach((h) => {
        const el = document.createElement('div');
        el.className = 'hist-item';
        el.innerHTML = `<i class="hist-kind" data-kind="${esc(h.kind || '')}"></i><span class="q"></span>`;
        el.querySelector('.q').textContent = h.question;
        el.title = h.question;
        el.onclick = () => {
          const card = document.createElement('div');
          card.className = 'bubble-agent';
          $('#thread').appendChild(card);
          renderResult(card, { plan: h.plan, result: h.result, report: h.summary }, h.question);
          switchView('chat');
          closeSidebarDrawer();
          scrollThread();
        };
        box.appendChild(el);
      });
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal() {
    $('#modal').hidden = false;
    $('#ds-title').value = '';
    fileNote('');
    $('#paste-area').value = '';
    $('#sheet-row').hidden = true;
    $('#sheet-select').innerHTML = '';
    state.parsed = null;
    state.workbook = null;
  }
  function closeModal() { $('#modal').hidden = true; }

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function miniMd(text) {
    const safe = esc(text || '');
    const lines = safe.split('\n');
    let html = '', inList = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { if (inList) { html += '</ul>'; inList = false; } continue; }
      if (line.startsWith('###')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h3>' + inline(line.replace(/^#+\s*/, '')) + '</h3>';
      } else if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(line.replace(/^([-*]|\d+\.)\s+/, '')) + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p>' + inline(line) + '</p>';
      }
    }
    if (inList) html += '</ul>';
    return html || '<p class="muted">（模型未返回结论文本）</p>';
  }

  function inline(s) {
    return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  }

  /* ---------------- Toast 通知栈 ---------------- */
  function toast(msg, opts) {
    const o = typeof opts === 'number' ? { duration: opts } : (opts || {});
    const type = o.type || '';
    const stack = $('#toast-stack');
    const el = document.createElement('div');
    el.className = 'toast-item' + (type ? ' ' + type : '');
    el.innerHTML = ICON(type === 'ok' ? 'check' : type === 'err' ? 'alert' : 'info')
      + '<span class="tx"></span><button class="x" aria-label="关闭">✕</button>';
    el.querySelector('.tx').textContent = msg;
    el.querySelector('.x').onclick = () => removeToast(el);
    stack.appendChild(el);
    // 最多同时留 4 条，避免刷屏。
    // removeToast 是异步退场（先加 .out 再延时移除），第二次碰到同一条时要直接摘掉，
    // 否则这里会变成"条件永远不变"的死循环，把整个页面卡死。
    while (stack.children.length > 4) {
      const first = stack.firstElementChild;
      if (!first) break;
      if (first.classList.contains('out')) { stack.removeChild(first); continue; }
      removeToast(first);
    }
    el._timer = setTimeout(() => removeToast(el), o.duration || 2800);
    return el;
  }

  function removeToast(el) {
    if (!el || !el.parentNode || el.classList.contains('out')) return;
    clearTimeout(el._timer);
    el.classList.add('out');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }

  init();
})();
