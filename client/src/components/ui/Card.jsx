/**
 * Card (design_system.md §11): surface, 1px border, radius md, shadow sm.
 * @param {{ title?: string, action?: import('react').ReactNode } & import('react').HTMLAttributes<HTMLDivElement>} props
 */
export default function Card({ title, action, children, ...rest }) {
  return (
    <section className="rounded-md border border-border bg-surface p-20 shadow-sm" {...rest}>
      {(title || action) && (
        <div className="mb-16 flex items-center justify-between">
          {title && <h2 className="text-base font-semibold leading-6 text-text">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
