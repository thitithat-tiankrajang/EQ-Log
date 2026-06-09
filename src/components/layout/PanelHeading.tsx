export function PanelHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="panel-heading">
      <h2>{title}</h2>
      <span>{detail}</span>
    </div>
  );
}
