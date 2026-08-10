import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Sumobot Online Alpha — Build, Ready, Battle";
  const description = "Build programmable sumo robots and compete in authoritative online PvP rooms across Button, Live Command, and Script modes.";
  return {
    title: { default: "Sumobot — Learn, Build, Battle", template: "%s · Sumobot" },
    description,
    openGraph: { title, description, type: "website", url: origin, images: [{ url: `${origin}/og.png`, width: 1731, height: 909, alt: "Two programmable Sumobot robots colliding in the Online Alpha arena" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
