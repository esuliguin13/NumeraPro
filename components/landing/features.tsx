import {
  GitMerge,
  AlertTriangle,
  BrainCircuit,
  Calculator,
  Gauge,
  LayoutDashboard,
  Link2,
  ShieldCheck,
} from "lucide-react";

const features = [
  {
    icon: GitMerge,
    title: "Multi-source Validation",
    description:
      "Reconciles answers across PDFs, Excel models, transcripts, and CSVs in the same workspace. Surfaces disagreements automatically before they reach your report.",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
  },
  {
    icon: AlertTriangle,
    title: "Conflict Detection",
    description:
      "When two sources report different revenue figures, Numera flags the discrepancy, labels each source, and displays both values side-by-side so you decide which is authoritative.",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  {
    icon: BrainCircuit,
    title: "Financial Reasoning",
    description:
      "Understands financial context: YoY growth, margin compression, guidance deltas, and segment mix. Derives the calculations your documents don't explicitly state.",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  {
    icon: Calculator,
    title: "Derived Metrics",
    description:
      "Automatically computes EBITDA margins, revenue growth rates, EPS changes, and debt ratios from raw extracted data — even when no single document states them directly.",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
  },
  {
    icon: Gauge,
    title: "Confidence Scoring",
    description:
      "Every answer carries a per-cell confidence score. Low-confidence extractions are flagged for human review before they influence investment decisions.",
    color: "text-sky-400",
    bg: "bg-sky-500/10",
  },
  {
    icon: LayoutDashboard,
    title: "Executive Summary",
    description:
      "Live KPI cards — Revenue, EBITDA, Net Income, Growth Driver, Key Risk — synthesized across your entire workspace and updated automatically as cells run.",
    color: "text-indigo-400",
    bg: "bg-indigo-500/10",
  },
  {
    icon: Link2,
    title: "Exact Citation Engine",
    description:
      "Every answer links to precise source paragraphs with page numbers and document names. Instantly verify any claim — no black-box AI outputs.",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
  },
  {
    icon: ShieldCheck,
    title: "Enterprise Security",
    description:
      "Enterprise-grade encryption at rest and in transit. Private cloud and on-premise deployment available for regulated environments.",
    color: "text-rose-400",
    bg: "bg-rose-500/10",
  },
];

const steps = [
  {
    number: "01",
    title: "Extract",
    description:
      "Upload PDFs, Excel models, earnings transcripts, and CSVs. Numera extracts structured metrics and semantic content with page-level precision across every document.",
  },
  {
    number: "02",
    title: "Normalize",
    description:
      "Financial data is standardised across periods, currencies, and document formats. Revenue figures, margin calculations, and unit conversions are applied automatically.",
  },
  {
    number: "03",
    title: "Cross-validate",
    description:
      "Answers are reconciled across every source. Where sources agree, confidence rises. Where they conflict, Numera flags the discrepancy and shows you both values with attribution.",
  },
  {
    number: "04",
    title: "Generate Insights",
    description:
      "Run the matrix to get a validated answer grid with citations, confidence scores, and a live executive summary synthesising KPIs, growth drivers, and key risks.",
  },
];

export function LandingFeatures() {
  return (
    <>
      {/* Features grid */}
      <section id="features" className="py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <p className="text-sm font-semibold text-primary tracking-widest uppercase mb-4">
              Platform Capabilities
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Built for financial rigor, not just AI search
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Purpose-built for buy-side analysts, investment bankers, and
              credit professionals who need validated answers, not just retrieved text.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group relative rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
              >
                <div
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${feature.bg} mb-4`}
                >
                  <feature.icon className={`h-5 w-5 ${feature.color}`} />
                </div>
                <h3 className="font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product showcase */}
      <section className="py-24 md:py-32 border-t border-border bg-muted/10">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <p className="text-sm font-semibold text-primary tracking-widest uppercase mb-4">
              See It In Action
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Matrix view + live executive summary
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Ask questions across every document simultaneously. The executive
              summary updates as each cell completes — no refresh required.
            </p>
          </div>

          {/* Annotated product mockup */}
          <div className="mx-auto max-w-5xl space-y-4">
            {/* Annotation: Executive Summary */}
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                1
              </div>
              <p className="text-sm font-medium text-foreground">
                Executive Summary —{" "}
                <span className="text-muted-foreground font-normal">
                  live KPI cards synthesised across all documents
                </span>
              </p>
            </div>

            {/* Executive summary strip mockup */}
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-lg shadow-black/20">
              <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Executive Summary
                </span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  FY2024
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-border">
                {[
                  { label: "Revenue", value: "$211.9B", sub: "+16% YoY", src: "CSV" },
                  { label: "EBITDA", value: "$98.5B", sub: "46.5% margin", src: "PDF" },
                  { label: "Net Income", value: "$88.1B", sub: "+21% YoY", src: "PDF" },
                  {
                    label: "Growth Driver",
                    text: "Azure cloud up 33% YoY; AI services revenue reached $10B run-rate…",
                    accent: "text-emerald-500",
                  },
                  {
                    label: "Key Risk",
                    text: "Regulatory pressure in EU markets; AI capex intensity may compress near-term margins…",
                    accent: "text-amber-500",
                  },
                ].map((card) => (
                  <div key={card.label} className="bg-card px-4 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {card.label}
                      </p>
                      {(card as { src?: string }).src && (
                        <span className="text-[8px] font-semibold rounded-full px-1.5 py-0.5 bg-blue-500/10 text-blue-400">
                          {(card as { src?: string }).src}
                        </span>
                      )}
                    </div>
                    {(card as { text?: string }).text ? (
                      <p className={`text-[11px] leading-relaxed line-clamp-2 ${(card as { accent?: string }).accent}`}>
                        {(card as { text?: string }).text}
                      </p>
                    ) : (
                      <>
                        <p className="text-xl font-bold text-foreground leading-none">
                          {card.value}
                        </p>
                        <p className="text-[10px] text-emerald-400 font-semibold mt-1">
                          {card.sub}
                        </p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Annotation: Matrix */}
            <div className="flex items-center gap-3 mt-6">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                2
              </div>
              <p className="text-sm font-medium text-foreground">
                Matrix View —{" "}
                <span className="text-muted-foreground font-normal">
                  cross-validated answers with conflict detection and citations
                </span>
              </p>
            </div>

            {/* Matrix mockup */}
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-lg shadow-black/20">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="sticky left-0 z-10 bg-card/95 px-4 py-3 text-left font-medium text-muted-foreground min-w-[200px]">
                        Document
                      </th>
                      {["Revenue FY2024", "EBITDA Margin", "EPS (Diluted)", "FY2025 Guidance"].map((q) => (
                        <th key={q} className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[180px]">
                          {q}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {
                        name: "Annual-Report-FY2024.pdf",
                        type: "PDF",
                        typeColor: "bg-blue-500/10 text-blue-400",
                        cells: [
                          { value: "$211.9B", growth: "+16% YoY", conf: 97 },
                          { value: "46.5%", growth: "+0.8pp", conf: 94 },
                          { value: "$11.45", growth: "+20% YoY", conf: 96, conflict: true, conflictNote: "Model: $11.52" },
                          { value: "$245–250B", conf: 89 },
                        ],
                      },
                      {
                        name: "Financial-Model-Q4.xlsx",
                        type: "XLSX",
                        typeColor: "bg-emerald-500/10 text-emerald-400",
                        cells: [
                          { value: "$212.4B", growth: "+16% YoY", conf: 95, conflict: true, conflictNote: "AR: $211.9B" },
                          { value: "46.8%", conf: 91 },
                          { value: "$11.52", conf: 98 },
                          { value: "", running: false, empty: true },
                        ],
                      },
                      {
                        name: "Earnings-Transcript-Q4.txt",
                        type: "TXT",
                        typeColor: "bg-muted text-muted-foreground",
                        cells: [
                          { value: "", running: true },
                          { value: "", running: true },
                          { value: "", running: false, empty: true },
                          { value: "Strong demand, expanding margins…", conf: 83 },
                        ],
                      },
                    ].map((row) => (
                      <tr key={row.name} className="border-b border-border/50 hover:bg-muted/10 transition-colors">
                        <td className="sticky left-0 z-10 bg-card/95 px-4 py-3">
                          <div className="space-y-1">
                            <p className="font-medium text-foreground/80 truncate max-w-[170px]">{row.name}</p>
                            <span className={`inline-flex items-center text-[9px] font-semibold rounded px-1.5 py-0.5 border border-border ${row.typeColor}`}>
                              {row.type}
                            </span>
                          </div>
                        </td>
                        {row.cells.map((cell, ci) => (
                          <td key={ci} className="px-4 py-3">
                            {(cell as { running?: boolean }).running ? (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                                <span>Analyzing…</span>
                              </div>
                            ) : (cell as { empty?: boolean }).empty ? (
                              <span className="text-muted-foreground/40">—</span>
                            ) : (
                              <div className="space-y-1.5">
                                <p className="text-foreground/70">{cell.value}</p>
                                {(cell as { growth?: string }).growth && (
                                  <p className="text-[10px] text-emerald-400 font-semibold">{(cell as { growth?: string }).growth}</p>
                                )}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {cell.conf && (
                                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                      cell.conf >= 90 ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
                                    }`}>
                                      {cell.conf}%
                                    </span>
                                  )}
                                  {(cell as { conflict?: boolean }).conflict && (
                                    <span className="inline-flex items-center gap-0.5 rounded border border-amber-200/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                                      ⚠ Conflicting Signals
                                    </span>
                                  )}
                                </div>
                                {(cell as { conflictNote?: string }).conflictNote && (
                                  <p className="text-[10px] text-amber-400/60 italic">{(cell as { conflictNote?: string }).conflictNote}</p>
                                )}
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="py-24 md:py-32 border-t border-border"
      >
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <p className="text-sm font-semibold text-primary tracking-widest uppercase mb-4">
              How It Works
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              From raw documents to validated intelligence
            </h2>
            <p className="mt-4 text-muted-foreground">
              A four-stage pipeline that treats every answer as a hypothesis to be tested across sources.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-4 relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-8 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-border to-transparent" />

            {steps.map((step) => (
              <div key={step.number} className="relative text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
                  <span className="text-2xl font-bold text-primary">
                    {step.number}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-3">
                  {step.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mx-auto">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Metrics banner */}
      <section
        id="security"
        className="py-16 border-t border-border bg-muted/20"
      >
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {[
              { value: "50+", label: "Financial metrics extracted" },
              { value: "3+", label: "Source types reconciled" },
              { value: "<30s", label: "Avg. query time" },
              { value: "AES-256", label: "Encryption at rest" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl font-bold text-foreground">
                  {stat.value}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
