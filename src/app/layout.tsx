import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/base/toast/toast";
import "@/styles/globals.css";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], axes: ["opsz"] });
const mono = JetBrains_Mono({ variable: "--font-mono-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Shiplog: build in public without writing the posts",
  description:
    "Your commits, turned into build-in-public posts in your voice, on your schedule.",
};

// Runs before paint: stored choice wins, else the OS preference (persisted so ThemeToggle agrees).
const themeScript = `(function(){try{var k="boardui:theme",t=localStorage.getItem(k);if(t!=="dark"&&t!=="light"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";localStorage.setItem(k,t)}if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster position="bottom-end" />
      </body>
    </html>
  );
}
