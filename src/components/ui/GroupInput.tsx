import { useEffect, useMemo, useRef, useState } from 'react';

/** 过滤已有分组：大小写不敏感的子串匹配，去掉当前值本身，最多 max 条。 */
export function filterGroups(
  groups: readonly string[],
  query: string,
  max = 8,
): string[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of groups) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (name === query.trim()) continue;
    if (q && !name.toLowerCase().includes(q)) continue;
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 已有分组（来自已保存的连接）。空数组时退化成普通输入框。 */
  groups: readonly string[];
  placeholder?: string;
  className: string;
  /** 列表最多显示几条，默认 8。 */
  max?: number;
}

/**
 * 分组输入框：仍可自由输入新分组，但已有分组会以下拉候选的形式给出。
 *
 * 为什么不用原生 `<datalist>`：Android WebView 对它的支持时有时无（点开没反应），
 * 而分组是本应用里高频动作，两端行为必须一致。
 */
export default function GroupInput({
  value,
  onChange,
  groups,
  placeholder,
  className,
  max = 8,
}: Props) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | null>(null);
  const filtered = useMemo(
    () => filterGroups(groups, value, max),
    [groups, value, max],
  );

  useEffect(
    () => () => {
      if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
    },
    [],
  );

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // 让点击候选项的 onClick 先跑完再收起
          blurTimer.current = window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {open && filtered.length > 0 && (
        <ul
          className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-edge bg-zinc-900 py-1 shadow-xl"
          role="listbox"
        >
          {filtered.map((name) => (
            <li key={name} role="option" aria-selected={name === value}>
              {/* mousedown 必须阻止默认行为：否则输入框先 blur，列表在 click 之前就被收掉 */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-state-mid active:bg-state-mid"
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
