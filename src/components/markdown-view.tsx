import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key++} className="font-semibold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("_")) {
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      nodes.push(
        <a key={key++} href={mm[2]} className="text-primary underline underline-offset-2">
          {mm[1]}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Minimal markdown renderer: headings, lists, blockquotes, paragraphs, bold/italic/links. */
export function MarkdownView({ source, className = "" }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  let key = 0;

  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={key++} className="list-disc pl-5 space-y-1.5 text-[15px] text-muted-foreground">
        {list.map((li, i) => (
          <li key={i}>{inline(li)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushPara = () => {
    if (!para.length) return;
    blocks.push(
      <p key={key++} className="text-[15px] leading-7 text-muted-foreground">
        {inline(para.join(" "))}
      </p>,
    );
    para = [];
  };
  const flush = () => {
    flushList();
    flushPara();
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flush();
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s*/, "");
      const cls =
        level <= 1
          ? "text-[26px] sm:text-[32px] font-bold tracking-tight text-foreground mt-2"
          : level === 2
            ? "text-[19px] font-bold text-foreground mt-6"
            : "text-[16px] font-semibold text-foreground mt-4";
      blocks.push(
        <Fragment key={key++}>
          {level <= 1 ? <h2 className={cls}>{inline(text)}</h2> : level === 2 ? <h3 className={cls}>{inline(text)}</h3> : <h4 className={cls}>{inline(text)}</h4>}
        </Fragment>,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      blocks.push(
        <blockquote
          key={key++}
          className="border-l-[3px] border-primary bg-primary/5 rounded-r-[10px] px-4 py-3 text-[14px] text-foreground"
        >
          {inline(line.replace(/^>\s?/, ""))}
        </blockquote>,
      );
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    flushList();
    para.push(line);
  }
  flush();

  return <div className={`space-y-3 ${className}`}>{blocks}</div>;
}
