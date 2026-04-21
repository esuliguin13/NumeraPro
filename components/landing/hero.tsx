import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function LandingHero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-32">
      {/* Background glow */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[800px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute left-1/4 top-1/4 h-[400px] w-[400px] rounded-full bg-violet-500/3 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          {/* Announcement badge */}
          <div className="mb-8 flex justify-center">
            <Badge
              variant="outline"
              className="gap-1.5 border-primary/30 bg-primary/10 text-primary px-4 py-1.5 text-sm"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Multi-source validation · Conflict detection · Derived metrics
            </Badge>
          </div>

          {/* Headline */}
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
            Financial
            <span className="relative mx-3 text-primary">
              Intelligence
              <svg
                className="absolute -bottom-2 left-0 w-full"
                viewBox="0 0 300 12"
                fill="none"
              >
                <path
                  d="M2 10C60 4 120 2 150 2C180 2 240 4 298 10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="text-primary/40"
                />
              </svg>
            </span>
            , Not Just Document AI
          </h1>

          {/* Subtext */}
          <p className="mt-8 text-lg leading-8 text-muted-foreground sm:text-xl max-w-2xl mx-auto">
            Numera reconciles data across annual reports, earnings transcripts,
            financial models, and spreadsheets. Ask one question — get a
            validated answer with conflict detection, confidence scores, and
            full source attribution across every document.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" className="gap-2 px-8" asChild>
              <Link href="/signup">
                Start Free Trial
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="gap-2 px-8" asChild>
              <Link href="#how-it-works">See How It Works</Link>
            </Button>
          </div>

          {/* Trust line */}
          <p className="mt-6 text-sm text-muted-foreground">
            No credit card required · Bank-grade encryption · Data stays in your region
          </p>
        </div>

        {/* Product preview mockup */}
        <div className="mt-16 mx-auto max-w-6xl rounded-xl border border-border bg-card overflow-hidden shadow-2xl shadow-black/40">
          {/* Toolbar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full bg-red-500/60" />
              <div className="h-3 w-3 rounded-full bg-amber-500/60" />
              <div className="h-3 w-3 rounded-full bg-emerald-500/60" />
            </div>
            <div className="flex-1 mx-4 h-7 rounded-md bg-background/60 border border-border/50 flex items-center px-3">
              <span className="text-xs text-muted-foreground">
                Numera · Q3 2024 Earnings Analysis
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-[10px] rounded-full px-2 py-0.5 bg-muted text-muted-foreground border border-border">Executive</span>
              <span className="text-[10px] rounded-full px-2 py-0.5 bg-primary/10 text-primary border border-primary/30">Analyst</span>
            </div>
          </div>

          {/* Executive summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-px border-b border-border bg-border">
            {[
              { label: "Revenue", value: "$61.9B", sub: "+17% YoY", color: "text-emerald-400" },
              { label: "EBITDA Margin", value: "47.2%", sub: "+1.4pp", color: "text-emerald-400" },
              { label: "Net Income", value: "$24.7B", sub: "+20% YoY", color: "text-emerald-400" },
              {
                label: "Growth Driver",
                value: "Azure cloud up 33% YoY, driven by AI workloads and enterprise migrations…",
                isText: true,
                accent: "text-emerald-500",
              },
              {
                label: "Key Risk",
                value: "Regulatory pressure in EU markets; AI investment pace may compress margins…",
                isText: true,
                accent: "text-amber-500",
              },
            ].map((card) => (
              <div key={card.label} className="bg-card px-3 py-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                  {card.label}
                </p>
                {(card as { isText?: boolean }).isText ? (
                  <p className="text-[10px] text-foreground/70 leading-relaxed line-clamp-2">
                    {card.value}
                  </p>
                ) : (
                  <>
                    <p className="text-lg font-bold text-foreground leading-none">{card.value}</p>
                    <p className={`text-[10px] font-semibold mt-0.5 ${card.color}`}>{card.sub}</p>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Matrix grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="sticky left-0 z-10 bg-card/95 px-4 py-3 text-left font-medium text-muted-foreground w-48 min-w-[12rem]">
                    Document
                  </th>
                  {[
                    "Revenue (Q3 2024)",
                    "EBITDA Margin",
                    "Key Risks",
                    "FY2025 Guidance",
                  ].map((q) => (
                    <th
                      key={q}
                      className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[180px]"
                    >
                      {q}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    name: "MSFT-Q3-2024-Earnings.pdf",
                    icon: "🔵",
                    cells: [
                      { text: "$61.9B", sub: "+17% YoY", confidence: 96, done: true },
                      { text: "47.2% operating margin", sub: "+1.4pp YoY", confidence: 94, done: true },
                      { text: "Competition in AI, macro headwinds…", confidence: 82, done: true },
                      { text: "FY2025: $275–280B revenue", confidence: 91, done: true },
                    ],
                  },
                  {
                    name: "MSFT-10K-FY2024.pdf",
                    icon: "🔵",
                    cells: [
                      { text: "$60.1B", sub: "+15% YoY", confidence: 97, done: true, conflict: true, conflictNote: "10-K: $60.1B vs. Earnings: $61.9B" },
                      { text: "46.8% operating margin", confidence: 93, done: true },
                      { text: "Regulatory, cloud pricing…", confidence: 79, done: true },
                      { text: "", confidence: 0, done: false },
                    ],
                  },
                  {
                    name: "MSFT-Transcript-Q3.txt",
                    icon: "🟢",
                    cells: [
                      { text: "", confidence: 0, done: false, running: true },
                      { text: "", confidence: 0, done: false, running: true },
                      { text: "", confidence: 0, done: false },
                      { text: "", confidence: 0, done: false },
                    ],
                  },
                ].map((row) => (
                  <tr
                    key={row.name}
                    className="border-b border-border/50 hover:bg-muted/10 transition-colors"
                  >
                    <td className="sticky left-0 z-10 bg-card/95 px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span>{row.icon}</span>
                        <span className="text-foreground/80 truncate max-w-[140px]">
                          {row.name}
                        </span>
                      </div>
                    </td>
                    {row.cells.map((cell, ci) => (
                      <td key={ci} className="px-4 py-3">
                        {cell.done ? (
                          <div className="space-y-1.5">
                            <p className="text-foreground/70 line-clamp-2">{cell.text}</p>
                            {(cell as { sub?: string }).sub && (
                              <p className="text-[10px] text-emerald-400 font-semibold">{(cell as { sub?: string }).sub}</p>
                            )}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <div
                                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                  cell.confidence >= 90
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : cell.confidence >= 75
                                    ? "bg-amber-500/15 text-amber-400"
                                    : "bg-red-500/15 text-red-400"
                                }`}
                              >
                                {cell.confidence}% confidence
                              </div>
                              {(cell as { conflict?: boolean }).conflict && (
                                <div className="inline-flex items-center gap-0.5 rounded border border-amber-200/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                                  ⚠ Conflicting Signals
                                </div>
                              )}
                            </div>
                            {(cell as { conflictNote?: string }).conflictNote && (
                              <p className="text-[10px] text-amber-400/70 italic">
                                {(cell as { conflictNote?: string }).conflictNote}
                              </p>
                            )}
                          </div>
                        ) : (cell as { running?: boolean }).running ? (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                            <span>Analyzing…</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
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
    </section>
  );
}
