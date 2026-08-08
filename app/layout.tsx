import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sumobot — Learn, Build, Battle",
    template: "%s · Sumobot",
  },
  description: "Analyze the replays, build the bots, and code a real portfolio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
