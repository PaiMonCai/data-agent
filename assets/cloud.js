/* 云端客户端：Auth / Database / LLM 共用同一个实例 */
window.Cloud = (function () {
  let cloud = null;

  function client() {
    if (cloud) return cloud;
    if (!window.WorkBuddyCloud || !window.WorkBuddyCloud.createWorkBuddyCloud) {
      throw new Error('云端 SDK 未加载，请检查网络后刷新页面');
    }
    cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: window.PUBLIC_CONFIG.endpoint,
      publishableKey: window.PUBLIC_CONFIG.publishableKey,
    });
    return cloud;
  }

  /* ---------- 会话 ---------- */
  async function session() {
    try {
      const { data, error } = await client().auth.getSession();
      return error ? null : data;
    } catch (e) {
      return null;
    }
  }

  async function requireSession() {
    const s = await session();
    if (!s) throw new Error('登录状态已失效，请重新登录');
    return s;
  }

  /* ---------- 会话失效自动恢复 ---------- */
  const AUTH_FAIL = /invalid_grant|unauthenticated|session is invalid|jwt expired|token expired|not logged in/i;

  function isAuthError(err) {
    if (!err) return false;
    const code = err.code || (err.error && err.error.code) || '';
    const msg = err.message || (err.error && err.error.message) || '';
    return String(code).startsWith('auth_') || err.status === 401 || AUTH_FAIL.test(String(msg));
  }

  // 云端各数据面对会话的校验强度不同：数据库还通的会话，模型接口可能已经判为失效。
  // 遇到鉴权类错误先刷新一次会话再重试，避免用户看到"无模型可用"却不知道原因。
  async function withAuthRetry(fn) {
    try {
      return await fn();
    } catch (err) {
      if (!isAuthError(err)) throw err;
      try { await client().auth.refreshSession(); } catch (e) { /* 刷新失败照常抛出原错误 */ }
      return await fn();
    }
  }

  /* ---------- 数据库 ---------- */
  const db = {
    async list(table, { select = '*', eq, order, limit, range } = {}) {
      let q = client().database.from(table).select(select);
      if (eq) for (const [col, val] of Object.entries(eq)) q = q.eq(col, val);
      if (order) q = q.order(order.column, { ascending: !!order.ascending });
      if (range) q = q.range(range[0], range[1]);
      else if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    async insert(table, rows) {
      const { data, error } = await client().database.from(table).insert(rows).select();
      if (error) throw error;
      return data || [];
    },
    async update(table, patch, eq) {
      let q = client().database.from(table).update(patch);
      for (const [col, val] of Object.entries(eq)) q = q.eq(col, val);
      const { data, error } = await q.select();
      if (error) throw error;
      return data || [];
    },
    async remove(table, eq) {
      let q = client().database.from(table).delete();
      for (const [col, val] of Object.entries(eq)) q = q.eq(col, val);
      const { data, error } = await q.select();
      if (error) throw error;
      return data || [];
    },
  };

  /* ---------- 大模型：收集式调用（流式累积后返回全文） ---------- */
  async function chat({ model, messages, jsonMode = false, temperature, onDelta, onRestart }) {
    let text = '';
    let firstAttempt = true;
    await withAuthRetry(async () => {
      // 鉴权失败后重试会重新整段输出，先让调用方把已渲染的内容清掉，避免文字重复叠加
      if (!firstAttempt && onRestart) onRestart();
      firstAttempt = false;
      text = '';
      for await (const chunk of client().llm.chat.completions.create({
        model,
        messages,
        stream: true,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
        temperature: temperature === undefined ? 0.3 : temperature,
        stream_options: { include_usage: true },
      })) {
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        if (delta && delta.content) {
          text += delta.content;
          if (onDelta) onDelta(delta.content);
        }
      }
    });
    return text;
  }

  async function models() {
    return withAuthRetry(async () => {
      const list = await client().llm.models.list();
      return (list || []).filter((m) => m.disabled !== true);
    });
  }

  /* ---------- 错误文案 ---------- */
  function errText(err) {
    if (!err) return '未知错误';
    const code = err.code || (err.error && err.error.code) || '';
    const msg = err.message || (err.error && err.error.message) || String(err);
    if (isAuthError(err)) return '登录状态已失效，请退出后重新登录';
    if (code === '42501' || code === '42P01') return '没有权限访问该数据，请确认已登录';
    if (String(code).startsWith('quota_')) return '模型额度已用尽或触发限流，请稍后再试';
    if (String(code).startsWith('auth_')) return '云端凭证校验失败，请在已发布的应用域名上访问';
    if (String(code).startsWith('gateway_') || String(code).startsWith('model_'))
      return '模型服务暂时不可用，请稍后重试';
    if (String(code).startsWith('request_')) return '请求参数有误：' + msg;
    return msg;
  }

  /* ---------- 运行环境检查 ---------- */
  // 云服务按发布域名做精确 Origin 校验：在预览面板/localhost 里打开会整体不可用。
  function originOk() {
    try {
      return window.location.origin === new URL(window.PUBLIC_CONFIG.endpoint).origin;
    } catch (e) {
      return true;
    }
  }

  return { client, session, requireSession, db, chat, models, errText, originOk, isAuthError };
})();
