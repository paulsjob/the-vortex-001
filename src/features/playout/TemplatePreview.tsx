import { useDataEngineStore } from '../../store/useDataEngineStore';
import type { SavedTemplate } from '../../store/useTemplateStore';
import { TemplateSceneSvg } from './TemplateSceneSvg';

interface Props {
  template: SavedTemplate | null;
  sponsor: string | null;
  tone?: 'preview' | 'program';
}

const SPONSOR_STYLES: Record<string, { accentFillClass: string; accentBorderClass: string; logo: string }> = {
  'Renderless Sports': { accentFillClass: 'from-cyan-500/45 to-blue-500/45', accentBorderClass: 'border-cyan-400/70', logo: 'RSN' },
  'Orbit Cola': { accentFillClass: 'from-fuchsia-500/45 to-rose-500/45', accentBorderClass: 'border-fuchsia-400/70', logo: 'ORBIT' },
  'Velocity Bank': { accentFillClass: 'from-emerald-500/45 to-lime-500/45', accentBorderClass: 'border-emerald-400/70', logo: 'VB' },
};

const getSponsorStyle = (sponsor: string | null) => (sponsor ? (SPONSOR_STYLES[sponsor] ?? SPONSOR_STYLES['Renderless Sports']) : null);

export function TemplatePreview({ template, sponsor, tone = 'preview' }: Props) {
  const game = useDataEngineStore((s) => s.game);
  const isProgram = tone === 'program';
  const sponsorStyle = getSponsorStyle(sponsor);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        {template ? (
          <div className="mb-0.5 flex shrink-0 items-center justify-between text-[11px] text-slate-400">
            <span className="font-semibold text-slate-200">{template.name}</span>
            <span>{template.canvasWidth} × {template.canvasHeight}</span>
          </div>
        ) : (
          <div className="mb-0.5 flex shrink-0 items-center justify-between text-[11px] text-slate-500">
            <span className="font-semibold text-slate-300">No template loaded</span>
            <span>16 × 9</span>
          </div>
        )}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="relative h-full w-full">
            <div
              className={`absolute inset-0 m-auto aspect-video w-full max-h-full max-w-full rounded-lg border bg-slate-950 ${isProgram ? 'border-red-600/70' : (sponsorStyle?.accentBorderClass ?? 'border-slate-700')}`}
            >
              <div className="absolute inset-0 bg-[linear-gradient(45deg,#0f172a_25%,#111827_25%,#111827_50%,#0f172a_50%,#0f172a_75%,#111827_75%,#111827_100%)] bg-[length:18px_18px] opacity-70" />
              {!isProgram && sponsorStyle && <div className={`absolute inset-0 bg-gradient-to-br ${sponsorStyle.accentFillClass} opacity-55`} />}
              <div className="relative z-10 flex h-full w-full items-center justify-center p-2">
                <div className="relative h-full w-full max-h-full max-w-full">
                  {template ? (
                    <TemplateSceneSvg template={template} className="h-full w-full object-contain" />
                  ) : (
                    <div className={`grid h-full w-full place-items-center rounded border border-dashed border-slate-600/80 bg-slate-950/70 text-sm ${isProgram ? 'text-red-200' : 'text-slate-400'}`}>
                      No template loaded.
                    </div>
                  )}
                </div>
              </div>
              {sponsor ? (
                <div className="absolute left-1.5 top-1.5 rounded border border-slate-200/35 bg-slate-900/70 px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.16em] text-slate-100">
                  {sponsorStyle?.logo ?? 'SP'} · {sponsor}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-0.5 grid shrink-0 grid-cols-3 gap-2 text-[9px] text-slate-500">
          <span>Pitch #{game.lastPitch.pitchNumber}</span>
          <span>{game.awayTeam} {game.scoreAway} - {game.scoreHome} {game.homeTeam}</span>
          <span>{game.half.toUpperCase()} {game.inning} · {game.balls}-{game.strikes} · {game.outs} out</span>
        </div>
      </div>
    </section>
  );
}
