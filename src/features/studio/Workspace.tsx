import { StudioSidebar } from './components/Sidebar/StudioSidebar';
import { StageCanvas } from './components/Canvas/StageCanvas';
import { PropertiesInspector } from './components/Inspector/PropertiesInspector';

export function Workspace() {
  return (
    <section className="grid min-h-[calc(100vh-160px)] grid-cols-1 gap-3 lg:grid-cols-[280px_1fr_320px]">
      <StudioSidebar />
      <StageCanvas />
      <PropertiesInspector />
    </section>
  );
}
