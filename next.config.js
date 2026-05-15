/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/recommend": ["./data/**"],
    "/api/health":    ["./data/**"],
  },
};
module.exports = nextConfig;
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [],
  },
};
module.exports = nextConfig;
