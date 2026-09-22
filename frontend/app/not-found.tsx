import { BarChart3 } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="surface w-full max-w-md rounded-3xl border p-7 text-center shadow-[0_24px_70px_rgba(15,23,42,.10)]">
        <div className="brand-bg mx-auto grid size-11 place-items-center rounded-2xl text-white">
          <BarChart3 size={22} />
        </div>
        <h1 className="mt-4 text-xl font-semibold">页面不存在</h1>
        <p className="muted mt-2 text-sm">你访问的地址没有对应的页面。</p>
        <Link href="/"
          className="brand-bg mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-3 font-medium text-white">
          回到首页
        </Link>
      </div>
    </div>
  );
}
