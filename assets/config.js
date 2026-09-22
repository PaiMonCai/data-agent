// 自建服务公开配置。默认走同源 /api，可在加载本文件前通过
// window.__DATA_AGENT_API_BASE__ 覆盖为其他自建服务地址。
window.PUBLIC_CONFIG = {
  apiBase: window.__DATA_AGENT_API_BASE__ || '/api',
  credentials: 'include',
};

window.APP_LIMITS = {
  maxRows: 20000,      // 单数据集最大行数
  previewRows: 100,    // 预览表展示行数
  sampleToLLM: 8,      // 送给模型的样例行数
};
