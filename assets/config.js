// 云端服务公开配置：由云服务开通流程下发，仅含可安全下发到前端的值。
window.PUBLIC_CONFIG = {
  endpoint: 'https://data-agent-28045.app.workbuddy.host',
  publishableKey: 'wbpk_XJP9JJyEgirCUni1z6ScGW_a9vuLJf2Z1jz557hhQv9u70lQ6TJUK6B',
};

window.APP_LIMITS = {
  maxRows: 20000,      // 单数据集最大行数
  insertChunk: 400,    // 批量写入分块大小
  previewRows: 100,    // 预览表展示行数
  sampleToLLM: 8,      // 送给模型的样例行数
};
