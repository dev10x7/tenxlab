/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tenxlab/contracts'],
  // Browser calls go through the same-origin /api/* route handlers, which proxy
  // server-side to API_BASE_URL. NEXT_PUBLIC_API_BASE_URL must stay unset so the
  // client resolves relative paths; a value here is inlined into the bundle at
  // build time and would point the browser at the wrong host.
};

export default nextConfig;
