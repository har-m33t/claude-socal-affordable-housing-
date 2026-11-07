/** @type {import('next').NextConfig} */
const nextConfig = {
  // The agent route streams Server-Sent Events; it must never be statically
  // optimized or cached.
  experimental: { proxyTimeout: 300_000 },
};
export default nextConfig;
