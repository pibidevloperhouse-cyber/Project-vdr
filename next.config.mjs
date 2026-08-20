/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "localhost",
    "192.168.*.*",
  ],
};

export default nextConfig;