import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/master/:id",
        destination: "/release/:id",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
