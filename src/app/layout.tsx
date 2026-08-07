
import type { Metadata, Viewport } from 'next';
import { Alegreya, Source_Code_Pro } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { PWARegistration } from '@/components/PWARegistration';

// El sitio se publica bajo /<repo>/ en GitHub Pages: los recursos estáticos
// que no pasan por el router de Next necesitan el prefijo a mano.
const base = process.env.NEXT_PUBLIC_BASE_PATH || '';

// Las tipografías se descargan al compilar y se sirven desde el propio sitio.
// Traerlas de fonts.googleapis.com dejaba a la app dependiendo de internet
// justo para lo que tiene que funcionar en el campo, sin señal.
const alegreya = Alegreya({ subsets: ['latin'], variable: '--font-alegreya', display: 'swap' });
const sourceCodePro = Source_Code_Pro({ subsets: ['latin'], variable: '--font-code', display: 'swap' });

export const metadata: Metadata = {
  title: 'OpuntiaColor v3.4.0',
  description: 'Procesamiento avanzado de arte rupestre para arqueología profesional.',
  manifest: `${base}/manifest.json`,
  icons: {
    icon: `${base}/icon-192.png`,
    shortcut: `${base}/icon-192.png`,
    apple: `${base}/apple-touch-icon.png`,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'OpuntiaColor v3.4.0',
  },
};

export const viewport: Viewport = {
  themeColor: '#372A20',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${alegreya.variable} ${sourceCodePro.variable}`}>
      <head>
        <link rel="icon" href={`${base}/icon-192.png`} />
        <link rel="apple-touch-icon" href={`${base}/apple-touch-icon.png`} />
        <link rel="manifest" href={`${base}/manifest.json`} />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="font-body antialiased bg-background text-foreground overflow-x-hidden">
        {/* Sin proveedor de Firebase: nada en la app lo usa, y montarlo
            inicializaba Auth y Firestore —cientos de KB— en cada arranque.
            El código sigue en src/firebase/ por si algún día hace falta. */}
        <PWARegistration />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
