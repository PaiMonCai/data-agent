export function fmtDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  // new Date 对非法串不抛异常，只会得到 Invalid Date，必须显式判断
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
