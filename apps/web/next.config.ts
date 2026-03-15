import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/design-lab",
        destination: "/",
        permanent: false,
      },
      {
        source: "/design-lab/:path*",
        destination: "/",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
