import type { Metadata } from "next";
import Script from "next/script";
import { ClarityAnalytics } from "@/components/clarity-analytics";
import "./globals.css";

export const metadata: Metadata = {
  title: "iPhono-odevator",
  applicationName: "iPhono-odevator",
  description: "iPhono-odevator — Интерактивная среда для кастомизации мокапов",
  icons: {
    icon: "/favicon.png",
  },
};

// Разметка приходит с тёмной темой; скрипт успевает снять её до первой
// отрисовки, если в прошлый раз выбрали светлую. Иначе светлая тема
// моргала бы тёмной на каждой загрузке.
const themeScript = `try{if(localStorage.getItem("mockup-theme")==="light")document.documentElement.classList.remove("dark")}catch(e){}`;

// Разметка приходит с раскрытием по умолчанию, а сохранённое известно только
// браузеру. Стиль показывает его уже в первом кадре, иначе панель заметно
// перестраивалась бы после гидратации. Имя раздела берётся из ключа и чистится,
// чтобы в селектор не попало ничего лишнего. Снимает стиль сам раздел, когда
// React получает то же состояние, — дальше раскрытием управляет только hidden.
// Раскрытому разделу нужен !important: в preflight Tailwind правило [hidden]
// стоит с ним, и обычное объявление его не перебивает.
const sectionsScript = `try{var p="forma:inspector:",o=[],c=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(!k||k.slice(0,p.length)!==p)continue;var s='.inspector-section[data-section="'+k.slice(p.length).replace(/[^a-zA-Z0-9_-]/g,"")+'"]>.inspector-section-content';(localStorage.getItem(k)==="true"?o:c).push(s)}var css=(o.length?o.join(",")+"{display:block!important}":"")+(c.length?c.join(",")+"{display:none}":"");if(css){var e=document.createElement("style");e.id="inspector-open";e.textContent=css;document.head.appendChild(e)}}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" className="dark" suppressHydrationWarning>
    <body>
      <Script id="mockup-theme" strategy="beforeInteractive">{themeScript}</Script>
      <Script id="mockup-sections" strategy="beforeInteractive">{sectionsScript}</Script>
      {children}
      <ClarityAnalytics enabled={process.env.VERCEL_ENV === "production"} />
    </body>
  </html>;
}
