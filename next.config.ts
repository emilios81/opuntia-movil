import type {NextConfig} from 'next';

// En GitHub Pages el sitio no cuelga de la raíz del dominio sino de
// /<nombre-del-repo>/. Todas las rutas absolutas (assets, manifest, service
// worker, iconos) tienen que llevar ese prefijo o el sitio carga en blanco.
// Para publicar en la raíz de un dominio propio: NEXT_PUBLIC_BASE_PATH=""
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/opuntia-movil';

const nextConfig: NextConfig = {
  basePath,
  // Se expone al código del navegador para registrar el service worker y
  // resolver los iconos con el mismo prefijo.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // Exportación estática: la app corre 100% en el navegador (procesamiento en
  // canvas + SDK cliente de Firebase), así que no necesita servidor. `next
  // build` deja el sitio listo en out/ para subir a cualquier hosting.
  output: 'export',
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
