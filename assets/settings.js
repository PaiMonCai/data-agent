/* 设置中心：偏好定义、持久化、以及把偏好真正应用到界面上
   存储用 localStorage（这些是本机界面偏好，不占云端库表），支持导出/导入成 JSON 备份。
   任何一项都必须"改了立刻生效"，不允许出现存了但不起作用的开关。 */
window.Settings = (function () {
  const KEY = 'da.settings.v1';

  const defaults = {
    // 外观
    theme: 'system',        // system | light | dark
    density: 'comfortable', // comfortable | compact
    fontSize: 14,           // 13 | 14 | 15
    motion: true,           // 界面动效
    showKpi: true,          // 结果卡顶部的关键指标条
    // 分析
    model: '',              // 默认模型 id，空 = 自动挑选快速模型
    customModels: [],       // 用户自己添加的模型 [{ id, name }]，按 id 直接调用云端网关
    agg: 'sum',             // sum | avg | count | max | min
    granularity: 'auto',    // auto | day | week | month | quarter
    sensitivity: 'normal',  // strict | normal | loose（异常检测灵敏度）
    detail: 'normal',       // brief | normal | detailed（结论长度）
    autoAnalyze: true,      // 导入后自动跑一次整体概览
    // 数据
    confirmDelete: true,    // 删除数据集前二次确认
  };

  // 分组定义：界面按这个 schema 自动渲染，新增设置项只需在这里加一条
  const groups = [
    {
      id: 'appearance', name: '外观', icon: 'sparkles',
      desc: '主题、密度与动效，改完立刻生效。',
      items: [
        { key: 'theme', label: '主题', type: 'select', options: [
          { v: 'system', t: '跟随系统' }, { v: 'light', t: '浅色' }, { v: 'dark', t: '深色' }] },
        { key: 'density', label: '界面密度', type: 'seg', options: [
          { v: 'comfortable', t: '舒适' }, { v: 'compact', t: '紧凑' }] },
        { key: 'fontSize', label: '正文字号', type: 'seg', options: [
          { v: 13, t: '小' }, { v: 14, t: '标准' }, { v: 15, t: '大' }] },
        { key: 'motion', label: '界面动效', type: 'toggle', hint: '关闭后去掉过渡与入场动画' },
        { key: 'showKpi', label: '关键指标卡片', type: 'toggle', hint: '分析结果顶部显示核心数字' },
      ],
    },
    {
      id: 'analysis', name: '分析偏好', icon: 'logo',
      desc: '只在提问里没说明时作为默认值，你明说的永远优先。',
      items: [
        { key: 'model', label: '默认模型', type: 'model' },
        { key: 'agg', label: '默认聚合方式', type: 'select', options: [
          { v: 'sum', t: '求和' }, { v: 'avg', t: '平均值' }, { v: 'count', t: '计数' },
          { v: 'max', t: '最大值' }, { v: 'min', t: '最小值' }] },
        { key: 'granularity', label: '默认时间粒度', type: 'select', options: [
          { v: 'auto', t: '自动判断' }, { v: 'day', t: '按天' }, { v: 'week', t: '按周' },
          { v: 'month', t: '按月' }, { v: 'quarter', t: '按季度' }] },
        { key: 'sensitivity', label: '异常检测灵敏度', type: 'select', options: [
          { v: 'strict', t: '严格（少报）' }, { v: 'normal', t: '标准' }, { v: 'loose', t: '宽松（多报）' }] },
        { key: 'detail', label: '结论详细程度', type: 'select', options: [
          { v: 'brief', t: '精简' }, { v: 'normal', t: '标准' }, { v: 'detailed', t: '详细' }] },
        { key: 'autoAnalyze', label: '导入后自动分析', type: 'toggle', hint: '导入完成自动跑一次整体概览' },
      ],
    },
    { id: 'data', name: '数据与存储', icon: 'table', desc: '数据存在你的云端空间，只有你可见。', items: [] },
    { id: 'shortcuts', name: '快捷键', icon: 'panel', desc: '', items: [] },
    { id: 'about', name: '关于', icon: 'info', desc: '', items: [] },
  ];

  let cur = Object.assign({}, defaults);
  const subs = [];

  function load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
    cur = Object.assign({}, defaults);
    Object.keys(defaults).forEach((k) => {
      if (saved[k] !== undefined && saved[k] !== null) cur[k] = saved[k];
    });
    return cur;
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) { /* 无痕模式下写不进去，忽略 */ }
  }

  function all() { return Object.assign({}, cur); }
  function get(k) { return cur[k]; }

  function set(k, v) {
    if (!(k in defaults)) return;
    cur[k] = v;
    persist();
    apply();
    subs.forEach((fn) => { try { fn(k, v, all()); } catch (e) { console.error(e); } });
  }

  function reset() {
    cur = Object.assign({}, defaults);
    persist();
    apply();
    subs.forEach((fn) => { try { fn('*', null, all()); } catch (e) { console.error(e); } });
  }

  function subscribe(fn) { if (typeof fn === 'function') subs.push(fn); }

  function resolveTheme() {
    if (cur.theme !== 'system') return cur.theme;
    try { return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  }

  /* 把偏好落到 DOM 上：CSS 通过 [data-theme] / [data-density] / --fs-body 读这些值 */
  function apply() {
    const root = document.documentElement;
    const theme = resolveTheme();
    root.dataset.theme = theme;
    root.dataset.density = cur.density;
    root.style.setProperty('--fs-body', Number(cur.fontSize) + 'px');
    root.classList.toggle('no-motion', !cur.motion);
    // 让浏览器原生控件（滚动条、下拉面板、日期选择器）也跟着换肤。
    // apply() 在启动早期就会跑，这里必须容错，任何一步失败都不能拖垮首屏。
    try {
      const meta = document.querySelector && document.querySelector('meta[name="color-scheme"]');
      if (meta) meta.setAttribute('content', theme);
    } catch (e) { /* ignore */ }
  }

  function watchSystemTheme() {
    try {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (cur.theme === 'system') apply(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (e) { /* ignore */ }
  }

  function exportJSON() {
    return JSON.stringify({ app: 'data-agent', version: 1, exportedAt: new Date().toISOString(), settings: all() }, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    const src = parsed && parsed.settings ? parsed.settings : parsed;
    if (!src || typeof src !== 'object') throw new Error('文件内容不是有效的设置备份');
    let n = 0;
    Object.keys(defaults).forEach((k) => {
      if (src[k] !== undefined && src[k] !== null) { cur[k] = src[k]; n++; }
    });
    persist();
    apply();
    subs.forEach((fn) => { try { fn('*', null, all()); } catch (e) { console.error(e); } });
    return n;
  }

  load();
  watchSystemTheme();

  return { defaults, groups, all, get, set, reset, apply, subscribe, exportJSON, importJSON, resolveTheme };
})();
