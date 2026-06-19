const items = ["Min. Salud", "RETHUS", "Nequi", "PSE", "WhatsApp Business"];

export function TrustBar() {
  return (
    <section className="border-y border-border bg-foreground/[0.02]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
         <p className="text-center text-xs uppercase tracking-[0.2em] text-muted-foreground mb-5 font-bold">
           INTEGRA
         </p>
        <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-3">
          {items.map((i) => (
            <span
              key={i}
              className="text-sm font-display font-semibold text-muted-foreground/80 hover:text-foreground transition-colors"
            >
              {i}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
