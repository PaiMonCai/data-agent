/* 本地最小声明：SheetJS 的 CDN 包不带类型，@types/xlsx 也不是本项目依赖。
   只覆盖 parse.ts 真正用到的 read / utils.sheet_to_json。 */
declare module "xlsx" {
  export interface WorkSheet {
    [cell: string]: unknown;
  }

  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }

  export interface ReadOptions {
    type?: "array" | "base64" | "binary" | "string" | "buffer" | "file";
  }

  export interface SheetToJsonOptions {
    defval?: unknown;
    raw?: boolean;
  }

  export function read(data: ArrayBuffer | Uint8Array, opts?: ReadOptions): WorkBook;

  export const utils: {
    sheet_to_json<T = Record<string, unknown>>(ws: WorkSheet, opts?: SheetToJsonOptions): T[];
  };
}
