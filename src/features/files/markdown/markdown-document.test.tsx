import "@/i18n";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownDocument, documentUrl } from "./markdown-document";
import { sanitizeAnimatedSvg } from "@/lib/markdown/safe-svg";
import { parseDelimitedPreview } from "@/lib/markdown/structured-code";
import { defaultDataChartTheme, parseDataChartSpec, renderDataChartSvg } from "@/lib/markdown/data-chart";

describe("migrated Markdown document rendering",()=>{
  it("renders GFM, extensions, callouts, shortcuts and display mathematics",()=>{
    const html=renderToStaticMarkup(<MarkdownDocument content={'# 文档\n\n> [!TIP]\n> 提示\n\nH~2~O E=mc^2^ ==高亮== `Ctrl+K`\n\n- [x] 完成\n\n|文件|数量|\n|---|---:|\n|A|12|\n\n$$E=mc^2$$\n'}/>);
    for(const token of ['<h1>','<sub>2</sub>','<sup>2</sup>','<mark>高亮</mark>','data-slot="kbd"','type="checkbox"','<table>','data-numeric="true"','markdown-callout-tip','katex-display'])expect(html).toContain(token);
  });
  it("uses the shared CodeBlock for fenced source and never renders raw file HTML",()=>{
    const html=renderToStaticMarkup(<MarkdownDocument content={'```typescript\nconst safe = "<script>";\n```\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))'}/>);
    expect(html).toContain('data-slot="code-block"');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('href="javascript:');
  });
  it("keeps footnote anchors and rejects active URL schemes and credentials",()=>{
    const html=renderToStaticMarkup(<MarkdownDocument content={'文档[^a]\n\n[^a]: 注释'}/>);
    expect(html).toContain('data-footnote-ref');expect(html).toContain('user-content-fn');
    for(const url of ['javascript:alert(1)','file:///C:/secret','data:text/html,test','https://user:password@example.com'])expect(documentUrl(url)).toBe('');
    expect(documentUrl('https://example.com/image.png',true)).toBe('https://example.com/image.png');
    expect(documentUrl('data:image/png;base64,aGVsbG8=',true)).toBe('data:image/png;base64,aGVsbG8=');
    expect(documentUrl('data:image/svg+xml;base64,PHN2Zz4=',true)).toBe('');
  });
  it("keeps quoted CSV and TSV cell boundaries",()=>{
    expect(parseDelimitedPreview('name,value\n"A,B",12',',')).toEqual([['name','value'],['A,B','12']]);
    expect(parseDelimitedPreview('name\tvalue\nA\t12','\t')).toEqual([['name','value'],['A','12']]);
  });
  it.each(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>','<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>','<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>','<!DOCTYPE svg><svg></svg>'])('rejects unsafe SVG %s',source=>expect(()=>sanitizeAnimatedSvg(source)).toThrow());
  it("accepts safe vector content",()=>expect(sanitizeAnimatedSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="4" fill="currentColor"/></svg>')).toContain('<circle'));
  it.each(['bar','line','area','pie','donut','scatter','heatmap','boxplot'])('preserves the migrated %s chart renderer',type=>{
    const series=type==='scatter'?[{name:'A',points:[{x:1,y:2}]}]:type==='boxplot'?[{name:'A',boxes:[{min:0,q1:1,median:2,q3:3,max:4}]}]:[{name:'A',values:[12]}];
    const parsed=parseDataChartSpec(JSON.stringify({type,labels:type==='scatter'?undefined:['A'],series}));expect(parsed.ok).toBe(true);
    if(parsed.ok){const svg=renderDataChartSvg(parsed.spec,defaultDataChartTheme);expect(svg).toContain(`data-chart-type="${type}"`);expect(svg).not.toMatch(/NaN|Infinity|<script/);}
  });
});
