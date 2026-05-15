/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/recommend": ["./data/**"],
    "/api/health":    ["./data/**"],
  },
};
module.exports = nextConfig;
