import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Numera — AI Financial Analysis Platform",
    template: "%s | Numera",
  },
  description:
    "Numera's Matrix workspace lets financial analysts run any question across thousands of documents simultaneously — with structured extraction, exact citations, and confidence scoring.",
  keywords: [
    "financial analysis",
    "AI research",
    "document intelligence",
    "earnings analysis",
    "due diligence",
    "investment research",
  ],
  openGraph: {
    title: "Numera — AI Financial Analysis Platform",
    description:
      "Query thousands of financial documents simultaneously with AI-powered Matrix analysis.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
