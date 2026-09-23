import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui/button.jsx';

export function PageInfo({ page, onClose }) {
  const dialogRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    dialogRef.current.showModal();
    async function read(url) {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('读取失败（' + response.status + '）');
      return response.json();
    }
    Promise.all([read('/registry'), read('/health')]).then(([registry, health]) => {
      const entry = registry.entries.find(item => item.id === page.id);
      if (page.site && !entry) throw new Error('这个页面已不在登记表中');
      const source = entry ? (entry.path || entry.url) : health.root + '/content/previews/' + page.id;
      const board = (entry ? '/sites/' : '/previews/') + encodeURIComponent(page.id) + '/board.json';
      setInfo({
        source,
        kind: entry ? ({ dir: '本地目录', file: '本地 HTML 文件', url: 'URL 网页' })[entry.kind] :
          '内置示例',
        sourceLabel: entry?.kind === 'url' ? '源 URL' : '源路径',
        registeredTitle: entry?.title || page.title,
        board: new URL(board, location.origin).href,
        registry: entry ? registry.path : null,
        mtime: registry.pageTimes?.[page.id]?.mtime || entry?.mtime || page.mtime || null,
        addedAt: entry?.addedAt || null,
        annotatedAt: registry.pageTimes?.[page.id]?.annotatedAt || null,
        generated: entry?.kind === 'url' || entry?.kind === 'file'
      });
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [page]);

  const pageUrl = new URL('/index.html', location.origin);
  pageUrl.searchParams.set('page', page.id);
  pageUrl.searchParams.set('mode', page.mode || 'ios');
  return createPortal(
    <dialog ref={dialogRef} className="wb-page-info" aria-labelledby="wb-page-info-title"
      data-ann-ui="" onClose={onClose}
      onClick={event => { if (event.target === event.currentTarget) dialogRef.current.close(); }}>
      <div className="wb-page-info-content">
        <header><h2 id="wb-page-info-title">查看信息</h2>
          <Button variant="tool" onClick={() => dialogRef.current.close()}>关闭</Button></header>
        <p className="wb-page-info-name">{page.title}</p>
        {error ? <p role="alert">{error}</p> : !info ? <p role="status">正在读取…</p> : <>
          <section className="wb-page-info-source">
            <div><span>{info.sourceLabel}</span><Button variant="tool" onClick={async () => {
              try { await navigator.clipboard.writeText(info.source); setCopied(true); }
              catch { setError('复制失败，请选中路径手动复制'); }
            }}>{copied ? '已复制' : '复制'}</Button></div>
            <code>{info.source}</code>
          </section>
          <dl>
            <dt>来源类型</dt><dd>{info.kind}</dd>
            <dt>页面 ID</dt><dd>{page.id}</dd>
            {info.registeredTitle !== page.title && <><dt>登记名称</dt><dd>{info.registeredTitle}</dd></>}
            <dt>页面链接</dt><dd><a href={pageUrl.href}>{pageUrl.href}</a></dd>
            <dt>页面定义</dt><dd><a href={info.board} target="_blank" rel="noreferrer">{info.board}</a>
              {info.generated && <span className="wb-page-info-hint">自动生成</span>}</dd>
            {info.registry && <><dt>登记文件</dt><dd>{info.registry}</dd></>}
            <dt>添加时间</dt><dd>{info.addedAt ? new Date(info.addedAt).toLocaleString('zh-CN', { hour12: false }) : '未知'}</dd>
            <dt>最后标注</dt><dd>{info.annotatedAt ? new Date(info.annotatedAt).toLocaleString('zh-CN', { hour12: false }) : '未记录'}</dd>
            <dt>最后修改</dt><dd>{info.mtime ? new Date(info.mtime).toLocaleString('zh-CN', { hour12: false }) : '未提供'}</dd>
          </dl>
        </>}
      </div>
    </dialog>, document.body
  );
}
