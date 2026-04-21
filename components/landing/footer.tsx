import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LandingFooter() {
  return (
    <>
      {/* CTA Section */}
      <section className="py-24 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Turn documents into financial intelligence
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Join investment teams using Numera to validate data across sources,
              detect conflicts automatically, and cut due diligence time.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button size="lg" className="px-8" asChild>
                <Link href="/signup">Start Free Trial</Link>
              </Button>
              <Button variant="outline" size="lg" className="px-8" asChild>
                <Link href="mailto:sales@numera.ai">Talk to Sales</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
                <BarChart3 className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground">Numera</span>
            </div>

            {/* Links */}
            <nav className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground">
              {[
                { href: "#features", label: "Features" },
                { href: "#how-it-works", label: "How It Works" },
                { href: "/login", label: "Sign In" },
                { href: "/signup", label: "Get Started" },
                { href: "mailto:support@numera.ai", label: "Support" },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="hover:text-foreground transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </nav>

            {/* Legal */}
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} tumana.ai. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
