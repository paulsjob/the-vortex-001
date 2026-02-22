import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLayerStore } from '../../store/useLayerStore';
import { useTemplateStore } from '../../store/useTemplateStore';

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
        <div className="mb-3 flex flex-wrap gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1" placeholder="Search templates" />
          <button className="rounded bg-blue-700 px-3 py-1" onClick={() => {
            const name = window.prompt('Name this new folder')?.trim();
            if (name) templateStore.addFolder(name, currentFolderId);
          }}>Create Folder</button>
          <button className="rounded bg-red-800 px-3 py-1" onClick={() => templateStore.deleteFolder(currentFolderId)} disabled={currentFolderId === templateStore.rootId}>Delete Folder</button>
        </div>

        <div className="grid gap-2 text-sm">
          <div className="grid grid-cols-5 text-slate-400"><span>Name</span><span>Type</span><span>Dimensions</span><span>Modified</span><span>Action</span></div>
          {templates.map((template) => (
            <div key={template.id} className="grid grid-cols-5 rounded border border-slate-800 bg-slate-900 p-2">
              <span>🧩 {template.name}</span>
              <span>Template</span>
              <span>{template.canvasWidth}x{template.canvasHeight}</span>
              <span>{new Date(template.createdAt).toLocaleDateString()}</span>
              <button className="rounded bg-blue-700 px-2 py-1" onClick={() => {
                loadTemplate(template);
                navigate('/design');
              }}>Load in Design</button>
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
