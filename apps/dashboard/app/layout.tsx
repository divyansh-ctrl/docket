import type { Metadata, Viewport } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import "./globals.css";
import "./atmospheres.css";
import "./workshop.css";

const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://aos.local"),
  title: {
    default: "AOS — Agent Operations System",
    template: "%s · AOS",
  },
  description:
    "An open, auditable control plane that routes, validates, and proves agent work.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${firaSans.variable} ${firaCode.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
