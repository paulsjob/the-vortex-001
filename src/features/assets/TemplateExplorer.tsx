import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLayerStore } from '../../store/useLayerStore';
import { useTemplateStore } from '../../store/useTemplateStore';

const iconBtn = 'h-8 w-8 rounded border border-slate-700 bg-slate-900 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50';

export function TemplateExplorer() {
  const navigate = useNavigate();
  const templateStore = useTemplateStore();
  const loadTemplate = useLayerStore((s) => s.loadTemplate);
  const [currentFolderId, setCurrentFolderId] = useState(templateStore.rootId);
  const [query, setQuery] = useState('');

  const getFolder = (id: string) => templateStore.folders.find((f) => f.id === id);

  const templates = useMemo(
    () => templateStore.getTemplatesInFolder(currentFolderId).filter((t) => t.name.toLowerCase().includes(query.toLowerCase())),
    [templateStore, currentFolderId, query],
  );

  const renderFolderTree = (folderId: string, depth = 0): JSX.Element | null => {
    const folder = getFolder(folderId);
    if (!folder) return null;
    const childFolders = folder.children.map(getFolder).filter(Boolean) as NonNullable<ReturnType<typeof getFolder>>[];
    const isOpen = templateStore.expanded[folderId] ?? depth === 0;
    return (
      <div key={folderId} style={{ marginLeft: depth * 12 }} className="space-y-1">
        <div className="flex items-center gap-1">
          {childFolders.length ? <button className="h-5 w-5 rounded border border-slate-700 bg-slate-800 text-xs" onClick={() => templateStore.toggleExpanded(folderId)}>{isOpen ? '▾' : '▸'}</button> : <span className="inline-block h-5 w-5" />}
          <button className={`w-full rounded border px-2 py-1 text-left ${currentFolderId === folder.id ? 'border-blue-500 bg-slate-800' : 'border-slate-700 bg-slate-900'}`} onClick={() => setCurrentFolderId(folder.id)}>{folder.name}</button>
        </div>
        {isOpen && childFolders.map((child) => renderFolderTree(child.id, depth + 1))}
      </div>
    );
  };

  return (
    <section className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3 lg:grid-cols-[280px_1fr_260px]">
      <aside className="rounded-lg border border-slate-800 bg-slate-950 p-3">
        <h3 className="mb-2 font-semibold">Templates Folders</h3>
        {renderFolderTree(templateStore.rootId)}
      </aside>

      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1" placeholder="Search templates" />
          <button className={iconBtn} title="Create folder" onClick={() => {
            const name = window.prompt('Name this new folder')?.trim();
            if (name) templateStore.addFolder(name, currentFolderId);
          }}>➕</button>
          <button className={iconBtn} title="Delete selected folder" onClick={() => templateStore.deleteFolder(currentFolderId)} disabled={currentFolderId === templateStore.rootId}>🗑</button>
        </div>

        <div className="grid gap-2 text-sm">
          <div className="grid grid-cols-[1.6fr_0.8fr_1fr_1fr_auto_auto] text-slate-400"><span>Name</span><span>Type</span><span>Dimensions</span><span>Modified</span><span>Load</span><span>Delete</span></div>
          {templates.map((template) => (
            <div key={template.id} className="grid grid-cols-[1.6fr_0.8fr_1fr_1fr_auto_auto] items-center gap-2 rounded border border-slate-800 bg-slate-900 p-2">
              <span>🧩 {template.name}</span>
              <span>Template</span>
              <span>{template.canvasWidth}x{template.canvasHeight}</span>
              <span>{new Date(template.updatedAt ?? template.createdAt).toLocaleDateString()}</span>
              <button className="rounded bg-blue-700 px-2 py-1 text-xs" onClick={() => {
                loadTemplate(template);
                navigate('/design');
              }}>Load</button>
              <button className={iconBtn} title="Delete template" onClick={() => templateStore.deleteTemplate(template.id)}>🗑</button>
            </div>
          ))}
          {!templates.length && <p className="text-slate-500">No templates in this folder yet. Save one from Design.</p>}
        </div>
      </div>

      <aside className="rounded-lg border border-slate-800 bg-slate-950 p-3">
        <h4 className="mb-2 font-semibold">Templates Protocol</h4>
        <p className="text-xs text-slate-400">Templates are saved design compositions (layers + canvas size + bindings), not raw assets.</p>
      </aside>
    </section>
  );
}
