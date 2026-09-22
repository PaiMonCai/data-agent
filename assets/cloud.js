/* 自建服务客户端：Auth / Database / LLM 共用同源 HTTP API */
window.Cloud = (function () {
  const cfg = window.PUBLIC_CONFIG || {};
  const apiBase = String(cfg.apiBase || '/api').replace(/\/$/, '');
  const credentials = cfg.credentials || 'include';

  function apiUrl(path) {
    path = String(path || '');
    return apiBase + (path.startsWith('/') ? path : '/' + path);
  }

  async function parseBody(res) {
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  function makeError(res, body) {
    const detail = body && body.error ? body.error : body;
    const message =
      (detail && (detail.message || detail.detail)) ||
      (typeof detail === 'string' ? detail : '') ||
      ('HTTP ' + res.status);
    const err = new Error(message);
    err.status = res.status;
    err.code =
      (detail && detail.code) ||
      (body && body.code) ||
      ('http_' + res.status);
    err.details = body;
    return err;
  }

  async function request(path, options) {
    const opts = options || {};
    const headers = Object.assign(
      { Accept: 'application/json' },
      opts.body === undefined ? {} : { 'Content-Type': 'application/json' },
      opts.headers || {}
    );
    const res = await fetch(apiUrl(path), Object.assign({}, opts, {
      credentials,
      headers,
      body: opts.body === undefined || typeof opts.body === 'string'
        ? opts.body
        : JSON.stringify(opts.body),
    }));
    const body = await parseBody(res);
    if (!res.ok) throw makeError(res, body);
    return body;
  }

  function dataOf(value) {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')) {
      return value.data;
    }
    return value;
  }

  async function wrapped(fn) {
    try {
      return { data: await fn(), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  /* ---------- 会话 ---------- */
  async function session() {
    try {
      const raw = await request('/auth/session', { method: 'GET' });
      const data = dataOf(raw);
      if (!data) return null;
      if (data.user) return data;
      return { user: data };
    } catch (e) {
      if (e && e.status === 401) return null;
      return null;
    }
  }

  async function requireSession() {
    const s = await session();
    if (!s) throw new Error('登录状态已失效，请重新登录');
    return s;
  }

  const auth = {
    async getSession() {
      return wrapped(async () => session());
    },

    async getUser() {
      return wrapped(async () => {
        const raw = await request('/auth/user', { method: 'GET' });
        const data = dataOf(raw);
        return data && data.user ? data.user : data;
      });
    },

    async signInWithPassword(payload) {
      return wrapped(async () => dataOf(await request('/auth/password', {
        method: 'POST',
        body: payload,
      })));
    },

    async signInWithOtp({ email }) {
      return wrapped(async () => {
        const data = dataOf(await request('/auth/otp/request', {
          method: 'POST',
          body: { email, purpose: 'login' },
        })) || {};
        return Object.assign({}, data, {
          verify: async ({ token }) => auth.verifyOtp({
            verificationId: data.verificationId,
            token,
            email,
            purpose: 'login',
          }),
        });
      });
    },

    async sendOtp({ email }) {
      return wrapped(async () => dataOf(await request('/auth/otp/request', {
        method: 'POST',
        body: { email, purpose: 'signup' },
      })));
    },

    async verifyOtp(payload) {
      return wrapped(async () => dataOf(await request('/auth/otp/verify', {
        method: 'POST',
        body: payload,
      })));
    },

    async resetPasswordForEmail(email) {
      return wrapped(async () => {
        const data = dataOf(await request('/auth/otp/request', {
          method: 'POST',
          body: { email, purpose: 'reset' },
        })) || {};
        return Object.assign({}, data, {
          updateUser: async ({ nonce, password }) => wrapped(async () =>
            dataOf(await request('/auth/password/reset', {
              method: 'POST',
              body: {
                email,
                verificationId: data.verificationId,
                nonce,
                password,
              },
            }))
          ),
        });
      });
    },

    async refreshSession() {
      return wrapped(async () => dataOf(await request('/auth/refresh', {
        method: 'POST',
        body: {},
      })));
    },

    async signOut() {
      return wrapped(async () => dataOf(await request('/auth/logout', {
        method: 'POST',
        body: {},
      })));
    },
  };

  function client() {
    return { auth };
  }

  /* ---------- 会话失效自动恢复 ---------- */
  const AUTH_FAIL = /unauthenticated|session is invalid|jwt expired|token expired|not logged in|unauthorized/i;

  function isAuthError(err) {
    if (!err) return false;
    const code = err.code || (err.error && err.error.code) || '';
    const msg = err.message || (err.error && err.error.message) || '';
    return err.status === 401 || String(code).startsWith('auth_') || AUTH_FAIL.test(String(msg));
  }

  async function withAuthRetry(fn) {
    try {
      return await fn();
    } catch (err) {
      if (!isAuthError(err)) throw err;
      try { await auth.refreshSession(); } catch (e) { /* 保留原错误 */ }
      return await fn();
    }
  }

  /* ---------- 数据库 ---------- */
  const db = {
    async list(table, { select = '*', eq, order, limit, range } = {}) {
      const qs = new URLSearchParams();
      if (select) qs.set('select', select);
      if (eq) qs.set('eq', JSON.stringify(eq));
      if (order) qs.set('order', JSON.stringify(order));
      if (limit) qs.set('limit', String(limit));
      if (range) qs.set('range', JSON.stringify(range));
      const raw = await withAuthRetry(() =>
        request('/data/' + encodeURIComponent(table) + '?' + qs.toString(), { method: 'GET' })
      );
      const data = dataOf(raw);
      return Array.isArray(data) ? data : [];
    },

    async insert(table, rows) {
      const raw = await withAuthRetry(() =>
        request('/data/' + encodeURIComponent(table), {
          method: 'POST',
          body: { rows: Array.isArray(rows) ? rows : [rows] },
        })
      );
      const data = dataOf(raw);
      return Array.isArray(data) ? data : [];
    },

    async update(table, patch, eq) {
      const raw = await withAuthRetry(() =>
        request('/data/' + encodeURIComponent(table), {
          method: 'PATCH',
          body: { patch, eq },
        })
      );
      const data = dataOf(raw);
      return Array.isArray(data) ? data : [];
    },

    async remove(table, eq) {
      const raw = await withAuthRetry(() =>
        request('/data/' + encodeURIComponent(table), {
          method: 'DELETE',
          body: { eq },
        })
      );
      const data = dataOf(raw);
      return Array.isArray(data) ? data : [];
    },

    async importDataset(meta, rows) {
      const raw = await withAuthRetry(() =>
        request('/data/import', {
          method: 'POST',
          body: {
            name: meta.name,
            source: meta.source,
            columns: meta.columns,
            rows,
          },
        })
      );
      const data = dataOf(raw);
      return Array.isArray(data) ? data : [];
    },
  };

  /* ---------- 大模型：兼容 OpenAI 风格 SSE ---------- */
  async function streamChat(payload, onDelta) {
    const res = await fetch(apiUrl('/llm/chat/completions'), {
      method: 'POST',
      credentials,
      headers: {
        Accept: 'text/event-stream, application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await parseBody(res);
      throw makeError(res, body);
    }

    const type = String(res.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('text/event-stream') || !res.body) {
      const body = await parseBody(res);
      const text =
        body && body.choices && body.choices[0] &&
        body.choices[0].message && body.choices[0].message.content
          ? body.choices[0].message.content
          : '';
      if (text && onDelta) onDelta(text);
      return text;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

    function consumeEvent(block) {
      const lines = String(block).split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(data); } catch (e) { continue; }
        const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        const part = delta && delta.content;
        if (part) {
          text += part;
          if (onDelta) onDelta(part);
        }
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        consumeEvent(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
      if (done) break;
    }
    if (buffer.trim()) consumeEvent(buffer);
    return text;
  }

  async function chat({ model, messages, jsonMode = false, temperature, onDelta, onRestart }) {
    let firstAttempt = true;
    return withAuthRetry(async () => {
      if (!firstAttempt && onRestart) onRestart();
      firstAttempt = false;
      return streamChat({
        model,
        messages,
        stream: true,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
        temperature: temperature === undefined ? 0.3 : temperature,
        stream_options: { include_usage: true },
      }, onDelta);
    });
  }

  async function models() {
    return withAuthRetry(async () => {
      const raw = await request('/llm/models', { method: 'GET' });
      const data = dataOf(raw);
      const list = Array.isArray(data)
        ? data
        : (data && Array.isArray(data.models) ? data.models : []);
      return list.filter((m) => m && m.disabled !== true);
    });
  }

  /* ---------- 错误文案 ---------- */
  function errText(err) {
    if (!err) return '未知错误';
    const msg = err.message || (err.error && err.error.message) || String(err);
    if (isAuthError(err)) return '登录状态已失效，请退出后重新登录';
    if (err.status === 403) return '没有权限执行该操作';
    if (err.status === 404) return '自建 API 未提供所需接口，请检查后端部署';
    if (err.status === 429) return '请求过于频繁，请稍后再试';
    if (err.status >= 500) return '后端服务暂时不可用，请稍后重试';
    return msg;
  }

  /* 同源 /api 不再依赖第三方平台的 Origin 白名单。 */
  function originOk() {
    return true;
  }

  return {
    client,
    session,
    requireSession,
    db,
    chat,
    models,
    errText,
    originOk,
    isAuthError,
  };
})();
