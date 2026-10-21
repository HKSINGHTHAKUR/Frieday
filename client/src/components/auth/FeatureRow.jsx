import { AnalysisIcon, InsightsIcon, ThemesIcon } from './icons.jsx';

/**
 * The three product-benefit rows shown under the GitHub button.
 * Ported from the supplied "Frieday GitHub Authentication Design" export.
 */
const FEATURES = [
  {
    icon: AnalysisIcon,
    title: 'Automatic analysis',
    description: 'Explore your repositories and commit activity.',
  },
  {
    icon: ThemesIcon,
    title: 'Meaningful themes',
    description: 'Discover patterns in your development work.',
  },
  {
    icon: InsightsIcon,
    title: 'Personal insights',
    description: 'Understand how your activity evolves over time.',
  },
];

export default function FeatureRow() {
  return (
    <ul id="features" aria-label="What you get" className="space-y-2.5 short:space-y-2 compact:space-y-1.5">
      {FEATURES.map((f) => {
        const Icon = f.icon;
        return (
          <li
            key={f.title}
            className="group flex items-center gap-3.5 rounded-[13px] border border-white/[0.06] bg-white/[0.022] px-3.5 py-3 transition-[border-color,background-color] duration-200 hover:border-[rgb(255_155_69/0.22)] hover:bg-white/[0.034] short:py-2.5 compact:py-2"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-[rgb(255_106_42/0.2)] bg-[linear-gradient(160deg,#3b1b0d,#1d0e07)] text-[#ff9b45] shadow-[inset_0_1px_0_rgb(255_180_120/0.12)] transition-[border-color,color] duration-200 group-hover:border-[rgb(255_155_69/0.45)] group-hover:text-[#ffc078] compact:size-9">
              <Icon />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-medium leading-snug text-[#f5f5f5] compact:text-[14.5px]">
                {f.title}
              </span>
              <span className="block text-[13.5px] leading-snug text-[#8a8d93] compact:text-[13px]">
                {f.description}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export { FEATURES };
