import type { NextConfig } from "next";

const allowedDevOrigins = process.env.AITM_ALLOWED_DEV_ORIGINS
  ? process.env.AITM_ALLOWED_DEV_ORIGINS.split(",")
  : [];

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins,
};

export default nextConfig;
