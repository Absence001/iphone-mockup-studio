import type { Metadata } from "next";
import Script from "next/script";
import { ClarityAnalytics } from "@/components/clarity-analytics";
import "./globals.css";

export const metadata: Metadata = {
  title: "Мокапы",
  applicationName: "Мокапы",
  description: "Локальная студия 3D-мокапов iPhone. Загрузите экран, выберите ракурс и сохраните PNG.",
};

// Разметка приходит с тёмной темой; скрипт успевает снять её до первой
// отрисовки, если в прошлый раз выбрали светлую. Иначе светлая тема
// моргала бы тёмной на каждой загрузке.
const themeScript = `try{if(localStorage.getItem("mockup-theme")==="light")document.documentElement.classList.remove("dark")}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" className="dark" suppressHydrationWarning>
    <body>
      <Script id="mockup-theme" strategy="beforeInteractive">{themeScript}</Script>
      {children}
      <ClarityAnalytics enabled={process.env.VERCEL_ENV === "production"} />
    </body>
  </html>;
}
